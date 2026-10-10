import {
  applyPublicMarketContext,
  type PublicMarketContext,
  type PublicMarketGrade,
  type PublicMarketSignal,
} from "../publicMarketContext";

export const WNBA_PUBLIC_MARKET_CONTEXT_VERSION =
  "wnba_public_market_context_v1_provenance_qualified_observation_only_2026_10_09" as const;

export type WnbaPublicMarketContext = PublicMarketContext & {
  contractVersion: typeof WNBA_PUBLIC_MARKET_CONTEXT_VERSION;
  productionDecisionEffect: false;
  qualification: "unverified_source_or_observation_time" | "no_complete_split_pair";
  observedSupport: PublicMarketContext["support"];
  observedConflict: PublicMarketContext["conflict"];
  observedReason: string | null;
};

/**
 * WNBA split rows are useful market observations, but the current provider
 * contract does not verify when the underlying source observed them or prove
 * that a money/ticket gap represents a distinct sharp book. Keep that context
 * visible in the audit payload without allowing a generic cross-sport threshold
 * to promote, demote, block, or flip a WNBA decision.
 */
export function observeWnbaPublicMarketContext(args: {
  grade: PublicMarketGrade;
  picked: PublicMarketSignal | null;
  opposite: PublicMarketSignal | null;
}): WnbaPublicMarketContext {
  const observed = applyPublicMarketContext({
    grade: args.grade,
    picked: args.picked,
    opposite: args.opposite,
  });
  const hasCompletePair =
    observed.pickedBetsPct !== null &&
    observed.pickedMoneyPct !== null &&
    observed.oppositeBetsPct !== null &&
    observed.oppositeMoneyPct !== null;

  return {
    ...observed,
    contractVersion: WNBA_PUBLIC_MARKET_CONTEXT_VERSION,
    productionDecisionEffect: false,
    qualification: hasCompletePair
      ? "unverified_source_or_observation_time"
      : "no_complete_split_pair",
    observedSupport: observed.support,
    observedConflict: observed.conflict,
    observedReason: observed.reason,
    support: "none",
    conflict: "none",
    gradeAfter: args.grade,
    reason: hasCompletePair
      ? "Public split retained as WNBA context only; source observation time and sharp-book provenance are not verified."
      : null,
  };
}
