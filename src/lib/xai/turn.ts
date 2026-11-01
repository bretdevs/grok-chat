import type OpenAI from "openai";
import type { ApiMessage, ReasoningEffort, Source, Usage } from "@/lib/types";
import type { EventStream } from "@/lib/sse";
import type { BuiltinOptions } from "./builtin-tools";
import { inlineCitationUrls, mergeSources } from "./citations";
import type { ResponseResult } from "./stream";
import { SUBMIT_RESULT_NAME } from "./submit-result";

export type TurnSettings = {
  temperature?: number;
  topP?: number;
  extraInstructions?: string;
  submitResult: boolean;
  networkRetry: boolean;
  reasoningEffort: ReasoningEffort;
  retryModel: string;
};

export type TurnContext = {
  client: OpenAI;
  model: string;
  conversationId: string;
  history: ApiMessage[];
  current: ApiMessage;
  uploads: { file: File; key?: string }[];
  previousResponseId?: string;
  clientPromptVersion?: string;
  openCallIds: string[];
  /** null when Search is off. */
  search: BuiltinOptions | null;
  settings: TurnSettings;
  signal: AbortSignal;
  sse: EventStream;
};

export const MAX_TURN_MS = 8 * 60_000;
export const MAX_STEPS = 40;
/** maxDuration is 300s on Vercel; stop early enough to pause the sandbox cleanly. */
const VERCEL_BUDGET_MS = 280_000;

type StopReason = "user" | "time" | "steps";

/** Per-message caps: wall clock and combined tool steps. Also carries the user's Stop. */
export class TurnLimits {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly detach: () => void;
  readonly budgetMs: number;
  readonly deadline: number;
  reason: StopReason | null = null;
  steps = 0;

  constructor(parent: AbortSignal) {
    this.budgetMs = process.env.VERCEL ? Math.min(MAX_TURN_MS, VERCEL_BUDGET_MS) : MAX_TURN_MS;
    this.deadline = Date.now() + this.budgetMs;
    const onAbort = () => this.stop("user");
    parent.addEventListener("abort", onAbort, { once: true });
    this.detach = () => parent.removeEventListener("abort", onAbort);
    if (parent.aborted) this.stop("user");
    this.timer = setTimeout(() => this.stop("time"), this.budgetMs);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  addStep(): void {
    this.steps++;
    if (this.steps > MAX_STEPS) this.stop("steps");
  }

  stop(reason: StopReason): void {
    this.reason ??= reason;
    this.controller.abort();
  }

  notice(): string | undefined {
    if (this.reason === "time") {
      return this.budgetMs < MAX_TURN_MS
        ? "Stopped at the server time limit (about 5 minutes on Vercel). Run the app with next start on a long-running server for longer jobs."
        : "Stopped at the 8 minute limit for one message.";
    }
    if (this.reason === "steps") return `Stopped after ${MAX_STEPS} tool steps.`;
    return undefined;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.detach();
  }
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cached: 0, reasoning: 0 };
}

export function addUsage(total: Usage, next?: Usage): void {
  if (!next) return;
  total.input += next.input;
  total.output += next.output;
  total.cached += next.cached;
  total.reasoning += next.reasoning;
}

export function incompleteNotice(reason?: string): string | undefined {
  if (!reason) return undefined;
  return reason === "max_output_tokens" ? "The reply hit the output token limit." : `The reply ended early (${reason}).`;
}

export function submitCallIds(result: ResponseResult): string[] {
  return result.calls.filter((c) => c.name === SUBMIT_RESULT_NAME).map((c) => c.callId);
}

/** Collects citations and annotated sources across the model calls of one turn. */
export class SourceCollector {
  private citations: string[] = [];
  private sources: Source[] = [];

  add(result: ResponseResult, text: string): void {
    this.citations = [...new Set([...this.citations, ...result.citations])];
    this.sources = mergeSources(this.sources, [
      ...result.sources,
      ...inlineCitationUrls(text).map((url) => ({ url })),
      ...result.citations.map((url) => ({ url })),
    ]);
  }

  flush(sse: EventStream): void {
    if (this.citations.length) sse.send({ type: "citations", urls: this.citations });
    if (this.sources.length) sse.send({ type: "sources", items: this.sources });
  }
}
