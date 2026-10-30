import { normalCdf } from "./model";
import { cbbScoreFeatures, correctCbbScoreForecast, CBB_SCORE_RESEARCH_RELEASE, type CbbScoreCorrection, type CbbScoreFeatureRow } from "./scoreResearch";
import { solveCbbResearchRidge } from "./shotProfileResearch";
import type { CbbForecast, CbbRatingState, CbbTrainingGame } from "./types";

export const CBB_NEUTRAL_REPAIR_RELEASE = "cbb_candidate_2026_10_28_r10_neutral_symmetry" as const;
export const CBB_CONDITIONAL_NOISE_RELEASE = "cbb_candidate_2026_10_28_r11_conditional_uncertainty" as const;
const odd = new Set([1, 4, 5, 7, 8, 9, 10, 15]);
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const lag = 21600000;
const appearanceCache = new WeakMap<CbbTrainingGame[], Map<string, Array<{ availableAt: number; rated: boolean }>>>();
export type CbbRepairRow = CbbScoreFeatureRow & { historyKnown: boolean; minimumTeamGames: number };
export type CbbSymmetricHead = {
  release: typeof CBB_NEUTRAL_REPAIR_RELEASE; trainedThrough: string; trainingGameIds: number[];
  variant: "projection" | "refit"; margin: number[]; total: number[];
};

/** One joint score supplies every market; this does not round or force a preferred winner. */
export function cbbRepairScore(forecast: CbbForecast, margin: number, total: number, release: string): CbbForecast {
  const homeScore = (total + margin) / 2, awayScore = (total - margin) / 2;
  const sd = forecast.uncertainty.marginSd;
  if (![margin, total, homeScore, awayScore, sd].every(Number.isFinite) || homeScore <= 0 || awayScore <= 0 || sd <= 0) {
    throw new Error("incoherent CBB repair forecast");
  }
  const zero = normalCdf((0.5 - margin) / sd) - normalCdf((-0.5 - margin) / sd);
  const homeWinProbability = (1 - normalCdf((0.5 - margin) / sd)) / (1 - zero);
  return { ...forecast, release, homeScore, awayScore, margin, total, homeWinProbability };
}

/** Raw means can be recovered from cached pre-correction features, not from the outcomes. */
export function cbbRawRepairRow(row: CbbScoreFeatureRow, history: CbbTrainingGame[]): CbbRepairRow {
  if (row.features.length !== 19 || !row.features.every(Number.isFinite)) throw new Error("CBB repair feature width");
  let appearances = Object.isFrozen(history) ? appearanceCache.get(history) : undefined;
  if (!appearances) {
    appearances = new Map();
    for (const g of history) for (const id of [g.homeId, g.awayId]) {
      const key = `${g.season}:${id}`, entries = appearances.get(key) ?? [];
      entries.push({ availableAt: Date.parse(g.date) + lag, rated: g.neutral !== null }); appearances.set(key, entries);
    }
    if (Object.isFrozen(history)) appearanceCache.set(history, appearances);
  }
  const cutoff = Date.parse(row.forecast.asOf);
  if (!Number.isFinite(cutoff) || cutoff > Date.parse(row.game.date)) throw new Error("invalid CBB repair as-of");
  const count = (id: number, rated: boolean) => (appearances!.get(`${row.game.season}:${id}`) ?? []).filter(g => g.availableAt <= cutoff && (!rated || g.rated)).length;
  const minimumTeamGames = Math.min(count(row.game.homeId, true), count(row.game.awayId, true));
  return { ...row, forecast: cbbRepairScore(row.forecast, row.features[1] * 10, row.features[2] * 20 + 140, row.forecast.release),
    historyKnown: Math.min(count(row.game.homeId, false), count(row.game.awayId, false)) > 0, minimumTeamGames };
}

