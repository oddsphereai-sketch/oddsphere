export type NhlJointGoalCell = {
  homeGoals: number;
  awayGoals: number;
  probability: number;
};

export type NhlJointProjectionConstraintName =
  | "home_win_probability"
  | "home_cover_probability"
  | "expected_total_goals";

export type NhlJointProjectionConstraintReceipt = {
  name: NhlJointProjectionConstraintName;
  origin: "market_innovation" | "independent_preservation";
  target: number;
  achieved: number;
  residual: number;
};

export type NhlJointMarketProjectionInput = {
  independentHomeGoals: number;
  independentAwayGoals: number;
  /** Qualified movement innovation already applied to the independent value. */
  targetHomeWinProbability?: number | null;
  /** Qualified movement innovation already applied to the independent value. */
  targetHomeCoverProbability?: number | null;
  /** Exact home puck line attached to targetHomeCoverProbability. */
  homePuckLine?: number | null;
  /** Qualified movement innovation already applied to the independent value. */
  targetExpectedTotalGoals?: number | null;
  /** Optional exact Total line used only to report final Over/Under probabilities. */
  totalLine?: number | null;
  maximumGoals?: number;
  tolerance?: number;
  maxIterations?: number;
};

export type NhlJointMarketProjectionResult = {
  status: "identity" | "projected" | "failed_closed";
  reason: string | null;
  converged: boolean;
  iterations: number;
  pmf: NhlJointGoalCell[];
  constraints: NhlJointProjectionConstraintReceipt[];
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  expectedTotalGoals: number;
  homeWinProbability: number;
  homeCoverProbability: number | null;
  puckPushProbability: number | null;
  totalOverProbability: number | null;
  totalUnderProbability: number | null;
  totalPushProbability: number | null;
  totalConditionalOverProbability: number | null;
  overtimeHomeProbability: number;
};

type Constraint = {
  name: NhlJointProjectionConstraintName;
  origin: NhlJointProjectionConstraintReceipt["origin"];
  target: number;
  feature: number[];
};

type DistributionSummary = Omit<
  NhlJointMarketProjectionResult,
  "status" | "reason" | "converged" | "iterations" | "constraints"
>;

const DEFAULT_MAXIMUM_GOALS = 12;
const DEFAULT_TOLERANCE = 1e-9;
const DEFAULT_MAX_ITERATIONS = 100;
const MIN_PROBABILITY_TARGET = 1e-6;

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function poissonPmf(lambda: number, maximum: number): number[] {
  const values = [Math.exp(-lambda)];
  for (let goals = 1; goals <= maximum; goals += 1) {
    values.push(values[goals - 1]! * lambda / goals);
  }
  const represented = values.reduce((sum, probability) => sum + probability, 0);
  values[maximum] = values[maximum]! + Math.max(0, 1 - represented);
  return values;
}

function independentPmf(homeMean: number, awayMean: number, maximum: number): NhlJointGoalCell[] {
  const home = poissonPmf(homeMean, maximum);
  const away = poissonPmf(awayMean, maximum);
  const cells: NhlJointGoalCell[] = [];
  for (let homeGoals = 0; homeGoals <= maximum; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= maximum; awayGoals += 1) {
      cells.push({
        homeGoals,
        awayGoals,
        probability: home[homeGoals]! * away[awayGoals]!,
      });
    }
  }
  return cells;
}

