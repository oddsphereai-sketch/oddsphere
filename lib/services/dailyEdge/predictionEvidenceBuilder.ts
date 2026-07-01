import type {
  AiAuditorCompactMarketPayload,
  AiAuditorPayloadEstimate,
} from "@/lib/services/aiAuditor/costPreview";
import type { SharpAnalystMarket } from "@/lib/services/aiAuditor/sharpAnalystMemory";
import {
  scanPromotionCandidate,
  type PromotionCandidateScan,
} from "@/lib/services/aiAuditor/promotionCandidateScanner";
import type { RehydratedLockedMarketPayload } from "@/lib/services/aiAuditor/rehydratedLockedPayload";
import {
  dailyEdgeMarketCapabilities,
  type DailyEdgeDecisionMarketKey,
} from "@/lib/services/dailyEdge/dailyEdgeSportCapabilities";

export type DailyEdgeEvidenceMarketType = "ML" | "TOTAL" | "FI";

export type SourceAgreementLabel =
  | "both_align"
  | "consensus_supports_sharp_opposes"
  | "sharp_supports_consensus_opposes"
  | "both_oppose"
  | "consensus_only"
  | "sharp_only"
  | "insufficient_market_source"
  | "not_required";

export type PredictionEvidenceObject = {
  schemaVersion: "daily-edge-prediction-evidence-v1";
  evidenceSource: {
    kind: "current_live" | "locked_snapshot";
    asOfTimestamp: string | null;
    lockedAt: string | null;
    note: string | null;
  };
  identity: {
    sport: string;
    slateDate: string;
    gameId: string;
    externalId: number;
    awayTeam: string;
    homeTeam: string;
    gameTime: string;
    marketType: DailyEdgeEvidenceMarketType;
    normalizedMarket: SharpAnalystMarket;
    pick: string | null;
    lineValue: number | null;
    priceAmerican: number | null;
    originalPlayGrade: string | null;
    originalRecommendationConfidence: number | null;
  };
  currentReaderState: {
    displayedMarketRead: AiAuditorCompactMarketPayload["marketRead"];
    supportingEvidence: {
      verdict: string | null;
      quickRead: string | null;
      consensusSplitsDisplayed: boolean;
      sharpBookSplitsDisplayed: boolean;
      sharpBookSignalDisplayed: boolean;
    };
    riskNote: string | null;
    providerNamesHidden: true;
  };
  modelStatsEvidence: {
    modelProbability: number | null;
    marketImpliedProbability: number | null;
    edge: number | null;
    projectedScore: { away: number; home: number } | null;
    projectedTotal: number | null;
    deterministicScores: AiAuditorCompactMarketPayload["deterministicPreScore"];
    teamStatFactors: string[];
    pitcherStarterContext: {
      available: boolean | null;
      summary: string | null;
    };
    bullpenTeamOffenseWeatherParkContext: string[];
    fiStarterTopOrderContext: AiAuditorCompactMarketPayload["fiContext"] & {
      consensusSharpRequired: boolean;
    };
    modelInputWarnings: string[];
    projectionWarnings: string[];
    dataQualityWarnings: string[];
    edgeRecovered?: boolean;
    edgeRecoverySource?: "model_minus_market_implied" | "prediction_records" | null;
    edgeRecoveryConfidence?: "high" | "medium" | "low" | null;
    edgeMissingReason?: string | null;
  };
  marketEvidence: {
    consensusSplits: unknown;
    sharpBookSplits: unknown;
    sharpBookSignal: unknown;
    consensusSplitsAvailable: boolean;
    sharpBookSplitsAvailable: boolean;
    sharpBookSignalAvailable: boolean;
    sourceAgreement: SourceAgreementLabel;
    sourceConflict: boolean;
    sourceMissingReason: string | null;
    sourceMissingMateriality: "low" | "medium" | "high";
    lineMovement: AiAuditorCompactMarketPayload["lineMovement"] & {
      movementTowardAgainstPick: string | null;
    };
    marketReadRaw: AiAuditorCompactMarketPayload["marketRead"];
    deterministicMarketRead: string | null;
    reasonCodes: string[];
  };
  priceValueEvidence: {
    priceAmerican: number | null;
    priceSource: string;
    priceNullReason: string | null;
    marketImpliedProbability: number | null;
    edge: number | null;
    priceQualityScore: number;
    heavyJuiceWarning: boolean;
    plusMoneyValueFlag: boolean;
    priceBecameUnplayable: boolean;
    priceRecovered?: boolean;
    priceRecoverySource?: "prediction_records" | "snapshot_json" | "line_history" | "current_source" | null;
    priceRecoveryConfidence?: "high" | "medium" | "low" | null;
    priceDisplayAllowed?: boolean;
  };
  internalGradeDimensions: {
    winCaseStrengthScore: number;
    bettingValueStrengthScore: number;
    marketContextScore: number;
    priceQualityScore: number;
    modelStatSupportScore: number;
    dataQualityScore: number;
    riskPenaltyScore: number;
    readQualityScore: number;
  };
  historicalCalibrationEvidence: {
    promotionScanner: PromotionCandidateScan;
    knownRulesAndCautions: string[];
  };
  guardrails: {
    noLiveChanges: true;
    noMemberFacingChanges: true;
    noPickFlips: true;
    noProbabilityChanges: true;
    noProjectionChanges: true;
    noPostgameResultsIncluded: true;
    originalPlayGradeIsContextOnly: true;
  };
};

