/**
 * Shared HTTP client for Ball Don't Lie MLB API.
 *
 * Used by BallDontLieProvider (IPlayerStatsProvider) and
 * BallDontLieSlateProvider (ISlateProvider). Pattern lifted from Gate A's
 * read-only probe script (scripts/probe-balldontlie.ts) — same quota-adaptive
 * pacing, same defensive JSON parsing, promoted from one-shot diagnostic to
 * shared utility.
 *
 * Discipline:
 *   • No DB imports — pure HTTP layer
 *   • No service imports
 *   • Constructor-injected key — testable in isolation
 *   • Defensive JSON parse with raw 500-char preview on failure
 *   • Adaptive throttle reads x-ratelimit-* headers; waits for reset on
 *     remaining=0; honors retry-after on 429
 *   • Typed error classes so callers can discriminate (auth / not-found /
 *     rate-limit / generic)
 *
 * Auth: BDL uses `Authorization: <key>` with NO Bearer prefix (verified in
 * Gate A probe round 1).
 */

const BDL_BASE_URL = "https://api.balldontlie.io/mlb/v1";

export type QueryValue = string | number | boolean | Array<string | number>;
export type QueryParams = Record<string, QueryValue | undefined | null>;

export type BdlRequestOptions = {
  path: string;
  query?: QueryParams;
  signal?: AbortSignal;
};

export type BdlResponse<T> = {
  data: T;
  meta?: { next_cursor?: string | number | null; per_page?: number } | null;
};

export type QuotaSnapshot = {
  limit: number | null;
  remaining: number | null;
  resetEpoch: number | null;
};

export class BdlClientError extends Error {
  public readonly endpoint: string;
  public readonly status: number | null;
  public readonly bodyPreview: string;

  constructor(
    message: string,
    opts: { endpoint: string; status: number | null; bodyPreview?: string }
  ) {
    super(message);
    this.name = "BdlClientError";
    this.endpoint = opts.endpoint;
    this.status = opts.status;
    this.bodyPreview = opts.bodyPreview ?? "";
  }
}

export class BdlAuthError extends BdlClientError {
  constructor(opts: { endpoint: string; status: number; bodyPreview?: string }) {
    super(`BDL auth failed (HTTP ${opts.status}) on ${opts.endpoint}`, opts);
    this.name = "BdlAuthError";
  }
}

export class BdlNotFoundError extends BdlClientError {
  constructor(opts: { endpoint: string; bodyPreview?: string }) {
    super(`BDL 404 on ${opts.endpoint}`, { ...opts, status: 404 });
    this.name = "BdlNotFoundError";
  }
}

export class BdlRateLimitError extends BdlClientError {
  constructor(opts: { endpoint: string; bodyPreview?: string }) {
    super(`BDL rate limited (HTTP 429) on ${opts.endpoint}`, {
      ...opts,
      status: 429,
    });
    this.name = "BdlRateLimitError";
  }
}

