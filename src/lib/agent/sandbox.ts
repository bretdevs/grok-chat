import { AuthenticationError, Sandbox } from "e2b";
import { OUT_DIR, UPLOAD_DIR, WORK_DIR } from "@/lib/sandbox-paths";
import type { UploadResult } from "@/lib/types";
import { errorText } from "@/lib/utils";
import { UpstreamError } from "@/lib/xai/client";
import { isImageFile } from "@/lib/xai/uploads";

export const SANDBOX_TIMEOUT_MS = 30 * 60_000;

export type SandboxSession = { sbx: Sandbox; replaced: boolean };

/** Resumes the conversation's sandbox (paused ones resume on connect) or starts a new one. */
export async function getSandbox(opts: { conversationId: string; sandboxId?: string; apiKey: string }): Promise<SandboxSession> {
  try {
    let sbx: Sandbox | undefined;
    let replaced = false;
    if (opts.sandboxId) {
      try {
        sbx = await Sandbox.connect(opts.sandboxId, { apiKey: opts.apiKey, timeoutMs: SANDBOX_TIMEOUT_MS });
      } catch (err) {
        if (isAuthError(err)) throw err;
        replaced = true; // killed, expired or unknown
      }
    }
    sbx ??= await createSandbox(opts.apiKey, opts.conversationId);
    await sbx.commands.run(`mkdir -p ${UPLOAD_DIR} ${WORK_DIR} ${OUT_DIR}`);
    await sbx.setTimeout(SANDBOX_TIMEOUT_MS);
    return { sbx, replaced };
  } catch (err) {
    throw e2bError(err);
  }
}

async function createSandbox(apiKey: string, conversationId: string): Promise<Sandbox> {
  const opts = {
    apiKey,
    timeoutMs: SANDBOX_TIMEOUT_MS,
    metadata: { conversationId, app: "grok-chat" },
    ...(process.env.E2B_TEMPLATE?.trim() ? { template: process.env.E2B_TEMPLATE.trim() } : {}),
  };
  try {
    // If this process dies before pausing, the sandbox pauses at its timeout instead of being deleted.
    return await Sandbox.create({ ...opts, lifecycle: { onTimeout: "pause" } });
  } catch (err) {
    if (isAuthError(err) || !/lifecycle|on_?timeout|auto.?pause/i.test(errorText(err))) throw err;
    return Sandbox.create(opts);
  }
}

/** Connects to an existing sandbox (resuming it if paused) without creating one. */
export async function connectSandbox(sandboxId: string, apiKey: string): Promise<Sandbox> {
  try {
    return await Sandbox.connect(sandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS });
  } catch (err) {
    throw e2bError(err);
  }
}

export async function pauseSandbox(sbx: Sandbox): Promise<void> {
  await sbx.pause();
}

/** Pauses a sandbox by id, e.g. one started for an upload whose turn never reached the server. */
export async function pauseSandboxById(sandboxId: string, apiKey: string): Promise<boolean> {
  try {
    return await Sandbox.pause(sandboxId, { apiKey });
  } catch (err) {
    throw e2bError(err);
  }
}

export async function killSandbox(sandboxId: string, apiKey: string): Promise<boolean> {
  try {
    return await Sandbox.kill(sandboxId, { apiKey });
  } catch (err) {
    throw e2bError(err);
  }
}

/** Agent mode uploads land on disk under /home/user/uploaded. */
export async function writeUploads(sbx: Sandbox, uploads: { file: File; key?: string }[]): Promise<UploadResult[]> {
  const used = new Set<string>();
  const results: UploadResult[] = [];
  for (const { file, key } of uploads) {
    const name = uniqueName(safeFileName(file.name), used);
    const path = `${UPLOAD_DIR}/${name}`;
    const base = { key, name: file.name, bytes: file.size, kind: isImageFile(file) ? ("image" as const) : ("file" as const) };
    try {
      await sbx.files.write(path, await file.arrayBuffer());
      results.push({ ...base, path });
    } catch (err) {
      results.push({ ...base, error: errorText(err) });
    }
  }
  return results;
}

export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^\w.\- ()+@]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-120);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "upload";
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; used.has(candidate); n++) candidate = `${stem} (${n})${ext}`;
  used.add(candidate);
  return candidate;
}

function isAuthError(err: unknown): boolean {
  return err instanceof AuthenticationError || /\b401\b|unauthori[sz]ed|invalid api key/i.test(errorText(err));
}

function e2bError(err: unknown): UpstreamError {
  if (err instanceof UpstreamError) return err;
  if (isAuthError(err)) return new UpstreamError("E2B rejected the API key. Check it in Settings.", 401, "e2b");
  return new UpstreamError(`E2B: ${errorText(err)}`, undefined, "e2b");
}
