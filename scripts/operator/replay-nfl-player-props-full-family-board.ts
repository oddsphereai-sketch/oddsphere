#!/usr/bin/env tsx

/** SELECT-only same-board replay for an NFL props release. */

import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE,
  type NflPlayerPropGameIdentity,
  type NflPlayerPropMarket,
  type NflPlayerPropPriceObservation,
  type NflPlayerPropsObservationSnapshot,
} from "../../lib/services/football/nflPlayerPropsContract";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { buildNflPlayerPropsInferenceContextFromForwardEvidence } from "../../lib/services/football/nflPlayerPropsInferenceContext";
import {
  NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE,
  type NflPlayerPropsExactOffer,
} from "../../lib/services/football/nflPlayerPropsMarketBoard";
import {
  buildNflPlayerPropsRuntimeBoard,
  buildNflPlayerPropsRuntimeFeatureRows,
  type NflPlayerPropsGrade,
} from "../../lib/services/football/nflPlayerPropsRuntime";
import { readNflPlayerPropsCurrentSeasonState } from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";

loadEnvConfig(process.cwd());

const INPUT = "football-research/cache/nfl-player-props-forward/nfl_player_props_forward_replay_r1.json";
const MARKET_BY_CODE: Record<string, NflPlayerPropMarket> = {
  td: "anytime_td", pa: "passing_attempts", pc: "passing_completions", py: "passing_yards",
  ry: "receiving_yards", rc: "receptions", ra: "rushing_attempts", ru: "rushing_yards",
};

type EvidenceBook = [string, "b" | "s" | "u", string, string, string, number | null,
  string | null, number | null, number | null, number | null, number | null,
  number | null, number | null, number | null, number];
type ReplayRow = {
  week: number; gameId: string; playerName: string; team: string; opponent: string;
  market: NflPlayerPropMarket; line: number; side: "over" | "under" | "yes";
  sportsbook: string; observedAt: string; lockAt: string; grade: NflPlayerPropsGrade;
  projection: number | null; finalProbability: number;
  actual: number | null; push: boolean | null;
  evidence: { books: EvidenceBook[] } | null;
};

