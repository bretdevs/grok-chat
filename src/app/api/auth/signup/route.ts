import { cookies } from "next/headers";
import { authEnabled, signupCode, signupOpen } from "@/lib/auth/config";
import { authInfoFor } from "@/lib/auth/info";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { clientIp, tooMany } from "@/lib/auth/rate-limit";
import { pruneSessions, startSession } from "@/lib/auth/session";
import { createUser, EmailTakenError, normalizeEmail, validEmail } from "@/lib/auth/users";
import { readCredentials, fail } from "../credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!authEnabled()) return fail(404, "This server does not have accounts.");
  if (!signupOpen()) return fail(403, "Sign-up is closed. Ask the owner for an account.");
  if (tooMany(`signup:${clientIp(req)}`, 5)) return fail(429, "Too many sign-ups from here. Wait a few minutes.");

  const body = await readCredentials(req);
  if (!body.ok) return fail(400, body.message);
  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return fail(400, "That email address does not look right.");
  if (body.password.length < MIN_PASSWORD_LENGTH) return fail(400, `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  const required = signupCode();
  if (required && body.code !== required) return fail(403, "That invite code is not right.");

  try {
    const user = await createUser(email, body.password);
    pruneSessions();
    (await cookies()).set(await startSession(user.id));
    return Response.json(await authInfoFor(user));
  } catch (err) {
    if (err instanceof EmailTakenError) return fail(409, err.message);
    return fail(503, "Accounts are unavailable right now. Try again in a moment.");
  }
}
