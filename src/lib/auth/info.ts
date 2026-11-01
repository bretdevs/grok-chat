import type { AuthAccount, AuthInfo } from "@/lib/types";
import { authEnabled, serverApiKey, signupCode, signupOpen } from "./config";
import { databaseReady } from "./db";
import { accountFromCookies, accountFromRequest } from "./session";
import { limitFor, usageToday } from "./usage";
import type { User } from "./users";

/**
 * What the browser is told about sign-in: whether it is required, whether this server can pay for
 * replies, and who is signed in. Never includes a key or a password hash.
 */
export async function authInfo(req?: Request): Promise<AuthInfo> {
  const base = settings();
  if (!base.required) return base;
  try {
    const user = req ? await accountFromRequest(req) : await accountFromCookies();
    return { ...base, account: user ? await accountOf(user) : null };
  } catch {
    return { ...base, ready: await databaseReady() };
  }
}

/** The same answer for an account that has just signed in, whose cookie is not on the request yet. */
export async function authInfoFor(user: User): Promise<AuthInfo> {
  return { ...settings(), account: await accountOf(user) };
}

function settings(): AuthInfo {
  return {
    required: authEnabled(),
    ready: true,
    serverKey: Boolean(serverApiKey()),
    openSignup: signupOpen(),
    needsCode: Boolean(signupCode()),
    account: null,
  };
}

async function accountOf(user: User): Promise<AuthAccount> {
  const used = await usageToday(user.id).catch(() => ({ messages: 0, inputTokens: 0, outputTokens: 0 }));
  return {
    email: user.email,
    admin: user.admin,
    dailyLimit: limitFor(user),
    usedToday: used.messages,
  };
}
