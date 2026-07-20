export const BATTER_HITS_PA_MODEL_VERSION = "batter_hits_pa_beta_binomial_v1";

export type BatterHitsRecentLog = {
  value: number;
  secondaryLabel?: string | null;
};

export type BatterHitsPaInput = {
  line: number;
  battingOrder: number | null;
  recentLogs: BatterHitsRecentLog[];
  pitchMixBattingAverage: number | null;
  pitchMixPitchesSeen: number | null;
};

export type BatterHitsPaOutput = {
  modelVersion: typeof BATTER_HITS_PA_MODEL_VERSION;
  overProbability: number;
  underProbability: number;
  posteriorBattingAverage: number;
  adjustedBattingAverage: number;
  projectedAtBats: number;
  projectedHits: number;
  observedAtBats: number;
  observedHits: number;
  games: number;
  pitchMixWeight: number;
};

const LEAGUE_BATTING_AVERAGE = 0.245;
const PRIOR_AT_BATS = 200;
const LINEUP_OPPORTUNITY_WEIGHT = 0.5;
const MAXIMUM_PITCH_MIX_WEIGHT = 0.1;

const LINEUP_EXPECTED_AT_BATS: Record<number, number> = {
  1: 4.25,
  2: 4.15,
  3: 4.05,
  4: 4,
  5: 3.9,
  6: 3.8,
  7: 3.7,
  8: 3.6,
  9: 3.45,
};

/**
 * Dedicated Batter Hits distribution.
 *
 * Recent hits are shrunk toward a league-average Beta prior, matchup batting
 * average has a deliberately capped influence, and lineup position adjusts
 * expected opportunity. The resulting hit count uses a beta-binomial rather
 * than treating per-game hits as a Poisson count.
 */
export function projectBatterHitsPa(input: BatterHitsPaInput): BatterHitsPaOutput | null {
  if (!Number.isFinite(input.line) || input.line < 0 || !input.recentLogs.length) return null;

  const parsed = input.recentLogs
    .map((log) => ({ hits: finiteNonNegative(log.value), atBats: parseAtBats(log.secondaryLabel) }))
    .filter((log): log is { hits: number; atBats: number } =>
      log.hits !== null && log.atBats !== null && log.hits <= log.atBats,
    );
  if (!parsed.length) return null;

  const observedHits = parsed.reduce((sum, log) => sum + log.hits, 0);
  const observedAtBats = parsed.reduce((sum, log) => sum + log.atBats, 0);
  if (observedAtBats <= 0) return null;

  const priorHits = LEAGUE_BATTING_AVERAGE * PRIOR_AT_BATS;
  const posteriorAlpha = priorHits + observedHits;
  const posteriorBeta = PRIOR_AT_BATS - priorHits + observedAtBats - observedHits;
  const posteriorBattingAverage = posteriorAlpha / (posteriorAlpha + posteriorBeta);

  const pitchMix = finiteProbability(input.pitchMixBattingAverage);
  const pitchesSeen = finiteNonNegative(input.pitchMixPitchesSeen) ?? 0;
  const pitchMixWeight = pitchMix === null
    ? 0
    : Math.min(MAXIMUM_PITCH_MIX_WEIGHT, MAXIMUM_PITCH_MIX_WEIGHT * pitchesSeen / (pitchesSeen + 400));
  const adjustedBattingAverage = clampProbability(
    posteriorBattingAverage * (1 - pitchMixWeight) + (pitchMix ?? posteriorBattingAverage) * pitchMixWeight,
  );

  const recentAtBatsPerGame = observedAtBats / parsed.length;
  const lineupAtBats = input.battingOrder === null ? null : LINEUP_EXPECTED_AT_BATS[input.battingOrder] ?? null;
  const projectedAtBats = clamp(
    lineupAtBats === null
      ? recentAtBatsPerGame
      : recentAtBatsPerGame * (1 - LINEUP_OPPORTUNITY_WEIGHT) + lineupAtBats * LINEUP_OPPORTUNITY_WEIGHT,
    1,
    5.5,
  );

  const concentration = posteriorAlpha + posteriorBeta;
  const adjustedAlpha = adjustedBattingAverage * concentration;
  const adjustedBeta = (1 - adjustedBattingAverage) * concentration;
  const overProbability = variableOpportunityOverProbability({
    projectedAtBats,
    threshold: Math.floor(input.line),
    alpha: adjustedAlpha,
    beta: adjustedBeta,
  });

  return {
    modelVersion: BATTER_HITS_PA_MODEL_VERSION,
    overProbability: round(overProbability),
    underProbability: round(1 - overProbability),
    posteriorBattingAverage: round(posteriorBattingAverage),
    adjustedBattingAverage: round(adjustedBattingAverage),
    projectedAtBats: round(projectedAtBats),
    projectedHits: round(projectedAtBats * adjustedBattingAverage),
    observedAtBats,
    observedHits,
    games: parsed.length,
    pitchMixWeight: round(pitchMixWeight),
  };
}

function variableOpportunityOverProbability(args: {
  projectedAtBats: number;
  threshold: number;
  alpha: number;
  beta: number;
}): number {
  const lowAtBats = Math.max(1, Math.floor(args.projectedAtBats));
  const highAtBats = Math.max(lowAtBats, Math.ceil(args.projectedAtBats));
  const highWeight = args.projectedAtBats - lowAtBats;
  const lowOver = betaBinomialOverProbability(lowAtBats, args.threshold, args.alpha, args.beta);
  if (highAtBats === lowAtBats) return lowOver;
  const highOver = betaBinomialOverProbability(highAtBats, args.threshold, args.alpha, args.beta);
  return clampProbability(lowOver * (1 - highWeight) + highOver * highWeight);
}

function betaBinomialOverProbability(trials: number, threshold: number, alpha: number, beta: number): number {
  if (threshold < 0) return 1;
  if (threshold >= trials) return 0;
  let cumulative = 0;
  for (let hits = 0; hits <= threshold; hits++) {
    cumulative += Math.exp(
      logCombination(trials, hits)
      + logBeta(hits + alpha, trials - hits + beta)
      - logBeta(alpha, beta),
    );
  }
  return clampProbability(1 - cumulative);
}

function parseAtBats(label: string | null | undefined): number | null {
  if (!label) return null;
  const match = label.match(/(?:^|\|\s*)(\d+(?:\.\d+)?)\s+AB(?:\s*\||$)/i)
    ?? label.match(/(\d+(?:\.\d+)?)\s+AB/i);
  return match ? finiteNonNegative(Number(match[1])) : null;
}

function logCombination(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let x = 0.9999999999998099;
  const shifted = value - 1;
  for (let index = 0; index < coefficients.length; index++) x += coefficients[index] / (shifted + index + 1);
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function finiteProbability(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1 ? value : null;
}

function clampProbability(value: number): number {
  return clamp(value, 1e-6, 1 - 1e-6);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
