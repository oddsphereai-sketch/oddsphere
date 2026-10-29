import { normalCdf } from "./model";
import type { CbbScoreFeatureRow } from "./scoreResearch";
import type { CbbForecast } from "./types";

export const CBB_OVERTIME_MIXTURE_RELEASE = "cbb_candidate_2026_10_29_r16_overtime_mixture";
export type CbbOvertimeMixtureHead = {
  release: typeof CBB_OVERTIME_MIXTURE_RELEASE;
  trainedThrough: string;
  trainingGameIds: number[];
  logitIntercept: number;
  logitMarginSlope: number;
  overtimeAddedPoints: number;
  overtimeGames: number;
  trainingGames: number;
  converged: boolean;
};

const sigmoid = (x: number) => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
const logitFeature = (forecast: CbbForecast) => Math.abs(forecast.margin) / 10;

/** Fit using only labels already settled before the head's training cutoff. */
export function fitCbbOvertimeMixture(rows: CbbScoreFeatureRow[], trainedThrough: string): CbbOvertimeMixtureHead {
  const cutoff = Date.parse(trainedThrough);
  if (!Number.isFinite(cutoff) || rows.length < 200 || rows.some(r =>
    !Number.isFinite(Date.parse(r.game.date)) || Date.parse(r.game.date) + 6 * 3600000 > cutoff ||
    Date.parse(r.forecast.asOf) > Date.parse(r.game.date) || !Number.isFinite(r.forecast.margin) ||
    !Number.isFinite(r.game.homeRegulation + r.game.awayRegulation))) throw new Error("invalid overtime training chronology");
  const ids = rows.map(r => r.game.id);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate overtime training game");
  const overtime = rows.filter(r => r.game.overtime);
  if (overtime.length < 30) throw new Error("insufficient overtime outcomes");
  const added = overtime.reduce((sum, r) => sum + r.game.homeScore + r.game.awayScore - r.game.homeRegulation - r.game.awayRegulation, 0) / overtime.length;
  if (!(added > 0 && added < 100)) throw new Error("invalid overtime point estimate");
  let intercept = Math.log(overtime.length / (rows.length - overtime.length)), slope = 0, converged = false;
  for (let iteration = 0; iteration < 50; iteration++) {
    let g0 = 10 * intercept, g1 = 10 * slope, h00 = 10, h01 = 0, h11 = 10;
    for (const r of rows) {
      const x = logitFeature(r.forecast), p = sigmoid(intercept + slope * x), y = Number(r.game.overtime), w = p * (1 - p);
      g0 += p - y; g1 += (p - y) * x; h00 += w; h01 += w * x; h11 += w * x * x;
    }
    const det = h00 * h11 - h01 * h01;
    if (!(det > 0)) throw new Error("singular overtime regression");
    const d0 = (h11 * g0 - h01 * g1) / det, d1 = (h00 * g1 - h01 * g0) / det;
    intercept -= d0; slope -= d1;
    if (Math.max(Math.abs(d0), Math.abs(d1)) < 1e-9) { converged = true; break; }
  }
  if (!converged || ![intercept, slope].every(Number.isFinite)) throw new Error("overtime fit did not converge");
  return { release: CBB_OVERTIME_MIXTURE_RELEASE, trainedThrough, trainingGameIds: ids,
    logitIntercept: intercept, logitMarginSlope: slope, overtimeAddedPoints: added,
    overtimeGames: overtime.length, trainingGames: rows.length, converged };
}

export function cbbOvertimeMixtureMoments(forecast: CbbForecast, head: CbbOvertimeMixtureHead) {
  if (head.release !== CBB_OVERTIME_MIXTURE_RELEASE || !Number.isFinite(Date.parse(head.trainedThrough)) ||
    !Number.isFinite(Date.parse(forecast.asOf)) || Date.parse(head.trainedThrough) > Date.parse(forecast.asOf) ||
    head.trainingGameIds.includes(forecast.gameId) || ![forecast.margin, forecast.total, forecast.uncertainty.totalSd,
      head.overtimeAddedPoints, head.logitIntercept, head.logitMarginSlope].every(Number.isFinite)) throw new Error("in-sample or incompatible overtime distribution");
  const p = sigmoid(head.logitIntercept + head.logitMarginSlope * logitFeature(forecast));
  const difference = head.overtimeAddedPoints, variance = forecast.uncertainty.totalSd ** 2 - p * (1 - p) * difference ** 2;
  if (!(variance > 0) || !(p > 0 && p < 1)) throw new Error("overtime mixture variance invalid");
  const regulationMean = forecast.total - p * difference;
  return { overtimeProbability: p, overtimeAddedPoints: difference, regulationMean,
    overtimeMean: regulationMean + difference, withinComponentSd: Math.sqrt(variance),
    finalMean: forecast.total, finalVariance: forecast.uncertainty.totalSd ** 2 };
}

/** First = over; second = under; integer lines retain a modeled push mass. */
export function cbbOvertimeMixtureProbabilitiesAtLine(m: ReturnType<typeof cbbOvertimeMixtureMoments>, line: number) {
  if (!Number.isFinite(line) || Math.round(line * 2) !== line * 2) throw new Error("invalid overtime total line");
  const upper = Number.isInteger(line) ? line + 0.5 : Math.ceil(line) - 0.5;
  const lower = Number.isInteger(line) ? line - 0.5 : upper;
  const cdf = (x: number) => (1 - m.overtimeProbability) * normalCdf((x - m.regulationMean) / m.withinComponentSd) +
    m.overtimeProbability * normalCdf((x - m.overtimeMean) / m.withinComponentSd);
  const first = 1 - cdf(upper), second = cdf(lower);
  return { first, second, push: Math.max(0, 1 - first - second) };
}
export function cbbOvertimeMixtureTotalProbabilities(forecast: CbbForecast, head: CbbOvertimeMixtureHead, line: number) {
  return cbbOvertimeMixtureProbabilitiesAtLine(cbbOvertimeMixtureMoments(forecast, head), line);
}
