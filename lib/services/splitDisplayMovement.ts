import type { SplitSideDisplay } from "@/lib/types/domain/RecommendationDecision";

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Adds display-only point changes without changing the underlying split read. */
export function withFirstTrackedSplitObservation(
  current: SplitSideDisplay,
  previous: Pick<SplitSideDisplay, "moneyPct" | "betsPct" | "observedAt"> | null,
): SplitSideDisplay {
  if (!previous) return current;
  const currentMoney = finite(current.moneyPct);
  const previousMoney = finite(previous.moneyPct);
  const currentBets = finite(current.betsPct);
  const previousBets = finite(previous.betsPct);
  return {
    ...current,
    moneyDeltaPp: currentMoney === null || previousMoney === null ? null : currentMoney - previousMoney,
    betsDeltaPp: currentBets === null || previousBets === null ? null : currentBets - previousBets,
    comparisonObservedAt: previous.observedAt ?? null,
  };
}
