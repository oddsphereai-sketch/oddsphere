import type { MarketReadV2Dto } from "@/lib/types/domain/MarketIntelligenceV2";
import type { Grade } from "@/lib/types/domain/Grade";
import type { Verdict } from "@/lib/services/verdictDerivation";

export type DailyEdgeActionabilityMarket =
  | "moneyline"
  | "total"
  | "first_inning"
  | "spread"
  | "soccer_moneyline"
  | "soccer_total"
  | "soccer_btts";

export type DailyEdgeActionabilityInput = {
  market: DailyEdgeActionabilityMarket;
  rawVerdict: { key: Verdict; label: string; warning?: string | null };
  rawGrade: Grade | null;
  rawRecScore: number | null;
  modelProbability?: number | null;
  rawModelProbability?: number | null;
  rawModelMarketGapPct?: number | null;
  modelMarketGapPct: number | null;
  totalProjectionGapRuns?: number | null;
  marketReadV2: MarketReadV2Dto | null;
  marketSupportSignal?: "support" | "resistance" | "neutral" | null;
  hasPick: boolean;
  held: boolean;
  dataQualityTier: "high" | "medium" | "low" | "fallback";
  priceAmerican: number | null;
  priceUnavailableAtLock?: boolean;
  /**
   * Non-actionable neutral state. Used for MLB FI Toss-Up: it intentionally has
   * no picked side price, but it is still a real model read rather than a
   * missing-price failure. It should not be promoted above No Play.
   */
  neutralNonActionable?: boolean;
};

export type DailyEdgeActionabilityResult = {
  rawGrade: Grade | null;
  rawRecScore: number | null;
  capReasons: string[];
  finalGrade: Grade | null;
  finalVerdict: { key: Verdict; label: string; warning?: string | null };
  finalRecScore: number | null;
  actionabilityLabel: string;
  displayReason: string | null;
};

const VERDICT_LABEL: Record<Verdict, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  watchlist: "Watchlist",
  caution: "Caution",
  no_play: "No Play",
};

const MIN_REC_BY_VERDICT: Record<Exclude<Verdict, "caution" | "no_play">, number> = {
  best_angle: 60,
  lean: 45,
  watchlist: 0,
};

function clampRecForTier(rec: number | null, tier: DailyEdgeActionabilityInput["dataQualityTier"]): number | null {
  if (rec === null || !Number.isFinite(rec)) return null;
  const cap =
    tier === "fallback" ? 35 :
    tier === "low" ? 50 :
    tier === "medium" ? 65 :
    100;
  return Math.min(rec, cap);
}

function verdictForRec(rec: number | null, hasPick: boolean): Verdict {
  if (!hasPick) return "no_play";
  if (rec === null) return "no_play";
  if (rec >= MIN_REC_BY_VERDICT.best_angle) return "best_angle";
  if (rec >= MIN_REC_BY_VERDICT.lean) return "lean";
  if (rec >= 25) return "watchlist";
  return "no_play";
}

function gradeForVerdict(verdict: Verdict, rawGrade: Grade | null): Grade | null {
  if (verdict === "best_angle") return "best_signal";
  if (verdict === "caution") return "sharp_conflict";
  if (verdict === "no_play") return rawGrade === null ? null : "market_watch";
  if (verdict === "watchlist") return "market_watch";
  return rawGrade === "best_signal" ? "model_only" : (rawGrade ?? "model_only");
}

function supportsMarketConfirmedLean(input: DailyEdgeActionabilityInput, recAfterDataCap: number | null): boolean {
  if (input.market !== "moneyline" && input.market !== "total") return false;
  if (input.rawVerdict.key !== "watchlist") return false;
  if ((recAfterDataCap ?? 0) < MIN_REC_BY_VERDICT.lean) return false;
  if (input.priceAmerican === null || input.priceUnavailableAtLock === true) return false;
  if (input.dataQualityTier === "fallback" || input.dataQualityTier === "low") return false;

  const edge = input.modelMarketGapPct ?? 0;
  const edgeFloor = input.market === "moneyline" ? 5 : 4;
  if (edge < edgeFloor) return false;

  const movement = input.marketReadV2?.movement?.directionRelativeToPick ?? input.marketSupportSignal ?? null;
  if (movement !== "support") return false;

  return true;
}

function hasMarketSupport(input: DailyEdgeActionabilityInput): boolean {
  const movement = input.marketReadV2?.movement?.directionRelativeToPick ?? input.marketSupportSignal ?? null;
  return movement === "support";
}

