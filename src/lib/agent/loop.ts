import type { Sandbox } from "e2b";
import type { EventStream } from "@/lib/sse";
import { sandboxBlock } from "@/lib/sandbox-paths";
import { clip, errorText } from "@/lib/utils";
import { describeError, UpstreamError, type ErrorInfo } from "@/lib/xai/client";
import { apiEndpoint } from "@/lib/xai/endpoint";
import {
  buildInput,
  historyItem,
  instructionsText,
  mergeTools,
  openCallOutputs,
  promptVersion,
  requestTimeNotes,
  systemText,
  userContent,
  type InputItem,
  type ResponseRequest,
} from "@/lib/xai/build-input";
import { isServerToolName } from "@/lib/xai/builtin-tools";
import { sanitizeHistory } from "@/lib/xai/history";
import { newTextState, runResponseTurn } from "@/lib/xai/stream";
import { SUBMIT_RESULT_NAME, SUBMIT_RESULT_OUTPUT } from "@/lib/xai/submit-result";
import { addUsage, emptyUsage, incompleteNotice, SourceCollector, TurnLimits, type TurnContext } from "@/lib/xai/turn";
import { fileToDataUrl, isImageFile } from "@/lib/xai/uploads";
import { fail, runTool, UI_TEXT_LIMIT, type ToolOutcome } from "./run-tools";
import { getSandbox, pauseSandbox, writeUploads } from "./sandbox";
import { AGENT_TOOL_NAMES } from "./tools";

const MAX_TOOL_ROUNDS = 30;
/** Whole function_call_output cap; stdout/stderr are already trimmed to ~80k inside it. */
const OUTPUT_LIMIT = 90_000;

export type AgentContext = TurnContext & {
  e2bKey: string;
  sandboxId?: string;
  /** Files already uploaded into /home/user/uploaded for this turn (see /api/upload). */
  sandboxFiles: { path: string; bytes: number }[];
};

/**
 * Agent mode: model ↔ sandbox tool loop. xAI runs search tools itself; only function calls
 * (sandbox tools and submit_result) are answered here. The sandbox is paused when the turn ends.
 */
