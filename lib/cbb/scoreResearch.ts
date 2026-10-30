import { fitCbbRatings, forecastCbbGame, normalCdf } from "./model";
import type { CbbEvaluationRow } from "./evaluation";
import type { CbbForecast, CbbFourFactors, CbbModelConfig, CbbRatingState, CbbTrainingGame, CbbUncertainty } from "./types";

export const CBB_SCORE_RESEARCH_RELEASE = "cbb_candidate_2026_10_28_r2_score_precision" as const;
export type CbbScoreResearchConfig = CbbModelConfig & { paceRidge: number };
export type CbbScoreFeatureRow = CbbEvaluationRow & { features: number[] };
export type CbbScoreCorrection = {
  mode: "none" | "affine" | "matchup"; coefficientsMargin: number[]; coefficientsTotal: number[];
  fitThroughSeason: number; featureIndexes: number[];
};

export const CBB_SCORE_FEATURE_NAMES = [
  "intercept", "margin", "total", "pace", "signed_margin_squared", "rest_difference", "rest_sum",
  "efg_matchup_difference", "turnover_matchup_difference", "rebounding_matchup_difference", "ft_matchup_difference",
  "efg_matchup_sum", "turnover_matchup_sum", "rebounding_matchup_sum", "ft_matchup_sum",
  "recent_margin_form", "recent_total_form", "recent_pace_form", "neutral_site",
] as const;

/** R1 remains frozen. R2 gives tempo its own precision, matching the half-coefficient observation equation. */
export function fitCbbScoreResearchState(history: CbbTrainingGame[], options: {
  season: number; asOf: string; config: CbbScoreResearchConfig; prior?: CbbRatingState;
}): CbbRatingState {
  const state = fitCbbRatings(history, options);
  const games = history.filter(game => game.season === options.season && game.neutral !== null &&
    Date.parse(game.date) + 6 * 60 * 60 * 1000 <= Date.parse(options.asOf));
  const priorPace = Object.fromEntries(Object.keys(state.teams).map(id => [id,
    (options.prior?.teams[Number(id)]?.pace ?? 0) * options.config.priorCarry]));
  for (const [id, value] of Object.entries(priorPace)) state.teams[Number(id)].pace = value;
  const rows = new Map<number, Array<{ other: number; pace: number; weight: number }>>();
  for (const game of games) {
    const weight = Math.exp(-(Date.parse(options.asOf) - Date.parse(game.date)) / 86400000 / options.config.recencyDays);
    for (const [own, other] of [[game.homeId, game.awayId], [game.awayId, game.homeId]]) {
      rows.set(own, [...(rows.get(own) ?? []), { other, pace: game.tempo, weight }]);
    }
  }
  for (let iteration = 0; iteration < 24; iteration++) for (const [id, own] of rows) {
    let numerator = options.config.paceRidge * priorPace[id], precision = options.config.paceRidge;
    for (const row of own) {
      numerator += row.weight * 0.5 * (row.pace - state.leagueTempo - 0.5 * state.teams[row.other].pace);
      precision += row.weight * 0.25;
    }
    state.teams[id].pace = numerator / precision;
  }
  return { ...state, release: CBB_SCORE_RESEARCH_RELEASE };
}

