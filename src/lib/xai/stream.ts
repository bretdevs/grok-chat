import type OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses";
import type { Source, StreamEvent, Usage } from "@/lib/types";
import { describeError, isConnectionError, isUserAbort, UpstreamError } from "./client";
import { describeBuiltinItem, hasCodeTool, isServerToolName, resultPreview, type BuiltinCard } from "./builtin-tools";
import { annotationSource, annotationSources, citationUrls } from "./citations";
import { responsesBody, type BodyFixes, type ResponseRequest } from "./build-input";
import { isRefusal } from "./refusal";
import { isRetryableStatus, withNetworkRetry } from "./retry-network";
import { parseSubmitText, SubmitTextStream, SUBMIT_RESULT_NAME } from "./submit-result";

const STALL_MS = 180_000;

type Learned = Omit<BodyFixes, "previous">;
const learnedByModel = new Map<string, Learned>();

function learned(model: string): Learned {
  let flags = learnedByModel.get(model);
  if (!flags) {
    flags = { include: false, instructions: false, sampling: false, code: false, reasoning: false, toolChoice: false };
    learnedByModel.set(model, flags);
  }
  return flags;
}

export type TextState = { full: string; lastItem?: string };
export const newTextState = (): TextState => ({ full: "" });

export type FunctionCall = { callId: string; name: string; arguments: string };

export type ResponseResult = {
  responseId?: string;
  usage?: Usage;
  calls: FunctionCall[];
  incomplete?: string;
  citations: string[];
  sources: Source[];
};

export type TurnHandlers = {
  text: TextState;
  emit: (event: StreamEvent) => void;
  isLocalFunction: (name: string) => boolean;
  onBuiltinStep?: () => void;
};

export type RetryOptions = {
  signal: AbortSignal;
  networkRetry: boolean;
  onRetry: (n: number) => void;
};

class StreamEndedError extends UpstreamError {}
class StallError extends UpstreamError {}

const shownBeforeFailure = new WeakSet<object>();

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const str = (o: unknown, k: string): string | undefined => (isObj(o) && typeof o[k] === "string" ? (o[k] as string) : undefined);

function isSharedSourceRetryError(err: unknown): boolean {
  return /shared source authorization could not be retained for retry/i.test(describeError(err).message);
}

export async function runResponseTurn(
  client: OpenAI,
  req: ResponseRequest,
  handlers: TurnHandlers,
  opts: RetryOptions,
): Promise<ResponseResult> {
  const fixes: BodyFixes = { ...learned(req.model), previous: false };
  return withNetworkRetry(
    async () => {
      const attempt = new AbortController();
      const forward = () => attempt.abort();
      opts.signal.addEventListener("abort", forward, { once: true });
      if (opts.signal.aborted) attempt.abort();
      let stalled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          stalled = true;
          attempt.abort();
        }, STALL_MS);
      };
      const shownAt = handlers.text.full.length;
      try {
        touch();
        const stream = await openStream(client, req, fixes, attempt.signal);
        return await consumeResponseStream(stream, handlers, touch);
      } catch (err) {
        const failure = stalled && !opts.signal.aborted ? new StallError("xAI stopped sending data.") : err;
        if (isObj(failure) && handlers.text.full.length > shownAt) shownBeforeFailure.add(failure);
        throw failure;
      } finally {
        clearTimeout(timer);
        opts.signal.removeEventListener("abort", forward);
      }
    },
    {
      enabled: opts.networkRetry,
      signal: opts.signal,
      onRetry: opts.onRetry,
      isRetryable: (err) => {
        if (isUserAbort(err, opts.signal) || (isObj(err) && shownBeforeFailure.has(err))) return false;
        if (isSharedSourceRetryError(err)) return false;
        if (err instanceof StallError || err instanceof StreamEndedError || isConnectionError(err)) return true;
        return isRetryableStatus(describeError(err).status);
      },
    },
  );
}

async function openStream(client: OpenAI, req: ResponseRequest, fixes: BodyFixes, signal: AbortSignal): Promise<AsyncIterable<unknown>> {
  const tried = new Set<keyof BodyFixes>();
  const confirmed = new Set<keyof BodyFixes>();
  for (;;) {
    const body = responsesBody(req, fixes);
    try {
      const stream = await client.responses.create(body as unknown as ResponseCreateParamsStreaming, { signal });
      for (const key of confirmed) if (key !== "previous") learned(req.model)[key] = true;
      return stream as AsyncIterable<unknown>;
    } catch (err) {
      if (isUserAbort(err, signal)) throw err;
      const fix = nextFix(req, fixes, tried, err);
      if (!fix) throw err;
      tried.add(fix.key);
      if (fix.confirmed) confirmed.add(fix.key);
      fixes[fix.key] = true;
    }
  }
}

