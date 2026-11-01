import { Pool, type QueryResultRow } from "pg";
import { DATABASE_URL } from "./config";

/** Applied on the first query; every statement is safe to run again. */
const SCHEMA = `
create table if not exists users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  daily_limit integer,
  disabled boolean not null default false,
  admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_id on sessions(user_id);

create table if not exists usage_daily (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  messages integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);
`;

let ready: Promise<Pool> | undefined;

function connect(): Promise<Pool> {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Managed databases often present a certificate for an internal hostname.
    ssl: /sslmode=(require|prefer|verify)/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
  });
  // A dropped backend arrives as an error on an idle client, which would otherwise end the process.
  pool.on("error", () => {});
  return pool
    .query(SCHEMA)
    .then(() => pool)
    .catch(async (err: unknown) => {
      // Let the next request try again rather than caching a failed startup.
      ready = undefined;
      await pool.end().catch(() => {});
      throw err;
    });
}

function pool(): Promise<Pool> {
  if (!DATABASE_URL) throw new Error("This server has no database, so accounts are turned off.");
  ready ??= connect();
  return ready;
}

export async function query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await pool();
  const { rows } = await db.query<T>(sql, params);
  return rows;
}

export async function one<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** True when the database is reachable and the schema is in place. */
export async function databaseReady(): Promise<boolean> {
  try {
    await pool();
    return true;
  } catch {
    return false;
  }
}
