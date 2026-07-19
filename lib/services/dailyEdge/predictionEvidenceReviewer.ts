import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";
import { dailyEdgeMarketCapabilities } from "@/lib/services/dailyEdge/dailyEdgeSportCapabilities";

export type EvidenceQuality = "strong" | "usable" | "limited" | "blocked";
export type ReviewModeAllowed = "full_review" | "copy_only" | "market_read_only" | "no_grade_change" | "blocked";
export type MarketContextQuality = "strong" | "usable" | "limited" | "unavailable";

export type PredictionEvidenceReview = {
  evidenceQuality: EvidenceQuality;
  missingRequiredFields: string[];
  missingOptionalFields: string[];
  expectedMissingFields: string[];
  persistenceGaps: string[];
  dataWarnings: string[];
  highMaterialityDataWarnings: string[];
  reviewModeAllowed: ReviewModeAllowed;
  gradeChangeAllowed: boolean;
  copyReviewAllowed: boolean;
  marketContextAvailable: boolean;
  marketContextQuality: MarketContextQuality;
  priceValueAvailable: boolean;
  modelStatContextAvailable: boolean;
};

function pushIfMissing(target: string[], key: string, value: unknown): void {
  if (value === null || value === undefined || value === "") target.push(key);
}

function requiredFieldsFor(row: PredictionEvidenceObject): string[] {
  const caps = dailyEdgeMarketCapabilities(row.identity.sport, row.identity.normalizedMarket === "total" ? "total" : row.identity.normalizedMarket === "moneyline" ? "moneyline" : "firstInning");
  if (caps.isFirstInning && isFiHeldNoSide(row)) {
    return ["fi_context"];
  }
  const fields = ["pick", "model_probability"];
  if (!caps.isFirstInning && row.identity.noBet !== true) fields.push("price", "market_implied_probability", "edge");
  if (row.identity.marketType === "TOTAL" && row.identity.noBet !== true) fields.push("line_value", "projected_total");
  if (caps.isFirstInning) fields.push("fi_pick", "fi_context");
  return fields;
}

function marketContextQuality(row: PredictionEvidenceObject): MarketContextQuality {
  const caps = dailyEdgeMarketCapabilities(row.identity.sport, row.identity.normalizedMarket === "total" ? "total" : row.identity.normalizedMarket === "moneyline" ? "moneyline" : "firstInning");
  if (caps.isFirstInning) {
    if (row.marketEvidence.lineMovement.currentAmerican !== null || row.marketEvidence.lineMovement.currentLine !== null) return "usable";
    return "limited";
  }
  if (!caps.expectsConsensusSplits && !caps.expectsSharpBookContext) {
    const hasMovement = row.marketEvidence.lineMovement.movementTowardAgainstPick !== null ||
      row.marketEvidence.lineMovement.currentAmerican !== null ||
      row.marketEvidence.lineMovement.currentLine !== null;
    return hasMovement ? "usable" : "limited";
  }
  const hasConsensus = row.marketEvidence.consensusSplitsAvailable;
  const hasSharp = row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable;
  const hasMovement = row.marketEvidence.lineMovement.movementTowardAgainstPick !== null ||
    row.marketEvidence.lineMovement.currentAmerican !== null ||
    row.marketEvidence.lineMovement.currentLine !== null;
  if (hasConsensus && hasSharp && hasMovement) return "strong";
  if (hasConsensus && hasMovement) return "usable";
  if (hasConsensus || hasSharp || hasMovement) return "limited";
  return "unavailable";
}

function isFiTossUp(row: PredictionEvidenceObject): boolean {
  return row.identity.marketType === "FI" && /toss[\s-]*up/i.test(String(row.identity.pick ?? ""));
}

function isFiHeldNoSide(row: PredictionEvidenceObject): boolean {
  return row.identity.marketType === "FI" && row.identity.pick === null;
}

function isNonActionableNoBet(row: PredictionEvidenceObject): boolean {
  return row.identity.noBet === true || /^no\s*play$/i.test(String(row.identity.originalPlayGrade ?? ""));
}

