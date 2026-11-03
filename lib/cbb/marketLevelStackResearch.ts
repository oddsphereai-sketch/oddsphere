/** Offline coefficient fitting only. A fitted empirical-risk minimizer is not
 * source-transfer, probability-calibration, grade or publication qualification. */
export const CBB_LEVEL_STACK_RESEARCH_RELEASE = "cbb_level_stack_research_2026_11_02_r1" as const;
export type CbbLevelStackAxis = "margin" | "total";
export type CbbLevelStackExpert =
  | { id: string; kind: "independent" }
  | { id: string; kind: "market"; book: string; market: "moneyline" | "spread" | "total" };
export type CbbLevelStackTrainingRow = {
  gameId: number;
  decisionAt: string;
  outcomeAvailableAt: string;
  outcome: number;
  values: Record<string, number>;
};
type StackMetadata = {
  release: typeof CBB_LEVEL_STACK_RESEARCH_RELEASE;
  axis: CbbLevelStackAxis;
  experts: CbbLevelStackExpert[];
  expertIds: string[];
  sourcePattern: string;
  sourceScope: string;
  trainingGameIds: number[];
  trainingRows: number;
  firstDecisionAt: string;
  lastDecisionAt: string;
  trainedThrough: string;
  trainingCutoff: string;
};
export type CbbMarketLevelStackModel = StackMetadata & {
  weights: number[];
  uncenteredSecondMoment: number[][];
  trainingRisk: number;
  objective: "mean_squared_outcome_error";
  constraint: "nonnegative_sum_to_one";
};
export type CbbLevelStackFitResult =
  | { status: "fitted"; model: CbbMarketLevelStackModel }
  | { status: "unidentified"; reason: "multiple_optimal_weight_vectors" | "numerical_optimum_unresolved";
      metadata: StackMetadata; uncenteredSecondMoment: number[][]; trainingRisk: number;
      candidateWeights: number[][] };

const physicalBook = (book: string) => {
  const normalized = book.trim().toLowerCase();
  return ["ps3838", "pinnacle_mqtt"].includes(normalized) ? "pinnacle" : normalized;
};
const sum = (values: number[]) => {
  let total = 0, correction = 0;
  for (const value of values) {
    const adjusted = value - correction, next = total + adjusted;
    correction = (next - total) - adjusted; total = next;
  }
  return total;
};
const dot = (a: number[], b: number[]) => sum(a.map((v, i) => v * b[i]));
const maxAbs = (matrix: number[][]) => Math.max(0, ...matrix.flat().map(Math.abs));
// These are floating-point certification tolerances, not fitted penalties,
// statistical uncertainty, price bins, influence thresholds or a ridge.
const numericTolerance = (scale: number, dimension: number) =>
  256 * Number.EPSILON * Math.max(1, scale) * dimension;

/** Partial-pivot elimination. Singular active faces have their extreme optimal
 * points on smaller faces; enumeration also exposes nonunique minima there. */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length, a = matrix.map((row, i) => [...row, rhs[i]]);
  const tolerance = numericTolerance(maxAbs(matrix), n);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) <= tolerance) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row++) {
      const multiplier = a[row][col] / a[col][col];
      a[row][col] = 0;
      for (let k = col + 1; k <= n; k++) a[row][k] -= multiplier * a[col][k];
    }
  }
  const answer = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    answer[row] = (a[row][n] - sum(answer.slice(row + 1).map((value, i) => a[row][row + 1 + i] * value))) / a[row][row];
  }
  return answer.every(Number.isFinite) ? answer : null;
}

