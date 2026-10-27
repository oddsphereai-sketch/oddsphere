import type { SupabaseClient } from "@supabase/supabase-js";
import type { NflPlayerPropMarket } from "./nflPlayerPropsContract";
import {
  collectNflPlayerPropsObservations,
  NFL_PLAYER_PROPS_COLLECTION_LIMITS,
} from "./nflPlayerPropsCollector";
import { buildNflPlayerPropsInferenceContextFromForwardEvidence } from "./nflPlayerPropsInferenceContext";
import { readNflForwardEvidence } from "./nflForwardEvidenceStore";
import {
  buildNflPlayerPropsExactBoard,
  type NflPlayerPropsExactOffer,
} from "./nflPlayerPropsMarketBoard";
import {
  buildNflPlayerPropsRuntimeBoard,
  buildNflPlayerPropsRuntimeFeatureRows,
  buildNflPlayerPropsRuntimeMarketEvidence,
  NFL_PLAYER_PROPS_BOARD_RELEASE,
  NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
  NFL_PLAYER_PROPS_DECISION_RELEASE,
  NFL_PLAYER_PROPS_MODEL_RELEASE,
  NFL_PLAYER_PROPS_SOURCE_AWARE_QUALIFIED_MARKETS,
  nflPlayerPropsRuntimePolicy,
  verifyNflPlayerPropsRuntimeParity,
} from "./nflPlayerPropsRuntime";
import {
  buildNflPlayerPropsTrackingRows,
  NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE,
  reconcileNflPlayerPropsProductionSnapshot,
  type NflPlayerPropsProductionSnapshot,
} from "./nflPlayerPropsProductionContract";
import { readNflPlayerPropsSnapshot, writeNflPlayerPropsSnapshot } from "./nflPlayerPropsSnapshotStore";
import {
  updateNflPlayerPropsClosingPrices,
  updateNflPlayerPropsClosingPricesFromObserver,
  writeLockedNflPlayerPropsTracking,
} from "./nflPlayerPropsTrackingStore";
import {
  NFL_PLAYER_PROPS_CURRENT_SEASON_GAMES_PAGE_MAXIMUM,
  NFL_PLAYER_PROPS_CURRENT_SEASON_STATS_PAGE_MAXIMUM,
  NFL_PLAYER_PROPS_CURRENT_SEASON_TEAM_STATS_PAGE_MAXIMUM,
  readNflPlayerPropsCurrentSeasonState,
  refreshNflPlayerPropsCurrentSeasonState,
  writeNflPlayerPropsCurrentSeasonState,
} from "./nflPlayerPropsCurrentSeasonState";
import {
  NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE,
  NFL_PLAYER_PROPS_SETTLEMENT_RELEASE,
  settleNflPlayerPropsRecords,
} from "./nflPlayerPropsSettlement";
import {
  nflPlayerPropsOverUnderMarketKey,
  nflPlayerPropsTouchdownPlayerKey,
  selectNflPlayerPropsOverForecasts,
  selectNflPlayerPropsTouchdownScorers,
} from "./nflPlayerPropsPrediction";
import {
  captureNflPlayerPropsMarketObserver,
  captureNflPlayerPropsMarketObserverSafely,
  readNflPlayerPropsMarketObserverHistory,
  type NflPlayerPropsMarketObserverSafeResult,
} from "./nflPlayerPropsMarketObserverStore";
import {
  captureNflPlayerPropsPrivateTracking,
  captureNflPlayerPropsPrivateTrackingSafely,
  type NflPlayerPropsPrivateTrackingSafeResult,
} from "./nflPlayerPropsPrivateTrackingStore";
import {
  readNflPlayerPropsReferenceOffers,
  writeNflPlayerPropsReferenceOffers,
} from "./nflPlayerPropsReferenceOfferStore";

export const NFL_PLAYER_PROPS_WRITER_RELEASE =
  "nfl_player_props_writer_2026_10_27_r62_consensus_contract_repair" as const;
