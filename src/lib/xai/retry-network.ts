/** Backoff before retry 1 and retry 2. */
export const NETWORK_RETRY_DELAYS = [400, 1200];

export function isRetryableStatus(status?: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs the same request again, at most twice, when `isRetryable` says the failure was transport-level
 * (429/5xx, a stream that produced nothing, or a timeout we own). A user Stop never retries.
 */
export async function withNetworkRetry<T>(
  attempt: (n: number) => Promise<T>,
  opts: {
    enabled: boolean;
    signal: AbortSignal;
    isRetryable: (err: unknown) => boolean;
    onRetry: (n: number) => void;
  },
): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await attempt(n);
    } catch (err) {
      if (!opts.enabled || n >= NETWORK_RETRY_DELAYS.length || opts.signal.aborted || !opts.isRetryable(err)) throw err;
      opts.onRetry(n + 1);
      await sleep(NETWORK_RETRY_DELAYS[n], opts.signal);
    }
  }
}