function normalizedExperts(axis: CbbLevelStackAxis, experts: CbbLevelStackExpert[]) {
  if (!["margin", "total"].includes(axis) || !Array.isArray(experts) || experts.length < 1 || experts.length > 6 ||
    experts.filter(expert => expert.kind === "independent").length !== 1) {
    throw new Error("CBB level stack requires one independent expert and at most six fixed experts");
  }
  const ids = new Set<string>(), books = new Set<string>();
  return experts.map(expert => {
    if (typeof expert.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_:-]{0,127}$/.test(expert.id) || ids.has(expert.id)) {
      throw new Error("CBB level stack expert identities must be explicit and unique");
    }
    ids.add(expert.id);
    if (expert.kind === "independent") return { ...expert };
    if (expert.kind !== "market" || typeof expert.book !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(physicalBook(expert.book)) ||
      !(axis === "total" ? expert.market === "total" : ["moneyline", "spread"].includes(expert.market))) {
      throw new Error("CBB level stack market expert identity/coordinate mismatch");
    }
    const book = physicalBook(expert.book);
    if (books.has(book)) throw new Error("CBB level stack cannot count one physical book as multiple experts");
    books.add(book);
    return { ...expert, book };
  });
}
const sameKeys = (received: string[], expected: string[]) =>
  received.length === expected.length && [...received].sort().every((id, i) => id === [...expected].sort()[i]);

/** Fixed-pattern convex least squares. Source names never select amplitude;
 * masks never borrow or renormalize a different pattern's coefficients. */
