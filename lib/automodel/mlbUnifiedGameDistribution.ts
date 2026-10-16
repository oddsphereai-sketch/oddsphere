import {
  awayMinus1_5Probability,
  awayPlus1_5Probability,
  homeMinus1_5Probability,
  homePlus1_5Probability,
  homeWinProbabilityPoisson,
} from "./runDistribution";

export const MLB_UNIFIED_GAME_DISTRIBUTION_VERSION =
  "mlb_unified_game_distribution_v1_factorized_margin_total_2026_10_16" as const;
/** Production authority for future unlocked MLB forecasts. */
export const MLB_UNIFIED_GAME_DISTRIBUTION_ACTIVE = true as const;
export const MLB_UNIFIED_TOTAL_SCORE_GAP_SLOPE = 0.096289;

const EPSILON = 1e-9;

export type MlbUnifiedDistributionIssue =
  | "invalid_expected_score"
  | "score_total_identity"
  | "score_margin_identity"
  | "moneyline_margin_direction"
  | "favorite_cover_exceeds_win"
  | "underdog_cover_below_win"
  | "total_probability_monotonicity";

export type MlbUnifiedGameDistribution = {
  version: typeof MLB_UNIFIED_GAME_DISTRIBUTION_VERSION;
  construction: "factorized_margin_total";
  expected: {
    away_runs: number;
    home_runs: number;
    total_runs: number;
    home_margin_runs: number;
  };
  margin_axis: {
    reference_away_runs: number;
    reference_home_runs: number;
    away_win_probability: number;
    home_win_probability: number;
    away_minus_1_5_probability: number;
    away_plus_1_5_probability: number;
    home_minus_1_5_probability: number;
    home_plus_1_5_probability: number;
  };
  total_axis: {
    listed_total: number | null;
    calibration: "development_score_gap_logistic";
    slope: typeof MLB_UNIFIED_TOTAL_SCORE_GAP_SLOPE;
    over_probability: number | null;
    under_probability: number | null;
  };
  invariants: {
    passed: boolean;
    issues: MlbUnifiedDistributionIssue[];
  };
};

function logistic(value: number): number {
  const bounded = Math.max(-20, Math.min(20, value));
  return 1 / (1 + Math.exp(-bounded));
}

export function mlbUnifiedOverProbability(expectedTotal: number, listedTotal: number): number {
  return logistic(MLB_UNIFIED_TOTAL_SCORE_GAP_SLOPE * (expectedTotal - listedTotal));
}

export function buildMlbUnifiedGameDistribution(args: {
  expectedTotal: number;
  expectedHomeMargin: number;
  marginReferenceHomeRuns: number;
  marginReferenceAwayRuns: number;
  listedTotal: number | null;
}): MlbUnifiedGameDistribution {
  const expectedHomeRuns = (args.expectedTotal + args.expectedHomeMargin) / 2;
  const expectedAwayRuns = args.expectedTotal - expectedHomeRuns;
  const homeWinProbability = homeWinProbabilityPoisson(
    args.marginReferenceHomeRuns,
    args.marginReferenceAwayRuns,
  );
  const homeMinusProbability = homeMinus1_5Probability(
    args.marginReferenceHomeRuns,
    args.marginReferenceAwayRuns,
  );
  const awayPlusProbability = awayPlus1_5Probability(
    args.marginReferenceHomeRuns,
    args.marginReferenceAwayRuns,
  );
  const awayMinusProbability = awayMinus1_5Probability(
    args.marginReferenceHomeRuns,
    args.marginReferenceAwayRuns,
  );
  const homePlusProbability = homePlus1_5Probability(
    args.marginReferenceHomeRuns,
    args.marginReferenceAwayRuns,
  );
  const overProbability = args.listedTotal === null
    ? null
    : mlbUnifiedOverProbability(args.expectedTotal, args.listedTotal);

  const issues: MlbUnifiedDistributionIssue[] = [];
  if (
    !Number.isFinite(expectedHomeRuns) ||
    !Number.isFinite(expectedAwayRuns) ||
    expectedHomeRuns < 0 ||
    expectedAwayRuns < 0
  ) {
    issues.push("invalid_expected_score");
  }
  if (Math.abs(expectedHomeRuns + expectedAwayRuns - args.expectedTotal) > EPSILON) {
    issues.push("score_total_identity");
  }
  if (Math.abs(expectedHomeRuns - expectedAwayRuns - args.expectedHomeMargin) > EPSILON) {
    issues.push("score_margin_identity");
  }
  if (
    (args.expectedHomeMargin > EPSILON && homeWinProbability < 0.5) ||
    (args.expectedHomeMargin < -EPSILON && homeWinProbability > 0.5)
  ) {
    issues.push("moneyline_margin_direction");
  }

  const homeFavorite = homeWinProbability >= 0.5;
  const favoriteWin = homeFavorite ? homeWinProbability : 1 - homeWinProbability;
  const favoriteMinus = homeFavorite
    ? homeMinusProbability
    : awayMinusProbability;
  const underdogWin = 1 - favoriteWin;
  const underdogPlus = homeFavorite ? awayPlusProbability : homePlusProbability;
  if (favoriteMinus - favoriteWin > EPSILON) issues.push("favorite_cover_exceeds_win");
  if (underdogWin - underdogPlus > EPSILON) issues.push("underdog_cover_below_win");
  if (args.listedTotal !== null) {
    const lowerLine = mlbUnifiedOverProbability(args.expectedTotal, args.listedTotal - 1);
    const upperLine = mlbUnifiedOverProbability(args.expectedTotal, args.listedTotal + 1);
    if (lowerLine + EPSILON < (overProbability ?? 0) || (overProbability ?? 1) + EPSILON < upperLine) {
      issues.push("total_probability_monotonicity");
    }
  }

  return {
    version: MLB_UNIFIED_GAME_DISTRIBUTION_VERSION,
    construction: "factorized_margin_total",
    expected: {
      away_runs: expectedAwayRuns,
      home_runs: expectedHomeRuns,
      total_runs: args.expectedTotal,
      home_margin_runs: args.expectedHomeMargin,
    },
    margin_axis: {
      reference_away_runs: args.marginReferenceAwayRuns,
      reference_home_runs: args.marginReferenceHomeRuns,
      away_win_probability: 1 - homeWinProbability,
      home_win_probability: homeWinProbability,
      away_minus_1_5_probability: awayMinusProbability,
      away_plus_1_5_probability: awayPlusProbability,
      home_minus_1_5_probability: homeMinusProbability,
      home_plus_1_5_probability: homePlusProbability,
    },
    total_axis: {
      listed_total: args.listedTotal,
      calibration: "development_score_gap_logistic",
      slope: MLB_UNIFIED_TOTAL_SCORE_GAP_SLOPE,
      over_probability: overProbability,
      under_probability: overProbability === null ? null : 1 - overProbability,
    },
    invariants: {
      passed: issues.length === 0,
      issues,
    },
  };
}