function summarize(
  pmf: readonly NhlJointGoalCell[],
  overtimeHomeProbability: number,
  homePuckLine: number | null,
  totalLine: number | null,
): DistributionSummary {
  let expectedHomeGoals = 0;
  let expectedAwayGoals = 0;
  let homeWinProbability = 0;
  let homeCoverProbability = 0;
  let puckPushProbability = 0;
  let totalOverProbability = 0;
  let totalUnderProbability = 0;
  let totalPushProbability = 0;

  for (const cell of pmf) {
    const { homeGoals, awayGoals, probability } = cell;
    expectedHomeGoals += homeGoals * probability;
    expectedAwayGoals += awayGoals * probability;
    homeWinProbability += probability * (
      homeGoals > awayGoals ? 1 : homeGoals < awayGoals ? 0 : overtimeHomeProbability
    );
    if (homePuckLine !== null) {
      const result = homeGoals - awayGoals + homePuckLine;
      if (result > 0) homeCoverProbability += probability;
      else if (Math.abs(result) < 1e-12) puckPushProbability += probability;
    }
    if (totalLine !== null) {
      const result = homeGoals + awayGoals - totalLine;
      if (result > 0) totalOverProbability += probability;
      else if (result < 0) totalUnderProbability += probability;
      else totalPushProbability += probability;
    }
  }

  const totalNonPush = totalOverProbability + totalUnderProbability;
  return {
    pmf: pmf.map((cell) => ({ ...cell })),
    expectedHomeGoals,
    expectedAwayGoals,
    expectedTotalGoals: expectedHomeGoals + expectedAwayGoals,
    homeWinProbability,
    homeCoverProbability: homePuckLine === null ? null : homeCoverProbability,
    puckPushProbability: homePuckLine === null ? null : puckPushProbability,
    totalOverProbability: totalLine === null ? null : totalOverProbability,
    totalUnderProbability: totalLine === null ? null : totalUnderProbability,
    totalPushProbability: totalLine === null ? null : totalPushProbability,
    totalConditionalOverProbability: totalLine === null
      ? null
      : totalNonPush <= 0 ? 0.5 : totalOverProbability / totalNonPush,
    overtimeHomeProbability,
  };
}

function expectation(probabilities: readonly number[], feature: readonly number[]): number {
  let result = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    result += probabilities[index]! * feature[index]!;
  }
  return result;
}

function projectedProbabilities(
  base: readonly NhlJointGoalCell[],
  constraints: readonly Constraint[],
  multipliers: readonly number[],
): number[] | null {
  const logWeights = base.map((cell, index) => {
    if (!(cell.probability > 0)) return Number.NEGATIVE_INFINITY;
    let value = Math.log(cell.probability);
    for (let constraint = 0; constraint < constraints.length; constraint += 1) {
      value += multipliers[constraint]! * constraints[constraint]!.feature[index]!;
    }
    return value;
  });
  const maximum = Math.max(...logWeights);
  if (!Number.isFinite(maximum)) return null;
  const raw = logWeights.map((value) => Number.isFinite(value) ? Math.exp(value - maximum) : 0);
  const normalizer = raw.reduce((sum, value) => sum + value, 0);
  if (!(normalizer > 0) || !Number.isFinite(normalizer)) return null;
  return raw.map((value) => value / normalizer);
}

function covarianceMatrix(probabilities: readonly number[], constraints: readonly Constraint[]): number[][] {
  const means = constraints.map((constraint) => expectation(probabilities, constraint.feature));
  return constraints.map((left, leftIndex) => constraints.map((right, rightIndex) => {
    let product = 0;
    for (let cell = 0; cell < probabilities.length; cell += 1) {
      product += probabilities[cell]! * left.feature[cell]! * right.feature[cell]!;
    }
    return product - means[leftIndex]! * means[rightIndex]!;
  }));
}

function solveLinearSystem(matrix: readonly number[][], rhs: readonly number[]): number[] | null {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [
    ...row.map((value, column) => value + (index === column ? 1e-12 : 0)),
    rhs[index]!,
  ]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(augmented[pivot]![column]!) < 1e-14) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    for (let entry = column; entry <= size; entry += 1) augmented[column]![entry] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row]![entry] -= factor * augmented[column]![entry]!;
      }
    }
  }
  const result = augmented.map((row) => row[size]!);
  return result.every(Number.isFinite) ? result : null;
}

