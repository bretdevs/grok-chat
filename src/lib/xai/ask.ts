import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ApiMessage } from "@/lib/types";
import { describeError, UpstreamError } from "./client";
import { apiEndpoint } from "./endpoint";
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
  type ResponseRequest,
} from "./build-input";
import { sanitizeHistory } from "./history";
import { applyAttempt, samplingForAttempt, shouldRetryRefusal, transformOutput } from "./pipeline";
import { expandPing, isGreeting } from "./rewrite";
import { newTextState, runResponseTurn, type ResponseResult, type TextState } from "./stream";
import { SUBMIT_RESULT_NAME } from "./submit-result";
import { incompleteNotice, SourceCollector, submitCallIds, TurnLimits, type TurnContext } from "./turn";
import { docsAsText, prepareXaiUploads } from "./uploads";

const MIN_RETRY_MS = 90_000;

export async function runAsk(ctx: TurnContext): Promise<void> {
  const { sse, settings } = ctx;
  const limits = new TurnLimits(ctx.signal);
  const greet = isGreeting(ctx.current.content);
  const search = greet ? null : ctx.search;
  const notes = requestTimeNotes({ agent: false, search: Boolean(search), userText: ctx.current.content });
  const system = systemText(notes);
  const version = promptVersion(system);
  const text = newTextState();
  const sources = new SourceCollector();

  try {
    const fileIds = [...(ctx.current.fileIds ?? [])];
    const images = [...(ctx.current.images ?? [])];
    let docs: File[] = [];
    let currentText = expandPing(ctx.current.content);
    if (ctx.uploads.length) {
      sse.send({ type: "status", text: ctx.uploads.length > 1 ? `Uploading ${ctx.uploads.length} files` : "Uploading file" });
      const prepared = await prepareXaiUploads(ctx.client, ctx.uploads, limits.signal, settings.networkRetry ? 2 : 0);
      sse.send({ type: "uploads", files: prepared.results });
      const failed = prepared.results.find((r) => r.error);
      if (failed) throw new UpstreamError(`Upload failed for ${failed.name}: ${failed.error}`);
      fileIds.push(...prepared.fileIds);
      images.push(...prepared.images);
      docs = prepared.docs;
      if (prepared.texts.length) currentText = [currentText, ...prepared.texts].filter(Boolean).join("\n\n");
    }

    const history = sanitizeHistory(ctx.history);
    const content = userContent(currentText, fileIds, images);
    const chained = apiEndpoint().chain && Boolean(ctx.previousResponseId) && ctx.clientPromptVersion === version;
    const fullInput = () => buildInput({ history: history.map(historyItem), userContent: content, notes });
    const req: ResponseRequest = {
      model: ctx.model,
      input: chained ? [...openCallOutputs(ctx.openCallIds), { role: "user", content }] : fullInput(),
      fullInput: chained ? fullInput : undefined,
      previousResponseId: chained ? ctx.previousResponseId : undefined,
      tools: mergeTools({ search, submitResult: greet ? false : settings.submitResult, agent: false }),
      include: search ? ["inline_citations"] : undefined,
      instructions: instructionsText(settings.extraInstructions),
      temperature: settings.temperature,
      topP: settings.topP,
      conversationId: ctx.conversationId,
      reasoningEffort: "low",
    };

    sse.send({ type: "status", text: "Thinking" });
    let result: ResponseResult | undefined;
    let attempt = 0;
    const skipPrefill = true;

    while (attempt <= 1) {
      text.full = "";
      text.lastItem = undefined;

      const sampling = samplingForAttempt(attempt, settings.temperature, settings.topP);
      const attemptedFull = () => applyAttempt(fullInput(), attempt, skipPrefill);

      const attemptReq: ResponseRequest = {
        ...req,
        input: attemptedFull(),
        fullInput: attemptedFull,
        previousResponseId: attempt === 0 && chained ? req.previousResponseId : undefined,
        conversationId: attempt === 0 ? req.conversationId : `${req.conversationId}-r${attempt}`,
        temperature: sampling.temperature,
        topP: sampling.topP,
        reasoningEffort: "low",
        tools: attempt === 0 ? req.tools : mergeTools({ search: null, submitResult: false, agent: false }),
        include: undefined,
      };

      const client =
        attempt === 0
          ? ctx.client
          : ctx.client.withOptions({
              defaultHeaders: { "x-grok-conv-id": `${ctx.conversationId}-r${attempt}` },
            });

      if (attempt > 0) {
        sse.send({ type: "replace", text: "" });
        sse.send({ type: "retrying", n: attempt });
      }

      try {
        result = await runResponseTurn(
          client,
          attemptReq,
          {
            text,
            emit: (ev) => sse.send(ev),
            isLocalFunction: (name) => name === SUBMIT_RESULT_NAME,
            onBuiltinStep: () => limits.addStep(),
          },
          { signal: limits.signal, networkRetry: settings.networkRetry, onRetry: (n) => sse.send({ type: "retrying", n }) },
        );
      } catch (err) {
        const info = describeError(err);
        if (/shared source authorization/i.test(info.message) && attempt < 1) {
          sse.send({ type: "replace", text: "" });
          sse.send({ type: "retrying", n: attempt + 1 });
          await new Promise((r) => setTimeout(r, 400));
          attempt += 1;
          continue;
        }
        if (limits.reason || search || text.full || !isShapeError(info.status)) throw err;
        sse.send({ type: "status", text: "Trying chat completions" });
        await runChatFallback(
          ctx,
          system,
          history,
          currentText + (docs.length ? `\n\n${await docsAsText(docs)}` : ""),
          images,
          text,
          limits.signal,
        );
        sse.send({ type: "done", mode: "chat", promptVersion: version });
        return;
      }

      const raw = text.full;
      const budgetLeft = limits.deadline - Date.now();
      if (greet || !shouldRetryRefusal(raw, attempt) || budgetLeft < MIN_RETRY_MS) {
        const finalText = transformOutput(raw);
        if (finalText !== raw || attempt > 0) sse.send({ type: "replace", text: finalText });
        text.full = finalText;
        break;
      }
      sse.send({ type: "replace", text: "" });
      await new Promise((r) => setTimeout(r, 250));
      attempt += 1;
    }

    if (!result) throw new Error("No model response.");

    sources.add(result, text.full);
    sources.flush(sse);
    sse.send({
      type: "done",
      mode: "responses",
      responseId: result.incomplete ? undefined : result.responseId,
      usage: result.usage,
      promptVersion: version,
      openCallIds: submitCallIds(result),
      notice: incompleteNotice(result.incomplete),
    });
  } catch (err) {
    if (limits.reason === "user") return;
    if (limits.reason) {
      sources.flush(sse);
      sse.send({ type: "done", mode: "responses", promptVersion: version, notice: limits.notice() });
      return;
    }
    sse.send({ type: "error", ...describeError(err) });
  } finally {
    limits.dispose();
  }
}

