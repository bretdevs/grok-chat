import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { runAgent } from "@/lib/agent/loop";
import { UPLOAD_DIR } from "@/lib/sandbox-paths";
import { createEventStream } from "@/lib/sse";
import { DEFAULT_MODEL, MAX_XAI_FILE_BYTES, type ApiMessage } from "@/lib/types";
import { runAsk } from "@/lib/xai/ask";
import type { BuiltinOptions } from "@/lib/xai/builtin-tools";
import { createXai, describeError } from "@/lib/xai/client";
import type { TurnContext, TurnSettings } from "@/lib/xai/turn";

export const runtime = "nodejs";
export const maxDuration = 300;

const ID = /^[\w.:-]{1,200}$/;
const MODEL = /^[\w.:/-]{1,80}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IMAGE_URL = /^(data:image\/(png|jpe?g|webp|gif);base64,|https:\/\/)/i;
const MAX_CHAT_REQUEST_BYTES = 64 * 1024 * 1024;

/**
 * POST multipart/form-data. The xAI key (and optional E2B key) is used for this request only;
 * it is never logged or stored. Replies stream back as server-sent events.
 */
export async function POST(req: Request) {
  // Big documents go through /api/upload first; this request only carries text and small files.
  if (Number(req.headers.get("content-length")) > MAX_CHAT_REQUEST_BYTES) {
    return fail(413, "This request is too large. Large files are uploaded separately through /api/upload.");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "Send the request as multipart/form-data.");
  }
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };

  const apiKey = field("apiKey");
  if (!apiKey) return fail(401, "Missing xAI API key. Add it in Settings.", "xai_key_missing");

  let messages: ApiMessage[];
  try {
    messages = parseMessages(field("messages"));
  } catch (err) {
    return fail(400, (err as Error).message);
  }
  const current = messages.at(-1);
  if (!current || current.role !== "user") return fail(400, "messages must end with a user message.");

  const files = form.getAll("files").filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
  const keys = form.getAll("fileKeys").map((v) => (typeof v === "string" ? v : undefined));
  const tooBig = files.find((f) => f.size > MAX_XAI_FILE_BYTES);
  if (tooBig) return fail(413, `${tooBig.name} is larger than 50 MB.`);
  if (!current.content.trim() && !files.length && !current.fileIds?.length && !current.images?.length) {
    return fail(400, "The message is empty.");
  }

  const agent = field("agent") === "1";
  const e2bKey = agent ? field("e2bKey") || process.env.E2B_API_KEY?.trim() || "" : "";
  if (agent && !e2bKey) {
    return fail(400, "Agent mode needs an E2B API key. Add one in Settings (e2b.dev) or set E2B_API_KEY on the server.", "e2b_key_missing");
  }

  const conversationId = pick(field("conversationId"), ID) ?? randomUUID();
  const settings: TurnSettings = {
    temperature: numberIn(field("temperature"), 0, 2),
    topP: numberIn(field("topP"), 0, 1),
    extraInstructions: field("extraInstructions").slice(0, 8000) || undefined,
    submitResult: field("submitResult") !== "0",
    networkRetry: field("networkRetry") !== "0",
  };

  const abort = new AbortController();
  req.signal?.addEventListener("abort", () => abort.abort(), { once: true });
  const sse = createEventStream(() => abort.abort());
  const heartbeat = setInterval(() => sse.ping(), 15_000);

  const ctx: TurnContext = {
    client: createXai(apiKey, conversationId),
    model: pick(field("model"), MODEL) ?? DEFAULT_MODEL,
    conversationId,
    history: messages.slice(0, -1),
    current,
    uploads: files.map((file, i) => ({ file, key: keys[i] })),
    previousResponseId: pick(field("previousResponseId"), ID),
    clientPromptVersion: field("promptVersion") || undefined,
    openCallIds: parseIds(field("openCallIds")),
    search: parseSearch(field),
    settings,
    signal: abort.signal,
    sse,
  };

  const task = (agent ? runAgent({ ...ctx, e2bKey, sandboxId: pick(field("sandboxId"), ID), sandboxFiles: parseSandboxFiles(field("sandboxFiles")) }) : runAsk(ctx))
    .catch((err) => sse.send({ type: "error", ...describeError(err) }))
    .finally(() => {
      clearInterval(heartbeat);
      sse.close();
    });
  // Keep the function alive until the turn finishes (and the sandbox is paused), even if the browser left.
  after(() => task);

  return new Response(sse.stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function fail(status: number, message: string, code?: string) {
  return Response.json({ error: { message, code } }, { status });
}

function pick(value: string, pattern: RegExp): string | undefined {
  return value && pattern.test(value) ? value : undefined;
}

function numberIn(value: string, min: number, max: number): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

function parseIds(raw: string): string[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && ID.test(id)).slice(0, 20) : [];
  } catch {
    return [];
  }
}

/** Files the browser already put in the sandbox; only paths under /home/user/uploaded are accepted. */
function parseSandboxFiles(raw: string): { path: string; bytes: number }[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((f): f is { path: string; bytes: number } => {
        const item = f as { path?: unknown; bytes?: unknown };
        return typeof item?.path === "string" && typeof item.bytes === "number" && item.bytes >= 0;
      })
      .filter((f) => f.path.startsWith(`${UPLOAD_DIR}/`) && !f.path.includes("/..") && !/[\n\r]/.test(f.path))
      .slice(0, 20)
      .map((f) => ({ path: f.path, bytes: Math.floor(f.bytes) }));
  } catch {
    return [];
  }
}

/** Search defaults to on when the field is absent; web and X default on, code interpreter off. */
function parseSearch(field: (name: string) => string): BuiltinOptions | null {
  if (field("search") === "0") return null;
  const options: BuiltinOptions = {
    web: field("web") !== "0",
    x: field("x") !== "0",
    code: field("code") === "1",
    xFrom: DATE.test(field("xFrom")) ? field("xFrom") : undefined,
    xTo: DATE.test(field("xTo")) ? field("xTo") : undefined,
  };
  return options.web || options.x || options.code ? options : null;
}

function parseMessages(raw: string): ApiMessage[] {
  let data: unknown;
  try {
    data = JSON.parse(raw || "[]");
  } catch {
    throw new Error("messages must be a JSON array.");
  }
  if (!Array.isArray(data)) throw new Error("messages must be a JSON array.");
  const strings = (v: unknown, test: (s: string) => boolean, max: number) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && test(s)).slice(0, max) : [];
  return data.slice(-400).flatMap((m): ApiMessage[] => {
    if (!m || typeof m !== "object") return [];
    const item = m as Record<string, unknown>;
    const role = item.role === "assistant" ? "assistant" : "user";
    const content = typeof item.content === "string" ? item.content : "";
    const fileIds = strings(item.fileIds, (s) => ID.test(s), 20);
    const images = role === "user" ? strings(item.images, (s) => IMAGE_URL.test(s), 10) : [];
    if (!content && !fileIds.length && !images.length) return [];
    return [{ role, content, ...(fileIds.length ? { fileIds } : {}), ...(images.length ? { images } : {}) }];
  });
}
