/**
 * Raw BALLDONTLIE NBA research collector.
 *
 * This client deliberately preserves provider rows. Point-in-time feature
 * construction happens later and must lag every game outcome. A historical
 * final row is evidence, never permission to expose that result to its own
 * pregame feature vector.
 */

export const NBA_BDL_HISTORICAL_RESEARCH_RELEASE =
  "nba_bdl_historical_research_2026_10_15_r1" as const;

export type NbaBdlHistoricalDataset = "games" | "box" | "advanced" | "opening_odds";
export type NbaBdlHistoricalSeasonType = "regular" | "ist";

export type NbaBdlHistoricalFetch = {
  release: typeof NBA_BDL_HISTORICAL_RESEARCH_RELEASE;
  dataset: NbaBdlHistoricalDataset;
  rows: Record<string, unknown>[];
  requests: number;
  complete: boolean;
  nextCursor: string | null;
};

type PageEnvelope = {
  data?: unknown;
  meta?: { next_cursor?: unknown } | null;
};

const ENDPOINTS: Record<NbaBdlHistoricalDataset, string> = {
  games: "https://api.balldontlie.io/v1/games",
  box: "https://api.balldontlie.io/v1/stats",
  advanced: "https://api.balldontlie.io/nba/v2/stats/advanced",
  opening_odds: "https://api.balldontlie.io/nba/v2/odds/opening",
};

const DEFAULT_MAX_PAGES = 1_000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_RETRIES = 4;

function integer(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && Number.isFinite(number) ? number : null;
}

function cursor(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1_000);
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) return Math.min(60_000, Math.max(0, timestamp - Date.now()));
  }
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

async function requestPage(args: {
  url: URL;
  apiKey: string;
  fetchImpl: typeof fetch;
  sleepImpl: (milliseconds: number) => Promise<void>;
  maxRetries: number;
}): Promise<{ envelope: PageEnvelope; requests: number }> {
  for (let attempt = 0; attempt <= args.maxRetries; attempt += 1) {
    const response = await args.fetchImpl(args.url, {
      headers: { Authorization: args.apiKey, Accept: "application/json" },
    });
    const body = await response.text();
    if (response.ok) {
      try {
        return { envelope: JSON.parse(body) as PageEnvelope, requests: attempt + 1 };
      } catch {
        throw new Error(`BALLDONTLIE NBA ${args.url.pathname} returned invalid JSON.`);
      }
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === args.maxRetries) {
      throw new Error(
        `BALLDONTLIE NBA ${args.url.pathname} failed with HTTP ${response.status}: ${body.slice(0, 200)}`,
      );
    }
    await args.sleepImpl(retryDelayMs(response, attempt));
  }
  throw new Error("BALLDONTLIE NBA historical request exhausted retries.");
}

function buildUrl(args: {
  dataset: NbaBdlHistoricalDataset;
  season?: number;
  seasonType?: NbaBdlHistoricalSeasonType;
  dates?: readonly string[];
  gameIds?: readonly number[];
  cursor?: string;
}): URL {
  const url = new URL(ENDPOINTS[args.dataset]);
  url.searchParams.set("per_page", String(DEFAULT_PAGE_SIZE));
  if (args.season !== undefined) url.searchParams.append("seasons[]", String(args.season));
  if (args.seasonType !== undefined && args.dataset !== "advanced") {
    url.searchParams.set("season_type", args.seasonType);
  }
  if (args.dataset === "advanced") url.searchParams.set("period", "0");
  for (const date of args.dates ?? []) url.searchParams.append("dates[]", date);
  for (const gameId of args.gameIds ?? []) url.searchParams.append("game_ids[]", String(gameId));
  if (args.cursor) url.searchParams.set("cursor", args.cursor);
  return url;
}

export async function fetchNbaBdlHistoricalRows(args: {
  dataset: NbaBdlHistoricalDataset;
  season?: number;
  seasonType?: NbaBdlHistoricalSeasonType;
  dates?: readonly string[];
  gameIds?: readonly number[];
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  requestIntervalMs?: number;
  maxPages?: number;
  maxRetries?: number;
}): Promise<NbaBdlHistoricalFetch> {
  const apiKey = args.apiKey ?? process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for NBA historical research.");
  if (args.season !== undefined && (!Number.isInteger(args.season) || args.season < 1996 || args.season > 2100)) {
    throw new Error("NBA historical season must be an integer from 1996 through 2100.");
  }
  if (args.dataset !== "opening_odds" && args.season === undefined && (args.gameIds?.length ?? 0) === 0) {
    throw new Error(`NBA historical ${args.dataset} requires a season or exact game IDs.`);
  }
  if (args.dataset === "opening_odds" && (args.dates?.length ?? 0) === 0 && (args.gameIds?.length ?? 0) === 0) {
    throw new Error("NBA opening-odds research requires exact dates or game IDs.");
  }
  const maxPages = args.maxPages ?? DEFAULT_MAX_PAGES;
  const maxRetries = args.maxRetries ?? DEFAULT_MAX_RETRIES;
  const requestIntervalMs = args.requestIntervalMs ?? 0;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > DEFAULT_MAX_PAGES) {
    throw new Error(`NBA historical maxPages must be an integer from 1 through ${DEFAULT_MAX_PAGES}.`);
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 8) {
    throw new Error("NBA historical maxRetries must be an integer from 0 through 8.");
  }
  if (!Number.isFinite(requestIntervalMs) || requestIntervalMs < 0 || requestIntervalMs > 60_000) {
    throw new Error("NBA historical requestIntervalMs must be from 0 through 60000.");
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  const sleepImpl = args.sleepImpl ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const rows: Record<string, unknown>[] = [];
  let nextCursor: string | null = null;
  let requests = 0;
  for (let page = 0; page < maxPages; page += 1) {
    if (requests > 0 && requestIntervalMs > 0) await sleepImpl(requestIntervalMs);
    const pageResult = await requestPage({
      url: buildUrl({ ...args, cursor: nextCursor ?? undefined }),
      apiKey,
      fetchImpl,
      sleepImpl,
      maxRetries,
    });
    requests += pageResult.requests;
    const envelope = pageResult.envelope;
    if (!Array.isArray(envelope.data)) {
      throw new Error(`BALLDONTLIE NBA ${args.dataset} returned a malformed data envelope.`);
    }
    for (const row of envelope.data) {
      if (row === null || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(`BALLDONTLIE NBA ${args.dataset} returned a malformed row.`);
      }
      rows.push(row as Record<string, unknown>);
    }
    nextCursor = cursor(envelope.meta?.next_cursor);
    if (nextCursor === null || envelope.data.length === 0) {
      return {
        release: NBA_BDL_HISTORICAL_RESEARCH_RELEASE,
        dataset: args.dataset,
        rows,
        requests,
        complete: true,
        nextCursor: null,
      };
    }
  }
  return {
    release: NBA_BDL_HISTORICAL_RESEARCH_RELEASE,
    dataset: args.dataset,
    rows,
    requests,
    complete: false,
    nextCursor,
  };
}

export function nbaBdlProviderGameId(row: Record<string, unknown>): number | null {
  const gameId = integer(row.game_id);
  const nested = row.game && typeof row.game === "object" && !Array.isArray(row.game)
    ? integer((row.game as Record<string, unknown>).id)
    : null;
  return gameId ?? nested ?? integer(row.id);
}

export const __NBA_BDL_HISTORICAL_TEST__ = { buildUrl, retryDelayMs };
