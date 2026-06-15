/**
 * Sportsbooks we refuse to use as a price/line source anywhere in the pipeline.
 *
 * 2026-06-13 (Daniel: "Don't use fliff anymore"): fliff repeatedly ships
 * corrupted / team-flipped lines (e.g. tonight's Spurs −205 favorite quoted at
 * +385, and the WC home/away swaps), poisoning consensus, openers, and
 * line-move. Names are matched case-insensitively. Filter at every point lines
 * are CONSUMED (consensus, current price, opener/line-move) so blocked rows in
 * the DB are ignored even if a writer already persisted them.
 *
 * 2026-06-15 (#39 unify book hierarchy): `kalshi` added here as the single
 * source of truth. Audit 2026-06-04 found kalshi ships home/away-inverted
 * rows on ≥3 of 4 games (TOR@ATL, LAD@ARI, …) — a prediction-market exchange,
 * not a sportsbook. It was previously excluded only by ad-hoc per-file lists
 * (daily-edge BOOK_PRIORITY omission, marketImplied, featureSnapshot,
 * aiReviewerWiring). Centralizing it here means every price/line CONSUMER that
 * calls `isBlockedSportsbook` drops it automatically. NOTE: market-COVERAGE
 * tiering (sharpApiMarketCoverage) keeps its own list and is intentionally
 * NOT routed through this set, so this does not change slate gating.
 */
export const BLOCKED_SPORTSBOOKS: ReadonlySet<string> = new Set(["fliff", "kalshi"]);

export function isBlockedSportsbook(name: string | null | undefined): boolean {
  if (name === null || name === undefined) return false;
  return BLOCKED_SPORTSBOOKS.has(name.trim().toLowerCase());
}
