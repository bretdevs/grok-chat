import type { ErrorSource } from "@/lib/types";
import { uid } from "@/lib/utils";
import { RequestError } from "./api";

type Progress = (fraction: number) => void;

const PARALLEL_CHUNKS = 3;

/** What /api/upload?target=xai returns: a file id, or the document's text when the endpoint has no Files API. */
export type XaiUpload = { bytes: number; fileId?: string; text?: string };

/** Ask mode: one document to the xAI Files API through /api/upload, with upload progress. */
export function uploadToXai(blob: Blob, name: string, opts: { apiKey: string; signal: AbortSignal; onProgress: Progress }): Promise<XaiUpload> {
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload?target=xai");
    // Left out when the visitor has no key of their own, so the server uses the one it pays with.
    if (opts.apiKey) xhr.setRequestHeader("x-xai-key", opts.apiKey);
    xhr.setRequestHeader("x-file-name", encodeURIComponent(name));
    xhr.setRequestHeader("content-type", blob.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = parse(xhr.responseText);
      const ok = typeof body?.fileId === "string" || typeof body?.text === "string";
      if (xhr.status >= 200 && xhr.status < 300 && ok) resolve(body as XaiUpload);
      else reject(toError(xhr.status, body));
    };
    xhr.onerror = () => reject(new RequestError(`Uploading ${name} failed. Check your connection.`, 0));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/** Agent mode: makes sure the conversation's sandbox is running and returns its id. */
export async function beginSandboxUpload(opts: { e2bKey?: string; conversationId: string; sandboxId?: string; signal: AbortSignal }): Promise<{ sandboxId: string; replaced: boolean }> {
  const res = await fetch("/api/upload?target=sandbox&step=begin", {
    method: "POST",
    headers: headers(opts.e2bKey, "application/json"),
    body: JSON.stringify({ conversationId: opts.conversationId, sandboxId: opts.sandboxId }),
    signal: opts.signal,
  });
  return (await readJson(res)) as { sandboxId: string; replaced: boolean };
}

/** Agent mode: sends a file into the sandbox in chunks, a few at a time, then assembles it. */
export async function uploadToSandbox(
  blob: Blob,
  name: string,
  opts: { e2bKey?: string; sandboxId: string; chunkBytes: number; signal: AbortSignal; onProgress: Progress },
): Promise<{ path: string; bytes: number }> {
  const uploadId = uid();
  const total = Math.max(1, Math.ceil(blob.size / opts.chunkBytes));
  const stop = new AbortController();
  const forward = () => stop.abort();
  opts.signal.addEventListener("abort", forward, { once: true });
  let next = 0;
  let sent = 0;

  const sendChunk = async (index: number) => {
    const body = blob.slice(index * opts.chunkBytes, Math.min(blob.size, (index + 1) * opts.chunkBytes));
    const query = new URLSearchParams({
      target: "sandbox",
      step: "chunk",
      sandboxId: opts.sandboxId,
      uploadId,
      index: String(index),
      // The server places each chunk at index * chunkBytes, so it must use the same size as here.
      chunkBytes: String(opts.chunkBytes),
    });
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`/api/upload?${query}`, { method: "POST", headers: headers(opts.e2bKey, "application/octet-stream"), body, signal: stop.signal });
        await readJson(res);
        sent += body.size;
        opts.onProgress(sent / blob.size);
        return;
      } catch (err) {
        // One retry for a dropped connection or a 5xx; anything else (or Stop) ends the upload.
        const transient = !stop.signal.aborted && (!(err instanceof RequestError) || err.status === 0 || err.status >= 500);
        if (attempt >= 1 || !transient) throw err;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL_CHUNKS, total) }, async () => {
        while (next < total && !stop.signal.aborted) await sendChunk(next++);
      }),
    );
    const res = await fetch("/api/upload?target=sandbox&step=complete", {
      method: "POST",
      headers: headers(opts.e2bKey, "application/json"),
      body: JSON.stringify({ sandboxId: opts.sandboxId, uploadId, name, size: blob.size }),
      signal: opts.signal,
    });
    return (await readJson(res)) as { path: string; bytes: number };
  } catch (err) {
    stop.abort();
    await cancelSandboxUpload(opts, uploadId);
    throw err;
  } finally {
    opts.signal.removeEventListener("abort", forward);
  }
}

/** Removes a partial upload from the sandbox disk. Best effort: stale parts are also swept at the next upload. */
async function cancelSandboxUpload(opts: { e2bKey?: string; sandboxId: string }, uploadId: string): Promise<void> {
  try {
    await fetch("/api/upload?target=sandbox&step=cancel", {
      method: "POST",
      headers: headers(opts.e2bKey, "application/json"),
      body: JSON.stringify({ sandboxId: opts.sandboxId, uploadId }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // ignore; see above
  }
}

function headers(e2bKey: string | undefined, contentType: string): Record<string, string> {
  return { "content-type": contentType, ...(e2bKey ? { "x-e2b-key": e2bKey } : {}) };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const body = parse(await res.text().catch(() => ""));
  if (!res.ok || !body) throw toError(res.status, body);
  return body;
}

function parse(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toError(status: number, body: Record<string, unknown> | null): RequestError {
  const error = (body?.error ?? {}) as { message?: string; source?: ErrorSource };
  if (status === 413 && !error.message) return new RequestError("The file is larger than this server accepts.", 413);
  return new RequestError(error.message || `Upload failed (${status}).`, status, error.source ?? "server");
}
