export const MODELS = ["grok-4.7", "grok-4.6", "grok-4.5"] as const;
export const DEFAULT_MODEL = "grok-4.7";

/** xAI Files API limit for one document (Ask mode). */
export const MAX_XAI_FILE_BYTES = 50 * 1024 * 1024;
/** Agent mode uploads go to the sandbox disk in chunks, so they can be much larger. */
export const MAX_SANDBOX_FILE_BYTES = 1024 * 1024 * 1024;
export const XAI_FILE_TTL_SECONDS = 86_400;

/** Upload sizes the server accepts, from GET /api/config. */
export type UploadLimits = {
  /** Bytes per chunk for sandbox uploads (smaller on Vercel, which caps request bodies at 4.5 MB). */
  chunkBytes: number;
  /** Largest single request body this host accepts. */
  maxRequestBytes: number;
  xaiFileBytes: number;
  sandboxFileBytes: number;
};
export const MAX_CONVERSATIONS = 30;
export const MAX_MESSAGES = 200;

export type Role = "user" | "assistant";

/** One turn as sent to /api/chat in the `messages` form field. */
export type ApiMessage = {
  role: Role;
  content: string;
  fileIds?: string[];
  images?: string[];
};

export type Usage = { input: number; output: number; cached: number; reasoning: number };

export type Attachment = {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: "image" | "file";
  /** xAI Files API id (Ask mode documents). */
  fileId?: string;
  /** When the xAI upload happened, for the 24h expiry. */
  uploadedAt?: number;
  /** Where the upload landed in the sandbox (Agent mode). */
  sandboxPath?: string;
};

export type SearchProvider = "web" | "x" | "code";

export type ToolTrace = {
  /** call_id for sandbox tools, output item id for xAI built-in tools. */
  id: string;
  kind: "function" | "builtin";
  name: string;
  provider?: SearchProvider;
  status: "pending" | "running" | "done" | "error";
  args?: Record<string, unknown>;
  output?: string;
  result?: Record<string, unknown>;
  preview?: string;
  durationMs?: number;
  /** Length of the message text when the call happened, so cards render in place. */
  offset: number;
  screenshotKey?: string;
};

export type SandboxFile = {
  id: string;
  name: string;
  path: string;
  mime: string;
  bytes: number;
  blobKey: string;
};

export type Source = { url: string; title?: string };

export type MessageStatus = "streaming" | "done" | "stopped" | "error";
export type ReplyMode = "responses" | "chat" | "agent";
export type TurnFlags = { agent: boolean; search: boolean };
export type ErrorSource = "xai" | "e2b" | "server";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  attachments?: Attachment[];
  status?: MessageStatus;
  error?: string;
  errorStatus?: number;
  errorSource?: ErrorSource;
  responseId?: string;
  promptVersion?: string;
  openCallIds?: string[];
  flags?: TurnFlags;
  model?: string;
  mode?: ReplyMode;
  usage?: Usage;
  tools?: ToolTrace[];
  files?: SandboxFile[];
  sources?: Source[];
  notices?: string[];
};

export type SandboxState = "running" | "paused" | "none";

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  agent?: boolean;
  search?: boolean;
  sandboxId?: string;
  sandboxState?: SandboxState;
};

export type UploadResult = {
  key?: string;
  name: string;
  kind: "image" | "file";
  bytes: number;
  fileId?: string;
  path?: string;
  error?: string;
};

/** Events streamed by /api/chat, one JSON object per SSE `data:` line. */
export type StreamEvent =
  | { type: "status"; text: string }
  | { type: "uploads"; files: UploadResult[] }
  | { type: "delta"; text: string }
  | { type: "tool_call"; callId: string; name: string }
  | { type: "tool_start"; callId: string; name: string; args: Record<string, unknown> }
  | { type: "tool_stdout"; callId: string; text: string }
  | { type: "tool_end"; callId: string; name: string; ok: boolean; durationMs: number; result: Record<string, unknown> }
  | { type: "file"; callId?: string; name: string; path: string; mime: string; bytes: number; b64: string }
  | { type: "screenshot"; callId?: string; b64: string; mime: string }
  | { type: "search_start"; id: string; provider: SearchProvider; name: string; preview?: string }
  | { type: "search_end"; id: string; provider: SearchProvider; name: string; preview?: string; ok?: boolean }
  | { type: "citations"; urls: string[] }
  | { type: "sources"; items: Source[] }
  | { type: "sandbox"; sandboxId: string | null; state: SandboxState }
  | { type: "warning"; message: string }
  | { type: "retrying"; n: number }
  | { type: "replace"; text: string }
  | {
      type: "done";
      mode: ReplyMode;
      responseId?: string;
      sandboxId?: string;
      usage?: Usage;
      promptVersion?: string;
      /** submit_result calls the next chained turn must answer with function_call_output. */
      openCallIds?: string[];
      notice?: string;
    }
  | { type: "error"; message: string; status?: number; source?: ErrorSource };
