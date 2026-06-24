/**
 * Playbook API — typed, READ-ONLY HTTP client (shadow lane).
 *
 * T1 deliverable for the `o-playbook-shadow-audit` ticket. Standalone:
 *   • No DB imports — pure HTTP layer.
 *   • NOT registered in lib/providers/factory.ts and does NOT implement
 *     IOddsProvider / ISharpSignalProvider. It is shadow-only by design;
 *     wiring it into production is a separate, later ticket.
 *   • Constructor-injected key — testable in isolation, never hardcoded.
 *   • The key is sent ONLY as the `api_key` query param (per docs) and is
 *     NEVER placed in a thrown message, log line, or error preview. A
 *     redact() pass strips it (and any api_key=… param) from all surfaced
 *     strings as defense-in-depth.
 *
 * Auth: `?api_key=<key>` query param (verified live 2026-06-24, 401 on bad).
 * Base: https://api.playbook-api.com
 *
 * Quota: Playbook returns the remaining count IN-BODY as `requestsRemaining`
 * (no x-ratelimit-* headers). The client captures it into quota state after
 * every call so callers can report burn without a separate /v1/me hit.
 */

import type {
  PlaybookHealth,
  PlaybookInjuriesResponse,
  PlaybookLeague,
  PlaybookLinesResponse,
  PlaybookMe,
  PlaybookQuotaSnapshot,
  PlaybookSplitsHistoryResponse,
  PlaybookSplitsResponse,
  PlaybookStartingPitchersResponse,
  PlaybookVenueWeatherResponse,
} from "./types";

const PLAYBOOK_BASE_URL = "https://api.playbook-api.com";
const DEFAULT_TIMEOUT_MS = 20_000;

export type PlaybookQuery = Record<string, string | number | undefined | null>;

export class PlaybookClientError extends Error {
  public readonly endpoint: string;
  public readonly status: number | null;
  public readonly bodyPreview: string;
  constructor(
    message: string,
    opts: { endpoint: string; status: number | null; bodyPreview?: string }
  ) {
    super(message);
    this.name = "PlaybookClientError";
    this.endpoint = opts.endpoint;
    this.status = opts.status;
    this.bodyPreview = opts.bodyPreview ?? "";
  }
}

export class PlaybookAuthError extends PlaybookClientError {
  constructor(opts: { endpoint: string; status: number; bodyPreview?: string }) {
    super(`Playbook auth failed (HTTP ${opts.status}) on ${opts.endpoint}`, opts);
    this.name = "PlaybookAuthError";
  }
}

export interface PlaybookResult<T> {
  /** The endpoint LABEL (path only — never includes the key). */
  endpoint: string;
  status: number;
  body: T;
  requestsRemaining: number | null;
}

export class PlaybookClient {
  private readonly apiKey: string;
  private quota: PlaybookQuotaSnapshot = {
    requestsRemaining: null,
    monthlyLimit: null,
  };

