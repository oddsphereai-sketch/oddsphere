export const BATTER_DOUBLES_RESIDUAL_MODEL_VERSION =
  "batter_doubles_market_residual_v1_2026_07_30";

export type BatterDoublesResidualInputs = {
  marketOverProbability: number;
  plateAppearancesLast5: number;
  rbisLast5: number;
  rbisSeason: number;
  runsLast10: number;
  walksLast20: number;
  walksSeason: number;
  doublesOverRateLast20: number;
};

export type BatterDoublesResidualProjection = {
  overProbability: number;
  underProbability: number;
  logitAdjustment: number;
};

type ResidualSplit = {
  value: keyof BatterDoublesResidualInputs;
  threshold: number;
  leftAdjustment: number;
  rightAdjustment: number;
};

// Exact collapsed representation of the 50-stump residual fit trained on
// 2026-06-03..2026-07-23 opening markets. Repeated identical splits are summed
// so the runtime has one immutable, auditable path rather than a second trainer.
const RESIDUAL_SPLITS: readonly ResidualSplit[] = [
  {
    value: "rbisLast5",
    threshold: 0,
    leftAdjustment: -0.25173983696770946,
    rightAdjustment: -0.10734616728307565,
  },
  {
    value: "walksLast20",
    threshold: 0.3,
    leftAdjustment: -0.013570297770946786,
    rightAdjustment: -0.04179998512474601,
  },
  {
    value: "walksSeason",
    threshold: 0.42424242424242425,
    leftAdjustment: -0.017401054201886746,
    rightAdjustment: -0.06057134221025276,
  },
  {
    value: "rbisSeason",
    threshold: 0.5421686746987951,
    leftAdjustment: -0.027605597010565804,
    rightAdjustment: 0.0027024617478559726,
  },
  {
    value: "runsLast10",
    threshold: 0.8,
    leftAdjustment: -0.01326468945840458,
    rightAdjustment: -0.0703121122658571,
  },
  {
    value: "runsLast10",
    threshold: 0.6,
    leftAdjustment: -0.0020240276955284563,
    rightAdjustment: -0.01991855282299354,
  },
  {
    value: "plateAppearancesLast5",
    threshold: 4,
    leftAdjustment: -0.011923653154604304,
    rightAdjustment: 0.0034131186261365234,
  },
  {
    value: "marketOverProbability",
    threshold: 0.1660371073817893,
    leftAdjustment: -0.013225627033572732,
    rightAdjustment: -0.001044217261694752,
  },
  {
    value: "doublesOverRateLast20",
    threshold: 0.05,
    leftAdjustment: -0.006935645469648572,
    rightAdjustment: -0.0005945326019230849,
  },
] as const;

export function projectBatterDoublesResidual(
  inputs: BatterDoublesResidualInputs,
): BatterDoublesResidualProjection | null {
  const values = Object.values(inputs);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const marketOverProbability = clampProbability(inputs.marketOverProbability);
  let logitAdjustment = 0;
  for (const split of RESIDUAL_SPLITS) {
    logitAdjustment += inputs[split.value] <= split.threshold
      ? split.leftAdjustment
      : split.rightAdjustment;
  }
  const overProbability = clampProbability(
    sigmoid(logit(marketOverProbability) + logitAdjustment),
  );
  return {
    overProbability,
    underProbability: 1 - overProbability,
    logitAdjustment,
  };
}

function logit(value: number): number {
  const probability = clampProbability(value);
  return Math.log(probability / (1 - probability));
}

function sigmoid(value: number): number {
  return value >= 0
    ? 1 / (1 + Math.exp(-value))
    : Math.exp(value) / (1 + Math.exp(value));
}

function clampProbability(value: number): number {
  return Math.max(0.001, Math.min(0.999, value));
}