function nextFix(
  req: ResponseRequest,
  fixes: BodyFixes,
  tried: Set<keyof BodyFixes>,
  err: unknown,
): { key: keyof BodyFixes; confirmed: boolean } | null {
  const { status, message } = describeError(err);
  const canDropPrevious = Boolean(req.previousResponseId && req.fullInput) && !fixes.previous && !tried.has("previous");
  if (status === 404 && canDropPrevious) return { key: "previous", confirmed: true };
  if (status !== 400 && status !== 422) return null;
  const options: Array<[keyof BodyFixes, RegExp, boolean]> = [
    ["include", /include|inline_citations/i, Boolean(req.include?.length)],
    ["instructions", /instructions/i, Boolean(req.instructions)],
    ["sampling", /temperature|top_p/i, req.temperature !== undefined || req.topP !== undefined],
    ["code", /code_interpreter|code interpreter/i, hasCodeTool(req.tools)],
    ["reasoning", /reasoning/i, true],
    ["toolChoice", /tool_choice/i, Boolean(req.toolChoice && req.toolChoice !== "auto")],
    ["previous", /previous|not found/i, canDropPrevious],
  ];
  const open = options.filter(([key, , applies]) => applies && !fixes[key] && !tried.has(key));
  const named = open.find(([, pattern]) => pattern.test(message));
  if (named) return { key: named[0], confirmed: true };
  return open.length ? { key: open[0][0], confirmed: false } : null;
}

export async function consumeResponseStream(
  stream: AsyncIterable<unknown>,
  h: TurnHandlers,
  touch?: () => void,
): Promise<ResponseResult> {
  const result: ResponseResult = { calls: [], citations: [], sources: [] };
  const startLength = h.text.full.length;
  const calls = new Map<string, FunctionCall>();
  const submitStreams = new Map<string, SubmitTextStream>();
  const cards = new Map<string, { card: BuiltinCard; ended: boolean }>();
  let normal = "";
  let completed = false;

  const emitText = (delta: string, itemId: string) => {
    if (!delta) return;
    const t = h.text;
    let chunk = delta;
    if (t.full && itemId !== t.lastItem) chunk = (t.full.endsWith("\n\n") ? "" : t.full.endsWith("\n") ? "\n" : "\n\n") + delta;
    t.lastItem = itemId;
    t.full += chunk;
    h.emit({ type: "delta", text: chunk });
  };

  const startCard = (card: BuiltinCard) => {
    if (cards.has(card.id)) return;
    cards.set(card.id, { card, ended: false });
    h.onBuiltinStep?.();
    h.emit({ type: "search_start", ...card });
  };

  const endCard = (card: BuiltinCard, item?: unknown, ok = true) => {
    startCard(card);
    const entry = cards.get(card.id)!;
    if (entry.ended) return;
    entry.ended = true;
    const preview = resultPreview(item) ?? card.preview ?? entry.card.preview;
    h.emit({ type: "search_end", id: card.id, provider: card.provider, name: card.name, preview, ok });
  };

  const onItem = (item: unknown, phase: "added" | "done") => {
    if (!isObj(item)) return;
    const type = str(item, "type");
    const id = str(item, "id") ?? "";
    if (type === "message") {
      if (phase !== "done") return;
      result.sources.push(...annotationSources(item));
      if (!normal) {
        const text = messageText(item);
        normal += text;
        emitText(text, id);
      }
      return;
    }
    if (type === "reasoning") return;
    if (type === "function_call") {
      const name = str(item, "name") ?? "";
      if (h.isLocalFunction(name)) {
        const callId = str(item, "call_id") ?? id;
        if (phase === "added") {
          if (name === SUBMIT_RESULT_NAME) submitStreams.set(id, new SubmitTextStream());
          else h.emit({ type: "tool_call", callId, name });
        } else {
          calls.set(callId, { callId, name, arguments: str(item, "arguments") ?? "" });
        }
        return;
      }
      if (!isServerToolName(name)) return;
    }
    const card = describeBuiltinItem(item);
    if (!card) return;
    if (phase === "added") startCard(card);
    else endCard(card, item, str(item, "status") !== "failed");
  };

  for await (const raw of stream) {
    touch?.();
    if (!isObj(raw)) continue;
    const type = str(raw, "type") ?? "";
    switch (type) {
      case "response.created":
      case "response.in_progress":
        result.responseId = str(raw.response, "id") ?? result.responseId;
        break;
      case "response.output_text.delta":
      case "response.refusal.delta": {
        const delta = str(raw, "delta") ?? "";
        normal += delta;
        emitText(delta, str(raw, "item_id") ?? "");
        break;
      }
      case "response.function_call_arguments.delta": {
        const itemId = str(raw, "item_id") ?? "";
        const decoder = submitStreams.get(itemId);
        if (!decoder) break;
        const piece = decoder.push(str(raw, "delta") ?? "");
        if (piece && !normal) {
          decoder.shown = true;
          emitText(piece, `submit:${itemId}`);
        }
        break;
      }
      case "response.output_text.annotation.added": {
        const source = annotationSource(raw.annotation);
        if (source) result.sources.push(source);
        break;
      }
      case "response.output_item.added":
        onItem(raw.item, "added");
        break;
      case "response.output_item.done":
        onItem(raw.item, "done");
        break;
      case "response.completed":
      case "response.incomplete": {
        const response = isObj(raw.response) ? raw.response : {};
        result.responseId = str(response, "id") ?? result.responseId;
        result.usage = mapUsage(response.usage);
        if (type === "response.incomplete" && !result.incomplete) {
          result.incomplete = str(response.incomplete_details, "reason") ?? "incomplete";
        }
        if (Array.isArray(response.output)) for (const item of response.output) onItem(item, "done");
        result.citations = citationUrls(response);
        completed = true;
        break;
      }
      case "response.failed": {
        const error = isObj(raw.response) ? raw.response.error : undefined;
        throw new UpstreamError(str(error, "message") ?? "The model request failed.", statusFromCode(str(error, "code")));
      }
      case "error":
        throw new UpstreamError(
          str(raw, "message") ?? str(raw.error, "message") ?? "The model stream returned an error.",
          statusFromCode(str(raw, "code")),
        );
      default: {
        const m = /^response\.([a-z_]+_call)\.(in_progress|searching|interpreting|completed|failed)$/.exec(type);
        const itemId = str(raw, "item_id");
        if (!m || !itemId) break;
        const card = cards.get(itemId)?.card ?? describeBuiltinItem({ type: m[1], id: itemId });
        if (!card) break;
        if (m[2] === "completed" || m[2] === "failed") endCard(card, undefined, m[2] === "completed");
        else startCard(card);
      }
    }
  }

  if (!completed) {
    throw new StreamEndedError(
      h.text.full.length > startLength ? "The connection to xAI closed before the reply finished." : "The stream ended before any output.",
    );
  }

  settleSubmitResult(calls, normal, startLength, h);
  result.calls = [...calls.values()];
  for (const { card, ended } of cards.values()) if (!ended) endCard(card);

  const empty = h.text.full.length === startLength && !result.calls.length && !cards.size;
  if (empty && !result.incomplete && (result.usage?.output ?? 0) === 0) throw new StreamEndedError("The model returned an empty reply.");
  return result;
}

