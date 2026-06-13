/**
 * MLB-P0 — Probability-space regularization (the E-first fix).
 *
 * The V2.2 posterior blend shrinks the projection toward the market in
 * RUN space (capped ±2.5 runs), but the Poisson conversion can still
 * produce a betting probability that sits 15-30pp away from the no-vig
 * market price. That gap flows straight into edge = (model − market) and
 * manufactures phantom Best Angles — exactly the overconfidence the audit
 * found (a claimed 15-32pp edge converted to ~4pp of real edge, and totals
 * BA went sub-break-even).
 *
 * This module adds a SECOND, probability-space regularizer applied AFTER
 * the Poisson probability is computed and BEFORE edge/grade. It is a
 * shrink toward the no-vig market, not an anchor: the model keeps its
 * independent direction and a bounded amount of its conviction.
 *
 *   regularized = market + k · (raw − market)          (shrink toward market)
 *   |regularized − market| ≤ maxDistance               (hard distance cap)
 *
 * Properties:
 *   • It is a pure structural regularizer — NOT fit on outcomes — so it is
 *     safe to ship before any calibration sample accumulates (Platt /
 *     isotonic are deferred to P1 once n is large enough).
 *   • The pick/side is decided upstream from the RAW probability; this
 *     module only governs the magnitude used for edge + grade, so it never
 *     flips a pick.
 *   • capApplied === true means the raw model wanted to sit further from the
 *     market than the cap allows (raw edge > maxDistance/k) — a strong
 *     model-market disagreement that downstream treats as "needs market
 *     confirmation" before it can remain a Best Angle.
 *
 * Pure module. No env reads, no I/O.
 */

export type RegularizationReason = "probability_space_regularization";

export interface RegularizationInput {
  /** Raw model probability for the PICKED side, in [0,1]. Null = no model prob. */
  rawProb: number | null;
  /** No-vig market probability for the PICKED side, in [0,1]. Null = no market. */
  marketProb: number | null;
  /** Shrink factor toward market in [0,1]. 1 = no shrink, 0 = full market. */
  k: number;
  /** Maximum |regularized − market| distance, in percentage points. */
  maxDistancePp: number;
}

export interface RegularizationResult {
  rawProb: number | null;
  marketProb: number | null;
  /** market + clamp(k·(raw−market)). Equals rawProb when marketProb is null. */
  regularizedProb: number | null;
  /** (raw − market)·100. Null when marketProb is null. */
  rawEdgePct: number | null;
  /** (regularized − market)·100, after the distance cap. Null when no market. */
  regularizedEdgePct: number | null;
  /** k actually used. */
  shrinkFactor: number;
  /** Distance cap (pp) actually used. */
  distanceCapPp: number;
  /** True when the post-shrink distance hit the cap (raw edge > cap/k). */
  capApplied: boolean;
  reason: RegularizationReason;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Regularize a raw model probability toward the no-vig market probability.
 *
 * When marketProb is null there is no shrink target — the raw probability
 * passes through unchanged and both edges are null (no market to compare
 * against), matching the existing "ouMarketProb null → ou_edge_pct null"
 * contract. When rawProb is null everything is null.
 */
export function regularizeProbability(
  input: RegularizationInput,
): RegularizationResult {
  const { rawProb, marketProb, k, maxDistancePp } = input;
  const base = {
    rawProb,
    marketProb,
    shrinkFactor: k,
    distanceCapPp: maxDistancePp,
    reason: "probability_space_regularization" as const,
  };

  if (rawProb === null) {
    return {
      ...base,
      regularizedProb: null,
      rawEdgePct: null,
      regularizedEdgePct: null,
      capApplied: false,
    };
  }

  if (marketProb === null) {
    // No market target — keep the raw probability, no edge defined.
    return {
      ...base,
      regularizedProb: rawProb,
      rawEdgePct: null,
      regularizedEdgePct: null,
      capApplied: false,
    };
  }

  const rawEdgePp = (rawProb - marketProb) * 100;
  // Shrink toward market in probability space.
  const shrunkDistancePp = k * rawEdgePp; // = (market + k·(raw−market) − market)·100
  const capApplied = Math.abs(shrunkDistancePp) > maxDistancePp;
  const cappedDistancePp = capApplied
    ? Math.sign(shrunkDistancePp) * maxDistancePp
    : shrunkDistancePp;
  const regularizedProb = marketProb + cappedDistancePp / 100;

  return {
    ...base,
    regularizedProb,
    rawEdgePct: round1(rawEdgePp),
    regularizedEdgePct: round1(cappedDistancePp),
    capApplied,
  };
}