function hasMarketResistance(input: DailyEdgeActionabilityInput): boolean {
  const movement = input.marketReadV2?.movement?.directionRelativeToPick ?? input.marketSupportSignal ?? null;
  return movement === "resistance";
}

function isPlayableBestAngleTotalPrice(price: number | null): boolean {
  if (price === null || !Number.isFinite(price) || price < -1000 || price > 1000) return false;
  return price > -135;
}

function isPlayableMoneylineWinnerPrice(price: number | null): boolean {
  if (price === null || !Number.isFinite(price) || price < -1000 || price > 1000) return false;
  return price > -185;
}

function isPredictionQualityMarket(input: DailyEdgeActionabilityInput): boolean {
  return input.market === "moneyline" || input.market === "total" || input.market === "soccer_moneyline";
}

function hasPlayablePredictionQualityPrice(input: DailyEdgeActionabilityInput): boolean {
  if (input.market === "total") return isPlayableBestAngleTotalPrice(input.priceAmerican);
  return isPlayableMoneylineWinnerPrice(input.priceAmerican);
}

function supportsPredictionQualityLean(
  input: DailyEdgeActionabilityInput,
  _recAfterDataCap: number | null,
): boolean {
  if (!isPredictionQualityMarket(input)) return false;
  if (input.rawVerdict.key !== "watchlist") return false;
  if (input.rawRecScore === null) return false;
  if (input.dataQualityTier === "fallback" || input.dataQualityTier === "low") return false;
  if (input.priceUnavailableAtLock === true || !hasPlayablePredictionQualityPrice(input)) return false;
  if (hasMarketResistance(input)) return false;

  const regularizedProbability = input.modelProbability ?? null;
  const rawProbability = input.rawModelProbability ?? regularizedProbability;
  const regularizedEdge = input.modelMarketGapPct ?? null;
  if (regularizedEdge === null || regularizedEdge < 0) return false;
  if (
    (regularizedProbability === null || regularizedProbability < 0.56) &&
    (rawProbability === null || rawProbability < 0.6 || regularizedEdge < 1)
  ) return false;
  if (input.market === "total" && input.totalProjectionGapRuns != null && input.totalProjectionGapRuns < 0.25) return false;

  return true;
}

function supportsPredictionQualityBestAngle(
  input: DailyEdgeActionabilityInput,
  _recAfterDataCap: number | null,
  finalVerdictKey: Verdict,
): boolean {
  if (!isPredictionQualityMarket(input)) return false;
  if (finalVerdictKey !== "lean") return false;
  if (input.rawRecScore === null) return false;
  if (input.dataQualityTier === "fallback" || input.dataQualityTier === "low") return false;
  if (input.priceUnavailableAtLock === true || !hasPlayablePredictionQualityPrice(input)) return false;
  if (hasMarketResistance(input)) return false;

  const regularizedProbability = input.modelProbability ?? null;
  const rawProbability = input.rawModelProbability ?? regularizedProbability;
  const regularizedEdge = input.modelMarketGapPct ?? null;
  if (regularizedEdge === null || regularizedEdge < 0) return false;
  if (
    (regularizedProbability === null || regularizedProbability < 0.6) &&
    (
      rawProbability === null ||
      rawProbability < 0.66 ||
      (regularizedProbability ?? 0) < 0.57 ||
      regularizedEdge < 2
    )
  ) return false;
  if (input.market === "total" && input.totalProjectionGapRuns != null && input.totalProjectionGapRuns < 0.35) return false;

  return true;
}

function supportsTotalMarketConfirmedBestAngle(
  input: DailyEdgeActionabilityInput,
  recAfterDataCap: number | null,
  finalVerdictKey: Verdict,
): boolean {
  if (input.market !== "total") return false;
  if (input.rawVerdict.key !== "lean" || finalVerdictKey !== "lean") return false;
  if ((recAfterDataCap ?? 0) < MIN_REC_BY_VERDICT.best_angle) return false;
  if (input.dataQualityTier === "fallback" || input.dataQualityTier === "low") return false;
  if (!isPlayableBestAngleTotalPrice(input.priceAmerican) || input.priceUnavailableAtLock === true) return false;
  if (!hasMarketSupport(input)) return false;

  const edge = input.modelMarketGapPct ?? 0;
  const gap = input.totalProjectionGapRuns ?? 0;
  if (edge < 6) return false;
  if (gap < 0.5) return false;

  return true;
}

