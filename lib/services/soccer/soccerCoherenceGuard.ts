/**
 * Cross-market coherence guard for the WC model (2026-06-19).
 *
 * The model picks each market's side from its own marginal (P(side) > 0.5),
 * independently. Read together, those marginal picks can describe a scoreline
 * that's impossible — the classic case being "Team A to win + Under 2.5 + BTTS
 * Yes": both teams score AND total ≤ 2 forces a 1-1 scoreline, which is a DRAW,
 * so a win pick alongside it is mathematically impossible.
 *
 * Since every market derives from the SAME Dixon-Coles joint score distribution,
 * we can measure coherence directly: the probability mass on scorelines that
 * satisfy ALL the published picks at once. If that's implausibly low the picks
 * contradict each other and should not be published as confident plays.
 *
 * Pure: no DB, no React, no model state. Heavily unit-tested.
 */

import type { ScoreDistribution } from "./dixonColes";

export type MatchSide = "home" | "draw" | "away";
export type TotalSide = "over" | "under";
export type BttsSide = "yes" | "no";

/** Published (non-held) picks across the three score-determined WC markets.
 *  A null side means that market is held / not published → no constraint. */
export interface CrossMarketPicks {
  matchSide: MatchSide | null;
  totalSide: TotalSide | null;
  totalLine: number | null;
  bttsSide: BttsSide | null;
}

/**
 * Minimum share of the distribution the published picks must jointly cover to be
 * considered coherent. A genuine contradiction sits at ~0 (the favoring
 * scorelines literally cannot coexist); a coherent trio typically covers well
 * above this. Tunable single knob.
 */
export const COHERENCE_MIN_JOINT_PROB = 0.05;

/**
 * P(all PUBLISHED picks landing on the same scoreline), summed over the joint.
 * Held/absent markets impose no constraint. Push scorelines (total === line)
 * satisfy neither over nor under — excluded, matching totalFromDistribution.
 */
export function jointProbabilityOfPicks(joint: ScoreDistribution, picks: CrossMarketPicks): number {
  let p = 0;
  for (let h = 0; h < joint.length; h++) {
    for (let a = 0; a < joint[h].length; a++) {
      if (picks.matchSide !== null) {
        const ok = picks.matchSide === "home" ? h > a : picks.matchSide === "away" ? h < a : h === a;
        if (!ok) continue;
      }
      if (picks.totalSide !== null && picks.totalLine !== null) {
        const t = h + a;
        const ok = picks.totalSide === "over" ? t > picks.totalLine : t < picks.totalLine;
        if (!ok) continue;
      }
      if (picks.bttsSide !== null) {
        const both = h >= 1 && a >= 1;
        const ok = picks.bttsSide === "yes" ? both : !both;
        if (!ok) continue;
      }
      p += joint[h][a];
    }
  }
  return p;
}

export interface CoherenceVerdict {
  coherent: boolean;
  jointProb: number;
  /** Count of published (constraining) markets. 0–1 ⇒ always coherent. */
  pickedCount: number;
  reason: string;
}

/**
 * Are the published cross-market picks mutually satisfiable on one scoreline?
 * Coherent by definition when fewer than two markets are published. Otherwise
 * incoherent when the joint probability falls below COHERENCE_MIN_JOINT_PROB.
 */
export function assessCrossMarketCoherence(
  joint: ScoreDistribution,
  picks: CrossMarketPicks,
): CoherenceVerdict {
  const pickedCount = [picks.matchSide, picks.totalSide, picks.bttsSide].filter((s) => s !== null).length;
  const jointProb = jointProbabilityOfPicks(joint, picks);
  if (pickedCount < 2) {
    return { coherent: true, jointProb, pickedCount, reason: "fewer than two markets published — no cross-market constraint" };
  }
  const coherent = jointProb >= COHERENCE_MIN_JOINT_PROB;
  return {
    coherent,
    jointProb,
    pickedCount,
    reason: coherent
      ? `published picks share scorelines worth ${(jointProb * 100).toFixed(1)}% of the distribution`
      : `published picks are mutually contradictory — they coexist on only ${(jointProb * 100).toFixed(1)}% of scorelines (< ${(COHERENCE_MIN_JOINT_PROB * 100).toFixed(0)}%)`,
  };
}
