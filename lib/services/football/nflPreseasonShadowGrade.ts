import type { Grade } from "@/lib/types/domain/Grade";
import type { Verdict } from "@/lib/services/verdictDerivation";

/**
 * Local-only preseason monitoring policy.
 *
 * This is deliberately not an actionable betting policy. The 2025 side
 * holdout failed its predictive gate, and comparable historical preseason
 * prices/participation plans are unavailable. The policy exists so the real
 * preseason pipeline can exercise the Daily Edge hierarchy without turning
 * an unvalidated disagreement with today's market into a Lean or Best Angle.
 */
export const NFL_PRESEASON_SHADOW_GRADE_RELEASE =
  "nfl_preseason_shadow_grade_policy_2026_08_19_r1" as const;
export const NFL_REGULAR_PIPELINE_PRESEASON_GRADE_RELEASE =
  "nfl_regular_pipeline_preseason_grade_policy_2026_08_20_r2" as const;

export type NflPreseasonShadowGradeInput = {
  market: "moneyline" | "spread" | "total";
  modelFamily?: "preseason_candidate" | "regular_candidate";
  modelProbability: number;
  marketProbability: number;
  priceAmerican: number;
};

export type NflPreseasonShadowGrade = {
  verdict: { key: Verdict; label: string };
  grade: Grade | null;
  recommendationScore: number;
  tier: "no_play" | "caution" | "watchlist";
  edgePp: number;
  reasons: string[];
};

const MONITOR_MODEL_PROBABILITY = 0.55;
const MONITOR_EDGE_PP = 3;
const CAUTION_MODEL_PROBABILITY = 0.53;
const CAUTION_EDGE_PP = 2.5;
const CALIBRATION_WARNING_EDGE_PP = 20;

export function deriveNflPreseasonShadowGrade(
  input: NflPreseasonShadowGradeInput,
): NflPreseasonShadowGrade {
  const edgePp = round1((input.modelProbability - input.marketProbability) * 100);
  if (
    !Number.isFinite(input.modelProbability) ||
    !Number.isFinite(input.marketProbability) ||
    !Number.isFinite(input.priceAmerican) ||
    input.modelProbability <= 0 ||
    input.modelProbability >= 1 ||
    input.marketProbability <= 0 ||
    input.marketProbability >= 1
  ) {
    return noPlay(edgePp, "No Play: a complete two-sided price and finite model probability are required.");
  }

  if (
    input.modelFamily !== "regular_candidate" &&
    edgePp >= CALIBRATION_WARNING_EDGE_PP
  ) {
    return {
      verdict: { key: "caution", label: "Caution" },
      grade: "model_only",
      recommendationScore: 18,
      tier: "caution",
      edgePp,
      reasons: [
        "The model and market differ by at least 20 percentage points. In preseason that is a calibration warning, not a betting edge.",
      ],
    };
  }

  if (input.modelFamily === "regular_candidate") {
    if (edgePp >= 10) {
      return {
        verdict: { key: "watchlist", label: "Watchlist" },
        grade: "model_only",
        recommendationScore: 30,
        tier: "watchlist",
        edgePp,
        reasons: [
          "The regular-season model and preseason market differ by at least 10 percentage points. The forecast stays visible for review, but the gap is not treated as a validated betting edge.",
        ],
      };
    }
    if (
      input.modelProbability >= MONITOR_MODEL_PROBABILITY &&
      edgePp >= MONITOR_EDGE_PP
    ) {
      return {
        verdict: { key: "watchlist", label: "Watchlist" },
        grade: "model_only",
        recommendationScore: 38,
        tier: "watchlist",
        edgePp,
        reasons: [
          "The Week 1 model pipeline clears its monitoring floor, but preseason participation risk and failed historical value thresholds cap it at Watchlist.",
        ],
      };
    }
    if (
      input.modelProbability >= CAUTION_MODEL_PROBABILITY &&
      edgePp >= CAUTION_EDGE_PP
    ) {
      return {
        verdict: { key: "watchlist", label: "Watchlist" },
        grade: "model_only",
        recommendationScore: 30,
        tier: "watchlist",
        edgePp,
        reasons: [
          "The Week 1 model has a modest preview signal. It remains a non-actionable Watchlist while regular-season grade thresholds are still under validation.",
        ],
      };
    }
    return noPlay(edgePp, "No Play: the Week 1 model does not clear the preseason monitoring floor.");
  }

  if (input.market === "total") {
    if (
      input.modelProbability >= MONITOR_MODEL_PROBABILITY &&
      edgePp >= MONITOR_EDGE_PP
    ) {
      return {
        verdict: { key: "watchlist", label: "Watchlist" },
        grade: "model_only",
        recommendationScore: 38,
        tier: "watchlist",
        edgePp,
        reasons: [
          "The total forecast clears the preseason monitoring floor. It remains Watchlist-only because historical market value and player participation are not validated.",
        ],
      };
    }
    if (
      input.modelProbability >= CAUTION_MODEL_PROBABILITY &&
      edgePp >= CAUTION_EDGE_PP
    ) {
      return {
        verdict: { key: "caution", label: "Caution" },
        grade: "model_only",
        recommendationScore: 22,
        tier: "caution",
        edgePp,
        reasons: [
          "The total has a modest model signal, but it does not clear the preseason Watchlist floor.",
        ],
      };
    }
    return noPlay(edgePp, "No Play: the total does not clear the preseason monitoring floor.");
  }

  if (
    input.modelProbability >= CAUTION_MODEL_PROBABILITY &&
    edgePp >= CAUTION_EDGE_PP
  ) {
    return {
      verdict: { key: "caution", label: "Caution" },
      grade: "model_only",
      recommendationScore: 20,
      tier: "caution",
      edgePp,
      reasons: [
        "The model has a side at the current price, but the failed 2025 side holdout caps every preseason moneyline and spread at Caution.",
      ],
    };
  }

  return noPlay(edgePp, "No Play: the side does not clear the preseason monitoring floor.");
}

function noPlay(edgePp: number, reason: string): NflPreseasonShadowGrade {
  return {
    verdict: { key: "no_play", label: "No Play" },
    grade: null,
    recommendationScore: 0,
    tier: "no_play",
    edgePp,
    reasons: [reason],
  };
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}
