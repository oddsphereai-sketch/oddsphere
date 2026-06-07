/**
 * Phase 7A Stage 1 — sample-size thresholds for calibration findings.
 *
 * Pure module — no DB, no side effects.
 *
 * Rationale: calibration metrics are noisy at small n. Treating a 0.10 ECE
 * computed over 12 picks as actionable is how you accidentally chase
 * variance. We gate findings into three classes:
 *
 *   • insufficient — below the per-market minimum. Computed for the report
 *     but flagged loudly. Never used to drive a recommendation.
 *   • exploratory  — above the minimum, below the confident threshold.
 *     Directionally meaningful, not enough to act on.
 *   • confident    — above the confident threshold. Suitable input for
 *     Phase 7A Stage 2 shadow proposals (later, not in Stage 1).
 *
 * Stage 1 only USES these classifications in report annotations. It never
 * gates DB writes (because Stage 1 doesn't write anything). Stage 4
 * auto-apply will read these same thresholds as one of its 4-layer guards.
 *
 * Per-market thresholds reflect outcome variance:
 *   • moneyline:     binary, ~50/50 base rate, modest variance → 100/400
 *   • total:         binary at the line, more dependent on game flow → 200/800
 *   • first_inning:  short window, high per-game variance → 400/1600
 *
 * These can be tuned in Phase 7A Stage 2 when we have a larger backlog of
 * settled grades to evaluate against. Do not change them here without
 * updating the math/report tests that pin specific boundaries.
 */

export type SampleSizeClass = "insufficient" | "exploratory" | "confident";

export type SampleSizeThreshold = {
  /** Below this n, classification is "insufficient". */
  min: number;
  /** At or above this n, classification is "confident". */
  confident: number;
};

export const SAMPLE_SIZE_THRESHOLDS: Record<string, SampleSizeThreshold> = {
  moneyline:    { min: 100, confident: 400 },
  total:        { min: 200, confident: 800 },
  first_inning: { min: 400, confident: 1600 },
  nrfi:         { min: 400, confident: 1600 },
  yrfi:         { min: 400, confident: 1600 },
  /** Cross-cuts that don't map to a single market (e.g., "overall", "by sport"). */
  default:      { min: 200, confident: 800 },
};

export function classifySampleSize(n: number, market: string = "default"): SampleSizeClass {
  const t = SAMPLE_SIZE_THRESHOLDS[market] ?? SAMPLE_SIZE_THRESHOLDS.default;
  if (n < t.min) return "insufficient";
  if (n < t.confident) return "exploratory";
  return "confident";
}
