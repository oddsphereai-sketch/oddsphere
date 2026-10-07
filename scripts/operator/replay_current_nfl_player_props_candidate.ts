#!/usr/bin/env tsx

/** SELECT-only replay of a frozen current NFL player-props member snapshot. */

import { readFile, writeFile } from "node:fs/promises";
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
import type {
  NflPlayerPropsMarketEvidenceBook,
  NflPlayerPropsMarketEvidenceCapture,
} from "../../lib/services/football/nflPlayerPropsMarketEvidenceCapture";
import {
  buildNflPlayerPropsRuntimeBoard,
  buildNflPlayerPropsRuntimeFeatureRows,
  type NflPlayerPropsGrade,
} from "../../lib/services/football/nflPlayerPropsRuntime";
import { readNflPlayerPropsCurrentSeasonState } from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";

loadEnvConfig(process.cwd());

const MARKET_BY_CODE: Record<string, NflPlayerPropMarket> = {
  td: "anytime_td", pa: "passing_attempts", pc: "passing_completions", py: "passing_yards",
  ry: "receiving_yards", rc: "receptions", ra: "rushing_attempts", ru: "rushing_yards",
};

type FrozenDecision = {
  gameId: string; providerPlayerId: string | null; playerName: string; team: string; opponent: string;
  scheduledStart: string; market: NflPlayerPropMarket; line: number; side: "over" | "under" | "yes";
  sportsbook: string; provider: string; observedAt: string; lockAt: string; state: "locked" | "unlocked";
  grade: NflPlayerPropsGrade; finalProbability: number; projection: number | null; expectedValue: number;
  healthHolds: string[]; marketEvidenceId?: string;
};

type FrozenSnapshot = {
  season: number; week: number; generatedAt: string;
  board: { evaluatedAt: string; marketEvidence?: NflPlayerPropsMarketEvidenceCapture };
  memberDecisions: FrozenDecision[];
};

type CandidateDecision = FrozenDecision & {
  rawModelProbability: number; marketProbability: number; probabilityEdge: number; americanPrice: number;
};

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const input = argument("snapshot") ?? "/private/tmp/nfl-props-current-snapshot.json";
  const output = argument("output") ?? "/private/tmp/nfl-props-current-candidate.json";
  const envelope = JSON.parse(await readFile(input, "utf8")) as { snapshot?: FrozenSnapshot } & FrozenSnapshot;
  const frozen = envelope.snapshot ?? envelope;
  const capture = frozen.board.marketEvidence;
  if (!capture) throw new Error("Frozen NFL player-props snapshot has no retained market evidence.");

  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const [evidence, currentState] = await Promise.all([
    readNflForwardEvidence({ client, season: frozen.season, week: frozen.week }),
    readNflPlayerPropsCurrentSeasonState({ client, season: frozen.season }),
  ]);
  if (!currentState) throw new Error("NFL player-props current-season state is unavailable.");

  const gamePayloads = new Map(evidence.map((row) => [row.providerGameId, row.payload]));
  const games: NflPlayerPropGameIdentity[] = [...new Set(frozen.memberDecisions.map((row) => row.gameId))].flatMap((gameId) => {
    const payload = gamePayloads.get(gameId);
    return payload ? [{
      season: frozen.season, week: frozen.week, phase: "regular" as const, providerGameId: gameId,
      scheduledStart: payload.game.scheduledStart,
      homeTeam: payload.game.home.abbreviation, awayTeam: payload.game.away.abbreviation,
      homeTeamName: payload.game.home.name, awayTeamName: payload.game.away.name,
    }] : [];
  });
  const observations = featureObservations(frozen.memberDecisions, frozen.board.evaluatedAt);
  const providerSnapshot = observationSnapshot(frozen, games, observations);
  const context = buildNflPlayerPropsInferenceContextFromForwardEvidence({
    snapshot: providerSnapshot, evidence, capturedAt: frozen.board.evaluatedAt,
  });
  const eligible = new Set(context.games.map((game) => game.canonicalGameId));
  const eligibleSnapshot = {
    ...providerSnapshot,
    games: providerSnapshot.games.filter((game) => eligible.has(game.providerGameId)),
    observations: providerSnapshot.observations.filter((row) => row.canonicalGameId && eligible.has(row.canonicalGameId)),
  };
  const stateBeforeWeek = {
    ...currentState,
    completeThroughWeek: Math.min(currentState.completeThroughWeek, frozen.week - 1),
    games: currentState.games.filter((row) => row.week < frozen.week),
    teamStats: currentState.teamStats.filter((row) => row.week < frozen.week),
    stats: currentState.stats.filter((row) => row.week < frozen.week),
  };
  const features = buildNflPlayerPropsRuntimeFeatureRows({
    snapshot: eligibleSnapshot, context, currentSeasonState: stateBeforeWeek,
  });
  const offers = exactOffers(frozen.memberDecisions, capture)
    .filter((offer) => eligible.has(offer.canonicalGameId));
  const gameIds = [...new Set(offers.map((offer) => offer.canonicalGameId))];
  const candidate = gameIds.flatMap((gameId) => {
    const gameOffers = offers.filter((offer) => offer.canonicalGameId === gameId);
    return buildNflPlayerPropsRuntimeBoard({
      offers: gameOffers,
      features: features.filter((feature) => feature.gameId === gameId),
      evaluatedAt: frozen.board.evaluatedAt,
      captureMarketEvidence: false,
      auditIncumbentMarketArbitration: false,
    }).decisions;
  }) as CandidateDecision[];

  const retained = new Set(capture.i.map((identity) => identity[0]));
  const incumbent = frozen.memberDecisions.filter((row) => row.marketEvidenceId && retained.has(row.marketEvidenceId));
  const comparison = compare(incumbent, candidate);
  const result = {
    release: "nfl_player_props_current_snapshot_candidate_replay_2026_10_07_r1",
    readOnly: true, writes: 0, providerCalls: 0,
    sourceSnapshot: input,
    season: frozen.season, week: frozen.week, evaluatedAt: frozen.board.evaluatedAt,
    evidenceIdentitiesObserved: capture.n, evidenceIdentitiesRetained: capture.k,
    forwardEvidenceRows: evidence.length, offers: offers.length, featureRows: features.length,
    incumbentRows: incumbent.length, candidateRows: candidate.length,
    comparison,
    rows: candidate,
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
}

