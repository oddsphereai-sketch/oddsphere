#!/usr/bin/env tsx

/**
 * SELECT-only/current-season external NFL player-prop source replay.
 *
 * The script retrieves immutable T-60 historical snapshots from The Odds API,
 * joins them to the stored official BALLDONTLIE outcomes, and evaluates each
 * sportsbook independently before testing source-confirmation cohorts. API
 * responses are cached locally so repeated analysis does not spend credits.
 * It never writes application or database state.
 */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  readNflPlayerPropsCurrentSeasonState,
  type NflPlayerPropsCurrentSeasonGame,
  type NflPlayerPropsCurrentSeasonStat,
} from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";
import {
  readNflPlayerPropsPrivateTrackingHistory,
  type NflPlayerPropsPrivateTrackingRow,
} from "../../lib/services/football/nflPlayerPropsPrivateTrackingStore";

loadEnvConfig(process.cwd());

const RELEASE = "nfl_player_props_external_source_replay_2026_10_15_r1" as const;
const API_BASE = "https://api.the-odds-api.com/v4";
const BOOKS = ["fanduel", "novig", "prophetx", "polymarket"] as const;
const MARKET_MAP = {
  player_pass_attempts: "passing_attempts",
  player_pass_completions: "passing_completions",
  player_pass_yds: "passing_yards",
  player_receptions: "receptions",
  player_reception_yds: "receiving_yards",
  player_rush_attempts: "rushing_attempts",
  player_rush_yds: "rushing_yards",
} as const;
const API_MARKETS = Object.keys(MARKET_MAP);
const TEAM_ABBREVIATIONS: Record<string, string> = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LA", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
  "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
};

type ApiOutcome = { name: string; description?: string; price: number; point?: number };
type ApiMarket = { key: string; last_update: string; outcomes: ApiOutcome[] };
type ApiBook = { key: string; title: string; markets: ApiMarket[] };
type ApiEvent = {
  id: string; commence_time: string; home_team: string; away_team: string;
  bookmakers?: ApiBook[];
};
type HistoricalResponse<T> = { timestamp: string; previous_timestamp: string; next_timestamp: string; data: T };
type PairedLine = {
  week: number; gameId: string; scheduledStart: string; playerName: string; market: string;
  sportsbook: string; line: number; overPrice: number; underPrice: number; fairOver: number;
  actual: number; wonOver: boolean; observedAt: string;
};