export const NFL_PLAYER_PROPS_REFERENCE_CAPTURE_INTERVAL_MINUTES = 60 as const;
export const NFL_PLAYER_PROPS_PRODUCTION_INCLUDE_OPENINGS = true as const;
export const NFL_PLAYER_PROPS_PRODUCTION_COLLECTION_CALL_MAXIMUM = (
  1
  + 2 * NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxGames
  + Math.ceil(NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxPlayerIdentities / NFL_PLAYER_PROPS_COLLECTION_LIMITS.playerIdentityBatchSize)
  + NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxSharpPages
  + NFL_PLAYER_PROPS_COLLECTION_LIMITS.maxSharpReferencePages
) as 63;
export const NFL_PLAYER_PROPS_PRODUCTION_INCREMENTAL_CALL_MAXIMUM = (
  NFL_PLAYER_PROPS_PRODUCTION_COLLECTION_CALL_MAXIMUM
  + NFL_PLAYER_PROPS_CURRENT_SEASON_GAMES_PAGE_MAXIMUM
  + NFL_PLAYER_PROPS_CURRENT_SEASON_STATS_PAGE_MAXIMUM
  + NFL_PLAYER_PROPS_CURRENT_SEASON_TEAM_STATS_PAGE_MAXIMUM
  + NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE
) as 113;

export type NflPlayerPropsForecastTelemetry = {
  forecastPolicy: "target_excluded_single_posterior_exact_price_downstream";
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
  predictionSidesByMarket: Record<string, { over: number; under: number; yes: number; no: number }>;
  modalPredictionSidesByMarket: Record<string, { over: number; under: number; yes: number; no: number }>;
};

export type NflPlayerPropsCandidateImpact = {
  matchedRows: number;
  addedRows: number;
  removedRows: number;
  projectionChanges: number;
  forecastSideChanges: number;
  promotions: number;
  demotions: number;
  precedingActionables: number;
  candidateActionables: number;
  byMarket: Record<string, {
    matchedRows: number;
    projectionChanges: number;
    forecastSideChanges: number;
    promotions: number;
    demotions: number;
    precedingActionables: number;
    candidateActionables: number;
  }>;
};

export type NflPlayerPropsWriterResult = {
  writerRelease: typeof NFL_PLAYER_PROPS_WRITER_RELEASE;
  settlementRelease: typeof NFL_PLAYER_PROPS_SETTLEMENT_RELEASE;
  contextSource: "nfl_forward_evidence";
  published: boolean;
  observations: number;
  playerIdentities: number;
  exactOffers: number;
  referenceResearchObservations: number;
  referenceResearchOffers: number;
  referenceResearchObservationBooks: Record<string, number>;
  referenceResearchEligibleObservations: number;
  referenceResearchEvaluationAt: string;
  referenceResearchExactOfferBooks: Record<string, number>;
  referenceResearchCompleteExactOfferBooks: Record<string, number>;
  effectiveReferenceOffers: number;
  sourceAwareReferenceOffersAvailable: boolean;
  referenceOfferCacheError: string | null;
  referenceResearchObservationHealth: {
    canonicalGame: number;
    playerName: number;
    current: number;
    opening: number;
    over: number;
    under: number;
  };
  referenceResearchCaptureIdentities: number;
  referenceResearchRetainedBooks: Record<string, number>;
  featureRows: number;
  scoreEligibleFeatures: number;
  currentSeasonStateApiCalls: number;
  currentSeasonGamesAdded: number;
  currentSeasonTeamStatsAdded: number;
  currentSeasonStatsAdded: number;
  memberRows: number;
  decisionSupportTelemetry: {
    rows: number;
    qualifiedReferenceRows: number;
    legacyLockedRowsWithoutSupport: number;
  };
  counts: Record<string, number>;
  heldDiagnostics: number;
  trackingRows: number;
  closingPricesUpdated: number;
  observerClosingPricesUpdated: number;
  observerClosingPriceError: string | null;
  settlementEligibleGames: number;
  settlementProcessedGames: number;
  settlementDeferredGames: number;
  settledRecords: number;
  apiCallsMaximum: number;
  healthFindings: string[];
  forecastTelemetry: NflPlayerPropsForecastTelemetry;
  marketObserverCapture: NflPlayerPropsMarketObserverSafeResult | null;
  privateTrackingCapture: NflPlayerPropsPrivateTrackingSafeResult | null;
  candidateImpact?: NflPlayerPropsCandidateImpact;
  liveImpact?: NflPlayerPropsCandidateImpact;
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
  const predictionSidesByMarket = summarizePredictionSides(rows, true);
  const modalPredictionSidesByMarket = summarizePredictionSides(rows, false);
  return {
    forecastPolicy: "target_excluded_single_posterior_exact_price_downstream",
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
    predictionSidesByMarket,
    modalPredictionSidesByMarket,
  };
}

