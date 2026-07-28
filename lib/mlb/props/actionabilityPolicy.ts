import { assessPropPrice } from "./pricePolicy";

export const MLB_PROPS_RECOVERY_POLICY_VERSION =
  "mlb_props_actionability_recovery_v1_2026_07_28";

export const HITS_UNDER_PRICE_EDGE_POLICY = {
  minimumMarketProbability: 0.4,
  maximumMarketProbability: 0.6,
  minimumExpectedValue: 0.02,
} as const;

export function projectAuditableCountOverProbability(args: {
  projection: number;
  line: number;
}): number {
  const threshold = Math.floor(args.line) + 1;
  const poisson = poissonTail(Math.max(0.001, args.projection), threshold);
  return clampProbability(
    0.5 + (poisson - 0.5) / Math.sqrt(1.42) * 0.972,
  );
}

export function qualifiesHitsUnderPriceEdge(args: {
  marketProbability: number;
  americanOdds: number;
}): boolean {
  return args.marketProbability >= HITS_UNDER_PRICE_EDGE_POLICY.minimumMarketProbability
    && args.marketProbability <= HITS_UNDER_PRICE_EDGE_POLICY.maximumMarketProbability
    && expectedValueAtPrice(args.marketProbability, args.americanOdds)
      >= HITS_UNDER_PRICE_EDGE_POLICY.minimumExpectedValue
    && assessPropPrice(args.americanOdds).signalEligible;
}

function expectedValueAtPrice(probability: number, americanOdds: number): number {
  const decimal = americanOdds > 0
    ? 1 + americanOdds / 100
    : 1 + 100 / Math.abs(americanOdds);
  return probability * decimal - 1;
}

function poissonTail(lambda: number, minimum: number): number {
  let probability = Math.exp(-lambda);
  let cumulative = probability;
  for (let value = 1; value < minimum; value++) {
    probability *= lambda / value;
    cumulative += probability;
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

function clampProbability(value: number): number {
  return Math.max(0.001, Math.min(0.999, value));
}
