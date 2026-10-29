import { readEvents } from "@/lib/sse";
import type { ApiMessage, ErrorSource, StreamEvent, UploadLimits } from "@/lib/types";

export type ChatRequest = {
  apiKey: string;
  e2bKey?: string;
  model: string;
  conversationId: string;
  agent: boolean;
  sandboxId?: string;
  search: { on: boolean; web: boolean; x: boolean; code: boolean; xFrom?: string; xTo?: string };
  temperature: number;
  topP: number;
  extraInstructions?: string;
  submitResult: boolean;
  networkRetry: boolean;
  messages: ApiMessage[];
  files: { key: string; blob: Blob; name: string }[];
  /** Agent mode: files already uploaded into the sandbox for this turn. */
  sandboxFiles?: { path: string; bytes: number }[];
  previous?: { responseId: string; promptVersion: string; openCallIds?: string[] };
  signal: AbortSignal;
};

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly source: ErrorSource = "server",
  ) {
    super(message);
    this.name = "RequestError";
  }
}

/** POSTs a turn to /api/chat and yields its server-sent events. */
export async function* streamChat(r: ChatRequest): AsyncGenerator<StreamEvent> {
  const form = new FormData();
  form.set("apiKey", r.apiKey);
  form.set("model", r.model);
  form.set("conversationId", r.conversationId);
  form.set("messages", JSON.stringify(r.messages));
  form.set("agent", r.agent ? "1" : "0");
  if (r.agent && r.e2bKey) form.set("e2bKey", r.e2bKey);
  if (r.agent && r.sandboxId) form.set("sandboxId", r.sandboxId);
  if (r.agent && r.sandboxFiles?.length) form.set("sandboxFiles", JSON.stringify(r.sandboxFiles));
  form.set("search", r.search.on ? "1" : "0");
  form.set("web", r.search.web ? "1" : "0");
  form.set("x", r.search.x ? "1" : "0");
  form.set("code", r.search.code ? "1" : "0");
  if (r.search.xFrom) form.set("xFrom", r.search.xFrom);
  if (r.search.xTo) form.set("xTo", r.search.xTo);
  form.set("temperature", String(r.temperature));
  form.set("topP", String(r.topP));
  if (r.extraInstructions) form.set("extraInstructions", r.extraInstructions);
  form.set("submitResult", r.submitResult ? "1" : "0");
  form.set("networkRetry", r.networkRetry ? "1" : "0");
  if (r.previous) {
    form.set("previousResponseId", r.previous.responseId);
    form.set("promptVersion", r.previous.promptVersion);
    if (r.previous.openCallIds?.length) form.set("openCallIds", JSON.stringify(r.previous.openCallIds));
  }
  for (const f of r.files) {
    form.append("fileKeys", f.key);
    form.append("files", f.blob, f.name);
  }

  let res: Response;
  try {
    res = await fetch("/api/chat", { method: "POST", body: form, signal: r.signal });
  } catch (err) {
    if (r.signal.aborted) throw err;
    throw new RequestError("Couldn't reach the server. Check your connection.", 0);
  }
  if (!res.ok || !res.body) throw await httpError(res);
  yield* readEvents(res.body);
}

async function httpError(res: Response): Promise<RequestError> {
  const raw = await res.text().catch(() => "");
  let message = "";
  let code = "";
  try {
    const body = JSON.parse(raw) as { error?: { message?: string; code?: string } };
    message = body.error?.message ?? "";
    code = body.error?.code ?? "";
  } catch {
    // not JSON, e.g. a hosting platform error page
  }
  if (res.status === 413 || /PAYLOAD_TOO_LARGE/.test(raw)) {
    return new RequestError(
      "This upload is larger than the server accepts. Vercel caps request bodies at 4.5 MB, so use smaller files or run the app with next start.",
      413,
    );
  }
  if (res.status === 504 || /FUNCTION_INVOCATION_TIMEOUT/.test(raw)) {
    return new RequestError("The server timed out. Long agent jobs need a long-running Node server (see README).", 504);
  }
  const source: ErrorSource = code === "e2b_key_missing" ? "e2b" : code === "xai_key_missing" ? "xai" : "server";
  return new RequestError(message || `Request failed (${res.status}).`, res.status, source);
}

export const killSandbox = (sandboxId: string, e2bKey?: string) => sandboxAction("kill", sandboxId, e2bKey);
export const pauseSandbox = (sandboxId: string, e2bKey?: string) => sandboxAction("pause", sandboxId, e2bKey);

async function sandboxAction(action: "kill" | "pause", sandboxId: string, e2bKey?: string): Promise<void> {
  const res = await fetch("/api/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, sandboxId, e2bKey }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
}

export async function fetchServerConfig(): Promise<{ e2bServerKey: boolean; uploads?: UploadLimits }> {
  const res = await fetch("/api/config", { cache: "no-store" });
  if (!res.ok) return { e2bServerKey: false };
  return (await res.json()) as { e2bServerKey: boolean; uploads?: UploadLimits };
}
