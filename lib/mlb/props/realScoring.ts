import { DEFAULT_PROP_RECOMMENDATION_CONFIG, type MlbPropMarketKey, type PropReasonCode } from "./config";
import type { MlbPropBacktestResult } from "./backtest";
import { normalizePlayerName } from "./entityResolution";
import { legacyPitcherBaselineProbability, modelForMlbPropMarket } from "./models";
import { recommendPropBet, type PropRecommendation } from "./recommendations";
import { expected_value, remove_vig_two_way } from "./oddsMath";
import type { MlbGameEntity, MlbProbablePitcher, PropOddsSnapshot } from "./providers";
import { resolveMlbStatsTeamId, resolveMlbTeamAlias } from "./mlbTeamAliases";
import type { PropFeatureSnapshot } from "./featureBuilder";
import { allMlbPropMarketDefinitions, getMlbPropMarketDefinition, marketDisplayStatus } from "./marketCatalog";
import type { PropGrade } from "./propGrades";
import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const REAL_SUPPORTED_MARKETS = new Set<MlbPropMarketKey>(allMlbPropMarketDefinitions().map((market) => market.marketKey));

export type RealPropsDryRunReport = {
  safeBlocked: boolean;
  dryRun: true;
  noSupabaseWrites: true;
  publicDisplayEnabled: boolean;
  propsAvailabilityStatus?: "available" | "pending" | "blocked";
  blockerReason?: "PROVIDER_PROP_ODDS_UNAVAILABLE" | "PROPS_NOT_AVAILABLE_YET" | null;
  oddsProvider?: string;
  sharpApiPropRows?: number;
  bdlPropRows?: number;
  oddsProviderFallbackReason?: string | null;
  slateCount: number;
  probablePitchers: number;
  propsCount: number;
  supportedPitcherProps: number;
  mappedPitcherProps: number;
  unmappedPitcherProps: number;
  twoWayPitcherMarkets: number;
  candidatesScored: number;
  recommendationsPassingEvEdge: number;
  paperReviewRecommendationsCount: number;
  candidateCount: number;
  marketsDetected: string[];
  sportsbooksDetected: string[];
  hardRockDetected: boolean;
  hardRockRows: number;
  staleOddsCount: number;
  mappingFailures: number;
  rejectedCountByReasonCode: Record<string, number>;
  featureAvailabilityWarnings: Record<string, number>;
  bdlTracePath?: string | null;
  bdlTraceSummary?: BdlScoringRejectionTrace["summary"] | null;
  bdlSanityAuditPath?: string | null;
  bdlSanityAuditSummary?: BdlRecommendationSanityAudit["summary"] | null;
  recommendationSanityAuditPath?: string | null;
  marketFeatureInventoryPath?: string | null;
  pitcherFeatureInventoryPath?: string | null;
  modelComparisonPath?: string | null;
  firstPaperRunDecisionPath?: string | null;
  calibrationReadinessPath?: string | null;
  providerMarketComparisonPath?: string | null;
  splitsContextAuditPath?: string | null;
  sampleCandidates: RealPropsCandidateSummary[];
};

export type RealPitcherSeasonStat = {
  playerId: string;
  pitchingGs: number | null;
  pitchingGp: number | null;
  pitchingIp: number | null;
  pitchingK: number | null;
  pitchingKPer9: number | null;
  pitchingBb?: number | null;
  pitchingH?: number | null;
  pitchingEr?: number | null;
  battersFaced?: number | null;
  pitchCount?: number | null;
  recentStarts?: number | null;
  recentStrikeouts?: number | null;
  recentOuts?: number | null;
  recentBattersFaced?: number | null;
  recentPitchCount?: number | null;
};

export type RealPitcherModelContext = {
  opponentStrikeoutRate: number | null;
  opponentLeagueStrikeoutRate: number | null;
  opponentOps: number | null;
  opponentLeagueOps: number | null;
  parkStrikeoutFactor: number | null;
  parkRunFactor: number | null;
  temperatureF: number | null;
  windSpeedMph: number | null;
  precipitationProbability: number | null;
  roofStatus: string | null;
  weatherAvailable: boolean;
};

export function realPitcherModelContextKey(gameId: string, playerId: string): string {
  return `${gameId}|${playerId}`;
}

export type RealPropsCandidateSummary = {
  gameId: string;
  gameLabel: string;
  playerId: string;
  playerName: string;
  marketKey: MlbPropMarketKey;
  line: number;
  sportsbook: string;
  side: "over" | "under";
  americanOdds: number | null;
  modelProbability: number;
  finalProbability: number;
  marketProbability: number | null;
  edge: number | null;
  modelEdge: number | null;
  expectedValue: number | null;
  playGrade: PropGrade;
  status: PropRecommendation["status"];
  displayStatus?: string;
  modelFamily?: string;
  reasonCodes: string[];
  mappingConfidence: number;
  featureConfidence?: number;
  starterConfidence?: number;
  starterReasonCode?: string | null;
  featureWarnings: string[];
};

export type RealPropsScoringBundle = {
  summary: RealPropsDryRunReport;
  scored: MlbPropBacktestResult;
  paperScored: MlbPropBacktestResult;
};

type ResolvedPropRow = {
  odds: PropOddsSnapshot;
  game: MlbGameEntity;
  gameLabel: string;
  playerId: string;
  playerName: string;
  teamId: string;
  mappingConfidence: number;
  identityReasonCodes: string[];
  starterConfidence: number;
  starterReasonCode: string;
};

type GroupedTwoWay = {
  key: string;
  marketKey: MlbPropMarketKey;
  game: MlbGameEntity;
  gameLabel: string;
  playerId: string;
  playerName: string;
  teamId: string;
  sportsbook: string;
  line: number;
  over: PropOddsSnapshot;
  under: PropOddsSnapshot;
  mappingConfidence: number;
  identityReasonCodes: string[];
  starterConfidence: number;
  starterReasonCode: string;
};

type BdlScoringCandidateTrace = {
  bdlGameId: string | null;
  bdlPlayerId: string | null;
  playerName: string;
  teamId: string;
  opponentTeamId: string;
  market: MlbPropMarketKey;
  side: "over" | "under";
  line: number;
  vendor: string;
  overOdds: number;
  underOdds: number;
  noVigMarketProbability: number | null;
  modelProbability: number;
  edge: number | null;
  expectedValue: number | null;
  fairDecimalOdds: number;
  fairAmericanOdds: number;
  recommendedUnits: number;
  recommendationStatus: PropRecommendation["status"];
  rejectionReasonCodes: string[];
  reasonCodes: string[];
  sanityFlags: PropReasonCode[];
  mappingConfidence: number;
  featureConfidence: number;
  starterConfidence: number;
  starterReasonCode: string;
  identityReasonCodes: string[];
  dataAvailabilityFlags: Record<string, unknown>;
};

type BdlScoringRejectionTrace = {
  provider: "balldontlie";
  date: string;
  generatedAt: string;
  writesToSupabase: false;
  candidates: BdlScoringCandidateTrace[];
  summary: {
    totalCandidates: number;
    candidatesByMarket: Record<string, number>;
    candidatesByVendor: Record<string, number>;
    rejectedByReasonCode: Record<string, number>;
    rejectedByMarket: Record<string, number>;
    rejectedByBook: Record<string, number>;
    positiveEvBlockedByDataConfidence: number;
    sufficientDataButEvEdgeBelowThreshold: number;
    missingBdlStatFields: number;
    missingStarterStatus: number;
    missingTwoWayPair: number;
    blockedByMappingConfidence: number;
    blockedByFeatureBundleNotPromoted: number;
    recommendations: number;
  };
};

type ReviewRecommendation = BdlScoringCandidateTrace & {
  reviewRank: number;
};

type BdlRecommendationSanityAudit = {
  provider: "balldontlie";
  date: string;
  generatedAt: string;
  writesToSupabase: false;
  rawRecommendations: BdlScoringCandidateTrace[];
  reviewRecommendations: ReviewRecommendation[];
  duplicateGroups: Array<{ key: string; count: number; keptVendor: string; removedVendors: string[] }>;
  conflictGroups: Array<{ key: string; sides: string[]; count: number }>;
  summary: {
    rawRecommendationsCount: number;
    dedupedReviewRecommendationsCount: number;
    removedDuplicatesCount: number;
    conflictBlockedCount: number;
    recommendationsByMarket: Record<string, number>;
    recommendationsBySide: Record<string, number>;
    recommendationsByVendor: Record<string, number>;
    recommendationsByLine: Record<string, number>;
    recommendationsByPlayer: Record<string, number>;
    recommendationsPerGame: Record<string, number>;
    maxRecommendationsPerPlayer: number;
    maxRecommendationsPerGame: number;
    averageEv: number | null;
    medianEv: number | null;
    maxEv: number | null;
    averageEdge: number | null;
    medianEdge: number | null;
    maxEdge: number | null;
    oddsRange: { min: number | null; max: number | null };
    linesRange: { min: number | null; max: number | null };
    duplicatePlayerMarketLineAcrossVendors: number;
    conflictingRecommendationsOnSamePlayerMarketLine: number;
    samePlayerOverUnderConflicts: number;
    samePlayerMultipleLineConflicts: number;
    unusuallyHighEvCount: number;
    negativeNoVigAnomalies: number;
    staleUpdatedAtAnomalies: number;
    missingUpdatedAtAnomalies: number;
    modelProbabilityRange: { min: number | null; median: number | null; max: number | null };
    noVigMarketProbabilityRange: { min: number | null; median: number | null; max: number | null };
    edgeRange: { min: number | null; median: number | null; max: number | null };
    evRange: { min: number | null; median: number | null; max: number | null };
    probabilityByMarket: Record<string, { min: number | null; median: number | null; max: number | null }>;
    modelProbabilityBelow050Recommendations: number;
    impossibleProbabilityCount: number;
    extremeModelProbabilityOver075: number;
    oddsParsingOutlierRecommendations: number;
    clusteredProbabilityValues: Record<string, number>;
    capScenarioCounts: {
      max25: number;
      max1PerPlayerMarket: number;
      max2PerGame: number;
      max1PerPlayer: number;
      minEv5Edge35: number;
      minEv75: number;
      minEdge5: number;
      combinedConservative: number;
    };
    sanityFlags: Record<string, number>;
  };
};

type ModelComparisonCandidate = {
  gameId: string;
  playerId: string;
  playerName: string;
  market: MlbPropMarketKey;
  side: "over" | "under";
  line: number;
  vendor: string;
  oldBaselineProbability: number;
  newDistributionProbability: number;
  probabilityDifference: number;
  marketNoVigProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  selectedRecommendation: PropRecommendation["status"];
  disagreementReason: string;
  featureConfidence: number;
  confidenceBucket: string;
};

export async function scoreRealMlbPropsDryRun(args: {
  games: MlbGameEntity[];
  probablePitchers: MlbProbablePitcher[];
  odds: PropOddsSnapshot[];
  date: string;
  asOfTimestamp: string;
  seasonStatsByPlayerId?: Map<string, RealPitcherSeasonStat>;
  modelContextByGameAndPlayer?: Map<string, RealPitcherModelContext>;
  providerContext?: RealPropsProviderContext;
}): Promise<RealPropsDryRunReport> {
  return (await scoreRealMlbPropsForPaper(args)).summary;
}

