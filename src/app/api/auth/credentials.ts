/** Shared request parsing for the sign-in routes. */

export type Credentials = { ok: true; email: string; password: string; code: string } | { ok: false; message: string };

const MAX_FIELD = 400;

export async function readCredentials(req: Request): Promise<Credentials> {
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return { ok: false, message: "Send an email address and a password." };
  const { email, password, code } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") return { ok: false, message: "Send an email address and a password." };
  if (email.length > MAX_FIELD || password.length > MAX_FIELD) return { ok: false, message: "That is too long." };
  if (!email.trim() || !password) return { ok: false, message: "Fill in both fields." };
  return { ok: true, email, password, code: typeof code === "string" ? code.trim().slice(0, MAX_FIELD) : "" };
}

export function fail(status: number, message: string, code?: string) {
  return Response.json({ error: { message, code } }, { status });
}