const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
export function cbbScoreFeatures(forecast: CbbForecast, state: CbbRatingState, game: {
  homeId: number; awayId: number; neutral: boolean | null;
}, priorGames: CbbTrainingGame[]): number[] {
  if (priorGames.some(row => row.season !== state.season || Date.parse(row.date) + 6 * 60 * 60 * 1000 > Date.parse(state.asOf))) {
    throw new Error("future or wrong-season CBB matchup history");
  }
  const h = state.teams[game.homeId], a = state.teams[game.awayId];
  const factor = (team: typeof h, key: keyof CbbFourFactors, defense: boolean) =>
    (defense ? team?.opponentFactors?.[key] : team?.factors?.[key]) ?? null;
  const neutral = { efg: 0.5, turnoverRate: 0.18, offensiveReboundRate: 0.28, freeThrowRate: 0.3 };
  const match = (own: typeof h, opp: typeof h, key: keyof CbbFourFactors) =>
    ((factor(own, key, false) ?? neutral[key]) + (factor(opp, key, true) ?? neutral[key])) / 2;
  const keys = ["efg", "turnoverRate", "offensiveReboundRate", "freeThrowRate"] as const;
  const difference = keys.map(key => (match(h, a, key) - match(a, h, key)) * 10);
  const sums = keys.map(key => (match(h, a, key) + match(a, h, key) - 2 * neutral[key]) * 10);
  const teamRows = (id: number) => priorGames.filter(row => row.homeId === id || row.awayId === id).sort((x, y) => y.date.localeCompare(x.date));
  const homeGames = teamRows(game.homeId), awayGames = teamRows(game.awayId);
  const rest = (games: CbbTrainingGame[]) => games.length ? Math.min(14, (Date.parse(state.asOf) - Date.parse(games[0].date)) / 86400000) : 14;
  const marginForm = (games: CbbTrainingGame[], id: number) => average(games.slice(0, 3).map(row => {
    const home = row.homeId === id, opponent = state.teams[home ? row.awayId : row.homeId];
    const scoreMargin = home ? row.homeScore - row.awayScore : row.awayScore - row.homeScore;
    const opponentNet = (opponent?.offense ?? 0) - (opponent?.defense ?? 0);
    return scoreMargin + opponentNet * row.tempo / 100;
  }));
  const totalForm = (games: CbbTrainingGame[]) => average(games.slice(0, 3).map(row => row.homeScore + row.awayScore));
  const paceForm = (games: CbbTrainingGame[]) => average(games.slice(0, 3).map(row => row.tempo));
  const historyKnown = homeGames.length > 0 && awayGames.length > 0;
  const features = [1, forecast.margin / 10, (forecast.total - 140) / 20, (forecast.possessions - 69) / 5,
    forecast.margin * Math.abs(forecast.margin) / 400, (rest(homeGames) - rest(awayGames)) / 7,
    (rest(homeGames) + rest(awayGames) - 7) / 14, ...difference, ...sums,
    historyKnown ? (marginForm(homeGames, game.homeId) - marginForm(awayGames, game.awayId) - forecast.margin) / 20 : 0,
    historyKnown ? ((totalForm(homeGames) + totalForm(awayGames)) / 2 - forecast.total) / 20 : 0,
    historyKnown ? ((paceForm(homeGames) + paceForm(awayGames)) / 2 - forecast.possessions) / 5 : 0,
    game.neutral === true ? 1 : 0];
  if (features.length !== CBB_SCORE_FEATURE_NAMES.length || !features.every(Number.isFinite)) throw new Error("invalid CBB score features");
  return features;
}

export function replayCbbScoreResearch(history: CbbTrainingGame[], season: number, config: CbbScoreResearchConfig, uncertainty: CbbUncertainty) {
  let prior: CbbRatingState | undefined;
  for (const previous of [...new Set(history.filter(game => game.season < season).map(game => game.season))].sort()) {
    prior = fitCbbScoreResearchState(history, { season: previous, asOf: `${previous + 1}-07-01T00:00:00.000Z`, config, prior });
  }
  const grouped = new Map<string, CbbTrainingGame[]>();
  for (const game of history.filter(game => game.season === season)) {
    const day = game.date.slice(0, 10); grouped.set(day, [...(grouped.get(day) ?? []), game]);
  }
  const rows: CbbScoreFeatureRow[] = [];
  for (const [day, games] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const asOf = `${day}T00:00:00.000Z`;
    const state = fitCbbScoreResearchState(history, { season, asOf, config, prior });
    const available = history.filter(game => game.season === season && Date.parse(game.date) + 6 * 60 * 60 * 1000 <= Date.parse(asOf));
    for (const game of games) {
      const forecast = { ...forecastCbbGame(state, game, uncertainty), release: CBB_SCORE_RESEARCH_RELEASE };
      rows.push({ game, forecast, features: cbbScoreFeatures(forecast, state, game, available) });
    }
  }
  return rows;
}

