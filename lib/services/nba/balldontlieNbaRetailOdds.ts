import { isNbaConsumerRetailSportsbook } from "./nbaMarketSourceEligibility";

export const NBA_BDL_RETAIL_ODDS_RELEASE =
  "nba_bdl_retail_odds_2026_10_29_r1_consumer_execution_authority" as const;

const NBA_BDL_BASE = "https://api.balldontlie.io";
const PAGE_SIZE = 100;
const MAX_PAGES = 4;
const REQUEST_TIMEOUT_MS = 20_000;

type JsonRecord = Record<string, unknown>;

export type NbaBdlRetailGame = {
  providerGameId: number;
  scheduledStart: string;
  homeTeam: string;
  awayTeam: string;
};

export type NbaBdlRetailQuote = {
  providerGameId: number;
  sportsbook: string;
  observedAt: string;
  market: "moneyline" | "spread" | "total";
  side: "home" | "away" | "over" | "under";
  line: number | null;
  americanPrice: number;
};

export type NbaBdlRetailOdds = {
  release: typeof NBA_BDL_RETAIL_ODDS_RELEASE;
  games: NbaBdlRetailGame[];
  quotes: NbaBdlRetailQuote[];
  requests: number;
};

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function american(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed !== 0 ? Math.round(parsed) : null;
}

function iso(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function readPages(args: {
  path: string;
  slateDate: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<{ rows: JsonRecord[]; requests: number }> {
  const rows: JsonRecord[] = [];
  let cursor: string | null = null;
  let requests = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${NBA_BDL_BASE}${args.path}`);
    url.searchParams.append("dates[]", args.slateDate);
    url.searchParams.set("per_page", String(PAGE_SIZE));
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const response = await args.fetchImpl(url, {
      headers: { Authorization: args.apiKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    requests += 1;
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`BALLDONTLIE NBA retail ${args.path} failed with HTTP ${response.status}: ${body.slice(0, 160)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`BALLDONTLIE NBA retail ${args.path} returned invalid JSON.`);
    }
    const envelope = record(parsed);
    if (!envelope || !Array.isArray(envelope.data)) {
      throw new Error(`BALLDONTLIE NBA retail ${args.path} returned a malformed data envelope.`);
    }
    rows.push(...envelope.data.map(record).filter((row): row is JsonRecord => row !== null));
    const meta = record(envelope.meta);
    const next = meta?.next_cursor;
    cursor = typeof next === "string" || typeof next === "number" ? String(next) : null;
    if (cursor === null || envelope.data.length === 0) return { rows, requests };
  }
  throw new Error(`BALLDONTLIE NBA retail ${args.path} exceeded the ${MAX_PAGES}-page safety cap.`);
}

export async function fetchNbaBdlRetailOdds(args: {
  slateDate: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<NbaBdlRetailOdds> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.slateDate)) {
    throw new Error("BALLDONTLIE NBA retail odds require a YYYY-MM-DD slate date.");
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const [gameRead, oddsRead] = await Promise.all([
    readPages({ path: "/v1/games", slateDate: args.slateDate, apiKey: args.apiKey, fetchImpl }),
    readPages({ path: "/v2/odds", slateDate: args.slateDate, apiKey: args.apiKey, fetchImpl }),
  ]);
  const games = gameRead.rows.flatMap((row): NbaBdlRetailGame[] => {
    const providerGameId = integer(row.id);
    const scheduledStart = iso(row.datetime ?? row.status);
    const home = record(row.home_team);
    const away = record(row.visitor_team);
    const homeTeam = text(home?.full_name) ?? text(home?.abbreviation);
    const awayTeam = text(away?.full_name) ?? text(away?.abbreviation);
    return providerGameId === null || scheduledStart === null || homeTeam === null || awayTeam === null
      ? []
      : [{ providerGameId, scheduledStart, homeTeam, awayTeam }];
  });
  const gameIds = new Set(games.map((game) => game.providerGameId));
  const quotes = oddsRead.rows.flatMap((row): NbaBdlRetailQuote[] => {
    const providerGameId = integer(row.game_id);
    const sportsbook = text(row.vendor)?.toLowerCase() ?? null;
    const observedAt = iso(row.updated_at);
    if (
      providerGameId === null || !gameIds.has(providerGameId) || sportsbook === null ||
      !isNbaConsumerRetailSportsbook(sportsbook) || observedAt === null
    ) return [];

    const normalized: NbaBdlRetailQuote[] = [];
    const homeMl = american(row.moneyline_home_odds);
    const awayMl = american(row.moneyline_away_odds);
    if (homeMl !== null && awayMl !== null) {
      normalized.push(
        { providerGameId, sportsbook, observedAt, market: "moneyline", side: "home", line: null, americanPrice: homeMl },
        { providerGameId, sportsbook, observedAt, market: "moneyline", side: "away", line: null, americanPrice: awayMl },
      );
    }

    const homeSpread = finite(row.spread_home_value);
    const awaySpread = finite(row.spread_away_value);
    const homeSpreadPrice = american(row.spread_home_odds);
    const awaySpreadPrice = american(row.spread_away_odds);
    if (
      homeSpread !== null && awaySpread !== null && Math.abs(homeSpread + awaySpread) < 0.001 &&
      homeSpreadPrice !== null && awaySpreadPrice !== null
    ) {
      normalized.push(
        { providerGameId, sportsbook, observedAt, market: "spread", side: "home", line: homeSpread, americanPrice: homeSpreadPrice },
        { providerGameId, sportsbook, observedAt, market: "spread", side: "away", line: awaySpread, americanPrice: awaySpreadPrice },
      );
    }

    const total = finite(row.total_value);
    const overPrice = american(row.total_over_odds);
    const underPrice = american(row.total_under_odds);
    if (total !== null && overPrice !== null && underPrice !== null) {
      normalized.push(
        { providerGameId, sportsbook, observedAt, market: "total", side: "over", line: total, americanPrice: overPrice },
        { providerGameId, sportsbook, observedAt, market: "total", side: "under", line: total, americanPrice: underPrice },
      );
    }
    return normalized;
  });
  return {
    release: NBA_BDL_RETAIL_ODDS_RELEASE,
    games,
    quotes,
    requests: gameRead.requests + oddsRead.requests,
  };
}

export const __NBA_BDL_RETAIL_ODDS_TEST__ = { readPages };