export function fitCbbMarketLevelStack(args: {
  axis: CbbLevelStackAxis;
  experts: CbbLevelStackExpert[];
  rows: CbbLevelStackTrainingRow[];
  trainingCutoff: string;
  sourceScope: string;
}): CbbLevelStackFitResult {
  const experts = normalizedExperts(args.axis, args.experts), ids = experts.map(expert => expert.id), n = ids.length;
  const cutoff = Date.parse(args.trainingCutoff);
  if (!Number.isFinite(cutoff) || typeof args.sourceScope !== "string" || !args.sourceScope.trim() || args.sourceScope.length > 2048 ||
    !Array.isArray(args.rows) || !args.rows.length) throw new Error("CBB level stack training scope/cutoff missing");
  const gameIds = new Set<number>();
  const rows = [...args.rows].sort((a, b) => Date.parse(a.decisionAt) - Date.parse(b.decisionAt) || a.gameId - b.gameId);
  const errors = rows.map(row => {
    const decision = Date.parse(row.decisionAt), available = Date.parse(row.outcomeAvailableAt);
    if (!Number.isSafeInteger(row.gameId) || row.gameId <= 0 || gameIds.has(row.gameId) ||
      ![decision, available, row.outcome].every(Number.isFinite) || decision >= available || available > cutoff) {
      throw new Error("CBB level stack duplicate game or invalid/future outcome information");
    }
    gameIds.add(row.gameId);
    if (!row.values || !sameKeys(Object.keys(row.values), ids) || !ids.every(id => Number.isFinite(row.values[id]))) {
      throw new Error("CBB level stack training row has an unsupported source pattern or nonfinite expert");
    }
    return ids.map(id => row.values[id] - row.outcome);
  });
  const matrix = ids.map((_, i) => ids.map((__, j) => sum(errors.map(error => error[i] * error[j])) / rows.length));
  if (!matrix.flat().every(Number.isFinite)) throw new Error("CBB level stack second moment overflow");
  const metadata: StackMetadata = {
    release: CBB_LEVEL_STACK_RESEARCH_RELEASE, axis: args.axis, experts, expertIds: ids,
    sourcePattern: JSON.stringify({ axis: args.axis, experts: [...experts].sort((a, b) => a.id.localeCompare(b.id))
      .map(expert => expert.kind === "independent" ? [expert.id, expert.kind] : [expert.id, expert.kind, expert.book, expert.market]) }),
    sourceScope: args.sourceScope, trainingGameIds: rows.map(row => row.gameId), trainingRows: rows.length,
    firstDecisionAt: rows[0].decisionAt, lastDecisionAt: rows.at(-1)!.decisionAt,
    trainedThrough: new Date(Math.max(...rows.map(row => Date.parse(row.outcomeAvailableAt)))).toISOString(),
    trainingCutoff: args.trainingCutoff,
  };
  const matrixScale = maxAbs(matrix), scale = matrixScale || 1, scaled = matrix.map(row => row.map(value => value / scale));
  const weightTolerance = numericTolerance(1, n + 1), riskTolerance = 256 * Number.EPSILON * matrixScale * (n + 1);
  const candidates: Array<{ weights: number[]; risk: number }> = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const active = ids.flatMap((_, i) => mask & 1 << i ? [i] : []), count = active.length;
    const kkt = active.map(i => [...active.map(j => scaled[i][j]), -1]);
    kkt.push([...active.map(() => 1), 0]);
    const solution = solve(kkt, [...active.map(() => 0), 1]);
    if (!solution || solution.slice(0, count).some(weight => weight < -weightTolerance)) continue;
    const weights = new Array<number>(n).fill(0);
    active.forEach((i, j) => { weights[i] = Math.max(0, solution[j]); });
    // Remove only elimination roundoff; this is the same fitted face, not a
    // prediction-time renormalization after losing a source.
    const total = sum(weights);
    if (!Number.isFinite(total) || Math.abs(total - 1) > weightTolerance) continue;
    weights.forEach((weight, i) => { weights[i] = weight / total; });
    const gradient = scaled.map(row => dot(row, weights)), lambda = dot(gradient, weights);
    if (gradient.some((value, i) => weights[i] > weightTolerance
      ? Math.abs(value - lambda) > weightTolerance : value < lambda - weightTolerance)) continue;
    const risk = sum(errors.map(error => dot(error, weights) ** 2)) / rows.length;
    if (!Number.isFinite(risk)) throw new Error("CBB level stack fitted risk overflow");
    if (!candidates.some(candidate => candidate.weights.every((weight, i) => Math.abs(weight - weights[i]) <= weightTolerance))) {
      candidates.push({ weights, risk });
    }
  }
  candidates.sort((a, b) => a.risk - b.risk);
  if (!candidates.length) throw new Error("CBB level stack could not certify a numerical simplex optimum");
  const best = candidates[0], alternatives = candidates.filter(candidate => candidate.risk - best.risk <= riskTolerance);
  if (alternatives.length > 1) {
    const exactFlat = alternatives.every(candidate => errors.every(error =>
      Math.abs(dot(error, candidate.weights) - dot(error, best.weights)) <= 256 * Number.EPSILON * Math.max(...error.map(Math.abs)) * (n + 1)));
    return { status: "unidentified", reason: exactFlat ? "multiple_optimal_weight_vectors" : "numerical_optimum_unresolved",
      metadata, uncenteredSecondMoment: matrix, trainingRisk: best.risk,
      candidateWeights: alternatives.map(candidate => candidate.weights) };
  }
  return { status: "fitted", model: { ...metadata, weights: best.weights, uncenteredSecondMoment: matrix,
    trainingRisk: best.risk, objective: "mean_squared_outcome_error", constraint: "nonnegative_sum_to_one" } };
}

export function predictCbbMarketLevelStack(model: CbbMarketLevelStackModel, values: Record<string, number>):
  | { status: "predicted"; value: number }
  | { status: "unsupported_source_pattern"; reason: string; expectedExpertIds: string[]; receivedExpertIds: string[] } {
  if (model.release !== CBB_LEVEL_STACK_RESEARCH_RELEASE) throw new Error("CBB level stack release mismatch");
  const received = Object.keys(values), expected = model.expertIds;
  if (!sameKeys(received, expected)) return { status: "unsupported_source_pattern", reason: "no_coefficient_transfer_or_book_renormalization",
    expectedExpertIds: [...expected], receivedExpertIds: received };
  if (!expected.every(id => Number.isFinite(values[id]))) throw new Error("CBB level stack prediction contains nonfinite values");
  const value = dot(expected.map(id => values[id]), model.weights);
  if (!Number.isFinite(value)) throw new Error("CBB level stack prediction overflow");
  return { status: "predicted", value };
}
