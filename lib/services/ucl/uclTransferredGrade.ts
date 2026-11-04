import type { Grade } from "@/lib/types/domain/Grade";
import type { UclRelativeMarketAxisReceipt } from "./uclRelativeMarketRead";

export const UCL_PREVIEW_GRADE_RELEASE =
  "ucl_grade_policy_2026_11_04_r25_current_strength_scoring_prior" as const;

export type UclPreviewMarket = "match_result" | "double_chance" | "total" | "btts";
export type UclPreviewGrade = {
  release: typeof UCL_PREVIEW_GRADE_RELEASE;
  verdict: { key: "no_play" | "caution" | "watchlist" | "lean" | "best_angle"; label: string };
  grade: Grade | null;
  recommendationScore: number | null;
  candidateTier: "data_hold" | "research_only" | "market_aligned" | "watchlist" | "lean_candidate" | "lean" | "best_angle" | "caution";
  reasons: string[];
};

const WATCH_FLOOR: Record<UclPreviewMarket, number> = { match_result: 2, double_chance: 4, total: 2.5, btts: 3 };
const LEAN_CANDIDATE_FLOOR: Record<UclPreviewMarket, number> = { match_result: 4, double_chance: 6, total: 4.5, btts: 5 };

export function uclExactPriceExpectedValue(probability: number, american: number): number {
  const decimal = american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
  return probability * decimal - 1;
}

export type ForecastSide = "home" | "draw" | "away" | "over" | "under" | "yes" | "no";

/** Price movement confirms a prediction; it is not an independent value quote.
 * A native Total's currentTargetProbabilities are its translated2.5 outlook,
 * never its different-contract settlement shares. */
function movementConfirmation(market: UclPreviewMarket, side: ForecastSide | undefined,
  read: UclRelativeMarketAxisReceipt | undefined): { aligned: boolean; originator: boolean } {
  const no = { aligned: false, originator: false };
  const sides = market === "match_result" ? ["home", "draw", "away"] : market === "total" ? ["over", "under"] : market === "btts" ? ["yes", "no"] : [];
  if (!side || !sides.includes(side) || !read || read.status !== "applied" || read.pickedSide !== side ||
    !read.selected || !["named_originator", "named_retail", "named_other"].includes(read.selected.sourceClass) ||
    read.currentTargetProbabilityBasis === "unavailable" ||
    read.latestLegFullyObserved !== true || !read.currentSupportsPick || !read.latestInformativeSupportsPick || read.roundTrip || read.conflicted || read.opposingCandidates ||
    ["flat", "mixed", "unknown"].includes(read.direction) || ["flat", "mixed", "unknown"].includes(read.latestInformativeDirection)) return no;
  const probabilities = read.currentTargetProbabilities as Partial<Record<ForecastSide, number>> | null;
  if (!probabilities || sides.some(key => typeof probabilities[key as ForecastSide] !== "number" ||
    !Number.isFinite(probabilities[key as ForecastSide]) || probabilities[key as ForecastSide]! < 0 || probabilities[key as ForecastSide]! > 1) ||
    Math.abs(sides.reduce((sum, key) => sum + probabilities[key as ForecastSide]!, 0) - 1) > 1e-9) return no;
  return { aligned: true, originator: read.selected.sourceClass === "named_originator" && !read.retraced };
}

export function actionableGrade(input: { market: "match_result" | "total" | "btts"; probability: number; price: number;
  fairProbability: number | null; side?: ForecastSide; read?: UclRelativeMarketAxisReceipt; legacyLean: boolean }): UclPreviewGrade | null {
  if (!Number.isFinite(input.probability) || input.probability <= 0 || input.probability >= 1 ||
    !Number.isFinite(input.price) || Math.abs(input.price) < 100 || input.price < -350) return null;
  const confirmed = movementConfirmation(input.market, input.side, input.read);
  const ev = uclExactPriceExpectedValue(input.probability, input.price);
  const leanFloor = input.market === "match_result" ? 0.60 : 0.55;
  const bestFloor = input.market === "match_result" ? 0.65 : 0.60;
  const implied = input.price > 0 ? 100 / (input.price + 100) : -input.price / (-input.price + 100);
  const q = input.fairProbability;
  const pairedBookSum = q !== null && Number.isFinite(q) && q > 0 && q < 1 ? implied / q : NaN;
  // The exact paired-book margin supplies the allowance, not a fixed model-gap
  // or negative-EV cutoff. A large price/model disagreement cannot become Lean
  // merely because a price path supports the same outcome.
  const withinPairedVigEnvelope = Number.isFinite(pairedBookSum) && pairedBookSum >= 0.98 - 1e-12 && pairedBookSum <= 1.25 + 1e-12 &&
    input.probability + 1e-12 >= implied - Math.max(0, pairedBookSum - 1);
  if (input.probability >= bestFloor && input.price >= -200 && ev > 0 && confirmed.originator) {
    return { release: UCL_PREVIEW_GRADE_RELEASE, verdict: { key: "best_angle", label: "Best Angle" }, grade: "best_signal",
      recommendationScore: 82, candidateTier: "best_angle", reasons: ["The forecast clears the strong-confidence floor, has positive exact-price expected value, and has clean originator movement confirmation."] };
  }
  if (input.probability >= leanFloor && (input.legacyLean || confirmed.aligned && withinPairedVigEnvelope)) {
    return { release: UCL_PREVIEW_GRADE_RELEASE, verdict: { key: "lean", label: "Lean" },
      grade: input.legacyLean ? "model_only" : "market_led", recommendationScore: input.market === "match_result"
        ? Math.round(60 + (input.probability - 0.60) * 100) : Math.round(45 + (input.probability - 0.5) * 200),
      candidateTier: "lean", reasons: [input.legacyLean
        ? "The forecast clears its confidence floor and the existing positive exact-price value lane."
        : "The forecast clears its confidence floor with aligned observed price movement and current-market support. Exact-price expected value remains separately recorded."] };
  }
  return null;
}