export async function scoreRealMlbPropsForPaper(args: {
  games: MlbGameEntity[];
  probablePitchers: MlbProbablePitcher[];
  odds: PropOddsSnapshot[];
  date: string;
  asOfTimestamp: string;
  seasonStatsByPlayerId?: Map<string, RealPitcherSeasonStat>;
  modelContextByGameAndPlayer?: Map<string, RealPitcherModelContext>;
  providerContext?: RealPropsProviderContext;
}): Promise<RealPropsScoringBundle> {
  const rejected: Record<string, number> = {};
  const featureWarnings: Record<string, number> = {};
  const markets = [...new Set(args.odds.map((row) => row.marketKey))].sort();
  const books = [...new Set(args.odds.map((row) => row.sportsbook))].sort();
  const supportedOdds = args.odds.filter((row) => REAL_SUPPORTED_MARKETS.has(row.marketKey));
  const now = Date.parse(args.asOfTimestamp);
  const staleOddsCount = args.odds.filter((row) => {
    const ts = Date.parse(row.asOfTimestamp);
    return Number.isFinite(ts) && Number.isFinite(now) && now - ts > 60 * 60 * 1000;
  }).length;

  if (args.games.length > 0 && args.odds.length === 0) {
    inc(rejected, "PROVIDER_PROP_ODDS_UNAVAILABLE");
    const emptyScored = emptyRealScored(args.date);
    const emptyGroups: GroupedTwoWay[] = [];
    const featureInventory = await writePitcherFeatureInventory(buildPitcherFeatureInventory({
      date: args.date,
      generatedAt: args.asOfTimestamp,
      games: args.games,
      probablePitchers: args.probablePitchers,
      groups: emptyGroups,
      seasonStatsByPlayerId: args.seasonStatsByPlayerId,
    }));
    const marketFeatureInventory = await writeMarketFeatureInventoryReport(buildMarketFeatureInventoryReport({
      date: args.date,
      generatedAt: args.asOfTimestamp,
      odds: args.odds,
      groups: emptyGroups,
      candidates: [],
      rejected,
    }));
    const modelComparison = await writeModelComparisonReport(buildModelComparisonReport({ date: args.date, generatedAt: args.asOfTimestamp, candidates: [] }));
    const firstPaperDecision = await writeFirstPaperRunDecisionReport(buildFirstPaperRunDecisionReport({
      date: args.date,
      summary: { candidatesScored: 0, recommendationsPassingEvEdge: 0, rejected, staleOddsCount, publicDisplayEnabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true", publicApiEnabled: process.env.ODDSPHERE_PROPS_PUBLIC_API_ENABLED === "true", realPublishEnabled: process.env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true" },
      scored: emptyScored,
      paperScored: emptyScored,
      bdlAudit: null,
      comparisons: [],
    }));
    const calibrationReadiness = await writeCalibrationReadinessReport(buildCalibrationReadinessReport({ date: args.date, generatedAt: args.asOfTimestamp, candidates: [], recommendations: [] }));
    const providerMarketComparison = await writeProviderMarketComparisonReport(buildProviderMarketComparisonReport({ date: args.date, generatedAt: args.asOfTimestamp, odds: args.odds, providerContext: args.providerContext }));
    const splitsContextAudit = await writePropsSplitsContextAuditReport(buildPropsSplitsContextAuditReport({ date: args.date, generatedAt: args.asOfTimestamp, odds: args.odds, games: args.games, probablePitchers: args.probablePitchers, seasonStatsByPlayerId: args.seasonStatsByPlayerId }));
    const recommendationSanityAudit = await writeRecommendationSanityAuditReport(buildRecommendationSanityAuditReport({ date: args.date, generatedAt: args.asOfTimestamp, candidates: [], rejected, staleOddsCount }));
    return {
      scored: emptyScored,
      paperScored: emptyScored,
      summary: {
        safeBlocked: true,
        dryRun: true,
        noSupabaseWrites: true,
        publicDisplayEnabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
        propsAvailabilityStatus: "pending",
        blockerReason: "PROVIDER_PROP_ODDS_UNAVAILABLE",
        oddsProvider: args.providerContext?.selectedOddsProvider ?? inferredOddsProvider(args.odds),
        sharpApiPropRows: args.providerContext?.sharpApiPropRows,
        bdlPropRows: args.providerContext?.bdlPropRows,
        oddsProviderFallbackReason: args.providerContext?.fallbackReason ?? null,
        slateCount: args.games.length,
        probablePitchers: args.probablePitchers.length,
        propsCount: args.odds.length,
        supportedPitcherProps: 0,
        mappedPitcherProps: 0,
        unmappedPitcherProps: 0,
        twoWayPitcherMarkets: 0,
        candidatesScored: 0,
        recommendationsPassingEvEdge: 0,
        paperReviewRecommendationsCount: 0,
        candidateCount: 0,
        marketsDetected: markets,
        sportsbooksDetected: books,
        hardRockDetected: false,
        hardRockRows: 0,
        staleOddsCount,
        mappingFailures: 0,
        rejectedCountByReasonCode: rejected,
        featureAvailabilityWarnings: featureWarnings,
        bdlTracePath: null,
        bdlTraceSummary: null,
        bdlSanityAuditPath: null,
        bdlSanityAuditSummary: null,
        recommendationSanityAuditPath: recommendationSanityAudit.outputPath,
        marketFeatureInventoryPath: marketFeatureInventory.outputPath,
        pitcherFeatureInventoryPath: featureInventory.outputPath,
        modelComparisonPath: modelComparison.outputPath,
        firstPaperRunDecisionPath: firstPaperDecision.outputPath,
        calibrationReadinessPath: calibrationReadiness.outputPath,
        providerMarketComparisonPath: providerMarketComparison.outputPath,
        splitsContextAuditPath: splitsContextAudit.outputPath,
        sampleCandidates: [],
      },
    };
  }

  const resolved: ResolvedPropRow[] = [];
  for (const row of supportedOdds) {
    const mapped = resolveSharpPropRow({ row, games: args.games, probablePitchers: args.probablePitchers });
    if (mapped.status === "blocked") {
      inc(rejected, mapped.reason);
      continue;
    }
    resolved.push(mapped.row);
  }

  const groups = groupTwoWayPitcherMarkets(resolved, rejected);
  const sampleCandidates: RealPropsCandidateSummary[] = [];
  const bdlCandidateTrace: BdlScoringCandidateTrace[] = [];
  const modelComparisonCandidates: ModelComparisonCandidate[] = [];
  const recommendations: MlbPropBacktestResult["recommendations"] = [];
  let candidatesScored = 0;
  let recommendationsPassingEvEdge = 0;

  for (const group of groups) {
    const model = modelForMarket(group.marketKey);
    const definition = getMlbPropMarketDefinition(group.marketKey);
    if (!model) {
      inc(rejected, "MARKET_NOT_PROMOTED");
      continue;
    }
    const feature = buildConservativePitcherFeature({
      group,
      asOfTimestamp: args.asOfTimestamp,
      seasonStat: args.seasonStatsByPlayerId?.get(group.playerId) ?? null,
      modelContext: args.modelContextByGameAndPlayer?.get(realPitcherModelContextKey(group.game.id, group.playerId)) ?? null,
    });
    const warnings = featureWarningCodes(feature, group);
    for (const warning of warnings) inc(featureWarnings, warning);
    const [prediction] = await model.predict_proba([feature]);
    candidatesScored++;
    const featureConfidence = featureConfidenceScore(feature, group);
    const diagnostic = diagnosticMarketMath({ prediction, over: group.over, under: group.under });
    const sanityFlags = bdlOddsSanityFlags({ group, prediction, diagnostic, asOfTimestamp: args.asOfTimestamp });
    const marketNoPlayCodes = marketForceNoPlayCodes({ marketKey: group.marketKey, featureConfidence, hasTwoWayPair: true });
    const recommendation = recommendPropBet({
      prediction,
      overOdds: group.over,
      underOdds: group.under,
      asOfTimestamp: args.asOfTimestamp,
      mappingConfidence: group.mappingConfidence,
      dataQualityBlocked:
        (definition.family === "pitcher" && group.starterConfidence < 0.98) ||
        featureConfidence < 0.75 ||
        warnings.includes("weak_pitcher_baseline") ||
        warnings.includes("bdl_stat_bundle_pending_baseline_used"),
      dataConfidence: featureConfidence,
      modelVersionActive: true,
      forceNoPlayReasonCodes: [...sanityFlags, ...marketNoPlayCodes],
      config: {
        ...DEFAULT_PROP_RECOMMENDATION_CONFIG,
        maxOddsAgeSeconds: 10_000,
      },
    });
    if (recommendation.status === "recommended") recommendationsPassingEvEdge++;
    if (recommendation.status !== "recommended") {
      for (const code of recommendation.reasonCodes) inc(rejected, code);
      if (group.starterConfidence < 0.98) inc(rejected, group.starterReasonCode);
      for (const code of group.identityReasonCodes) inc(rejected, code);
    }
    const baseline = legacyPitcherBaselineProbability(feature);
    modelComparisonCandidates.push({
      gameId: group.game.id,
      playerId: group.playerId,
      playerName: group.playerName,
      market: group.marketKey,
      side: recommendation.side,
      line: group.line,
      vendor: group.sportsbook,
      oldBaselineProbability: round(baseline.probability),
      newDistributionProbability: round(prediction.modelProbability),
      probabilityDifference: round(prediction.modelProbability - baseline.probability),
      marketNoVigProbability: diagnostic.marketProbability === null ? null : round(diagnostic.marketProbability),
      edge: diagnostic.edge === null ? null : round(diagnostic.edge),
      expectedValue: diagnostic.expectedValue === null ? null : round(diagnostic.expectedValue),
      selectedRecommendation: recommendation.status,
      disagreementReason: modelDisagreementReason({ baselineSide: baseline.side, newSide: prediction.side, diff: prediction.modelProbability - baseline.probability, warnings }),
      featureConfidence,
      confidenceBucket: confidenceBucket(featureConfidence),
    });
    if (group.over.provider === "balldontlie" || group.under.provider === "balldontlie") {
      bdlCandidateTrace.push({
        bdlGameId: stringValue(rawObj(group.over.rawPayload).bdl_game_id) ?? stringValue(rawObj(group.under.rawPayload).bdl_game_id),
        bdlPlayerId: stringValue(rawObj(group.over.rawPayload).bdl_player_id) ?? stringValue(rawObj(group.under.rawPayload).bdl_player_id),
        playerName: group.playerName,
        teamId: group.teamId,
        opponentTeamId: group.game.homeTeamId === group.teamId ? group.game.awayTeamId : group.game.homeTeamId,
        market: group.marketKey,
        side: recommendation.side,
        line: group.line,
        vendor: group.sportsbook,
        overOdds: group.over.americanOdds,
        underOdds: group.under.americanOdds,
        noVigMarketProbability: diagnostic.marketProbability === null ? null : round(diagnostic.marketProbability),
        modelProbability: round(prediction.modelProbability),
        edge: diagnostic.edge === null ? null : round(diagnostic.edge),
        expectedValue: diagnostic.expectedValue === null ? null : round(diagnostic.expectedValue),
        fairDecimalOdds: round(recommendation.fairDecimalOdds),
        fairAmericanOdds: recommendation.fairAmericanOdds,
        recommendedUnits: round(recommendation.recommendedUnits),
        recommendationStatus: recommendation.status,
        rejectionReasonCodes: recommendation.status === "recommended" ? [] : sortedUniqueStrings([
          ...recommendation.reasonCodes,
          ...(group.starterConfidence < 0.98 ? [group.starterReasonCode] : []),
          ...warnings,
          ...sanityFlags,
        ]),
        reasonCodes: recommendation.reasonCodes,
        sanityFlags,
        mappingConfidence: group.mappingConfidence,
        featureConfidence,
        starterConfidence: group.starterConfidence,
        starterReasonCode: group.starterReasonCode,
        identityReasonCodes: group.identityReasonCodes,
        dataAvailabilityFlags: feature.dataAvailability,
      });
    }
    recommendations.push({
      gameId: group.game.id,
      playerId: group.playerId,
      marketKey: group.marketKey,
      recommendation,
      result: recommendation.status === "recommended" ? "pending" : "no_play",
      closingAmericanOdds: null,
      clv: null,
    });
    sampleCandidates.push({
      gameId: group.game.id,
      gameLabel: group.gameLabel,
      playerId: group.playerId,
      playerName: group.playerName,
      marketKey: group.marketKey,
      line: group.line,
      sportsbook: group.sportsbook,
      side: recommendation.side,
      americanOdds: recommendation.americanOdds,
      modelProbability: round(recommendation.modelProbability),
      finalProbability: round(recommendation.finalProbability),
      marketProbability: recommendation.noVigMarketProbability === null ? null : round(recommendation.noVigMarketProbability),
      edge: recommendation.edge === null ? null : round(recommendation.edge),
      modelEdge: recommendation.modelEdge === null ? null : round(recommendation.modelEdge),
      expectedValue: recommendation.expectedValue === null ? null : round(recommendation.expectedValue),
      playGrade: recommendation.playGrade,
      status: recommendation.status,
      reasonCodes: recommendation.reasonCodes,
      mappingConfidence: group.mappingConfidence,
      featureConfidence,
      starterConfidence: group.starterConfidence,
      starterReasonCode: group.starterReasonCode,
      featureWarnings: warnings,
      displayStatus: marketDisplayStatus(group.marketKey, featureConfidence, true),
      modelFamily: definition.modelFamily,
    });
  }

  const uniqueMappedRows = new Set(resolved.map((row) => `${row.game.id}|${row.playerId}|${row.odds.marketKey}|${row.odds.sportsbook}|${row.odds.line}|${row.odds.side}`));
  const betRows = recommendations.filter((row) => row.recommendation.status === "recommended");
  const scored: MlbPropBacktestResult = {
    name: `real_paper_${args.date}`,
    marketKeys: allMlbPropMarketDefinitions().map((market) => market.marketKey),
    bets: betRows.length,
    wins: 0,
    losses: 0,
    pushes: 0,
    unitsWon: 0,
    roi: 0,
    avgEv: average(betRows.map((row) => row.recommendation.expectedValue ?? 0)),
    avgEdge: average(betRows.map((row) => row.recommendation.edge ?? 0)),
    recommendations,
  };
  const paperScored = buildFirstPaperRunScoredSet(scored);
  const bdlTrace = bdlCandidateTrace.length > 0
    ? await writeBdlScoringRejectionTrace({
      provider: "balldontlie",
      date: args.date,
      generatedAt: args.asOfTimestamp,
      writesToSupabase: false,
      candidates: bdlCandidateTrace,
      summary: buildBdlTraceSummary({
        candidates: bdlCandidateTrace,
        rejected,
      }),
    })
    : null;
  const bdlSanityAudit = bdlCandidateTrace.length > 0
    ? await writeBdlRecommendationSanityAudit(buildBdlRecommendationSanityAudit({
      date: args.date,
      generatedAt: args.asOfTimestamp,
      candidates: bdlCandidateTrace,
    }))
    : null;
  const featureInventory = await writePitcherFeatureInventory(buildPitcherFeatureInventory({
    date: args.date,
    generatedAt: args.asOfTimestamp,
    games: args.games,
    probablePitchers: args.probablePitchers,
    groups,
    seasonStatsByPlayerId: args.seasonStatsByPlayerId,
  }));
  const modelComparison = await writeModelComparisonReport(buildModelComparisonReport({
    date: args.date,
    generatedAt: args.asOfTimestamp,
    candidates: modelComparisonCandidates,
  }));
  const firstPaperDecision = await writeFirstPaperRunDecisionReport(buildFirstPaperRunDecisionReport({
    date: args.date,
    summary: {
      candidatesScored,
      recommendationsPassingEvEdge,
      rejected,
      staleOddsCount,
      publicDisplayEnabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
      publicApiEnabled: process.env.ODDSPHERE_PROPS_PUBLIC_API_ENABLED === "true",
      realPublishEnabled: process.env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true",
    },
    scored,
    paperScored,
    bdlAudit: bdlSanityAudit?.audit ?? null,
    comparisons: modelComparisonCandidates,
  }));
  const marketFeatureInventory = await writeMarketFeatureInventoryReport(buildMarketFeatureInventoryReport({
    date: args.date,
    generatedAt: args.asOfTimestamp,
    odds: args.odds,
    groups,
    candidates: sampleCandidates,
    rejected,
  }));
  const calibrationReadiness = await writeCalibrationReadinessReport(buildCalibrationReadinessReport({
    date: args.date,
    generatedAt: args.asOfTimestamp,
    candidates: modelComparisonCandidates,
    recommendations,
  }));
  const providerMarketComparison = await writeProviderMarketComparisonReport(buildProviderMarketComparisonReport({
    date: args.date,
    generatedAt: args.asOfTimestamp,
    odds: args.odds,
    providerContext: args.providerContext,
  }));
  const splitsContextAudit = await writePropsSplitsContextAuditReport(buildPropsSplitsContextAuditReport({
    date: args.date,
    generatedAt: args.asOfTimestamp,
    odds: args.odds,
    games: args.games,
    probablePitchers: args.probablePitchers,
    seasonStatsByPlayerId: args.seasonStatsByPlayerId,
  }));
  const recommendationSanityAudit = await writeRecommendationSanityAuditReport(buildRecommendationSanityAuditReport({
    date: args.date,
    generatedAt: args.asOfTimestamp,
    candidates: sampleCandidates,
    rejected,
    staleOddsCount,
  }));

  return {
    scored,
    paperScored,
    summary: {
    safeBlocked: false,
    dryRun: true,
    noSupabaseWrites: true,
    publicDisplayEnabled: process.env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true",
    propsAvailabilityStatus: args.odds.length > 0 ? "available" : "pending",
    blockerReason: args.odds.length > 0 ? null : "PROPS_NOT_AVAILABLE_YET",
    oddsProvider: args.providerContext?.selectedOddsProvider ?? inferredOddsProvider(args.odds),
    sharpApiPropRows: args.providerContext?.sharpApiPropRows,
    bdlPropRows: args.providerContext?.bdlPropRows,
    oddsProviderFallbackReason: args.providerContext?.fallbackReason ?? null,
    slateCount: args.games.length,
    probablePitchers: args.probablePitchers.length,
    propsCount: args.odds.length,
    supportedPitcherProps: supportedOdds.length,
    mappedPitcherProps: uniqueMappedRows.size,
    unmappedPitcherProps: Math.max(0, supportedOdds.length - uniqueMappedRows.size),
    twoWayPitcherMarkets: groups.length,
    candidatesScored,
    recommendationsPassingEvEdge,
    paperReviewRecommendationsCount: paperScored.bets,
    candidateCount: sampleCandidates.length,
    marketsDetected: markets,
    sportsbooksDetected: books,
    hardRockDetected: books.includes("hardrock"),
    hardRockRows: args.odds.filter((row) => row.sportsbook === "hardrock").length,
    staleOddsCount,
    mappingFailures: supportedOdds.length - uniqueMappedRows.size,
    rejectedCountByReasonCode: rejected,
    featureAvailabilityWarnings: featureWarnings,
    bdlTracePath: bdlTrace?.outputPath ?? null,
    bdlTraceSummary: bdlTrace?.trace.summary ?? null,
    bdlSanityAuditPath: bdlSanityAudit?.outputPath ?? null,
    bdlSanityAuditSummary: bdlSanityAudit?.audit.summary ?? null,
    recommendationSanityAuditPath: recommendationSanityAudit.outputPath,
    marketFeatureInventoryPath: marketFeatureInventory.outputPath,
    pitcherFeatureInventoryPath: featureInventory.outputPath,
    modelComparisonPath: modelComparison.outputPath,
    firstPaperRunDecisionPath: firstPaperDecision.outputPath,
    calibrationReadinessPath: calibrationReadiness.outputPath,
    providerMarketComparisonPath: providerMarketComparison.outputPath,
    splitsContextAuditPath: splitsContextAudit.outputPath,
    sampleCandidates,
    },
  };
}