function maxResidual(probabilities: readonly number[], constraints: readonly Constraint[]): number {
  return Math.max(...constraints.map((constraint) => (
    Math.abs(expectation(probabilities, constraint.feature) - constraint.target)
  )));
}

function failedClosed(
  reason: string,
  baseSummary: DistributionSummary,
  constraints: readonly Constraint[],
): NhlJointMarketProjectionResult {
  return {
    status: "failed_closed",
    reason,
    converged: false,
    iterations: 0,
    ...baseSummary,
    constraints: constraints.map((constraint) => {
      const achieved = expectation(
        baseSummary.pmf.map((cell) => cell.probability),
        constraint.feature,
      );
      return {
        name: constraint.name,
        origin: constraint.origin,
        target: constraint.target,
        achieved,
        residual: achieved - constraint.target,
      };
    }),
  };
}

/**
 * Reconcile qualified market innovations with one independent NHL goal PMF.
 *
 * This is an information projection, not a weighted blend. The independent PMF
 * is the only prior. Accepted movement innovations are exact constraints; no
 * current market probability or Total level enters this function. If the
 * requested constraint set is invalid, infeasible or does not converge, the
 * exact independent PMF is returned with an explicit failed-closed receipt.
 */
export function projectNhlJointMarketConsequences(
  input: NhlJointMarketProjectionInput,
): NhlJointMarketProjectionResult {
  const maximumGoals = input.maximumGoals ?? DEFAULT_MAXIMUM_GOALS;
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const homeLine = input.homePuckLine ?? null;
  const totalLine = input.totalLine ?? null;

  if (!Number.isFinite(input.independentHomeGoals) || input.independentHomeGoals < 0
    || !Number.isFinite(input.independentAwayGoals) || input.independentAwayGoals < 0
    || !Number.isInteger(maximumGoals) || maximumGoals < 4 || maximumGoals > 30
    || !Number.isFinite(tolerance) || tolerance <= 0
    || !Number.isInteger(maxIterations) || maxIterations <= 0
    || (homeLine !== null && !Number.isFinite(homeLine))
    || (totalLine !== null && !Number.isFinite(totalLine))) {
    const safeHome = Number.isFinite(input.independentHomeGoals) && input.independentHomeGoals >= 0
      ? input.independentHomeGoals : 0;
    const safeAway = Number.isFinite(input.independentAwayGoals) && input.independentAwayGoals >= 0
      ? input.independentAwayGoals : 0;
    const safeMaximum = Number.isInteger(maximumGoals) && maximumGoals >= 4 && maximumGoals <= 30
      ? maximumGoals : DEFAULT_MAXIMUM_GOALS;
    const overtimeHomeProbability = logistic(0.42 * (safeHome - safeAway));
    const pmf = independentPmf(safeHome, safeAway, safeMaximum);
    const summary = summarize(pmf, overtimeHomeProbability, homeLine, totalLine);
    return failedClosed("invalid_projection_input", summary, []);
  }

  const overtimeHomeProbability = logistic(0.42 * (
    input.independentHomeGoals - input.independentAwayGoals
  ));
  const base = independentPmf(input.independentHomeGoals, input.independentAwayGoals, maximumGoals);
  const baseSummary = summarize(base, overtimeHomeProbability, homeLine, totalLine);
  const requestedHomeWin = input.targetHomeWinProbability ?? null;
  const requestedCover = input.targetHomeCoverProbability ?? null;
  const requestedTotal = input.targetExpectedTotalGoals ?? null;
  const hasMarketConstraint = requestedHomeWin !== null || requestedCover !== null || requestedTotal !== null;
  if (!hasMarketConstraint) {
    return {
      status: "identity",
      reason: null,
      converged: true,
      iterations: 0,
      ...baseSummary,
      constraints: [],
    };
  }

  const constraints: Constraint[] = [];
  const homeWinFeature = base.map((cell) => (
    cell.homeGoals > cell.awayGoals ? 1 : cell.homeGoals < cell.awayGoals ? 0 : overtimeHomeProbability
  ));
  const homeWinTarget = requestedHomeWin ?? baseSummary.homeWinProbability;
  constraints.push({
    name: "home_win_probability",
    origin: requestedHomeWin === null ? "independent_preservation" : "market_innovation",
    target: homeWinTarget,
    feature: homeWinFeature,
  });

  if (requestedCover !== null) {
    if (homeLine === null) return failedClosed("cover_target_requires_exact_home_puck_line", baseSummary, constraints);
    constraints.push({
      name: "home_cover_probability",
      origin: "market_innovation",
      target: requestedCover,
      feature: base.map((cell) => cell.homeGoals - cell.awayGoals + homeLine > 0 ? 1 : 0),
    });
  }

  const totalTarget = requestedTotal ?? baseSummary.expectedTotalGoals;
  constraints.push({
    name: "expected_total_goals",
    origin: requestedTotal === null ? "independent_preservation" : "market_innovation",
    target: totalTarget,
    feature: base.map((cell) => cell.homeGoals + cell.awayGoals),
  });

  for (const constraint of constraints) {
    const minimum = Math.min(...constraint.feature);
    const maximum = Math.max(...constraint.feature);
    const probabilityConstraint = constraint.name !== "expected_total_goals";
    if (!Number.isFinite(constraint.target)
      || (probabilityConstraint && (
        constraint.target < MIN_PROBABILITY_TARGET
        || constraint.target > 1 - MIN_PROBABILITY_TARGET
      ))
      || constraint.target <= minimum + 1e-12
      || constraint.target >= maximum - 1e-12) {
      return failedClosed(`invalid_or_infeasible_${constraint.name}`, baseSummary, constraints);
    }
  }

  let multipliers = constraints.map(() => 0);
  let probabilities = base.map((cell) => cell.probability);
  let iterations = 0;
  for (; iterations < maxIterations; iterations += 1) {
    const residuals = constraints.map((constraint) => (
      expectation(probabilities, constraint.feature) - constraint.target
    ));
    if (Math.max(...residuals.map(Math.abs)) <= tolerance) break;
    const step = solveLinearSystem(covarianceMatrix(probabilities, constraints), residuals);
    if (step === null) return failedClosed("singular_constraint_system", baseSummary, constraints);
    const previousResidual = Math.max(...residuals.map(Math.abs));
    let accepted: { multipliers: number[]; probabilities: number[] } | null = null;
    for (let divisor = 1; divisor <= 1_048_576; divisor *= 2) {
      const candidateMultipliers = multipliers.map((value, index) => value - step[index]! / divisor);
      const candidateProbabilities = projectedProbabilities(base, constraints, candidateMultipliers);
      if (candidateProbabilities === null) continue;
      const candidateResidual = maxResidual(candidateProbabilities, constraints);
      if (candidateResidual < previousResidual) {
        accepted = { multipliers: candidateMultipliers, probabilities: candidateProbabilities };
        break;
      }
    }
    if (accepted === null) return failedClosed("constraint_solver_stalled", baseSummary, constraints);
    multipliers = accepted.multipliers;
    probabilities = accepted.probabilities;
  }

  if (maxResidual(probabilities, constraints) > tolerance) {
    return failedClosed("constraint_solver_did_not_converge", baseSummary, constraints);
  }

  const pmf = base.map((cell, index) => ({ ...cell, probability: probabilities[index]! }));
  const summary = summarize(pmf, overtimeHomeProbability, homeLine, totalLine);
  return {
    status: "projected",
    reason: null,
    converged: true,
    iterations,
    ...summary,
    constraints: constraints.map((constraint) => {
      const achieved = expectation(probabilities, constraint.feature);
      return {
        name: constraint.name,
        origin: constraint.origin,
        target: constraint.target,
        achieved,
        residual: achieved - constraint.target,
      };
    }),
  };
}
