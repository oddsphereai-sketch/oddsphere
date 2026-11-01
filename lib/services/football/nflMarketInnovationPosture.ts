import type { NflV1ActionableGradeBundle } from "./nflV1ActionableGradeCandidate";
import type { NflMarketInnovationReceipt } from "./nflMarketInnovationRuntime";

export const NFL_MARKET_INNOVATION_POSTURE_RELEASE =
  "nfl_market_innovation_posture_2026_11_01_r1_unresolved_named_episodes" as const;

export type NflMarketInnovationPostureReceipt = {
  release: typeof NFL_MARKET_INNOVATION_POSTURE_RELEASE;
  evaluations: Array<{
    market: "moneyline" | "spread" | "total";
    pickedDirection: -1 | 1 | null;
    unresolvedReason: string | null;
    opposingSources: string[];
    previousGrade: string;
    finalGrade: string;
    action: "retained" | "best_angle_to_lean" | "locked_unchanged";
  }>;
  boardImpact: { bestAngleToLean: number; actionableBefore: number; actionableAfter: number };
};

/**
 * Unresolved named-price disagreements temper only the strongest endorsement.
 * An adverse episode already incorporated into the final law is adjudicated,
 * and cannot independently cap the surviving statistical edge. Static market
 * favorites, public counts and unknown information overlap grant no veto.
 */
export function applyNflMarketInnovationPosture(args: {
  production: NflV1ActionableGradeBundle;
  innovation: NflMarketInnovationReceipt;
  homeTeam: string;
  existingLockedRecord?: boolean;
  /** Writer-only attestation: this T-60 tuple has not yet been stored. */
  creatingNewLock?: boolean;
}): { production: NflV1ActionableGradeBundle; posture: NflMarketInnovationPostureReceipt } {
  const evaluations: NflMarketInnovationPostureReceipt["evaluations"] = [];
  let changes = 0;
  const evaluatedBets = args.production.evaluatedBets.map((decision) => {
    const reason = args.innovation.reasons[decision.market];
    const unresolvedReason = reason === "opposed_named_economic_episodes" ||
      reason === "joint_score_constraints_unidentifiable" ? reason : null;
    const pickedDirection = decision.market === "total"
      ? /^Over\s/i.test(decision.side) ? 1 : /^Under\s/i.test(decision.side) ? -1 : null
      : decision.side === args.homeTeam ? 1 : -1;
    const opposingSources = unresolvedReason && pickedDirection !== null
      ? [...new Set(args.innovation.episodes.filter((episode) =>
          episode.market === decision.market && !episode.selected && episode.direction === -pickedDirection &&
          Number.isFinite(episode.magnitude) && Math.abs(episode.magnitude) > 1e-12)
        .map((episode) => episode.book))].sort()
      : [];
    const locked = args.existingLockedRecord === true || (args.creatingNewLock !== true &&
      (decision.stage === "t60_locked" || decision.lockedAt !== null));
    const demote = !locked && decision.grade === "Best Angle" && opposingSources.length > 0;
    if (demote) changes++;
    evaluations.push({ market: decision.market, pickedDirection, unresolvedReason, opposingSources,
      previousGrade: decision.grade, finalGrade: demote ? "Lean" : decision.grade,
      action: locked ? "locked_unchanged" : demote ? "best_angle_to_lean" : "retained" });
    // Preserve every numerical, execution and evidence field exactly. There is
    // no second probability/score update or reconstruction of a legacy tuple.
    return demote ? { ...decision, grade: "Lean" } : decision;
  });
  const actionable = (rows: typeof evaluatedBets) => rows.filter(row => row.grade === "Best Angle" || row.grade === "Lean").length;
  return { production: changes ? { ...args.production, evaluatedBets } : args.production,
    posture: { release: NFL_MARKET_INNOVATION_POSTURE_RELEASE, evaluations,
      boardImpact: { bestAngleToLean: changes, actionableBefore: actionable(args.production.evaluatedBets),
        actionableAfter: actionable(evaluatedBets) } } };
}
