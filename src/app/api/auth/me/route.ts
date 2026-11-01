import { authInfo } from "@/lib/auth/info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sign-in state and today's usage for the signed-in account. */
export async function GET(req: Request) {
  return Response.json(await authInfo(req));
}
