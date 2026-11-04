import type { MarketEdgeDto } from "./labTypes";

type Comparison = Pick<MarketEdgeDto, "modelProb" | "marketImpliedPct" | "marketFairProb" |
  "modelMarketGapPct" | "publishedProbabilityComparisonBasis">;
const probabilityText = (value: number | null) => value === null || !Number.isFinite(value)
  ? "—" : `${(value <= 1 ? value * 100 : value).toFixed(1)}%`;

/** Only explicitly stamped publications use stored no-vig comparison fields.
 * Never reconstruct a missing stored gap or reinterpret a legacy locked card. */
export function publishedProbabilityComparison(market: Comparison) {
  if (market.publishedProbabilityComparisonBasis === "stored_no_vig") {
    const fair = market.marketFairProb;
    const available = fair !== null && Number.isFinite(fair) && fair >= 0 && fair <= 1;
    const gap = market.modelMarketGapPct;
    return { marketProbabilityText: available ? probabilityText(fair) : "—",
      probabilityGap: available && gap !== null && Number.isFinite(gap) ? gap : null,
      storedBasis: true, marketAvailable: available };
  }
  // Exact prior presentation: raw field first, and its original rounded gap.
  const model = market.modelProb;
  return { marketProbabilityText: market.marketImpliedPct !== null
      ? `${market.marketImpliedPct.toFixed(1)}%` : probabilityText(market.marketFairProb),
    probabilityGap: model === null || market.marketImpliedPct === null ? null
      : +((model <= 1 ? model * 100 : model) - market.marketImpliedPct).toFixed(1),
    storedBasis: false, marketAvailable: market.marketImpliedPct !== null || market.marketFairProb !== null };
}
