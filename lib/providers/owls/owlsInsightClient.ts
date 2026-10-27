const DEFAULT_BASE_URL = "https://api.owlsinsight.com";
const DEFAULT_TIMEOUT_MS = 8_000;

export type OwlsSport = "mlb" | "nba" | "wnba" | "nfl" | "ncaaf" | "ncaab" | "nhl" | "soccer";

export type OwlsRateLimitSnapshot = {
  remainingMinute: number | null;
  remainingMonth: number | null;
};

export type OwlsResult<T> = {
  body: T;
  status: number;
  rateLimit: OwlsRateLimitSnapshot;
};

export class OwlsInsightClientError extends Error {
  readonly status: number | null;
  readonly endpoint: string;

  constructor(message: string, opts: { status?: number | null; endpoint: string; cause?: unknown }) {
    super(message, { cause: opts.cause });
    this.name = "OwlsInsightClientError";
    this.status = opts.status ?? null;
    this.endpoint = opts.endpoint;
  }
}

export class OwlsInsightAuthError extends OwlsInsightClientError {
  constructor(opts: { status: number; endpoint: string }) {
    super(`Owls Insight authentication failed (HTTP ${opts.status}) on ${opts.endpoint}`, opts);
    this.name = "OwlsInsightAuthError";
  }
}

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export class OwlsInsightClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    apiKey: string,
    opts: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
  ) {
    if (!apiKey.trim()) throw new Error("OwlsInsightClient: apiKey must be a non-empty string");
    this.apiKey = apiKey;
    this.baseUrl = trimBaseUrl(opts.baseUrl ?? process.env.OWLS_INSIGHT_BASE_URL ?? DEFAULT_BASE_URL);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async get<T>(path: string, query: Record<string, string | number | boolean | null | undefined> = {}): Promise<OwlsResult<T>> {
    const endpoint = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new OwlsInsightClientError(`Owls Insight network error on ${endpoint}`, { endpoint, cause });
    }

    const rateLimit: OwlsRateLimitSnapshot = {
      remainingMinute: headerNumber(response.headers, "x-ratelimit-remaining-minute"),
      remainingMonth: headerNumber(response.headers, "x-ratelimit-remaining-month"),
    };
    if (response.status === 401 || response.status === 403) {
      throw new OwlsInsightAuthError({ status: response.status, endpoint });
    }

    const raw = await response.text();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch (cause) {
      throw new OwlsInsightClientError(`Owls Insight returned non-JSON data on ${endpoint}`, {
        status: response.status,
        endpoint,
        cause,
      });
    }
    if (!response.ok) {
      throw new OwlsInsightClientError(`Owls Insight HTTP ${response.status} on ${endpoint}`, {
        status: response.status,
        endpoint,
      });
    }
    return { body: body as T, status: response.status, rateLimit };
  }

  odds<T>(sport: OwlsSport): Promise<OwlsResult<T>> {
    return this.get<T>(`/api/v1/${sport}/odds`);
  }

  splits<T>(sport: Exclude<OwlsSport, "soccer">): Promise<OwlsResult<T>> {
    return this.get<T>(`/api/v1/${sport}/splits`);
  }

  props<T>(sport: OwlsSport): Promise<OwlsResult<T>> {
    return this.get<T>(`/api/v1/${sport}/props`);
  }

  fair<T>(sport: OwlsSport): Promise<OwlsResult<T>> {
    return this.get<T>(`/api/v1/${sport}/fair`);
  }

  openingOdds<T>(eventId: string, limit = 5_000): Promise<OwlsResult<T>> {
    return this.get<T>("/api/v1/history/odds", { eventId, opening: true, limit });
  }

  closingOdds<T>(eventId: string, limit = 5_000): Promise<OwlsResult<T>> {
    return this.get<T>("/api/v1/history/closing-odds", { eventId, limit });
  }
}