async function main(): Promise<void> {
  const replay = JSON.parse(await readFile(INPUT, "utf8")) as { rows: ReplayRow[] };
  const replayWeek = Number(process.argv.find((value) => value.startsWith("--week="))?.slice(7) ?? "3");
  const sourceRows = replay.rows.filter((row) => row.week === replayWeek && row.evidence?.books.length);
  if (sourceRows.length === 0) throw new Error(`NFL player-props replay contains no Week ${replayWeek} rows with evidence.`);
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const [evidence, currentState] = await Promise.all([
    readNflForwardEvidence({ client, season: 2026, week: replayWeek }),
    readNflPlayerPropsCurrentSeasonState({ client, season: 2026 }),
  ]);
  if (!currentState) throw new Error("NFL player-props current-season state is unavailable.");
  const gamePayloads = new Map(evidence.map((row) => [row.providerGameId, row.payload]));
  const gameIds = new Set(sourceRows.map((row) => row.gameId));
  const games: NflPlayerPropGameIdentity[] = [...gameIds].flatMap((gameId) => {
    const payload = gamePayloads.get(gameId);
    return payload ? [{
      season: 2026, week: replayWeek, phase: "regular" as const, providerGameId: gameId,
      scheduledStart: payload.game.scheduledStart,
      homeTeam: payload.game.home.abbreviation, awayTeam: payload.game.away.abbreviation,
      homeTeamName: payload.game.home.name, awayTeamName: payload.game.away.name,
    }] : [];
  });
  const latestLock = sourceRows.reduce((latest, row) => Date.parse(row.lockAt) > Date.parse(latest) ? row.lockAt : latest, sourceRows[0]!.lockAt);
  const observations = featureObservations(sourceRows, latestLock);
  const snapshot = observationSnapshot(games, observations, latestLock);
  const context = buildNflPlayerPropsInferenceContextFromForwardEvidence({ snapshot, evidence, capturedAt: latestLock });
  const eligible = new Set(context.games.map((game) => game.canonicalGameId));
  const eligibleSnapshot = {
    ...snapshot,
    games: snapshot.games.filter((game) => eligible.has(game.providerGameId)),
    observations: snapshot.observations.filter((row) => row.canonicalGameId && eligible.has(row.canonicalGameId)),
  };
  const stateThroughWeekTwo = {
    ...currentState,
    completeThroughWeek: Math.min(currentState.completeThroughWeek, replayWeek - 1),
    games: currentState.games.filter((row) => row.week < replayWeek),
    teamStats: currentState.teamStats.filter((row) => row.week < replayWeek),
    stats: currentState.stats.filter((row) => row.week < replayWeek),
  };
  const features = buildNflPlayerPropsRuntimeFeatureRows({
    snapshot: eligibleSnapshot, context, currentSeasonState: stateThroughWeekTwo,
  });
  const offers = exactOffers(sourceRows, new Map(games.map((game) => [game.providerGameId, game.scheduledStart])))
    .filter((offer) => eligible.has(offer.canonicalGameId));
  const gameIdsForReplay = [...new Set(offers.map((offer) => offer.canonicalGameId))];
  const scoreReplay = (auditIncumbentMarketArbitration: boolean) => gameIdsForReplay.flatMap((gameId) => {
    const gameOffers = offers.filter((offer) => offer.canonicalGameId === gameId);
    const lockAt = gameOffers[0]?.lockAt;
    if (!lockAt) return [];
    return buildNflPlayerPropsRuntimeBoard({
      offers: gameOffers,
      features: features.filter((feature) => feature.gameId === gameId),
      evaluatedAt: lockAt,
      captureMarketEvidence: false,
      auditIncumbentMarketArbitration,
    }).decisions;
  });
  const incumbentRows = scoreReplay(true);
  const candidateRows = scoreReplay(false);
  const preceding = new Map(incumbentRows.map((row) => [decisionKey(row), row]));
  const candidate = new Map(candidateRows.map((row) => [decisionKey(row), row]));
  let matched = 0; let projectionChanges = 0; let forecastSideChanges = 0;
  let promotions = 0; let demotions = 0; let precedingActionables = 0; let candidateActionables = 0;
  const byMarket: Record<string, { matched: number; promotions: number; demotions: number; precedingActionables: number; candidateActionables: number }> = {};
  for (const [id, before] of preceding) {
    const after = candidate.get(id); if (!after) continue;
    matched += 1;
    const market = byMarket[before.market] ?? { matched: 0, promotions: 0, demotions: 0, precedingActionables: 0, candidateActionables: 0 };
    market.matched += 1;
    const beforeActionable = actionable(before.grade); const afterActionable = actionable(after.grade);
    precedingActionables += Number(beforeActionable); candidateActionables += Number(afterActionable);
    market.precedingActionables += Number(beforeActionable); market.candidateActionables += Number(afterActionable);
    if (!beforeActionable && afterActionable) { promotions += 1; market.promotions += 1; }
    if (beforeActionable && !afterActionable) { demotions += 1; market.demotions += 1; }
    if (typeof after.projection === "number" && typeof before.projection === "number"
      && Math.abs(after.projection - before.projection) > 1e-9) projectionChanges += 1;
    const beforeForecast = before.side === "yes" ? "yes"
      : before.finalProbability >= 0.5 ? before.side : before.side === "over" ? "under" : "over";
    const afterForecast = after.side === "yes" ? "yes" : (after.finalProbability >= 0.5 ? after.side : after.side === "over" ? "under" : "over");
    if (beforeForecast !== afterForecast) forecastSideChanges += 1;
    byMarket[before.market] = market;
  }
  const accuracy = compareForecastAccuracy(sourceRows, incumbentRows, candidateRows);
  console.log(JSON.stringify({
    release: "nfl_player_props_discrete_market_arbitration_same_board_replay_2026_10_07_r1",
    readOnly: true, writes: 0, providerCalls: 0,
    replayWeek,
    sourceRows: sourceRows.length, evidenceRows: evidence.length, offers: offers.length,
    featureRows: features.length, incumbentRows: incumbentRows.length, candidateRows: candidateRows.length, matched,
    projectionChanges, forecastSideChanges, promotions, demotions,
    precedingActionables, candidateActionables, byMarket,
    accuracy,
    requestBudget: context.requestBudget,
  }, null, 2));
}

