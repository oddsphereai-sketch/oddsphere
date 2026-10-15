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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  readNflPlayerPropsCurrentSeasonState,
  type NflPlayerPropsCurrentSeasonGame,
  type NflPlayerPropsCurrentSeasonState,
  type NflPlayerPropsCurrentSeasonStat,
} from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";
import {
  NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
  NFL_PLAYER_PROPS_DECISION_RELEASE,
  NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE,
  NFL_PLAYER_PROPS_RESEARCH_SCHEMA_RELEASE,
  NFL_PLAYER_PROPS_SHADOW_MODEL_RELEASE,
  type NflPlayerPropGameIdentity,
  type NflPlayerPropPriceObservation,
  type NflPlayerPropsObservationSnapshot,
} from "../../lib/services/football/nflPlayerPropsContract";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { buildNflPlayerPropsInferenceContextFromForwardEvidence } from "../../lib/services/football/nflPlayerPropsInferenceContext";
import {
  NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE,
  americanImpliedProbability,
  type NflPlayerPropsExactOffer,
} from "../../lib/services/football/nflPlayerPropsMarketBoard";
import {
  readNflPlayerPropsPrivateTrackingHistory,
  type NflPlayerPropsPrivateTrackingRow,
} from "../../lib/services/football/nflPlayerPropsPrivateTrackingStore";
import {
  gradeNflPlayerPropsCrossMarketCandidate,
  buildNflPlayerPropsRuntimeBoard,
  buildNflPlayerPropsRuntimeFeatureRows,
  nflPlayerPropsCoherentPosteriorDistribution,
  nflPlayerPropsDiscreteMarketArbitration,
  nflPlayerPropsExpectedValue,
  nflPlayerPropsProductionMarketLane,
  nflPlayerPropsRawMarketDivergenceImplausible,
  nflPlayerPropsResidualProbability,
  nflPlayerPropsRuntimeMarketPolicy,
  nflPlayerPropsRuntimePolicy,
  nflPlayerPropsTransportedMarketProbability,
} from "../../lib/services/football/nflPlayerPropsRuntime";
import type { NflPlayerPropMarket } from "../../lib/services/football/nflPlayerPropsContract";

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
  const weeks = (argument("weeks") ?? "3,4,5").split(",").map(Number);
  const qualifiedMarkets = (argument("qualified-markets") ?? "receptions")
    .split(",").filter(Boolean) as NflPlayerPropMarket[];
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
      params: { apiKey: key ?? "", date: indexAt },
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
          apiKey: key ?? "",
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
    exactCurrentModelReplay: await replayExactCurrentModel({ client, weeks, external: rows, state, qualifiedMarkets }),
  };
  const outputPath = argument("output");
  if (outputPath) writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  if (argument("compact") === "true") {
    const { rows: replayRowsOmitted, ...exactCurrentModelReplay } = output.exactCurrentModelReplay;
    process.stdout.write(`${JSON.stringify({
      release: output.release,
      readOnly: output.readOnly,
      productionWrites: output.productionWrites,
      api: output.api,
      coverage: output.coverage,
      exactCurrentModelReplay,
      exactCurrentModelReplayRowsOmitted: replayRowsOmitted.length,
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

async function replayExactCurrentModel(args: {
  client: SupabaseClient;
  weeks: number[];
  external: PairedLine[];
  state: NflPlayerPropsCurrentSeasonState;
  qualifiedMarkets: NflPlayerPropMarket[];
}) {
  const replayRows: Array<{
    week: number; gameId: string; market: string; actual: number; line: number;
    incumbentSide: "over" | "under"; candidateSide: "over" | "under";
    incumbentWon: boolean; candidateWon: boolean;
    incumbentOverProbability: number; candidateOverProbability: number;
    incumbentProjection: number | null; candidateProjection: number | null;
    incumbentGrade: string; candidateGrade: string;
    incumbentPrice: number; candidatePrice: number;
    incumbentProbability: number; candidateProbability: number;
    incumbentMarketProbability: number; candidateMarketProbability: number;
    incumbentEdge: number; candidateEdge: number;
    incumbentExpectedValue: number; candidateExpectedValue: number;
    incumbentMovement: string; candidateMovement: string;
  }> = [];
  const unavailable: Array<{ week: number; gameId: string; reason: string }> = [];
  for (const week of args.weeks) {
    const evidence = await readNflForwardEvidence({ client: args.client, season: 2026, week });
    const weekGames = args.state.games.filter((game) => game.week === week);
    for (const game of weekGames) {
      const external = args.external.filter((row) => row.gameId === game.gameId);
      if (!external.length) continue;
      const evaluatedAt = new Date(Date.parse(game.scheduledStart) - 60 * 60_000).toISOString();
      const snapshot = replayObservationSnapshot({ game, external, state: args.state, evaluatedAt });
      let context;
      try {
        context = buildNflPlayerPropsInferenceContextFromForwardEvidence({ snapshot, evidence, capturedAt: evaluatedAt });
      } catch (error) {
        unavailable.push({ week, gameId: game.gameId, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      const stateBeforeWeek: NflPlayerPropsCurrentSeasonState = {
        ...args.state,
        completeThroughWeek: Math.min(args.state.completeThroughWeek, week - 1),
        games: args.state.games.filter((row) => row.week < week),
        teamStats: args.state.teamStats.filter((row) => row.week < week),
        stats: args.state.stats.filter((row) => row.week < week),
      };
      const features = buildNflPlayerPropsRuntimeFeatureRows({ snapshot, context, currentSeasonState: stateBeforeWeek });
      const offers = replayExactOffers({ game, external });
      const incumbent = buildNflPlayerPropsRuntimeBoard({ offers, features, evaluatedAt }).decisions;
      const candidate = buildNflPlayerPropsRuntimeBoard({
        offers,
        features,
        evaluatedAt,
        auditSourceAwareMarketReading: true,
        auditSourceAwareQualifiedMarkets: args.qualifiedMarkets,
      }).decisions;
      const targetOffers = selectReplayTargetOffers(offers);
      for (const offer of targetOffers) {
        const key = replayDecisionKey(offer);
        const before = incumbent.filter((row) => replayDecisionKey(row) === key);
        const after = candidate.filter((row) => replayDecisionKey(row) === key);
        const incumbentOver = before.find((row) => row.side === "over");
        const incumbentUnder = before.find((row) => row.side === "under");
        const candidateOver = after.find((row) => row.side === "over");
        const candidateUnder = after.find((row) => row.side === "under");
        if (!incumbentOver || !incumbentUnder || !candidateOver || !candidateUnder) continue;
        const actual = external.find((row) => normalize(row.playerName) === normalize(offer.playerName)
          && row.market === offer.market)?.actual;
        if (actual === undefined || actual === offer.line) continue;
        const beforePick = incumbentOver.finalProbability >= incumbentUnder.finalProbability ? incumbentOver : incumbentUnder;
        const afterPick = candidateOver.finalProbability >= candidateUnder.finalProbability ? candidateOver : candidateUnder;
        const actualSide = actual > offer.line ? "over" : "under";
        replayRows.push({
          week,
          gameId: game.gameId,
          market: offer.market,
          actual,
          line: offer.line,
          incumbentSide: beforePick.side as "over" | "under",
          candidateSide: afterPick.side as "over" | "under",
          incumbentWon: beforePick.side === actualSide,
          candidateWon: afterPick.side === actualSide,
          incumbentOverProbability: incumbentOver.finalProbability,
          candidateOverProbability: candidateOver.finalProbability,
          incumbentProjection: incumbentOver.projection,
          candidateProjection: candidateOver.projection,
          incumbentGrade: beforePick.grade,
          candidateGrade: afterPick.grade,
          incumbentPrice: beforePick.americanPrice,
          candidatePrice: afterPick.americanPrice,
          incumbentProbability: beforePick.finalProbability,
          candidateProbability: afterPick.finalProbability,
          incumbentMarketProbability: beforePick.marketProbability,
          candidateMarketProbability: afterPick.marketProbability,
          incumbentEdge: beforePick.probabilityEdge,
          candidateEdge: afterPick.probabilityEdge,
          incumbentExpectedValue: beforePick.expectedValue,
          candidateExpectedValue: afterPick.expectedValue,
          incumbentMovement: beforePick.marketMovement,
          candidateMovement: afterPick.marketMovement,
        });
      }
    }
  }
  const summarizeReplay = (selected: typeof replayRows) => {
    const beforeWins = selected.filter((row) => row.incumbentWon).length;
    const afterWins = selected.filter((row) => row.candidateWon).length;
    const changes = selected.filter((row) => row.incumbentSide !== row.candidateSide);
    const beforeActions = selected.filter((row) => isActionable(row.incumbentGrade));
    const afterActions = selected.filter((row) => isActionable(row.candidateGrade));
    return {
      scopes: selected.length,
      games: new Set(selected.map((row) => row.gameId)).size,
      incumbentDirection: record(beforeWins, selected.length),
      candidateDirection: record(afterWins, selected.length),
      sideChanges: changes.length,
      corrections: changes.filter((row) => row.candidateWon && !row.incumbentWon).length,
      harms: changes.filter((row) => !row.candidateWon && row.incumbentWon).length,
      incumbentBrier: mean(selected.map((row) => (row.incumbentOverProbability - Number(row.actual > row.line)) ** 2)),
      candidateBrier: mean(selected.map((row) => (row.candidateOverProbability - Number(row.actual > row.line)) ** 2)),
      incumbentProjectionMae: mean(selected.flatMap((row) => row.incumbentProjection === null ? [] : [Math.abs(row.incumbentProjection - row.actual)])),
      candidateProjectionMae: mean(selected.flatMap((row) => row.candidateProjection === null ? [] : [Math.abs(row.candidateProjection - row.actual)])),
      incumbentActionables: actionableReplaySummary(beforeActions, "incumbent"),
      candidateActionables: actionableReplaySummary(afterActions, "candidate"),
      promotions: selected.filter((row) => !isActionable(row.incumbentGrade) && isActionable(row.candidateGrade)).length,
      demotions: selected.filter((row) => isActionable(row.incumbentGrade) && !isActionable(row.candidateGrade)).length,
    };
  };
  return {
    evidenceBoundary: "Current production model and current source-aware candidate replayed at T-60 from immutable forward evidence and cached historical paired prices; outcomes are official box-score results.",
    unavailable,
    combined: summarizeReplay(replayRows),
    byWeek: args.weeks.map((week) => ({ week, ...summarizeReplay(replayRows.filter((row) => row.week === week)) })),
    byMarket: [...new Set(replayRows.map((row) => row.market))].sort().map((market) => ({
      market,
      ...summarizeReplay(replayRows.filter((row) => row.market === market)),
    })),
    byMarketWeek: [...new Set(replayRows.map((row) => row.market))].sort().flatMap((market) => (
      args.weeks.map((week) => ({
        market,
        week,
        ...summarizeReplay(replayRows.filter((row) => row.market === market && row.week === week)),
      }))
    )),
    rows: replayRows,
  };
}

function replayObservationSnapshot(args: {
  game: NflPlayerPropsCurrentSeasonGame;
  external: PairedLine[];
  state: NflPlayerPropsCurrentSeasonState;
  evaluatedAt: string;
}): NflPlayerPropsObservationSnapshot {
  const gameIdentity: NflPlayerPropGameIdentity = {
    season: 2026,
    week: args.game.week,
    phase: "regular",
    providerGameId: args.game.gameId,
    scheduledStart: args.game.scheduledStart,
    homeTeam: args.game.homeTeam,
    awayTeam: args.game.awayTeam,
    homeTeamName: args.game.homeTeam,
    awayTeamName: args.game.awayTeam,
  };
  const observations = new Map<string, NflPlayerPropPriceObservation>();
  for (const row of args.external) {
    const stat = args.state.stats.find((candidate) => candidate.gameId === row.gameId
      && normalize(candidate.playerName) === normalize(row.playerName));
    const key = `${row.gameId}|${normalize(row.playerName)}`;
    if (observations.has(key)) continue;
    observations.set(key, {
      provider: "sharpapi",
      providerObservationId: `external-replay:${key}`,
      providerEventId: row.gameId,
      canonicalGameId: row.gameId,
      providerPlayerId: stat?.playerId ?? null,
      playerName: row.playerName,
      playerTeam: stat?.team ?? null,
      sportsbook: row.sportsbook,
      market: row.market as NflPlayerPropMarket,
      providerMarket: row.market,
      offerType: "over_under",
      side: "over",
      line: row.line,
      americanPrice: row.overPrice,
      observedAt: row.observedAt,
      fetchedAt: row.observedAt,
      isOpening: false,
      isLive: false,
      homeTeam: args.game.homeTeam,
      awayTeam: args.game.awayTeam,
      scheduledStart: args.game.scheduledStart,
    });
  }
  return {
    schemaRelease: NFL_PLAYER_PROPS_RESEARCH_SCHEMA_RELEASE,
    snapshotRelease: NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE,
    shadowModelRelease: NFL_PLAYER_PROPS_SHADOW_MODEL_RELEASE,
    calibrationRelease: NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
    decisionRelease: NFL_PLAYER_PROPS_DECISION_RELEASE,
    mode: "local_observe_only",
    actionable: false,
    generatedAt: args.evaluatedAt,
    fetchedAt: args.evaluatedAt,
    season: 2026,
    week: args.game.week,
    phase: "regular",
    games: [gameIdentity],
    observations: [...observations.values()],
    providerCoverage: {},
    providerRequests: {},
    collectionComplete: true,
    modelingReady: false,
    healthFindings: [],
  };
}

function replayExactOffers(args: {
  game: NflPlayerPropsCurrentSeasonGame;
  external: PairedLine[];
}): NflPlayerPropsExactOffer[] {
  return args.external.map((row) => {
    const over = americanImpliedProbability(row.overPrice);
    const under = americanImpliedProbability(row.underPrice);
    return {
      release: NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE,
      offerKey: `${row.gameId}|${normalize(row.playerName)}|${row.market}|${row.line}|${row.sportsbook}`,
      canonicalGameId: row.gameId,
      provider: "sharpapi",
      providerEventId: row.gameId,
      providerPlayerId: null,
      playerName: row.playerName,
      playerTeam: null,
      sportsbook: row.sportsbook,
      market: row.market as NflPlayerPropMarket,
      offerType: "over_under" as const,
      line: row.line,
      overPrice: row.overPrice,
      underPrice: row.underPrice,
      yesPrice: null,
      overNoVigProbability: over / (over + under),
      underNoVigProbability: under / (over + under),
      observedAt: row.observedAt,
      fetchedAt: row.observedAt,
      openingObservedAt: null,
      openingLine: null,
      openingOverPrice: null,
      openingUnderPrice: null,
      openingYesPrice: null,
      scheduledStart: args.game.scheduledStart,
      lockAt: new Date(Date.parse(args.game.scheduledStart) - 60 * 60_000).toISOString(),
      state: "locked" as const,
      exactPriceComplete: true,
      gradeEligibleMarket: true,
      healthHolds: [],
    };
  });
}

function selectReplayTargetOffers(offers: NflPlayerPropsExactOffer[]): NflPlayerPropsExactOffer[] {
  const groups = Map.groupBy(offers, (offer) => `${offer.canonicalGameId}|${normalize(offer.playerName)}|${offer.market}`);
  return [...groups.values()].flatMap((group) => {
    const fanDuel = group.find((offer) => normalize(offer.sportsbook) === "fanduel");
    return [fanDuel ?? [...group].sort((first, second) => first.sportsbook.localeCompare(second.sportsbook))[0]!];
  });
}

function replayDecisionKey(row: {
  gameId?: string; canonicalGameId?: string; playerName: string; market: string; line: number; sportsbook: string;
}): string {
  return `${row.gameId ?? row.canonicalGameId}|${normalize(row.playerName)}|${row.market}|${row.line}|${normalize(row.sportsbook)}`;
}

function actionableReplaySummary<T extends {
  incumbentWon: boolean; candidateWon: boolean; incumbentPrice: number; candidatePrice: number;
}>(rows: T[], kind: "incumbent" | "candidate") {
  const wins = rows.filter((row) => kind === "incumbent" ? row.incumbentWon : row.candidateWon).length;
  const units = rows.reduce((sum, row) => {
    const won = kind === "incumbent" ? row.incumbentWon : row.candidateWon;
    const price = kind === "incumbent" ? row.incumbentPrice : row.candidatePrice;
    return sum + (won ? (price < 0 ? 100 / Math.abs(price) : price / 100) : -1);
  }, 0);
  return { ...record(wins, rows.length), units };
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
    integratedSourceAwareCandidate: integratedSourceAwareCandidate(external, archived),
  };
}

function integratedSourceAwareCandidate(
  external: PairedLine[],
  archived: readonly NflPlayerPropsPrivateTrackingRow[],
) {
  const externalByIdentity = Map.groupBy(external, identity);
  const byScope = Map.groupBy(
    archived.filter((row) => row.canonicalMainLine && row.market !== "anytime_td" && row.independentProjection !== null),
    (row) => `${row.gameId}|${normalize(row.playerName)}|${row.market}|${row.line}`,
  );
  const qualified = new Set<NflPlayerPropMarket>([
    "passing_completions", "receptions", "rushing_attempts", "rushing_yards",
  ]);
  const policy = nflPlayerPropsRuntimePolicy();
  const rows = [...byScope.values()].flatMap((scope) => {
    const over = scope.find((row) => row.side === "over");
    const under = scope.find((row) => row.side === "under");
    if (!over || !under || !qualified.has(over.market)) return [];
    const sources = (externalByIdentity.get(`${over.gameId}|${normalize(over.playerName)}|${over.market}`) ?? [])
      .filter((row) => normalize(row.sportsbook) !== normalize(over.sportsbook));
    if (!sources.length) return [];
    const weighted = sources.map((source) => ({
      sportsbook: source.sportsbook,
      weight: replaySourceWeight(source.market, source.sportsbook),
      probability: nflPlayerPropsTransportedMarketProbability({
        market: over.market === "passing_completions" ? "passing_completions" : undefined,
        projection: over.independentProjection!,
        sourceLine: source.line,
        sourceOverProbability: source.fairOver,
        targetLine: over.line,
      }),
    }));
    const denominator = weighted.reduce((sum, row) => sum + row.weight, 0);
    if (!(denominator > 0)) return [];
    const marketOver = weighted.reduce((sum, row) => sum + row.probability * row.weight, 0) / denominator;
    const rawOver = over.rawModelProbability;
    const incumbentFinalOver = over.finalProbability;
    const marketPolicy = nflPlayerPropsRuntimeMarketPolicy(over.market);
    if (!marketPolicy) return [];
    const residual = nflPlayerPropsResidualProbability(rawOver, marketOver, marketPolicy.weight);
    const candidateFinalOver = over.market === "passing_completions"
      ? incumbentFinalOver
      : nflPlayerPropsDiscreteMarketArbitration({
          propMarket: over.market,
          rawOverProbability: rawOver,
          marketOverProbability: marketOver,
          independentBooks: weighted.length,
          incumbentFinalOverProbability: residual,
        });
    const candidateProjection = nflPlayerPropsCoherentPosteriorDistribution({
      market: over.market,
      line: over.line,
      calibratedOverProbability: candidateFinalOver,
      independentProjection: over.independentProjection!,
    }).projection;
    const incumbentSide = incumbentFinalOver >= 0.5 ? "over" : "under";
    const candidateSide = candidateFinalOver >= 0.5 ? "over" : "under";
    const candidateRow = candidateSide === "over" ? over : under;
    const candidateProbability = candidateSide === "over" ? candidateFinalOver : 1 - candidateFinalOver;
    const candidateMarketProbability = candidateSide === "over" ? marketOver : 1 - marketOver;
    const expectedValue = nflPlayerPropsExpectedValue(candidateProbability, candidateRow.americanPrice);
    const probabilityEdge = candidateProbability - candidateMarketProbability;
    const lane = nflPlayerPropsProductionMarketLane(over.market);
    if (!lane) return [];
    const movement = candidateRow.marketMovement;
    const leanThresholds = movement === "support"
      ? policy.volumeAndYardage.movementSupportedLean
      : lane.leanThresholds ?? policy.volumeAndYardage.lean;
    const bestAngleThresholds = movement === "support"
      ? policy.volumeAndYardage.movementSupportedBestAngle
      : policy.volumeAndYardage.bestAngle;
    const grade = gradeNflPlayerPropsCrossMarketCandidate({
      commonHolds: [...candidateRow.healthHolds],
      independentBooks: weighted.length,
      divergenceImplausible: nflPlayerPropsRawMarketDivergenceImplausible(rawOver, marketOver),
      eligibleSide: lane.eligibleSides.includes(candidateSide),
      marketResidualQualified: marketPolicy.qualified || policy.releaseEvidence.ownerApprovedForwardException === true,
      bestAngleEnabled: lane.bestAngle,
      leanEnabled: lane.lean,
      watchlistEnabled: lane.watchlist,
      expectedValue,
      probabilityEdge,
      participationProbability: candidateRow.participationProbability,
      movement,
      leanThresholds,
      bestAngleThresholds,
    });
    const actual = sources[0]!.actual;
    if (actual === over.line) return [];
    const actualOver = actual > over.line;
    const incumbentWon = incumbentSide === (actualOver ? "over" : "under");
    const candidateWon = candidateSide === (actualOver ? "over" : "under");
    const incumbentForecastRow = incumbentSide === "over" ? over : under;
    return [{
      week: sources[0]!.week,
      gameId: over.gameId,
      market: over.market,
      line: over.line,
      actual,
      incumbentSide,
      candidateSide,
      incumbentWon,
      candidateWon,
      incumbentFinalOver,
      candidateFinalOver,
      incumbentProjection: over.projection,
      candidateProjection,
      incumbentGrade: incumbentForecastRow.grade,
      candidateGrade: grade,
      incumbentPrice: incumbentForecastRow.americanPrice,
      candidatePrice: candidateRow.americanPrice,
    }];
  });

  const summarizeCandidate = (selected: typeof rows) => {
    const incumbentWins = selected.filter((row) => row.incumbentWon).length;
    const candidateWins = selected.filter((row) => row.candidateWon).length;
    const sideChanges = selected.filter((row) => row.incumbentSide !== row.candidateSide);
    const incumbentActionables = selected.filter((row) => isActionable(row.incumbentGrade));
    const candidateActionables = selected.filter((row) => isActionable(row.candidateGrade));
    return {
      scopes: selected.length,
      games: new Set(selected.map((row) => row.gameId)).size,
      incumbentDirection: record(incumbentWins, selected.length),
      candidateDirection: record(candidateWins, selected.length),
      sideChanges: sideChanges.length,
      corrections: sideChanges.filter((row) => row.candidateWon && !row.incumbentWon).length,
      harms: sideChanges.filter((row) => !row.candidateWon && row.incumbentWon).length,
      incumbentBrier: brierOver(selected, "incumbentFinalOver"),
      candidateBrier: brierOver(selected, "candidateFinalOver"),
      incumbentProjectionMae: pointMae(selected, "incumbentProjection"),
      candidateProjectionMae: pointMae(selected, "candidateProjection"),
      incumbentActionables: actionableSummary(incumbentActionables, "incumbent"),
      candidateActionables: actionableSummary(candidateActionables, "candidate"),
      promotions: selected.filter((row) => !isActionable(row.incumbentGrade) && isActionable(row.candidateGrade)).length,
      demotions: selected.filter((row) => isActionable(row.incumbentGrade) && !isActionable(row.candidateGrade)).length,
    };
  };
  return {
    evidenceBoundary: "Exact Week 5 stored current-release scopes joined to cached T-60 FanDuel/NoVig/ProphetX; ProphetX is a historical sharp proxy, not Pinnacle.",
    combined: summarizeCandidate(rows),
    byMarket: [...new Set(rows.map((row) => row.market))].sort().map((market) => ({
      market,
      ...summarizeCandidate(rows.filter((row) => row.market === market)),
    })),
  };
}

function isActionable(grade: string): boolean { return grade === "Best Angle" || grade === "Lean"; }
function record(wins: number, total: number) { return { wins, losses: total - wins, hitRate: ratio(wins, total) }; }
function mean(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function brierOver<T extends { actual: number; line: number; incumbentFinalOver: number; candidateFinalOver: number }>(rows: T[], key: "incumbentFinalOver" | "candidateFinalOver"): number | null {
  return mean(rows.map((row) => (row[key] - Number(row.actual > row.line)) ** 2));
}
function pointMae<T extends { actual: number; incumbentProjection: number | null; candidateProjection: number }>(rows: T[], key: "incumbentProjection" | "candidateProjection"): number | null {
  const values = rows.flatMap((row) => typeof row[key] === "number" ? [Math.abs(row[key]! - row.actual)] : []);
  return mean(values);
}
function actionableSummary<T extends { incumbentWon: boolean; candidateWon: boolean; incumbentPrice: number; candidatePrice: number }>(rows: T[], kind: "incumbent" | "candidate") {
  const wins = rows.filter((row) => kind === "incumbent" ? row.incumbentWon : row.candidateWon).length;
  const units = rows.reduce((sum, row) => {
    const won = kind === "incumbent" ? row.incumbentWon : row.candidateWon;
    const price = kind === "incumbent" ? row.incumbentPrice : row.candidatePrice;
    return sum + (won ? (price < 0 ? 100 / Math.abs(price) : price / 100) : -1);
  }, 0);
  return { ...record(wins, rows.length), units };
}

async function cachedRequest<T>(args: {
  cacheDirectory: string; cacheKey: string; path: string; params: Record<string, string>;
  usage: Array<{ endpoint: string; last: number; remaining: number }>;
}): Promise<T> {
  const path = join(args.cacheDirectory, `${args.cacheKey}.json`);
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { /* cache miss */ }
  if (!args.params.apiKey) {
    throw new Error(`THE_ODDS_API_KEY is required for uncached replay request ${args.cacheKey}.`);
  }
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
    sourceWeightedConsensus: sourceWeightedConsensusSummary(rows),
    byMarket,
  };
}

function sourceWeightedConsensusSummary(rows: PairedLine[]) {
  const groups = Map.groupBy(rows, identity);
  const decisions = [...groups.values()].flatMap((group) => {
    const targetLine = median(group.map((row) => row.line));
    const votes = group.map((row) => ({
      side: transportedSide(row, targetLine),
      weight: replaySourceWeight(row.market, row.sportsbook),
    }));
    const overWeight = votes.filter((row) => row.side === "over").reduce((sum, row) => sum + row.weight, 0);
    const underWeight = votes.filter((row) => row.side === "under").reduce((sum, row) => sum + row.weight, 0);
    if (overWeight === underWeight || group[0]!.actual === targetLine) return [];
    const side = overWeight > underWeight ? "over" : "under";
    const won = side === "over" ? group[0]!.actual > targetLine : group[0]!.actual < targetLine;
    return [{ market: group[0]!.market, won }];
  });
  const summarizeDecisions = (selected: typeof decisions) => {
    const wins = selected.filter((row) => row.won).length;
    return { sample: selected.length, wins, losses: selected.length - wins, hitRate: ratio(wins, selected.length) };
  };
  return {
    combined: summarizeDecisions(decisions),
    byMarket: [...new Set(decisions.map((row) => row.market))].sort().map((market) => ({
      market,
      ...summarizeDecisions(decisions.filter((row) => row.market === market)),
    })),
  };
}

function replaySourceWeight(market: string, sportsbook: string): number {
  if (sportsbook === "prophetx") return 3;
  if (sportsbook === "novig") {
    if (["passing_completions", "rushing_attempts", "receiving_yards"].includes(market)) return 3;
    return 1.5;
  }
  if (sportsbook === "fanduel") {
    if (["receptions", "rushing_yards"].includes(market)) return 2.5;
    return 1;
  }
  return 1;
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
function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function isoNoMillis(value: number): string { return new Date(value).toISOString().replace(".000Z", "Z"); }
function argument(name: string): string | null {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