function solveRidge(x: number[][], y: number[], penalty: number): number[] {
  const width = x[0].length;
  const a = Array.from({ length: width }, (_, i) => Array.from({ length: width + 1 }, (_, j) =>
    j === width ? x.reduce((sum, row, k) => sum + row[i] * y[k], 0) :
      x.reduce((sum, row) => sum + row[i] * row[j], 0) + (i === j ? penalty : 0)));
  for (let i = 0; i < width; i++) {
    let pivot = i; for (let k = i + 1; k < width; k++) if (Math.abs(a[k][i]) > Math.abs(a[pivot][i])) pivot = k;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    if (Math.abs(a[i][i]) < 1e-12) throw new Error("singular CBB correction fit");
    const scale = a[i][i]; for (let j = i; j <= width; j++) a[i][j] /= scale;
    for (let k = 0; k < width; k++) if (k !== i) {
      const factor = a[k][i]; for (let j = i; j <= width; j++) a[k][j] -= factor * a[i][j];
    }
  }
  return a.map(row => row[width]);
}

export function fitCbbScoreCorrection(rows: CbbScoreFeatureRow[], mode: CbbScoreCorrection["mode"], throughSeason: number): CbbScoreCorrection {
  if (rows.some(row => row.game.season > throughSeason)) throw new Error("future CBB correction labels");
  const featureIndexes = mode === "none" ? [] : mode === "affine" ? [0, 1, 2, 3] : CBB_SCORE_FEATURE_NAMES.map((_, i) => i);
  if (!featureIndexes.length) return { mode, featureIndexes, coefficientsMargin: [], coefficientsTotal: [], fitThroughSeason: throughSeason };
  if (rows.length < 200) throw new Error("insufficient CBB correction fit");
  const x = rows.map(row => featureIndexes.map(index => row.features[index]));
  return { mode, featureIndexes, fitThroughSeason: throughSeason,
    coefficientsMargin: solveRidge(x, rows.map(row => row.game.homeScore - row.game.awayScore - row.forecast.margin), mode === "matchup" ? 100 : 1),
    coefficientsTotal: solveRidge(x, rows.map(row => row.game.homeScore + row.game.awayScore - row.forecast.total), mode === "matchup" ? 100 : 1) };
}

export function applyCbbScoreCorrection(rows: CbbScoreFeatureRow[], correction: CbbScoreCorrection): CbbScoreFeatureRow[] {
  return rows.map(row => ({ ...row,
    forecast: correctCbbScoreForecast(row.forecast, row.features, correction, row.game.season),
  }));
}

export function correctCbbScoreForecast(forecast: CbbForecast, features: number[], correction: CbbScoreCorrection, season: number): CbbForecast {
    if (correction.fitThroughSeason >= season) throw new Error("in-sample CBB correction evaluation");
    if (features.length !== CBB_SCORE_FEATURE_NAMES.length || !features.every(Number.isFinite)) throw new Error("invalid CBB correction inputs");
    const adjustment = (coefficients: number[]) => correction.featureIndexes.reduce((sum, index, i) => sum + features[index] * coefficients[i], 0);
    const margin = forecast.margin + adjustment(correction.coefficientsMargin), total = forecast.total + adjustment(correction.coefficientsTotal);
    const homeScore = (total + margin) / 2, awayScore = (total - margin) / 2;
    if (homeScore <= 0 || awayScore <= 0) throw new Error("incoherent CBB correction score");
    const sd = forecast.uncertainty.marginSd;
    const zero = normalCdf((0.5 - margin) / sd) - normalCdf((-0.5 - margin) / sd);
    const homeWinProbability = (1 - normalCdf((0.5 - margin) / sd)) / (1 - zero);
    return { ...forecast, margin, total, homeScore, awayScore, homeWinProbability };
}
