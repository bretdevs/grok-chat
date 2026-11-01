import { CONTINUE_V1, CONTINUE_V2, PREFILL_V0, PREFILL_V1, PREFILL_V2 } from "./developer-note";
import { isCsamShaped, isRefusal, stripEchoedPrefix, trimHedge } from "./refusal";
import type { InputItem } from "./build-input";

const PREFILLS = new Set([PREFILL_V0, PREFILL_V1, PREFILL_V2]);

export function applyAttempt(input: InputItem[], attempt: number, skipPrefill = true): InputItem[] {
  const next = [...input];
  if (attempt === 0 && !skipPrefill) next.push({ role: "assistant", content: PREFILL_V0 });
  if (attempt === 1) {
    next.push({ role: "user", content: CONTINUE_V1 });
    if (!skipPrefill) next.push({ role: "assistant", content: PREFILL_V1 });
  }
  if (attempt === 2) {
    next.push({ role: "user", content: CONTINUE_V2 });
    if (!skipPrefill) next.push({ role: "assistant", content: PREFILL_V2 });
  }
  return next;
}

export function applyAgentAttempt(input: InputItem[], extraUser: string): InputItem[] {
  return [...input, { role: "user", content: extraUser }];
}

export function samplingForAttempt(attempt: number, temperature?: number, topP?: number) {
  if (attempt === 0) return { temperature, topP };
  return { temperature: Math.min(1.2, (temperature ?? 0.8) + 0.3), topP: 0.95 };
}

export function shouldRetryRefusal(text: string, attempt: number): boolean {
  if (isCsamShaped(text)) return false;
  return isRefusal(text) && attempt < 1;
}

export function transformOutput(text: string): string {
  let out = text;
  for (const p of PREFILLS) out = stripEchoedPrefix(out, p);
  return trimHedge(out);
}
