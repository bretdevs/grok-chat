import { authEnabled } from "@/lib/auth/config";
import { accountFromRequest } from "@/lib/auth/session";
import { listUsers, setDailyLimit, setDisabled } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Accounts on this server, for the admin screen. GET lists them; POST turns one off or changes its allowance. */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  return Response.json({ users: await listUsers() });
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const body = (await req.json().catch(() => ({}))) as { userId?: unknown; disabled?: unknown; dailyLimit?: unknown };
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return fail(400, "userId is required.");

  if (typeof body.disabled === "boolean") {
    if (userId === admin.id && body.disabled) return fail(400, "You cannot turn off your own account.");
    await setDisabled(userId, body.disabled);
  }
  if (body.dailyLimit === null || typeof body.dailyLimit === "number") {
    const limit = body.dailyLimit === null ? null : Math.max(0, Math.floor(body.dailyLimit));
    if (limit !== null && limit > 100_000) return fail(400, "That daily limit is too high.");
    await setDailyLimit(userId, limit);
  }
  return Response.json({ users: await listUsers() });
}

async function requireAdmin(req: Request) {
  if (!authEnabled()) return fail(404, "This server does not have accounts.");
  const user = await accountFromRequest(req).catch(() => null);
  if (!user) return fail(401, "Sign in first.");
  // Non-admins are told the same thing as strangers, so the screen is not advertised.
  if (!user.admin || user.disabled) return fail(404, "Not found.");
  return user;
}

function fail(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}
