import {
  normalizeBallDontLieNbaPlayerProps,
} from "./nbaPlayerPropsProviders";
import type {
  NbaPlayerPropPriceObservation,
  NbaPlayerPropsProviderNormalization,
} from "./nbaPlayerPropsContract";

export const NBA_PLAYER_PROPS_BDL_OPENING_HISTORY_RELEASE =
  "nba_player_props_bdl_opening_history_2026_10_20_r1" as const;

const ENDPOINT = "https://api.balldontlie.io/nba/v2/odds/player_props/opening";
const MAX_GAMES = 1_500;
const DEFAULT_REQUEST_INTERVAL_MS = 125;
const DEFAULT_MAX_RETRIES = 4;

export type NbaPlayerPropsOpeningHistory = {
  release: typeof NBA_PLAYER_PROPS_BDL_OPENING_HISTORY_RELEASE;
  capturedAt: string;
  gamesRequested: number;
  gamesWithProps: number;
  requests: number;
  rows: NbaPlayerPropPriceObservation[];
  normalization: NbaPlayerPropsProviderNormalization;
  complete: true;
};

export async function fetchNbaBdlOpeningPlayerPropsHistory(args: {
  gameIds: readonly number[];
  events?: Readonly<Record<string, {
    canonicalGameId: string;
    homeTeam: string;
    awayTeam: string;
    scheduledStart: string;
  }>>;
  canonicalPlayers?: Readonly<Record<string, string>>;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  requestIntervalMs?: number;
  maxRetries?: number;
}): Promise<NbaPlayerPropsOpeningHistory> {
  const apiKey = args.apiKey ?? process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for NBA opening player-prop history.");
  const gameIds = [...new Set(args.gameIds)];
  if (gameIds.some((gameId) => !Number.isInteger(gameId) || gameId < 1)) {
    throw new Error("NBA opening player-prop history requires positive integer game IDs.");
  }
  if (gameIds.length === 0 || gameIds.length > MAX_GAMES) {
    throw new Error(`NBA opening player-prop history requires 1 through ${MAX_GAMES} games.`);
  }
  const requestIntervalMs = args.requestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS;
  const maxRetries = args.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(requestIntervalMs) || requestIntervalMs < 0 || requestIntervalMs > 60_000) {
    throw new Error("NBA opening player-prop requestIntervalMs must be from 0 through 60000.");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 8) {
    throw new Error("NBA opening player-prop maxRetries must be from 0 through 8.");
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const sleepImpl = args.sleepImpl ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const capturedAt = new Date().toISOString();
  const raw: unknown[] = [];
  let requests = 0;
  let gamesWithProps = 0;
  for (let index = 0; index < gameIds.length; index += 1) {
    if (index > 0 && requestIntervalMs > 0) await sleepImpl(requestIntervalMs);
    const result = await requestOpeningGame({
      gameId: gameIds[index]!,
      apiKey,
      fetchImpl,
      sleepImpl,
      maxRetries,
    });
    requests += result.requests;
    if (result.rows.length > 0) gamesWithProps += 1;
    raw.push(...result.rows);
  }
  const normalization = normalizeBallDontLieNbaPlayerProps({
    values: raw,
    fetchedAt: capturedAt,
    opening: true,
    events: args.events,
    canonicalPlayers: args.canonicalPlayers,
  });
  return {
    release: NBA_PLAYER_PROPS_BDL_OPENING_HISTORY_RELEASE,
    capturedAt,
    gamesRequested: gameIds.length,
    gamesWithProps,
    requests,
    rows: normalization.rows,
    normalization,
    complete: true,
  };
}

async function requestOpeningGame(args: {
  gameId: number;
  apiKey: string;
  fetchImpl: typeof fetch;
  sleepImpl: (milliseconds: number) => Promise<void>;
  maxRetries: number;
}): Promise<{ rows: unknown[]; requests: number }> {
  for (let attempt = 0; attempt <= args.maxRetries; attempt += 1) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("game_id", String(args.gameId));
    let response: Response;
    try {
      response = await args.fetchImpl(url, {
        headers: { Authorization: args.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (attempt === args.maxRetries) {
        throw new Error(`NBA opening player props game ${args.gameId} failed after ${attempt + 1} attempts: ${error instanceof Error ? error.message : String(error)}`);
      }
      await args.sleepImpl(Math.min(30_000, 1_000 * 2 ** attempt));
      continue;
    }
    const body = await response.text();
    if (response.ok) {
      const parsed = JSON.parse(body) as { data?: unknown; meta?: { next_cursor?: unknown } };
      if (!Array.isArray(parsed.data)) throw new Error(`NBA opening player props game ${args.gameId} returned malformed data.`);
      if (parsed.meta?.next_cursor !== undefined && parsed.meta.next_cursor !== null) {
        throw new Error(`NBA opening player props game ${args.gameId} violated the no-pagination contract.`);
      }
      return { rows: parsed.data, requests: attempt + 1 };
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === args.maxRetries) {
      throw new Error(`NBA opening player props game ${args.gameId} failed with HTTP ${response.status}.`);
    }
    await args.sleepImpl(retryDelay(response, attempt));
  }
  throw new Error("NBA opening player-prop request exhausted retries.");
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1_000);
  }
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

export const __NBA_PLAYER_PROPS_HISTORICAL_TEST__ = { ENDPOINT, MAX_GAMES, retryDelay };