function compare(incumbent: FrozenDecision[], candidate: CandidateDecision[]): Record<string, unknown> {
  const before = new Map(incumbent.map((row) => [decisionKey(row), row]));
  const after = new Map(candidate.map((row) => [decisionKey(row), row]));
  const shared = [...before.keys()].filter((key) => after.has(key));
  const changes = shared.map((key) => [before.get(key)!, after.get(key)!] as const);
  const promotions = changes.filter(([first, second]) => !actionable(first.grade) && actionable(second.grade));
  const demotions = changes.filter(([first, second]) => actionable(first.grade) && !actionable(second.grade));
  const summarize = (rows: Array<FrozenDecision | CandidateDecision>) => ({
    rows: rows.length,
    actionable: rows.filter((row) => actionable(row.grade)).length,
    actionableOver: rows.filter((row) => actionable(row.grade) && forecastSide(row) === "over").length,
    actionableUnder: rows.filter((row) => actionable(row.grade) && forecastSide(row) === "under").length,
    forecastOver: rows.filter((row) => row.market !== "anytime_td" && forecastSide(row) === "over").length,
    forecastUnder: rows.filter((row) => row.market !== "anytime_td" && forecastSide(row) === "under").length,
  });
  const markets = [...new Set(changes.flatMap(([first, second]) => [first.market, second.market]))].sort();
  const transition = ([first, second]: readonly [FrozenDecision, CandidateDecision]) => ({
    gameId: first.gameId, playerName: first.playerName, market: first.market, line: first.line, side: first.side,
    sportsbook: first.sportsbook, beforeProjection: first.projection, afterProjection: second.projection,
    beforeProbability: first.finalProbability, afterProbability: second.finalProbability,
    beforeForecast: forecastSide(first), afterForecast: forecastSide(second),
    beforeGrade: first.grade, afterGrade: second.grade,
  });
  return {
    matchedRows: changes.length,
    missingCandidateRows: [...before.keys()].filter((key) => !after.has(key)).length,
    addedCandidateRows: [...after.keys()].filter((key) => !before.has(key)).length,
    projectionChanges: changes.filter(([first, second]) => first.projection !== second.projection).length,
    probabilityChanges: changes.filter(([first, second]) => first.finalProbability !== second.finalProbability).length,
    forecastSideChanges: changes.filter(([first, second]) => forecastSide(first) !== forecastSide(second)).length,
    gradeChanges: changes.filter(([first, second]) => first.grade !== second.grade).length,
    promotions: promotions.length,
    demotions: demotions.length,
    promotionDetails: promotions.map(transition),
    demotionDetails: demotions.map(transition),
    incumbent: summarize(incumbent),
    candidate: summarize(candidate),
    byMarket: Object.fromEntries(markets.map((market) => [market, {
      incumbent: summarize(incumbent.filter((row) => row.market === market)),
      candidate: summarize(candidate.filter((row) => row.market === market)),
      projectionChanges: changes.filter(([first, second]) => first.market === market && first.projection !== second.projection).length,
      probabilityChanges: changes.filter(([first, second]) => first.market === market && first.finalProbability !== second.finalProbability).length,
      forecastSideChanges: changes.filter(([first, second]) => first.market === market && forecastSide(first) !== forecastSide(second)).length,
      gradeChanges: changes.filter(([first, second]) => first.market === market && first.grade !== second.grade).length,
    }])),
  };
}