function supportsTotalHighConvictionBestAngle(
  input: DailyEdgeActionabilityInput,
  recAfterDataCap: number | null,
  finalVerdictKey: Verdict,
): boolean {
  if (input.market !== "total") return false;
  if (finalVerdictKey !== "lean") return false;
  if ((recAfterDataCap ?? 0) < MIN_REC_BY_VERDICT.best_angle) return false;
  if (input.dataQualityTier === "fallback" || input.dataQualityTier === "low") return false;
  if (!isPlayableBestAngleTotalPrice(input.priceAmerican) || input.priceUnavailableAtLock === true) return false;
  if (hasMarketResistance(input)) return false;

  const regularizedProbability = input.modelProbability ?? 0;
  const rawProbability = input.rawModelProbability ?? regularizedProbability;
  const edge = input.modelMarketGapPct ?? 0;
  const rawEdge = input.rawModelMarketGapPct ?? edge;
  const gap = input.totalProjectionGapRuns ?? 0;

  return (
    regularizedProbability >= 0.555 &&
    rawProbability >= 0.555 &&
    edge >= 7 &&
    rawEdge >= 7 &&
    gap >= 0.9
  );
}

function explainCap(reason: string): string {
  switch (reason) {
    case "low_action_score":
      return "the action score is too low";
    case "missing_price":
      return "the current price is not reliable";
    case "fallback_data_cap":
      return "key model inputs are using fallback data";
    case "degraded_data_cap":
      return "the data quality is capped";
    case "market_resistance":
      return "the market has moved against the pick";
    case "first_inning_volatility_cap":
      return "first-inning volatility is too high for an actionable play";
    case "no_pick_or_held":
      return "the model is not making an official play";
    case "market_support_promotion":
      return "the model edge, playable price, and market movement all support the pick";
    case "market_support_best_angle_promotion":
      return "the total has Best Angle-level edge, projection gap, playable price, and market movement support";
    case "prediction_quality_promotion":
      return "the pick has strong model probability, playable price, clean data, and no market resistance";
    case "prediction_quality_best_angle_promotion":
      return "the pick has Best Angle-level model probability, playable price, clean data, and no market resistance";
    case "total_high_conviction_best_angle_promotion":
      return "the total has a strong model edge, clear projection gap, playable price, and no direct market resistance";
    default:
      return reason.replaceAll("_", " ");
  }
}