export function reviewPredictionEvidence(row: PredictionEvidenceObject): PredictionEvidenceReview {
  const caps = dailyEdgeMarketCapabilities(row.identity.sport, row.identity.normalizedMarket === "total" ? "total" : row.identity.normalizedMarket === "moneyline" ? "moneyline" : "firstInning");
  const missingRequiredFields: string[] = [];
  const missingOptionalFields: string[] = [];
  const expectedMissingFields: string[] = [];
  const persistenceGaps: string[] = [];
  const dataWarnings = [
    ...row.modelStatsEvidence.modelInputWarnings,
    ...row.modelStatsEvidence.projectionWarnings,
    ...row.modelStatsEvidence.dataQualityWarnings,
  ];
  const required = requiredFieldsFor(row);
  if (required.includes("pick")) pushIfMissing(missingRequiredFields, "pick", row.identity.pick);
  if (required.includes("price")) pushIfMissing(missingRequiredFields, "price", row.priceValueEvidence.priceAmerican);
  if (required.includes("market_implied_probability")) pushIfMissing(missingRequiredFields, "market_implied_probability", row.modelStatsEvidence.marketImpliedProbability);
  if (required.includes("edge")) pushIfMissing(missingRequiredFields, "edge", row.modelStatsEvidence.edge);
  if (required.includes("model_probability")) pushIfMissing(missingRequiredFields, "model_probability", row.modelStatsEvidence.modelProbability);
  if (required.includes("line_value")) pushIfMissing(missingRequiredFields, "line_value", row.identity.lineValue);
  if (required.includes("projected_total")) pushIfMissing(missingRequiredFields, "projected_total", row.modelStatsEvidence.projectedTotal);
  if (required.includes("fi_pick")) pushIfMissing(missingRequiredFields, "fi_pick", row.identity.pick);
  if (required.includes("fi_context") && row.modelStatsEvidence.fiStarterTopOrderContext?.isFirstInning !== true) {
    missingRequiredFields.push("fi_context");
  }

  if (caps.isFirstInning) {
    expectedMissingFields.push("fi_consensus_splits", "fi_sharp_book_splits", "fi_sharp_book_signal");
    const tossUp = isFiTossUp(row);
    const heldNoSide = isFiHeldNoSide(row);
    if ((tossUp || heldNoSide) && row.priceValueEvidence.priceAmerican === null) {
      expectedMissingFields.push(
        tossUp ? "fi_toss_up_selected_side_price_not_applicable" : "fi_held_selected_side_price_not_applicable",
        tossUp ? "fi_toss_up_selected_side_market_implied_not_applicable" : "fi_held_selected_side_market_implied_not_applicable",
        tossUp ? "fi_toss_up_selected_side_edge_not_applicable" : "fi_held_selected_side_edge_not_applicable",
      );
    } else if (row.priceValueEvidence.priceAmerican === null) {
      if (row.evidenceSource.kind === "locked_snapshot") {
        persistenceGaps.push("fi_price_missing_locked_snapshot");
      } else if (/\b(not offered|not_offered|unavailable|no_price|no price)\b/i.test(row.priceValueEvidence.priceNullReason ?? "")) {
        persistenceGaps.push("fi_price_not_offered_or_unavailable");
      } else {
        persistenceGaps.push("fi_price_missing_current_prelock");
      }
    } else if (row.priceValueEvidence.priceSource === "locked_snapshot") {
      persistenceGaps.push("fi_price_recovered_from_snapshot");
    }
    if (!tossUp && !heldNoSide && row.modelStatsEvidence.marketImpliedProbability === null) {
      persistenceGaps.push(row.evidenceSource.kind === "locked_snapshot" ? "fi_market_implied_missing_locked_snapshot" : "fi_market_implied_missing_current_prelock");
    }
    if (!tossUp && !heldNoSide && row.modelStatsEvidence.edge === null) {
      persistenceGaps.push(row.evidenceSource.kind === "locked_snapshot" ? "fi_edge_missing_locked_snapshot" : "fi_edge_missing_current_prelock");
    }
  } else {
    if (caps.expectsConsensusSplits && !row.marketEvidence.consensusSplitsAvailable) missingOptionalFields.push("consensus_splits");
    if (caps.expectsSharpBookContext && !row.marketEvidence.sharpBookSplitsAvailable && !row.marketEvidence.sharpBookSignalAvailable) {
      missingOptionalFields.push("sharp_book_context");
      if (row.evidenceSource.kind === "locked_snapshot") persistenceGaps.push("sharp_book_context_not_persisted_at_lock");
    }
  }

  if (row.identity.marketType === "TOTAL" && row.modelStatsEvidence.edge === null && !isNonActionableNoBet(row)) {
    persistenceGaps.push("total_edge_missing_at_lock");
  }
  if (row.priceValueEvidence.priceNullReason) dataWarnings.push(row.priceValueEvidence.priceNullReason);
  if (row.marketEvidence.sourceMissingReason && !caps.isFirstInning && (caps.expectsConsensusSplits || caps.expectsSharpBookContext)) dataWarnings.push(row.marketEvidence.sourceMissingReason);

  const highMaterialityDataWarnings = dataWarnings.filter((warning) =>
    /\b(stale|missing starter|injury|lineup|blocked|unavailable price|no_price|price missing)\b/i.test(warning),
  );
  const contextQuality = marketContextQuality(row);
  const priceValueAvailable = row.identity.noBet === true ||
    (row.priceValueEvidence.priceAmerican !== null &&
      row.modelStatsEvidence.marketImpliedProbability !== null &&
      (caps.isFirstInning || row.modelStatsEvidence.edge !== null));
  const modelStatContextAvailable = row.modelStatsEvidence.modelProbability !== null &&
    (row.identity.marketType !== "TOTAL" || row.modelStatsEvidence.projectedTotal !== null);

  let evidenceQuality: EvidenceQuality = "strong";
  if (missingRequiredFields.length > 0) evidenceQuality = "blocked";
  else if (highMaterialityDataWarnings.length > 0 || contextQuality === "unavailable") evidenceQuality = "limited";
  else if (missingOptionalFields.length > 0 || persistenceGaps.length > 0 || contextQuality === "limited") evidenceQuality = "usable";

  const gradeChangeAllowed = evidenceQuality === "strong" ||
    (evidenceQuality === "usable" && priceValueAvailable && modelStatContextAvailable);
  const reviewModeAllowed: ReviewModeAllowed =
    evidenceQuality === "blocked" ? "blocked" :
    gradeChangeAllowed ? "full_review" :
    contextQuality !== "unavailable" ? "market_read_only" :
    "copy_only";

  return {
    evidenceQuality,
    missingRequiredFields,
    missingOptionalFields,
    expectedMissingFields,
    persistenceGaps,
    dataWarnings,
    highMaterialityDataWarnings,
    reviewModeAllowed,
    gradeChangeAllowed,
    copyReviewAllowed: evidenceQuality !== "blocked",
    marketContextAvailable: contextQuality !== "unavailable",
    marketContextQuality: contextQuality,
    priceValueAvailable,
    modelStatContextAvailable,
  };
}