function featureObservations(rows: FrozenDecision[], timestamp: string): NflPlayerPropPriceObservation[] {
  const unique = new Map<string, FrozenDecision>();
  for (const row of rows) unique.set([row.gameId, normalizeName(row.playerName), row.market].join("|"), row);
  return [...unique.values()].map((row, index) => ({
    provider: "balldontlie", providerObservationId: `frozen-replay-${index}`, providerEventId: row.gameId,
    canonicalGameId: row.gameId, providerPlayerId: row.providerPlayerId, playerName: row.playerName,
    playerTeam: row.team, sportsbook: "frozen-replay", market: row.market, providerMarket: row.market,
    offerType: row.market === "anytime_td" ? "milestone" : "over_under",
    side: row.market === "anytime_td" ? "yes" : "over", line: row.line, americanPrice: -110,
    observedAt: timestamp, fetchedAt: timestamp, isOpening: false, isLive: false,
    homeTeam: null, awayTeam: null, scheduledStart: row.scheduledStart,
  }));
}

function observationSnapshot(
  frozen: FrozenSnapshot,
  games: NflPlayerPropGameIdentity[],
  observations: NflPlayerPropPriceObservation[],
): NflPlayerPropsObservationSnapshot {
  return {
    schemaRelease: "nfl_player_props_research_schema_2026_08_20_r4",
    snapshotRelease: NFL_PLAYER_PROPS_PROVIDER_SNAPSHOT_RELEASE,
    shadowModelRelease: "nfl_player_props_shadow_unfit_2026_08_20_r1",
    calibrationRelease: "nfl_player_props_calibration_unfit_2026_08_20_r1",
    decisionRelease: "nfl_player_props_decision_unfit_2026_08_20_r1",
    mode: "local_observe_only", actionable: false,
    generatedAt: frozen.board.evaluatedAt, fetchedAt: frozen.board.evaluatedAt,
    season: frozen.season, week: frozen.week, phase: "regular", games, observations,
    providerCoverage: {}, providerRequests: {}, collectionComplete: true, modelingReady: false, healthFindings: [],
  };
}

function exactOffers(rows: FrozenDecision[], capture: NflPlayerPropsMarketEvidenceCapture): NflPlayerPropsExactOffer[] {
  const rowByEvidence = new Map<string, FrozenDecision>();
  for (const row of rows) if (row.marketEvidenceId && !rowByEvidence.has(row.marketEvidenceId)) rowByEvidence.set(row.marketEvidenceId, row);
  return capture.i.flatMap((identity) => {
    const representative = rowByEvidence.get(identity[0]);
    if (!representative) return [];
    return identity[2].map((book, index) => exactOffer(representative, book, index));
  });
}

function exactOffer(row: FrozenDecision, book: NflPlayerPropsMarketEvidenceBook, index: number): NflPlayerPropsExactOffer {
  const over = book[8]; const under = book[9]; const yes = book[10];
  const total = over !== null && under !== null ? implied(over) + implied(under) : null;
  return {
    release: NFL_PLAYER_PROPS_MARKET_BOARD_RELEASE,
    offerKey: `${row.gameId}|${normalizeName(row.playerName)}|${row.market}|${row.line}|${book[0]}|${index}`,
    canonicalGameId: row.gameId, provider: book[1] === "s" ? "sharpapi" : "balldontlie",
    providerEventId: row.gameId, providerPlayerId: row.providerPlayerId,
    playerName: row.playerName, playerTeam: row.team, sportsbook: book[0], market: row.market,
    offerType: row.market === "anytime_td" ? "milestone" : "over_under", line: row.line,
    overPrice: over, underPrice: under, yesPrice: yes,
    overNoVigProbability: total ? implied(over!) / total : null,
    underNoVigProbability: total ? implied(under!) / total : null,
    observedAt: book[3], fetchedAt: book[4], openingObservedAt: book[6], openingLine: book[7],
    openingOverPrice: book[11], openingUnderPrice: book[12], openingYesPrice: book[13],
    scheduledStart: row.scheduledStart, lockAt: row.lockAt, state: row.state,
    exactPriceComplete: row.market === "anytime_td" ? yes !== null : over !== null && under !== null,
    gradeEligibleMarket: true, healthHolds: row.healthHolds,
  };
}

function decisionKey(row: Pick<FrozenDecision, "gameId" | "playerName" | "market" | "line" | "side" | "sportsbook">): string {
  return [row.gameId, normalizeName(row.playerName), row.market, row.line, row.side, row.sportsbook.toLowerCase()].join("|");
}
function actionable(grade: NflPlayerPropsGrade): boolean { return grade === "Best Angle" || grade === "Lean"; }
function forecastSide(row: Pick<FrozenDecision, "market" | "side" | "finalProbability">): "over" | "under" | "yes" {
  if (row.market === "anytime_td" || row.side === "yes") return "yes";
  return row.finalProbability >= 0.5 ? row.side : row.side === "over" ? "under" : "over";
}
function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, "");
}
function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function requiredEnv(name: string): string {
  const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value;
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