export type RealPropsProviderContext = {
  selectedOddsProvider: string;
  sharpApiPropRows: number;
  bdlPropRows: number;
  fallbackReason: string | null;
};

export function resolveSharpPropRow(args: {
  row: PropOddsSnapshot;
  games: MlbGameEntity[];
  probablePitchers: MlbProbablePitcher[];
}): { status: "matched"; row: ResolvedPropRow } | { status: "blocked"; reason: string } {
  const raw = rawObj(args.row.rawPayload);
  const game = mapSharpEventToGame({ row: args.row, games: args.games });
  if (game.status === "blocked") return { status: "blocked", reason: game.reason };
  const playerName = stringValue(raw.player_name);
  if (args.row.provider === "balldontlie" || stringValue(raw.bdl_player_id)) {
    const bdlGameId = stringValue(raw.bdl_game_id);
    if (!bdlGameId) return { status: "blocked", reason: "BDL_GAME_ID_MISSING" };
    const bdlPlayerId = stringValue(raw.bdl_player_id) ?? args.row.playerId.replace(/^balldontlie-player-/, "");
    if (!bdlPlayerId) return { status: "blocked", reason: "BDL_PLAYER_ID_MISSING" };
    const isPitcher = isPitcherMarket(args.row.marketKey);
    const starter = isPitcher
      ? resolveBdlStarterContext({
        raw,
        bdlPlayerId,
        playerName,
        game: game.game,
        probablePitchers: args.probablePitchers,
      })
      : { status: "matched" as const, confidence: 0.9, reason: "BATTER_PROVIDER_ID_CONFIRMED", teamId: inferBdlTeamId(game.game, raw) };
    if (starter.status === "blocked") return { status: "blocked", reason: starter.reason };
    const byName = isPitcher && playerName
      ? mapPitcherToProbable({
        playerName,
        marketKey: args.row.marketKey,
        game: game.game,
        probablePitchers: args.probablePitchers,
      })
      : null;
    if (byName?.status === "matched") {
      return {
        status: "matched",
        row: {
          odds: { ...args.row, gameId: game.game.id, playerId: byName.pitcher.playerId },
          game: game.game,
          gameLabel: game.gameLabel,
          playerId: byName.pitcher.playerId,
          playerName: playerName ?? args.row.playerId,
          teamId: byName.pitcher.teamId,
          mappingConfidence: byName.confidence,
          identityReasonCodes: ["BDL_PROVIDER_ID_CONFIRMED", "BDL_GAME_ID_CONFIRMED", "STARTER_CONFIRMED_MLB_STATS"],
          starterConfidence: 0.995,
          starterReasonCode: "STARTER_CONFIRMED_MLB_STATS",
        },
      };
    }
    return {
      status: "matched",
      row: {
        odds: { ...args.row, gameId: game.game.id, playerId: `balldontlie-player-${bdlPlayerId}` },
        game: game.game,
        gameLabel: game.gameLabel,
        playerId: `balldontlie-player-${bdlPlayerId}`,
        playerName: playerName ?? `BDL player ${bdlPlayerId}`,
        teamId: starter.teamId ?? inferBdlTeamId(game.game, raw),
        mappingConfidence: 0.985,
        identityReasonCodes: ["BDL_PROVIDER_ID_CONFIRMED", "BDL_GAME_ID_CONFIRMED"],
        starterConfidence: starter.confidence,
        starterReasonCode: starter.reason,
      },
    };
  }
  if (!playerName) return { status: "blocked", reason: "PLAYER_NAME_MISSING" };
  const probable = mapPitcherToProbable({
    playerName,
    marketKey: args.row.marketKey,
    game: game.game,
    probablePitchers: args.probablePitchers,
  });
  if (probable.status === "blocked") return { status: "blocked", reason: probable.reason };
  return {
    status: "matched",
    row: {
      odds: { ...args.row, gameId: game.game.id, playerId: probable.pitcher.playerId },
      game: game.game,
      gameLabel: game.gameLabel,
      playerId: probable.pitcher.playerId,
      playerName,
      teamId: probable.pitcher.teamId,
      mappingConfidence: probable.confidence,
      identityReasonCodes: ["STARTER_CONFIRMED_MLB_STATS"],
      starterConfidence: 0.995,
      starterReasonCode: "STARTER_CONFIRMED_MLB_STATS",
    },
  };
}

function resolveBdlStarterContext(args: {
  raw: Record<string, unknown>;
  bdlPlayerId: string;
  playerName: string | null;
  game: MlbGameEntity;
  probablePitchers: MlbProbablePitcher[];
}): { status: "matched"; confidence: number; reason: string; teamId: string | null } | { status: "blocked"; reason: string } {
  const homePitcherId = stringValue(args.raw.bdl_home_pitcher_id);
  const awayPitcherId = stringValue(args.raw.bdl_away_pitcher_id);
  if (homePitcherId && awayPitcherId && homePitcherId === args.bdlPlayerId && awayPitcherId === args.bdlPlayerId) {
    return { status: "blocked", reason: "STARTER_CONFLICT" };
  }
  if (homePitcherId === args.bdlPlayerId) {
    return { status: "matched", confidence: 0.995, reason: "STARTER_CONFIRMED_BDL", teamId: args.game.homeTeamId };
  }
  if (awayPitcherId === args.bdlPlayerId) {
    return { status: "matched", confidence: 0.995, reason: "STARTER_CONFIRMED_BDL", teamId: args.game.awayTeamId };
  }
  if (homePitcherId || awayPitcherId) {
    return { status: "matched", confidence: 0.72, reason: "STARTER_NOT_CONFIRMED", teamId: inferBdlTeamId(args.game, args.raw) };
  }
  if (args.playerName) {
    const probable = mapPitcherToProbable({
      playerName: args.playerName,
      marketKey: "pitcher_strikeouts",
      game: args.game,
      probablePitchers: args.probablePitchers,
    });
    if (probable.status === "matched") {
      return { status: "matched", confidence: 0.995, reason: "STARTER_CONFIRMED_MLB_STATS", teamId: probable.pitcher.teamId };
    }
  }
  return { status: "matched", confidence: 0.72, reason: "STARTER_NOT_CONFIRMED", teamId: inferBdlTeamId(args.game, args.raw) };
}

function inferBdlTeamId(game: MlbGameEntity, raw: Record<string, unknown>): string {
  const side = stringValue(raw.player_team_side)?.toLowerCase();
  if (side === "home") return game.homeTeamId;
  if (side === "away") return game.awayTeamId;
  return game.awayTeamId || game.homeTeamId;
}

export function mapSharpEventToGame(args: {
  row: PropOddsSnapshot;
  games: MlbGameEntity[];
}): { status: "matched"; game: MlbGameEntity; gameLabel: string } | { status: "blocked"; reason: string } {
  const raw = rawObj(args.row.rawPayload);
  const eventHome = resolveMlbTeamAlias(stringValue(raw.event_home_team));
  const eventAway = resolveMlbTeamAlias(stringValue(raw.event_away_team));
  if (!eventHome || !eventAway) return { status: "blocked", reason: "EVENT_TEAM_CONTEXT_MISSING" };
  const eventStart = stringValue(raw.event_start_time);
  const candidates = args.games.filter((game) => {
    const home = resolveMlbStatsTeamId(game.homeTeamId);
    const away = resolveMlbStatsTeamId(game.awayTeamId);
    if (!home || !away) return false;
    if (home.id !== eventHome.id || away.id !== eventAway.id) return false;
    if (!eventStart) return true;
    const diffMinutes = Math.abs(Date.parse(game.scheduledStart) - Date.parse(eventStart)) / 60_000;
    return Number.isFinite(diffMinutes) && diffMinutes <= 90;
  });
  if (candidates.length === 1) {
    const away = resolveMlbStatsTeamId(candidates[0].awayTeamId)?.abbreviation ?? "AWAY";
    const home = resolveMlbStatsTeamId(candidates[0].homeTeamId)?.abbreviation ?? "HOME";
    return { status: "matched", game: candidates[0], gameLabel: `${away} @ ${home}` };
  }
  if (candidates.length > 1) return { status: "blocked", reason: "GAME_MAPPING_AMBIGUOUS" };

  const reversed = args.games.some((game) => {
    const home = resolveMlbStatsTeamId(game.homeTeamId);
    const away = resolveMlbStatsTeamId(game.awayTeamId);
    return home?.id === eventAway.id && away?.id === eventHome.id;
  });
  if (reversed && raw.event_neutral_site !== true) return { status: "blocked", reason: "GAME_HOME_AWAY_REVERSED" };
  return { status: "blocked", reason: "GAME_MAPPING_NOT_FOUND" };
}

function mapPitcherToProbable(args: {
  playerName: string;
  marketKey: MlbPropMarketKey;
  game: MlbGameEntity;
  probablePitchers: MlbProbablePitcher[];
}): { status: "matched"; pitcher: { playerId: string; teamId: string }; confidence: number } | { status: "blocked"; reason: string } {
  if (!isPitcherMarket(args.marketKey)) return { status: "blocked", reason: "BATTER_PROVIDER_ID_CONFIRMED" };
  const normalized = normalizePlayerName(args.playerName);
  const gameProbables = args.probablePitchers.filter((row) => row.gameId === args.game.id && row.playerId !== null);
  const matches = gameProbables.filter((row) => normalizePlayerName(probablePitcherName(row)) === normalized);
  if (matches.length === 1 && matches[0].playerId) {
    return { status: "matched", pitcher: { playerId: matches[0].playerId, teamId: matches[0].teamId }, confidence: 0.995 };
  }
  if (matches.length > 1) return { status: "blocked", reason: "PLAYER_MAPPING_AMBIGUOUS" };
  if (gameProbables.length === 0) return { status: "blocked", reason: "PROBABLE_STARTERS_MISSING" };
  return { status: "blocked", reason: "PLAYER_NOT_PROBABLE_STARTER" };
}

function isPitcherMarket(marketKey: MlbPropMarketKey): boolean {
  return getMlbPropMarketDefinition(marketKey).family === "pitcher";
}

export function groupTwoWayPitcherMarkets(rows: ResolvedPropRow[], rejected: Record<string, number> = {}): GroupedTwoWay[] {
  const buckets = new Map<string, { over: ResolvedPropRow[]; under: ResolvedPropRow[]; sample: ResolvedPropRow }>();
  for (const row of rows) {
    const isAlt = rawObj(row.odds.rawPayload).is_alternate_line === true;
    if (isAlt) {
      inc(rejected, "ALTERNATE_LINE_SEPARATED");
    }
    const key = [
      row.game.id,
      row.playerId,
      row.odds.marketKey,
      row.odds.line,
      row.odds.sportsbook,
      isAlt ? "alt" : "main",
    ].join("|");
    const bucket = buckets.get(key) ?? { over: [], under: [], sample: row };
    bucket[row.odds.side].push(row);
    buckets.set(key, bucket);
  }
  const out: GroupedTwoWay[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.over.length === 0 || bucket.under.length === 0) {
      inc(rejected, "TWO_WAY_PAIR_MISSING");
      continue;
    }
    const over = latest(bucket.over);
    const under = latest(bucket.under);
    out.push({
      key,
      marketKey: bucket.sample.odds.marketKey,
      game: bucket.sample.game,
      gameLabel: bucket.sample.gameLabel,
      playerId: bucket.sample.playerId,
      playerName: bucket.sample.playerName,
      teamId: bucket.sample.teamId,
      sportsbook: bucket.sample.odds.sportsbook,
      line: bucket.sample.odds.line,
      over: over.odds,
      under: under.odds,
      mappingConfidence: Math.min(over.mappingConfidence, under.mappingConfidence),
      identityReasonCodes: sortedUniqueStrings([...over.identityReasonCodes, ...under.identityReasonCodes]),
      starterConfidence: Math.min(over.starterConfidence, under.starterConfidence),
      starterReasonCode: over.starterConfidence <= under.starterConfidence ? over.starterReasonCode : under.starterReasonCode,
    });
  }
  return out;
}