type ReplayDecision = {
  gameId: string; playerName: string; market: NflPlayerPropMarket; line: number;
  side: "over" | "under" | "yes"; finalProbability: number; grade: NflPlayerPropsGrade; americanPrice: number;
};
type AccuracyAccumulator = {
  rows: number; precedingWins: number; candidateWins: number;
  precedingActionableRows: number; precedingActionableWins: number; candidateActionableRows: number; candidateActionableWins: number;
  precedingBrierSum: number; candidateBrierSum: number; precedingLogLossSum: number; candidateLogLossSum: number;
  precedingProbabilitySum: number; candidateProbabilitySum: number; outcomeSum: number;
  precedingActionableUnits: number; candidateActionableUnits: number;
};

function compareForecastAccuracy(source: ReplayRow[], incumbent: ReplayDecision[], candidate: ReplayDecision[]): Record<string, unknown> {
  const sourceGroups = groupByIdentity(source.filter((row) => row.market !== "anytime_td"));
  const incumbentGroups = groupByIdentity(incumbent.filter((row) => row.market !== "anytime_td"));
  const candidateGroups = groupByIdentity(candidate.filter((row) => row.market !== "anytime_td"));
  const markets: Record<string, AccuracyAccumulator> = {};
  for (const [identity, sourceIdentityRows] of sourceGroups) {
    const beforeRows = incumbentGroups.get(identity);
    const afterRows = candidateGroups.get(identity); if (!afterRows?.length) continue;
    if (!beforeRows?.length) continue;
    const actual = sourceIdentityRows.find((row) => row.actual !== null)?.actual;
    if (actual === null || actual === undefined || sourceIdentityRows.some((row) => row.push)) continue;
    const before = beforeRows.find((row) => row.side === "over") ?? beforeRows[0]!;
    const after = afterRows.find((row) => row.side === "over") ?? afterRows[0]!;
    const beforeOver = before.side === "over" ? before.finalProbability >= 0.5 : before.finalProbability < 0.5;
    const afterOver = after.side === "over" ? after.finalProbability >= 0.5 : after.finalProbability < 0.5;
    const overWon = actual > before.line;
    const outcome = Number(overWon);
    const beforeOverProbability = before.side === "over" ? before.finalProbability : 1 - before.finalProbability;
    const afterOverProbability = after.side === "over" ? after.finalProbability : 1 - after.finalProbability;
    const market = markets[before.market] ?? emptyAccuracyAccumulator();
    market.rows += 1;
    market.precedingWins += Number(beforeOver === overWon);
    market.candidateWins += Number(afterOver === overWon);
    market.precedingBrierSum += (beforeOverProbability - outcome) ** 2;
    market.candidateBrierSum += (afterOverProbability - outcome) ** 2;
    market.precedingLogLossSum += binaryLogLoss(beforeOverProbability, outcome);
    market.candidateLogLossSum += binaryLogLoss(afterOverProbability, outcome);
    market.precedingProbabilitySum += beforeOverProbability;
    market.candidateProbabilitySum += afterOverProbability;
    market.outcomeSum += outcome;
    const beforeActionableRow = beforeRows.find((row) => actionable(row.grade));
    const afterActionableRow = afterRows.find((row) => actionable(row.grade));
    const beforeActionable = beforeActionableRow !== undefined;
    const afterActionable = afterActionableRow !== undefined;
    market.precedingActionableRows += Number(beforeActionable);
    market.precedingActionableWins += Number(beforeActionable && beforeOver === overWon);
    market.candidateActionableRows += Number(afterActionable);
    market.candidateActionableWins += Number(afterActionable && afterOver === overWon);
    if (beforeActionableRow) market.precedingActionableUnits += decisionUnits(beforeActionableRow, overWon);
    if (afterActionableRow) market.candidateActionableUnits += decisionUnits(afterActionableRow, overWon);
    markets[before.market] = market;
  }
  const overall = Object.values(markets).reduce((sum, row) => addAccuracy(sum, row), emptyAccuracyAccumulator());
  return {
    overall: finalizeAccuracy(overall),
    byMarket: Object.fromEntries(Object.entries(markets).map(([market, values]) => [market, finalizeAccuracy(values)])),
  };
}

