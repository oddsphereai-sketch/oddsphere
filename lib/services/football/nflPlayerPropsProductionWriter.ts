import type { SupabaseClient } from "@supabase/supabase-js";
import {
  collectNflPlayerPropsObservations,
  NFL_PLAYER_PROPS_COLLECTION_LIMITS,
} from "./nflPlayerPropsCollector";
import { buildNflPlayerPropsInferenceContextFromForwardEvidence } from "./nflPlayerPropsInferenceContext";
import { readNflForwardEvidence } from "./nflForwardEvidenceStore";
import { buildNflPlayerPropsExactBoard } from "./nflPlayerPropsMarketBoard";
import {
  buildNflPlayerPropsRuntimeBoard,
  buildNflPlayerPropsRuntimeFeatureRows,
  NFL_PLAYER_PROPS_BOARD_RELEASE,
  NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
  NFL_PLAYER_PROPS_DECISION_RELEASE,
  NFL_PLAYER_PROPS_MODEL_RELEASE,
  verifyNflPlayerPropsRuntimeParity,
} from "./nflPlayerPropsRuntime";
import {
  buildNflPlayerPropsTrackingRows,
  NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE,
  reconcileNflPlayerPropsProductionSnapshot,
  type NflPlayerPropsProductionSnapshot,
} from "./nflPlayerPropsProductionContract";
import { readNflPlayerPropsSnapshot, writeNflPlayerPropsSnapshot } from "./nflPlayerPropsSnapshotStore";
import { updateNflPlayerPropsClosingPrices, writeLockedNflPlayerPropsTracking } from "./nflPlayerPropsTrackingStore";
import {
  NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE,
  NFL_PLAYER_PROPS_SETTLEMENT_RELEASE,
  settleNflPlayerPropsRecords,
} from "./nflPlayerPropsSettlement";

export const NFL_PLAYER_PROPS_WRITER_RELEASE =
  "nfl_player_props_writer_2026_09_03_r18_week_one_identity_capacity" as const;
export const NFL_PLAYER_PROPS_PRODUCTION_INCLUDE_OPENINGS = true as const;
export const NFL_PLAYER_PROPS_PRODUCTION_COLLECTION_CALL_MAXIMUM = (
  1
  + 2 * NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxGames
  + Math.ceil(NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxPlayerIdentities / NFL_PLAYER_PROPS_COLLECTION_LIMITS.playerIdentityBatchSize)
  + NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxSharpPages
) as 49;
export const NFL_PLAYER_PROPS_PRODUCTION_INCREMENTAL_CALL_MAXIMUM = (
  NFL_PLAYER_PROPS_PRODUCTION_COLLECTION_CALL_MAXIMUM
  + NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE
) as 67;

export type NflPlayerPropsForecastTelemetry = {
  forecastPolicy: "evaluated_sportsbook_excluded_from_qb_point_and_residual_consensus";
  lastKnownGoodPolicy: "write_only_after_complete_cycle_and_reconcile_locked_rows";
  boardRelease: typeof NFL_PLAYER_PROPS_BOARD_RELEASE;
  memberRelease: typeof NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE;
  passingYardsRows: number;
  targetExcludedPointConsensusRows: number;
  passingRowsWithoutTargetExcludedPointConsensus: number;
  targetExcludedResidualRows: number;
  unlockedPassingReleaseMismatches: number;
  lockedRows: number;
  actionableRows: number;
};

export type NflPlayerPropsWriterResult = {
  writerRelease: typeof NFL_PLAYER_PROPS_WRITER_RELEASE;
  settlementRelease: typeof NFL_PLAYER_PROPS_SETTLEMENT_RELEASE;
  contextSource: "nfl_forward_evidence";
  published: boolean;
  observations: number;
  exactOffers: number;
  featureRows: number;
  scoreEligibleFeatures: number;
  memberRows: number;
  counts: Record<string, number>;
  heldDiagnostics: number;
  trackingRows: number;
  closingPricesUpdated: number;
  settlementEligibleGames: number;
  settlementProcessedGames: number;
  settlementDeferredGames: number;
  settledRecords: number;
  apiCallsMaximum: number;
  healthFindings: string[];
  forecastTelemetry: NflPlayerPropsForecastTelemetry;
};

export function summarizeNflPlayerPropsForecastTelemetry(
  snapshot: NflPlayerPropsProductionSnapshot,
): NflPlayerPropsForecastTelemetry {
  const rows = snapshot.memberDecisions;
  const passingRows = rows.filter((row) => row.market === "passing_yards");
  const unlockedPassingReleaseMismatches = passingRows.filter((row) => row.state === "unlocked" && (
    row.modelRelease !== NFL_PLAYER_PROPS_MODEL_RELEASE
    || row.calibrationRelease !== NFL_PLAYER_PROPS_CALIBRATION_RELEASE
    || row.decisionRelease !== NFL_PLAYER_PROPS_DECISION_RELEASE
  )).length;
  return {
    forecastPolicy: "evaluated_sportsbook_excluded_from_qb_point_and_residual_consensus",
    lastKnownGoodPolicy: "write_only_after_complete_cycle_and_reconcile_locked_rows",
    boardRelease: snapshot.board.release,
    memberRelease: snapshot.release,
    passingYardsRows: passingRows.length,
    targetExcludedPointConsensusRows: passingRows.filter((row) =>
      row.projectionEvidence?.source === "market_dominant_expected_starter").length,
    passingRowsWithoutTargetExcludedPointConsensus: passingRows.filter((row) =>
      row.projectionEvidence?.source !== "market_dominant_expected_starter").length,
    targetExcludedResidualRows: passingRows.filter((row) => row.passingMarketEvidence?.source
      === "target_book_excluded_cross_line_transport").length,
    unlockedPassingReleaseMismatches,
    lockedRows: rows.filter((row) => row.state === "locked").length,
    actionableRows: rows.filter((row) => row.grade === "Best Angle" || row.grade === "Lean").length,
  };
}

