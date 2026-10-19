import type { Grade } from "@/lib/types/domain/Grade";

export const UCL_PREVIEW_GRADE_RELEASE =
  "ucl_grade_policy_2026_10_19_r12_exact_team_identity_coverage" as const;

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

function exactPriceExpectedValue(probability: number, american: number): number {
  const decimal = american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
  return probability * decimal - 1;
}

/** Frozen UCL-owned fork of the EPL v23 hierarchy. */
export function deriveUclPreviewGrade(input: {
  market: UclPreviewMarket;
  edgePp: number | null;
  modelProbability?: number | null;
  priceAmerican: number | null;
  coherentMarket: boolean;
  promotedProxy: boolean;
  meanProbabilityDisagree?: boolean;
}): UclPreviewGrade {
  const base = { release: UCL_PREVIEW_GRADE_RELEASE } as const;
  if (!input.coherentMarket || input.edgePp === null || input.priceAmerican === null) {
    return { ...base, verdict: { key: "no_play", label: "No Play" }, grade: null, recommendationScore: null, candidateTier: "data_hold", reasons: ["No Play until a coherent current price is available for this UCL market."] };
  }

  if (input.market !== "match_result") {
    if (input.market === "total" || input.market === "btts") {
      const marketLabel = input.market === "total" ? "Total" : "BTTS";
      const modelProbability = input.modelProbability ?? 0;
      const forecastSideEv = exactPriceExpectedValue(modelProbability, input.priceAmerican);
      if (modelProbability >= 0.55 && forecastSideEv > 0) {
        return { ...base, verdict: { key: "lean", label: "Lean" }, grade: "model_only", recommendationScore: Math.round(45 + (modelProbability - 0.5) * 200), candidateTier: "lean", reasons: [`${marketLabel} clears the transferred 55% forecast floor and has positive exact forecast-side expected value.`] };
      }
      if (modelProbability >= 0.55) {
        return { ...base, verdict: { key: "watchlist", label: "Watchlist" }, grade: "market_watch", recommendationScore: 40, candidateTier: "watchlist", reasons: [`${marketLabel} clears the transferred 55% forecast floor, but its exact forecast-side price does not have positive expected value.`] };
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
  marketReader?: {
    consensusLeader: MatchResultSide | null;
    evaluatedLeader: MatchResultSide | null;
  };
}) {
  const forecastSide = input.forecastSide ?? maximum(input.model);
  const base = { release: UCL_PREVIEW_GRADE_RELEASE } as const;
  if (!input.market || !input.prices) {
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
  const forecastSideEv = exactPriceExpectedValue(probability, price);
  const lateAgrees = input.marketReader?.consensusLeader === forecastSide;
  const evaluatedAgrees = input.marketReader?.evaluatedLeader === forecastSide;
  const qualifies = probability >= 0.60
    && probability < 0.70
    && lateAgrees
    && evaluatedAgrees
    && price > -600
    && forecastSideEv > 0;

  if (qualifies) {
    return {
      selectedSide: forecastSide,
      forecastSide,
      valueSide,
      grade: {
        ...base,
        verdict: { key: "lean" as const, label: "Lean" },
        grade: "model_only" as const,
        recommendationScore: Math.round(60 + (probability - 0.60) * 100),
        candidateTier: "lean" as const,
        reasons: ["The fixed UCL forecast is in the validated winner-confidence band, both target-excluded consensus and the evaluated book agree, and the exact forecast-side price has positive expected value."],
      },
    };
  }

  if (probability >= 0.50 && lateAgrees && evaluatedAgrees && price > -600) {
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
        reasons: ["The forecast and both market directions agree, but the result does not clear the validated 60% to 70% Lean band."],
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
          ? "No Play: the current Match Result quote is outside the validated UCL Lean price range."
          : "No Play: this result does not satisfy the validated UCL forecast-and-market agreement lane.",
      ],
    },
  };
}
