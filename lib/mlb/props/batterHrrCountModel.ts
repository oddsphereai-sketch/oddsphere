export const BATTER_HRR_MODEL_VERSION = "batter_hrr_negative_binomial_v1";

export type BatterHrrInput = {
  line: number;
  battingOrder: number | null;
  recentValues: number[];
};

export type BatterHrrOutput = {
  modelVersion: typeof BATTER_HRR_MODEL_VERSION;
  overProbability: number;
  underProbability: number;
  projectedMean: number;
  observedMean: number;
  games: number;
};

const PRIOR_MEAN = 1.95;
const PRIOR_GAMES = 20;
const DISPERSION_SIZE = 2;
const LINEUP_OPPORTUNITY_WEIGHT = 0.5;

const LINEUP_OPPORTUNITY: Record<number, number> = {
  1: 1.09,
  2: 1.06,
  3: 1.03,
  4: 1.01,
  5: 0.99,
  6: 0.97,
  7: 0.94,
  8: 0.91,
  9: 0.88,
};

/**
 * Dedicated Hits + Runs + RBIs model.
 *
 * The per-game count mean is empirically shrunk, adjusted modestly for lineup
 * opportunity, and evaluated with an overdispersed negative-binomial count
 * distribution rather than the shared hitter Poisson proxy.
 */
export function projectBatterHrr(input: BatterHrrInput): BatterHrrOutput | null {
  const values = input.recentValues.filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length || !Number.isFinite(input.line) || input.line < 0) return null;

  const observedMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const posteriorMean = (PRIOR_MEAN * PRIOR_GAMES + observedMean * values.length) / (PRIOR_GAMES + values.length);
  const opportunity = input.battingOrder === null ? 1 : LINEUP_OPPORTUNITY[input.battingOrder] ?? 1;
  const projectedMean = Math.max(0.01,
    posteriorMean * (1 + (opportunity - 1) * LINEUP_OPPORTUNITY_WEIGHT),
  );
  const overProbability = negativeBinomialOver(projectedMean, DISPERSION_SIZE, Math.floor(input.line));
  return {
    modelVersion: BATTER_HRR_MODEL_VERSION,
    overProbability: round(overProbability),
    underProbability: round(1 - overProbability),
    projectedMean: round(projectedMean),
    observedMean: round(observedMean),
    games: values.length,
  };
}

function negativeBinomialOver(mean: number, size: number, threshold: number): number {
  if (threshold < 0) return 1;
  const successProbability = size / (size + mean);
  let cumulative = 0;
  for (let count = 0; count <= threshold; count++) {
    cumulative += Math.exp(
      logGamma(count + size)
      - logGamma(size)
      - logGamma(count + 1)
      + size * Math.log(successProbability)
      + count * Math.log(1 - successProbability),
    );
  }
  return clamp(1 - cumulative, 1e-6, 1 - 1e-6);
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
