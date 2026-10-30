import { normalCdf } from "./model";
import { cbbRepairScore, CBB_NEUTRAL_REPAIR_RELEASE } from "./neutralRepairResearch";
import { cbbResidualStatDesign, CBB_RESIDUAL_STAT_RELEASE, fitCbbResidualStats, type CbbResidualStatHead } from "./residualStatResearch";
import { solveCbbResearchRidge } from "./shotProfileResearch";
import type { CbbScoreFeatureRow } from "./scoreResearch";

export const CBB_DECISION_RELEASES = {
  matched_total: "cbb_candidate_2026_10_28_r13_matched_total",
  median_total: "cbb_candidate_2026_10_28_r14_median_total",
  distribution: "cbb_candidate_2026_10_28_r15_distribution_decisions",
} as const;
export type CbbDecisionVariant = keyof typeof CBB_DECISION_RELEASES;
type Side = CbbResidualStatHead["total"];
export type CbbDecisionHead = { release: typeof CBB_DECISION_RELEASES[CbbDecisionVariant]; variant: CbbDecisionVariant;
  trainedThrough: string; trainingGameIds: number[]; margin: Side; total: Side;
  marginSource: "frozen_r12" | "matched_grid_log_loss";
  numerical: Record<string, { iterations: number; converged: boolean; objective: number }> };
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
export const CBB_TOTAL_DECISION_THRESHOLDS = Array.from({ length: 21 }, (_, i) => 100.5 + 5 * i);
export const CBB_MARGIN_DECISION_THRESHOLDS = [...Array.from({ length: 7 }, (_, i) => -30.5 + 5 * i), ...Array.from({ length: 7 }, (_, i) => 0.5 + 5 * i)];
/** Proper binary log score at a fixed threshold, with derivatives in the score's location. */
export function cbbProbitDecisionLoss(actual: number, location: number, sd: number, thresholds: number[]) {
  if (![actual, location, sd, ...thresholds].every(Number.isFinite) || sd <= 0 || !thresholds.length) throw new Error("invalid CBB decision threshold inputs");
  let loss = 0, gradient = 0, curvature = 0;
  for (const threshold of thresholds) {
    const z = (location - threshold) / sd, p = Math.max(1e-12, Math.min(1 - 1e-12, normalCdf(z)));
    const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI), y = actual > threshold;
    const ratio = phi / (y ? p : 1 - p);
    loss -= Math.log(y ? p : 1 - p);
    gradient += (y ? -ratio : ratio) / sd;
    curvature += ((y ? z : -z) * ratio + ratio * ratio) / (sd * sd);
  }
  return { loss: loss / thresholds.length, gradient: gradient / thresholds.length, curvature: curvature / thresholds.length };
}
function residualFeatures(row: CbbScoreFeatureRow, side: Side, market: "margin" | "total") {
  const x = cbbResidualStatDesign(row, market);
  if (side.regressions.length !== 50 || side.coefficients.length !== 50 || side.regressions.some(b => b.length !== 19)) throw new Error("CBB decision side schema mismatch");
  return side.regressions.map((beta, j) => x[19 + j] - dot(x.slice(0, 19), beta));
}
export function fitCbbDecisionHead(rows: CbbScoreFeatureRow[], trainedThrough: string, variant: CbbDecisionVariant, frozenR12: CbbResidualStatHead): CbbDecisionHead {
  if (!(variant in CBB_DECISION_RELEASES) || frozenR12.release !== CBB_RESIDUAL_STAT_RELEASE ||
    ![frozenR12.trainedThrough, trainedThrough].every(t => Number.isFinite(Date.parse(t))) ||
    Date.parse(frozenR12.trainedThrough) > Date.parse(trainedThrough)) throw new Error("future or unknown CBB decision parent");
  // This existing fitter validates every training timestamp, input release and feature width.
  const matched = fitCbbResidualStats(rows, trainedThrough, "squared");
  const numerical: CbbDecisionHead["numerical"] = {};
  function fit(market: "margin" | "total", loss: "median" | "cdf"): Side {
    const side = matched[market], x = rows.map(r => residualFeatures(r, side, market));
    const y = rows.map(r => (market === "margin" ? r.game.homeScore - r.game.awayScore : r.game.homeScore + r.game.awayScore) - r.forecast[market]);
    let beta = [...side.coefficients], iterations = 0, converged = false;
    const terms = (i: number, b: number[]) => {
      const adjustment = dot(x[i], b), error = adjustment - y[i];
      if (loss === "median") return { loss: 15 * Math.sqrt(error * error + 0.25 ** 2),
        gradient: 15 * error / Math.sqrt(error * error + 0.25 ** 2), weight: 15 / Math.sqrt(error * error + 0.25 ** 2) };
      const row = rows[i], sd = market === "margin" ? row.forecast.uncertainty.marginSd : row.forecast.uncertainty.totalSd;
      const threshold = market === "margin" ? CBB_MARGIN_DECISION_THRESHOLDS : CBB_TOTAL_DECISION_THRESHOLDS;
      const t = cbbProbitDecisionLoss(y[i] + row.forecast[market], row.forecast[market] + adjustment, sd, threshold);
      return { loss: t.loss * sd * sd, gradient: t.gradient * sd * sd, weight: Math.max(1e-12, t.curvature * sd * sd) };
    };
    const objective = (b: number[]) => 50 * dot(b, b) + rows.reduce((s, _, i) => s + terms(i, b).loss, 0);
    for (; iterations < 80; iterations++) {
      const t = rows.map((_, i) => terms(i, beta)), weights = t.map(r => r.weight);
      const pseudo = t.map((r, i) => dot(x[i], beta) - r.gradient / r.weight);
      const solved = solveCbbResearchRidge(x, pseudo, weights, 100), before = objective(beta);
      let rate = 1, next = beta, nextObjective = before, accepted = false;
      for (let search = 0; search < 30; search++, rate /= 2) {
        const candidate = beta.map((v, j) => v + rate * (solved[j] - v)), value = objective(candidate);
        if (Number.isFinite(value) && value <= before) { next = candidate; nextObjective = value; accepted = true; break; }
      }
      const change = Math.max(...next.map((v, j) => Math.abs(v - beta[j]))); beta = next;
      if (accepted && (change < 1e-8 || Math.abs(before - nextObjective) < 1e-10 * Math.max(1, Math.abs(before)))) { converged = true; break; }
      if (!accepted) break;
    }
    numerical[market] = { iterations: iterations + 1, converged, objective: objective(beta) };
    if (!beta.every(Number.isFinite)) throw new Error("nonfinite CBB decision fit");
    return { regressions: side.regressions, coefficients: beta };
  }
  const margin = variant === "distribution" ? fit("margin", "cdf") : frozenR12.margin;
  const total = variant === "matched_total" ? matched.total : fit("total", variant === "median_total" ? "median" : "cdf");
  return { release: CBB_DECISION_RELEASES[variant], variant, trainedThrough,
    trainingGameIds: [...new Set([...matched.trainingGameIds, ...frozenR12.trainingGameIds])], margin, total,
    marginSource: variant === "distribution" ? "matched_grid_log_loss" : "frozen_r12", numerical };
}
export function applyCbbDecisionHead(row: CbbScoreFeatureRow, head: CbbDecisionHead) {
  if (head.release !== CBB_DECISION_RELEASES[head.variant] || row.forecast.release !== CBB_NEUTRAL_REPAIR_RELEASE ||
    ![head.trainedThrough, row.forecast.asOf, row.game.date].every(t => Number.isFinite(Date.parse(t))) ||
    Date.parse(head.trainedThrough) > Date.parse(row.forecast.asOf) || Date.parse(row.forecast.asOf) > Date.parse(row.game.date) || head.trainingGameIds.includes(row.game.id)) throw new Error("in-sample or incompatible CBB decision head");
  const margin = row.forecast.margin + dot(residualFeatures(row, head.margin, "margin"), head.margin.coefficients);
  const total = row.forecast.total + dot(residualFeatures(row, head.total, "total"), head.total.coefficients);
  return { ...row, forecast: cbbRepairScore(row.forecast, margin, total, head.release) };
}
/** These fixed-grid proper scores are NOT historical sportsbook W/L records. */
export function evaluateCbbDecisionGrid(rows: CbbScoreFeatureRow[]) {
  const average = (market: "margin" | "total") => rows.reduce((s, r) => {
    const actual = market === "margin" ? r.game.homeScore - r.game.awayScore : r.game.homeScore + r.game.awayScore;
    const sd = market === "margin" ? r.forecast.uncertainty.marginSd : r.forecast.uncertainty.totalSd;
    return s + cbbProbitDecisionLoss(actual, r.forecast[market], sd, market === "margin" ? CBB_MARGIN_DECISION_THRESHOLDS : CBB_TOTAL_DECISION_THRESHOLDS).loss;
  }, 0) / rows.length;
  return { margin: average("margin"), total: average("total") };
}