/** Reflection of the original R2 raw features, including its old listing bias. */
export function cbbReverseNeutralRow(row: CbbRepairRow): CbbRepairRow {
  if (row.game.neutral !== true) throw new Error("CBB reflection requires verified neutral site");
  if (row.features.length !== 19 || Math.abs(row.features[1] * 10 - row.forecast.margin) > 1e-8) throw new Error("CBB reflection requires raw features");
  const mc = row.forecast.uncertainty.marginCorrection, margin = -row.forecast.margin + 2 * mc;
  const features = row.features.map((v, i) => odd.has(i) ? -v : v);
  features[1] = margin / 10; features[4] = margin * Math.abs(margin) / 400;
  features[15] = row.historyKnown ? -row.features[15] - mc / 10 : 0;
  const g = row.game;
  const game = { ...g, homeId: g.awayId, awayId: g.homeId, homeScore: g.awayScore, awayScore: g.homeScore,
    homeRegulation: g.awayRegulation, awayRegulation: g.homeRegulation, homeFactors: g.awayFactors, awayFactors: g.homeFactors };
  const forecast = cbbRepairScore({ ...row.forecast, homeId: game.homeId, awayId: game.awayId }, margin, row.forecast.total, row.forecast.release);
  return { ...row, game, forecast, features };
}

/** Projection onto label symmetry, not an outcome-chosen orientation or market blend. */
export function projectCbbNeutralR2(row: CbbRepairRow, correction: CbbScoreCorrection): CbbForecast {
  if (row.forecast.release !== CBB_SCORE_RESEARCH_RELEASE || !Number.isFinite(Date.parse(row.forecast.asOf)) ||
    !Number.isFinite(Date.parse(row.game.date)) || Date.parse(row.forecast.asOf) > Date.parse(row.game.date)) throw new Error("incompatible CBB projection baseline or cutoff");
  const original = correctCbbScoreForecast(row.forecast, row.features, correction, row.game.season);
  if (row.game.neutral !== true) return { ...original, release: CBB_NEUTRAL_REPAIR_RELEASE };
  const reversed = cbbReverseNeutralRow(row);
  const other = correctCbbScoreForecast(reversed.forecast, reversed.features, correction, reversed.game.season);
  const uncertainty = { ...original.uncertainty, marginTotalCorrelation: 0, marginCorrection: 0 };
  return cbbRepairScore({ ...original, uncertainty }, (original.margin - other.margin) / 2,
    (original.total + other.total) / 2, CBB_NEUTRAL_REPAIR_RELEASE);
}

function centered(row: CbbRepairRow) {
  if (row.game.neutral !== true) return { forecast: row.forecast, features: row.features };
  const mc = row.forecast.uncertainty.marginCorrection, margin = row.forecast.margin - mc;
  const features = [...row.features]; features[1] = margin / 10; features[4] = margin * Math.abs(margin) / 400;
  features[15] = row.historyKnown ? features[15] + mc / 20 : 0;
  return { forecast: cbbRepairScore(row.forecast, margin, row.forecast.total, row.forecast.release), features };
}
function design(row: CbbRepairRow, market: "margin" | "total") {
  const x = centered(row).features;
  return row.game.neutral === true ? x.map((v, i) => odd.has(i) === (market === "margin") ? v : 0) : x;
}
export function fitCbbSymmetricHead(rows: CbbRepairRow[], trainedThrough: string, variant: CbbSymmetricHead["variant"] = "refit"): CbbSymmetricHead {
  if (!Number.isFinite(Date.parse(trainedThrough)) || rows.length < 200 || !["projection", "refit"].includes(variant) ||
    rows.some(r => r.forecast.release !== CBB_SCORE_RESEARCH_RELEASE || !Number.isFinite(Date.parse(r.forecast.asOf)) ||
      !Number.isFinite(Date.parse(r.game.date)) || Date.parse(r.game.date) + lag > Date.parse(trainedThrough) || Date.parse(r.forecast.asOf) > Date.parse(r.game.date))) {
    throw new Error("future or insufficient CBB symmetry labels");
  }
  const x = (r: CbbRepairRow, market: "margin" | "total") => variant === "projection" ? r.features : design(r, market);
  const base = (r: CbbRepairRow) => variant === "projection" ? r.forecast : centered(r).forecast;
  return { release: CBB_NEUTRAL_REPAIR_RELEASE, trainedThrough, variant, trainingGameIds: rows.map(r => r.game.id),
    margin: solveCbbResearchRidge(rows.map(r => x(r, "margin")), rows.map(r => r.game.homeScore - r.game.awayScore - base(r).margin), rows.map(() => 1), 100),
    total: solveCbbResearchRidge(rows.map(r => x(r, "total")), rows.map(r => r.game.homeScore + r.game.awayScore - base(r).total), rows.map(() => 1), 100) };
}
export function applyCbbSymmetricHead(row: CbbRepairRow, head: CbbSymmetricHead): CbbForecast {
  if (head.release !== CBB_NEUTRAL_REPAIR_RELEASE || row.forecast.release !== CBB_SCORE_RESEARCH_RELEASE || head.margin.length !== 19 || head.total.length !== 19 ||
    !Number.isFinite(Date.parse(head.trainedThrough)) || !Number.isFinite(Date.parse(row.forecast.asOf)) ||
    !Number.isFinite(Date.parse(row.game.date)) || Date.parse(row.forecast.asOf) > Date.parse(row.game.date) ||
    Date.parse(head.trainedThrough) > Date.parse(row.forecast.asOf) || head.trainingGameIds.includes(row.game.id)) {
    throw new Error("in-sample or incompatible CBB symmetry head");
  }
  if (head.variant === "projection") {
    const original = cbbRepairScore(row.forecast, row.forecast.margin + dot(row.features, head.margin), row.forecast.total + dot(row.features, head.total), head.release);
    if (row.game.neutral !== true) return original;
    const reversed = cbbReverseNeutralRow(row);
    const other = cbbRepairScore(reversed.forecast, reversed.forecast.margin + dot(reversed.features, head.margin), reversed.forecast.total + dot(reversed.features, head.total), head.release);
    return cbbRepairScore({ ...original, uncertainty: { ...original.uncertainty, marginTotalCorrelation: 0, marginCorrection: 0 } },
      (original.margin - other.margin) / 2, (original.total + other.total) / 2, head.release);
  }
  if (head.variant !== "refit") throw new Error("unknown CBB mean variant");
  const base = centered(row).forecast;
  const uncertainty = row.game.neutral === true ? { ...base.uncertainty, marginTotalCorrelation: 0, marginCorrection: 0 } : base.uncertainty;
  return cbbRepairScore({ ...base, uncertainty }, base.margin + dot(design(row, "margin"), head.margin),
    base.total + dot(design(row, "total"), head.total), head.release);
}

