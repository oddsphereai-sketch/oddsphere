import type { Grade } from "@/lib/types/domain/Grade";

export const EPL_PREVIEW_GRADE_RELEASE = "epl_grade_policy_2026_09_02_v23_positive_forecast_ev" as const;

export type EplPreviewMarket = "match_result" | "double_chance" | "total" | "btts";
export type EplPreviewGrade = {
  release: typeof EPL_PREVIEW_GRADE_RELEASE;
  verdict: { key: "no_play" | "caution" | "watchlist" | "lean" | "best_angle"; label: string };
  grade: Grade | null;
  recommendationScore: number | null;
  candidateTier: "data_hold" | "research_only" | "market_aligned" | "watchlist" | "lean_candidate" | "lean" | "best_angle" | "caution";
  reasons: string[];
};

const WATCH_FLOOR: Record<EplPreviewMarket, number> = { match_result: 2, double_chance: 4, total: 2.5, btts: 3 };
const LEAN_CANDIDATE_FLOOR: Record<EplPreviewMarket, number> = { match_result: 4, double_chance: 6, total: 4.5, btts: 5 };

function exactPriceExpectedValue(probability: number, american: number): number {
  const decimal = american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
  return probability * decimal - 1;
}

/**
 * EPL-only market grading for totals/BTTS and compatibility callers. Match
 * Result uses deriveEplMatchResultDecision below so forecast and value sides
 * cannot be silently conflated.
 */
export function deriveEplPreviewGrade(input: {
  market: EplPreviewMarket;
  edgePp: number | null;
  modelProbability?: number | null;
  priceAmerican: number | null;
  coherentMarket: boolean;
  promotedProxy: boolean;
  meanProbabilityDisagree?: boolean;
}): EplPreviewGrade {
  const base = { release: EPL_PREVIEW_GRADE_RELEASE } as const;
  if (!input.coherentMarket || input.edgePp === null || input.priceAmerican === null) {
    return { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: null, candidateTier: "data_hold", reasons: ["No Play until a coherent current price is available for this market."] };
  }
  if (input.market !== "match_result") {
    if (input.market === "total" || input.market === "btts") {
      const marketLabel = input.market === "total" ? "Total" : "BTTS";
      const modelProbability = input.modelProbability ?? 0;
      const forecastSideEv = exactPriceExpectedValue(modelProbability, input.priceAmerican);
      if (modelProbability >= 0.55 && forecastSideEv > 0) {
        return { ...base, verdict: { key: "lean", label: "Lean" }, grade: "model_only", recommendationScore: Math.round(45 + (input.modelProbability! - 0.5) * 200), candidateTier: "lean", reasons: [`${marketLabel} clears the chronologically validated 55% winner-confidence floor and has positive exact forecast-side expected value.`] };
      }
      if (modelProbability >= 0.55) {
        return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 40, candidateTier: "watchlist", reasons: [`${marketLabel} clears the 55% forecast floor, but the exact forecast-side price does not have positive expected value.`] };
      }
      if (modelProbability >= 0.53) {
        return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 40, candidateTier: "watchlist", reasons: [`${marketLabel} clears the validated monitoring band but not the 55% Lean floor.`] };
      }
      return { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: 25, candidateTier: "research_only", reasons: [`${marketLabel} does not clear the validated 53% monitoring floor.`] };
    }
    const monitorFloor = 0.72;
    if ((input.modelProbability ?? 0) >= monitorFloor && input.edgePp >= 0) {
      return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 35, candidateTier: "watchlist", reasons: ["Strong Double Chance forecast with a coherent current price. Monitor only—the EPL betting threshold is not validated."] };
    }
    return { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: 0, candidateTier: "research_only", reasons: ["No Play: Double Chance is coherently derived and tracked, but EPL-specific price thresholds have not been validated."] };
  }
  if (input.meanProbabilityDisagree) {
    return { ...base, verdict: { key: "caution", label: "Caution" }, grade: "sharp_conflict", recommendationScore: 20, candidateTier: "caution", reasons: ["The probability side and projected scoring mean point in different directions."] };
  }
  if (input.priceAmerican <= -300) {
    return { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: 20, candidateTier: "market_aligned", reasons: ["No Play at the current price: the likely outcome may still be correct, but a quote of -300 or shorter is not a standalone value claim."] };
  }
  if (Math.abs(input.edgePp) > 20) {
    return { ...base, verdict: { key: "caution", label: "Caution" }, grade: "sharp_conflict", recommendationScore: 18, candidateTier: "caution", reasons: ["Model and market differ by more than 20 percentage points, which is treated as a data or calibration warning."] };
  }
  if (input.edgePp < WATCH_FLOOR[input.market]) {
    return { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: Math.max(15, Math.min(35, 25 + input.edgePp * 2)), candidateTier: "market_aligned", reasons: ["No Play: the model-market gap does not clear the EPL Watchlist floor."] };
  }
  if (input.promotedProxy) {
    return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 35, candidateTier: "watchlist", reasons: ["Positive model-market gap, capped because at least one club uses the promoted-team proxy."] };
  }
  if (input.edgePp >= LEAN_CANDIDATE_FLOOR[input.market]) {
    return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 45, candidateTier: "lean_candidate", reasons: ["The gap is worth monitoring, but the untouched EPL price holdout failed, so it cannot receive an actionable Lean grade."] };
  }
  return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 38, candidateTier: "watchlist", reasons: ["The gap clears the EPL Watchlist floor but not the candidate Lean floor."] };
}

export type EplMatchResultSide = "home" | "draw" | "away";

function maxSide(values: Record<EplMatchResultSide, number>): EplMatchResultSide {
  return (["home", "draw", "away"] as const).reduce((best, side) => values[side] > values[best] ? side : best, "home");
}

