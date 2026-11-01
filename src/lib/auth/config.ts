/**
 * Sign-in settings. Accounts need a database: with no DATABASE_URL the app stays as it was,
 * where every visitor brings their own key.
 */
export const DATABASE_URL = process.env.DATABASE_URL?.trim() || "";

export function authEnabled(): boolean {
  return Boolean(DATABASE_URL) && process.env.AUTH_REQUIRED?.trim().toLowerCase() !== "off";
}

/** The key signed-in accounts spend. A key the visitor added in Settings is used instead. */
export function serverApiKey(): string {
  return process.env.XAI_API_KEY?.trim() || "";
}

/** Off closes sign-up, so only accounts that already exist can get in. */
export function signupOpen(): boolean {
  return process.env.SIGNUP_OPEN?.trim().toLowerCase() !== "off";
}

/** When set, sign-up also asks for this code. */
export function signupCode(): string {
  return process.env.SIGNUP_CODE?.trim() || "";
}

/** Messages per account per day on the server key. 0 means no limit. */
export function defaultDailyLimit(): number {
  const n = Number(process.env.DAILY_MESSAGE_LIMIT);
  return Number.isInteger(n) && n >= 0 ? n : 50;
}

/** These addresses become admins when they sign up; so does the very first account. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAIL ?? "")
    .split(/[,\s]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
