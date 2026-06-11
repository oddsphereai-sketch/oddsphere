/**
 * BallDontLie FIFA World Cup client — WC-2.
 *
 * Parallels the existing `_bdlClient.ts` MLB wrapper in shape, auth,
 * pagination, and error semantics. Two clients rather than one
 * configurable client to keep blast radius into the working MLB
 * pipeline at zero — `_bdlClient.ts` is byte-identical after WC-2.
 *
 * Base URL: `https://api.balldontlie.io` — note that BDL FIFA WC endpoints
 * live under `/fifa/worldcup/v1/...`, separate from the MLB `/mlb/v1/...`
 * base.
 *
 * Auth: BDL uses `Authorization: <key>` with NO Bearer prefix (verified
 * for MLB; FIFA WC GOAT tier uses the same auth header per the deep
 * probe pass).
 *
 * Pagination: BDL FIFA WC uses cursor pagination via `meta.next_cursor`
 * (same as MLB). `fetchAll` walks pages until `next_cursor` is null OR
 * the chunk is empty OR `maxPages` is hit.
 */

const BDL_FIFA_BASE_URL = "https://api.balldontlie.io";

export type QueryValue = string | number | boolean | Array<string | number>;
export type QueryParams = Record<string, QueryValue | undefined | null>;

export type BdlFifaRequestOptions = {
  path: string;
  query?: QueryParams;
  signal?: AbortSignal;
};

export type BdlFifaResponse<T> = {
  data: T;
  meta?: { next_cursor?: string | number | null; per_page?: number } | null;
};

export type QuotaSnapshot = {
  limit: number | null;
  remaining: number | null;
  resetEpoch: number | null;
};

export class BdlFifaClientError extends Error {
  public readonly endpoint: string;
  public readonly status: number | null;
  public readonly bodyPreview: string;

  constructor(
    message: string,
    opts: { endpoint: string; status: number | null; bodyPreview?: string },
  ) {
    super(message);
    this.name = "BdlFifaClientError";
    this.endpoint = opts.endpoint;
    this.status = opts.status;
    this.bodyPreview = opts.bodyPreview ?? "";
  }
}

export class BdlFifaAuthError extends BdlFifaClientError {
  constructor(opts: { endpoint: string; status: number; bodyPreview?: string }) {
    super(`BDL FIFA auth failed (HTTP ${opts.status}) on ${opts.endpoint}`, opts);
    this.name = "BdlFifaAuthError";
  }
}

export class BdlFifaNotFoundError extends BdlFifaClientError {
  constructor(opts: { endpoint: string; bodyPreview?: string }) {
    super(`BDL FIFA 404 on ${opts.endpoint}`, { ...opts, status: 404 });
    this.name = "BdlFifaNotFoundError";
  }
}

export class BdlFifaRateLimitError extends BdlFifaClientError {
  constructor(opts: { endpoint: string; bodyPreview?: string }) {
    super(`BDL FIFA rate limited (HTTP 429) on ${opts.endpoint}`, {
      ...opts,
      status: 429,
    });
    this.name = "BdlFifaRateLimitError";
  }
}

function buildUrl(path: string, query?: QueryParams): string {
  if (!query) return `${BDL_FIFA_BASE_URL}${path}`;
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
  return qs.length > 0 ? `${BDL_FIFA_BASE_URL}${path}?${qs}` : `${BDL_FIFA_BASE_URL}${path}`;
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
    limit: numOrNull(headers.get("x-ratelimit-limit") ?? headers.get("ratelimit-limit")),
    remaining: numOrNull(headers.get("x-ratelimit-remaining") ?? headers.get("ratelimit-remaining")),
    resetEpoch: numOrNull(headers.get("x-ratelimit-reset") ?? headers.get("ratelimit-reset")),
    retryAfter: numOrNull(headers.get("retry-after")),
  };
}

/**
 * Optional fetch override for tests. Production code uses globalThis.fetch;
 * the tests pass a recorded-response stub to verify pagination + parsing
 * without touching the live API.
 */
export type FetchLike = (
  input: string | URL,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export class BdlFifaClient {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private quota: QuotaSnapshot = { limit: null, remaining: null, resetEpoch: null };

  constructor(apiKey: string, opts?: { fetchImpl?: FetchLike }) {
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error("BdlFifaClient: apiKey must be a non-empty string");
    }
    this.apiKey = apiKey;
    this.fetchImpl = opts?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  getQuotaState(): QuotaSnapshot {
    return { ...this.quota };
  }

  async fetch<T>(opts: BdlFifaRequestOptions): Promise<BdlFifaResponse<T>> {
    if (this.quota.remaining === 0) await this.waitUntilReset();

    const url = buildUrl(opts.path, opts.query);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Authorization: this.apiKey, Accept: "application/json" },
        signal: opts.signal,
      });
    } catch (e) {
      throw new BdlFifaClientError(
        `BDL FIFA network error on ${opts.path}: ${e instanceof Error ? e.message : String(e)}`,
        { endpoint: opts.path, status: null },
      );
    }

    let quota = parseQuotaHeaders(res.headers);

    if (res.status === 429) {
      const waitSec = (quota.retryAfter ?? 65) + 2;
      await sleep(waitSec * 1000);
      this.quota.remaining = null;
      this.quota.resetEpoch = null;
      try {
        res = await this.fetchImpl(url, {
          headers: { Authorization: this.apiKey, Accept: "application/json" },
          signal: opts.signal,
        });
      } catch (e) {
        throw new BdlFifaClientError(
          `BDL FIFA network error on retry of ${opts.path}: ${e instanceof Error ? e.message : String(e)}`,
          { endpoint: opts.path, status: null },
        );
      }
      quota = parseQuotaHeaders(res.headers);
      if (res.status === 429) {
        const text = await res.text().catch(() => "");
        throw new BdlFifaRateLimitError({
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
      throw new BdlFifaAuthError({
        endpoint: opts.path,
        status: res.status,
        bodyPreview: text.slice(0, 500),
      });
    }
    if (res.status === 404) {
      throw new BdlFifaNotFoundError({
        endpoint: opts.path,
        bodyPreview: text.slice(0, 500),
      });
    }
    if (res.status < 200 || res.status >= 300) {
      throw new BdlFifaClientError(`BDL FIFA HTTP ${res.status} on ${opts.path}`, {
        endpoint: opts.path,
        status: res.status,
        bodyPreview: text.slice(0, 500),
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new BdlFifaClientError(
        `BDL FIFA response was not valid JSON on ${opts.path}: ${e instanceof Error ? e.message : String(e)}`,
        { endpoint: opts.path, status: res.status, bodyPreview: text.slice(0, 500) },
      );
    }

    const obj = (parsed ?? {}) as { data?: unknown; meta?: unknown };
    return {
      data: (obj.data ?? []) as T,
      meta: (obj.meta as BdlFifaResponse<T>["meta"]) ?? null,
    };
  }

  /**
   * Cursor-paginated fetchAll. BDL emits `meta.next_cursor` when more
   * pages exist. Stops on null/missing cursor, empty chunk, or maxPages
   * cap (defends against runaway loops).
   */
  async fetchAll<T>(
    opts: BdlFifaRequestOptions & { maxPages?: number },
  ): Promise<T[]> {
    const maxPages = opts.maxPages ?? 30;
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

/** Canonical endpoint paths used by the WC FIFA provider. */
export const BDL_FIFA_PATHS = {
  teams: "/fifa/worldcup/v1/teams",
  matches: "/fifa/worldcup/v1/matches",
  odds: "/fifa/worldcup/v1/odds",
} as const;
