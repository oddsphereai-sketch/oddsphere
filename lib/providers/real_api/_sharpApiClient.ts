/**
 * Shared HTTP client for SharpAPI.
 *
 * Used by SharpAPIOddsProvider (IOddsProvider) and SharpAPISignalProvider
 * (ISharpSignalProvider). Pattern lifted from Gate A's read-only probe
 * (scripts/probe-sharpapi.ts) — same defensive JSON parsing, promoted from
 * diagnostic to shared utility.
 *
 * Discipline:
 *   • No DB imports — pure HTTP layer
 *   • No service imports
 *   • Constructor-injected key — testable in isolation
 *   • Defensive JSON parse with raw 500-char preview on failure
 *   • Adaptive throttle on x-ratelimit-* headers + retry-after on 429
 *   • Typed error classes for caller discrimination
 *
 * Auth: SharpAPI uses `X-API-Key: <key>` header (verified Gate A probe
 * round 4). Bearer also documented but X-API-Key is preferred.
 *
 * Base URL: https://api.sharpapi.io/api/v1 (verified Gate A round 4 —
 * earlier guesses hit the marketing site).
 */

const SHARP_API_BASE_URL = "https://api.sharpapi.io/api/v1";

export type QueryValue = string | number | boolean | Array<string | number>;
export type QueryParams = Record<string, QueryValue | undefined | null>;

export type SharpApiRequestOptions = {
  path: string;
  query?: QueryParams;
  signal?: AbortSignal;
};

export type SharpApiResponse<T> = {
  data: T;
  pagination?: {
    total?: number;
    current_page?: number;
    per_page?: number;
    last_page?: number;
  } | null;
};

export type QuotaSnapshot = {
  limit: number | null;
  remaining: number | null;
  resetEpoch: number | null;
};

export class SharpApiClientError extends Error {
  public readonly endpoint: string;
  public readonly status: number | null;
  public readonly bodyPreview: string;

  constructor(
    message: string,
    opts: { endpoint: string; status: number | null; bodyPreview?: string }
  ) {
    super(message);
    this.name = "SharpApiClientError";
    this.endpoint = opts.endpoint;
    this.status = opts.status;
    this.bodyPreview = opts.bodyPreview ?? "";
  }
}

export class SharpApiAuthError extends SharpApiClientError {
  constructor(opts: { endpoint: string; status: number; bodyPreview?: string }) {
    super(`SharpAPI auth failed (HTTP ${opts.status}) on ${opts.endpoint}`, opts);
    this.name = "SharpApiAuthError";
  }
}

export class SharpApiNotFoundError extends SharpApiClientError {
  constructor(opts: { endpoint: string; bodyPreview?: string }) {
    super(`SharpAPI 404 on ${opts.endpoint}`, { ...opts, status: 404 });
    this.name = "SharpApiNotFoundError";
  }
}

export class SharpApiRateLimitError extends SharpApiClientError {
  constructor(opts: { endpoint: string; bodyPreview?: string }) {
    super(`SharpAPI rate limited (HTTP 429) on ${opts.endpoint}`, {
      ...opts,
      status: 429,
    });
    this.name = "SharpApiRateLimitError";
  }
}

