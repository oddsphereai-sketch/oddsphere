import type { EplPreviewGrade, EplPreviewMarket } from "@/lib/services/epl/eplPreviewGrade";

export const UCL_PREVIEW_GRADE_RELEASE =
  "ucl_grade_policy_2026_09_03_r5_calibration_price_unavailable_no_action" as const;

const HOLD_REASON =
  "No Play: UCL forecast validation does not establish an untouched exact-price promotion rule.";

export function deriveUclPreviewGrade(input: {
  market: EplPreviewMarket;
  edgePp: number | null;
  modelProbability?: number | null;
  priceAmerican: number | null;
  coherentMarket: boolean;
  promotedProxy: boolean;
  meanProbabilityDisagree?: boolean;
}): EplPreviewGrade {
  const missing = !input.coherentMarket || input.edgePp === null || input.priceAmerican === null;
  return {
    release: UCL_PREVIEW_GRADE_RELEASE,
    verdict: { key: "no_play", label: "No Play" },
    grade: null,
    recommendationScore: missing ? null : 0,
    candidateTier: missing ? "data_hold" : "research_only",
    reasons: [missing
      ? "No Play until a coherent current price is available for this UCL market."
      : HOLD_REASON],
  };
}

type MatchResultSide = "home" | "draw" | "away";

function maximum(values: Record<MatchResultSide, number>): MatchResultSide {
  return (["home", "draw", "away"] as const)
    .reduce((best, side) => values[side] > values[best] ? side : best, "home");
}

export function deriveUclMatchResultDecision(input: {
  model: Record<MatchResultSide, number>;
  market: Record<MatchResultSide, number> | null;
  prices: Record<MatchResultSide, number> | null;
  promotedProxy: boolean;
}) {
  const forecastSide = maximum(input.model);
  const valueSide = input.market
    ? maximum({
        home: input.model.home - input.market.home,
        draw: input.model.draw - input.market.draw,
        away: input.model.away - input.market.away,
      })
    : null;
  return {
    selectedSide: forecastSide,
    forecastSide,
    valueSide,
    grade: deriveUclPreviewGrade({
      market: "match_result",
      edgePp: input.market ? (input.model[forecastSide] - input.market[forecastSide]) * 100 : null,
      modelProbability: input.model[forecastSide],
      priceAmerican: input.prices?.[forecastSide] ?? null,
      coherentMarket: input.market !== null && input.prices !== null,
      promotedProxy: input.promotedProxy,
    }),
  };
}
