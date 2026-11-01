import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { one, query } from "./db";
import { toUser, type User, type UserRow } from "./users";

export const SESSION_COOKIE = "gc_session";
const TTL_DAYS = 30;
/** Sliding window: a session in daily use is extended at most once an hour. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;

type SessionCookie = {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  expires: Date;
};

export async function startSession(userId: string): Promise<SessionCookie> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + TTL_DAYS * 86_400_000);
  await query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [hash(token), userId, expires]);
  return cookieFor(token, expires);
}

export async function endSession(token: string): Promise<void> {
  if (token) await query("delete from sessions where token_hash = $1", [hash(token)]);
}

export function clearedCookie(): SessionCookie {
  return cookieFor("", new Date(0));
}

export function sessionToken(req: Request): string {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "";
}

/** The signed-in account for an API request, or null when the cookie is missing, unknown or expired. */
export function accountFromRequest(req: Request): Promise<User | null> {
  return accountFromToken(sessionToken(req));
}

/** The same lookup for server components, which read the cookie store instead of a Request. */
export async function accountFromCookies(): Promise<User | null> {
  const store = await cookies();
  return accountFromToken(store.get(SESSION_COOKIE)?.value ?? "");
}

export async function accountFromToken(token: string): Promise<User | null> {
  if (!token) return null;
  const row = await one<UserRow & { last_seen_at: Date }>(
    `select u.id, u.email, u.password_hash, u.daily_limit, u.disabled, u.admin, u.created_at, s.last_seen_at
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hash(token)],
  );
  if (!row) return null;
  if (Date.now() - row.last_seen_at.getTime() > TOUCH_AFTER_MS) {
    const expires = new Date(Date.now() + TTL_DAYS * 86_400_000);
    void query("update sessions set last_seen_at = now(), expires_at = $2 where token_hash = $1", [hash(token), expires]).catch(() => {});
  }
  return toUser(row);
}

/** Expired rows are harmless but pile up; clearing them is cheap enough to do on sign-in. */
export function pruneSessions(): void {
  void query("delete from sessions where expires_at < now()").catch(() => {});
}

function cookieFor(value: string, expires: Date): SessionCookie {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax",
    // The app is served over HTTPS in production; a plain-HTTP dev server would never see the cookie back.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
