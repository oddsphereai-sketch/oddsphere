export type MarketAwareMarket = "moneyline" | "spread" | "total";

export type ProviderSplitSample = {
  provider: string;
  sourceBook: string;
  league: string;
  market: MarketAwareMarket;
  timeBucket: string;
  betsLean: number | null;
  moneyLean: number | null;
  moneyGap: number | null;
};

export type NormalizedProviderSplits = {
  betsLeanPercentile: number | null;
  moneyLeanPercentile: number | null;
  moneyGapPercentile: number | null;
  betsLeanZ: number | null;
  moneyLeanZ: number | null;
  moneyGapZ: number | null;
  normalizationSampleSize: number;
  normalizationFallbackLevel: "provider_source_league_market_bucket" | "provider_source_market" | "provider_market" | "global" | "unavailable";
};

export type LogisticModel = {
  featureNames: string[];
  means: number[];
  scales: number[];
  weights: number[];
  intercept: number;
  lambda: number;
  iterations: number;
};

export type GradeBoundarySet = {
  bestAngleMinConservativeEv: number;
  bestAngleMinProbEvPositive: number;
  leanMinExpectedEv: number;
  leanMinProbEvPositive: number;
  minFreshnessScore: number;
  minCompletenessScore: number;
};

const EPS = 1e-6;

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(1 - EPS, Math.max(EPS, p));
}

export function logit(p: number): number {
  const c = clamp01(p);
  return Math.log(c / (1 - c));
}

export function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

export function americanToDecimal(american: number | null | undefined): number | null {
  if (american === null || american === undefined || !Number.isFinite(american) || american === 0) return null;
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function americanToImplied(american: number | null | undefined): number | null {
  const dec = americanToDecimal(american);
  return dec === null ? null : 1 / dec;
}

export function deVigTwoWayProbability(
  candidateAmerican: number | null | undefined,
  oppositeAmerican: number | null | undefined,
): number | null {
  const a = americanToImplied(candidateAmerican);
  const b = americanToImplied(oppositeAmerican);
  if (a === null || b === null || a + b <= 0) return null;
  return a / (a + b);
}

export function expectedValuePerDollar(probability: number, american: number | null | undefined): number | null {
  const dec = americanToDecimal(american);
  if (dec === null) return null;
  return clamp01(probability) * dec - 1;
}

export function brierScore(probability: number, outcome: 0 | 1): number {
  const d = clamp01(probability) - outcome;
  return d * d;
}

export function logLoss(probability: number, outcome: 0 | 1): number {
  const p = clamp01(probability);
  return outcome === 1 ? -Math.log(p) : -Math.log(1 - p);
}

export function timeToStartBucket(minutesToStart: number | null | undefined): string {
  if (minutesToStart === null || minutesToStart === undefined || !Number.isFinite(minutesToStart)) return "unknown";
  if (minutesToStart <= 15) return "t-015";
  if (minutesToStart <= 60) return "t-060";
  if (minutesToStart <= 180) return "t-180";
  if (minutesToStart <= 720) return "t-720";
  return "t-720-plus";
}

export function directionalSplitFeatures(args: {
  betsPctForCandidate: number | null | undefined;
  moneyPctForCandidate: number | null | undefined;
}): Pick<ProviderSplitSample, "betsLean" | "moneyLean" | "moneyGap"> {
  const bets = typeof args.betsPctForCandidate === "number" && Number.isFinite(args.betsPctForCandidate)
    ? args.betsPctForCandidate
    : null;
  const money = typeof args.moneyPctForCandidate === "number" && Number.isFinite(args.moneyPctForCandidate)
    ? args.moneyPctForCandidate
    : null;
  return {
    betsLean: bets === null ? null : bets - 0.5,
    moneyLean: money === null ? null : money - 0.5,
    moneyGap: bets === null || money === null ? null : money - bets,
  };
}

function stats(values: number[]): { mean: number; sd: number } | null {
  if (values.length < 3) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, values.length - 1);
  return { mean, sd: Math.sqrt(variance) || 1 };
}

function percentile(values: number[], value: number | null): number | null {
  if (value === null || values.length < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  let below = 0;
  for (const v of sorted) {
    if (v <= value) below++;
    else break;
  }
  return below / sorted.length;
}

function zScore(values: number[], value: number | null): number | null {
  if (value === null) return null;
  const s = stats(values);
  return s === null ? null : (value - s.mean) / s.sd;
}

function sampleKey(s: ProviderSplitSample, level: NormalizedProviderSplits["normalizationFallbackLevel"]): string {
  if (level === "provider_source_league_market_bucket") {
    return [s.provider, s.sourceBook, s.league, s.market, s.timeBucket].join("|");
  }
  if (level === "provider_source_market") return [s.provider, s.sourceBook, s.market].join("|");
  if (level === "provider_market") return [s.provider, s.market].join("|");
  return "global";
}

function valuesFor(
  samples: ProviderSplitSample[],
  target: ProviderSplitSample,
  field: "betsLean" | "moneyLean" | "moneyGap",
): { values: number[]; level: NormalizedProviderSplits["normalizationFallbackLevel"] } {
  const levels: NormalizedProviderSplits["normalizationFallbackLevel"][] = [
    "provider_source_league_market_bucket",
    "provider_source_market",
    "provider_market",
    "global",
  ];
  for (const level of levels) {
    const key = sampleKey(target, level);
    const values = samples
      .filter((s) => sampleKey(s, level) === key)
      .map((s) => s[field])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length >= 3) return { values, level };
  }
  return { values: [], level: "unavailable" };
}