export function normalizeDailyEdgeActionability(
  input: DailyEdgeActionabilityInput,
): DailyEdgeActionabilityResult {
  const capReasons: string[] = [];
  const hasPick = input.hasPick && !input.held;
  const neutralNonActionable = input.neutralNonActionable === true;
  const recAfterDataCap = clampRecForTier(input.rawRecScore, input.dataQualityTier);

  if (!hasPick) capReasons.push("no_pick_or_held");
  if (!neutralNonActionable && (input.priceUnavailableAtLock === true || (hasPick && input.priceAmerican === null))) {
    capReasons.push("missing_price");
  }
  if (input.dataQualityTier === "fallback") capReasons.push("fallback_data_cap");
  if (input.dataQualityTier === "low") capReasons.push("degraded_data_cap");

  const readDirection = input.marketReadV2?.movement?.directionRelativeToPick ?? null;
  if (readDirection === "resistance" && input.rawVerdict.key === "best_angle") {
    capReasons.push("market_resistance");
  }
  if (input.market === "first_inning" && !neutralNonActionable && (recAfterDataCap ?? 0) < MIN_REC_BY_VERDICT.lean) {
    capReasons.push("first_inning_volatility_cap");
  }

  let finalVerdictKey = input.rawVerdict.key;
  if (neutralNonActionable) {
    finalVerdictKey = "no_play";
  } else if (!hasPick || input.rawRecScore === null) {
    finalVerdictKey = "no_play";
  } else if (finalVerdictKey === "best_angle" && (recAfterDataCap ?? 0) < MIN_REC_BY_VERDICT.best_angle) {
    capReasons.push("low_action_score");
    finalVerdictKey = verdictForRec(recAfterDataCap, hasPick);
  } else if (finalVerdictKey === "lean" && (recAfterDataCap ?? 0) < MIN_REC_BY_VERDICT.lean) {
    capReasons.push("low_action_score");
    finalVerdictKey = verdictForRec(recAfterDataCap, hasPick);
  }

  if (capReasons.includes("market_resistance") && finalVerdictKey === "best_angle") {
    finalVerdictKey = "lean";
  }
  if ((capReasons.includes("fallback_data_cap") || capReasons.includes("degraded_data_cap")) && finalVerdictKey === "best_angle") {
    finalVerdictKey = "lean";
  }
  if (capReasons.includes("first_inning_volatility_cap") && (finalVerdictKey === "lean" || finalVerdictKey === "best_angle")) {
    finalVerdictKey = (recAfterDataCap ?? 0) >= 25 ? "watchlist" : "no_play";
  }
  if (capReasons.includes("missing_price") && (finalVerdictKey === "best_angle" || finalVerdictKey === "lean")) {
    finalVerdictKey = "watchlist";
  }
  if (supportsMarketConfirmedLean(input, recAfterDataCap) && finalVerdictKey === "watchlist" && capReasons.length === 0) {
    finalVerdictKey = "lean";
    capReasons.push("market_support_promotion");
  }
  if (supportsPredictionQualityLean(input, recAfterDataCap) && finalVerdictKey === "watchlist" && capReasons.length === 0) {
    finalVerdictKey = "lean";
    capReasons.push("prediction_quality_promotion");
  }
  if (supportsTotalMarketConfirmedBestAngle(input, recAfterDataCap, finalVerdictKey) && capReasons.length === 0) {
    finalVerdictKey = "best_angle";
    capReasons.push("market_support_best_angle_promotion");
  }
  if (supportsTotalHighConvictionBestAngle(input, recAfterDataCap, finalVerdictKey) && capReasons.length === 0) {
    finalVerdictKey = "best_angle";
    capReasons.push("total_high_conviction_best_angle_promotion");
  }
  if (
    supportsPredictionQualityBestAngle(input, recAfterDataCap, finalVerdictKey) &&
    (capReasons.length === 0 || capReasons.every((reason) => reason === "prediction_quality_promotion"))
  ) {
    finalVerdictKey = "best_angle";
    capReasons.push("prediction_quality_best_angle_promotion");
  }

  let finalRecScore = recAfterDataCap;
  if (capReasons.includes("prediction_quality_promotion")) {
    finalRecScore = Math.max(finalRecScore ?? 0, MIN_REC_BY_VERDICT.lean);
  }
  if (capReasons.includes("prediction_quality_best_angle_promotion")) {
    finalRecScore = Math.max(finalRecScore ?? 0, MIN_REC_BY_VERDICT.best_angle);
  }
  const finalGrade = gradeForVerdict(finalVerdictKey, input.rawGrade);
  const positiveDisplayedEdge = input.modelMarketGapPct !== null && input.modelMarketGapPct > 2;
  if (finalVerdictKey === "no_play" && positiveDisplayedEdge && capReasons.length === 0) {
    capReasons.push("low_action_score");
  }
  const primaryReason =
    finalVerdictKey === "best_angle" && capReasons.includes("prediction_quality_best_angle_promotion")
      ? "prediction_quality_best_angle_promotion"
      : finalVerdictKey === "best_angle" && capReasons.includes("total_high_conviction_best_angle_promotion")
        ? "total_high_conviction_best_angle_promotion"
      : finalVerdictKey === "best_angle" && capReasons.includes("market_support_best_angle_promotion")
        ? "market_support_best_angle_promotion"
        : capReasons[0] ?? null;
  const displayReason =
    primaryReason === "market_support_promotion" && finalVerdictKey === "lean"
      ? `Promoted to Lean because ${explainCap(primaryReason)}.`
      : primaryReason === "prediction_quality_promotion" && finalVerdictKey === "lean"
      ? `Promoted to Lean because ${explainCap(primaryReason)}.`
      : primaryReason === "market_support_best_angle_promotion" && finalVerdictKey === "best_angle"
      ? `Promoted to Best Angle because ${explainCap(primaryReason)}.`
      : primaryReason === "total_high_conviction_best_angle_promotion" && finalVerdictKey === "best_angle"
      ? `Promoted to Best Angle because ${explainCap(primaryReason)}.`
      : primaryReason === "prediction_quality_best_angle_promotion" && finalVerdictKey === "best_angle"
      ? `Promoted to Best Angle because ${explainCap(primaryReason)}.`
      : finalVerdictKey === "no_play" && positiveDisplayedEdge && primaryReason !== null
      ? `Edge exists, but we are skipping because ${explainCap(primaryReason)}.`
      : primaryReason !== null && finalVerdictKey !== input.rawVerdict.key
        ? `Capped to ${VERDICT_LABEL[finalVerdictKey]} because ${explainCap(primaryReason)}.`
        : null;

  return {
    rawGrade: input.rawGrade,
    rawRecScore: input.rawRecScore,
    capReasons: Array.from(new Set(capReasons)),
    finalGrade,
    finalVerdict: {
      ...input.rawVerdict,
      key: finalVerdictKey,
      label: VERDICT_LABEL[finalVerdictKey],
    },
    finalRecScore,
    actionabilityLabel: VERDICT_LABEL[finalVerdictKey],
    displayReason,
  };
}
