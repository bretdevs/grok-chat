import { randomUUID } from "node:crypto";
import { adminEmails } from "./config";
import { one, query } from "./db";
import { hashPassword } from "./password";

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  daily_limit: number | null;
  disabled: boolean;
  admin: boolean;
  created_at: Date;
};

export type User = {
  id: string;
  email: string;
  dailyLimit: number | null;
  disabled: boolean;
  admin: boolean;
  createdAt: number;
};

const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 254);
}

export function validEmail(email: string): boolean {
  return EMAIL.test(email);
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    dailyLimit: row.daily_limit,
    disabled: row.disabled,
    admin: row.admin,
    createdAt: row.created_at.getTime(),
  };
}

export class EmailTakenError extends Error {
  constructor() {
    super("That email already has an account. Sign in instead.");
    this.name = "EmailTakenError";
  }
}

/** The first account on a fresh database becomes the admin, as does any address in ADMIN_EMAIL. */
export async function createUser(email: string, password: string): Promise<User> {
  const passwordHash = await hashPassword(password);
  const first = await one<{ empty: boolean }>("select count(*) = 0 as empty from users");
  const admin = Boolean(first?.empty) || adminEmails().includes(email);
  try {
    const row = await one<UserRow>(
      `insert into users (id, email, password_hash, admin) values ($1, $2, $3, $4)
       returning id, email, password_hash, daily_limit, disabled, admin, created_at`,
      [randomUUID(), email, passwordHash, admin],
    );
    if (!row) throw new Error("The account could not be created.");
    return toUser(row);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new EmailTakenError();
    throw err;
  }
}

export function findByEmail(email: string): Promise<UserRow | null> {
  return one<UserRow>(
    "select id, email, password_hash, daily_limit, disabled, admin, created_at from users where email = $1",
    [email],
  );
}

export async function listUsers(limit = 200): Promise<(User & { messagesToday: number; lastSeenAt: number | null })[]> {
  const rows = await query<UserRow & { messages_today: string | null; last_seen_at: Date | null }>(
    `select u.id, u.email, u.password_hash, u.daily_limit, u.disabled, u.admin, u.created_at,
            coalesce(d.messages, 0) as messages_today,
            (select max(last_seen_at) from sessions s where s.user_id = u.id) as last_seen_at
       from users u
       left join usage_daily d on d.user_id = u.id and d.day = current_date
      order by u.created_at desc
      limit $1`,
    [limit],
  );
  return rows.map((row) => ({
    ...toUser(row),
    messagesToday: Number(row.messages_today ?? 0),
    lastSeenAt: row.last_seen_at?.getTime() ?? null,
  }));
}

export async function setDisabled(userId: string, disabled: boolean): Promise<void> {
  await query("update users set disabled = $2 where id = $1", [userId, disabled]);
  if (disabled) await query("delete from sessions where user_id = $1", [userId]);
}

/** null restores the server-wide default. */
export async function setDailyLimit(userId: string, limit: number | null): Promise<void> {
  await query("update users set daily_limit = $2 where id = $1", [userId, limit]);
}
