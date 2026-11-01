/**
 * A small in-memory limit for the sign-in routes, so one address can't grind through passwords or
 * create accounts in bulk. One container holds the counters; that is enough for a single server.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 5000;

const hits = new Map<string, number[]>();

export function tooMany(key: string, limit: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > MAX_ENTRIES) sweep(now);
  return false;
}

/** Forgets the attempts for a key, so a correct password clears the lockout. */
export function forget(key: string): void {
  hits.delete(key);
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

function sweep(now: number): void {
  for (const [key, times] of hits) {
    if (times.every((at) => now - at >= WINDOW_MS)) hits.delete(key);
  }
}
