import type { ApiMessage } from "@/lib/types";

const TRANSPORT_ERROR = /^(error:|api error)/i;

/** Keeps the last `max` turns and drops assistant turns that are empty or only a transport error. */
export function sanitizeHistory(history: ApiMessage[], max = 40): ApiMessage[] {
  return history.slice(-max).filter((m) => {
    if (m.role !== "assistant") return true;
    const text = m.content.trim();
    return Boolean(text) && !TRANSPORT_ERROR.test(text);
  });
}

const PASS_THROUGH = new Set([
  "reasoning",
  "function_call",
  "function_call_output",
  "web_search_call",
  "x_search_call",
  "code_interpreter_call",
  "custom_tool_call",
  "custom_tool_call_output",
]);

/**
 * Reasoning and tool items to send back when continuing without previous_response_id.
 * Chained turns use previous_response_id, which already carries these (including encrypted reasoning).
 */
export function passThroughOutputItems(items: unknown[]): unknown[] {
  return items.filter((item) => {
    const type = item && typeof item === "object" ? (item as { type?: unknown }).type : undefined;
    return typeof type === "string" && PASS_THROUGH.has(type);
  });
}
