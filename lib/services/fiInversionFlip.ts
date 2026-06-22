/**
 * First-inning NRFI overconfident mid-band flip (2026-06-22).
 *
 * Evidence (graded 6/1-6/22, NRFI picks only): the model's CONFIDENT NRFI picks
 * in the mid-probability band [0.57, 0.63) are an INVERTED cohort — shipped NRFI
 * loses in both halves of the window, but betting the OPPOSITE side (YRFI) at
 * real YRFI prices is positive out-of-sample across every band variant tested
 * (e.g. .57-.63 → +12.3u in-sample / +7.5u out-of-sample). This is the FI twin
 * of the ML inverted-cohort flip: the same mid-confidence overconfidence band
 * that makes MLB Leans fail. Low NRFI conviction (.53-.57) and high (.63+) are
 * left alone — they grade fine; only the overconfident valley is faded.
 *
 * Pure helper. Decides whether to flip the OFFICIAL/tracked FI recommendation
 * NRFI→YRFI and returns the YRFI-priced fields. Never fabricates a price: if the
 * YRFI odds are missing it does not flip (the original NRFI pick is kept — never
 * a No Play). Only NRFI picks are eligible; YRFI and Toss-Up are never flipped.
 * The underlying model opinion is untouched; only prediction_records flips, with
 * full audit.
 */

import { flipRecommendationConfidence } from "./flipConfidence";

export const FI_INVERSION_RULE_ID = "fi_nrfi_overconfident_midband_flip_v1";
/** Inclusive lower / exclusive upper NRFI-probability bounds of the flip band. */
export const FI_FLIP_PROB_LOW = 0.57;
export const FI_FLIP_PROB_HIGH = 0.63;

export type FiSide = "nrfi" | "yrfi" | "tossup";

export type FiFlipInput = {
  /** Current FI pick. Only "nrfi" is eligible to flip. */
  predictedSide: FiSide | null;
  /** Model NRFI probability (0-1) — the cohort selector. */
  nrfiProbability: number | null;
  /** Final FI confidence, 0-100; drives member-facing recommendation confidence. */
  originalConfidence: number | null;
  /** Market (no-vig) prob for NRFI (0-1), for audit. */
  nrfiMarketProb: number | null;
  /** Opposite-side (YRFI) odds; flip only fires with a real price. */
  yrfiOdds: number | null;
};

export type FiFlipResult =
  | {
      flipped: true;
      rule_id: string;
      flippedSide: "yrfi";
      flippedOdds: number;
      /** Raw YRFI model probability (< 0.5) — AUDIT ONLY, never displayed. */
      flippedSideModelProb: number | null;
      flippedMarketProb: number | null;
      flippedEdgePp: number | null;
      /** Member-facing conservative recommendation confidence (>= 55). */
      recommendationConfidence: number;
    }
  | { flipped: false; reason: string };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function resolveFiInversionFlip(i: FiFlipInput): FiFlipResult {
  if (i.predictedSide !== "nrfi") {
    return { flipped: false, reason: "not_nrfi_pick" };
  }
  if (
    i.nrfiProbability === null ||
    !Number.isFinite(i.nrfiProbability) ||
    !(i.nrfiProbability >= FI_FLIP_PROB_LOW && i.nrfiProbability < FI_FLIP_PROB_HIGH)
  ) {
    return { flipped: false, reason: "nrfi_prob_out_of_band" };
  }
  const flippedOdds = i.yrfiOdds;
  if (flippedOdds === null || flippedOdds === undefined || !Number.isFinite(flippedOdds)) {
    return { flipped: false, reason: "missing_yrfi_odds" };
  }
  const flippedSideModelProb = i.nrfiProbability !== null ? 1 - i.nrfiProbability : null;
  const flippedMarketProb = i.nrfiMarketProb !== null ? 1 - i.nrfiMarketProb : null;
  const flippedEdgePp =
    flippedSideModelProb !== null && flippedMarketProb !== null
      ? round1((flippedSideModelProb - flippedMarketProb) * 100)
      : null;
  return {
    flipped: true,
    rule_id: FI_INVERSION_RULE_ID,
    flippedSide: "yrfi",
    flippedOdds,
    flippedSideModelProb,
    flippedMarketProb,
    flippedEdgePp,
    recommendationConfidence: flipRecommendationConfidence(i.originalConfidence),
  };
}