function buildConservativePitcherFeature(args: {
  group: GroupedTwoWay;
  asOfTimestamp: string;
  seasonStat: RealPitcherSeasonStat | null;
  modelContext: RealPitcherModelContext | null;
}): PropFeatureSnapshot {
  const isHome = args.group.game.homeTeamId === args.group.teamId;
  const starterConfirmed = args.group.starterConfidence >= 0.98;
  const definition = getMlbPropMarketDefinition(args.group.marketKey);
  const isPitcher = definition.family === "pitcher";
  const starts = positive(args.seasonStat?.pitchingGs) ?? positive(args.seasonStat?.pitchingGp);
  const gamesPitched = positive(args.seasonStat?.pitchingGp);
  const innings = positive(args.seasonStat?.pitchingIp);
  const strikeouts = positive(args.seasonStat?.pitchingK);
  const kPer9 = positive(args.seasonStat?.pitchingKPer9);
  const walks = positive(args.seasonStat?.pitchingBb);
  const hitsAllowed = positive(args.seasonStat?.pitchingH);
  const earnedRuns = positive(args.seasonStat?.pitchingEr);
  const battersFaced = positive(args.seasonStat?.battersFaced);
  const pitchCount = positive(args.seasonStat?.pitchCount);
  const recentStarts = positive(args.seasonStat?.recentStarts);
  const recentStrikeouts = positive(args.seasonStat?.recentStrikeouts);
  const recentOuts = positive(args.seasonStat?.recentOuts);
  const recentBattersFaced = positive(args.seasonStat?.recentBattersFaced);
  const recentPitchCount = positive(args.seasonStat?.recentPitchCount);
  const hasSeasonPitching = isPitcher && starts !== null && innings !== null && strikeouts !== null;
  const outsPerStart = hasSeasonPitching ? (innings * 3) / starts : 15.6;
  const kPerStart = hasSeasonPitching ? strikeouts / starts : 4.8;
  const recentKPerStart = recentStarts && recentStrikeouts !== null ? recentStrikeouts / recentStarts : null;
  const recentOutsPerStart = recentStarts && recentOuts !== null ? recentOuts / recentStarts : null;
  const recentBattersFacedPerStart = recentStarts && recentBattersFaced !== null ? recentBattersFaced / recentStarts : null;
  const recentPitchCountPerStart = recentStarts && recentPitchCount !== null ? recentPitchCount / recentStarts : null;
  const recentStrikeoutRate = recentBattersFaced && recentStrikeouts !== null
    ? recentStrikeouts / recentBattersFaced
    : null;
  const battersFacedProxy = battersFaced && starts ? battersFaced / starts : Math.max(12, outsPerStart * 1.42);
  const hitsAllowedPerStart = hitsAllowed && starts ? hitsAllowed / starts : 5;
  const walksPerStart = walks && starts ? walks / starts : 1.8;
  const earnedRunsPerStart = earnedRuns && starts ? earnedRuns / starts : 2.6;
  const kRate = hasSeasonPitching
    ? Math.max(0.08, Math.min(0.42, strikeouts / Math.max(1, battersFaced ?? innings * 4.25)))
    : 0.218;
  const confidence = featureConfidenceScoreFromParts({
    hasSeasonPitching,
    starterConfidence: args.group.starterConfidence,
    starts,
    innings,
    updatedAtPresent: Boolean(stringValue(rawObj(args.group.over.rawPayload).updated_at) && stringValue(rawObj(args.group.under.rawPayload).updated_at)),
  });
  const features: PropFeatureSnapshot["features"] = {
    game_date: args.group.game.gameDate,
    scheduled_start_hour_utc: new Date(args.group.game.scheduledStart).getUTCHours(),
    home_away: isHome ? "home" : "away",
    park: args.group.game.venue ?? null,
    roof_status: args.group.game.roofStatus ?? null,
    opponent_strikeout_rate: args.modelContext?.opponentStrikeoutRate ?? null,
    opponent_league_strikeout_rate: args.modelContext?.opponentLeagueStrikeoutRate ?? null,
    opponent_ops: args.modelContext?.opponentOps ?? null,
    opponent_league_ops: args.modelContext?.opponentLeagueOps ?? null,
    park_strikeout_factor: args.modelContext?.parkStrikeoutFactor ?? null,
    park_run_factor: args.modelContext?.parkRunFactor ?? null,
    temperature_f: args.modelContext?.temperatureF ?? null,
    wind_speed_mph: args.modelContext?.windSpeedMph ?? null,
    precipitation_probability: args.modelContext?.precipitationProbability ?? null,
    recent_starts: recentStarts ?? starts ?? 4,
    rolling_10_start_k: args.group.marketKey === "pitcher_strikeouts" ? recentKPerStart ?? kPerStart : 0,
    rolling_10_batters_faced: recentBattersFacedPerStart ?? battersFacedProxy,
    rolling_10_outs: recentOutsPerStart ?? outsPerStart,
    rolling_pitch_count: recentPitchCountPerStart ?? (pitchCount && starts ? Math.max(65, Math.min(110, pitchCount / starts)) : hasSeasonPitching ? Math.max(65, Math.min(105, outsPerStart * 5.2)) : 84),
    days_rest: null,
    strikeout_rate_recent: kRate,
    season_strikeout_rate: kRate,
    expected_batters_faced: battersFacedProxy,
    season_outs_per_start: outsPerStart,
    season_hits_allowed_per_start: hitsAllowedPerStart,
    season_walks_per_start: walksPerStart,
    season_earned_runs_per_start: earnedRunsPerStart,
    pitcher_win_probability_proxy: starterConfirmed ? 0.38 : 0.28,
    recent_strikeout_rate: recentStrikeoutRate,
    recent_outs_per_start: recentOutsPerStart,
    outs_per_start_recent: recentOutsPerStart ?? outsPerStart,
    expected_plate_appearances: 4.1,
    batter_strikeouts_per_game: 0.9,
    batter_walks_per_game: 0.35,
    batter_hits_per_game: 0.95,
    batter_total_bases_per_game: 1.45,
    batter_home_run_probability: 0.095,
    batter_rbis_per_game: 0.48,
    batter_runs_per_game: 0.52,
    batter_hrr_per_game: 1.95,
    batter_singles_per_game: 0.62,
    batter_doubles_per_game: 0.18,
    batter_triples_per_game: 0.025,
    stolen_base_probability: 0.08,
    first_home_run_probability: 0.025,
    lineup_status_confirmed: starterConfirmed,
    line: args.group.line,
    prop_book: args.group.sportsbook,
    over_american_odds: args.group.over.americanOdds,
    under_american_odds: args.group.under.americanOdds,
  };
  const dataAvailability: PropFeatureSnapshot["dataAvailability"] = {
    game: true,
    probable_pitcher: true,
    market_family: definition.family,
    model_family: definition.modelFamily,
    recommendation_eligibility: definition.recommendationEligibility,
    pitcher_name_mapping: args.group.mappingConfidence,
    bdl_stat_bundle: hasSeasonPitching,
    batter_season_baseline: false,
    recent_logs: recentStarts ?? 0,
    season_pitching_games_started: starts,
    season_pitching_games: gamesPitched,
    season_pitching_ip: innings,
    season_pitching_k: strikeouts,
    season_pitching_k_per_9: kPer9,
    season_pitching_bb: walks,
    season_pitching_h: hitsAllowed,
    season_pitching_er: earnedRuns,
    season_batters_faced: battersFaced,
    season_pitch_count: pitchCount,
    starts_reliable: starts !== null && starts >= 5,
    starter_confirmed: starterConfirmed,
    line_updated_at_present: Boolean(stringValue(rawObj(args.group.over.rawPayload).updated_at) && stringValue(rawObj(args.group.under.rawPayload).updated_at)),
    opponent_k_profile: typeof args.modelContext?.opponentStrikeoutRate === "number" && typeof args.modelContext.opponentLeagueStrikeoutRate === "number",
    opponent_profile: typeof args.modelContext?.opponentOps === "number" && typeof args.modelContext.opponentLeagueOps === "number",
    opponent_projected_lineup: false,
    feature_confidence: confidence,
    feature_confidence_bucket: confidenceBucket(confidence),
    park_factor: typeof args.modelContext?.parkStrikeoutFactor === "number" || typeof args.modelContext?.parkRunFactor === "number",
    weather: args.modelContext?.weatherAvailable === true,
    lineups: isPitcher ? (starterConfirmed ? 1 : 0) : 0,
    odds_two_way: definition.twoWayEligible,
    conservative_real_baseline: true,
  };
  return {
    gameId: args.group.game.id,
    playerId: args.group.playerId,
    marketKey: args.group.marketKey,
    line: args.group.line,
    asOfTimestamp: args.asOfTimestamp,
    featureVersion: `mlb_props_${definition.modelFamily}_v1`,
    features,
    dataAvailability,
    leakageGuardHash: createHash("sha256").update(JSON.stringify({ features, dataAvailability })).digest("hex"),
  };
}

function featureWarningCodes(feature: PropFeatureSnapshot, group: GroupedTwoWay): string[] {
  const warnings: string[] = [];
  if (feature.dataAvailability.bdl_stat_bundle !== true) warnings.push("bdl_stat_bundle_pending_baseline_used");
  const starts = numericAvailability(feature, "season_pitching_games_started");
  const games = numericAvailability(feature, "season_pitching_games");
  const starterShare = starts !== null && games !== null && games > 0 ? starts / games : null;
  if (starts === null || starts < 5 || (starterShare !== null && starterShare < 0.6)) warnings.push("weak_pitcher_baseline");
  if ((numericAvailability(feature, "recent_logs") ?? 0) === 0) warnings.push("recent_logs_unavailable_non_blocking");
  if (feature.dataAvailability.opponent_k_profile !== true) warnings.push("opponent_k_profile_unavailable_non_blocking");
  if ((numericAvailability(feature, "feature_confidence") ?? 0) < 0.75) warnings.push("low_feature_confidence");
  if (group.starterConfidence < 0.98) warnings.push(group.starterReasonCode);
  if (feature.dataAvailability.weather !== true) warnings.push("weather_unavailable_non_blocking");
  if (feature.dataAvailability.lineups === 0) warnings.push("lineup_unconfirmed_non_blocking");
  return warnings;
}

function marketForceNoPlayCodes(args: { marketKey: MlbPropMarketKey; featureConfidence: number; hasTwoWayPair: boolean }): PropReasonCode[] {
  const definition = getMlbPropMarketDefinition(args.marketKey);
  const codes: PropReasonCode[] = [];
  if (!args.hasTwoWayPair) codes.push("MISSING_TWO_WAY_PAIR");
  if (definition.recommendationEligibility === "research_only") {
    if (args.marketKey === "pitcher_record_a_win") codes.push("PITCHER_WIN_CONTEXT_INSUFFICIENT");
    else if (args.marketKey === "first_home_run") codes.push("FIRST_HR_FIELD_MODEL_NOT_PROMOTED");
    else if (args.marketKey === "batter_stolen_bases") codes.push("STOLEN_BASE_CONTEXT_INSUFFICIENT");
    else codes.push("MILESTONE_MODEL_NOT_PROMOTED");
  }
  if (definition.recommendationEligibility === "watchlist_until_context") {
    codes.push(definition.family === "batter" ? "BATTER_CONTEXT_INSUFFICIENT" : "LOW_DATA_CONFIDENCE");
  }
  if (args.featureConfidence < 0.75) codes.push("LOW_DATA_CONFIDENCE");
  return [...new Set(codes)];
}

function featureConfidenceScore(feature: PropFeatureSnapshot, group: GroupedTwoWay): number {
  const stored = numericAvailability(feature, "feature_confidence");
  if (stored !== null) return stored;
  let score = 0.45;
  if (feature.dataAvailability.bdl_stat_bundle === true) score += 0.28;
  if (group.starterConfidence >= 0.98) score += 0.18;
  if ((numericAvailability(feature, "season_pitching_games_started") ?? 0) >= 5) score += 0.06;
  if ((numericAvailability(feature, "season_pitching_ip") ?? 0) >= 20) score += 0.03;
  return Math.min(0.995, Math.round(score * 1000) / 1000);
}

function featureConfidenceScoreFromParts(args: {
  hasSeasonPitching: boolean;
  starterConfidence: number;
  starts: number | null;
  innings: number | null;
  updatedAtPresent: boolean;
}): number {
  let score = 0.35;
  if (args.hasSeasonPitching) score += 0.28;
  if (args.starterConfidence >= 0.98) score += 0.22;
  else if (args.starterConfidence >= 0.8) score += 0.08;
  if ((args.starts ?? 0) >= 5) score += 0.06;
  if ((args.innings ?? 0) >= 20) score += 0.04;
  if (args.updatedAtPresent) score += 0.05;
  return Math.min(0.995, Math.round(score * 1000) / 1000);
}

function diagnosticMarketMath(args: {
  prediction: { side: "over" | "under"; modelProbability: number };
  over: PropOddsSnapshot;
  under: PropOddsSnapshot;
}): { marketProbability: number | null; edge: number | null; expectedValue: number | null } {
  try {
    const devig = remove_vig_two_way(args.over.americanOdds, args.under.americanOdds);
    const marketProbability = args.prediction.side === "over" ? devig.over : devig.under;
    const selectedOdds = args.prediction.side === "over" ? args.over : args.under;
    return {
      marketProbability,
      edge: args.prediction.modelProbability - marketProbability,
      expectedValue: expected_value(args.prediction.modelProbability, selectedOdds.americanOdds),
    };
  } catch {
    return { marketProbability: null, edge: null, expectedValue: null };
  }
}