function summarizePredictionSides(
  rows: NflPlayerPropsProductionSnapshot["memberDecisions"],
  publishedForecast: boolean,
): Record<string, { over: number; under: number; yes: number; no: number }> {
  const result: Record<string, { over: number; under: number; yes: number; no: number }> = {};
  const groups = new Map<string, typeof rows>();
  const touchdownScorers = selectNflPlayerPropsTouchdownScorers(rows);
  const overForecasts = selectNflPlayerPropsOverForecasts(rows);
  for (const row of rows) {
    const groupKey = [row.gameId, row.playerName, row.market, row.line].join("|");
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
  }
  for (const marketRows of groups.values()) {
    const first = marketRows[0]!;
    const counts = result[first.market] ?? { over: 0, under: 0, yes: 0, no: 0 };
    if (first.market === "anytime_td") {
      const outcome = (publishedForecast
        ? touchdownScorers.has(nflPlayerPropsTouchdownPlayerKey(first))
        : first.finalProbability >= 0.5) ? "yes" : "no";
      counts[outcome] += 1;
    } else {
      const over = marketRows.find((row) => row.side === "over");
      const under = marketRows.find((row) => row.side === "under");
      const overProbability = over?.finalProbability ?? (under ? 1 - under.finalProbability : 0);
      const overSelected = publishedForecast
        ? overForecasts.has(nflPlayerPropsOverUnderMarketKey(first))
        : overProbability >= 0.5;
      counts[overSelected ? "over" : "under"] += 1;
    }
    result[first.market] = counts;
  }
  return result;
}

