import { connectSandbox, getSandbox } from "@/lib/agent/sandbox";
import { cancelSandboxUpload, finishSandboxUpload, prepareSandboxUploads, writeSandboxChunk } from "@/lib/agent/uploads";
import { serverApiKey } from "@/lib/auth/config";
import { requireAccount } from "@/lib/auth/gate";
import { mimeFromName } from "@/lib/mime";
import type { ErrorSource } from "@/lib/types";
import { uploadLimits } from "@/lib/upload-limits";
import { formatBytes } from "@/lib/utils";
import { createXai, describeError } from "@/lib/xai/client";
import { prepareDocument } from "@/lib/xai/uploads";

export const runtime = "nodejs";
export const maxDuration = 300;

const ID = /^[\w-]{1,128}$/;
const MIN_CHUNK_BYTES = 256 * 1024;

/**
 * Uploads that happen before a chat turn, one file per request so the server never holds more
 * than one document (Ask) or one chunk (Agent) in memory. Keys come in headers, never in the URL.
 *
 *   POST ?target=xai                     raw file body          -> { fileId, bytes }, or { text, bytes } when the
 *                                                                  endpoint has no Files API (send the text inline)
 *   POST ?target=sandbox&step=begin      { conversationId, sandboxId? } -> { sandboxId, replaced }
 *   POST ?target=sandbox&step=chunk&sandboxId=&uploadId=&index=&chunkBytes=   raw chunk body -> { ok }
 *   POST ?target=sandbox&step=complete   { sandboxId, uploadId, name, size } -> { path, bytes }
 *   POST ?target=sandbox&step=cancel     { sandboxId, uploadId } -> { ok }
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("target");
  const step = url.searchParams.get("step");
  try {
    const denied = await requireAccount(req);
    if (denied) return fail(denied.status, denied.message, denied.code === "xai_key_missing" ? "xai" : "server");
    if (target === "xai") return await toXai(req);
    if (target === "sandbox" && step === "begin") return await begin(req);
    if (target === "sandbox" && step === "chunk") return await chunk(req, url);
    if (target === "sandbox" && step === "complete") return await complete(req);
    if (target === "sandbox" && step === "cancel") return await cancel(req);
    return fail(400, "Unknown upload step.");
  } catch (err) {
    const { message, status, source } = describeError(err);
    return fail(status && status >= 400 && status < 600 ? status : 502, message, source);
  }
}

async function toXai(req: Request) {
  // The visitor's own key if they added one, otherwise the key this server pays with.
  const apiKey = req.headers.get("x-xai-key")?.trim() || serverApiKey();
  if (!apiKey) return fail(401, "Missing xAI API key. Add it in Settings.", "xai");
  const { xaiFileBytes } = uploadLimits();
  if (declaredSize(req) > xaiFileBytes) return fail(413, `xAI accepts documents up to ${formatBytes(xaiFileBytes)}.`);
  const name = decodeName(req.headers.get("x-file-name"));
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) return fail(400, "The file is empty.");
  if (bytes.byteLength > xaiFileBytes) return fail(413, `xAI accepts documents up to ${formatBytes(xaiFileBytes)}.`);
  const fromName = mimeFromName(name);
  const type = fromName !== "application/octet-stream" ? fromName : req.headers.get("content-type") || fromName;
  const doc = await prepareDocument(createXai(apiKey, "upload"), new File([bytes], name, { type }), req.signal, 2);
  return Response.json({ ...doc, bytes: bytes.byteLength });
}

async function begin(req: Request) {
  const apiKey = e2bKey(req);
  if (!apiKey) return missingE2bKey();
  const body = (await req.json().catch(() => ({}))) as { conversationId?: unknown; sandboxId?: unknown };
  const conversationId = typeof body.conversationId === "string" && ID.test(body.conversationId) ? body.conversationId : "upload";
  const sandboxId = typeof body.sandboxId === "string" && ID.test(body.sandboxId) ? body.sandboxId : undefined;
  const { sbx, replaced } = await getSandbox({ conversationId, sandboxId, apiKey });
  await prepareSandboxUploads(sbx);
  return Response.json({ sandboxId: sbx.sandboxId, replaced });
}

async function chunk(req: Request, url: URL) {
  const apiKey = e2bKey(req);
  if (!apiKey) return missingE2bKey();
  const { sandboxFileBytes } = uploadLimits();
  const sandboxId = url.searchParams.get("sandboxId") ?? "";
  const uploadId = url.searchParams.get("uploadId") ?? "";
  const index = Number(url.searchParams.get("index"));
  // The browser's chunk size, which sets each chunk's offset; it may be below this server's maximum.
  const chunkBytes = Number(url.searchParams.get("chunkBytes"));
  if (!ID.test(sandboxId) || !ID.test(uploadId)) return fail(400, "sandboxId and uploadId are required.");
  if (!Number.isInteger(chunkBytes) || chunkBytes < MIN_CHUNK_BYTES || chunkBytes > uploadLimits().chunkBytes) {
    return fail(400, `chunkBytes must be between ${formatBytes(MIN_CHUNK_BYTES)} and ${formatBytes(uploadLimits().chunkBytes)}.`);
  }
  if (!Number.isInteger(index) || index < 0 || index * chunkBytes >= sandboxFileBytes) return fail(400, "Bad chunk index.");
  if (declaredSize(req) > chunkBytes) return fail(413, `Chunks can be at most ${formatBytes(chunkBytes)}.`);
  const data = await req.arrayBuffer();
  if (!data.byteLength || data.byteLength > chunkBytes) return fail(400, "Bad chunk size.");
  const sbx = await connectSandbox(sandboxId, apiKey);
  await writeSandboxChunk(sbx, uploadId, index, chunkBytes, data);
  return Response.json({ ok: true });
}

async function complete(req: Request) {
  const apiKey = e2bKey(req);
  if (!apiKey) return missingE2bKey();
  const body = (await req.json().catch(() => ({}))) as { sandboxId?: unknown; uploadId?: unknown; name?: unknown; size?: unknown };
  const { sandboxFileBytes } = uploadLimits();
  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : "";
  const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
  const size = typeof body.size === "number" ? body.size : NaN;
  if (!ID.test(sandboxId) || !ID.test(uploadId) || typeof body.name !== "string") return fail(400, "sandboxId, uploadId and name are required.");
  if (!Number.isInteger(size) || size <= 0 || size > sandboxFileBytes) return fail(413, `Sandbox uploads can be at most ${formatBytes(sandboxFileBytes)}.`);
  const sbx = await connectSandbox(sandboxId, apiKey);
  return Response.json(await finishSandboxUpload(sbx, uploadId, body.name, size));
}

async function cancel(req: Request) {
  const apiKey = e2bKey(req);
  if (!apiKey) return missingE2bKey();
  const body = (await req.json().catch(() => ({}))) as { sandboxId?: unknown; uploadId?: unknown };
  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : "";
  const uploadId = typeof body.uploadId === "string" ? body.uploadId : "";
  if (!ID.test(sandboxId) || !ID.test(uploadId)) return fail(400, "sandboxId and uploadId are required.");
  await cancelSandboxUpload(await connectSandbox(sandboxId, apiKey), uploadId);
  return Response.json({ ok: true });
}

function e2bKey(req: Request): string {
  return req.headers.get("x-e2b-key")?.trim() || process.env.E2B_API_KEY?.trim() || "";
}

function missingE2bKey() {
  return fail(400, "Agent mode needs an E2B API key. Add one in Settings (e2b.dev) or set E2B_API_KEY on the server.", "e2b");
}

function declaredSize(req: Request): number {
  const n = Number(req.headers.get("content-length"));
  return Number.isFinite(n) ? n : 0;
}

function decodeName(raw: string | null): string {
  try {
    return decodeURIComponent(raw ?? "").replace(/[\\/]/g, "_").slice(-180) || "upload";
  } catch {
    return "upload";
  }
}

function fail(status: number, message: string, source: ErrorSource = "server") {
  return Response.json({ error: { message, source } }, { status });
}
