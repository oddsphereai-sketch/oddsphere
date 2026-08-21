import type { Grade } from "@/lib/types/domain/Grade";
import type { Verdict } from "@/lib/services/verdictDerivation";

export const NFL_REGULAR_DECISION_RELEASE =
  "nfl_regular_price_value_decision_shadow_2026_08_20_r2" as const;

export type NflRegularDecision = {
  decisionRelease: typeof NFL_REGULAR_DECISION_RELEASE;
  verdict: { key: Verdict; label: "No Play" | "Watchlist" | "Lean" | "Best Angle" };
  grade: Grade | null;
  recommendationScore: number;
  exactEvPct: number;
  probabilityGapPp: number;
  actionable: boolean;
  evidenceComplete: boolean;
  actionEvidenceComplete: boolean;
  reasons: string[];
};

const WATCHLIST_MIN_GAP_PP = 0.5;
const WATCHLIST_MIN_EV_PCT = -2.5;
const LEAN_MIN_GAP_PP = 1.5;
const LEAN_MIN_EV_PCT = 1.5;
const BEST_ANGLE_MIN_GAP_PP = 3;
const BEST_ANGLE_MIN_EV_PCT = 4;

/**
 * Frozen shadow policy for the regular NFL board.
 *
 * Public consensus splits remain display-only because no chronological NFL
 * split history exists. They cannot create or promote a play. A model row may
 * become actionable only through its probability, the exact named-book price,
 * a fresh availability snapshot, and a repeatable same-book price trail.
 */
export function deriveNflRegularDecision(input: {
  market: "moneyline" | "spread" | "total";
  modelProbability: number;
  marketFairProbability: number;
  priceAmerican: number;
  verifiedPriceObservations: number;
  availabilitySnapshotPresent: boolean;
  weatherSnapshotPresent: boolean;
  priceObservedAt: string;
  evaluatedAt?: string;
}): NflRegularDecision {
  const probabilityGapPp = round1((input.modelProbability - input.marketFairProbability) * 100);
  const exactEvPct = round1(expectedValuePerUnit(input.modelProbability, input.priceAmerican) * 100);
  const evaluatedAt = Date.parse(input.evaluatedAt ?? new Date().toISOString());
  const observedAt = Date.parse(input.priceObservedAt);
  const priceAgeMinutes = Number.isFinite(evaluatedAt) && Number.isFinite(observedAt)
    ? Math.max(0, (evaluatedAt - observedAt) / 60_000)
    : Number.POSITIVE_INFINITY;
  const finite = [input.modelProbability, input.marketFairProbability, input.priceAmerican]
    .every((value) => Number.isFinite(value));
  const evidenceComplete = finite &&
    input.modelProbability > 0 && input.modelProbability < 1 &&
    input.marketFairProbability > 0 && input.marketFairProbability < 1 &&
    input.priceAmerican !== 0 &&
    input.verifiedPriceObservations >= 2 &&
    input.availabilitySnapshotPresent &&
    priceAgeMinutes <= 360;
  // Weather is a promotion gate for totals, not a prerequisite for showing a
  // real forecast or a Watchlist. A missing game-time snapshot can therefore
  // never silently turn an early total into an actionable recommendation.
  const actionEvidenceComplete = evidenceComplete &&
    (input.market !== "total" || input.weatherSnapshotPresent);

  if (!evidenceComplete) {
    const reasons = [
      ...(!finite ? ["A complete finite probability and price are required."] : []),
      ...(input.verifiedPriceObservations < 2 ? ["At least two same-book price observations are required."] : []),
      ...(!input.availabilitySnapshotPresent ? ["The current availability snapshot is missing."] : []),
      ...(priceAgeMinutes > 360 ? ["The named-book price is stale and must be refreshed."] : []),
    ];
    return decision("no_play", null, 0, exactEvPct, probabilityGapPp, false, false, false, reasons);
  }

  if (actionEvidenceComplete && probabilityGapPp >= BEST_ANGLE_MIN_GAP_PP && exactEvPct >= BEST_ANGLE_MIN_EV_PCT && input.verifiedPriceObservations >= 3) {
    return decision("best_angle", "best_signal", 88, exactEvPct, probabilityGapPp, true, true, true, [
      "The model clears the frozen probability-gap and exact-price value gates with three same-book observations.",
    ]);
  }
  if (actionEvidenceComplete && probabilityGapPp >= LEAN_MIN_GAP_PP && exactEvPct >= LEAN_MIN_EV_PCT && input.verifiedPriceObservations >= 3) {
    return decision("lean", "model_only", 70, exactEvPct, probabilityGapPp, true, true, true, [
      "The model clears the frozen probability-gap and exact-price value gates with three same-book observations.",
    ]);
  }
  if (probabilityGapPp >= WATCHLIST_MIN_GAP_PP && exactEvPct >= WATCHLIST_MIN_EV_PCT) {
    return decision("watchlist", "model_only", 42, exactEvPct, probabilityGapPp, false, true, actionEvidenceComplete, [
      ...(input.market === "total" && !input.weatherSnapshotPresent
        ? ["A current game-time weather snapshot is required before this total can become actionable."]
        : ["The model has measurable support, but the exact offered price has not cleared the actionable value gate."]),
    ]);
  }
  return decision("no_play", null, 0, exactEvPct, probabilityGapPp, false, true, actionEvidenceComplete, [
    "The current exact price does not provide sufficient model value.",
  ]);
}

function decision(
  verdict: "no_play" | "watchlist" | "lean" | "best_angle",
  grade: Grade | null,
  recommendationScore: number,
  exactEvPct: number,
  probabilityGapPp: number,
  actionable: boolean,
  evidenceComplete: boolean,
  actionEvidenceComplete: boolean,
  reasons: string[],
): NflRegularDecision {
  const labels = { no_play: "No Play", watchlist: "Watchlist", lean: "Lean", best_angle: "Best Angle" } as const;
  return {
    decisionRelease: NFL_REGULAR_DECISION_RELEASE,
    verdict: { key: verdict, label: labels[verdict] },
    grade,
    recommendationScore,
    exactEvPct,
    probabilityGapPp,
    actionable,
    evidenceComplete,
    actionEvidenceComplete,
    reasons,
  };
}

function expectedValuePerUnit(probability: number, priceAmerican: number): number {
  const profit = priceAmerican > 0 ? priceAmerican / 100 : 100 / Math.abs(priceAmerican);
  return probability * profit - (1 - probability);
}

function round1(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(1)) : 0;
}

export const __NFL_REGULAR_DECISION_TEST__ = {
  WATCHLIST_MIN_GAP_PP,
  WATCHLIST_MIN_EV_PCT,
  LEAN_MIN_GAP_PP,
  LEAN_MIN_EV_PCT,
  BEST_ANGLE_MIN_GAP_PP,
  BEST_ANGLE_MIN_EV_PCT,
};
