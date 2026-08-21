import type { FootballLeague, FootballMarket, FootballSide } from "./footballModelContract";
import { americanToImpliedProbability } from "./footballMarketMath";

export const FOOTBALL_EVALUATION_RELEASE = "football_shadow_evaluation_2026_08_19_r1" as const;

export type FootballBetOutcome = "win" | "loss" | "push";

export type FootballProbabilityEvaluationRow = {
  modelRelease: string;
  league: FootballLeague;
  gameId: string;
  market: FootballMarket;
  side: FootballSide;
  decisionTimestamp: string;
  predictedProbability: number;
  americanPrice: number;
  outcome: FootballBetOutcome;
};

export type FootballPointForecastRow = {
  modelRelease: string;
  league: FootballLeague;
  gameId: string;
  forecast: "home_margin" | "total";
  decisionTimestamp: string;
  predictedValue: number;
  actualValue: number;
};

export type FootballProbabilityEvaluation = {
  evaluationRelease: typeof FOOTBALL_EVALUATION_RELEASE;
  modelRelease: string;
  league: FootballLeague;
  market: FootballMarket;
  wagers: number;
  resolved: number;
  pushes: number;
  wins: number;
  brierScore: number | null;
  logLoss: number | null;
  expectedCalibrationError: number | null;
  profitUnits: number;
  roiPerUnitRisked: number | null;
};

export type FootballPointEvaluation = {
  evaluationRelease: typeof FOOTBALL_EVALUATION_RELEASE;
  modelRelease: string;
  league: FootballLeague;
  forecast: "home_margin" | "total";
  forecasts: number;
  meanAbsoluteError: number;
  rootMeanSquaredError: number;
  meanError: number;
};

function groupBy<T>(rows: T[], keyFor: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function profitForOneUnit(price: number): number {
  // Reuse the central validator so zero/non-finite American prices fail closed.
  americanToImpliedProbability(price);
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function calibrationError(rows: FootballProbabilityEvaluationRow[], bins: number): number {
  const buckets: FootballProbabilityEvaluationRow[][] = Array.from({ length: bins }, () => []);
  for (const row of rows) {
    const index = Math.min(bins - 1, Math.floor(row.predictedProbability * bins));
    buckets[index].push(row);
  }
  return buckets.reduce((total, bucket) => {
    if (bucket.length === 0) return total;
    const confidence = bucket.reduce((sum, row) => sum + row.predictedProbability, 0) / bucket.length;
    const accuracy = bucket.filter((row) => row.outcome === "win").length / bucket.length;
    return total + Math.abs(confidence - accuracy) * (bucket.length / rows.length);
  }, 0);
}

/** Returns one evaluation per release/league/market so releases cannot be silently blended. */
export function evaluateFootballProbabilities(
  rows: FootballProbabilityEvaluationRow[],
  calibrationBins = 10,
): FootballProbabilityEvaluation[] {
  if (!Number.isInteger(calibrationBins) || calibrationBins < 2) throw new Error("calibrationBins must be an integer of at least 2.");
  for (const row of rows) {
    if (!row.modelRelease.trim()) throw new Error("Every probability row requires a model release.");
    if (!Number.isFinite(row.predictedProbability) || row.predictedProbability < 0 || row.predictedProbability > 1) {
      throw new Error("Predicted probabilities must be between 0 and 1.");
    }
    if (!Number.isFinite(Date.parse(row.decisionTimestamp))) throw new Error("Every probability row requires a valid decision timestamp.");
    profitForOneUnit(row.americanPrice);
  }
  return [...groupBy(rows, (row) => `${row.modelRelease}|${row.league}|${row.market}`).values()].map((group) => {
    const resolved = group.filter((row) => row.outcome !== "push");
    const wins = resolved.filter((row) => row.outcome === "win").length;
    const brierScore = resolved.length === 0
      ? null
      : resolved.reduce((sum, row) => sum + Math.pow(row.predictedProbability - (row.outcome === "win" ? 1 : 0), 2), 0) / resolved.length;
    const epsilon = 1e-15;
    const logLoss = resolved.length === 0
      ? null
      : -resolved.reduce((sum, row) => {
        const probability = Math.min(1 - epsilon, Math.max(epsilon, row.predictedProbability));
        return sum + (row.outcome === "win" ? Math.log(probability) : Math.log(1 - probability));
      }, 0) / resolved.length;
    const profitUnits = group.reduce((sum, row) => {
      if (row.outcome === "push") return sum;
      return sum + (row.outcome === "win" ? profitForOneUnit(row.americanPrice) : -1);
    }, 0);
    return {
      evaluationRelease: FOOTBALL_EVALUATION_RELEASE,
      modelRelease: group[0].modelRelease,
      league: group[0].league,
      market: group[0].market,
      wagers: group.length,
      resolved: resolved.length,
      pushes: group.length - resolved.length,
      wins,
      brierScore,
      logLoss,
      expectedCalibrationError: resolved.length === 0 ? null : calibrationError(resolved, calibrationBins),
      profitUnits,
      roiPerUnitRisked: group.length === 0 ? null : profitUnits / group.length,
    };
  });
}

/** Returns one point-error evaluation per release/league/forecast family. */
export function evaluateFootballPointForecasts(rows: FootballPointForecastRow[]): FootballPointEvaluation[] {
  for (const row of rows) {
    if (!row.modelRelease.trim()) throw new Error("Every point forecast requires a model release.");
    if (![row.predictedValue, row.actualValue].every(Number.isFinite)) throw new Error("Point forecasts and outcomes must be finite.");
    if (!Number.isFinite(Date.parse(row.decisionTimestamp))) throw new Error("Every point forecast requires a valid decision timestamp.");
  }
  return [...groupBy(rows, (row) => `${row.modelRelease}|${row.league}|${row.forecast}`).values()].map((group) => {
    const errors = group.map((row) => row.predictedValue - row.actualValue);
    return {
      evaluationRelease: FOOTBALL_EVALUATION_RELEASE,
      modelRelease: group[0].modelRelease,
      league: group[0].league,
      forecast: group[0].forecast,
      forecasts: group.length,
      meanAbsoluteError: errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length,
      rootMeanSquaredError: Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length),
      meanError: errors.reduce((sum, error) => sum + error, 0) / errors.length,
    };
  });
}
