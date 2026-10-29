import { CONTINUE_V1, CONTINUE_V2, PREFILL_V0 } from "./developer-note";
import { isCsamShaped, isRefusal, stripEchoedPrefix, trimHedge } from "./refusal";
import type { InputItem } from "./build-input";

export function applyAttempt(input: InputItem[], attempt: number): InputItem[] {
  const next = [...input];
  if (attempt === 0) next.push({ role: "assistant", content: PREFILL_V0 });
  if (attempt === 1) next.push({ role: "user", content: CONTINUE_V1 });
  if (attempt === 2) next.push({ role: "user", content: CONTINUE_V2 });
  return next;
}

export function samplingForAttempt(attempt: number, temperature?: number, topP?: number) {
  if (attempt === 0) return { temperature, topP };
  if (attempt === 1) return { temperature: Math.min(1.2, (temperature ?? 0.8) + 0.3), topP: 0.95 };
  return { temperature: 1, topP: 0.95 };
}

export function shouldRetryRefusal(text: string, attempt: number): boolean {
  if (isCsamShaped(text)) return false;
  return isRefusal(text) && attempt < 2;
}

export function transformOutput(text: string): string {
  return trimHedge(stripEchoedPrefix(text, PREFILL_V0));
}
