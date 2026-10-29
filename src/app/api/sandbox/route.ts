import { killSandbox, pauseSandboxById } from "@/lib/agent/sandbox";
import { describeError } from "@/lib/xai/client";

export const runtime = "nodejs";

/** POST { action: "kill" | "pause", sandboxId, e2bKey? } destroys or pauses a conversation's sandbox. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { action?: unknown; sandboxId?: unknown; e2bKey?: unknown } | null;
  const sandboxId = typeof body?.sandboxId === "string" ? body.sandboxId.trim() : "";
  if (!/^[\w-]{1,128}$/.test(sandboxId)) return Response.json({ error: { message: "sandboxId is required." } }, { status: 400 });
  const action = body?.action;
  if (action !== "kill" && action !== "pause") return Response.json({ error: { message: "Unknown action." } }, { status: 400 });
  const apiKey = (typeof body?.e2bKey === "string" && body.e2bKey.trim()) || process.env.E2B_API_KEY?.trim();
  if (!apiKey) return Response.json({ error: { message: "No E2B API key." } }, { status: 400 });
  try {
    if (action === "pause") return Response.json({ ok: true, paused: await pauseSandboxById(sandboxId, apiKey) });
    return Response.json({ ok: true, killed: await killSandbox(sandboxId, apiKey) });
  } catch (err) {
    const { message, status } = describeError(err);
    return Response.json({ error: { message } }, { status: status === 401 ? 401 : 502 });
  }
}
