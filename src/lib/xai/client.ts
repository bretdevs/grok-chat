import OpenAI, { APIConnectionError, APIError, APIUserAbortError } from "openai";
import type { ErrorSource } from "@/lib/types";
import { XAI_BASE_URL } from "./endpoint";

export function createXai(apiKey: string, conversationId: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: XAI_BASE_URL,
    timeout: 600_000,
    // Retries happen in retry-network.ts so the UI can show them.
    maxRetries: 0,
    // Sticky routing for prompt caching on Chat Completions; Responses uses prompt_cache_key.
    defaultHeaders: { "x-grok-conv-id": conversationId },
  });
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly source: ErrorSource = "xai",
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export type ErrorInfo = { message: string; status?: number; source: ErrorSource };

/** Turns SDK, xAI ({ code, error }) and OpenAI-style ({ error: { message } }) failures into one shape. */
export function describeError(err: unknown): ErrorInfo {
  if (err instanceof UpstreamError) return { message: err.message, status: err.status, source: err.source };
  if (err instanceof APIError) {
    const body: unknown = err.error;
    let message = "";
    if (typeof body === "string") {
      message = body;
    } else if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      const nested = b.error as Record<string, unknown> | undefined;
      if (typeof b.message === "string") message = b.message;
      else if (typeof b.error === "string") message = b.error;
      else if (nested && typeof nested.message === "string") message = nested.message;
    }
    message ||= err.message.replace(/^\d{3}\s+/, "") || "The xAI request failed.";
    let status = err.status;
    // xAI answers some bad-key requests with 400 instead of 401.
    if (status === 400 && /api key|unauthori[sz]ed|authenticat/i.test(message)) status = 401;
    return { message, status, source: "xai" };
  }
  if (err instanceof Error) return { message: err.message, source: "server" };
  return { message: String(err), source: "server" };
}

export function isUserAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal && !signal.aborted) return false;
  return Boolean(signal?.aborted) || err instanceof APIUserAbortError || (err instanceof Error && err.name === "AbortError");
}

export function isConnectionError(err: unknown): boolean {
  return err instanceof APIConnectionError;
}