export function marketTypeForEvidence(market: SharpAnalystMarket): DailyEdgeEvidenceMarketType {
  if (market === "moneyline") return "ML";
  if (market === "total") return "TOTAL";
  return "FI";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSplitRows(value: unknown): boolean {
  if (!isObjectRecord(value)) return false;
  const rows = value.rows;
  return Array.isArray(rows) && rows.length > 0;
}

function hasDirectionalSignal(value: unknown): boolean {
  if (!isObjectRecord(value)) return false;
  if (typeof value.summary === "string" && value.summary.trim() !== "") return true;
  if (typeof value.label === "string" && value.label.includes("Signal")) return true;
  return false;
}

function lowerText(value: unknown): string {
  return JSON.stringify(value ?? "").toLowerCase();
}

function sourceSupportsPick(value: unknown): boolean {
  const text = lowerText(value);
  return text.includes("support") || text.includes("aligned") || text.includes("with pick");
}

function sourceOpposesPick(value: unknown): boolean {
  const text = lowerText(value);
  return text.includes("resistance") || text.includes("against") || text.includes("opposes");
}

function decisionKeyForEvidenceMarket(market: AiAuditorCompactMarketPayload["market"]): DailyEdgeDecisionMarketKey {
  if (market === "moneyline") return "moneyline";
  if (market === "total") return "total";
  return "firstInning";
}

function sourceAgreementLabel(sport: string, market: AiAuditorCompactMarketPayload): SourceAgreementLabel {
  const caps = dailyEdgeMarketCapabilities(sport, decisionKeyForEvidenceMarket(market.market));
  const consensusAvailable = Boolean(market.consensusSplits);
  const sharpAvailable = Boolean(market.sharpBookSplits);
  if (!caps.expectsConsensusSplits && !caps.expectsSharpBookContext && !consensusAvailable && !sharpAvailable) return "not_required";
  if (!consensusAvailable && !sharpAvailable) return "insufficient_market_source";
  if (consensusAvailable && !sharpAvailable) return "consensus_only";
  if (!consensusAvailable && sharpAvailable) return "sharp_only";

  const consensusSupports = sourceSupportsPick(market.consensusSplits);
  const consensusOpposes = sourceOpposesPick(market.consensusSplits);
  const sharpSupports = sourceSupportsPick(market.sharpBookSplits);
  const sharpOpposes = sourceOpposesPick(market.sharpBookSplits);
  if (consensusSupports && sharpSupports) return "both_align";
  if (consensusOpposes && sharpOpposes) return "both_oppose";
  if (consensusSupports && sharpOpposes) return "consensus_supports_sharp_opposes";
  if (sharpSupports && consensusOpposes) return "sharp_supports_consensus_opposes";
  return market.sourceConflict ? "consensus_supports_sharp_opposes" : "both_align";
}

function sourceMissingReason(sport: string, market: AiAuditorCompactMarketPayload): string | null {
  const caps = dailyEdgeMarketCapabilities(sport, decisionKeyForEvidenceMarket(market.market));
  if (!caps.expectsConsensusSplits && !caps.expectsSharpBookContext && !market.consensusSplits && !market.sharpBookSplits) {
    if (caps.isFirstInning) {
      return "FI consensus/sharp split bars are not expected in current coverage.";
    }
    if (caps.isSoccerLike) {
      return "World Cup split bars are not expected in current coverage.";
    }
    return "Consensus/sharp split bars are not expected for this market.";
  }
  if (caps.isFirstInning && !market.consensusSplits && !market.sharpBookSplits) {
    return "FI consensus/sharp split bars are not expected in current coverage.";
  }
  if (market.consensusSplits && market.sharpBookSplits) return null;
  if (market.consensusSplits && !caps.expectsSharpBookContext) return null;
  if (!market.consensusSplits && !market.sharpBookSplits) return "Consensus and sharp-book market sources are unavailable.";
  if (!market.consensusSplits) return "Consensus split source is unavailable.";
  return "Sharp-book split/signal source is unavailable.";
}

function sourceMissingMateriality(sport: string, market: AiAuditorCompactMarketPayload): "low" | "medium" | "high" {
  const caps = dailyEdgeMarketCapabilities(sport, decisionKeyForEvidenceMarket(market.market));
  if (!caps.expectsConsensusSplits && !caps.expectsSharpBookContext && !market.consensusSplits && !market.sharpBookSplits) return "low";
  if (caps.isFirstInning && !market.consensusSplits && !market.sharpBookSplits) return "low";
  if (market.consensusSplits && !caps.expectsSharpBookContext) return "low";
  if (!market.consensusSplits || !market.sharpBookSplits) return "medium";
  return "low";
}

function projectedTotal(score: { away: number; home: number } | null): number | null {
  return score ? +(score.away + score.home).toFixed(2) : null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, +value.toFixed(1)));
}

