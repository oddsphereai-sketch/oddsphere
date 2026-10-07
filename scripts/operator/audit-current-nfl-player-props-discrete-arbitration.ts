#!/usr/bin/env tsx

/** SELECT-only current-board A/B for the NFL receptions discrete market reader. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
  NFL_PLAYER_PROPS_DECISION_RELEASE,
  NFL_PLAYER_PROPS_MODEL_RELEASE,
  NFL_PLAYER_PROPS_BOARD_RELEASE,
  NFL_PLAYER_PROPS_RUNTIME_RELEASE,
  gradeNflPlayerPropsCrossMarketCandidate,
  nflPlayerPropsCoherentPosteriorDistribution,
  nflPlayerPropsDiscreteMarketArbitration,
  nflPlayerPropsExpectedValue,
  nflPlayerPropsProductionMarketLane,
  nflPlayerPropsRawMarketDivergenceImplausible,
  nflPlayerPropsRuntimeMarketPolicy,
  nflPlayerPropsRuntimePolicy,
  type NflPlayerPropsGrade,
  type NflPlayerPropsRuntimeDecision,
} from "../../lib/services/football/nflPlayerPropsRuntime";
import { readNflPlayerPropsSnapshotRecord } from "../../lib/services/football/nflPlayerPropsSnapshotStore";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const season = Number(optional("--season") ?? "2026");
  const week = Number(optional("--week") ?? "5");
  const record = await readNflPlayerPropsSnapshotRecord({ client, season, week });
  if (!record) throw new Error("NFL player-props production snapshot is unavailable.");
  const rows = record.snapshot.memberDecisions;
  const changes = rows.flatMap((row) => {
    const candidate = candidateRow(row);
    if (!candidate) return [];
    return candidate.finalProbability !== row.finalProbability
      || candidate.projection !== row.projection
      || candidate.grade !== row.grade
      ? [{ before: row, after: candidate }]
      : [];
  });
  const count = (grade: NflPlayerPropsGrade, candidate: boolean) => rows.filter((row) => {
    const compared = candidate ? candidateRow(row) ?? row : row;
    return compared.grade === grade;
  }).length;
  const actionable = (row: Pick<NflPlayerPropsRuntimeDecision, "grade">) => row.grade === "Best Angle" || row.grade === "Lean";
  const promotions = changes.filter(({ before, after }) => !actionable(before) && actionable(after));
  const demotions = changes.filter(({ before, after }) => actionable(before) && !actionable(after));
  const sideChanges = changes.filter(({ before, after }) => forecastSide(before) !== forecastSide(after));
  console.log(JSON.stringify({
    release: "nfl_player_props_current_discrete_arbitration_audit_2026_10_07_r1",
    readOnly: true,
    writes: 0,
    providerCalls: 0,
    season,
    week,
    generatedAt: record.generatedAt,
    incumbent: {
      snapshotRelease: record.snapshot.release,
      boardRelease: record.snapshot.board.release,
      decisions: rows.length,
      counts: Object.fromEntries((["Best Angle", "Lean", "Watchlist", "No Play", "Held"] as const).map((grade) => [grade, count(grade, false)])),
      actionable: rows.filter(actionable).length,
    },
    candidate: {
      runtimeRelease: NFL_PLAYER_PROPS_RUNTIME_RELEASE,
      boardRelease: NFL_PLAYER_PROPS_BOARD_RELEASE,
      modelRelease: NFL_PLAYER_PROPS_MODEL_RELEASE,
      calibrationRelease: NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
      decisionRelease: NFL_PLAYER_PROPS_DECISION_RELEASE,
      counts: Object.fromEntries((["Best Angle", "Lean", "Watchlist", "No Play", "Held"] as const).map((grade) => [grade, count(grade, true)])),
      actionable: rows.map((row) => candidateRow(row) ?? row).filter(actionable).length,
    },
    changedRows: changes.length,
    forecastSideChanges: sideChanges.length,
    promotions: promotions.length,
    demotions: demotions.length,
    changeExamples: changes.slice(0, 40).map(({ before, after }) => ({
      gameId: before.gameId,
      playerName: before.playerName,
      market: before.market,
      line: before.line,
      evaluatedSide: before.side,
      sportsbook: before.sportsbook,
      beforeForecast: forecastSide(before),
      afterForecast: forecastSide(after),
      beforeProbability: before.finalProbability,
      afterProbability: after.finalProbability,
      beforeProjection: before.projection,
      afterProjection: after.projection,
      beforeGrade: before.grade,
      afterGrade: after.grade,
    })),
  }, null, 2));
}

function candidateRow(row: NflPlayerPropsRuntimeDecision): NflPlayerPropsRuntimeDecision | null {
  if (row.market !== "receptions" || (row.side !== "over" && row.side !== "under")) return null;
  const independentProjection = row.projectionEvidence?.source === "single_posterior_distribution"
    ? row.projectionEvidence.independentProjection
    : null;
  if (independentProjection === null) return null;
  const rawOver = row.side === "over" ? row.rawModelProbability : 1 - row.rawModelProbability;
  const marketOver = row.side === "over" ? row.marketProbability : 1 - row.marketProbability;
  const incumbentOver = row.side === "over" ? row.finalProbability : 1 - row.finalProbability;
  const independentBooks = new Set(row.bookEvidence
    .filter((book) => normalize(book.sportsbook) !== normalize(row.sportsbook))
    .map((book) => normalize(book.sportsbook))).size;
  const candidateOver = nflPlayerPropsDiscreteMarketArbitration({
    propMarket: row.market,
    rawOverProbability: rawOver,
    marketOverProbability: marketOver,
    independentBooks,
    incumbentFinalOverProbability: incumbentOver,
  });
  if (candidateOver === incumbentOver) return row;
  const candidateProbability = row.side === "over" ? candidateOver : 1 - candidateOver;
  const candidateMarketProbability = row.side === "over" ? marketOver : 1 - marketOver;
  const edge = candidateProbability - candidateMarketProbability;
  const ev = nflPlayerPropsExpectedValue(candidateProbability, row.americanPrice);
  const lane = nflPlayerPropsProductionMarketLane(row.market);
  const policy = nflPlayerPropsRuntimePolicy();
  const marketPolicy = nflPlayerPropsRuntimeMarketPolicy(row.market);
  const raw = row.side === "over" ? rawOver : 1 - rawOver;
  const market = row.side === "over" ? marketOver : 1 - marketOver;
  const divergenceImplausible = nflPlayerPropsRawMarketDivergenceImplausible(raw, market);
  const commonHolds = row.healthHolds.filter((reason) => reason !== "model_market_divergence_implausible");
  const leanThresholds = row.marketMovement === "support"
    ? policy.volumeAndYardage.movementSupportedLean
    : lane?.leanThresholds ?? policy.volumeAndYardage.lean;
  const bestAngleThresholds = row.marketMovement === "support"
    ? policy.volumeAndYardage.movementSupportedBestAngle
    : policy.volumeAndYardage.bestAngle;
  const baseGrade = gradeNflPlayerPropsCrossMarketCandidate({
    commonHolds,
    independentBooks,
    divergenceImplausible,
    eligibleSide: lane?.eligibleSides.includes(row.side) ?? false,
    marketResidualQualified: marketPolicy?.qualified === true || policy.releaseEvidence.ownerApprovedForwardException === true,
    bestAngleEnabled: lane?.bestAngle === true,
    leanEnabled: lane?.lean === true,
    watchlistEnabled: lane?.watchlist === true,
    expectedValue: ev,
    probabilityEdge: edge,
    participationProbability: row.participationProbability,
    movement: row.marketMovement,
    leanThresholds,
    bestAngleThresholds,
  });
  const selectedForecastSide = candidateOver >= 0.5 ? "over" : "under";
  const grade = (baseGrade === "Best Angle" || baseGrade === "Lean") && row.side !== selectedForecastSide
    ? "Watchlist" as const
    : baseGrade;
  const posterior = nflPlayerPropsCoherentPosteriorDistribution({
    market: row.market,
    line: row.line,
    calibratedOverProbability: candidateOver,
    independentProjection,
  });
  return {
    ...row,
    projection: posterior.projection,
    projectionRange: posterior.range,
    finalProbability: candidateProbability,
    probabilityEdge: edge,
    expectedValue: ev,
    grade,
    healthHolds: divergenceImplausible ? [...commonHolds, "model_market_divergence_implausible"] : commonHolds,
    modelRelease: NFL_PLAYER_PROPS_MODEL_RELEASE,
    calibrationRelease: NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
    decisionRelease: NFL_PLAYER_PROPS_DECISION_RELEASE,
  };
}

function forecastSide(row: Pick<NflPlayerPropsRuntimeDecision, "side" | "finalProbability">): string {
  if (row.side === "yes") return "yes";
  return row.finalProbability >= 0.5 ? row.side : row.side === "over" ? "under" : "over";
}
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function optional(flag: string): string | null {
  const prefix = `${flag}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
