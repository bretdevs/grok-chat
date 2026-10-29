import type { SearchProvider } from "@/lib/types";

export type BuiltinOptions = {
  web: boolean;
  x: boolean;
  code: boolean;
  /** YYYY-MM-DD, inclusive. */
  xFrom?: string;
  /** YYYY-MM-DD, exclusive. */
  xTo?: string;
};

export type CodeToolType = "code_interpreter" | "code_execution";

/** xAI runs these on its side; the client never sends function_call_output for them. */
export function builtinTools(opts: BuiltinOptions, codeType: CodeToolType = "code_interpreter"): Record<string, unknown>[] {
  const tools: Record<string, unknown>[] = [];
  if (opts.web) tools.push({ type: "web_search", enable_image_understanding: true });
  if (opts.x) {
    const x: Record<string, unknown> = { type: "x_search", enable_image_understanding: true };
    if (opts.xFrom) x.from_date = opts.xFrom;
    if (opts.xTo) x.to_date = opts.xTo;
    tools.push(x);
  }
  if (opts.code) tools.push({ type: codeType });
  return tools;
}

export function hasCodeTool(tools: unknown[]): boolean {
  return tools.some((t) => isObj(t) && t.type === "code_interpreter");
}

export function withCodeExecutionType(tools: unknown[]): unknown[] {
  return tools.map((t) => (isObj(t) && t.type === "code_interpreter" ? { ...t, type: "code_execution" } : t));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const str = (o: unknown, k: string): string | undefined => (isObj(o) && typeof o[k] === "string" ? (o[k] as string) : undefined);

const X_NAMES: Record<string, string> = {
  x_keyword_search: "X search",
  x_semantic_search: "X search",
  x_user_search: "X user search",
  x_thread_fetch: "X thread",
  view_x_video: "X video",
};
const WEB_NAMES: Record<string, string> = {
  web_search: "Web search",
  search_web: "Web search",
  browse_page: "Open page",
  open_page: "Open page",
  web_fetch: "Open page",
  view_image: "View image",
};
const CODE_NAMES = new Set(["code_execution", "code_interpreter", "python", "run_python"]);

/** Server-side tools sometimes come back as function_call items with these names. */
export function isServerToolName(name: string): boolean {
  return name in X_NAMES || name in WEB_NAMES || CODE_NAMES.has(name) || name.startsWith("x_");
}

export type BuiltinCard = { id: string; provider: SearchProvider; name: string; preview?: string };

/** Maps a server-side tool output item to a card. Returns null for items that are not built-in tool calls. */
export function describeBuiltinItem(item: unknown): BuiltinCard | null {
  if (!isObj(item)) return null;
  const type = str(item, "type") ?? "";
  const id = str(item, "id") ?? str(item, "call_id");
  if (!id || type === "message" || type === "reasoning") return null;

  if (type === "web_search_call") {
    const action = isObj(item.action) ? item.action : undefined;
    const kind = str(action, "type");
    if (kind === "open_page") return { id, provider: "web", name: "Open page", preview: str(action, "url") };
    if (kind === "find" || kind === "find_in_page") {
      return { id, provider: "web", name: "Find in page", preview: str(action, "pattern") ?? str(action, "url") };
    }
    const queries = Array.isArray(action?.queries) ? action.queries.filter((q): q is string => typeof q === "string") : [];
    return { id, provider: "web", name: "Web search", preview: str(action, "query") ?? (queries.join(" · ") || undefined) };
  }
  if (type === "x_search_call") return { id, provider: "x", name: "X search", preview: previewFrom(item.action ?? item.input) };
  if (type === "code_interpreter_call" || type === "code_execution_call") {
    return { id, provider: "code", name: "Ran Python", preview: firstLine(str(item, "code")) };
  }

  const name = str(item, "name") ?? "";
  const callId = str(item, "call_id") ?? "";
  const input = item.input ?? item.arguments;
  if (type === "custom_tool_call" || type === "function_call") {
    if (name in X_NAMES || name.startsWith("x_") || callId.startsWith("xs_")) {
      return { id, provider: "x", name: X_NAMES[name] ?? "X search", preview: previewFrom(input) };
    }
    if (CODE_NAMES.has(name)) return { id, provider: "code", name: "Ran Python", preview: firstLine(codeFrom(input)) };
    if (name in WEB_NAMES || callId.startsWith("ws_")) return { id, provider: "web", name: WEB_NAMES[name] ?? "Web search", preview: previewFrom(input) };
    if (type === "custom_tool_call") return { id, provider: "web", name: name || "Tool", preview: previewFrom(input) };
    return null;
  }
  if (type.endsWith("_call")) {
    return { id, provider: "web", name: type.replace(/_call$/, "").replace(/_/g, " "), preview: previewFrom(input) };
  }
  return null;
}

/** Short result text for a finished call, when the item carries one. */
export function resultPreview(item: unknown): string | undefined {
  if (!isObj(item)) return undefined;
  if (Array.isArray(item.outputs)) {
    const logs = item.outputs.map((o) => str(o, "logs") ?? "").filter(Boolean).join("\n");
    if (logs) return clipLine(logs, 300);
  }
  const action = isObj(item.action) ? item.action : undefined;
  if (action && Array.isArray(action.sources)) return `${action.sources.length} sources`;
  return undefined;
}

function previewFrom(input: unknown): string | undefined {
  let value: unknown = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return clipLine(value as string, 160);
    }
  }
  if (!isObj(value)) return typeof value === "string" ? clipLine(value, 160) : undefined;
  for (const key of ["query", "q", "url", "keywords", "username", "post_id", "prompt"]) {
    const v = value[key];
    if (typeof v === "string" && v) return clipLine(v, 160);
  }
  for (const key of ["queries", "usernames", "handles"]) {
    const v = value[key];
    if (Array.isArray(v) && v.length) return clipLine(v.join(", "), 160);
  }
  return undefined;
}

function codeFrom(input: unknown): string | undefined {
  if (typeof input !== "string") return str(input, "code");
  try {
    return str(JSON.parse(input), "code") ?? input;
  } catch {
    return input;
  }
}

function firstLine(text: string | undefined): string | undefined {
  const line = text?.split("\n").find((l) => l.trim());
  return line ? clipLine(line, 160) : undefined;
}

function clipLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