async function main(): Promise<void> {
  const key = process.env.THE_ODDS_API_KEY;
  if (!key) throw new Error("THE_ODDS_API_KEY is required.");
  const weeks = (argument("weeks") ?? "3,4,5").split(",").map(Number);
  if (!weeks.length || weeks.some((week) => !Number.isInteger(week) || week < 1 || week > 18)) {
    throw new Error("--weeks must contain NFL regular-season week numbers.");
  }
  const cacheDirectory = argument("cache") ?? "/private/tmp/oddsphere-nfl-props-external-replay";
  mkdirSync(cacheDirectory, { recursive: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase service credentials are unavailable.");
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const state = await readNflPlayerPropsCurrentSeasonState({ client, season: 2026 });
  if (!state) throw new Error("NFL current-season state is unavailable.");
  const games = state.games.filter((game) => weeks.includes(game.week));
  const statsByGameAndName = new Map(state.stats.map((row) => [`${row.gameId}|${normalize(row.playerName)}`, row]));
  const rows: PairedLine[] = [];
  const usage: Array<{ endpoint: string; last: number; remaining: number }> = [];
  const unmatchedEvents: string[] = [];
  const unmatchedOutcomes: string[] = [];

  for (const week of weeks) {
    const weekGames = games.filter((game) => game.week === week);
    if (!weekGames.length) continue;
    const indexAt = isoNoMillis(Math.min(...weekGames.map((game) => Date.parse(game.scheduledStart))) - 12 * 3_600_000);
    const eventIndex = await cachedRequest<HistoricalResponse<ApiEvent[]>>({
      cacheDirectory,
      cacheKey: `week-${week}-events`,
      path: "/historical/sports/americanfootball_nfl/events",
      params: { apiKey: key, date: indexAt },
      usage,
    });
    for (const game of weekGames) {
      const event = eventIndex.data.find((candidate) => eventMatchesGame(candidate, game));
      if (!event) { unmatchedEvents.push(`${week}|${game.gameId}`); continue; }
      const lockAt = isoNoMillis(Date.parse(game.scheduledStart) - 60 * 60_000);
      const response = await cachedRequest<HistoricalResponse<ApiEvent>>({
        cacheDirectory,
        cacheKey: `week-${week}-${game.gameId}-t60`,
        path: `/historical/sports/americanfootball_nfl/events/${event.id}/odds`,
        params: {
          apiKey: key,
          date: lockAt,
          bookmakers: BOOKS.join(","),
          markets: API_MARKETS.join(","),
          oddsFormat: "american",
        },
        usage,
      });
      rows.push(...pairedMainLines({
        event: response.data,
        game,
        statsByGameAndName,
        observedAt: response.timestamp,
        unmatchedOutcomes,
      }));
    }
  }

  const archived = (await Promise.all(weeks.map((week) =>
    readNflPlayerPropsPrivateTrackingHistory({ client, season: 2026, week })))).flatMap((history) => history?.rows ?? []);

  const weekReports = weeks.map((week) => summarize(rows.filter((row) => row.week === week)));
  const output = {
    release: RELEASE,
    readOnly: true,
    productionWrites: 0,
    scope: { season: 2026, weeks, landmark: "t60_lock", markets: Object.values(MARKET_MAP), books: BOOKS },
    api: {
      networkRequests: usage.length,
      creditsSpentThisRun: usage.reduce((sum, row) => sum + row.last, 0),
      remaining: usage.at(-1)?.remaining ?? null,
      cachedResponses: games.length + weeks.length - usage.length,
    },
    coverage: {
      officialGames: games.length,
      pairedBookLines: rows.length,
      gamesWithPairedLines: new Set(rows.map((row) => row.gameId)).size,
      uniquePlayerMarkets: new Set(rows.map(identity)).size,
      unmatchedEvents,
      unmatchedOutcomeCount: new Set(unmatchedOutcomes).size,
    },
    byWeek: weekReports,
    combined: summarize(rows),
    currentReleaseIndependentDisagreements: summarizeIndependentDisagreements(rows, archived),
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function summarizeIndependentDisagreements(
  external: PairedLine[],
  archived: readonly NflPlayerPropsPrivateTrackingRow[],
) {
  const externalByIdentity = Map.groupBy(external, identity);
  const canonical = new Map<string, (typeof archived)[number]>();
  for (const row of archived) {
    if (!row.canonicalMainLine || row.market === "anytime_td" || row.independentProjection === null) continue;
    const key = `${row.gameId}|${normalize(row.playerName)}|${row.market}|${row.line}`;
    if (!canonical.has(key)) canonical.set(key, row);
  }
  const decisions = [...canonical.values()].flatMap((row) => {
    const books = externalByIdentity.get(`${row.gameId}|${normalize(row.playerName)}|${row.market}`) ?? [];
    const sourceSides = books.map((book) => ({ book: book.sportsbook, side: transportedSide(book, row.line) }));
    if (!sourceSides.length) return [];
    const overVotes = sourceSides.filter(({ side }) => side === "over").length;
    const underVotes = sourceSides.length - overVotes;
    if (overVotes === underVotes) return [];
    const marketSide = overVotes > underVotes ? "over" : "under";
    const independentSide = row.independentProjection! > row.line ? "over" : "under";
    if (marketSide === independentSide) return [];
    const actual = books[0]!.actual;
    if (actual === row.line) return [];
    const marketWon = marketSide === "over" ? actual > row.line : actual < row.line;
    const independentWon = independentSide === "over" ? actual > row.line : actual < row.line;
    return [{ marketWon, independentWon, market: row.market, sources: sourceSides.length }];
  });
  const summarizeRows = (selected: typeof decisions) => ({
    sample: selected.length,
    corrections: selected.filter((row) => row.marketWon && !row.independentWon).length,
    harms: selected.filter((row) => !row.marketWon && row.independentWon).length,
    net: selected.filter((row) => row.marketWon && !row.independentWon).length
      - selected.filter((row) => !row.marketWon && row.independentWon).length,
  });
  return {
    archiveRows: archived.length,
    disagreements: summarizeRows(decisions),
    byMarket: [...new Set(decisions.map((row) => row.market))].sort().map((market) => ({
      market,
      ...summarizeRows(decisions.filter((row) => row.market === market)),
    })),
  };
}

async function cachedRequest<T>(args: {
  cacheDirectory: string; cacheKey: string; path: string; params: Record<string, string>;
  usage: Array<{ endpoint: string; last: number; remaining: number }>;
}): Promise<T> {
  const path = join(args.cacheDirectory, `${args.cacheKey}.json`);
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { /* cache miss */ }
  const url = new URL(`${API_BASE}${args.path}`);
  for (const [key, value] of Object.entries(args.params)) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(`The Odds API ${args.path} failed with HTTP ${response.status}: ${payload.message ?? "unknown error"}`);
  args.usage.push({
    endpoint: args.cacheKey,
    last: Number(response.headers.get("x-requests-last") ?? 0),
    remaining: Number(response.headers.get("x-requests-remaining") ?? 0),
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload), "utf8");
  return payload;
}

function pairedMainLines(args: {
  event: ApiEvent; game: NflPlayerPropsCurrentSeasonGame;
  statsByGameAndName: Map<string, NflPlayerPropsCurrentSeasonStat>;
  observedAt: string; unmatchedOutcomes: string[];
}): PairedLine[] {
  const rows: PairedLine[] = [];
  for (const book of args.event.bookmakers ?? []) {
    for (const market of book.markets) {
      const mappedMarket = MARKET_MAP[market.key as keyof typeof MARKET_MAP];
      if (!mappedMarket) continue;
      const groups = Map.groupBy(market.outcomes, (outcome) => `${normalize(outcome.description ?? "")}|${outcome.point ?? ""}`);
      const candidates = [...groups.values()].flatMap((outcomes) => {
        const over = outcomes.find((outcome) => outcome.name.toLowerCase() === "over");
        const under = outcomes.find((outcome) => outcome.name.toLowerCase() === "under");
        if (!over || !under || typeof over.point !== "number" || over.point !== under.point) return [];
        const overImplied = implied(over.price); const underImplied = implied(under.price);
        return [{
          playerName: over.description ?? under.description ?? "",
          line: over.point,
          overPrice: over.price,
          underPrice: under.price,
          fairOver: overImplied / (overImplied + underImplied),
        }];
      });
      const byPlayer = Map.groupBy(candidates, (row) => normalize(row.playerName));
      for (const [playerKey, playerLines] of byPlayer) {
        const selected = [...playerLines].sort((first, second) =>
          Math.abs(first.fairOver - 0.5) - Math.abs(second.fairOver - 0.5)
          || Math.abs(first.overPrice + first.underPrice) - Math.abs(second.overPrice + second.underPrice)
          || first.line - second.line)[0];
        if (!selected) continue;
        const stat = args.statsByGameAndName.get(`${args.game.gameId}|${playerKey}`);
        const actual = stat ? actualValue(mappedMarket, stat) : null;
        if (actual === null) {
          args.unmatchedOutcomes.push(`${args.game.gameId}|${playerKey}|${mappedMarket}`);
          continue;
        }
        rows.push({
          week: args.game.week,
          gameId: args.game.gameId,
          scheduledStart: args.game.scheduledStart,
          playerName: selected.playerName,
          market: mappedMarket,
          sportsbook: book.key,
          line: selected.line,
          overPrice: selected.overPrice,
          underPrice: selected.underPrice,
          fairOver: selected.fairOver,
          actual,
          wonOver: actual > selected.line,
          observedAt: market.last_update ?? args.observedAt,
        });
      }
    }
  }
  return rows;
}

function summarize(rows: PairedLine[]) {
  const bySource = [...new Set(rows.map((row) => row.sportsbook))].sort().map((sportsbook) =>
    sourceSummary(rows.filter((row) => row.sportsbook === sportsbook), sportsbook));
  const byMarket = [...new Set(rows.map((row) => row.market))].sort().map((market) => ({
    market,
    sources: [...new Set(rows.filter((row) => row.market === market).map((row) => row.sportsbook))].sort().map((sportsbook) =>
      sourceSummary(rows.filter((row) => row.market === market && row.sportsbook === sportsbook), sportsbook)),
    fanDuelConfirmation: confirmationSummary(rows.filter((row) => row.market === market)),
  }));
  return {
    pairedBookLines: rows.length,
    games: new Set(rows.map((row) => row.gameId)).size,
    identities: new Set(rows.map(identity)).size,
    sources: bySource,
    fanDuelConfirmation: confirmationSummary(rows),
    byMarket,
  };
}

function sourceSummary(rows: PairedLine[], sportsbook: string) {
  const decisions = rows.filter((row) => row.actual !== row.line).map((row) => {
    const side = row.fairOver > 0.5 ? "over" : "under";
    const won = side === "over" ? row.actual > row.line : row.actual < row.line;
    return { probability: side === "over" ? row.fairOver : 1 - row.fairOver, won };
  });
  const wins = decisions.filter((row) => row.won).length;
  return {
    sportsbook,
    sample: decisions.length,
    wins,
    losses: decisions.length - wins,
    hitRate: ratio(wins, decisions.length),
    brier: decisions.length ? decisions.reduce((sum, row) => sum + (row.probability - Number(row.won)) ** 2, 0) / decisions.length : null,
  };
}

function confirmationSummary(rows: PairedLine[]) {
  const groups = Map.groupBy(rows, identity);
  const cases = [...groups.values()].flatMap((group) => {
    const fanDuel = group.find((row) => row.sportsbook === "fanduel");
    if (!fanDuel || fanDuel.actual === fanDuel.line) return [];
    const fanDuelSide = fanDuel.fairOver > 0.5 ? "over" : "under";
    const exchanges = group.filter((row) => row.sportsbook === "novig" || row.sportsbook === "prophetx");
    const exchangeSides = exchanges.map((row) => transportedSide(row, fanDuel.line));
    const confirmations = exchangeSides.filter((side) => side === fanDuelSide).length;
    const oppositions = exchangeSides.filter((side) => side !== fanDuelSide).length;
    const fanDuelWon = fanDuelSide === "over" ? fanDuel.actual > fanDuel.line : fanDuel.actual < fanDuel.line;
    const exchangeConsensus = exchangeSides.length > 0 && new Set(exchangeSides).size === 1 ? exchangeSides[0]! : null;
    const exchangeWon = exchangeConsensus === null ? null
      : exchangeConsensus === "over" ? fanDuel.actual > fanDuel.line : fanDuel.actual < fanDuel.line;
    return [{ confirmations, oppositions, fanDuelWon, exchangeConsensus, exchangeWon }];
  });
  const cohort = (name: string, predicate: (row: typeof cases[number]) => boolean, side: "fanduel" | "exchange" = "fanduel") => {
    const selected = cases.filter(predicate).filter((row) => side === "fanduel" || row.exchangeWon !== null);
    const wins = selected.filter((row) => side === "fanduel" ? row.fanDuelWon : row.exchangeWon).length;
    return { name, sample: selected.length, wins, losses: selected.length - wins, hitRate: ratio(wins, selected.length) };
  };
  return {
    eligibleFanDuelCases: cases.length,
    fanduelAlone: cohort("fanduel_alone", () => true),
    confirmedByAtLeastOneExchange: cohort("fanduel_plus_one_exchange", (row) => row.confirmations >= 1 && row.oppositions === 0),
    confirmedByBothExchanges: cohort("fanduel_plus_two_exchanges", (row) => row.confirmations >= 2 && row.oppositions === 0),
    opposedByBothExchanges: cohort("two_exchange_consensus_opposes_fanduel", (row) => row.oppositions >= 2 && row.confirmations === 0, "exchange"),
    anyExchangeConsensusOpposesFanDuel: cohort("exchange_consensus_opposes_fanduel", (row) => row.exchangeConsensus !== null && row.oppositions > 0 && row.confirmations === 0, "exchange"),
  };
}

function transportedSide(row: PairedLine, targetLine: number): "over" | "under" {
  if (row.line > targetLine) return "over";
  if (row.line < targetLine) return "under";
  return row.fairOver > 0.5 ? "over" : "under";
}

function eventMatchesGame(event: ApiEvent, game: NflPlayerPropsCurrentSeasonGame): boolean {
  return TEAM_ABBREVIATIONS[event.home_team] === game.homeTeam
    && TEAM_ABBREVIATIONS[event.away_team] === game.awayTeam
    && Math.abs(Date.parse(event.commence_time) - Date.parse(game.scheduledStart)) <= 3 * 3_600_000;
}

function actualValue(market: string, stat: NflPlayerPropsCurrentSeasonStat): number | null {
  const value = stat[market as keyof NflPlayerPropsCurrentSeasonStat];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function identity(row: PairedLine): string { return `${row.gameId}|${normalize(row.playerName)}|${row.market}`; }
function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function ratio(numerator: number, denominator: number): number | null { return denominator ? numerator / denominator : null; }
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function isoNoMillis(value: number): string { return new Date(value).toISOString().replace(".000Z", "Z"); }
function argument(name: string): string | null {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
