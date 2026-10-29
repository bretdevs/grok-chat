import { MAX_CONVERSATIONS, type ChatMessage, type Conversation, type ToolTrace } from "@/lib/types";
import { clip } from "@/lib/utils";

export const STORAGE_KEYS = {
  xaiKey: "xai_api_key",
  e2bKey: "e2b_api_key",
  extraInstructions: "xai_extra_instructions",
  model: "grokchat:model",
  conversations: "grokchat:conversations",
  active: "grokchat:active",
  prefs: "grokchat:prefs",
} as const;

export type Prefs = {
  /** Defaults for new chats; each conversation keeps its own Agent and Search switch. */
  agent: boolean;
  search: boolean;
  web: boolean;
  x: boolean;
  code: boolean;
  xFrom: string;
  xTo: string;
  temperatureAsk: number;
  temperatureAgent: number;
  topP: number;
  submitResult: boolean;
  networkRetry: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  agent: false,
  search: true,
  web: true,
  x: true,
  code: false,
  xFrom: "",
  xTo: "",
  temperatureAsk: 0.8,
  temperatureAgent: 0.4,
  topP: 0.95,
  submitResult: true,
  networkRetry: true,
};

export function readString(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeString(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // storage blocked or full; the value stays in memory for this session
  }
}

export function readPrefs(): Prefs {
  try {
    const stored = JSON.parse(readString(STORAGE_KEYS.prefs) || "{}") as Partial<Prefs>;
    const prefs = { ...DEFAULT_PREFS };
    for (const key of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
      if (typeof stored[key] === typeof DEFAULT_PREFS[key]) (prefs as Record<string, unknown>)[key] = stored[key];
    }
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(prefs: Prefs): void {
  writeString(STORAGE_KEYS.prefs, JSON.stringify(prefs));
}

export function loadConversations(): Conversation[] {
  try {
    const list: unknown = JSON.parse(readString(STORAGE_KEYS.conversations) || "[]");
    if (!Array.isArray(list)) return [];
    return list.filter(isConversation).map(settleInterrupted);
  } catch {
    return [];
  }
}

/** Saves the newest conversations that fit; returns the ids that had to be left out. */
export function saveConversations(list: Conversation[]): string[] {
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS).map(compact);
  for (let keep = sorted.length; keep >= 0; keep--) {
    try {
      localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(sorted.slice(0, keep)));
      return sorted.slice(keep).map((c) => c.id);
    } catch (err) {
      if (!isQuotaError(err)) return [];
    }
  }
  return [];
}

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Conversation>;
  return typeof c.id === "string" && Array.isArray(c.messages) && typeof c.updatedAt === "number";
}

/** A reload cuts any stream that was running; mark it stopped instead of spinning forever. */
function settleInterrupted(conv: Conversation): Conversation {
  if (!conv.messages.some((m) => m.status === "streaming")) return conv;
  return {
    ...conv,
    messages: conv.messages.map((m) =>
      m.status === "streaming"
        ? {
            ...m,
            status: "stopped",
            tools: m.tools?.map((t) => (t.status === "running" || t.status === "pending" ? { ...t, status: "error" } : t)),
          }
        : m,
    ),
  };
}

function compact(conv: Conversation): Conversation {
  return { ...conv, messages: conv.messages.map(compactMessage) };
}

function compactMessage(m: ChatMessage): ChatMessage {
  if (!m.tools?.length) return m;
  return { ...m, tools: m.tools.map(compactTool) };
}

function compactTool(t: ToolTrace): ToolTrace {
  return {
    ...t,
    output: t.output ? clip(t.output, 8000) : undefined,
    args: t.args ? slim(t.args) : undefined,
    result: t.result ? slim(t.result) : undefined,
  };
}

function slim(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = clip(v, 4000);
    else if (Array.isArray(v)) out[k] = v.slice(0, 100);
    else out[k] = v;
  }
  return out;
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014);
}