  constructor(apiKey: string) {
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error("PlaybookClient: apiKey must be a non-empty string");
    }
    this.apiKey = apiKey;
  }

  /** Strip the key (and any api_key=… param) from an arbitrary string. */
  private redact(s: string): string {
    let out = s.split(this.apiKey).join("***REDACTED***");
    out = out.replace(/api_key=[^&\s"']+/gi, "api_key=***REDACTED***");
    return out;
  }

  getQuotaState(): PlaybookQuotaSnapshot {
    return { ...this.quota };
  }

  /** Build a URL with the key as api_key. The returned string is NEVER logged. */
  private buildUrl(path: string, query: PlaybookQuery = {}): string {
    const u = new URL(`${PLAYBOOK_BASE_URL}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      u.searchParams.set(k, String(v));
    }
    u.searchParams.set("api_key", this.apiKey);
    return u.toString();
  }

  /**
   * Core GET. Returns the parsed body plus captured quota. Throws
   * PlaybookAuthError on 401/403 and PlaybookClientError otherwise — both
   * with the KEY REDACTED from every field. `label` is the path only.
   */
  async get<T>(path: string, query: PlaybookQuery = {}): Promise<PlaybookResult<T>> {
    const label = path; // never contains the key
    let res: Response;
    try {
      res = await globalThis.fetch(this.buildUrl(path, query), {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (e) {
      throw new PlaybookClientError(
        `Playbook network error on ${label}: ${this.redact(
          e instanceof Error ? e.message : String(e)
        )}`,
        { endpoint: label, status: null }
      );
    }

    const text = await res.text();

    if (res.status === 401 || res.status === 403) {
      throw new PlaybookAuthError({
        endpoint: label,
        status: res.status,
        bodyPreview: this.redact(text.slice(0, 300)),
      });
    }
    if (res.status < 200 || res.status >= 300) {
      throw new PlaybookClientError(`Playbook HTTP ${res.status} on ${label}`, {
        endpoint: label,
        status: res.status,
        bodyPreview: this.redact(text.slice(0, 300)),
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (e) {
      throw new PlaybookClientError(
        `Playbook response was not JSON on ${label}: ${this.redact(
          e instanceof Error ? e.message : String(e)
        )}`,
        { endpoint: label, status: res.status, bodyPreview: this.redact(text.slice(0, 300)) }
      );
    }

    const remaining =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).requestsRemaining === "number"
        ? ((body as Record<string, unknown>).requestsRemaining as number)
        : null;
    if (remaining !== null) this.quota.requestsRemaining = remaining;

    return { endpoint: label, status: res.status, body: body as T, requestsRemaining: remaining };
  }

  // ── Verified endpoints (live-confirmed 2026-06-24) ──────────────────────

  health(): Promise<PlaybookResult<PlaybookHealth>> {
    return this.get<PlaybookHealth>("/v1/health");
  }

  /** Account/plan/usage. Captures monthlyLimit into quota state. */
  async me(): Promise<PlaybookResult<PlaybookMe>> {
    const r = await this.get<PlaybookMe>("/v1/me");
    if (typeof r.body?.monthlyLimit === "number") {
      this.quota.monthlyLimit = r.body.monthlyLimit;
    }
    return r;
  }

  splits(league: PlaybookLeague | string): Promise<PlaybookResult<PlaybookSplitsResponse>> {
    return this.get<PlaybookSplitsResponse>("/v1/splits", { league });
  }

  lines(league: PlaybookLeague | string): Promise<PlaybookResult<PlaybookLinesResponse>> {
    return this.get<PlaybookLinesResponse>("/v1/lines", { league });
  }

  /** Frozen pregame splits for a past date (YYYY-MM-DD). */
  splitsHistory(
    league: PlaybookLeague | string,
    date: string
  ): Promise<PlaybookResult<PlaybookSplitsHistoryResponse>> {
    return this.get<PlaybookSplitsHistoryResponse>("/v1/splits-history", { league, date });
  }

  mlbVenueWeather(): Promise<PlaybookResult<PlaybookVenueWeatherResponse>> {
    return this.get<PlaybookVenueWeatherResponse>("/v1/venue-weather", { league: "mlb" });
  }

  mlbStartingPitchers(): Promise<PlaybookResult<PlaybookStartingPitchersResponse>> {
    return this.get<PlaybookStartingPitchersResponse>("/v1/mlb/starting-pitchers");
  }

  injuries(league: PlaybookLeague | string): Promise<PlaybookResult<PlaybookInjuriesResponse>> {
    return this.get<PlaybookInjuriesResponse>("/v1/injuries", { league });
  }

  // NOTE: Playbook also exposes context endpoints (teams, recent
  // form, head-to-head, pitcher-stats / strikeout-predictor). Their exact
  // paths are NOT yet live-verified, so they are intentionally omitted here —
  // add typed methods under the
  // `o-mlb-playbook-context` ticket once each path is confirmed. Until then
  // callers can use get<T>(path) directly for one-off probing.
}