function winCaseScore(market: AiAuditorCompactMarketPayload): number {
  const probability = market.modelProbabilityPct ?? 50;
  const edge = Math.max(0, market.modelMarketGapPct ?? 0);
  return clampScore((probability - 45) * 1.5 + edge * 3);
}

function bettingValueScore(market: AiAuditorCompactMarketPayload): number {
  const edge = Math.max(0, market.modelMarketGapPct ?? 0);
  const price = market.displayPriceAmerican;
  const plusMoneyBonus = price !== null && price > 0 ? 10 : 0;
  return clampScore(market.deterministicPreScore.priceQualityScore * 0.45 + edge * 5 + plusMoneyBonus);
}

function riskPenaltyScore(market: AiAuditorCompactMarketPayload): number {
  const dataPenalty = Math.max(0, 100 - market.deterministicPreScore.dataQualityScore);
  const resistancePenalty = market.deterministicPreScore.marketResistanceScore;
  const pricePenalty = market.displayPriceAmerican !== null && market.displayPriceAmerican <= -180 ? 20 : 0;
  return clampScore(dataPenalty * 0.35 + resistancePenalty * 0.35 + pricePenalty);
}

function readQualityScore(market: AiAuditorCompactMarketPayload): number {
  if (!market.marketRead) return 25;
  if (market.market === "first_inning" && market.marketRead.status === "no_clear_signal") return 60;
  if (market.marketRead.status === "aligned" || market.marketRead.status === "consensus_support") return 80;
  if (market.marketRead.status === "mixed") return 60;
  if (market.marketRead.status === "resistance" || market.marketRead.status === "consensus_resistance") return 45;
  if (market.marketRead.status === "no_clear_signal") return 55;
  return 30;
}

function readQualityScoreFromStatus(status: string | null): number {
  if (status === "historical_market_read_not_persisted") return 50;
  if (status === "aligned" || status === "consensus_support") return 80;
  if (status === "mixed" || status === "no_clear_signal") return 60;
  if (status === "resistance" || status === "consensus_resistance") return 45;
  return 50;
}

function knownRules(market: AiAuditorCompactMarketPayload): string[] {
  const rules = [
    "Original Play Grade is context only; do not anchor on it.",
    "Best Angle should require strong edge, playable price, clean enough data, and no unresolved contradiction.",
    "Watchlist can be undergraded when price, edge, and market context support actionability.",
  ];
  if (market.market === "moneyline") {
    rules.push("ML heavy favorites require stronger edge and price discipline.");
    rules.push("ML underdogs can be actionable when plus-money price and model edge are real.");
  }
  if (market.market === "total") {
    rules.push("Totals require projection-versus-line and Over/Under direction support.");
    rules.push("Mixed market does not automatically block a Lean.");
  }
  if (market.market === "first_inning") {
    rules.push("FI missing consensus/sharp split bars are expected and non-material by themselves.");
    rules.push("FI grades should rely on FI model edge, price, starter/top-order context, and FI movement where available.");
  }
  return rules;
}

