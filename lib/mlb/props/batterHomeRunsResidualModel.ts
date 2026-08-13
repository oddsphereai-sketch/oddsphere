export const BATTER_HOME_RUNS_RESIDUAL_MODEL_VERSION =
  "batter_home_runs_pa_portfolio_v2_2026_08_13";

export const BATTER_HOME_RUNS_PORTFOLIO_POLICY = {
  recentGames: 20,
  priorPlateAppearances: 100,
  leagueHomeRunsPerPlateAppearance: 0.032,
  marketWeight: 0.25,
  playsPerSlate: 3,
  minimumAmericanOdds: 150,
  maximumAmericanOdds: 1000,
  maximumPerGame: 1,
  stakeUnits: 0.1,
} as const;

export const BATTER_HOME_RUNS_COMPLEMENT_POLICY = {
  playsPerSlate: 2,
  minimumModelProbability: 0.1,
  minimumModelEdge: 0.02,
  minimumExpectedValue: 0.05,
  minimumAmericanOdds: 351,
  maximumAmericanOdds: 650,
  maximumPerGame: 1,
  stakeUnits: 0.1,
} as const;

export type BatterHomeRunsPortfolioInputs = {
  marketOverProbability: number;
  battingOrder: number | null;
  recentLogs: ReadonlyArray<{ homeRuns: number; plateAppearances: number }>;
  parkHomeRunFactor: number | null;
  temperatureF: number | null;
  outdoor: boolean;
};

export type BatterHomeRunsPortfolioProjection = {
  overProbability: number;
  underProbability: number;
  independentOverProbability: number;
  projectedPlateAppearances: number;
  projectedHomeRuns: number;
};

export function projectBatterHomeRunsPortfolio(
  inputs: BatterHomeRunsPortfolioInputs,
): BatterHomeRunsPortfolioProjection | null {
  const logs = inputs.recentLogs
    .filter((row) => Number.isFinite(row.homeRuns) && Number.isFinite(row.plateAppearances) && row.plateAppearances > 0)
    .slice(0, BATTER_HOME_RUNS_PORTFOLIO_POLICY.recentGames);
  if (!Number.isFinite(inputs.marketOverProbability) || logs.length < 5) return null;
  const homeRuns = logs.reduce((sum, row) => sum + row.homeRuns, 0);
  const plateAppearances = logs.reduce((sum, row) => sum + row.plateAppearances, 0);
  const rate = (
    homeRuns
    + BATTER_HOME_RUNS_PORTFOLIO_POLICY.leagueHomeRunsPerPlateAppearance
      * BATTER_HOME_RUNS_PORTFOLIO_POLICY.priorPlateAppearances
  ) / (plateAppearances + BATTER_HOME_RUNS_PORTFOLIO_POLICY.priorPlateAppearances);
  const projectedPlateAppearances = inputs.battingOrder === null
    ? 4.15
    : Math.max(3.65, Math.min(4.75, 4.85 - (inputs.battingOrder - 1) * 0.13));
  const parkDelta = inputs.parkHomeRunFactor === null
    ? 0
    : (inputs.parkHomeRunFactor - 100) / 100;
  const temperatureDelta = !inputs.outdoor || inputs.temperatureF === null
    ? 0
    : (inputs.temperatureF - 70) * 0.003;
  const environmentMultiplier = Math.max(0.75, Math.min(1.3, 1 + parkDelta + temperatureDelta));
  const projectedHomeRuns = rate * projectedPlateAppearances * environmentMultiplier;
  const independentOverProbability = clampProbability(1 - Math.exp(-projectedHomeRuns));
  const marketOverProbability = clampProbability(inputs.marketOverProbability);
  const overProbability = clampProbability(
    independentOverProbability * (1 - BATTER_HOME_RUNS_PORTFOLIO_POLICY.marketWeight)
      + marketOverProbability * BATTER_HOME_RUNS_PORTFOLIO_POLICY.marketWeight,
  );
  return {
    overProbability,
    underProbability: 1 - overProbability,
    independentOverProbability,
    projectedPlateAppearances,
    projectedHomeRuns,
  };
}

export type BatterHomeRunsResidualInputs = {
  marketOverProbability: number;
  line: number;
  home: boolean;
  homeRunsLast20: readonly number[];
};

export type BatterHomeRunsResidualProjection = {
  overProbability: number;
  underProbability: number;
  independentOverProbability: number;
  logitAdjustment: number;
};

const SURVIVAL_PRIOR_STRENGTH = 20;
const MARKET_OFFSET_COEFFICIENTS = {
  intercept: -0.003172,
  independentDelta: 0.120846,
  line: -0.386335,
  home: -0.063386,
} as const;

// Development-period event priors from immutable 2026-06-03..2026-07-23
// opening offers and official outcomes. Unknown lines deliberately fall back
// to the nearest more conservative rare-event prior.
const OVER_PRIOR_BY_LINE = new Map<number, number>([
  [0.5, 0.12484803142242588],
  [1.5, 0.008988551423975779],
  [2.5, 0.00100999899000101],
]);

export function projectBatterHomeRunsResidual(
  inputs: BatterHomeRunsResidualInputs,
): BatterHomeRunsResidualProjection | null {
  if (
    !Number.isFinite(inputs.marketOverProbability)
    || !Number.isFinite(inputs.line)
    || inputs.homeRunsLast20.length < 10
    || inputs.homeRunsLast20.some((value) => !Number.isFinite(value))
  ) return null;

  const history = inputs.homeRunsLast20.slice(0, 20);
  const linePrior = priorForLine(inputs.line);
  const successes = history.filter((value) => value > inputs.line).length;
  const independentOverProbability = clampProbability(
    (successes + linePrior * SURVIVAL_PRIOR_STRENGTH)
      / (history.length + SURVIVAL_PRIOR_STRENGTH),
  );
  const marketOverProbability = clampProbability(inputs.marketOverProbability);
  const logitAdjustment =
    MARKET_OFFSET_COEFFICIENTS.intercept
    + MARKET_OFFSET_COEFFICIENTS.independentDelta * (
      logit(independentOverProbability) - logit(marketOverProbability)
    )
    + MARKET_OFFSET_COEFFICIENTS.line * inputs.line
    + MARKET_OFFSET_COEFFICIENTS.home * Number(inputs.home);
  const overProbability = clampProbability(
    sigmoid(logit(marketOverProbability) + logitAdjustment),
  );
  return {
    overProbability,
    underProbability: 1 - overProbability,
    independentOverProbability,
    logitAdjustment,
  };
}

function priorForLine(line: number): number {
  const exact = OVER_PRIOR_BY_LINE.get(line);
  if (exact !== undefined) return exact;
  if (line >= 2.5) return OVER_PRIOR_BY_LINE.get(2.5)!;
  if (line >= 1.5) return OVER_PRIOR_BY_LINE.get(1.5)!;
  return OVER_PRIOR_BY_LINE.get(0.5)!;
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