function buildUrl(path: string, query?: QueryParams): string {
  if (!query) return `${BDL_BASE_URL}${path}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      // BDL uses `?team_ids[]=N&team_ids[]=M` for array params.
      const arrayKey = key.endsWith("[]") ? key : `${key}[]`;
      for (const v of value) params.append(arrayKey, String(v));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs.length > 0 ? `${BDL_BASE_URL}${path}?${qs}` : `${BDL_BASE_URL}${path}`;
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

export class BdlClient {
  private readonly apiKey: string;
  private requestCount = 0;
  private quota: QuotaSnapshot = {
    limit: null,
    remaining: null,
    resetEpoch: null,
  };

  constructor(apiKey: string) {
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error("BdlClient: apiKey must be a non-empty string");
    }
    this.apiKey = apiKey;
  }

  getQuotaState(): QuotaSnapshot {
    return { ...this.quota };
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  async fetch<T>(opts: BdlRequestOptions): Promise<BdlResponse<T>> {
    // If the previous response told us we're out of quota, wait for reset
    // before issuing the next request. First call has no prior state so
    // proceeds immediately.
    if (this.quota.remaining === 0) {
      await this.waitUntilReset();
    }

    const url = buildUrl(opts.path, opts.query);
    let res: Response;
    try {
      this.requestCount++;
      res = await globalThis.fetch(url, {
        headers: {
          Authorization: this.apiKey,
          Accept: "application/json",
        },
        signal: opts.signal,
      });
    } catch (e) {
      throw new BdlClientError(
        `BDL network error on ${opts.path}: ${e instanceof Error ? e.message : String(e)}`,
        { endpoint: opts.path, status: null }
      );
    }

    let quota = parseQuotaHeaders(res.headers);

    // On 429: honor retry-after (or 65s fallback) then retry once. The
    // retry doesn't loop further — if it fails again, surface as
    // BdlRateLimitError.
    if (res.status === 429) {
      const waitSec = (quota.retryAfter ?? 65) + 2;
      await sleep(waitSec * 1000);
      this.quota.remaining = null;
      this.quota.resetEpoch = null;
      try {
        this.requestCount++;
        res = await globalThis.fetch(url, {
          headers: {
            Authorization: this.apiKey,
            Accept: "application/json",
          },
          signal: opts.signal,
        });
      } catch (e) {
        throw new BdlClientError(
          `BDL network error on retry of ${opts.path}: ${
            e instanceof Error ? e.message : String(e)
          }`,
          { endpoint: opts.path, status: null }
        );
      }
      quota = parseQuotaHeaders(res.headers);
      if (res.status === 429) {
        const text = await res.text().catch(() => "");
        throw new BdlRateLimitError({
          endpoint: opts.path,
          bodyPreview: text.slice(0, 500),
        });
      }
    }

    // Update tracked quota from latest response.
    if (quota.limit !== null) this.quota.limit = quota.limit;
    if (quota.remaining !== null) this.quota.remaining = quota.remaining;
    if (quota.resetEpoch !== null) this.quota.resetEpoch = quota.resetEpoch;

    // Read body as text first so we can preserve the raw payload on
    // JSON parse failures.
    const text = await res.text();

    if (res.status === 401 || res.status === 403) {
      throw new BdlAuthError({
        endpoint: opts.path,
        status: res.status,
        bodyPreview: text.slice(0, 500),
      });
    }
    if (res.status === 404) {
      throw new BdlNotFoundError({
        endpoint: opts.path,
        bodyPreview: text.slice(0, 500),
      });
    }
    if (res.status < 200 || res.status >= 300) {
      throw new BdlClientError(
        `BDL HTTP ${res.status} on ${opts.path}`,
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
      throw new BdlClientError(
        `BDL response was not valid JSON on ${opts.path}: ${
          e instanceof Error ? e.message : String(e)
        }`,
        {
          endpoint: opts.path,
          status: res.status,
          bodyPreview: text.slice(0, 500),
        }
      );
    }

    const obj = (parsed ?? {}) as { data?: unknown; meta?: unknown };
    return {
      data: (obj.data ?? []) as T,
      meta: (obj.meta as BdlResponse<T>["meta"]) ?? null,
    };
  }

  /**
   * Cursor-paginated fetchAll. BDL returns `meta.next_cursor` when more
   * pages exist. Hard maxPages cap defends against runaway loops.
   */
  async fetchAll<T>(
    opts: BdlRequestOptions & { maxPages?: number }
  ): Promise<T[]> {
    const maxPages = opts.maxPages ?? 20;
    const out: T[] = [];
    let cursor: string | number | null | undefined = undefined;
    for (let page = 0; page < maxPages; page++) {
      const query: QueryParams = { ...(opts.query ?? {}) };
      if (cursor !== undefined && cursor !== null) {
        query.cursor = cursor;
      }
      const res = await this.fetch<T[]>({
        path: opts.path,
        query,
        signal: opts.signal,
      });
      const chunk = Array.isArray(res.data) ? res.data : [];
      out.push(...chunk);
      const nextCursor = res.meta?.next_cursor ?? null;
      if (nextCursor === null || nextCursor === undefined || chunk.length === 0) {
        break;
      }
      cursor = nextCursor;
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
