import type { Sport } from "@/lib/types/domain/Sport";
import { OwlsInsightClient, type OwlsSport } from "./owlsInsightClient";
import type { RawOwlsSplit, RawOwlsSplitGame, RawOwlsSplitsResponse } from "./owlsSharpBookSplits";

type Json = Record<string, unknown>;
export type OwlsCurrentSplitSport = Exclude<Sport, "soccer" | "ucl">;

const OWLS_SPORT: Record<OwlsCurrentSplitSport, Exclude<OwlsSport, "soccer">> = {
  mlb: "mlb",
  nba: "nba",
  wnba: "wnba",
  nfl: "nfl",
  cfb: "ncaaf",
  cbb: "ncaab",
  nhl: "nhl",
};

const LEAGUE: Record<OwlsCurrentSplitSport, string> = { ...OWLS_SPORT };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function normalizeBook(value: unknown): "circa" | "draftkings" | "betmgm" | null {
  const normalized = text(value)?.toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  if (normalized === "circa") return "circa";
  if (normalized === "draftkings" || normalized === "dk") return "draftkings";
  if (normalized === "betmgm") return "betmgm";
  return null;
}

function splitPercentage(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed / 100
    : null;
}

function splitMarket(raw: RawOwlsSplit, market: "moneyline" | "spread" | "total"): Json | null {
  const source = record(raw[market]);
  if (Object.keys(source).length === 0) return null;
  if (market === "total") {
    return {
      line: source.line ?? null,
      bets_pct: { over: splitPercentage(source.over_bets_pct), under: splitPercentage(source.under_bets_pct) },
      handle_pct: { over: splitPercentage(source.over_handle_pct), under: splitPercentage(source.under_handle_pct) },
    };
  }
  return {
    ...(market === "moneyline"
      ? { away_odds: source.away_price ?? null, home_odds: source.home_price ?? null }
      : { away_line: source.away_line ?? null, home_line: source.home_line ?? null }),
    bets_pct: { away: splitPercentage(source.away_bets_pct), home: splitPercentage(source.home_bets_pct) },
    handle_pct: { away: splitPercentage(source.away_handle_pct), home: splitPercentage(source.home_handle_pct) },
  };
}

function mapGameSplit(
  sport: OwlsCurrentSplitSport,
  game: RawOwlsSplitGame,
  split: RawOwlsSplit,
): Json | null {
  const eventId = text(game.event_id);
  const homeTeam = text(game.home_team);
  const awayTeam = text(game.away_team);
  const sportsbook = normalizeBook(split.book);
  const fetchedAt = text(split.as_of);
  if (!eventId || !homeTeam || !awayTeam || !sportsbook || !fetchedAt || !Number.isFinite(Date.parse(fetchedAt))) {
    return null;
  }
  const markets = {
    moneyline: splitMarket(split, "moneyline"),
    spread: splitMarket(split, "spread"),
    total: splitMarket(split, "total"),
  };
  if (!markets.moneyline && !markets.spread && !markets.total) return null;
  return {
    event_id: eventId,
    league: LEAGUE[sport],
    home_team: homeTeam,
    away_team: awayTeam,
    sportsbook,
    fetched_at: new Date(fetchedAt).toISOString(),
    moneyline: markets.moneyline,
    spread: markets.spread,
    total: markets.total,
    _oddsphere_source_provider: "owls",
    _oddsphere_market_fetched_at: {
      ...(markets.moneyline ? { moneyline: new Date(fetchedAt).toISOString() } : {}),
      ...(markets.spread ? { spread: new Date(fetchedAt).toISOString() } : {}),
      ...(markets.total ? { total: new Date(fetchedAt).toISOString() } : {}),
    },
  };
}

export function mapOwlsCurrentSplitRows(
  sport: OwlsCurrentSplitSport,
  response: RawOwlsSplitsResponse,
): Json[] {
  const responseSport = text(response.sport)?.toLowerCase() ?? null;
  if (responseSport !== null && responseSport !== OWLS_SPORT[sport]) return [];
  const rows: Json[] = [];
  for (const game of Array.isArray(response.data) ? response.data : []) {
    for (const split of Array.isArray(game.splits) ? game.splits : []) {
      const row = mapGameSplit(sport, game, split);
      if (row) rows.push(row);
    }
  }
  return rows;
}

export async function fetchOwlsCurrentSplitRows(args: {
  sport: OwlsCurrentSplitSport;
  apiKey: string;
  timeoutMs?: number;
}): Promise<{ fetchedAt: string; rows: Json[]; partial: boolean; partialReason: string | null }> {
  const client = new OwlsInsightClient(args.apiKey, { timeoutMs: args.timeoutMs });
  const response = await client.splits<RawOwlsSplitsResponse>(OWLS_SPORT[args.sport]);
  const rows = mapOwlsCurrentSplitRows(args.sport, response.body);
  const newest = rows
    .map((row) => text(row.fetched_at))
    .filter((value): value is string => value !== null)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? new Date().toISOString();
  return {
    fetchedAt: newest,
    rows,
    partial: response.body.meta?.status === "partial",
    partialReason: text(response.body.meta?.partial_reason),
  };
}
