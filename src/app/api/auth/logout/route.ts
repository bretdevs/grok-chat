import { cookies } from "next/headers";
import { clearedCookie, endSession, sessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = sessionToken(req);
  // The cookie goes either way, so a signed-out browser never keeps a stale session.
  await endSession(token).catch(() => {});
  (await cookies()).set(clearedCookie());
  return Response.json({ ok: true });
}