function buildUrl(path: string, query?: QueryParams): string {
  if (!query) return `${SHARP_API_BASE_URL}${path}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const arrayKey = key.endsWith("[]") ? key : `${key}[]`;
      for (const v of value) params.append(arrayKey, String(v));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs.length > 0
    ? `${SHARP_API_BASE_URL}${path}?${qs}`
    : `${SHARP_API_BASE_URL}${path}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function numOrNull(s: string | null): number | null {
  if (s === null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseQuotaHeaders(headers: Headers): {
  limit: number | null;
  remaining: number | null;
  resetEpoch: number | null;
  retryAfter: number | null;
} {
  return {
    limit: numOrNull(
      headers.get("x-ratelimit-limit") ?? headers.get("ratelimit-limit")
    ),
    remaining: numOrNull(
      headers.get("x-ratelimit-remaining") ?? headers.get("ratelimit-remaining")
    ),
    resetEpoch: numOrNull(
      headers.get("x-ratelimit-reset") ?? headers.get("ratelimit-reset")
    ),
    retryAfter: numOrNull(headers.get("retry-after")),
  };
}

export class SharpApiClient {
  private readonly apiKey: string;
  private quota: QuotaSnapshot = {
    limit: null,
    remaining: null,
    resetEpoch: null,
  };

  constructor(apiKey: string) {
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error("SharpApiClient: apiKey must be a non-empty string");
    }
    this.apiKey = apiKey;
  }

  getQuotaState(): QuotaSnapshot {
    return { ...this.quota };
  }

  async fetch<T>(opts: SharpApiRequestOptions): Promise<SharpApiResponse<T>> {
    if (this.quota.remaining === 0) {
      await this.waitUntilReset();
    }

    const url = buildUrl(opts.path, opts.query);
    let res: Response;
    try {
      res = await globalThis.fetch(url, {
        headers: {
          "X-API-Key": this.apiKey,
          Accept: "application/json",
        },
        signal: opts.signal,
      });
    } catch (e) {
      throw new SharpApiClientError(
        `SharpAPI network error on ${opts.path}: ${
          e instanceof Error ? e.message : String(e)
        }`,
        { endpoint: opts.path, status: null }
      );
    }

    let quota = parseQuotaHeaders(res.headers);

    if (res.status === 429) {
      const waitSec = (quota.retryAfter ?? 65) + 2;
      await sleep(waitSec * 1000);
      this.quota.remaining = null;
      this.quota.resetEpoch = null;
      try {
        res = await globalThis.fetch(url, {
          headers: {
            "X-API-Key": this.apiKey,
            Accept: "application/json",
          },
          signal: opts.signal,
        });
      } catch (e) {
        throw new SharpApiClientError(
          `SharpAPI network error on retry of ${opts.path}: ${
            e instanceof Error ? e.message : String(e)
          }`,
          { endpoint: opts.path, status: null }
        );
      }
      quota = parseQuotaHeaders(res.headers);
      if (res.status === 429) {
        const text = await res.text().catch(() => "");
        throw new SharpApiRateLimitError({
          endpoint: opts.path,
          bodyPreview: text.slice(0, 500),
        });
      }
    }

    if (quota.limit !== null) this.quota.limit = quota.limit;
    if (quota.remaining !== null) this.quota.remaining = quota.remaining;
    if (quota.resetEpoch !== null) this.quota.resetEpoch = quota.resetEpoch;

    const text = await res.text();

    if (res.status === 401 || res.status === 403) {
      throw new SharpApiAuthError({
        endpoint: opts.path,
        status: res.status,
        bodyPreview: text.slice(0, 500),
      });
    }
    if (res.status === 404) {
      throw new SharpApiNotFoundError({
        endpoint: opts.path,
        bodyPreview: text.slice(0, 500),
      });
    }
    if (res.status < 200 || res.status >= 300) {
      throw new SharpApiClientError(
        `SharpAPI HTTP ${res.status} on ${opts.path}`,
        {
          endpoint: opts.path,
          status: res.status,
          bodyPreview: text.slice(0, 500),
        }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new SharpApiClientError(
        `SharpAPI response was not valid JSON on ${opts.path}: ${
          e instanceof Error ? e.message : String(e)
        }`,
        {
          endpoint: opts.path,
          status: res.status,
          bodyPreview: text.slice(0, 500),
        }
      );
    }

    const obj = (parsed ?? {}) as { data?: unknown; pagination?: unknown };
    return {
      data: (obj.data ?? []) as T,
      pagination: (obj.pagination as SharpApiResponse<T>["pagination"]) ?? null,
    };
  }

  /**
   * Page-based pagination via `?page=N`. SharpAPI returns `pagination.total`
   * and `pagination.last_page`; we walk pages until `current_page >=
   * last_page` or the data array is empty. Hard maxPages cap defends
   * against runaway loops.
   */
  async fetchAll<T>(
    opts: SharpApiRequestOptions & { maxPages?: number }
  ): Promise<T[]> {
    const maxPages = opts.maxPages ?? 10;
    const out: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const query: QueryParams = { ...(opts.query ?? {}), page };
      const res = await this.fetch<T[]>({
        path: opts.path,
        query,
        signal: opts.signal,
      });
      const chunk = Array.isArray(res.data) ? res.data : [];
      out.push(...chunk);
      const lastPage = res.pagination?.last_page ?? null;
      if (chunk.length === 0) break;
      if (lastPage !== null && page >= lastPage) break;
    }
    return out;
  }

  private async waitUntilReset(): Promise<void> {
    if (this.quota.resetEpoch === null) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const waitSec = Math.max(0, this.quota.resetEpoch - nowSec) + 2;
    await sleep(waitSec * 1000);
    this.quota.remaining = null;
    this.quota.resetEpoch = null;
  }
}