export function buildPredictionEvidenceObject(args: {
  card: AiAuditorPayloadEstimate;
  market: AiAuditorCompactMarketPayload;
}): PredictionEvidenceObject {
  const { card, market } = args;
  const caps = dailyEdgeMarketCapabilities(card.sport, decisionKeyForEvidenceMarket(market.market));
  const splitRows = hasSplitRows(market.sharpBookSplits);
  const signalOnly = !splitRows && hasDirectionalSignal(market.sharpBookSplits);
  const consensusAvailable = caps.expectsConsensusSplits && Boolean(market.consensusSplits);
  const sharpSplitsAvailable = caps.expectsSharpBookContext && splitRows;
  const sharpSignalAvailable = caps.expectsSharpBookContext && signalOnly;
  return {
    schemaVersion: "daily-edge-prediction-evidence-v1",
    evidenceSource: {
      kind: "current_live",
      asOfTimestamp: card.payload.asOfTimestamp,
      lockedAt: card.payload.lockedAt,
      note: card.payload.lockState === "locked"
        ? "Current DTO path; locked snapshot override was not available for this market."
        : "Current/live pre-lock DTO path.",
    },
    identity: {
      sport: card.sport,
      slateDate: card.date,
      gameId: card.gameId,
      externalId: card.externalId,
      awayTeam: card.payload.teams.away,
      homeTeam: card.payload.teams.home,
      gameTime: card.payload.gameTime,
      marketType: marketTypeForEvidence(market.market),
      normalizedMarket: market.market,
      pick: market.pick,
      lineValue: market.lineValue,
      priceAmerican: market.displayPriceAmerican,
      originalPlayGrade: market.playGrade,
      originalRecommendationConfidence: null,
    },
    currentReaderState: {
      displayedMarketRead: market.marketRead,
      supportingEvidence: {
        verdict: market.verdict,
        quickRead: market.quickRead,
        consensusSplitsDisplayed: Boolean(market.consensusSplits),
        sharpBookSplitsDisplayed: splitRows,
        sharpBookSignalDisplayed: signalOnly,
      },
      riskNote: market.dataQuality.reviewActionSummary,
      providerNamesHidden: true,
    },
    modelStatsEvidence: {
      modelProbability: market.modelProbabilityPct,
      marketImpliedProbability: market.marketProbabilityPct,
      edge: market.modelMarketGapPct,
      projectedScore: card.payload.projectedScore,
      projectedTotal: projectedTotal(card.payload.projectedScore),
      deterministicScores: market.deterministicPreScore,
      teamStatFactors: market.deterministicPreScore.notes,
      pitcherStarterContext: {
        available: market.market === "first_inning" ? market.fiContext.expectedRunsAvailable : null,
        summary: market.market === "first_inning" ? market.fiContext.fiMarketSignalNullReason : null,
      },
      bullpenTeamOffenseWeatherParkContext: market.dataQuality.reviewFlags,
      fiStarterTopOrderContext: {
        ...market.fiContext,
        consensusSharpRequired: false,
      },
      modelInputWarnings: market.dataQuality.reviewFlags,
      projectionWarnings: [],
      dataQualityWarnings: market.dataQuality.reviewFlags,
      edgeRecovered: false,
      edgeRecoverySource: null,
      edgeRecoveryConfidence: null,
      edgeMissingReason: market.modelMarketGapPct === null ? "edge_unavailable_from_current_payload" : null,
    },
    marketEvidence: {
      consensusSplits: consensusAvailable ? market.consensusSplits : null,
      sharpBookSplits: sharpSplitsAvailable ? market.sharpBookSplits : null,
      sharpBookSignal: sharpSignalAvailable ? market.sharpBookSplits : null,
      consensusSplitsAvailable: consensusAvailable,
      sharpBookSplitsAvailable: sharpSplitsAvailable,
      sharpBookSignalAvailable: sharpSignalAvailable,
      sourceAgreement: sourceAgreementLabel(card.sport, market),
      sourceConflict: caps.isFirstInning || (!caps.expectsConsensusSplits && !caps.expectsSharpBookContext) ? false : Boolean(market.sourceConflict),
      sourceMissingReason: sourceMissingReason(card.sport, market),
      sourceMissingMateriality: sourceMissingMateriality(card.sport, market),
      lineMovement: {
        ...market.lineMovement,
        movementTowardAgainstPick: market.lineMovement.directionRelativeToPick,
      },
      marketReadRaw: market.marketRead,
      deterministicMarketRead: market.marketRead?.status ?? null,
      reasonCodes: market.reasonCodes,
    },
    priceValueEvidence: {
      priceAmerican: market.displayPriceAmerican,
      priceSource: market.priceSource,
      priceNullReason: market.priceNullReason,
      marketImpliedProbability: market.marketProbabilityPct,
      edge: market.modelMarketGapPct,
      priceQualityScore: market.deterministicPreScore.priceQualityScore,
      heavyJuiceWarning: market.displayPriceAmerican !== null && market.displayPriceAmerican <= -150,
      plusMoneyValueFlag: market.displayPriceAmerican !== null && market.displayPriceAmerican > 0 && (market.modelMarketGapPct ?? 0) > 0,
      priceBecameUnplayable: Boolean(market.priceNullReason) || market.deterministicPreScore.priceQualityScore < 20,
      priceRecovered: false,
      priceRecoverySource: null,
      priceRecoveryConfidence: null,
      priceDisplayAllowed: market.displayPriceAmerican !== null,
    },
    internalGradeDimensions: {
      winCaseStrengthScore: winCaseScore(market),
      bettingValueStrengthScore: bettingValueScore(market),
      marketContextScore: market.deterministicPreScore.marketAlignmentScore,
      priceQualityScore: market.deterministicPreScore.priceQualityScore,
      modelStatSupportScore: market.deterministicPreScore.modelEdgeScore,
      dataQualityScore: market.deterministicPreScore.dataQualityScore,
      riskPenaltyScore: riskPenaltyScore(market),
      readQualityScore: readQualityScore(market),
    },
    historicalCalibrationEvidence: {
      promotionScanner: scanPromotionCandidate(market),
      knownRulesAndCautions: knownRules(market),
    },
    guardrails: {
      noLiveChanges: true,
      noMemberFacingChanges: true,
      noPickFlips: true,
      noProbabilityChanges: true,
      noProjectionChanges: true,
      noPostgameResultsIncluded: true,
      originalPlayGradeIsContextOnly: true,
    },
  };
}