function settleSubmitResult(calls: Map<string, FunctionCall>, normal: string, startLength: number, h: TurnHandlers) {
  const submitted = [...calls.values()]
    .filter((c) => c.name === SUBMIT_RESULT_NAME)
    .map((c) => parseSubmitText(c.arguments))
    .filter(Boolean)
    .pop();
  if (!submitted) return;

  let chosen = submitted.length >= normal.length ? submitted : normal;
  if (isRefusal(normal) && submitted && !isRefusal(submitted)) chosen = submitted;
  if (isRefusal(submitted) && normal && !isRefusal(normal)) chosen = normal;

  const before = h.text.full.slice(0, startLength);
  const shown = h.text.full.slice(startLength);
  if (shown.trim() === chosen.trim()) return;
  const separator = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
  h.text.full = before + separator + chosen;
  h.text.lastItem = "submit";
  h.emit(shown ? { type: "replace", text: h.text.full } : { type: "delta", text: separator + chosen });
}

function messageText(item: Obj): string {
  if (!Array.isArray(item.content)) return "";
  return item.content.map((part) => str(part, "text") ?? str(part, "refusal") ?? "").join("");
}

function mapUsage(raw: unknown): Usage | undefined {
  if (!isObj(raw)) return undefined;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const inDetails = isObj(raw.input_tokens_details) ? raw.input_tokens_details : {};
  const outDetails = isObj(raw.output_tokens_details) ? raw.output_tokens_details : {};
  return {
    input: num(raw.input_tokens),
    output: num(raw.output_tokens),
    cached: num(inDetails.cached_tokens),
    reasoning: num(outDetails.reasoning_tokens),
  };
}

function statusFromCode(code?: string): number | undefined {
  if (!code) return undefined;
  if (/^\d{3}$/.test(code)) return Number(code);
  if (/rate.?limit/i.test(code)) return 429;
  if (/unavailable|overloaded/i.test(code)) return 503;
  if (/server|internal/i.test(code)) return 500;
  return undefined;
}
