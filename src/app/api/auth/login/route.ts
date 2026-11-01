import { cookies } from "next/headers";
import { authEnabled } from "@/lib/auth/config";
import { authInfoFor } from "@/lib/auth/info";
import { verifyPassword } from "@/lib/auth/password";
import { clientIp, forget, tooMany } from "@/lib/auth/rate-limit";
import { pruneSessions, startSession } from "@/lib/auth/session";
import { findByEmail, normalizeEmail, toUser } from "@/lib/auth/users";
import { readCredentials, fail } from "../credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!authEnabled()) return fail(404, "This server does not have accounts.");
  const ip = clientIp(req);
  if (tooMany(`login:${ip}`, 10)) return fail(429, "Too many sign-in attempts. Wait a few minutes.");

  const body = await readCredentials(req);
  if (!body.ok) return fail(400, body.message);
  const email = normalizeEmail(body.email);

  try {
    const row = await findByEmail(email);
    // The same answer either way, so the form does not reveal which addresses have accounts.
    if (!row || !(await verifyPassword(body.password, row.password_hash))) {
      return fail(401, "That email and password do not match.");
    }
    if (row.disabled) return fail(403, "This account has been turned off.");
    forget(`login:${ip}`);
    pruneSessions();
    (await cookies()).set(await startSession(row.id));
    return Response.json(await authInfoFor(toUser(row)));
  } catch {
    return fail(503, "Sign-in is unavailable right now. Try again in a moment.");
  }
}