/** UCL-owned confidence, observed-market and price-aware policy. */
export function deriveUclPreviewGrade(input: {
  market: UclPreviewMarket;
  edgePp: number | null;
  modelProbability?: number | null;
  priceAmerican: number | null;
  coherentMarket: boolean;
  promotedProxy: boolean;
  meanProbabilityDisagree?: boolean;
  forecastSide?: ForecastSide;
  marketRead?: UclRelativeMarketAxisReceipt;
}): UclPreviewGrade {
  const base = { release: UCL_PREVIEW_GRADE_RELEASE } as const;
  if (!input.coherentMarket || input.edgePp === null || !Number.isFinite(input.edgePp) || input.priceAmerican === null ||
    !Number.isFinite(input.priceAmerican) || Math.abs(input.priceAmerican) < 100) {
    return { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: null, candidateTier: "data_hold", reasons: ["No Play until a coherent current price is available for this UCL market."] };
  }

  if (input.market !== "match_result") {
    if (input.market === "total" || input.market === "btts") {
      const marketLabel = input.market === "total" ? "Total" : "BTTS";
      const modelProbability = input.modelProbability ?? 0;
      const forecastSideEv = uclExactPriceExpectedValue(modelProbability, input.priceAmerican);
      const actionable = actionableGrade({ market: input.market, probability: modelProbability, price: input.priceAmerican,
        fairProbability: modelProbability - input.edgePp / 100,
        side: input.forecastSide, read: input.marketRead, legacyLean: forecastSideEv > 0 });
      if (actionable) return actionable;
      if (modelProbability >= 0.55) {
        return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 40, candidateTier: "watchlist", reasons: [input.priceAmerican < -350
          ? `${marketLabel} clears the 55% forecast floor, but its quote is outside the Lean price range.`
          : `${marketLabel} clears the 55% forecast floor, but its current price and movement evidence do not qualify a Lean.`] };
      }
      if (modelProbability >= 0.53) {
        return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 40, candidateTier: "watchlist", reasons: [`${marketLabel} clears the transferred monitoring band but not the 55% Lean floor.`] };
      }
      return { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: 25, candidateTier: "research_only", reasons: [`${marketLabel} does not clear the transferred 53% monitoring floor.`] };
    }

    if ((input.modelProbability ?? 0) >= 0.72 && input.edgePp >= 0) {
      return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 35, candidateTier: "watchlist", reasons: ["Strong Double Chance forecast with a coherent current price. Monitor only; the transferred policy has no actionable Double Chance threshold."] };
    }
    return { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: 0, candidateTier: "research_only", reasons: ["No Play: Double Chance is coherently derived and tracked, but the transferred policy has no actionable threshold."] };
  }

  if (input.meanProbabilityDisagree) {
    return { ...base, verdict: { key: "caution", label: "Caution" }, grade: "sharp_conflict", recommendationScore: 20, candidateTier: "caution", reasons: ["The probability side and projected scoring mean point in different directions."] };
  }
  const directActionable = actionableGrade({ market: "match_result", probability: input.modelProbability ?? 0,
    fairProbability: input.modelProbability === undefined || input.modelProbability === null ? null : input.modelProbability - input.edgePp / 100,
    price: input.priceAmerican, side: input.forecastSide, read: input.marketRead, legacyLean: false });
  if (directActionable) return directActionable;
  if (input.priceAmerican <= -300) {
    return { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: 20, candidateTier: "market_aligned", reasons: ["No Play at the current price: the likely outcome may still be correct, but a quote of -300 or shorter is not a standalone value claim."] };
  }
  if (Math.abs(input.edgePp) > 20) {
    return { ...base, verdict: { key: "caution", label: "Caution" }, grade: "sharp_conflict", recommendationScore: 18, candidateTier: "caution", reasons: ["Model and market differ by more than 20 percentage points, which is treated as a data or calibration warning."] };
  }
  if (input.edgePp < WATCH_FLOOR[input.market]) {
    return { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: Math.max(15, Math.min(35, 25 + input.edgePp * 2)), candidateTier: "market_aligned", reasons: ["No Play: the model-market gap does not clear the transferred Watchlist floor."] };
  }
  if (input.promotedProxy) {
    return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 35, candidateTier: "watchlist", reasons: ["Positive model-market gap, capped because at least one club uses a sparse cross-league prior."] };
  }
  if (input.edgePp >= LEAN_CANDIDATE_FLOOR[input.market]) {
    return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 45, candidateTier: "lean_candidate", reasons: ["The gap is worth monitoring, but this transferred path does not have an actionable UCL threshold."] };
  }
  return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 38, candidateTier: "watchlist", reasons: ["The gap clears the transferred Watchlist floor but not an actionable threshold."] };
}