function emptyAccuracyAccumulator(): AccuracyAccumulator {
  return {
    rows: 0, precedingWins: 0, candidateWins: 0,
    precedingActionableRows: 0, precedingActionableWins: 0, candidateActionableRows: 0, candidateActionableWins: 0,
    precedingBrierSum: 0, candidateBrierSum: 0, precedingLogLossSum: 0, candidateLogLossSum: 0,
    precedingProbabilitySum: 0, candidateProbabilitySum: 0, outcomeSum: 0,
    precedingActionableUnits: 0, candidateActionableUnits: 0,
  };
}
function addAccuracy(first: AccuracyAccumulator, second: AccuracyAccumulator): AccuracyAccumulator {
  return Object.fromEntries(Object.keys(first).map((key) => [key,
    first[key as keyof AccuracyAccumulator] + second[key as keyof AccuracyAccumulator]])) as AccuracyAccumulator;
}
function finalizeAccuracy(values: AccuracyAccumulator): Record<string, number> {
  const divisor = Math.max(1, values.rows);
  return {
    rows: values.rows,
    precedingWins: values.precedingWins,
    candidateWins: values.candidateWins,
    precedingBrier: values.precedingBrierSum / divisor,
    candidateBrier: values.candidateBrierSum / divisor,
    precedingLogLoss: values.precedingLogLossSum / divisor,
    candidateLogLoss: values.candidateLogLossSum / divisor,
    precedingCalibrationGap: Math.abs(values.precedingProbabilitySum / divisor - values.outcomeSum / divisor),
    candidateCalibrationGap: Math.abs(values.candidateProbabilitySum / divisor - values.outcomeSum / divisor),
    precedingActionableRows: values.precedingActionableRows,
    precedingActionableWins: values.precedingActionableWins,
    precedingActionableUnits: values.precedingActionableUnits,
    candidateActionableRows: values.candidateActionableRows,
    candidateActionableWins: values.candidateActionableWins,
    candidateActionableUnits: values.candidateActionableUnits,
  };
}
function binaryLogLoss(probability: number, outcome: number): number {
  const bounded = Math.min(0.999999, Math.max(0.000001, probability));
  return -(outcome * Math.log(bounded) + (1 - outcome) * Math.log(1 - bounded));
}
function decisionUnits(row: ReplayDecision, overWon: boolean): number {
  const won = row.side === "over" ? overWon : !overWon;
  if (!won) return -1;
  return row.americanPrice < 0 ? 100 / Math.abs(row.americanPrice) : row.americanPrice / 100;
}

function groupByIdentity<T extends { gameId: string; playerName: string; market: string; line: number }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = [row.gameId, normalizeName(row.playerName), row.market, row.line].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function featureObservations(rows: ReplayRow[], timestamp: string): NflPlayerPropPriceObservation[] {
  const unique = new Map<string, ReplayRow>();
  for (const row of rows) unique.set([row.gameId, row.playerName, row.market].join("|"), row);
  return [...unique.values()].map((row, index) => ({
    provider: "balldontlie", providerObservationId: `replay-${index}`, providerEventId: row.gameId,
    canonicalGameId: row.gameId, providerPlayerId: null, playerName: row.playerName, playerTeam: row.team,
    sportsbook: "replay", market: row.market, providerMarket: row.market,
    offerType: row.market === "anytime_td" ? "milestone" : "over_under",
    side: row.market === "anytime_td" ? "yes" : "over", line: row.line, americanPrice: -110,
    observedAt: timestamp, fetchedAt: timestamp, isOpening: false, isLive: false,
    homeTeam: null, awayTeam: null, scheduledStart: null,
  }));
}