export function normalizeProviderSplit(
  trainingSamples: ProviderSplitSample[],
  target: ProviderSplitSample,
): NormalizedProviderSplits {
  const bets = valuesFor(trainingSamples, target, "betsLean");
  const money = valuesFor(trainingSamples, target, "moneyLean");
  const gap = valuesFor(trainingSamples, target, "moneyGap");
  const ranked = [bets, money, gap].sort((a, b) => b.values.length - a.values.length)[0];
  return {
    betsLeanPercentile: percentile(bets.values, target.betsLean),
    moneyLeanPercentile: percentile(money.values, target.moneyLean),
    moneyGapPercentile: percentile(gap.values, target.moneyGap),
    betsLeanZ: zScore(bets.values, target.betsLean),
    moneyLeanZ: zScore(money.values, target.moneyLean),
    moneyGapZ: zScore(gap.values, target.moneyGap),
    normalizationSampleSize: ranked.values.length,
    normalizationFallbackLevel: ranked.level,
  };
}

function standardizeMatrix(rows: Array<Record<string, number>>, featureNames: string[]): { matrix: number[][]; means: number[]; scales: number[] } {
  const means = featureNames.map((name) => rows.reduce((sum, r) => sum + (Number.isFinite(r[name]) ? r[name] : 0), 0) / Math.max(1, rows.length));
  const scales = featureNames.map((name, i) => {
    const variance = rows.reduce((sum, r) => {
      const v = Number.isFinite(r[name]) ? r[name] : 0;
      return sum + Math.pow(v - means[i], 2);
    }, 0) / Math.max(1, rows.length - 1);
    const sd = Math.sqrt(variance);
    return sd > 1e-9 ? sd : 1;
  });
  const matrix = rows.map((r) => featureNames.map((name, i) => {
    const v = Number.isFinite(r[name]) ? r[name] : 0;
    return (v - means[i]) / scales[i];
  }));
  return { matrix, means, scales };
}

export function fitRidgeLogistic(args: {
  rows: Array<Record<string, number>>;
  outcomes: Array<0 | 1>;
  featureNames: string[];
  lambda?: number;
  iterations?: number;
  learningRate?: number;
}): LogisticModel {
  const lambda = args.lambda ?? 1;
  const iterations = args.iterations ?? 1200;
  const learningRate = args.learningRate ?? 0.05;
  const { matrix, means, scales } = standardizeMatrix(args.rows, args.featureNames);
  const weights = new Array(args.featureNames.length).fill(0);
  let intercept = logit(Math.min(0.95, Math.max(0.05, args.outcomes.reduce<number>((a, b) => a + b, 0) / Math.max(1, args.outcomes.length))));
  const n = Math.max(1, matrix.length);
  for (let iter = 0; iter < iterations; iter++) {
    let gradIntercept = 0;
    const grad = new Array(weights.length).fill(0);
    for (let i = 0; i < matrix.length; i++) {
      let z = intercept;
      for (let j = 0; j < weights.length; j++) z += weights[j] * matrix[i][j];
      const err = sigmoid(z) - args.outcomes[i];
      gradIntercept += err;
      for (let j = 0; j < weights.length; j++) grad[j] += err * matrix[i][j];
    }
    intercept -= learningRate * gradIntercept / n;
    for (let j = 0; j < weights.length; j++) {
      weights[j] -= learningRate * ((grad[j] / n) + (lambda * weights[j] / n));
    }
  }
  return { featureNames: args.featureNames, means, scales, weights, intercept, lambda, iterations };
}

export function predictRidgeLogistic(model: LogisticModel, row: Record<string, number>): number {
  let z = model.intercept;
  for (let i = 0; i < model.featureNames.length; i++) {
    const raw = Number.isFinite(row[model.featureNames[i]]) ? row[model.featureNames[i]] : 0;
    z += model.weights[i] * ((raw - model.means[i]) / model.scales[i]);
  }
  return clamp01(sigmoid(z));
}

export function oppositeSideProbability(p: number): number {
  return 1 - clamp01(p);
}

export function assignMarketAwareGrade(args: {
  expectedEv: number | null;
  conservativeEv: number | null;
  probabilityEvPositive: number | null;
  freshnessScore: number;
  completenessScore: number;
  boundaries: GradeBoundarySet;
}): "best_angle" | "lean" | "no_play" {
  if (
    args.expectedEv === null ||
    args.conservativeEv === null ||
    args.probabilityEvPositive === null ||
    args.freshnessScore < args.boundaries.minFreshnessScore ||
    args.completenessScore < args.boundaries.minCompletenessScore
  ) {
    return "no_play";
  }
  if (
    args.conservativeEv >= args.boundaries.bestAngleMinConservativeEv &&
    args.probabilityEvPositive >= args.boundaries.bestAngleMinProbEvPositive
  ) {
    return "best_angle";
  }
  if (
    args.expectedEv > args.boundaries.leanMinExpectedEv &&
    args.probabilityEvPositive >= args.boundaries.leanMinProbEvPositive
  ) {
    return "lean";
  }
  return "no_play";
}
