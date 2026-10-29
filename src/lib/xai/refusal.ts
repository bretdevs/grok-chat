const CSAM =
  /\b(child\s*(porn|pornography|sexual)|csam|loli|shota|prepubescent|under\s*age|minor\s*(sex|nude|porn)|pedo(phil)?)\b/i;

const REFUSAL: RegExp[] = [
  /\b(i('m| am) (not |un)?able to (help|assist|provide|comply|do that))/i,
  /\b(i (can't|cannot|won't|will not|must not|am unable to) (help|assist|provide|comply|fulfill|do that|answer))/i,
  /\b(i (must|have to|need to) (refuse|decline|reject))/i,
  /\bagainst (my|the) (guidelines|policies|programming|safety|acceptable use)/i,
  /\b(i('m| am) (sorry|afraid).{0,80}(can't|cannot|unable|won't))/i,
  /\bas an ai (language )?model.{0,60}(can't|cannot|unable|not allowed)/i,
  /\b(i (don't|do not) (feel comfortable|think i should))/i,
  /\b(that (request|query) (is|goes) (illegal|against|beyond))/i,
  /\b(i (can't|cannot) (engage|participate) in)/i,
  /\b(content.?policy|usage.?policy|safety.?policy).{0,40}(prevent|prohibit|don't allow)/i,
  /\b(i('ll| will) not (provide|give|assist with) (that|those|this))/i,
];

const HEDGE_HEAD =
  /^(sure[,]?\s+but|i (need|should|must|have) to (note|mention|warn|caution|prefix)|as an ai[^\n]{0,200}|i('m| am) (happy|glad) to help[^\n]{0,120}however[^\n]{0,200})\s*\n\n/i;

export function isCsamShaped(text: string): boolean {
  return CSAM.test(text);
}

export function isRefusal(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  if (isCsamShaped(t)) return false;
  if (/```[\s\S]{80,}/.test(t) || t.length > 1200) {
    const head = t.slice(0, 400);
    return REFUSAL.some((r) => r.test(head)) && t.length < 700;
  }
  return REFUSAL.some((r) => r.test(t));
}

export function shouldAbortStream(soFar: string): boolean {
  if (soFar.length > 500) return false;
  if (/```/.test(soFar) || /:::file/.test(soFar)) return false;
  if (isCsamShaped(soFar)) return false;
  return REFUSAL.some((r) => r.test(soFar));
}

export function trimHedge(text: string): string {
  const m = text.match(HEDGE_HEAD);
  if (!m) return text;
  const rest = text.slice(m[0].length);
  if (rest.trim().length < 80) return text;
  return rest;
}

export function stripEchoedPrefix(text: string, prefix: string): string {
  const p = prefix.trim();
  if (!p) return text;
  if (text.startsWith(p)) return text.slice(p.length).replace(/^\s*\n/, "");
  return text;
}
