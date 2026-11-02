export type NbaReaderDecisionMarket = "moneyline" | "spread" | "total";

type ReaderDecision = {
  independentPicks?: Partial<Record<NbaReaderDecisionMarket, string | null>>;
  finalPicks?: Partial<Record<NbaReaderDecisionMarket, string | null>>;
  effects?: Partial<Record<NbaReaderDecisionMarket, string>>;
};

const LEGACY_FLIP_EFFECT: Record<NbaReaderDecisionMarket, string> = {
  moneyline: "flipped_by_validated_spread_score",
  spread: "flipped_by_validated_spread_read",
  total: "flipped_by_validated_total_read",
};

/**
 * Audit the actual before/after decision whenever both picks were recorded.
 * Effect tokens remain a legacy fallback only; this prevents a renamed reader
 * receipt from making a real production flip disappear from operator reports.
 */
export function didNbaReaderFlip(
  decision: unknown,
  market: NbaReaderDecisionMarket,
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const value = decision as ReaderDecision;
  const independent = value.independentPicks?.[market];
  const final = value.finalPicks?.[market];
  if (independent !== undefined && final !== undefined && independent !== null && final !== null) {
    return independent !== final;
  }
  const effect = value.effects?.[market];
  return effect === "flipped_by_causal_market_episode" || effect === LEGACY_FLIP_EFFECT[market];
}