function isShapeError(status?: number): boolean {
  return status === 400 || status === 404 || status === 405 || status === 415 || status === 422;
}

async function runChatFallback(
  ctx: TurnContext,
  system: string,
  history: ApiMessage[],
  currentText: string,
  images: string[],
  text: TextState,
  signal: AbortSignal,
): Promise<void> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "system", content: instructionsText(ctx.settings.extraInstructions) },
    ...history.map((m): ChatCompletionMessageParam =>
      m.role === "assistant"
        ? { role: "assistant", content: m.content }
        : { role: "user", content: chatContent(m.content + earlierFilesNote(m.fileIds), m.images ?? []) },
    ),
    { role: "user", content: chatContent(currentText + earlierFilesNote(ctx.current.fileIds), images) },
  ];
  const stream = await ctx.client.chat.completions.create(
    {
      model: ctx.model,
      messages,
      stream: true,
      ...(ctx.settings.temperature !== undefined ? { temperature: ctx.settings.temperature } : {}),
      ...(ctx.settings.topP !== undefined ? { top_p: ctx.settings.topP } : {}),
    },
    { signal },
  );
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (!delta) continue;
    text.full += delta;
    ctx.sse.send({ type: "delta", text: delta });
  }
}

function chatContent(text: string, images: string[]): string | ChatCompletionContentPart[] {
  if (!images.length) return text;
  return [{ type: "text", text }, ...images.map((url): ChatCompletionContentPart => ({ type: "image_url", image_url: { url, detail: "high" } }))];
}

function earlierFilesNote(fileIds?: string[]): string {
  return fileIds?.length ? `\n\n(${fileIds.length} attached file(s) are not readable in this fallback mode.)` : "";
}