export async function runAgent(ctx: AgentContext): Promise<void> {
  const { sse, settings } = ctx;
  const limits = new TurnLimits(ctx.signal);
  const notes = requestTimeNotes({ agent: true, search: Boolean(ctx.search) });
  const version = promptVersion(systemText(notes));
  const text = newTextState();
  const sources = new SourceCollector();
  const usage = emptyUsage();
  let sbx: Sandbox | undefined;
  let responseId: string | undefined;
  let chainable = false;
  let openCallIds: string[] = [];
  let notice: string | undefined;
  let failure: ErrorInfo | undefined;

  try {
    sse.send({ type: "status", text: ctx.sandboxId ? "Resuming sandbox" : "Starting sandbox" });
    const session = await getSandbox({ conversationId: ctx.conversationId, sandboxId: ctx.sandboxId, apiKey: ctx.e2bKey });
    sbx = session.sbx;
    if (session.replaced) {
      sse.send({
        type: "warning",
        message: "The previous sandbox no longer exists, so a new one was started. Files from earlier turns are not in it.",
      });
    }
    sse.send({ type: "sandbox", sandboxId: sbx.sandboxId, state: "running" });

    // Large files were uploaded into the sandbox before this request; small ones come with it.
    const onDisk = [...ctx.sandboxFiles];
    const images = [...(ctx.current.images ?? [])];
    if (ctx.uploads.length) {
      sse.send({ type: "status", text: "Copying files into the sandbox" });
      const results = await writeUploads(sbx, ctx.uploads);
      sse.send({ type: "uploads", files: results });
      const failed = results.find((r) => r.error);
      if (failed) throw new UpstreamError(`Couldn't copy ${failed.name} into the sandbox: ${failed.error}`, undefined, "e2b");
      // Images also go to the model directly so it can see them.
      for (const { file } of ctx.uploads) if (isImageFile(file)) images.push(await fileToDataUrl(file));
      onDisk.push(...results.map((r) => ({ path: r.path ?? "", bytes: r.bytes })));
    }
    const message = onDisk.length ? [ctx.current.content, sandboxBlock(onDisk)].filter(Boolean).join("\n\n") : ctx.current.content;

    const history = sanitizeHistory(ctx.history).map(historyItem);
    const content = userContent(message, ctx.current.fileIds ?? [], images);
    const { chain } = apiEndpoint();
    const chained = chain && Boolean(ctx.previousResponseId) && ctx.clientPromptVersion === version;
    const fullInput = () => buildInput({ history, userContent: content, notes });
    let req: ResponseRequest = {
      model: ctx.model,
      input: chained ? [...openCallOutputs(ctx.openCallIds), { role: "user", content }] : fullInput(),
      fullInput: chained ? fullInput : undefined,
      previousResponseId: chained ? ctx.previousResponseId : undefined,
      tools: mergeTools({ search: ctx.search, submitResult: settings.submitResult, agent: true }),
      include: ctx.search ? ["inline_citations"] : undefined,
      instructions: instructionsText(settings.extraInstructions),
      temperature: settings.temperature,
      topP: settings.topP,
      conversationId: ctx.conversationId,
    };

    // What this turn has added after the user message (replies, calls, outputs), for resending in full
    // when replies aren't chained or the previous response can't be found.
    const turnItems: InputItem[] = [];
    for (let round = 0; ; round++) {
      sse.send({ type: "status", text: "Thinking" });
      const roundStart = text.full.length;
      const result = await runResponseTurn(
        ctx.client,
        req,
        {
          text,
          emit: sse.send,
          // Unknown function names are answered with an error so the chain stays valid.
          isLocalFunction: (name) => !isServerToolName(name),
          onBuiltinStep: () => limits.addStep(),
        },
        { signal: limits.signal, networkRetry: settings.networkRetry, onRetry: (n) => sse.send({ type: "retrying", n }) },
      );
      responseId = result.responseId ?? responseId;
      addUsage(usage, result.usage);
      sources.add(result, text.full);
      sources.flush(sse);

      const work = result.calls.filter((c) => c.name !== SUBMIT_RESULT_NAME);
      if (!work.length) {
        chainable = !result.incomplete;
        openCallIds = result.calls.map((c) => c.callId);
        notice = incompleteNotice(result.incomplete);
        break;
      }
      if (round >= MAX_TOOL_ROUNDS) {
        notice = `Stopped after ${MAX_TOOL_ROUNDS} tool rounds.`;
        limits.stop("steps");
        break;
      }

      const outputs: InputItem[] = [];
      for (const call of result.calls) {
        if (call.name === SUBMIT_RESULT_NAME) {
          outputs.push(callOutput(call.callId, SUBMIT_RESULT_OUTPUT));
          continue;
        }
        limits.addStep();
        if (limits.reason) break;
        const args = parseArgs(call.arguments);
        sse.send({ type: "tool_start", callId: call.callId, name: call.name, args: args ? argsForUi(args) : {} });
        const started = Date.now();
        let outcome: ToolOutcome;
        if (!args) outcome = fail("The tool arguments were not valid JSON.");
        else if (!AGENT_TOOL_NAMES.has(call.name)) outcome = fail(`Unknown tool "${call.name}".`);
        else outcome = await runTool(call.name, args, { sbx, callId: call.callId, emit: sse.send, signal: limits.signal, deadline: limits.deadline });
        sse.send({ type: "tool_end", callId: call.callId, name: call.name, ok: outcome.ok, durationMs: Date.now() - started, result: outcome.forUi });
        outputs.push(callOutput(call.callId, clip(JSON.stringify(outcome.forModel), OUTPUT_LIMIT)));
      }
      if (limits.reason) break;
      const said = text.full.slice(roundStart).trim();
      if (said) turnItems.push({ role: "assistant", content: said });
      for (const call of result.calls) turnItems.push({ type: "function_call", call_id: call.callId, name: call.name, arguments: call.arguments });
      turnItems.push(...outputs);
      const resend = [...fullInput(), ...turnItems];
      if (!chain) {
        req = { ...req, input: resend, fullInput: undefined, previousResponseId: undefined };
        continue;
      }
      if (!result.responseId) throw new UpstreamError("xAI did not return a response id, so the tool loop could not continue.");
      req = { ...req, input: outputs, fullInput: () => resend, previousResponseId: result.responseId };
    }
  } catch (err) {
    if (!limits.reason) failure = describeError(err);
  } finally {
    limits.dispose();
    if (sbx) await pause(sbx, sse);
  }

  if (limits.reason === "user") return;
  if (failure) {
    sse.send({ type: "error", ...failure });
    return;
  }
  sse.send({
    type: "done",
    mode: "agent",
    responseId: chainable ? responseId : undefined,
    sandboxId: sbx?.sandboxId,
    usage,
    promptVersion: version,
    openCallIds: chainable ? openCallIds : undefined,
    notice: notice ?? limits.notice(),
  });
}

async function pause(sbx: Sandbox, sse: EventStream): Promise<void> {
  sse.send({ type: "status", text: "Pausing sandbox" });
  try {
    await pauseSandbox(sbx);
    sse.send({ type: "sandbox", sandboxId: sbx.sandboxId, state: "paused" });
  } catch (err) {
    sse.send({
      type: "warning",
      message: `Couldn't pause the sandbox (${errorText(err)}). It pauses by itself when its 30 minute timeout ends.`,
    });
    sse.send({ type: "sandbox", sandboxId: sbx.sandboxId, state: "running" });
  }
}

function callOutput(callId: string, output: string): InputItem {
  return { type: "function_call_output", call_id: callId, output };
}

function parseArgs(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function argsForUi(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" ? clip(v, UI_TEXT_LIMIT) : v]));
}
