/**
 * fetchWithRetry — exponential-backoff fetch with 429 / 5xx awareness.
 *
 * Single retry layer for the whole stack (services / providers / crons all
 * delegate here). Services do NOT add their own retry; this prevents
 * 9× retry storms when 3 calls each retry 3×.
 *
 * Default behavior:
 *   • max 3 attempts (initial + 2 retries)
 *   • exponential backoff: 1s, 2s, 4s
 *   • retryable: 429 (rate limit), 5xx (server)
 *   • non-retryable 4xx: throws immediately (auth, bad request, etc.)
 *   • network/abort errors: retried up to max
 *   • Retry-After header is honored on 429
 *
 * Throws on max-retries exceeded with the last error preserved.
 */

export type FetchWithRetryOptions = {
  maxRetries?: number;
  initialBackoffMs?: number;
  retryableStatuses?: readonly number[];
  /** Override for tests — lets us pass a fake clock. */
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULTS = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  retryableStatuses: [429, 500, 502, 503, 504] as const,
} as const;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return Math.max(0, asNumber) * 1000;
  const asDate = Date.parse(value);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

export class NonRetryableHttpError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string) {
    super(`HTTP ${status} ${statusText} (non-retryable)`);
    this.name = "NonRetryableHttpError";
    this.status = status;
  }
}

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
  const initialBackoffMs = options.initialBackoffMs ?? DEFAULTS.initialBackoffMs;
  const retryable = new Set<number>(
    options.retryableStatuses ?? DEFAULTS.retryableStatuses
  );
  const sleep = options.sleep ?? defaultSleep;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok) return res;
      if (!retryable.has(res.status)) {
        // Auth, validation, not-found, etc. — retry won't help.
        throw new NonRetryableHttpError(res.status, res.statusText);
      }
      lastError = new Error(`HTTP ${res.status} ${res.statusText}`);
      // Last attempt — let outer throw happen
      if (attempt === maxRetries - 1) break;
      // Respect Retry-After on 429
      const retryAfterMs = res.status === 429
        ? parseRetryAfter(res.headers.get("Retry-After"))
        : null;
      const backoff = retryAfterMs !== null
        ? retryAfterMs
        : initialBackoffMs * Math.pow(2, attempt);
      await sleep(backoff);
    } catch (e) {
      // Non-retryable HTTP — propagate immediately
      if (e instanceof NonRetryableHttpError) throw e;
      lastError = e as Error;
      if (attempt === maxRetries - 1) break;
      await sleep(initialBackoffMs * Math.pow(2, attempt));
    }
  }

  throw lastError ?? new Error("fetchWithRetry: max retries exceeded");
}
