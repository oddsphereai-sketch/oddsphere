import { assessPropPrice } from "./pricePolicy";

export const MLB_PROPS_RECOVERY_POLICY_VERSION =
  "mlb_props_actionability_recovery_v3_2026_07_28";

export const HITS_UNDER_PRICE_EDGE_POLICY = {
  minimumMarketProbability: 0.4,
  maximumMarketProbability: 0.6,
  minimumExpectedValue: 0.02,
} as const;

export const HOME_RUN_STANDARDIZED_QUALITY_POLICY = {
  minimumProjection: 0.08,
  minimumRecentSurvival: 0.15,
  minimumMarketProbability: 0.08,
  minimumExpectedValue: 0.12,
  minimumStandardizedExpectedValue: 1.25,
  minimumAmericanOdds: 200,
  maximumAmericanOdds: 650,
  reliabilityWeight: 0.1,
} as const;

export const VALIDATED_UNDER_PROMOTION_POLICIES = {
  batter_hits: {
    minimumModelProbability: 0.56,
    minimumRawEdge: 0.1,
    minimumFinalEdge: 0.02,
    minimumExpectedValue: 0.01,
  },
  batter_hits_runs_rbis: {
    line: 1.5,
    minimumModelProbability: 0.56,
    minimumRawEdge: 0.08,
    minimumFinalEdge: 0.02,
    minimumExpectedValue: 0.01,
  },
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
    + HOME_RUN_STANDARDIZED_QUALITY_POLICY.reliabilityWeight
      * (modelProbability - args.marketProbability),
  );
  const expectedValue = expectedValueAtPrice(finalProbability, args.americanOdds);
  return {
    eligible:
      args.projection >= HOME_RUN_STANDARDIZED_QUALITY_POLICY.minimumProjection
      && args.recentSurvival >= HOME_RUN_STANDARDIZED_QUALITY_POLICY.minimumRecentSurvival
      && args.marketProbability >= HOME_RUN_STANDARDIZED_QUALITY_POLICY.minimumMarketProbability
      && args.americanOdds >= HOME_RUN_STANDARDIZED_QUALITY_POLICY.minimumAmericanOdds
      && args.americanOdds <= HOME_RUN_STANDARDIZED_QUALITY_POLICY.maximumAmericanOdds
      && assessPropPrice(args.americanOdds).signalEligible,
    modelProbability,
    finalProbability,
    expectedValue,
  };
}

export function selectStandardizedQualityCandidateIds<T extends {
  id: string;
  expectedValue: number;
}>(
  candidates: readonly T[],
  minimumStandardizedExpectedValue: number =
    HOME_RUN_STANDARDIZED_QUALITY_POLICY.minimumStandardizedExpectedValue,
): Set<string> {
  if (candidates.length < 2) return new Set();
  const mean = candidates.reduce(
    (sum, candidate) => sum + candidate.expectedValue,
    0,
  ) / candidates.length;
  const variance = candidates.reduce(
    (sum, candidate) => sum + (candidate.expectedValue - mean) ** 2,
    0,
  ) / candidates.length;
  const standardDeviation = Math.sqrt(variance);
  if (standardDeviation <= 0) return new Set();
  return new Set(
    candidates
      .filter((candidate) =>
        candidate.expectedValue
          >= HOME_RUN_STANDARDIZED_QUALITY_POLICY.minimumExpectedValue
        && (candidate.expectedValue - mean) / standardDeviation
          >= minimumStandardizedExpectedValue)
      .map((candidate) => candidate.id),
  );
}

export function qualifiesValidatedUnderPromotion(args: {
  market: string;
  line: number;
  modelProbability: number;
  marketProbability: number;
  finalEdge: number;
  expectedValue: number;
  americanOdds: number;
}): boolean {
  const policy = VALIDATED_UNDER_PROMOTION_POLICIES[
    args.market as keyof typeof VALIDATED_UNDER_PROMOTION_POLICIES
  ];
  if (!policy) return false;
  if ("line" in policy && args.line !== policy.line) return false;
  return args.modelProbability >= policy.minimumModelProbability
    && args.modelProbability - args.marketProbability >= policy.minimumRawEdge
    && args.finalEdge >= policy.minimumFinalEdge
    && args.expectedValue >= policy.minimumExpectedValue
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
