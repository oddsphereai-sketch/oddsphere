import { solveCbbResearchRidge } from "./shotProfileResearch";
import { cbbRepairScore, CBB_NEUTRAL_REPAIR_RELEASE } from "./neutralRepairResearch";
import type { CbbScoreFeatureRow } from "./scoreResearch";

export const CBB_RESIDUAL_STAT_RELEASE = "cbb_candidate_2026_10_28_r12_residual_stats";
const odd = new Set([1, 4, 5, 7, 8, 9, 10, 15, 19,
  ...Array.from({ length: 18 }, (_, i) => 21 + 2 * i), 57, 63, 65, 67]);
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
type OffsetSide = { regressions: number[][]; coefficients: number[] };
export type CbbResidualStatHead = { release: typeof CBB_RESIDUAL_STAT_RELEASE; trainedThrough: string;
  trainingGameIds: number[]; loss: "squared" | "huber"; margin: OffsetSide; total: OffsetSide };
export function cbbResidualStatDesign(row: CbbScoreFeatureRow, market: "margin" | "total") {
  if (row.features.length !== 69 || !row.features.every(Number.isFinite)) throw new Error("invalid CBB residual-stat features");
  return row.game.neutral === true ? row.features.map((v, i) => odd.has(i) === (market === "margin") ? v : 0) : row.features;
}
/** R10 means remain an offset. Extra features are regularized-residualized against the old inputs. */
export function fitCbbResidualStats(rows: CbbScoreFeatureRow[], trainedThrough: string, loss: CbbResidualStatHead["loss"]): CbbResidualStatHead {
  if (rows.length < 200 || !Number.isFinite(Date.parse(trainedThrough)) || !["squared", "huber"].includes(loss) ||
    rows.some(r => r.forecast.release !== CBB_NEUTRAL_REPAIR_RELEASE || !Number.isFinite(Date.parse(r.forecast.asOf)) || !Number.isFinite(Date.parse(r.game.date)) ||
      Date.parse(r.forecast.asOf) > Date.parse(r.game.date) || Date.parse(r.game.date) + 21600000 > Date.parse(trainedThrough))) throw new Error("future or incompatible CBB offset labels");
  const fit = (market: "margin" | "total"): OffsetSide => {
    const design = rows.map(r => cbbResidualStatDesign(r, market)), base = design.map(x => x.slice(0, 19));
    const regressions = Array.from({ length: 50 }, (_, j) => solveCbbResearchRidge(base, design.map(x => x[19 + j]), rows.map(() => 1), 100));
    const x = design.map((v, i) => regressions.map((beta, j) => v[19 + j] - dot(base[i], beta)));
    const y = rows.map(r => (market === "margin" ? r.game.homeScore - r.game.awayScore : r.game.homeScore + r.game.awayScore) - r.forecast[market]);
    let weights = rows.map(() => 1), coefficients: number[] = [];
    for (let iteration = 0; iteration < (loss === "squared" ? 1 : 8); iteration++) {
      coefficients = solveCbbResearchRidge(x, y, weights, 100);
      weights = y.map((v, i) => Math.min(1, (market === "margin" ? 10 : 15) / Math.max(1e-9, Math.abs(v - dot(x[i], coefficients)))));
    }
    return { regressions, coefficients };
  };
  return { release: CBB_RESIDUAL_STAT_RELEASE, trainedThrough, trainingGameIds: rows.map(r => r.game.id), loss,
    margin: fit("margin"), total: fit("total") };
}
export function applyCbbResidualStats(row: CbbScoreFeatureRow, head: CbbResidualStatHead) {
  if (head.release !== CBB_RESIDUAL_STAT_RELEASE || row.forecast.release !== CBB_NEUTRAL_REPAIR_RELEASE ||
    !Number.isFinite(Date.parse(head.trainedThrough)) || !Number.isFinite(Date.parse(row.forecast.asOf)) ||
    !Number.isFinite(Date.parse(row.game.date)) || Date.parse(row.forecast.asOf) > Date.parse(row.game.date) ||
    Date.parse(head.trainedThrough) > Date.parse(row.forecast.asOf) || head.trainingGameIds.includes(row.game.id)) throw new Error("in-sample or incompatible CBB residual-stat head");
  const adjustment = (market: "margin" | "total") => {
    const design = cbbResidualStatDesign(row, market), side = head[market];
    if (side.regressions.length !== 50 || side.coefficients.length !== 50 || side.regressions.some(beta => beta.length !== 19)) throw new Error("CBB offset head width mismatch");
    const residuals = side.regressions.map((beta, j) => design[19 + j] - dot(design.slice(0, 19), beta));
    return dot(residuals, side.coefficients);
  };
  return { ...row, forecast: cbbRepairScore(row.forecast, row.forecast.margin + adjustment("margin"), row.forecast.total + adjustment("total"), head.release) };
}