function splitMatchup(matchup: string): { away: string; home: string } {
  const parts = matchup.includes("@")
    ? matchup.split("@").map((part) => part.trim())
    : matchup.split(" @ ").map((part) => part.trim());
  return { away: parts[0] ?? "Away", home: parts[1] ?? "Home" };
}

function lockedMarketReadForEvidence(read: RehydratedLockedMarketPayload["marketRead"]): AiAuditorCompactMarketPayload["marketRead"] {
  if (read.status === "historical_market_read_not_persisted") {
    return {
      status: "no_clear_signal",
      label: "No Clear Signal",
      copy: read.copy,
    };
  }
  return {
    status: read.status,
    label: read.label,
    copy: read.copy,
  };
}

function lockedSourceAgreement(payload: RehydratedLockedMarketPayload): SourceAgreementLabel {
  const caps = dailyEdgeMarketCapabilities(payload.sport, decisionKeyForEvidenceMarket(payload.market));
  if (!caps.expectsConsensusSplits && !caps.expectsSharpBookContext) return "not_required";
  if (caps.isFirstInning) return "not_required";
  if (payload.sourceConflict === true) return "consensus_supports_sharp_opposes";
  if (payload.consensusSplits.available && payload.sharpBookSplitsOrSignal.available) return "both_align";
  if (payload.consensusSplits.available) return "consensus_only";
  if (payload.sharpBookSplitsOrSignal.available) return "sharp_only";
  return "insufficient_market_source";
}

function lockedSourceMissingReason(payload: RehydratedLockedMarketPayload): string | null {
  const caps = dailyEdgeMarketCapabilities(payload.sport, decisionKeyForEvidenceMarket(payload.market));
  if (!caps.expectsConsensusSplits && !caps.expectsSharpBookContext) {
    if (caps.isSoccerLike) return "World Cup split bars are not expected in current coverage.";
    return "Consensus/sharp split bars are not expected for this market.";
  }
  if (caps.isFirstInning) return "FI consensus/sharp split bars are not expected in current coverage.";
  if (payload.consensusSplits.available && (!caps.expectsSharpBookContext || payload.sharpBookSplitsOrSignal.available)) return null;
  if (!payload.consensusSplits.available && !payload.sharpBookSplitsOrSignal.available) return "Consensus and sharp-book market sources were not persisted at lock.";
  if (!payload.consensusSplits.available) return "Consensus split source was not persisted at lock.";
  return "Sharp-book split/signal source was not persisted at lock.";
}

function lockedPriceQualityScore(market: SharpAnalystMarket, price: number | null): number {
  if (price === null || !Number.isFinite(price)) return market === "first_inning" ? 55 : 45;
  if (price > 0) return clampScore(70 + Math.min(20, price / 20));
  const juice = Math.abs(price);
  if (juice <= 115) return 80;
  if (juice <= 135) return 65;
  if (juice <= 155) return 48;
  return 30;
}

function lockedEvidencePriceSource(source: RehydratedLockedMarketPayload["priceSource"]): AiAuditorCompactMarketPayload["priceSource"] {
  if (source === "unavailable") return "unavailable";
  return "locked_snapshot";
}

function lockedModelEdgeScore(edge: number | null, probability: number | null): number {
  const gap = Math.abs(Number(edge ?? 0));
  const prob = Number(probability ?? 0);
  const probBonus = prob >= 60 ? 15 : prob >= 56 ? 8 : prob >= 53 ? 4 : 0;
  return clampScore(Math.min(75, gap * 7.5) + probBonus);
}

function lockedMarketAlignmentScore(status: string | null): number {
  if (status === "aligned" || status === "consensus_support") return 80;
  if (status === "mixed" || status === "no_clear_signal" || status === "historical_market_read_not_persisted") return 55;
  if (status === "resistance" || status === "consensus_resistance") return 35;
  return 50;
}