function observationSnapshot(games: NflPlayerPropGameIdentity[], observations: NflPlayerPropPriceObservation[], timestamp: string): NflPlayerPropsObservationSnapshot {
  const week = games[0]?.week ?? 0;
  return {
    schemaRelease: "nfl_player_props_research_schema_2026_08_20_r4",
    snapshotRelease: NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE,
    shadowModelRelease: "nfl_player_props_shadow_unfit_2026_08_20_r1",
    calibrationRelease: "nfl_player_props_calibration_unfit_2026_08_20_r1",
    decisionRelease: "nfl_player_props_decision_unfit_2026_08_20_r1",
    mode: "local_observe_only", actionable: false, generatedAt: timestamp, fetchedAt: timestamp,
    season: 2026, week, phase: "regular", games, observations,
    providerCoverage: {}, providerRequests: {}, collectionComplete: true, modelingReady: false, healthFindings: [],
  };
}

function exactOffers(rows: ReplayRow[], starts: Map<string, string>): NflPlayerPropsExactOffer[] {
  const identities = new Map<string, ReplayRow>();
  for (const row of rows) identities.set([row.gameId, normalizeName(row.playerName), row.market, row.line].join("|"), row);
  return [...identities.values()].flatMap((row) => (row.evidence?.books ?? []).map((book, index) => {
    const over = book[8]; const under = book[9]; const yes = book[10];
    const total = over !== null && under !== null ? implied(over) + implied(under) : null;
    return {
      release: NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE,
      offerKey: `${row.gameId}|${normalizeName(row.playerName)}|${row.market}|${row.line}|${book[0]}|${index}`,
      canonicalGameId: row.gameId, provider: book[1] === "s" ? "sharpapi" : "balldontlie",
      providerEventId: row.gameId, providerPlayerId: null, playerName: row.playerName, playerTeam: row.team,
      sportsbook: book[0], market: MARKET_BY_CODE[marketCode(row.market)]!,
      offerType: row.market === "anytime_td" ? "milestone" : "over_under", line: row.line,
      overPrice: over, underPrice: under, yesPrice: yes,
      overNoVigProbability: total ? implied(over!) / total : null,
      underNoVigProbability: total ? implied(under!) / total : null,
      observedAt: book[3], fetchedAt: book[4], openingObservedAt: book[6], openingLine: book[7],
      openingOverPrice: book[11], openingUnderPrice: book[12], openingYesPrice: book[13],
      scheduledStart: starts.get(row.gameId)!, lockAt: row.lockAt, state: "locked",
      exactPriceComplete: row.market === "anytime_td" ? yes !== null : over !== null && under !== null,
      gradeEligibleMarket: true, healthHolds: [],
    } satisfies NflPlayerPropsExactOffer;
  }));
}

function marketCode(market: NflPlayerPropMarket): string {
  return Object.entries(MARKET_BY_CODE).find(([, value]) => value === market)?.[0] ?? "";
}
function actionable(grade: NflPlayerPropsGrade): boolean { return grade === "Best Angle" || grade === "Lean"; }
function decisionKey(row: { gameId: string; playerName: string; market: string; line: number; side: string; sportsbook: string }): string {
  return [row.gameId, normalizeName(row.playerName), row.market, row.line, row.side, row.sportsbook.toLowerCase()].join("|");
}
function normalizeName(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, ""); }
function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function requiredEnv(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }

void main().catch((error) => { console.error(error); process.exitCode = 1; });