export function deriveEplMatchResultDecision(input: {
  model: Record<EplMatchResultSide, number>;
  market: Record<EplMatchResultSide, number> | null;
  prices: Record<EplMatchResultSide, number> | null;
  promotedProxy: boolean;
}): { selectedSide: EplMatchResultSide; forecastSide: EplMatchResultSide; valueSide: EplMatchResultSide | null; grade: EplPreviewGrade } {
  const forecastSide = maxSide(input.model);
  if (!input.market || !input.prices) {
    return {
      selectedSide: forecastSide,
      forecastSide,
      valueSide: null,
      grade: deriveEplPreviewGrade({ market: "match_result", edgePp: null, priceAmerican: null, coherentMarket: false, promotedProxy: input.promotedProxy }),
    };
  }
  const edges = {
    home: (input.model.home - input.market.home) * 100,
    draw: (input.model.draw - input.market.draw) * 100,
    away: (input.model.away - input.market.away) * 100,
  };
  const valueSide = maxSide(edges);
  const marketFavorite = maxSide(input.market);
  const valueEdge = edges[valueSide];
  const forecastEdge = edges[forecastSide];
  const valuePrice = input.prices[valueSide];
  const forecastPrice = input.prices[forecastSide];
  const forecastExpectedValue = exactPriceExpectedValue(input.model[forecastSide], forecastPrice);
  const maxAbsoluteGap = Math.max(...Object.values(edges).map(Math.abs));
  const base = { release: EPL_PREVIEW_GRADE_RELEASE } as const;

  // Match Result is prediction-first. The headline side is always the
  // model's most likely regulation outcome; price can grade that forecast,
  // but it can never replace it with a less-likely value side.
  if (maxAbsoluteGap > 20) {
    return { selectedSide: forecastSide, forecastSide, valueSide, grade: { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: 18, candidateTier: "data_hold", reasons: ["No Play: the model and market differ by more than 20 percentage points, so the forecast is held for calibration review."] } };
  }
  if (!input.promotedProxy && valueSide === forecastSide && forecastEdge >= 5 && forecastPrice > -300 && forecastExpectedValue > 0) {
    return { selectedSide: forecastSide, forecastSide, valueSide, grade: { ...base, verdict: { key: "best_angle", label: "Best Angle" }, grade: "best_signal", recommendationScore: 82, candidateTier: "best_angle", reasons: ["The most likely result clears the validated 5-point de-vigged value floor and has positive exact forecast-side expected value."] } };
  }
  if (!input.promotedProxy && input.model[forecastSide] >= 0.5 && marketFavorite === forecastSide && forecastPrice > -300 && forecastExpectedValue > 0) {
    return { selectedSide: forecastSide, forecastSide, valueSide, grade: { ...base, verdict: { key: "lean", label: "Lean" }, grade: "model_only", recommendationScore: 62, candidateTier: "lean", reasons: ["The model assigns at least 50% to the same regulation winner favored by the market, and the exact forecast-side price has positive expected value. This is a winner-confidence Lean, not a Best Angle value claim."] } };
  }
  if ((input.model[forecastSide] >= 0.7 || !input.promotedProxy && input.model[forecastSide] >= 0.65) && marketFavorite === forecastSide && forecastPrice <= -300 && forecastExpectedValue > 0) {
    const reason = input.promotedProxy
      ? "High-confidence winner with positive exact-price expected value; one club uses a promoted-team proxy."
      : "High-confidence winner at a short price with positive exact-price expected value.";
    return { selectedSide: forecastSide, forecastSide, valueSide, grade: { ...base, verdict: { key: "lean", label: "Lean" }, grade: "model_only", recommendationScore: input.promotedProxy ? 54 : 58, candidateTier: "lean", reasons: [reason] } };
  }
  if ((!input.promotedProxy && valueSide === forecastSide && forecastEdge >= 5 && forecastPrice > -300)
    || (!input.promotedProxy && input.model[forecastSide] >= 0.5 && marketFavorite === forecastSide && forecastPrice > -300)
    || ((input.model[forecastSide] >= 0.7 || !input.promotedProxy && input.model[forecastSide] >= 0.65) && marketFavorite === forecastSide && forecastPrice <= -300)) {
    return { selectedSide: forecastSide, forecastSide, valueSide, grade: { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 42, candidateTier: "watchlist", reasons: ["The forecast clears an existing EPL confidence or gap threshold, but the exact forecast-side price does not have positive expected value."] } };
  }
  if (input.model[forecastSide] >= 0.55 && marketFavorite === forecastSide && forecastPrice <= -300) {
    return { selectedSide: forecastSide, forecastSide, valueSide, grade: { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 42, candidateTier: "watchlist", reasons: ["The model and market agree on the likely regulation winner, but the expensive quote and sub-65% model probability keep it at Watchlist."] } };
  }
  if (forecastPrice <= -300) {
    return { selectedSide: forecastSide, forecastSide, valueSide, grade: { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: 20, candidateTier: "market_aligned", reasons: ["No Play at the current price: the favorite does not clear the high-confidence threshold required to surface an expensive winner forecast."] } };
  }
  if (forecastEdge >= 2 && forecastPrice > -300) {
    return { selectedSide: forecastSide, forecastSide, valueSide, grade: { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 42, candidateTier: "watchlist", reasons: ["The most likely result clears the monitoring floor but not the validated Best Angle threshold."] } };
  }
  return { selectedSide: forecastSide, forecastSide, valueSide, grade: { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: 20, candidateTier: "market_aligned", reasons: [valueSide !== forecastSide && valueEdge >= 2 && valuePrice > -300
    ? "No Play: another outcome has the stronger price value, but it does not replace the model's most likely result."
    : "No Play: the most likely result does not clear a validated promotion path."] } };
}