function lockedMarketResistanceScore(status: string | null, sourceConflict: boolean | null): number {
  if (sourceConflict || status === "mixed") return 40;
  if (status === "resistance" || status === "consensus_resistance") return 25;
  if (status === "aligned" || status === "consensus_support") return 80;
  return 55;
}

function lockedDataQualityScore(payload: RehydratedLockedMarketPayload): number {
  const joined = payload.dataWarnings.join(" ").toLowerCase();
  if (/starter|lineup|injury|reversed|mismatch/.test(joined)) return 30;
  if (/stale|partial|missing/.test(joined)) return 45;
  if (payload.market === "first_inning") return 70;
  if (!payload.sharpBookSplitsOrSignal.available) return 58;
  return 82;
}

function lockedLineMovementScore(payload: RehydratedLockedMarketPayload): number {
  if (!payload.openPriceAmerican || !payload.currentPriceAmerican || !payload.pick) return 50;
  const delta = payload.currentPriceAmerican - payload.openPriceAmerican;
  if (Math.abs(delta) < 8) return 55;
  const pickLooksFavorite = payload.currentPriceAmerican < 0;
  const towardPick = pickLooksFavorite ? delta < 0 : delta > 0;
  return towardPick ? 75 : 35;
}

function lockedHistoricalCohortScore(payload: RehydratedLockedMarketPayload): number {
  if (payload.market === "first_inning" && payload.originalGrade === "Lean") return 88;
  if (payload.market === "total" && payload.originalGrade === "Lean") return 72;
  if (payload.market === "moneyline" && payload.originalGrade === "Lean") return 45;
  if (payload.originalGrade === "Best Angle") return 42;
  if (payload.originalGrade === "Watchlist") return 60;
  if (payload.originalGrade === "Caution") return 45;
  return 50;
}

function lockedScores(payload: RehydratedLockedMarketPayload): AiAuditorCompactMarketPayload["deterministicPreScore"] {
  const modelEdgeScore = lockedModelEdgeScore(payload.edgePct, payload.modelProbabilityPct);
  const priceQualityScore = lockedPriceQualityScore(payload.market, payload.displayPriceAmerican);
  const marketAlignmentScore = lockedMarketAlignmentScore(payload.marketRead.status);
  const marketResistanceScore = lockedMarketResistanceScore(payload.marketRead.status, payload.sourceConflict);
  const dataQualityScore = lockedDataQualityScore(payload);
  const lineMovementScore = lockedLineMovementScore(payload);
  const historicalCohortScore = lockedHistoricalCohortScore(payload);
  const notes = [...payload.dataWarnings];
  if (payload.market === "first_inning") {
    notes.push("FI missing consensus/sharp split bars are expected and non-material by themselves.");
  }
  if (payload.marketRead.status === "historical_market_read_not_persisted") {
    notes.push("Historical canonical Market Read was not persisted; use lock-time price/model/edge/context instead of treating this as live data failure.");
  }
  return {
    modelEdgeScore,
    priceQualityScore,
    marketAlignmentScore,
    marketResistanceScore,
    dataQualityScore,
    lineMovementScore,
    historicalCohortScore,
    finalGradeCandidateScore: clampScore(
      modelEdgeScore * 0.3 +
      priceQualityScore * 0.15 +
      marketAlignmentScore * 0.15 +
      marketResistanceScore * 0.1 +
      dataQualityScore * 0.15 +
      lineMovementScore * 0.05 +
      historicalCohortScore * 0.1,
    ),
    notes,
  };
}