function buildPitcherFeatureInventory(args: {
  date: string;
  generatedAt: string;
  games: MlbGameEntity[];
  probablePitchers: MlbProbablePitcher[];
  groups: GroupedTwoWay[];
  seasonStatsByPlayerId?: Map<string, RealPitcherSeasonStat>;
}) {
  const groupByPlayer = new Map<string, GroupedTwoWay[]>();
  for (const group of args.groups) {
    const rows = groupByPlayer.get(group.playerId) ?? [];
    rows.push(group);
    groupByPlayer.set(group.playerId, rows);
  }
  const pitchers = args.probablePitchers.map((pitcher) => {
    const groups = pitcher.playerId ? groupByPlayer.get(pitcher.playerId) ?? [] : [];
    const sample = groups[0] ?? null;
    const bdlRaw = sample ? rawObj(sample.over.rawPayload) : {};
    const bdlPlayerId = stringValue(bdlRaw.bdl_player_id);
    const bdlGameId = stringValue(bdlRaw.bdl_game_id);
    const season = (pitcher.playerId ? args.seasonStatsByPlayerId?.get(pitcher.playerId) ?? null : null)
      ?? (sample ? args.seasonStatsByPlayerId?.get(sample.playerId) ?? null : null);
    const game = args.games.find((row) => row.id === pitcher.gameId) ?? null;
    const teamId = sample?.teamId ?? pitcher.teamId;
    return {
      gameId: pitcher.gameId,
      playerId: pitcher.playerId,
      teamId,
      opponentTeamId: game ? (game.homeTeamId === teamId ? game.awayTeamId : game.awayTeamId === teamId ? game.homeTeamId : null) : null,
      homeAway: game ? (game.homeTeamId === teamId ? "home" : game.awayTeamId === teamId ? "away" : "unknown") : "unknown",
      identity: {
        bdlPlayerId,
        bdlGameId,
        position: stringValue(bdlRaw.player_position) ?? "P",
        handedness: stringValue(bdlRaw.player_handedness),
        source: bdlPlayerId ? "balldontlie_prop_payload" : pitcher.playerId?.startsWith("mlbstats-player-") ? "mlb_stats_probable_pitcher" : "unknown",
      },
      starterConfidence: {
        bdlProbableStarter: sample?.starterReasonCode === "STARTER_CONFIRMED_BDL",
        mlbStatsProbableStarter: sample?.starterReasonCode === "STARTER_CONFIRMED_MLB_STATS" || pitcher.status === "announced",
        playbookStarter: null,
        confidence: sample?.starterConfidence ?? (pitcher.status === "announced" ? 0.8 : 0.3),
        reason: sample?.starterReasonCode ?? pitcher.status,
        conflicts: sample?.starterReasonCode === "STARTER_CONFLICT" ? ["STARTER_CONFLICT"] : [],
      },
      seasonStats: {
        providerSource: season ? "bdl_or_supabase_player_season_stats" : null,
        inningsPitched: season?.pitchingIp ?? null,
        strikeouts: season?.pitchingK ?? null,
        walks: season?.pitchingBb ?? null,
        hitsAllowed: season?.pitchingH ?? null,
        earnedRuns: season?.pitchingEr ?? null,
        games: season?.pitchingGp ?? null,
        starts: season?.pitchingGs ?? null,
        battersFaced: season?.battersFaced ?? null,
        pitchCount: season?.pitchCount ?? null,
        available: Boolean(season?.pitchingIp && season.pitchingK),
      },
      recentStats: {
        available: false,
        source: null,
        startsReliable: false,
        last3Starts: null,
        last5Starts: null,
        last10Starts: null,
        note: "Current verified providers in this scorer do not expose reliable pitcher game logs/recent starts. Season baseline remains active.",
      },
      context: {
        opponentTeamId: game ? (game.homeTeamId === teamId ? game.awayTeamId : game.awayTeamId === teamId ? game.homeTeamId : null) : null,
        opponentProjectedLineupAvailable: false,
        opponentKProfileAvailable: false,
        venue: game?.venue ?? null,
        weatherAvailable: false,
        playbookContextAvailable: false,
      },
      marketsSeen: groups.map((group) => ({
        market: group.marketKey,
        sportsbook: group.sportsbook,
        line: group.line,
        overUpdatedAt: stringValue(rawObj(group.over.rawPayload).updated_at),
        underUpdatedAt: stringValue(rawObj(group.under.rawPayload).updated_at),
      })),
    };
  });
  const representedPlayerIds = new Set(pitchers.map((pitcher) => pitcher.playerId).filter((playerId): playerId is string => Boolean(playerId)));
  for (const [playerId, groups] of groupByPlayer.entries()) {
    if (representedPlayerIds.has(playerId)) continue;
    const sample = groups[0] ?? null;
    if (!sample) continue;
    const bdlRaw = rawObj(sample.over.rawPayload);
    const bdlPlayerId = stringValue(bdlRaw.bdl_player_id);
    const bdlGameId = stringValue(bdlRaw.bdl_game_id);
    const season = args.seasonStatsByPlayerId?.get(playerId) ?? null;
    const game = args.games.find((row) => row.id === sample.game.id) ?? sample.game;
    const teamId = sample.teamId;
    pitchers.push({
      gameId: sample.game.id,
      playerId,
      teamId,
      opponentTeamId: game.homeTeamId === teamId ? game.awayTeamId : game.awayTeamId === teamId ? game.homeTeamId : null,
      homeAway: game.homeTeamId === teamId ? "home" : game.awayTeamId === teamId ? "away" : "unknown",
      identity: {
        bdlPlayerId,
        bdlGameId,
        position: stringValue(bdlRaw.player_position) ?? "P",
        handedness: stringValue(bdlRaw.player_handedness),
        source: bdlPlayerId ? "balldontlie_prop_payload" : "resolved_prop_payload",
      },
      starterConfidence: {
        bdlProbableStarter: sample.starterReasonCode === "STARTER_CONFIRMED_BDL",
        mlbStatsProbableStarter: sample.starterReasonCode === "STARTER_CONFIRMED_MLB_STATS",
        playbookStarter: null,
        confidence: sample.starterConfidence,
        reason: sample.starterReasonCode,
        conflicts: sample.starterReasonCode === "STARTER_CONFLICT" ? ["STARTER_CONFLICT"] : [],
      },
      seasonStats: {
        providerSource: season ? "bdl_or_supabase_player_season_stats" : null,
        inningsPitched: season?.pitchingIp ?? null,
        strikeouts: season?.pitchingK ?? null,
        walks: season?.pitchingBb ?? null,
        hitsAllowed: season?.pitchingH ?? null,
        earnedRuns: season?.pitchingEr ?? null,
        games: season?.pitchingGp ?? null,
        starts: season?.pitchingGs ?? null,
        battersFaced: season?.battersFaced ?? null,
        pitchCount: season?.pitchCount ?? null,
        available: Boolean(season?.pitchingIp && season.pitchingK),
      },
      recentStats: {
        available: false,
        source: null,
        startsReliable: false,
        last3Starts: null,
        last5Starts: null,
        last10Starts: null,
        note: "Current verified providers in this scorer do not expose reliable pitcher game logs/recent starts. Season baseline remains active.",
      },
      context: {
        opponentTeamId: game.homeTeamId === teamId ? game.awayTeamId : game.awayTeamId === teamId ? game.homeTeamId : null,
        opponentProjectedLineupAvailable: false,
        opponentKProfileAvailable: false,
        venue: game.venue ?? null,
        weatherAvailable: false,
        playbookContextAvailable: false,
      },
      marketsSeen: groups.map((group) => ({
        market: group.marketKey,
        sportsbook: group.sportsbook,
        line: group.line,
        overUpdatedAt: stringValue(rawObj(group.over.rawPayload).updated_at),
        underUpdatedAt: stringValue(rawObj(group.under.rawPayload).updated_at),
      })),
    });
  }
  return {
    provider: "verified_current_props_inputs",
    date: args.date,
    generatedAt: args.generatedAt,
    writesToSupabase: false,
    pitchers,
    summary: {
      probablePitchers: args.probablePitchers.length,
      pitchersWithBdlIdentity: pitchers.filter((row) => row.identity.bdlPlayerId && row.identity.bdlGameId).length,
      pitchersWithSeasonStats: pitchers.filter((row) => row.seasonStats.available).length,
      pitchersWithRecentLogs: 0,
      opponentKProfileAvailable: false,
      rollingLogsAvailable: false,
    },
  };
}

async function writePitcherFeatureInventory(report: ReturnType<typeof buildPitcherFeatureInventory>): Promise<{ outputPath: string; report: ReturnType<typeof buildPitcherFeatureInventory> }> {
  const outputDir = propsReportDirectory();
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${report.date}-pitcher-feature-inventory.json`);
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return { outputPath, report };
}

function buildModelComparisonReport(args: { date: string; generatedAt: string; candidates: ModelComparisonCandidate[] }) {
  const swings = [...args.candidates].sort((a, b) => Math.abs(b.probabilityDifference) - Math.abs(a.probabilityDifference));
  const diffs = args.candidates.map((row) => Math.abs(row.probabilityDifference));
  return {
    date: args.date,
    generatedAt: args.generatedAt,
    writesToSupabase: false,
    candidates: args.candidates,
    summary: {
      candidates: args.candidates.length,
      averageProbabilityDifference: nullableRound(avg(diffs)),
      largestProbabilitySwings: swings.slice(0, 10),
      baselineRecommendedDistributionBlocked: args.candidates.filter((row) => row.disagreementReason.includes("new_model_lower_or_blocked")).length,
      distributionRecommendedBaselineDidNot: args.candidates.filter((row) => row.disagreementReason.includes("side_changed")).length,
      marketSideVendorDistribution: countBy(args.candidates, (row) => `${row.market}|${row.side}|${row.vendor}`),
      confidenceDistribution: countBy(args.candidates, (row) => row.confidenceBucket),
    },
  };
}

async function writeModelComparisonReport(report: ReturnType<typeof buildModelComparisonReport>): Promise<{ outputPath: string; report: ReturnType<typeof buildModelComparisonReport> }> {
  const outputDir = propsReportDirectory();
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${report.date}-model-comparison.json`);
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return { outputPath, report };
}

function buildMarketFeatureInventoryReport(args: {
  date: string;
  generatedAt: string;
  odds: PropOddsSnapshot[];
  groups: GroupedTwoWay[];
  candidates: RealPropsCandidateSummary[];
  rejected: Record<string, number>;
}) {
  const oddsByMarket = countBy(args.odds.map((row) => row.marketKey));
  const groupsByMarket = countBy(args.groups.map((row) => row.marketKey));
  const candidatesByMarket = countBy(args.candidates.map((row) => row.marketKey));
  return {
    provider: "verified_current_props_inputs",
    date: args.date,
    generatedAt: args.generatedAt,
    writesToSupabase: false,
    markets: allMlbPropMarketDefinitions().map((definition) => ({
      market: definition.marketKey,
      label: definition.label,
      family: definition.family,
      marketGroup: definition.marketGroup,
      displayGroup: definition.displayGroup,
      settlementStatKey: definition.settlementStatKey,
      modelFamily: definition.modelFamily,
      requiredFeatures: definition.requiredFeatures,
      preferredFeatures: definition.preferredFeatures,
      optionalFeatures: definition.optionalFeatures,
      confidenceGates: definition.confidenceGates,
      defaultGrade: definition.defaultGrade,
      twoWayEligible: definition.twoWayEligible,
      recommendationEligibility: definition.recommendationEligibility,
      displayStatus: definition.defaultDisplayStatus,
      rawRows: oddsByMarket[definition.marketKey] ?? 0,
      twoWayGroups: groupsByMarket[definition.marketKey] ?? 0,
      scoredCandidates: candidatesByMarket[definition.marketKey] ?? 0,
      missingFeatures: definition.missingFeatureReasons,
      fallbackLogic: definition.recommendationEligibility === "eligible_now" ? "season/provider verified baseline with market-prior shrinkage" : "watchlist/research only until missing context is verified",
    })),
    rejected: args.rejected,
    summary: {
      rawProps: args.odds.length,
      normalizedMarkets: Object.keys(oddsByMarket).sort(),
      scoredMarkets: Object.keys(candidatesByMarket).sort(),
      noPlayMarkets: args.candidates.filter((row) => row.status === "no_play").map((row) => row.marketKey),
      watchlistMarkets: args.candidates.filter((row) => row.displayStatus === "watchlist").map((row) => row.marketKey),
      recommendedMarkets: args.candidates.filter((row) => row.status === "recommended").map((row) => row.marketKey),
      gradeCounts: countBy(args.candidates.map((row) => row.playGrade)),
      missingTwoWayPairs: args.rejected.TWO_WAY_PAIR_MISSING ?? 0,
    },
  };
}

async function writeMarketFeatureInventoryReport(report: ReturnType<typeof buildMarketFeatureInventoryReport>): Promise<{ outputPath: string; report: ReturnType<typeof buildMarketFeatureInventoryReport> }> {
  const outputDir = propsReportDirectory();
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${report.date}-market-feature-inventory.json`);
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return { outputPath, report };
}

function buildRecommendationSanityAuditReport(args: {
  date: string;
  generatedAt: string;
  candidates: RealPropsCandidateSummary[];
  rejected: Record<string, number>;
  staleOddsCount: number;
}) {
  return {
    date: args.date,
    generatedAt: args.generatedAt,
    writesToSupabase: false,
    candidates: args.candidates,
    gradeCounts: countBy(args.candidates.map((row) => row.playGrade)),
    statusCounts: countBy(args.candidates.map((row) => row.status)),
    rejectedReasonCounts: args.rejected,
    staleOddsCount: args.staleOddsCount,
    evRange: valueRange(args.candidates.map((row) => row.expectedValue).filter(isFiniteNumber)),
    modelEdgeRange: valueRange(args.candidates.map((row) => row.modelEdge).filter(isFiniteNumber)),
    duplicateConflictPolicy: {
      bestPriceOnlyForPaperSet: true,
      conflictingSidesBlocked: true,
      maxFirstPaperPicks: 25,
    },
    summary: {
      rawProps: args.candidates.length,
      recommendations: args.candidates.filter((row) => row.playGrade === "BEST_ANGLE").length,
      leans: args.candidates.filter((row) => row.playGrade === "LEAN").length,
      watchlist: args.candidates.filter((row) => row.playGrade === "WATCHLIST").length,
      noPlay: args.candidates.filter((row) => row.playGrade === "NO_PLAY").length,
      pendingData: args.candidates.filter((row) => row.playGrade === "PENDING_DATA").length,
      research: args.candidates.filter((row) => row.playGrade === "RESEARCH").length,
      currentBlocker: args.candidates.length === 0 ? "PROVIDER_PROP_ODDS_UNAVAILABLE" : null,
    },
  };
}

async function writeRecommendationSanityAuditReport(report: ReturnType<typeof buildRecommendationSanityAuditReport>): Promise<{ outputPath: string; report: ReturnType<typeof buildRecommendationSanityAuditReport> }> {
  const outputDir = propsReportDirectory();
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${report.date}-recommendation-sanity-audit.json`);
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return { outputPath, report };
}

