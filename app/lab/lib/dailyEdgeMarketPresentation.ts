import type { MarketEdgeDto } from "./labTypes";

export type DailyEdgePresentationVerdict = {
  key: MarketEdgeDto["verdict"]["key"] | "held";
  label: string;
};

type PresentationMarket = Pick<MarketEdgeDto, "held" | "verdict">;

/**
 * A hold means the market has not received an authoritative evaluation yet.
 * Keep that presentation state separate from an evaluated No Play while
 * preserving the writer-owned verdict and grade fields unchanged.
 */
export function dailyEdgePresentationVerdict(
  market: PresentationMarket,
): DailyEdgePresentationVerdict {
  return market.held
    ? { key: "held", label: "Held" }
    : market.verdict;
}

export function dailyEdgeHeldGuide(market: PresentationMarket): string | null {
  return market.held
    ? "Evaluation held: awaiting the authoritative model and exact-price validation."
    : null;
}

export function dailyEdgeHeldRisk(market: PresentationMarket): string | null {
  return market.held
    ? "Required data or exact-price validation is still pending."
    : null;
}
