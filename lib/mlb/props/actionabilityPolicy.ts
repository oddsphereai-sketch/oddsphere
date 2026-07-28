import { assessPropPrice } from "./pricePolicy";

export const MLB_PROPS_RECOVERY_POLICY_VERSION =
  "mlb_props_actionability_recovery_v2_2026_07_28";

export const HITS_UNDER_PRICE_EDGE_POLICY = {
  minimumMarketProbability: 0.4,
  maximumMarketProbability: 0.6,
  minimumExpectedValue: 0.02,
} as const;

export const HOME_RUN_RELATIVE_QUALITY_POLICY = {
  minimumProjection: 0.08,
  minimumRecentSurvival: 0.15,
  minimumMarketProbability: 0.08,
  minimumExpectedValue: 0.04,
  minimumAmericanOdds: 200,
  maximumAmericanOdds: 650,
  reliabilityWeight: 0.1,
  actionableQualityFraction: 0.15,
} as const;

export type HomeRunRelativeQualityScore = {
  eligible: boolean;
  modelProbability: number;
  finalProbability: number;
  expectedValue: number;
};

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

export function scoreHomeRunRelativeQualityCandidate(args: {
  projection: number;
  recentSurvival: number;
  marketProbability: number;
  americanOdds: number;
  line: number;
}): HomeRunRelativeQualityScore {
  const modelProbability = projectAuditableCountOverProbability({
    projection: args.projection,
    line: args.line,
  });
  const finalProbability = clampProbability(
    args.marketProbability
    + HOME_RUN_RELATIVE_QUALITY_POLICY.reliabilityWeight
      * (modelProbability - args.marketProbability),
  );
  const expectedValue = expectedValueAtPrice(finalProbability, args.americanOdds);
  return {
    eligible:
      args.projection >= HOME_RUN_RELATIVE_QUALITY_POLICY.minimumProjection
      && args.recentSurvival >= HOME_RUN_RELATIVE_QUALITY_POLICY.minimumRecentSurvival
      && args.marketProbability >= HOME_RUN_RELATIVE_QUALITY_POLICY.minimumMarketProbability
      && expectedValue >= HOME_RUN_RELATIVE_QUALITY_POLICY.minimumExpectedValue
      && args.americanOdds >= HOME_RUN_RELATIVE_QUALITY_POLICY.minimumAmericanOdds
      && args.americanOdds <= HOME_RUN_RELATIVE_QUALITY_POLICY.maximumAmericanOdds
      && assessPropPrice(args.americanOdds).signalEligible,
    modelProbability,
    finalProbability,
    expectedValue,
  };
}

export function selectRelativeQualityCandidateIds<T extends {
  id: string;
  expectedValue: number;
}>(
  candidates: readonly T[],
  qualityFraction: number = HOME_RUN_RELATIVE_QUALITY_POLICY.actionableQualityFraction,
): Set<string> {
  if (!candidates.length) return new Set();
  const sorted = [...candidates].sort((a, b) =>
    b.expectedValue - a.expectedValue || a.id.localeCompare(b.id));
  const thresholdIndex = Math.max(
    0,
    Math.ceil(sorted.length * qualityFraction) - 1,
  );
  const threshold = sorted[thresholdIndex]?.expectedValue;
  if (threshold === undefined) return new Set();
  return new Set(
    sorted
      .filter((candidate) => candidate.expectedValue >= threshold)
      .map((candidate) => candidate.id),
  );
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