function buildCalibrationReadinessReport(args: {
  date: string;
  generatedAt: string;
  candidates: ModelComparisonCandidate[];
  recommendations: MlbPropBacktestResult["recommendations"];
}) {
  return {
    date: args.date,
    generatedAt: args.generatedAt,
    writesToSupabase: false,
    probabilitiesByBucket: probabilityBuckets(args.candidates.map((row) => row.newDistributionProbability)),
    recommendationCountsByBucket: probabilityBuckets(args.recommendations.map((row) => row.recommendation.modelProbability)),
    confidenceCounts: countBy(args.candidates.map((row) => row.confidenceBucket)),
    marketsScored: sortedUniqueStrings(args.candidates.map((row) => row.market)),
    fieldsMissingForTrueCalibration: [
      "settled prop history by market",
      "closing line capture for every book/market",
      "lineup-confirmed batter opportunity",
      "opponent batter/pitcher profiles",
      "field-wide first-home-run market",
    ],
    settlementFieldsAvailable: ["market_key", "player_id", "game_id", "line", "side", "result_value", "push"],
    clvFieldsAvailable: ["opening odds", "current odds", "closing odds when provider supplies closing snapshots"],
  };
}

async function writeCalibrationReadinessReport(report: ReturnType<typeof buildCalibrationReadinessReport>): Promise<{ outputPath: string; report: ReturnType<typeof buildCalibrationReadinessReport> }> {
  const outputDir = propsReportDirectory();
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${report.date}-calibration-readiness.json`);
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return { outputPath, report };
}

function buildProviderMarketComparisonReport(args: {
  date: string;
  generatedAt: string;
  odds: PropOddsSnapshot[];
  providerContext?: RealPropsProviderContext;
}) {
  const byProvider = new Map<string, PropOddsSnapshot[]>();
  for (const row of args.odds) {
    const rows = byProvider.get(row.provider) ?? [];
    rows.push(row);
    byProvider.set(row.provider, rows);
  }
  const bdlMarkets = sortedUniqueStrings((byProvider.get("balldontlie") ?? []).map((row) => row.marketKey));
  const sharpMarkets = sortedUniqueStrings((byProvider.get("sharpapi") ?? []).map((row) => row.marketKey));
  return {
    date: args.date,
    generatedAt: args.generatedAt,
    writesToSupabase: false,
    bdlMarketsFound: bdlMarkets,
    sharpApiMarketsFound: sharpMarkets,
    marketsAvailableByBoth: bdlMarkets.filter((market) => sharpMarkets.includes(market)),
    marketsOnlyAvailableFromBdl: bdlMarkets.filter((market) => !sharpMarkets.includes(market)),
    marketsOnlyAvailableFromSharpApi: sharpMarkets.filter((market) => !bdlMarkets.includes(market)),
    vendorCoverage: countBy(args.odds.map((row) => row.sportsbook)),
    hardRockAvailability: {
      found: args.odds.some((row) => row.sportsbook === "hardrock"),
      rows: args.odds.filter((row) => row.sportsbook === "hardrock").length,
    },
    selectedOddsSourceByMarket: Object.fromEntries(allMlbPropMarketDefinitions().map((definition) => [
      definition.marketKey,
      bdlMarkets.includes(definition.marketKey) ? "balldontlie" : sharpMarkets.includes(definition.marketKey) ? "sharpapi" : "none",
    ])),
    providerReliabilityStatus: {
      selectedOddsProvider: args.providerContext?.selectedOddsProvider ?? inferredOddsProvider(args.odds),
      sharpApiPropRows: args.providerContext?.sharpApiPropRows ?? sharpMarkets.length,
      bdlPropRows: args.providerContext?.bdlPropRows ?? (byProvider.get("balldontlie") ?? []).length,
      fallbackReason: args.providerContext?.fallbackReason ?? null,
    },
  };
}

async function writeProviderMarketComparisonReport(report: ReturnType<typeof buildProviderMarketComparisonReport>): Promise<{ outputPath: string; report: ReturnType<typeof buildProviderMarketComparisonReport> }> {
  const outputDir = propsReportDirectory();
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${report.date}-provider-market-comparison.json`);
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return { outputPath, report };
}

function buildPropsSplitsContextAuditReport(args: {
  date: string;
  generatedAt: string;
  odds: PropOddsSnapshot[];
  games: MlbGameEntity[];
  probablePitchers: MlbProbablePitcher[];
  seasonStatsByPlayerId?: Map<string, RealPitcherSeasonStat>;
}) {
  const bdlOdds = args.odds.filter((row) => row.provider === "balldontlie");
  const sharpOdds = args.odds.filter((row) => row.provider === "sharpapi");
  const seasonStatsAvailable = (args.seasonStatsByPlayerId?.size ?? 0) > 0;
  const entry = (
    provider: string,
    field: string,
    available: boolean,
    source: string,
    timestampField: string | null,
    usableInModel: boolean,
    usableInUi: boolean,
    confidence: "high" | "medium" | "low" | "unverified",
    reason: string | null,
    sampleSafeKeys: string[],
  ) => ({ provider, field, available, endpointOrSource: source, sampleSafeKeys, timestampOrAsOfField: timestampField, usableInModel, usableInUi, confidence, reasonIfUnavailable: available ? null : reason });

  const fields = [
    entry("BDL", "player season stats", seasonStatsAvailable, "/season_stats", null, seasonStatsAvailable, seasonStatsAvailable, seasonStatsAvailable ? "medium" : "unverified", "No verified season-stat rows were present in this run.", ["player_id", "pitching_ip", "pitching_k", "pitching_bb", "pitching_h", "pitching_er"]),
    entry("BDL", "player game logs", false, "not verified in scoring contract", null, false, false, "unverified", "Rolling player game logs are not present in the current verified scoring input.", []),
    entry("BDL", "lineups/probables", false, "/lineups contract audit", null, false, false, "unverified", "Lineup rows are not passed into the current scorer; do not infer confirmation.", []),
    entry("BDL", "pitch type stats", false, "not verified", null, false, false, "unverified", "No verified pitch-type payload is available.", []),
    entry("BDL", "batting splits", false, "not verified", null, false, false, "unverified", "No verified handedness or batting split payload is available.", []),
    entry("BDL", "pitching splits", false, "not verified", null, false, false, "unverified", "No verified handedness pitching split payload is available.", []),
    entry("BDL", "settlement fields", seasonStatsAvailable, "/season_stats and final stats contract", null, seasonStatsAvailable, true, seasonStatsAvailable ? "medium" : "unverified", "Final settlement payload was not sampled in this dry-run.", ["pitching_k", "pitching_ip", "pitching_h", "pitching_bb", "pitching_er"]),
    entry("BDL", "odds/player props", bdlOdds.length > 0, "/mlb/v1/player_props", "updated_at", true, true, bdlOdds.length > 0 ? "high" : "unverified", "No BDL prop rows were returned for this slate.", ["game_id", "player_id", "prop_type", "line_value", "market", "vendor", "updated_at"]),
    entry("SharpAPI", "odds/player props", sharpOdds.length > 0, "event odds discovery", "asOfTimestamp", true, true, sharpOdds.length > 0 ? "medium" : "unverified", "No normalized SharpAPI player prop rows were returned.", ["event_id", "market", "player", "sportsbook", "selection", "line", "odds"]),
    entry("SharpAPI", "sportsbook/book coverage", sharpOdds.length > 0, "event odds discovery", "asOfTimestamp", false, true, sharpOdds.length > 0 ? "medium" : "unverified", "Book coverage cannot be established without player prop rows.", ["sportsbook"]),
    entry("SharpAPI", "Hard Rock", sharpOdds.some((row) => row.sportsbook === "hardrock"), "event odds discovery", "asOfTimestamp", false, true, sharpOdds.some((row) => row.sportsbook === "hardrock") ? "medium" : "unverified", "No Hard Rock player prop row was verified.", ["sportsbook", "americanOdds"]),
    entry("SharpAPI", "line movement/snapshots", false, "not verified in returned player props", null, false, false, "unverified", "No verified player-prop snapshot sequence is available.", []),
    entry("Playbook", "public betting splits", false, "/splits contract audit", null, false, false, "unverified", "No split payload is supplied to the props scorer.", []),
    entry("Playbook", "handle vs bets", false, "/splits contract audit", null, false, false, "unverified", "No verified handle-versus-bets fields are available to this run.", []),
    entry("Playbook", "consensus", false, "/lines contract audit", null, false, false, "unverified", "No verified player-prop consensus payload is supplied to the props scorer.", []),
    entry("Playbook", "line movement", false, "/lines contract audit", null, false, false, "unverified", "No timestamped player-prop line history is supplied to the props scorer.", []),
    entry("Playbook", "starters/injuries/venue/weather", false, "provider contract audit", null, false, false, "unverified", "Context endpoints exist under audit but their payloads are not inputs to this scorer.", []),
    entry("MLB Stats API", "schedule", args.games.length > 0, "schedule endpoint", "scheduledStart", true, true, args.games.length > 0 ? "high" : "unverified", "No games were returned for this slate.", ["gamePk", "gameDate", "teams", "status"]),
    entry("MLB Stats API", "probable pitchers", args.probablePitchers.length > 0, "schedule probablePitcher hydration", "asOfTimestamp", true, true, args.probablePitchers.length > 0 ? "high" : "unverified", "Probable pitcher coverage is incomplete or absent.", ["playerId", "teamId", "gameId", "asOfTimestamp"]),
    entry("MLB Stats API", "player/team IDs", args.games.length > 0, "schedule endpoint", "scheduledStart", true, true, args.games.length > 0 ? "high" : "unverified", "No schedule identity rows were returned.", ["gamePk", "team.id", "probablePitcher.id"]),
    entry("MLB Stats API", "box score/final stats", false, "boxscore endpoint not called in dry-run", null, false, false, "unverified", "Final stats are reserved for settlement and were not requested in this pregame run.", []),
  ];

  return {
    date: args.date,
    generatedAt: args.generatedAt,
    writesToSupabase: false,
    fields,
    marketContextPolicy: "Splits and context may receive conservative weight only after their payload fields and timestamps are verified; they are never synthesized.",
    summary: {
      availableFields: fields.filter((field) => field.available).length,
      unavailableOrUnverifiedFields: fields.filter((field) => !field.available).length,
      modelUsableFields: fields.filter((field) => field.available && field.usableInModel).length,
      uiUsableFields: fields.filter((field) => field.available && field.usableInUi).length,
      fakeSplitsShown: false,
      requestedSignals: {
        publicSplits: { available: false, provider: "Playbook", endpointOrSource: "/splits contract audit", timestampOrAsOfField: null, usableInModel: false, usableInUi: false },
        handleVsBets: { available: false, provider: "Playbook", endpointOrSource: "/splits contract audit", timestampOrAsOfField: null, usableInModel: false, usableInUi: false },
        lineMovement: { available: false, provider: "SharpAPI/Playbook", endpointOrSource: "player-prop snapshots or /lines contract audit", timestampOrAsOfField: null, usableInModel: false, usableInUi: false },
        consensus: { available: false, provider: "Playbook", endpointOrSource: "/lines contract audit", timestampOrAsOfField: null, usableInModel: false, usableInUi: false },
      },
    },
  };
}