export async function runNflPlayerPropsProductionWriter(args: {
  client: SupabaseClient;
  season: number;
  week: number;
  now: string;
  apply: boolean;
  ballDontLieApiKey: string;
  sharpApiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<NflPlayerPropsWriterResult> {
  verifyNflPlayerPropsRuntimeParity();
  const collection = await collectNflPlayerPropsObservations({
    season: args.season,
    week: args.week,
    phase: "regular",
    includeOpenings: NFL_PLAYER_PROPS_PRODUCTION_INCLUDE_OPENINGS,
    ballDontLieApiKey: args.ballDontLieApiKey,
    sharpApiKey: args.sharpApiKey,
    fetchImpl: args.fetchImpl,
  });
  const evidence = await readNflForwardEvidence({ client: args.client, season: args.season, week: args.week });
  const context = buildNflPlayerPropsInferenceContextFromForwardEvidence({
    snapshot: collection.snapshot,
    evidence,
    capturedAt: args.now,
  });
  const offers = buildNflPlayerPropsExactBoard({ snapshots: [collection.snapshot], evaluatedAt: args.now });
  const features = buildNflPlayerPropsRuntimeFeatureRows({ snapshot: collection.snapshot, context });
  const nextBoard = buildNflPlayerPropsRuntimeBoard({ offers, features, evaluatedAt: args.now });
  const previous = await readNflPlayerPropsSnapshot({ client: args.client, season: args.season, week: args.week });
  const snapshot = reconcileNflPlayerPropsProductionSnapshot({
    season: args.season,
    week: args.week,
    evaluatedAt: args.now,
    nextBoard,
    previous,
  });
  let closingPricesUpdated = 0;
  if (args.apply) {
    await writeNflPlayerPropsSnapshot({ client: args.client, snapshot, source: NFL_PLAYER_PROPS_WRITER_RELEASE });
    await writeLockedNflPlayerPropsTracking({ client: args.client, snapshot });
    closingPricesUpdated = await updateNflPlayerPropsClosingPrices({ client: args.client, production: snapshot, observations: collection.snapshot });
  }
  // Closing price must attach while a locked record is still pending. Running
  // settlement first made same-cycle finals permanently miss CLV because the
  // closing update intentionally refuses to rewrite a settled result.
  const settlement = args.apply
    ? await settleNflPlayerPropsRecords({ client: args.client, apiKey: args.ballDontLieApiKey, now: args.now, fetchImpl: args.fetchImpl })
    : { pending: 0, eligible: 0, eligibleGames: 0, processedGames: 0, deferredGames: 0, recordReadLimitReached: false, settled: 0, apiCalls: 0 };
  const providerRequests = Object.values(collection.snapshot.providerRequests).reduce((sum, value) => sum + (value ?? 0), 0);
  if (providerRequests > NFL_PLAYER_PROPS_PRODUCTION_COLLECTION_CALL_MAXIMUM) {
    throw new Error(`NFL player props collection exceeded its ${NFL_PLAYER_PROPS_PRODUCTION_COLLECTION_CALL_MAXIMUM}-call production budget.`);
  }
  const apiCallsMaximum = providerRequests + context.requestBudget.totalMaximum + settlement.apiCalls;
  if (apiCallsMaximum > NFL_PLAYER_PROPS_PRODUCTION_INCREMENTAL_CALL_MAXIMUM) {
    throw new Error(`NFL player props cycle exceeded its ${NFL_PLAYER_PROPS_PRODUCTION_INCREMENTAL_CALL_MAXIMUM}-call incremental budget.`);
  }
  return {
    writerRelease: NFL_PLAYER_PROPS_WRITER_RELEASE,
    settlementRelease: NFL_PLAYER_PROPS_SETTLEMENT_RELEASE,
    contextSource: context.source,
    published: args.apply,
    observations: collection.snapshot.observations.length,
    exactOffers: offers.length,
    featureRows: features.length,
    scoreEligibleFeatures: features.filter((row) => row.scoreEligible).length,
    memberRows: snapshot.memberDecisions.length,
    counts: snapshot.board.counts,
    heldDiagnostics: snapshot.board.counts.Held,
    trackingRows: buildNflPlayerPropsTrackingRows(snapshot).length,
    closingPricesUpdated,
    settlementEligibleGames: settlement.eligibleGames,
    settlementProcessedGames: settlement.processedGames,
    settlementDeferredGames: settlement.deferredGames,
    settledRecords: settlement.settled,
    apiCallsMaximum,
    forecastTelemetry: summarizeNflPlayerPropsForecastTelemetry(snapshot),
    healthFindings: [...new Set([
      ...collection.snapshot.healthFindings,
      ...context.healthHolds,
      ...(settlement.deferredGames > 0 ? [`NFL_PLAYER_PROPS_SETTLEMENT_GAMES_DEFERRED:${settlement.deferredGames}`] : []),
      ...(settlement.recordReadLimitReached ? ["NFL_PLAYER_PROPS_SETTLEMENT_RECORD_READ_LIMIT_REACHED"] : []),
    ])].sort(),
  };
}
