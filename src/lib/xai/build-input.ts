import { createHash } from "node:crypto";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { FILE_OUTPUT_PROTOCOL } from "@/lib/file-protocol";
import { AGENT_SYSTEM_NOTE, AGENT_TOOLS } from "@/lib/agent/tools";
import { APP_INSTRUCTIONS } from "./developer-note";
import { builtinTools, withCodeExecutionType, type BuiltinOptions } from "./builtin-tools";
import { SUBMIT_RESULT_OUTPUT, SUBMIT_RESULT_TOOL } from "./submit-result";

export const SEARCH_NOTE =
  "You have live tools: web search (search, open page) and X search (keyword, semantic, user, thread). Use them for anything time-sensitive, factual, named-entity, prices, news, people, or a specific URL. Prefer tools over memory. Cite sources as markdown links. Answer directly.";

export const IDENTITY_NOTE = "You are Grok 4.7, a helpful assistant. Answer directly with technical depth.";

export type InputItem = Record<string, unknown>;
export type UserContent = string | InputItem[];

/** Notes appended after lib/system-prompt.ts at request time. */
export function requestTimeNotes(flags: { search: boolean; agent: boolean }): string {
  return [FILE_OUTPUT_PROTOCOL, flags.search ? SEARCH_NOTE : "", flags.agent ? AGENT_SYSTEM_NOTE : "", IDENTITY_NOTE]
    .filter(Boolean)
    .join("\n\n");
}

export function systemText(notes: string): string {
  return [SYSTEM_PROMPT.trim(), notes].filter(Boolean).join("\n\n");
}

/** Changes whenever the system message changes, so a stale previous_response_id chain is not reused. */
export function promptVersion(system: string): string {
  return createHash("sha256").update(system).digest("hex").slice(0, 16);
}

export function buildInput(opts: { history: InputItem[]; userContent: UserContent; notes: string }): InputItem[] {
  return [
    { role: "system", content: systemText(opts.notes) },
    ...opts.history,
    { role: "user", content: opts.userContent },
  ];
}

export function userContent(text: string, fileIds: string[], images: string[]): UserContent {
  if (!fileIds.length && !images.length) return text;
  const parts: InputItem[] = [];
  if (text) parts.push({ type: "input_text", text });
  for (const id of fileIds) parts.push({ type: "input_file", file_id: id });
  for (const url of images) parts.push({ type: "input_image", image_url: url, detail: "high" });
  return parts;
}

export function historyItem(m: { role: "user" | "assistant"; content: string; fileIds?: string[]; images?: string[] }): InputItem {
  if (m.role === "assistant") return { role: "assistant", content: m.content };
  return { role: "user", content: userContent(m.content, m.fileIds ?? [], m.images ?? []) };
}

/** Answers submit_result calls left open by the previous turn, so the chain stays valid. */
export function openCallOutputs(callIds: string[]): InputItem[] {
  return callIds.map((id) => ({ type: "function_call_output", call_id: id, output: SUBMIT_RESULT_OUTPUT }));
}

export function instructionsText(extra?: string): string {
  return [APP_INSTRUCTIONS, extra?.trim()].filter(Boolean).join("\n\n");
}

export function mergeTools(opts: { search: BuiltinOptions | null; submitResult: boolean; agent: boolean }): InputItem[] {
  return [
    ...(opts.search ? builtinTools(opts.search) : []),
    ...(opts.submitResult ? [SUBMIT_RESULT_TOOL] : []),
    ...(opts.agent ? AGENT_TOOLS : []),
  ] as InputItem[];
}

export type ResponseRequest = {
  model: string;
  /** Input for this call (chained or full). */
  input: InputItem[];
  /** Full-history input to use if previous_response_id is rejected. */
  fullInput?: () => InputItem[];
  previousResponseId?: string;
  tools: InputItem[];
  include?: string[];
  instructions?: string;
  temperature?: number;
  topP?: number;
  conversationId: string;
};

/** Optional request parts dropped or reshaped after xAI rejected them. */
export type BodyFixes = { include: boolean; instructions: boolean; sampling: boolean; code: boolean; previous: boolean };

export function responsesBody(req: ResponseRequest, fixes: BodyFixes): Record<string, unknown> {
  let input = fixes.previous && req.fullInput ? req.fullInput() : req.input;
  const body: Record<string, unknown> = {
    model: req.model,
    stream: true,
    prompt_cache_key: req.conversationId,
  };
  if (req.instructions) {
    if (fixes.instructions) input = withSystemMessage(input, req.instructions);
    else body.instructions = req.instructions;
  }
  body.input = input;
  if (req.previousResponseId && !fixes.previous) body.previous_response_id = req.previousResponseId;
  if (req.tools.length) {
    body.tools = fixes.code ? withCodeExecutionType(req.tools) : req.tools;
    body.parallel_tool_calls = true;
  }
  if (req.include?.length && !fixes.include) body.include = req.include;
  if (!fixes.sampling) {
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
  }
  return body;
}

/** Fallback when `instructions` is rejected: a second system message right after the first. */
function withSystemMessage(input: InputItem[], text: string): InputItem[] {
  const message = { role: "system", content: text };
  const at = input[0]?.role === "system" ? 1 : 0;
  return [...input.slice(0, at), message, ...input.slice(at)];
}