async function writePropsSplitsContextAuditReport(report: ReturnType<typeof buildPropsSplitsContextAuditReport>): Promise<{ outputPath: string; report: ReturnType<typeof buildPropsSplitsContextAuditReport> }> {
  const outputDir = propsReportDirectory();
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${report.date}-props-splits-context-audit.json`);
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return { outputPath, report };
}

function buildFirstPaperRunDecisionReport(args: {
  date: string;
  summary: {
    candidatesScored: number;
    recommendationsPassingEvEdge: number;
    rejected: Record<string, number>;
    staleOddsCount: number;
    publicDisplayEnabled: boolean;
    publicApiEnabled: boolean;
    realPublishEnabled: boolean;
  };
  scored: MlbPropBacktestResult;
  paperScored: MlbPropBacktestResult;
  bdlAudit: BdlRecommendationSanityAudit | null;
  comparisons: ModelComparisonCandidate[];
}) {
  const rawRecommendations = args.scored.recommendations.filter((row) => row.recommendation.status === "recommended");
  const oddsAnomalies = args.bdlAudit?.summary.sanityFlags ?? {};
  const modelSanityPasses = args.comparisons.every((row) => row.newDistributionProbability >= 0 && row.newDistributionProbability <= 1);
  const oddsSanityPasses = Object.values(oddsAnomalies).reduce((sum, value) => sum + value, 0) === 0 && args.summary.staleOddsCount === 0;
  const confidenceCounts = countBy(args.comparisons, (row) => row.confidenceBucket);
  const persistRecommended =
    args.summary.candidatesScored > 0 &&
    rawRecommendations.length > 0 &&
    args.paperScored.bets > 0 &&
    modelSanityPasses &&
    oddsSanityPasses &&
    !args.summary.publicDisplayEnabled &&
    !args.summary.publicApiEnabled &&
    !args.summary.realPublishEnabled;
  return {
    date: args.date,
    writesToSupabase: false,
    rawCandidates: args.scored.recommendations.length,
    rawRecommendations: rawRecommendations.length,
    dedupedRecommendations: args.bdlAudit?.summary.dedupedReviewRecommendationsCount ?? rawRecommendations.length,
    cappedFirstPaperSet: args.paperScored.recommendations.map((row) => ({
      gameId: row.gameId,
      playerId: row.playerId,
      market: row.marketKey,
      side: row.recommendation.side,
      line: row.recommendation.line,
      sportsbook: row.recommendation.sportsbook,
      modelProbability: row.recommendation.modelProbability,
      edge: row.recommendation.edge,
      expectedValue: row.recommendation.expectedValue,
      confidenceTier: row.recommendation.confidenceTier,
    })),
    rejectedReasonCounts: args.summary.rejected,
    oddsAnomalies,
    featureConfidenceDistribution: confidenceCounts,
    modelProbabilityDistribution: probabilityBuckets(args.comparisons.map((row) => row.newDistributionProbability)),
    evDistribution: valueRange(args.scored.recommendations.map((row) => row.recommendation.expectedValue).filter(isFiniteNumber)),
    recommendedFirstPaperCount: args.paperScored.bets,
    persistRecommended,
    persistCommandIfRecommended: persistRecommended
      ? `ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=true ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false ODDSPHERE_PROPS_DISPLAY_ENABLED=false ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false npm run score:mlb-props -- --date=${args.date} --provider=real --persist --dry-run=false`
      : null,
    blockers: [
      ...(args.summary.candidatesScored === 0 ? ["NO_CANDIDATES_SCORED"] : []),
      ...(rawRecommendations.length === 0 ? ["NO_RAW_RECOMMENDATIONS"] : []),
      ...(args.paperScored.bets === 0 ? ["EMPTY_CAPPED_FIRST_PAPER_SET"] : []),
      ...(!modelSanityPasses ? ["MODEL_SANITY_FAILED"] : []),
      ...(!oddsSanityPasses ? ["ODDS_SANITY_FAILED"] : []),
      ...(args.summary.publicDisplayEnabled ? ["PUBLIC_DISPLAY_ENABLED"] : []),
      ...(args.summary.publicApiEnabled ? ["PUBLIC_API_ENABLED"] : []),
      ...(args.summary.realPublishEnabled ? ["REAL_PUBLISH_ENABLED"] : []),
    ],
  };
}

async function writeFirstPaperRunDecisionReport(report: ReturnType<typeof buildFirstPaperRunDecisionReport>): Promise<{ outputPath: string; report: ReturnType<typeof buildFirstPaperRunDecisionReport> }> {
  const outputDir = propsReportDirectory();
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${report.date}-first-paper-run-decision.json`);
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return { outputPath, report };
}

async function writeBdlScoringRejectionTrace(trace: BdlScoringRejectionTrace): Promise<{ outputPath: string; trace: BdlScoringRejectionTrace }> {
  const outputDir = propsReportDirectory();
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${trace.date}-bdl-scoring-rejection-trace.json`);
  await writeFile(outputPath, JSON.stringify(trace, null, 2));
  return { outputPath, trace };
}

function buildBdlTraceSummary(args: {
  candidates: BdlScoringCandidateTrace[];
  rejected: Record<string, number>;
}): BdlScoringRejectionTrace["summary"] {
  const candidatesByMarket: Record<string, number> = {};
  const candidatesByVendor: Record<string, number> = {};
  const rejectedByReasonCode: Record<string, number> = {};
  const rejectedByMarket: Record<string, number> = {};
  const rejectedByBook: Record<string, number> = {};
  let positiveEvBlockedByDataConfidence = 0;
  let sufficientDataButEvEdgeBelowThreshold = 0;
  let missingBdlStatFields = 0;
  let missingStarterStatus = 0;
  let blockedByMappingConfidence = 0;
  let blockedByFeatureBundleNotPromoted = 0;
  let recommendations = 0;
  for (const candidate of args.candidates) {
    inc(candidatesByMarket, candidate.market);
    inc(candidatesByVendor, candidate.vendor);
    if (candidate.recommendationStatus === "recommended") recommendations++;
    for (const reason of candidate.rejectionReasonCodes) {
      inc(rejectedByReasonCode, reason);
      inc(rejectedByMarket, `${candidate.market}|${reason}`);
      inc(rejectedByBook, `${candidate.vendor}|${reason}`);
    }
    if ((candidate.expectedValue ?? 0) > 0 && candidate.rejectionReasonCodes.includes("LOW_DATA_CONFIDENCE")) positiveEvBlockedByDataConfidence++;
    if (candidate.featureConfidence >= 0.9 && candidate.starterConfidence >= 0.98 && candidate.mappingConfidence >= 0.98 && candidate.recommendationStatus === "no_play" && candidate.rejectionReasonCodes.includes("NO_PLAY")) {
      sufficientDataButEvEdgeBelowThreshold++;
    }
    if (candidate.dataAvailabilityFlags.bdl_stat_bundle !== true) missingBdlStatFields++;
    if (candidate.starterConfidence < 0.98) missingStarterStatus++;
    if (candidate.mappingConfidence < 0.98) blockedByMappingConfidence++;
    if (candidate.rejectionReasonCodes.includes("bdl_stat_bundle_pending_baseline_used")) blockedByFeatureBundleNotPromoted++;
  }
  return {
    totalCandidates: args.candidates.length,
    candidatesByMarket,
    candidatesByVendor,
    rejectedByReasonCode: { ...args.rejected, ...rejectedByReasonCode },
    rejectedByMarket,
    rejectedByBook,
    positiveEvBlockedByDataConfidence,
    sufficientDataButEvEdgeBelowThreshold,
    missingBdlStatFields,
    missingStarterStatus,
    missingTwoWayPair: args.rejected.TWO_WAY_PAIR_MISSING ?? 0,
    blockedByMappingConfidence,
    blockedByFeatureBundleNotPromoted,
    recommendations,
  };
}

function bdlOddsSanityFlags(args: {
  group: GroupedTwoWay;
  prediction: { side: "over" | "under"; modelProbability: number };
  diagnostic: { marketProbability: number | null; edge: number | null; expectedValue: number | null };
  asOfTimestamp: string;
}): PropReasonCode[] {
  const flags: PropReasonCode[] = [];
  if (args.group.over.side !== "over" || args.group.under.side !== "under") flags.push("SIDE_ODDS_MISMATCH");
  if (args.group.over.line !== args.group.under.line || args.group.over.line !== args.group.line) flags.push("LINE_MISMATCH");
  if (rawObj(args.group.over.rawPayload).market_kind !== "over_under" || rawObj(args.group.under.rawPayload).market_kind !== "over_under") flags.push("SIDE_ODDS_MISMATCH");
  try {
    const devig = remove_vig_two_way(args.group.over.americanOdds, args.group.under.americanOdds);
    const sum = devig.over + devig.under;
    if (Math.abs(sum - 1) > 0.000001 || devig.over <= 0 || devig.under <= 0) flags.push("NO_VIG_SUM_ANOMALY");
  } catch {
    flags.push("NO_VIG_SUM_ANOMALY");
  }
  const overUpdated = stringValue(rawObj(args.group.over.rawPayload).updated_at);
  const underUpdated = stringValue(rawObj(args.group.under.rawPayload).updated_at);
  if (!overUpdated || !underUpdated) flags.push("MISSING_UPDATED_AT");
  const stale = [overUpdated, underUpdated].some((ts) => {
    if (!ts) return false;
    const diff = Date.parse(args.asOfTimestamp) - Date.parse(ts);
    return Number.isFinite(diff) && diff > 60 * 60 * 1000;
  });
  if (stale) flags.push("STALE_BDL_ODDS");
  if ((args.diagnostic.expectedValue ?? 0) > 0.75 || Math.abs(args.diagnostic.edge ?? 0) > 0.5) flags.push("UNUSUALLY_HIGH_EV");
  if (args.prediction.modelProbability < 0 || args.prediction.modelProbability > 1) flags.push("NO_VIG_SUM_ANOMALY");
  return sortedUniqueReasonCodes(flags);
}

function buildBdlRecommendationSanityAudit(args: {
  date: string;
  generatedAt: string;
  candidates: BdlScoringCandidateTrace[];
}): BdlRecommendationSanityAudit {
  const rawRecommendations = args.candidates.filter((candidate) => candidate.recommendationStatus === "recommended");
  const dedupe = dedupeReviewRecommendations(rawRecommendations);
  const evs = rawRecommendations.map((row) => row.expectedValue).filter(isFiniteNumber);
  const edges = rawRecommendations.map((row) => row.edge).filter(isFiniteNumber);
  const modelProbs = rawRecommendations.map((row) => row.modelProbability).filter(isFiniteNumber);
  const marketProbs = rawRecommendations.map((row) => row.noVigMarketProbability).filter(isFiniteNumber);
  const odds = rawRecommendations.flatMap((row) => [row.overOdds, row.underOdds]).filter(isFiniteNumber);
  const lines = rawRecommendations.map((row) => row.line).filter(isFiniteNumber);
  const sanityFlags: Record<string, number> = {};
  for (const row of args.candidates) for (const flag of row.sanityFlags) inc(sanityFlags, flag);
  const impossibleProbabilityCount = args.candidates.filter((row) =>
    !isFiniteNumber(row.modelProbability) ||
    row.modelProbability < 0 ||
    row.modelProbability > 1 ||
    (row.noVigMarketProbability !== null && (
      !isFiniteNumber(row.noVigMarketProbability) ||
      row.noVigMarketProbability < 0 ||
      row.noVigMarketProbability > 1
    ))
  ).length;
  const oddsParsingOutlierRecommendations = rawRecommendations.filter((row) =>
    Math.abs(row.overOdds) > 1000 ||
    Math.abs(row.underOdds) > 1000 ||
    (row.expectedValue ?? 0) > 0.75 ||
    Math.abs(row.edge ?? 0) > 0.5
  ).length;
  if (dedupe.duplicateGroups.length > 0) sanityFlags.DUPLICATE_VENDOR_LINE = dedupe.duplicateGroups.length;
  if (dedupe.conflictGroups.length > 0) sanityFlags.CONFLICTING_SIDE_RECOMMENDATION = dedupe.conflictGroups.length;
  return {
    provider: "balldontlie",
    date: args.date,
    generatedAt: args.generatedAt,
    writesToSupabase: false,
    rawRecommendations,
    reviewRecommendations: dedupe.reviewRecommendations,
    duplicateGroups: dedupe.duplicateGroups,
    conflictGroups: dedupe.conflictGroups,
    summary: {
      rawRecommendationsCount: rawRecommendations.length,
      dedupedReviewRecommendationsCount: dedupe.reviewRecommendations.length,
      removedDuplicatesCount: Math.max(0, rawRecommendations.length - dedupe.reviewRecommendations.length - dedupe.conflictBlockedCount),
      conflictBlockedCount: dedupe.conflictBlockedCount,
      recommendationsByMarket: countBy(rawRecommendations, (row) => row.market),
      recommendationsBySide: countBy(rawRecommendations, (row) => row.side),
      recommendationsByVendor: countBy(rawRecommendations, (row) => row.vendor),
      recommendationsByLine: countBy(rawRecommendations, (row) => `${row.market}:${row.line}`),
      recommendationsByPlayer: countBy(rawRecommendations, (row) => row.bdlPlayerId ?? row.playerName),
      recommendationsPerGame: countBy(rawRecommendations, (row) => row.bdlGameId ?? "unknown"),
      maxRecommendationsPerPlayer: maxCount(countBy(rawRecommendations, (row) => row.bdlPlayerId ?? row.playerName)),
      maxRecommendationsPerGame: maxCount(countBy(rawRecommendations, (row) => row.bdlGameId ?? "unknown")),
      averageEv: nullableRound(avg(evs)),
      medianEv: nullableRound(median(evs)),
      maxEv: nullableRound(maxVal(evs)),
      averageEdge: nullableRound(avg(edges)),
      medianEdge: nullableRound(median(edges)),
      maxEdge: nullableRound(maxVal(edges)),
      oddsRange: range(odds),
      linesRange: range(lines),
      duplicatePlayerMarketLineAcrossVendors: dedupe.duplicateGroups.length,
      conflictingRecommendationsOnSamePlayerMarketLine: dedupe.conflictGroups.length,
      samePlayerOverUnderConflicts: countSamePlayerOverUnderConflicts(rawRecommendations),
      samePlayerMultipleLineConflicts: countSamePlayerMultipleLineConflicts(rawRecommendations),
      unusuallyHighEvCount: args.candidates.filter((row) => row.sanityFlags.includes("UNUSUALLY_HIGH_EV")).length,
      negativeNoVigAnomalies: args.candidates.filter((row) => row.sanityFlags.includes("NO_VIG_SUM_ANOMALY")).length,
      staleUpdatedAtAnomalies: args.candidates.filter((row) => row.sanityFlags.includes("STALE_BDL_ODDS")).length,
      missingUpdatedAtAnomalies: args.candidates.filter((row) => row.sanityFlags.includes("MISSING_UPDATED_AT")).length,
      modelProbabilityRange: rangeWithMedian(modelProbs),
      noVigMarketProbabilityRange: rangeWithMedian(marketProbs),
      edgeRange: rangeWithMedian(edges),
      evRange: rangeWithMedian(evs),
      probabilityByMarket: probabilityByMarket(rawRecommendations),
      modelProbabilityBelow050Recommendations: rawRecommendations.filter((row) => row.modelProbability < 0.5).length,
      impossibleProbabilityCount,
      extremeModelProbabilityOver075: rawRecommendations.filter((row) => row.modelProbability > 0.75).length,
      oddsParsingOutlierRecommendations,
      clusteredProbabilityValues: clusteredProbabilityValues(rawRecommendations),
      capScenarioCounts: capScenarioCounts(dedupe.reviewRecommendations),
      sanityFlags,
    },
  };
}

function dedupeReviewRecommendations(raw: BdlScoringCandidateTrace[]): {
  reviewRecommendations: ReviewRecommendation[];
  duplicateGroups: BdlRecommendationSanityAudit["duplicateGroups"];
  conflictGroups: BdlRecommendationSanityAudit["conflictGroups"];
  conflictBlockedCount: number;
} {
  const sideLineGroups = new Map<string, BdlScoringCandidateTrace[]>();
  const conflictGroups: BdlRecommendationSanityAudit["conflictGroups"] = [];
  for (const row of raw) {
    const key = [row.bdlGameId, row.bdlPlayerId, row.market, row.line].join("|");
    const group = sideLineGroups.get(key) ?? [];
    group.push(row);
    sideLineGroups.set(key, group);
  }
  const conflictKeys = new Set<string>();
  let conflictBlockedCount = 0;
  for (const [key, rows] of sideLineGroups) {
    const sides = sortedUniqueStrings(rows.map((row) => row.side));
    if (sides.length > 1) {
      conflictGroups.push({ key, sides, count: rows.length });
      conflictKeys.add(key);
      conflictBlockedCount += rows.length;
    }
  }

  const bestByBet = new Map<string, BdlScoringCandidateTrace>();
  const duplicateGroups: BdlRecommendationSanityAudit["duplicateGroups"] = [];
  for (const row of raw) {
    const conflictKey = [row.bdlGameId, row.bdlPlayerId, row.market, row.line].join("|");
    if (conflictKeys.has(conflictKey)) continue;
    const key = [row.bdlGameId, row.bdlPlayerId, row.market, row.side, row.line].join("|");
    const current = bestByBet.get(key);
    if (!current || (row.expectedValue ?? -Infinity) > (current.expectedValue ?? -Infinity)) bestByBet.set(key, row);
  }
  const grouped = new Map<string, BdlScoringCandidateTrace[]>();
  for (const row of raw) {
    const key = [row.bdlGameId, row.bdlPlayerId, row.market, row.side, row.line].join("|");
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  for (const [key, rows] of grouped) {
    if (rows.length <= 1 || conflictKeys.has([rows[0]?.bdlGameId, rows[0]?.bdlPlayerId, rows[0]?.market, rows[0]?.line].join("|"))) continue;
    const kept = bestByBet.get(key);
    duplicateGroups.push({
      key,
      count: rows.length,
      keptVendor: kept?.vendor ?? "unknown",
      removedVendors: rows.filter((row) => row !== kept).map((row) => row.vendor).sort(),
    });
  }
  const reviewRecommendations = [...bestByBet.values()]
    .sort(compareRecommendationQuality)
    .map((row, index) => ({ ...row, reviewRank: index + 1 }));
  return { reviewRecommendations, duplicateGroups, conflictGroups, conflictBlockedCount };
}

async function writeBdlRecommendationSanityAudit(audit: BdlRecommendationSanityAudit): Promise<{ outputPath: string; audit: BdlRecommendationSanityAudit }> {
  const outputDir = propsReportDirectory();
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${audit.date}-bdl-recommendation-sanity-audit.json`);
  await writeFile(outputPath, JSON.stringify(audit, null, 2));
  return { outputPath, audit };
}