export async function runNflPlayerPropsProductionWriter(args: {
  client: SupabaseClient;
  season: number;
  week: number;
  now: string;
  apply: boolean;
  ballDontLieApiKey: string;
  sharpApiKey?: string;
  /** Optional audit telemetry; production uses the qualified release regardless. */
  auditSourceAwareMarketReading?: boolean;
  /** Optional no-write candidate scope. Production callers omit this. */
  auditSourceAwareQualifiedMarkets?: NflPlayerPropMarket[];
  /** Optional no-write candidate scope. Production callers omit this. */
  auditDiscreteMarketCorrectionMarkets?: NflPlayerPropMarket[];
  fetchImpl?: typeof fetch;
}): Promise<NflPlayerPropsWriterResult> {
  verifyNflPlayerPropsRuntimeParity();
  const [priorCurrentSeasonState, previous, retainedReferenceOffers] = await Promise.all([
    readNflPlayerPropsCurrentSeasonState({ client: args.client, season: args.season }),
    readNflPlayerPropsSnapshot({ client: args.client, season: args.season, week: args.week }),
    readNflPlayerPropsReferenceOffers({ client: args.client, season: args.season, week: args.week }).catch(() => null),
  ]);
  const currentSeason = await refreshNflPlayerPropsCurrentSeasonState({
    season: args.season,
    week: args.week,
    now: args.now,
    apiKey: args.ballDontLieApiKey,
    previous: priorCurrentSeasonState,
    fetchImpl: args.fetchImpl,
  });
  const collection = await collectNflPlayerPropsObservations({
    season: args.season,
    week: args.week,
    phase: "regular",
    includeOpenings: NFL_PLAYER_PROPS_PRODUCTION_INCLUDE_OPENINGS,
    ballDontLieApiKey: args.ballDontLieApiKey,
    sharpApiKey: args.sharpApiKey,
    includeReferenceResearch: retainedReferenceOffers === null
      || args.auditSourceAwareMarketReading === true
      || shouldCaptureNflPlayerPropsReferenceResearch({
        now: args.now,
        previous,
        retainedReferenceOffers: retainedReferenceOffers.offers,
      }),
    fetchImpl: args.fetchImpl,
  });
  const evidence = await readNflForwardEvidence({ client: args.client, season: args.season, week: args.week });
  const context = buildNflPlayerPropsInferenceContextFromForwardEvidence({
    snapshot: collection.snapshot,
    evidence,
    capturedAt: args.now,
  });
  const eligibleGameIds = new Set(context.games.map((game) => game.canonicalGameId));
  const eligibleSnapshot = {
    ...collection.snapshot,
    games: collection.snapshot.games.filter((game) => eligibleGameIds.has(game.providerGameId)),
    observations: collection.snapshot.observations.filter((row) => (
      row.canonicalGameId !== null && eligibleGameIds.has(row.canonicalGameId)
    )),
  };
  const offers = buildNflPlayerPropsExactBoard({ snapshots: [eligibleSnapshot], evaluatedAt: args.now });
  const referenceEvaluatedAt = nflPlayerPropsReferenceEvaluationTime({
    writerStartedAt: args.now,
    referenceObservations: collection.referenceResearchObservations,
  });
  const referenceResearchSnapshot = {
    ...eligibleSnapshot,
    observations: [
      ...eligibleSnapshot.observations,
      ...collection.referenceResearchObservations.filter((row) => (
        row.canonicalGameId !== null && eligibleGameIds.has(row.canonicalGameId)
      )),
    ],
  };
  const eligibleReferenceObservations = collection.referenceResearchObservations.filter((row) => (
    row.canonicalGameId !== null && eligibleGameIds.has(row.canonicalGameId)
  ));
  const referenceResearchOffers = collection.referenceResearchObservations.length > 0
    ? buildNflPlayerPropsExactBoard({
        snapshots: [referenceResearchSnapshot],
        evaluatedAt: referenceEvaluatedAt,
        referenceOfferPairing: "same_fetch_player_name",
      })
    : offers;
  const sourceAwareReferenceOffers = collection.referenceResearchObservations.length > 0
    ? buildNflPlayerPropsExactBoard({
        snapshots: [{
          ...eligibleSnapshot,
          observations: eligibleReferenceObservations,
        }],
        evaluatedAt: referenceEvaluatedAt,
        referenceOfferPairing: "same_fetch_player_name",
      })
    : [];
  const completeSourceAwareReferenceOffers = sourceAwareReferenceOffers.filter((offer) => (
    offer.exactPriceComplete && offer.gradeEligibleMarket
  ));
  const effectiveReferenceOffers = completeSourceAwareReferenceOffers.length > 0
    ? completeSourceAwareReferenceOffers
    : [...(retainedReferenceOffers?.offers ?? [])];
  const sourceAwareReferenceOffersAvailable = nflPlayerPropsSourceAwareReferenceOffersAvailable({
    offers: effectiveReferenceOffers,
    evaluatedAt: referenceEvaluatedAt,
  });
  const referenceResearchObservationBooks = countByNormalizedBook(collection.referenceResearchObservations);
  const referenceResearchExactOfferBooks = countByNormalizedBook(sourceAwareReferenceOffers);
  const referenceResearchCompleteExactOfferBooks = countByNormalizedBook(
    sourceAwareReferenceOffers.filter((offer) => offer.exactPriceComplete),
  );
  const referenceResearchObservationHealth = {
    canonicalGame: collection.referenceResearchObservations.filter((row) => row.canonicalGameId !== null).length,
    playerName: collection.referenceResearchObservations.filter((row) => row.playerName !== null).length,
    current: collection.referenceResearchObservations.filter((row) => !row.isOpening).length,
    opening: collection.referenceResearchObservations.filter((row) => row.isOpening).length,
    over: collection.referenceResearchObservations.filter((row) => row.side === "over").length,
    under: collection.referenceResearchObservations.filter((row) => row.side === "under").length,
  };
  const features = buildNflPlayerPropsRuntimeFeatureRows({
    snapshot: eligibleSnapshot,
    context,
    currentSeasonState: currentSeason.state,
  });
  const precedingSourceAwareReferenceOffersAvailable = nflPlayerPropsSourceAwareReferenceOffersAvailable({
    offers: effectiveReferenceOffers.filter((offer) => offer.market === "receptions"),
    evaluatedAt: referenceEvaluatedAt,
  });
  const incumbentBoard = buildNflPlayerPropsRuntimeBoard({
    offers,
    referenceOffers: effectiveReferenceOffers,
    features,
    evaluatedAt: args.now,
    auditSourceAwareMarketReading: precedingSourceAwareReferenceOffersAvailable,
    auditSourceAwareQualifiedMarkets: ["receptions"],
    auditIncumbentMarketArbitrationMarkets: ["receiving_yards"],
  });
  const nextBoard = buildNflPlayerPropsRuntimeBoard({
    offers,
    referenceOffers: effectiveReferenceOffers,
    features,
    evaluatedAt: args.now,
    auditSourceAwareMarketReading: sourceAwareReferenceOffersAvailable,
    auditSourceAwareQualifiedMarkets: args.auditSourceAwareQualifiedMarkets,
    auditDiscreteMarketCorrectionMarkets: args.auditDiscreteMarketCorrectionMarkets,
  });
  const referenceResearchMarketEvidence = collection.referenceResearchObservations.length > 0
    ? buildNflPlayerPropsRuntimeMarketEvidence({
      offers: referenceResearchOffers,
      decisions: nextBoard.decisions,
      evaluatedAt: args.now,
    }).capture
    : nextBoard.marketEvidence;
  const referenceResearchRetainedBooks = Object.fromEntries(
    [...new Set((referenceResearchMarketEvidence?.i ?? []).flatMap((identity) => identity[2].map((book) => book[0])))]
      .sort()
      .map((sportsbook) => [sportsbook, (referenceResearchMarketEvidence?.i ?? [])
        .reduce((count, identity) => count + identity[2].filter((book) => book[0] === sportsbook).length, 0)]),
  );
  const snapshot = reconcileNflPlayerPropsProductionSnapshot({
    season: args.season,
    week: args.week,
    evaluatedAt: args.now,
    nextBoard,
    previous,
  });
  const candidateImpact = compareNflPlayerPropsCandidateImpact(
    reconcileNflPlayerPropsProductionSnapshot({
        season: args.season,
        week: args.week,
        evaluatedAt: args.now,
        nextBoard: incumbentBoard,
        previous,
      }),
    snapshot,
  );
  const liveImpact = !args.apply && previous
    ? compareNflPlayerPropsCandidateImpact(previous, snapshot)
    : undefined;
  let closingPricesUpdated = 0;
  let observerClosingPricesUpdated = 0;
  let observerClosingPriceError: string | null = null;
  let referenceOfferCacheError: string | null = null;
  if (args.apply) {
    await writeNflPlayerPropsCurrentSeasonState({ client: args.client, state: currentSeason.state });
    await writeNflPlayerPropsSnapshot({ client: args.client, snapshot, source: NFL_PLAYER_PROPS_WRITER_RELEASE });
    await writeLockedNflPlayerPropsTracking({ client: args.client, snapshot });
    closingPricesUpdated = await updateNflPlayerPropsClosingPrices({ client: args.client, production: snapshot, observations: eligibleSnapshot });
    if (completeSourceAwareReferenceOffers.length > 0) {
      try {
        await writeNflPlayerPropsReferenceOffers({
          client: args.client,
          season: args.season,
          week: args.week,
          updatedAt: args.now,
          offers: completeSourceAwareReferenceOffers,
        });
      } catch (error) {
        referenceOfferCacheError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  // Capture the immutable exact T-60 tuple before settlement, then use that
  // same stored row to fill only absent closing metadata. The locked pick,
  // line, probability, grade, stake, and result remain untouched.
  const marketObserverCapture = args.apply
    ? await captureNflPlayerPropsMarketObserverSafely(() => captureNflPlayerPropsMarketObserver({
      client: args.client,
      snapshot,
      currentMarketEvidence: referenceResearchMarketEvidence,
      evaluatedAt: args.now,
      maximumLockQuoteAgeHours: nflPlayerPropsRuntimePolicy().maximumQuoteAgeHours,
      writerRelease: NFL_PLAYER_PROPS_WRITER_RELEASE,
    }))
    : null;
  if (args.apply) {
    try {
      const history = await readNflPlayerPropsMarketObserverHistory({ client: args.client, season: args.season, week: args.week });
      observerClosingPricesUpdated = await updateNflPlayerPropsClosingPricesFromObserver({
        client: args.client,
        rows: history?.rows ?? [],
      });
    } catch (error) {
      observerClosingPriceError = error instanceof Error ? error.message : String(error);
    }
  }
  const settlement = args.apply
    ? await settleNflPlayerPropsRecords({ client: args.client, apiKey: args.ballDontLieApiKey, now: args.now, fetchImpl: args.fetchImpl })
    : { pending: 0, eligible: 0, eligibleGames: 0, processedGames: 0, deferredGames: 0, recordReadLimitReached: false, settled: 0, apiCalls: 0 };
  // The private diagnostic archive is also last and failure-isolated. It
  // records every already-locked decision, including No Plays and alternate
  // lines, without changing the public board or the official actionable ledger.
  const privateTrackingCapture = args.apply
    ? await captureNflPlayerPropsPrivateTrackingSafely(() => captureNflPlayerPropsPrivateTracking({
      client: args.client,
      snapshot,
      evaluatedAt: args.now,
      writerRelease: NFL_PLAYER_PROPS_WRITER_RELEASE,
    }))
    : null;
  const providerRequests = Object.values(collection.snapshot.providerRequests).reduce((sum, value) => sum + (value ?? 0), 0);
  if (providerRequests > NFL_PLAYER_PROPS_PRODUCTION_COLLECTION_CALL_MAXIMUM) {
    throw new Error(`NFL player props collection exceeded its ${NFL_PLAYER_PROPS_PRODUCTION_COLLECTION_CALL_MAXIMUM}-call production budget.`);
  }
  const apiCallsMaximum = providerRequests + context.requestBudget.totalMaximum + currentSeason.apiCalls + settlement.apiCalls;
  if (apiCallsMaximum > NFL_PLAYER_PROPS_PRODUCTION_INCREMENTAL_CALL_MAXIMUM) {
    throw new Error(`NFL player props cycle exceeded its ${NFL_PLAYER_PROPS_PRODUCTION_INCREMENTAL_CALL_MAXIMUM}-call incremental budget.`);
  }
  return {
    writerRelease: NFL_PLAYER_PROPS_WRITER_RELEASE,
    settlementRelease: NFL_PLAYER_PROPS_SETTLEMENT_RELEASE,
    contextSource: context.source,
    published: args.apply,
    observations: collection.snapshot.observations.length,
    playerIdentities: collection.snapshot.providerCoverage.balldontlie?.playersWithProviderIdentity ?? 0,
    exactOffers: offers.length,
    referenceResearchObservations: collection.referenceResearchObservations.length,
    referenceResearchOffers: referenceResearchOffers.length,
    referenceResearchObservationBooks,
    referenceResearchEligibleObservations: eligibleReferenceObservations.length,
    referenceResearchEvaluationAt: referenceEvaluatedAt,
    referenceResearchExactOfferBooks,
    referenceResearchCompleteExactOfferBooks,
    effectiveReferenceOffers: effectiveReferenceOffers.length,
    sourceAwareReferenceOffersAvailable,
    referenceOfferCacheError,
    referenceResearchObservationHealth,
    referenceResearchCaptureIdentities: referenceResearchMarketEvidence?.i.length ?? 0,
    referenceResearchRetainedBooks,
    featureRows: features.length,
    scoreEligibleFeatures: features.filter((row) => row.scoreEligible).length,
    currentSeasonStateApiCalls: currentSeason.apiCalls,
    currentSeasonGamesAdded: currentSeason.gamesAdded,
    currentSeasonTeamStatsAdded: currentSeason.teamStatsAdded,
    currentSeasonStatsAdded: currentSeason.statsAdded,
    memberRows: snapshot.memberDecisions.length,
    decisionSupportTelemetry: {
      rows: snapshot.memberDecisions.filter((row) => row.decisionSupport !== undefined).length,
      qualifiedReferenceRows: snapshot.memberDecisions.filter((row) => (
        row.decisionSupport?.qualifiedReference.availability === "available"
      )).length,
      legacyLockedRowsWithoutSupport: snapshot.memberDecisions.filter((row) => (
        row.state === "locked" && row.decisionSupport === undefined
      )).length,
    },
    counts: snapshot.board.counts,
    heldDiagnostics: snapshot.board.counts.Held,
    trackingRows: buildNflPlayerPropsTrackingRows(snapshot).length,
    closingPricesUpdated,
    observerClosingPricesUpdated,
    observerClosingPriceError,
    settlementEligibleGames: settlement.eligibleGames,
    settlementProcessedGames: settlement.processedGames,
    settlementDeferredGames: settlement.deferredGames,
    settledRecords: settlement.settled,
    apiCallsMaximum,
    forecastTelemetry: summarizeNflPlayerPropsForecastTelemetry(snapshot),
    marketObserverCapture,
    privateTrackingCapture,
    ...(candidateImpact ? { candidateImpact } : {}),
    ...(liveImpact ? { liveImpact } : {}),
    healthFindings: [...new Set([
      ...collection.snapshot.healthFindings,
      ...context.healthHolds,
      ...(settlement.deferredGames > 0 ? [`NFL_PLAYER_PROPS_SETTLEMENT_GAMES_DEFERRED:${settlement.deferredGames}`] : []),
      ...(settlement.recordReadLimitReached ? ["NFL_PLAYER_PROPS_SETTLEMENT_RECORD_READ_LIMIT_REACHED"] : []),
      ...(marketObserverCapture?.error ? ["NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_FAILED"] : []),
      ...(observerClosingPriceError ? ["NFL_PLAYER_PROPS_OBSERVER_CLOSING_PRICE_RECOVERY_FAILED"] : []),
      ...(privateTrackingCapture?.error ? ["NFL_PLAYER_PROPS_PRIVATE_TRACKING_CAPTURE_FAILED"] : []),
      ...(referenceOfferCacheError ? ["NFL_PLAYER_PROPS_REFERENCE_OFFER_CACHE_FAILED"] : []),
      ...(!sourceAwareReferenceOffersAvailable ? ["NFL_PLAYER_PROPS_SOURCE_AWARE_REFERENCE_OFFERS_UNAVAILABLE"] : []),
    ])].sort(),
  };
}

function countByNormalizedBook(rows: readonly { sportsbook: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const book = row.sportsbook.toLowerCase().replace(/[^a-z0-9]/g, "");
    counts[book] = (counts[book] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([first], [second]) => first.localeCompare(second)));
}

export function nflPlayerPropsSourceAwareReferenceOffersAvailable(args: {
  offers: readonly Pick<NflPlayerPropsExactOffer, "market" | "observedAt">[];
  evaluatedAt: string;
}): boolean {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL props reference availability time is invalid.");
  const maximumAgeMs = nflPlayerPropsRuntimePolicy().maximumQuoteAgeHours * 3_600_000;
  return args.offers.some((offer) => {
    const observedAt = Date.parse(offer.observedAt);
    return NFL_PLAYER_PROPS_SOURCE_AWARE_QUALIFIED_MARKETS.some((market) => market === offer.market)
      && Number.isFinite(observedAt)
      && observedAt <= evaluatedAt
      && evaluatedAt - observedAt <= maximumAgeMs;
  });
}

export function nflPlayerPropsReferenceEvaluationTime(args: {
  writerStartedAt: string;
  referenceObservations: readonly { fetchedAt: string; observedAt: string }[];
}): string {
  const writerStartedAt = Date.parse(args.writerStartedAt);
  if (!Number.isFinite(writerStartedAt)) throw new Error("NFL props writer start time is invalid.");
  const completedAt = args.referenceObservations.reduce((latest, row) => {
    const fetchedAt = Date.parse(row.fetchedAt);
    const observedAt = Date.parse(row.observedAt);
    if (!Number.isFinite(fetchedAt)) return latest;
    const coherentObservationAt = Number.isFinite(observedAt) && observedAt <= fetchedAt + 60_000
      ? Math.max(fetchedAt, observedAt)
      : fetchedAt;
    return Math.max(latest, coherentObservationAt);
  }, writerStartedAt);
  return new Date(completedAt).toISOString();
}

export function shouldCaptureNflPlayerPropsReferenceResearch(args: {
  now: string;
  previous: NflPlayerPropsProductionSnapshot | null;
  retainedReferenceOffers: readonly Pick<NflPlayerPropsExactOffer, "market" | "observedAt">[];
}): boolean {
  const now = Date.parse(args.now);
  if (!Number.isFinite(now)) throw new Error("NFL props reference-capture time is invalid.");
  if (!args.previous) return true;
  // A failed hourly pull must not strand the writer on a stale cache until the
  // next hourly boundary. The existing state-aware writer cadence is already
  // bounded; when it wakes again, retry only if the retained qualified lane is
  // actually unavailable under the same quote-age policy used by evaluation.
  // Fresh retained Pinnacle/NoVig evidence still keeps ordinary wakes from
  // multiplying provider calls.
  if (!nflPlayerPropsSourceAwareReferenceOffersAvailable({
    offers: args.retainedReferenceOffers,
    evaluatedAt: args.now,
  })) return true;
  // The route wakes every 15 minutes, but the props planner is elapsed-time
  // based and can stay anchored at :21/:36/:51. A UTC-minute gate therefore
  // allowed a fresh-but-partial early cache to suppress Pinnacle/NoVig pulls
  // for several hours. Refresh from the age of the newest retained qualified
  // offer instead. The surrounding state-aware cadence still caps ordinary
  // pulls at one per hour, while the lock-window branch below preserves the
  // final pregame comparison.
  const newestQualifiedObservedAt = args.retainedReferenceOffers.reduce((latest, offer) => {
    if (!NFL_PLAYER_PROPS_SOURCE_AWARE_QUALIFIED_MARKETS.some((market) => market === offer.market)) {
      return latest;
    }
    const observedAt = Date.parse(offer.observedAt);
    return Number.isFinite(observedAt) && observedAt <= now ? Math.max(latest, observedAt) : latest;
  }, Number.NEGATIVE_INFINITY);
  if (
    !Number.isFinite(newestQualifiedObservedAt)
    || now - newestQualifiedObservedAt >= NFL_PLAYER_PROPS_REFERENCE_CAPTURE_INTERVAL_MINUTES * 60_000
  ) return true;
  return args.previous.memberDecisions.some((row) => {
    if (row.state !== "unlocked") return false;
    const minutesToStart = (Date.parse(row.scheduledStart) - now) / 60_000;
    return minutesToStart >= 45 && minutesToStart <= 90;
  });
}

function compareNflPlayerPropsCandidateImpact(
  preceding: NflPlayerPropsProductionSnapshot,
  candidate: NflPlayerPropsProductionSnapshot,
): NonNullable<NflPlayerPropsWriterResult["candidateImpact"]> {
  const rowKey = (row: NflPlayerPropsProductionSnapshot["memberDecisions"][number]): string => [
    row.gameId, row.providerPlayerId ?? row.playerName.toLowerCase(), row.market, row.line,
    row.side, row.sportsbook.toLowerCase(),
  ].join("|");
  const precedingRows = new Map(preceding.memberDecisions.map((row) => [rowKey(row), row]));
  const candidateRows = new Map(candidate.memberDecisions.map((row) => [rowKey(row), row]));
  let matchedRows = 0;
  let projectionChanges = 0;
  let forecastSideChanges = 0;
  let promotions = 0;
  let demotions = 0;
  const actionable = (grade: string): boolean => grade === "Best Angle" || grade === "Lean";
  for (const [key, next] of candidateRows) {
    const prior = precedingRows.get(key);
    if (!prior) continue;
    matchedRows += 1;
    if (prior.projection !== next.projection) projectionChanges += 1;
    if (prior.side !== "yes" && prior.projection !== null && next.projection !== null
      && (prior.projection > prior.line) !== (next.projection > next.line)) forecastSideChanges += 1;
    if (!actionable(prior.grade) && actionable(next.grade)) promotions += 1;
    if (actionable(prior.grade) && !actionable(next.grade)) demotions += 1;
  }
  const markets = [...new Set([
    ...preceding.memberDecisions.map((row) => row.market),
    ...candidate.memberDecisions.map((row) => row.market),
  ])].sort();
  const byMarket = Object.fromEntries(markets.map((market) => {
    const prior = preceding.memberDecisions.filter((row) => row.market === market);
    const next = candidate.memberDecisions.filter((row) => row.market === market);
    const priorByKey = new Map(prior.map((row) => [rowKey(row), row]));
    const changes = next.flatMap((row) => {
      const previous = priorByKey.get(rowKey(row));
      return previous ? [[previous, row] as const] : [];
    });
    return [market, {
      matchedRows: changes.length,
      projectionChanges: changes.filter(([first, second]) => first.projection !== second.projection).length,
      forecastSideChanges: changes.filter(([first, second]) => first.side !== "yes"
        && first.projection !== null && second.projection !== null
        && (first.projection > first.line) !== (second.projection > second.line)).length,
      promotions: changes.filter(([first, second]) => !actionable(first.grade) && actionable(second.grade)).length,
      demotions: changes.filter(([first, second]) => actionable(first.grade) && !actionable(second.grade)).length,
      precedingActionables: prior.filter((row) => actionable(row.grade)).length,
      candidateActionables: next.filter((row) => actionable(row.grade)).length,
    }];
  }));
  return {
    matchedRows,
    addedRows: [...candidateRows.keys()].filter((key) => !precedingRows.has(key)).length,
    removedRows: [...precedingRows.keys()].filter((key) => !candidateRows.has(key)).length,
    projectionChanges,
    forecastSideChanges,
    promotions,
    demotions,
    precedingActionables: preceding.memberDecisions.filter((row) => actionable(row.grade)).length,
    candidateActionables: candidate.memberDecisions.filter((row) => actionable(row.grade)).length,
    byMarket,
  };
}
