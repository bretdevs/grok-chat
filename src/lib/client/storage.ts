import { MAX_CONVERSATIONS, type Conversation, type ReasoningEffort } from "@/lib/types";

export const STORAGE_KEYS = {
  xaiKey: "xai_api_key",
  e2bKey: "e2b_api_key",
  extraInstructions: "xai_extra_instructions",
  model: "xai_model",
  active: "gc_active",
  prefs: "gc_prefs",
  conversations: "gc_conversations",
};

export type Prefs = {
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
  reasoningEffort: ReasoningEffort;
  retryModel: string;
};

export const DEFAULT_PREFS: Prefs = {
  agent: false,
  search: false,
  web: true,
  x: true,
  code: false,
  xFrom: "",
  xTo: "",
  temperatureAsk: 0.8,
  temperatureAgent: 0.4,
  topP: 0.95,
  submitResult: false,
  networkRetry: true,
  reasoningEffort: "low",
  retryModel: "grok-4-fast",
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
    /* quota */
  }
}

export function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.prefs);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const effort = parsed.reasoningEffort;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      reasoningEffort: effort === "medium" || effort === "high" || effort === "xhigh" || effort === "low" ? effort : "low",
      retryModel: typeof parsed.retryModel === "string" && parsed.retryModel ? parsed.retryModel : DEFAULT_PREFS.retryModel,
      submitResult: parsed.submitResult === true,
      search: parsed.search === true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify(prefs));
  } catch {
    /* quota */
  }
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.conversations);
    if (!raw) return [];
    const list = JSON.parse(raw) as Conversation[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]): Conversation[] {
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  const keep = sorted.slice(0, MAX_CONVERSATIONS);
  const dropped = sorted.slice(MAX_CONVERSATIONS);
  try {
    localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(keep));
    return dropped;
  } catch {
    for (let n = keep.length - 1; n >= 0; n--) {
      try {
        const smaller = keep.slice(0, n);
        localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(smaller));
        return keep.slice(n).concat(dropped);
      } catch {
        continue;
      }
    }
    return keep.concat(dropped);
  }
}