function compareRecommendationQuality(a: BdlScoringCandidateTrace, b: BdlScoringCandidateTrace): number {
  return (b.expectedValue ?? -Infinity) - (a.expectedValue ?? -Infinity)
    || (b.edge ?? -Infinity) - (a.edge ?? -Infinity)
    || b.modelProbability - a.modelProbability;
}

function capScenarioCounts(rows: ReviewRecommendation[]): BdlRecommendationSanityAudit["summary"]["capScenarioCounts"] {
  return {
    max25: Math.min(25, rows.length),
    max1PerPlayerMarket: capRows(rows, { maxPerPlayerMarket: 1 }).length,
    max2PerGame: capRows(rows, { maxPerGame: 2 }).length,
    max1PerPlayer: capRows(rows, { maxPerPlayer: 1 }).length,
    minEv5Edge35: rows.filter((row) => (row.expectedValue ?? -Infinity) >= 0.05 && (row.edge ?? -Infinity) >= 0.035).length,
    minEv75: rows.filter((row) => (row.expectedValue ?? -Infinity) >= 0.075).length,
    minEdge5: rows.filter((row) => (row.edge ?? -Infinity) >= 0.05).length,
    combinedConservative: capRows(rows.filter((row) => (row.expectedValue ?? -Infinity) >= 0.05 && (row.edge ?? -Infinity) >= 0.035), {
      limit: 25,
      maxPerPlayerMarket: 1,
      maxPerGame: 2,
      maxPerPlayer: 1,
    }).length,
  };
}

function capRows(rows: ReviewRecommendation[], caps: { limit?: number; maxPerPlayerMarket?: number; maxPerGame?: number; maxPerPlayer?: number }): ReviewRecommendation[] {
  const out: ReviewRecommendation[] = [];
  const byPlayerMarket: Record<string, number> = {};
  const byGame: Record<string, number> = {};
  const byPlayer: Record<string, number> = {};
  for (const row of rows) {
    const player = row.bdlPlayerId ?? row.playerName;
    const game = row.bdlGameId ?? "unknown";
    const playerMarket = `${player}|${row.market}`;
    if (caps.limit && out.length >= caps.limit) break;
    if (caps.maxPerPlayerMarket && (byPlayerMarket[playerMarket] ?? 0) >= caps.maxPerPlayerMarket) continue;
    if (caps.maxPerGame && (byGame[game] ?? 0) >= caps.maxPerGame) continue;
    if (caps.maxPerPlayer && (byPlayer[player] ?? 0) >= caps.maxPerPlayer) continue;
    out.push(row);
    inc(byPlayerMarket, playerMarket);
    inc(byGame, game);
    inc(byPlayer, player);
  }
  return out;
}

function emptyRealScored(date: string): MlbPropBacktestResult {
  return {
    name: `real_paper_${date}`,
    marketKeys: allMlbPropMarketDefinitions().map((market) => market.marketKey),
    bets: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    unitsWon: 0,
    roi: 0,
    avgEv: 0,
    avgEdge: 0,
    recommendations: [],
  };
}

function buildFirstPaperRunScoredSet(scored: MlbPropBacktestResult): MlbPropBacktestResult {
  const recommended = scored.recommendations
    .filter((row) => row.recommendation.status === "recommended")
    .filter((row) => row.marketKey === "pitcher_strikeouts" || row.marketKey === "pitcher_outs")
    .filter((row) => !row.recommendation.reasonCodes.some((code) => [
      "LOW_DATA_CONFIDENCE",
      "STALE_ODDS",
      "STALE_BDL_ODDS",
      "MISSING_UPDATED_AT",
      "NO_VIG_SUM_ANOMALY",
      "SIDE_ODDS_MISMATCH",
      "LINE_MISMATCH",
      "CONFLICTING_SIDE_RECOMMENDATION",
      "UNUSUALLY_HIGH_EV",
    ].includes(code)));
  const conflictKeys = new Set<string>();
  const byPlayerMarketLine = new Map<string, Set<string>>();
  for (const row of recommended) {
    const key = `${row.gameId}|${row.playerId}|${row.marketKey}|${row.recommendation.line}`;
    const sides = byPlayerMarketLine.get(key) ?? new Set<string>();
    sides.add(row.recommendation.side);
    byPlayerMarketLine.set(key, sides);
  }
  for (const [key, sides] of byPlayerMarketLine) {
    if (sides.size > 1) conflictKeys.add(key);
  }

  const bestByBet = new Map<string, MlbPropBacktestResult["recommendations"][number]>();
  for (const row of recommended) {
    const conflictKey = `${row.gameId}|${row.playerId}|${row.marketKey}|${row.recommendation.line}`;
    if (conflictKeys.has(conflictKey)) continue;
    const key = `${row.gameId}|${row.playerId}|${row.marketKey}|${row.recommendation.side}|${row.recommendation.line}`;
    const current = bestByBet.get(key);
    if (!current || (row.recommendation.expectedValue ?? -Infinity) > (current.recommendation.expectedValue ?? -Infinity)) {
      bestByBet.set(key, row);
    }
  }

  const ranked = [...bestByBet.values()].sort((a, b) =>
    (b.recommendation.expectedValue ?? -Infinity) - (a.recommendation.expectedValue ?? -Infinity)
    || (b.recommendation.edge ?? -Infinity) - (a.recommendation.edge ?? -Infinity)
    || b.recommendation.modelProbability - a.recommendation.modelProbability);
  const capped: typeof ranked = [];
  const perPlayer: Record<string, number> = {};
  const perPlayerMarket: Record<string, number> = {};
  const perGame: Record<string, number> = {};
  for (const row of ranked) {
    if (capped.length >= 25) break;
    const playerMarket = `${row.playerId}|${row.marketKey}`;
    if ((perPlayer[row.playerId] ?? 0) >= 1) continue;
    if ((perPlayerMarket[playerMarket] ?? 0) >= 1) continue;
    if ((perGame[row.gameId] ?? 0) >= 2) continue;
    capped.push(row);
    inc(perPlayer, row.playerId);
    inc(perPlayerMarket, playerMarket);
    inc(perGame, row.gameId);
  }

  return {
    ...scored,
    name: `${scored.name}_first_paper_capped`,
    bets: capped.length,
    avgEv: average(capped.map((row) => row.recommendation.expectedValue ?? 0)),
    avgEdge: average(capped.map((row) => row.recommendation.edge ?? 0)),
    recommendations: capped,
  };
}

function countSamePlayerOverUnderConflicts(rows: BdlScoringCandidateTrace[]): number {
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = `${row.bdlPlayerId ?? row.playerName}|${row.market}`;
    const sides = grouped.get(key) ?? new Set<string>();
    sides.add(row.side);
    grouped.set(key, sides);
  }
  return [...grouped.values()].filter((sides) => sides.size > 1).length;
}

function countSamePlayerMultipleLineConflicts(rows: BdlScoringCandidateTrace[]): number {
  const grouped = new Map<string, Set<number>>();
  for (const row of rows) {
    const key = `${row.bdlPlayerId ?? row.playerName}|${row.market}|${row.side}`;
    const lines = grouped.get(key) ?? new Set<number>();
    lines.add(row.line);
    grouped.set(key, lines);
  }
  return [...grouped.values()].filter((lines) => lines.size > 1).length;
}

function modelDisagreementReason(args: { baselineSide: "over" | "under"; newSide: "over" | "under"; diff: number; warnings: string[] }): string {
  if (args.baselineSide !== args.newSide) return "side_changed_by_distribution_model";
  if (args.diff <= -0.03) return "new_model_lower_or_blocked_by_uncertainty";
  if (args.diff >= 0.03) return "new_model_higher_after_verified_opportunity";
  if (args.warnings.includes("recent_logs_unavailable_non_blocking")) return "season_baseline_no_recent_logs";
  return "models_aligned";
}

function confidenceBucket(value: number): "high" | "medium" | "low" {
  if (value >= 0.9) return "high";
  if (value >= 0.75) return "medium";
  return "low";
}

function probabilityBuckets(values: number[]): Record<string, number> {
  const out: Record<string, number> = {
    "50-52.5%": 0,
    "52.5-55%": 0,
    "55-57.5%": 0,
    "57.5-60%": 0,
    "60-65%": 0,
    "65%+": 0,
  };
  for (const value of values) {
    if (value < 0.525) out["50-52.5%"]++;
    else if (value < 0.55) out["52.5-55%"]++;
    else if (value < 0.575) out["55-57.5%"]++;
    else if (value < 0.6) out["57.5-60%"]++;
    else if (value < 0.65) out["60-65%"]++;
    else out["65%+"]++;
  }
  return out;
}

function valueRange(values: number[]): { min: number | null; median: number | null; max: number | null } {
  return rangeWithMedian(values);
}

function probabilityByMarket(rows: BdlScoringCandidateTrace[]): Record<string, { min: number | null; median: number | null; max: number | null }> {
  const out: Record<string, { min: number | null; median: number | null; max: number | null }> = {};
  for (const market of sortedUniqueStrings(rows.map((row) => row.market))) {
    out[market] = rangeWithMedian(rows.filter((row) => row.market === market).map((row) => row.modelProbability));
  }
  return out;
}

function clusteredProbabilityValues(rows: BdlScoringCandidateTrace[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) inc(counts, row.modelProbability.toFixed(3));
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => count >= 10).sort((a, b) => b[1] - a[1]));
}

function countBy<T extends string>(rows: T[]): Record<string, number>;
function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number>;
function countBy<T>(rows: T[], key?: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) inc(out, key ? key(row) : String(row));
  return out;
}

function maxCount(counts: Record<string, number>): number {
  return Math.max(0, ...Object.values(counts));
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function maxVal(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

function range(values: number[]): { min: number | null; max: number | null } {
  return {
    min: nullableRound(values.length ? Math.min(...values) : null),
    max: nullableRound(values.length ? Math.max(...values) : null),
  };
}

function rangeWithMedian(values: number[]): { min: number | null; median: number | null; max: number | null } {
  return {
    min: nullableRound(values.length ? Math.min(...values) : null),
    median: nullableRound(median(values)),
    max: nullableRound(values.length ? Math.max(...values) : null),
  };
}

function nullableRound(value: number | null): number | null {
  return value === null ? null : round(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sortedUniqueReasonCodes(values: PropReasonCode[]): PropReasonCode[] {
  return [...new Set(values)].sort() as PropReasonCode[];
}

function sortedUniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function numericAvailability(feature: PropFeatureSnapshot, key: string): number | null {
  const value = feature.dataAvailability[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function modelForMarket(marketKey: MlbPropMarketKey) {
  return modelForMlbPropMarket(marketKey);
}

function inferredOddsProvider(odds: PropOddsSnapshot[]): string {
  const providers = [...new Set(odds.map((row) => row.provider).filter(Boolean))].sort();
  if (providers.length === 0) return "none";
  if (providers.length === 1) return providers[0]!;
  return providers.join("+");
}

function probablePitcherName(row: MlbProbablePitcher): string {
  const raw = rawObj(row.rawPayload);
  const probable = raw.probablePitcher;
  if (typeof probable === "object" && probable !== null) {
    const obj = probable as Record<string, unknown>;
    return stringValue(obj.fullName) ?? stringValue(obj.name) ?? "";
  }
  return "";
}

function latest(rows: ResolvedPropRow[]): ResolvedPropRow {
  return [...rows].sort((a, b) => b.odds.asOfTimestamp.localeCompare(a.odds.asOfTimestamp))[0]!;
}

function rawObj(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function inc(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function propsReportDirectory(): string {
  return process.env.VERCEL
    ? path.join(tmpdir(), "oddsphere", "mlb-props", "reports")
    : path.join(process.cwd(), "tmp/mlb-props/reports");
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