type MatchResultSide = "home" | "draw" | "away";

function maximum(values: Record<MatchResultSide, number>): MatchResultSide {
  return (["home", "draw", "away"] as const).reduce((best, side) => values[side] > values[best] ? side : best, "home");
}

export function deriveUclMatchResultDecision(input: {
  model: Record<MatchResultSide, number>;
  market: Record<MatchResultSide, number> | null;
  prices: Record<MatchResultSide, number> | null;
  promotedProxy: boolean;
  forecastSide?: MatchResultSide;
  marketRead?: UclRelativeMarketAxisReceipt;
  marketReader?: {
    consensusLeader: MatchResultSide | null;
    evaluatedLeader: MatchResultSide | null;
  };
}) {
  const forecastSide = input.forecastSide ?? maximum(input.model);
  const base = { release: UCL_PREVIEW_GRADE_RELEASE } as const;
  if (!input.market || !input.prices || (["home", "draw", "away"] as const).some(side =>
    !Number.isFinite(input.prices![side]) || Math.abs(input.prices![side]) < 100 || !Number.isFinite(input.market![side]))) {
    return {
      selectedSide: forecastSide,
      forecastSide,
      valueSide: null,
      grade: deriveUclPreviewGrade({
        market: "match_result",
        edgePp: null,
        priceAmerican: null,
        coherentMarket: false,
        promotedProxy: input.promotedProxy,
      }),
    };
  }

  const edges = {
    home: (input.model.home - input.market.home) * 100,
    draw: (input.model.draw - input.market.draw) * 100,
    away: (input.model.away - input.market.away) * 100,
  };
  const valueSide = maximum(edges);
  const probability = input.model[forecastSide];
  const price = input.prices[forecastSide];
  const forecastSideEv = uclExactPriceExpectedValue(probability, price);
  const lateAgrees = input.marketReader?.consensusLeader === forecastSide;
  const evaluatedAgrees = input.marketReader?.evaluatedLeader === forecastSide;
  const qualifies = lateAgrees
    && evaluatedAgrees
    && forecastSideEv > 0;
  const actionable = actionableGrade({ market: "match_result", probability, price, side: forecastSide,
    fairProbability: input.market[forecastSide], read: input.marketRead, legacyLean: qualifies });
  if (actionable) {
    return {
      selectedSide: forecastSide,
      forecastSide,
      valueSide,
      grade: actionable,
    };
  }

  // Match Result is a three-outcome market: the leading outcome need not
  // exceed 50%. Agreement can justify monitoring without claiming bet value.
  const isForecastPlurality = forecastSide === maximum(input.model);
  if (isForecastPlurality && lateAgrees && evaluatedAgrees && price > -600) {
    return {
      selectedSide: forecastSide,
      forecastSide,
      valueSide,
      grade: {
        ...base,
        verdict: { key: "watchlist" as const, label: "Watchlist" },
        grade: "market_watch" as const,
        recommendationScore: 42,
        candidateTier: "watchlist" as const,
        reasons: ["The leading three-way forecast and both market directions agree. An actionable Lean still requires its confidence floor, reasonable price and qualified value or observed movement."],
      },
    };
  }

  return {
    selectedSide: forecastSide,
    forecastSide,
    valueSide,
    grade: {
      ...base,
      verdict: { key: "no_play" as const, label: "No Play" },
      grade: null,
      recommendationScore: 20,
      candidateTier: "market_aligned" as const,
      reasons: [
        price <= -600
          ? "No Play: the current Match Result quote is outside the UCL monitoring price range."
          : "No Play: this result does not satisfy the UCL forecast-and-market qualification lanes.",
      ],
    },
  };
}
