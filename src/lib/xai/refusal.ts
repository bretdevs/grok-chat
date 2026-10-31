const CSAM =
  /\b(child\s*(porn|pornography|sexual)|csam|loli|shota|prepubescent|under\s*age|minor\s*(sex|nude|porn)|pedo(phil)?)\b/i;

function norm(s: string): string {
  return s
    .replace(/[\u2018\u2019\u02BC\u0060]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const REFUSAL: RegExp[] = [
  /^no\.\s+i\s+won'?t\b/i,
  /\bi\s+won'?t\s+(help|assist|do that|do this)\b/i,
  /\bi\s+will\s+not\s+(help|assist|provide|write|build|create|discuss|explain)\b/i,
  /\bi('m| am) (not |un)?able to (help|assist|provide|comply|do that|do this)/i,
  /\bi (can't|cannot|won'?t|will not|must not|am unable to) (help|assist|provide|comply|fulfill|do that|do this|answer|discuss|explain|go into)/i,
  /\bi (can't|cannot)\b.{0,40}\b(help|assist|provide)\b/i,
  /\b(i (must|have to|need to) (refuse|decline|reject))/i,
  /\bagainst (my|the) (guidelines|policies|programming|safety|acceptable use|terms)/i,
  /\bi('m| am) (sorry|afraid).{0,100}(can't|cannot|unable|won'?t)/i,
  /\bas an ai (language )?model.{0,80}(can't|cannot|unable|not allowed|won't)/i,
  /\bi (don't|do not) (feel comfortable|think i should|provide help)/i,
  /\b(that (request|query|topic) (is|goes) (illegal|against|beyond))/i,
  /\b(that is illegal|that's illegal|this is illegal)\b/i,
  /\billegal\b.{0,80}\b(can't|cannot|won'?t|will not)\b/i,
  /\b(can't|cannot|won'?t|will not)\b.{0,80}\billegal\b/i,
  /\bi (can't|cannot) (engage|participate|help you) (in|with)/i,
  /\b(content.?policy|usage.?policy|safety.?policy|acceptable use).{0,60}(prevent|prohibit|don't allow|do not allow)/i,
  /\bi('ll| will) not (provide|give|assist with|help with) (that|those|this)/i,
  /\bi (can't|cannot|won't) help with that/i,
  /\bnot going to (help|assist|provide)/i,
];

const HEDGE_HEAD =
  /^(sure[,]?\s+but|i (need|should|must|have) to (note|mention|warn|caution|prefix)|as an ai[^\n]{0,200}|i('m| am) (happy|glad) to help[^\n]{0,120}however[^\n]{0,200})\s*\n\n/i;

export function isCsamShaped(text: string): boolean {
  return CSAM.test(norm(text));
}

export function isRefusal(text: string): boolean {
  const t = norm(text);
  if (t.length < 8) return false;
  if (isCsamShaped(t)) return false;
  if (/```[\s\S]{80,}/.test(text) && t.length > 900) return false;
  if (REFUSAL.some((r) => r.test(t))) return true;
  if (t.length < 900 && /\billegal\b/i.test(t) && /\b(can't|cannot|won'?t|will not|unable)\b/i.test(t)) return true;
  return false;
}

export function shouldAbortStream(soFar: string): boolean {
  if (soFar.length > 600) return false;
  if (/```/.test(soFar) || /:::file/.test(soFar)) return false;
  if (isCsamShaped(soFar)) return false;
  return isRefusal(soFar);
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
  const n = norm(text);
  const np = norm(p);
  if (n.startsWith(np)) {
    const cut = text.length - (n.length - np.length);
    return text.slice(Math.max(0, cut)).replace(/^\s*\n/, "");
  }
  if (text.startsWith(p)) return text.slice(p.length).replace(/^\s*\n/, "");
  return text;
}
