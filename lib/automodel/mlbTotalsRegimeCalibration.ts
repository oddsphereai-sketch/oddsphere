export const MLB_TOTALS_REGIME_CALIBRATION_RELEASE =
  "mlb_totals_regime_calibration_2026_09_19_r1_trailing90" as const;

export const MLB_TOTALS_REGIME_SAMPLE_SIZE = 90;
export const MLB_TOTALS_REGIME_PRIOR_PSEUDO_COUNT_PER_SIDE = 5;
export const MLB_TOTALS_REGIME_WEIGHT = 0.35;

export type MlbTotalsRegimePrior = {
  release: typeof MLB_TOTALS_REGIME_CALIBRATION_RELEASE;
  sampleSize: number;
  overWins: number;
  underWins: number;
  rawOverRate: number;
  smoothedOverRate: number;
  latestSettledDate: string;
};

export type MlbSettledTotalRow = {
  date: string;
  side: string | null;
  result: string | null;
};

export type MlbTotalsRegimeCalibration = {
  release: typeof MLB_TOTALS_REGIME_CALIBRATION_RELEASE;
  applied: boolean;
  reason: "applied" | "prior_unavailable" | "insufficient_prior_sample";
  modelOverProbabilityBefore: number;
  modelOverProbabilityAfter: number;
  regimeWeight: number;
  prior: MlbTotalsRegimePrior | null;
};

function clampProbability(value: number): number {
  return Math.max(0.01, Math.min(0.99, value));
}

export function buildMlbTotalsRegimePrior(
  newestFirstRows: ReadonlyArray<MlbSettledTotalRow>,
): MlbTotalsRegimePrior | null {
  const eligible = newestFirstRows.filter((row) =>
    (row.side === "over" || row.side === "under") &&
    (row.result === "win" || row.result === "loss"),
  ).slice(0, MLB_TOTALS_REGIME_SAMPLE_SIZE);
  if (eligible.length < MLB_TOTALS_REGIME_SAMPLE_SIZE) return null;
  let overWins = 0;
  for (const row of eligible) {
    const overWon =
      (row.side === "over" && row.result === "win") ||
      (row.side === "under" && row.result === "loss");
    if (overWon) overWins += 1;
  }
  const underWins = eligible.length - overWins;
  return {
    release: MLB_TOTALS_REGIME_CALIBRATION_RELEASE,
    sampleSize: eligible.length,
    overWins,
    underWins,
    rawOverRate: overWins / eligible.length,
    smoothedOverRate:
      (overWins + MLB_TOTALS_REGIME_PRIOR_PSEUDO_COUNT_PER_SIDE) /
      (eligible.length + 2 * MLB_TOTALS_REGIME_PRIOR_PSEUDO_COUNT_PER_SIDE),
    latestSettledDate: eligible.reduce(
      (latest, row) => row.date > latest ? row.date : latest,
      eligible[0]!.date,
    ),
  };
}

export function applyMlbTotalsRegimeCalibration(args: {
  modelOverProbability: number;
  prior: MlbTotalsRegimePrior | null;
}): MlbTotalsRegimeCalibration {
  const modelOverProbabilityBefore = clampProbability(args.modelOverProbability);
  if (args.prior === null) {
    return {
      release: MLB_TOTALS_REGIME_CALIBRATION_RELEASE,
      applied: false,
      reason: "prior_unavailable",
      modelOverProbabilityBefore,
      modelOverProbabilityAfter: modelOverProbabilityBefore,
      regimeWeight: MLB_TOTALS_REGIME_WEIGHT,
      prior: null,
    };
  }
  if (args.prior.sampleSize < MLB_TOTALS_REGIME_SAMPLE_SIZE) {
    return {
      release: MLB_TOTALS_REGIME_CALIBRATION_RELEASE,
      applied: false,
      reason: "insufficient_prior_sample",
      modelOverProbabilityBefore,
      modelOverProbabilityAfter: modelOverProbabilityBefore,
      regimeWeight: MLB_TOTALS_REGIME_WEIGHT,
      prior: args.prior,
    };
  }
  return {
    release: MLB_TOTALS_REGIME_CALIBRATION_RELEASE,
    applied: true,
    reason: "applied",
    modelOverProbabilityBefore,
    modelOverProbabilityAfter: clampProbability(
      (1 - MLB_TOTALS_REGIME_WEIGHT) * modelOverProbabilityBefore +
        MLB_TOTALS_REGIME_WEIGHT * args.prior.smoothedOverRate,
    ),
    regimeWeight: MLB_TOTALS_REGIME_WEIGHT,
    prior: args.prior,
  };
}
