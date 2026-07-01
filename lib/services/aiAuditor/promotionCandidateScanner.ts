import type { AiAuditorCompactMarketPayload } from "@/lib/services/aiAuditor/costPreview";

export type PromotionCandidateScan = {
  promotionCandidate: boolean;
  maxCandidateGrade: "Watchlist" | "Lean" | "Best Angle";
  promotionScore: number;
  promotionReasonCodes: string[];
  promotionBlockers: string[];
  blockerMateriality: "low" | "medium" | "high";
};

function num(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pricePlayable(price: number | null): boolean {
  if (price === null) return false;
  return price > 0 || price >= -150;
}

function priceHeavy(price: number | null): boolean {
  return price !== null && price < -175;
}

function priceVeryHeavy(price: number | null): boolean {
  return price !== null && price < -200;
}

function hasHighMaterialDataWarning(market: AiAuditorCompactMarketPayload): boolean {
  return market.dataQuality.reviewFlags.some((flag) => /stale|critical|lineup|starter|injury|unavailable|missing_price/i.test(flag));
}

function supportiveRead(status: string | null | undefined): boolean {
  return status === "aligned" || status === "consensus_support";
}

function mixedButReviewable(status: string | null | undefined): boolean {
  return status === "mixed" || status === "no_clear_signal";
}

function resistantRead(status: string | null | undefined): boolean {
  return status === "resistance" || status === "consensus_resistance";
}

function movementAgainst(market: AiAuditorCompactMarketPayload): boolean {
  return /against|oppos/i.test(market.lineMovement.directionRelativeToPick ?? "");
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function signedEdge(market: AiAuditorCompactMarketPayload): number {
  const explicit = num(market.modelMarketGapPct);
  if (explicit !== null) return explicit;
  const model = num(market.modelProbabilityPct);
  const implied = num(market.marketProbabilityPct);
  return model !== null && implied !== null ? model - implied : 0;
}

function gradeRank(grade: string | null | undefined): number {
  return ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"].indexOf(grade ?? "");
}

function maxGrade(score: number, edge: number, blockerMateriality: PromotionCandidateScan["blockerMateriality"]): PromotionCandidateScan["maxCandidateGrade"] {
  if (blockerMateriality === "high") return "Watchlist";
  if (score >= 78 && edge >= 7) return "Best Angle";
  if (score >= 55) return "Lean";
  return "Watchlist";
}

function baseScan(market: AiAuditorCompactMarketPayload): PromotionCandidateScan {
  return {
    promotionCandidate: false,
    maxCandidateGrade: "Watchlist",
    promotionScore: 0,
    promotionReasonCodes: [],
    promotionBlockers: [],
    blockerMateriality: "low",
  };
}

function finalize(scan: PromotionCandidateScan, edge: number, market: AiAuditorCompactMarketPayload): PromotionCandidateScan {
  const highBlockers = scan.promotionBlockers.filter((blocker) => /below promotion threshold|missing price|unplayable|critical|stale|strong opposing|heavy juice|against pick/i.test(blocker));
  scan.blockerMateriality = highBlockers.length > 0 ? "high" : scan.promotionBlockers.length > 0 ? "medium" : "low";
  scan.promotionScore = clampScore(scan.promotionScore);
  scan.maxCandidateGrade = maxGrade(scan.promotionScore, edge, scan.blockerMateriality);
  scan.promotionCandidate = scan.promotionScore >= 45 && scan.blockerMateriality !== "high" && gradeRank(scan.maxCandidateGrade) > gradeRank(market.playGrade);
  if (market.playGrade === "No Play" && scan.maxCandidateGrade === "Best Angle") scan.maxCandidateGrade = "Lean";
  if (gradeRank(scan.maxCandidateGrade) <= gradeRank(market.playGrade)) scan.promotionCandidate = false;
  return scan;
}

function scanMoneyline(market: AiAuditorCompactMarketPayload): PromotionCandidateScan {
  const scan = baseScan(market);
  const edge = signedEdge(market);
  const price = num(market.displayPriceAmerican);
  const read = market.marketRead?.status;
  scan.promotionScore += edge >= 9 ? 42 : edge >= 7 ? 34 : edge >= 5 ? 26 : edge >= 3 ? 12 : 0;
  scan.promotionReasonCodes.push(edge >= 9 ? "ml_edge_9_plus" : edge >= 7 ? "ml_edge_7_plus" : edge >= 5 ? "ml_edge_5_plus" : "ml_edge_below_promotion_band");
  if (edge < 5) scan.promotionBlockers.push("ML edge below promotion threshold");
  if (price === null) scan.promotionBlockers.push("missing price");
  else if (priceVeryHeavy(price) && edge < 10) scan.promotionBlockers.push("heavy juice without elite edge");
  else if (pricePlayable(price)) scan.promotionScore += 18;
  else scan.promotionScore += 8;
  if (supportiveRead(read)) {
    scan.promotionScore += 20;
    scan.promotionReasonCodes.push("market_supportive");
  } else if (mixedButReviewable(read)) {
    scan.promotionScore += 10;
    scan.promotionReasonCodes.push("market_mixed_reviewable");
  } else if (resistantRead(read)) {
    if (edge >= 9 && !priceHeavy(price)) scan.promotionReasonCodes.push("model_edge_override_review");
    else scan.promotionBlockers.push("market resistance without strong override");
  }
  if (market.sourceConflict) scan.promotionBlockers.push("source conflict requires human/AI review");
  if (movementAgainst(market)) scan.promotionBlockers.push("line movement strongly against pick");
  if (hasHighMaterialDataWarning(market)) scan.promotionBlockers.push("high materiality data warning");
  return finalize(scan, edge, market);
}

function scanTotal(market: AiAuditorCompactMarketPayload): PromotionCandidateScan {
  const scan = baseScan(market);
  const edge = signedEdge(market);
  const price = num(market.displayPriceAmerican);
  const read = market.marketRead?.status;
  scan.promotionScore += edge >= 6 ? 42 : edge >= 5 ? 34 : edge >= 4 ? 26 : edge >= 2.5 ? 12 : 0;
  scan.promotionReasonCodes.push(edge >= 6 ? "total_edge_6_plus" : edge >= 5 ? "total_edge_5_plus" : edge >= 4 ? "total_edge_4_plus" : "total_edge_below_promotion_band");
  if (edge < 4) scan.promotionBlockers.push("Totals edge below promotion threshold");
  if (market.lineValue !== null) {
    scan.promotionScore += 12;
    scan.promotionReasonCodes.push("total_line_present");
  } else {
    scan.promotionBlockers.push("total line missing");
  }
  if (price === null) scan.promotionBlockers.push("missing price");
  else if (pricePlayable(price) || price >= -125) scan.promotionScore += 18;
  else scan.promotionBlockers.push("unplayable or expensive total price");
  if (supportiveRead(read)) scan.promotionScore += 18;
  else if (mixedButReviewable(read)) {
    scan.promotionScore += 10;
    scan.promotionReasonCodes.push("mixed_market_not_auto_blocker");
  } else if (resistantRead(read) && edge < 6) {
    scan.promotionBlockers.push("market resistance with sub-elite total edge");
  }
  if (movementAgainst(market)) scan.promotionBlockers.push("line movement strongly against pick");
  if (hasHighMaterialDataWarning(market)) scan.promotionBlockers.push("high materiality data warning");
  return finalize(scan, edge, market);
}

function scanFirstInning(market: AiAuditorCompactMarketPayload): PromotionCandidateScan {
  const scan = baseScan(market);
  const edge = signedEdge(market);
  const price = num(market.displayPriceAmerican);
  scan.promotionScore += edge >= 5 ? 42 : edge >= 4 ? 34 : edge >= 3 ? 26 : edge >= 2 ? 12 : 0;
  scan.promotionReasonCodes.push(edge >= 5 ? "fi_edge_5_plus" : edge >= 4 ? "fi_edge_4_plus" : edge >= 3 ? "fi_edge_3_plus" : "fi_edge_below_promotion_band");
  if (edge < 3) scan.promotionBlockers.push("FI edge below promotion threshold");
  if (market.fiContext.expectedRunsAvailable) {
    scan.promotionScore += 18;
    scan.promotionReasonCodes.push("fi_context_usable");
  }
  if (price === null) scan.promotionBlockers.push("missing price");
  else if (price >= -150 || price > 0) scan.promotionScore += 18;
  else if (edge >= 5) scan.promotionScore += 8;
  else scan.promotionBlockers.push("heavy FI juice with thin edge");
  if (!market.consensusSplits && !market.sharpBookSplits) {
    scan.promotionReasonCodes.push("fi_missing_splits_low_materiality");
  }
  if (movementAgainst(market)) scan.promotionBlockers.push("line movement strongly against pick");
  if (hasHighMaterialDataWarning(market)) scan.promotionBlockers.push("high materiality starter/lineup/stale warning");
  return finalize(scan, edge, market);
}

export function scanPromotionCandidate(market: AiAuditorCompactMarketPayload): PromotionCandidateScan {
  if (market.playGrade === "Lean" || market.playGrade === "Best Angle") return baseScan(market);
  if (market.market === "moneyline") return scanMoneyline(market);
  if (market.market === "total") return scanTotal(market);
  return scanFirstInning(market);
}
