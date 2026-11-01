import { authEnabled, serverApiKey } from "./config";
import { accountFromRequest } from "./session";
import { claimMessage, limitFor } from "./usage";
import type { User } from "./users";

export type Allowed = {
  ok: true;
  /** null when this server has no accounts, where everyone brings their own key. */
  user: User | null;
  apiKey: string;
  /** The request spends the server's key, so it counts against the account's allowance. */
  metered: boolean;
};
export type Denied = { ok: false; status: number; message: string; code?: string };
export type Decision = Allowed | Denied;

/**
 * Who may make this request and whose key pays for it. A key the visitor added in Settings always
 * wins, so a signed-in account with its own key is not metered.
 */
export async function authorize(req: Request, providedKey: string): Promise<Decision> {
  const apiKey = providedKey || serverApiKey();
  if (!authEnabled()) return apiKey ? { ok: true, user: null, apiKey, metered: false } : missingKey();

  const account = await signedIn(req);
  if (!account.ok) return account;
  if (!apiKey) return missingKey();
  return { ok: true, user: account.user, apiKey, metered: !providedKey };
}

/** For routes that need a signed-in account but no model key, such as the sandbox ones. */
export async function requireAccount(req: Request): Promise<Denied | null> {
  if (!authEnabled()) return null;
  const account = await signedIn(req);
  return account.ok ? null : account;
}

/** Spends one message of today's allowance, or says that the account has run out. */
export async function claim(decision: Allowed): Promise<Denied | null> {
  if (!decision.metered || !decision.user) return null;
  const limit = limitFor(decision.user);
  if (limit <= 0) return null;
  const { ok } = await claimMessage(decision.user.id, limit);
  if (ok) return null;
  return {
    ok: false,
    status: 429,
    message: `You have used today's ${limit} messages. The count resets at midnight UTC, or add your own API key in Settings to keep going.`,
    code: "quota_reached",
  };
}

async function signedIn(req: Request): Promise<{ ok: true; user: User } | Denied> {
  let user: User | null;
  try {
    user = await accountFromRequest(req);
  } catch {
    return { ok: false, status: 503, message: "Sign-in is unavailable right now. Try again in a moment.", code: "auth_unavailable" };
  }
  if (!user) return { ok: false, status: 401, message: "Sign in to use this app.", code: "signin_required" };
  if (user.disabled) return { ok: false, status: 403, message: "This account has been turned off.", code: "account_disabled" };
  return { ok: true, user };
}

function missingKey(): Denied {
  return { ok: false, status: 401, message: "Missing xAI API key. Add it in Settings.", code: "xai_key_missing" };
}