export function buildPredictionEvidenceObjectFromLockedPayload(payload: RehydratedLockedMarketPayload): PredictionEvidenceObject {
  const teams = splitMatchup(payload.matchup);
  const marketRead = lockedMarketReadForEvidence(payload.marketRead);
  const scores = lockedScores(payload);
  const sharpSignalOnly = payload.sharpBookSplitsOrSignal.available && payload.sharpBookSplitsOrSignal.rows.length === 0;
  const caps = dailyEdgeMarketCapabilities(payload.sport, decisionKeyForEvidenceMarket(payload.market));
  const consensusAvailable = caps.expectsConsensusSplits && payload.consensusSplits.available;
  const sharpSplitsAvailable = caps.expectsSharpBookContext && payload.sharpBookSplitsOrSignal.rows.length > 0;
  const sharpSignalAvailable = caps.expectsSharpBookContext && sharpSignalOnly;
  const compactForScanner: AiAuditorCompactMarketPayload = {
    market: payload.market,
    pick: payload.pick,
    playGrade: payload.originalGrade,
    modelProbabilityPct: payload.modelProbabilityPct,
    marketProbabilityPct: payload.marketImpliedProbabilityPct,
    probabilityUnits: "percent_0_100",
    modelMarketGapPct: payload.edgePct,
    priceAmerican: payload.displayPriceAmerican,
    displayPriceAmerican: payload.displayPriceAmerican,
    priceSource: lockedEvidencePriceSource(payload.priceSource),
    priceNullReason: payload.priceNullReason,
    line: payload.lineValue,
    lineValue: payload.lineValue,
    openLineValue: payload.openLineValue,
    currentLineValue: payload.currentLineValue,
    lineValueSource: payload.lineValue !== null ? "market_edge" : "unavailable",
    lineValueNullReason: payload.market === "moneyline" ? "moneyline_has_no_point_line" : payload.lineValue === null ? "historical_locked_line_not_persisted" : null,
    verdict: payload.originalGrade,
    quickRead: null,
    marketRead,
    sourceConflict: payload.sourceConflict,
    reasonCodes: payload.marketRead.reasonCodes,
    consensusSplits: !consensusAvailable
      ? null
      : { label: "Consensus Splits", rows: payload.consensusSplits.rows, source: payload.consensusSplits.source },
    sharpBookSplits: !caps.expectsSharpBookContext || !payload.sharpBookSplitsOrSignal.available
      ? null
      : sharpSignalOnly
        ? { label: "Sharp Book Signal", summary: payload.sharpBookSplitsOrSignal.signal, source: payload.sharpBookSplitsOrSignal.source }
        : { label: "Sharp Book Splits", rows: payload.sharpBookSplitsOrSignal.rows, source: payload.sharpBookSplitsOrSignal.source },
    lineMovement: {
      openAmerican: payload.openPriceAmerican,
      currentAmerican: payload.currentPriceAmerican,
      displayCurrentAmerican: payload.currentPriceAmerican,
      lockedAmerican: payload.lockedPriceAmerican,
      firstTrackedLine: payload.openLineValue,
      currentLine: payload.currentLineValue,
      lastMovePreviousAmerican: payload.openPriceAmerican,
      lastMoveCurrentAmerican: payload.currentPriceAmerican,
      lastMovePreviousLine: payload.openLineValue,
      lastMoveCurrentLine: payload.currentLineValue,
      directionRelativeToPick: payload.lineMovementDirection,
      lastMoveAt: payload.lock.asOfTimestamp,
    },
    dataQuality: {
      held: false,
      marketDataQuality: payload.dataWarnings.length > 0 ? "partial" : "ok",
      reviewFlags: payload.dataWarnings,
      reviewActionSummary: payload.dataWarnings.length > 0 ? payload.dataWarnings.join(", ") : null,
    },
    deterministicPreScore: scores,
    fiContext: {
      isFirstInning: payload.market === "first_inning",
      expectedRunsAvailable: payload.fiContext.marketProbabilityAvailable,
      fiMarketSignalExpected: false,
      fiMarketSignalNullReason: payload.fiContext.note,
    },
  };
  const projected = payload.projectedScore && payload.projectedScore.away !== null && payload.projectedScore.home !== null
    ? { away: payload.projectedScore.away, home: payload.projectedScore.home }
    : null;
  return {
    schemaVersion: "daily-edge-prediction-evidence-v1",
    evidenceSource: {
      kind: "locked_snapshot",
      asOfTimestamp: payload.lock.asOfTimestamp,
      lockedAt: payload.lock.lockedAt,
      note: "Built from prediction_records locked fields and snapshot_json at/pre lock; no postgame fields included.",
    },
    identity: {
      sport: payload.sport,
      slateDate: payload.slateDate,
      gameId: String(payload.gameId),
      externalId: payload.externalId,
      awayTeam: teams.away,
      homeTeam: teams.home,
      gameTime: payload.lock.lockedAt ?? "",
      marketType: marketTypeForEvidence(payload.market),
      normalizedMarket: payload.market,
      pick: payload.pick,
      lineValue: payload.lineValue,
      priceAmerican: payload.displayPriceAmerican,
      originalPlayGrade: payload.originalGrade,
      originalRecommendationConfidence: null,
    },
    currentReaderState: {
      displayedMarketRead: marketRead,
      supportingEvidence: {
        verdict: payload.originalGrade,
        quickRead: null,
        consensusSplitsDisplayed: consensusAvailable,
        sharpBookSplitsDisplayed: sharpSplitsAvailable,
        sharpBookSignalDisplayed: sharpSignalAvailable,
      },
      riskNote: payload.dataWarnings.length > 0 ? payload.dataWarnings.join(", ") : null,
      providerNamesHidden: true,
    },
    modelStatsEvidence: {
      modelProbability: payload.modelProbabilityPct,
      marketImpliedProbability: payload.marketImpliedProbabilityPct,
      edge: payload.edgePct,
      projectedScore: projected,
      projectedTotal: projectedTotal(projected),
      deterministicScores: scores,
      teamStatFactors: scores.notes,
      pitcherStarterContext: {
        available: payload.market === "first_inning" ? payload.fiContext.marketProbabilityAvailable : null,
        summary: payload.fiContext.note,
      },
      bullpenTeamOffenseWeatherParkContext: payload.dataWarnings,
      fiStarterTopOrderContext: {
        isFirstInning: payload.market === "first_inning",
        expectedRunsAvailable: payload.fiContext.marketProbabilityAvailable,
        fiMarketSignalExpected: false,
        fiMarketSignalNullReason: payload.fiContext.note,
        consensusSharpRequired: false,
      },
      modelInputWarnings: payload.dataWarnings,
      projectionWarnings: [],
      dataQualityWarnings: payload.dataWarnings,
      edgeRecovered: false,
      edgeRecoverySource: null,
      edgeRecoveryConfidence: null,
      edgeMissingReason: payload.edgePct === null ? "edge_unavailable_from_locked_payload" : null,
    },
    marketEvidence: {
      consensusSplits: consensusAvailable ? compactForScanner.consensusSplits : null,
      sharpBookSplits: sharpSplitsAvailable ? compactForScanner.sharpBookSplits : null,
      sharpBookSignal: sharpSignalAvailable ? compactForScanner.sharpBookSplits : null,
      consensusSplitsAvailable: consensusAvailable,
      sharpBookSplitsAvailable: sharpSplitsAvailable,
      sharpBookSignalAvailable: sharpSignalAvailable,
      sourceAgreement: lockedSourceAgreement(payload),
      sourceConflict: caps.isFirstInning || (!caps.expectsConsensusSplits && !caps.expectsSharpBookContext) ? false : Boolean(payload.sourceConflict),
      sourceMissingReason: lockedSourceMissingReason(payload),
      sourceMissingMateriality:
        (!caps.expectsConsensusSplits && !caps.expectsSharpBookContext) ||
        caps.isFirstInning ||
        (consensusAvailable && (!caps.expectsSharpBookContext || payload.sharpBookSplitsOrSignal.available))
          ? "low"
          : "medium",
      lineMovement: {
        ...compactForScanner.lineMovement,
        movementTowardAgainstPick: payload.lineMovementDirection,
      },
      marketReadRaw: marketRead,
      deterministicMarketRead: marketRead?.status ?? null,
      reasonCodes: payload.marketRead.reasonCodes,
    },
    priceValueEvidence: {
      priceAmerican: payload.displayPriceAmerican,
      priceSource: compactForScanner.priceSource,
      priceNullReason: payload.priceNullReason,
      marketImpliedProbability: payload.marketImpliedProbabilityPct,
      edge: payload.edgePct,
      priceQualityScore: scores.priceQualityScore,
      heavyJuiceWarning: payload.displayPriceAmerican !== null && payload.displayPriceAmerican <= -150,
      plusMoneyValueFlag: payload.displayPriceAmerican !== null && payload.displayPriceAmerican > 0 && (payload.edgePct ?? 0) > 0,
      priceBecameUnplayable: Boolean(payload.priceNullReason) || scores.priceQualityScore < 20,
      priceRecovered: payload.priceSource === "snapshot_json",
      priceRecoverySource: payload.priceSource === "snapshot_json" ? "snapshot_json" : null,
      priceRecoveryConfidence: payload.priceSource === "snapshot_json" ? "high" : null,
      priceDisplayAllowed: payload.displayPriceAmerican !== null,
    },
    internalGradeDimensions: {
      winCaseStrengthScore: winCaseScore(compactForScanner),
      bettingValueStrengthScore: bettingValueScore(compactForScanner),
      marketContextScore: scores.marketAlignmentScore,
      priceQualityScore: scores.priceQualityScore,
      modelStatSupportScore: scores.modelEdgeScore,
      dataQualityScore: scores.dataQualityScore,
      riskPenaltyScore: riskPenaltyScore(compactForScanner),
      readQualityScore: readQualityScoreFromStatus(payload.marketRead.status),
    },
    historicalCalibrationEvidence: {
      promotionScanner: scanPromotionCandidate(compactForScanner),
      knownRulesAndCautions: knownRules(compactForScanner),
    },
    guardrails: {
      noLiveChanges: true,
      noMemberFacingChanges: true,
      noPickFlips: true,
      noProbabilityChanges: true,
      noProjectionChanges: true,
      noPostgameResultsIncluded: true,
      originalPlayGradeIsContextOnly: true,
    },
  };
}

export function buildPredictionEvidenceObjects(cards: AiAuditorPayloadEstimate[]): PredictionEvidenceObject[] {
  return cards.flatMap((card) =>
    card.payload.markets.map((market) => buildPredictionEvidenceObject({ card, market })),
  );
}