/** Runtime inputs use the actual pregame state. No outcome or cached reflection is needed. */
export function cbbRepairRowFromState(forecast: CbbForecast, state: CbbRatingState, game: CbbTrainingGame, history: CbbTrainingGame[]): CbbRepairRow {
  const minimumTeamGames = Math.min(state.teams[game.homeId]?.games ?? 0, state.teams[game.awayId]?.games ?? 0);
  const hasHistory = (id: number) => history.some(g => g.homeId === id || g.awayId === id);
  return { game, forecast, features: cbbScoreFeatures(forecast, state, game, history), minimumTeamGames,
    historyKnown: hasHistory(game.homeId) && hasHistory(game.awayId) };
}

export type CbbNoiseRow = { game: CbbTrainingGame; forecast: CbbForecast; minimumTeamGames: number };
export type CbbNoiseHead = { release: typeof CBB_CONDITIONAL_NOISE_RELEASE; meanVariant: "projection" | "refit";
  kind: "constant" | "conditional"; trainedThrough: string; trainingGameIds: number[]; margin: number[]; total: number[] };
function noiseFeatures(row: CbbNoiseRow) {
  return [1, (row.forecast.possessions - 69) / 10, (row.forecast.total - 145) / 30,
    Math.abs(row.forecast.margin) / 20, 1 / Math.sqrt(row.minimumTeamGames + 1), row.game.neutral === true ? 1 : 0];
}
/** Positive variance via exp(log variance); fixed L2=1 on slopes, not confidence caps. */
export function fitCbbNoise(rows: CbbNoiseRow[], trainedThrough: string, kind: CbbNoiseHead["kind"], meanVariant: CbbNoiseHead["meanVariant"]): CbbNoiseHead {
  if (rows.length < 200 || !Number.isFinite(Date.parse(trainedThrough)) || !["constant", "conditional"].includes(kind) ||
    rows.some(r => !Number.isFinite(Date.parse(r.forecast.asOf)) || !Number.isFinite(Date.parse(r.game.date)) || Date.parse(r.forecast.asOf) > Date.parse(r.game.date) || Date.parse(r.game.date) + lag > Date.parse(trainedThrough))) {
    throw new Error("future or insufficient CBB noise labels");
  }
  const x = rows.map(r => kind === "constant" ? [1] : noiseFeatures(r)), width = x[0].length;
  const fit = (errors: number[]) => {
    let beta = Array.from({ length: width }, (_, i) => i ? 0 : Math.log(errors.reduce((s, e) => s + e * e, 0) / errors.length));
    const objective = (b: number[]) => x.reduce((s, v, i) => {
      const eta = dot(v, b); return s + 0.5 * (eta + errors[i] ** 2 * Math.exp(-eta));
    }, b.slice(1).reduce((s, v) => s + 0.5 * v * v, 0));
    for (let iteration = 0; iteration < 60; iteration++) {
      const gradient = beta.map((v, j) => j ? v : 0);
      const hessian = Array.from({ length: width }, (_, j) => Array.from({ length: width }, (_, k) => j === k && j ? 1 : 0));
      x.forEach((v, i) => { const q = errors[i] ** 2 * Math.exp(-dot(v, beta));
        for (let j = 0; j < width; j++) { gradient[j] += 0.5 * v[j] * (1 - q);
          for (let k = 0; k < width; k++) hessian[j][k] += 0.5 * q * v[j] * v[k]; }
      });
      // Solve H step = gradient without an extra ridge or a normal-equation square.
      const a = hessian.map((r, i) => [...r, gradient[i]]);
      for (let j = 0; j < width; j++) { let pivot = j;
        for (let k = j + 1; k < width; k++) if (Math.abs(a[k][j]) > Math.abs(a[pivot][j])) pivot = k;
        [a[j], a[pivot]] = [a[pivot], a[j]];
        if (Math.abs(a[j][j]) < 1e-12) throw new Error("singular CBB noise fit");
        const divisor = a[j][j]; for (let k = j; k <= width; k++) a[j][k] /= divisor;
        for (let k = 0; k < width; k++) if (k !== j) { const scale = a[k][j]; for (let l = j; l <= width; l++) a[k][l] -= scale * a[j][l]; }
      }
      const step = a.map(r => r[width]), before = objective(beta);
      let rate = 1, next = beta;
      for (let search = 0; search < 30; search++, rate /= 2) {
        const candidate = beta.map((v, i) => v - rate * step[i]);
        if (Number.isFinite(objective(candidate)) && objective(candidate) <= before) { next = candidate; break; }
      }
      const change = Math.max(...next.map((v, i) => Math.abs(v - beta[i]))); beta = next;
      if (change < 1e-9) break;
    }
    if (!beta.every(Number.isFinite)) throw new Error("nonfinite CBB noise coefficients");
    return beta;
  };
  return { release: CBB_CONDITIONAL_NOISE_RELEASE, meanVariant, kind, trainedThrough, trainingGameIds: rows.map(r => r.game.id),
    margin: fit(rows.map(r => r.game.homeScore - r.game.awayScore - r.forecast.margin)),
    total: fit(rows.map(r => r.game.homeScore + r.game.awayScore - r.forecast.total)) };
}
export function applyCbbNoise(row: CbbNoiseRow, head: CbbNoiseHead): CbbForecast {
  if (head.release !== CBB_CONDITIONAL_NOISE_RELEASE || row.forecast.release !== CBB_NEUTRAL_REPAIR_RELEASE ||
    !Number.isFinite(Date.parse(head.trainedThrough)) || !Number.isFinite(Date.parse(row.forecast.asOf)) ||
    !Number.isFinite(Date.parse(row.game.date)) || Date.parse(row.forecast.asOf) > Date.parse(row.game.date) ||
    Date.parse(head.trainedThrough) > Date.parse(row.forecast.asOf) || head.trainingGameIds.includes(row.game.id)) {
    throw new Error("in-sample or incompatible CBB noise head");
  }
  const features = head.kind === "constant" ? [1] : noiseFeatures(row);
  if (head.margin.length !== features.length || head.total.length !== features.length || row.minimumTeamGames < 0) throw new Error("invalid CBB noise inputs");
  const uncertainty = { ...row.forecast.uncertainty, marginSd: Math.exp(dot(features, head.margin) / 2),
    totalSd: Math.exp(dot(features, head.total) / 2) };
  if (!(Number.isFinite(uncertainty.totalSd) && uncertainty.totalSd > 0)) throw new Error("invalid CBB conditional variance");
  return cbbRepairScore({ ...row.forecast, uncertainty }, row.forecast.margin, row.forecast.total, head.release);
}
