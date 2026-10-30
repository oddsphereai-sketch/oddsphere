import { fitCbbRatings, forecastCbbGame } from "./model";
import type { CbbForecast, CbbModelConfig, CbbRatingState, CbbTrainingGame, CbbUncertainty } from "./types";

export type CbbEvaluationRow = { game: CbbTrainingGame; forecast: CbbForecast };
export const CBB_DEVELOPMENT_UNCERTAINTY: CbbUncertainty = {
  marginSd: 12, totalSd: 17, marginTotalCorrelation: 0,
  marginCorrection: 0, totalCorrection: 0, fitThroughSeason: 2021, games: 0,
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** All same-day games are withheld together, even when an earlier game already finished. */
export function replayCbbSeason(history: CbbTrainingGame[], season: number, config: CbbModelConfig, uncertainty: CbbUncertainty): CbbEvaluationRow[] {
  let prior: CbbRatingState | undefined;
  for (const previous of [...new Set(history.filter(game => game.season < season).map(game => game.season))].sort()) {
    prior = fitCbbRatings(history, { season: previous, asOf: `${previous + 1}-07-01T00:00:00.000Z`, config, prior });
  }
  const grouped = new Map<string, CbbTrainingGame[]>();
  for (const game of history.filter(game => game.season === season)) {
    // Use UTC calendar batches conservatively; no result from that UTC day enters any forecast.
    const date = game.date.slice(0, 10);
    grouped.set(date, [...(grouped.get(date) ?? []), game]);
  }
  const rows: CbbEvaluationRow[] = [];
  for (const [day, games] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const state = fitCbbRatings(history, { season, asOf: `${day}T00:00:00.000Z`, config, prior });
    for (const game of games) rows.push({ game, forecast: forecastCbbGame(state, game, uncertainty) });
  }
  return rows;
}

export function fitCbbUncertainty(rows: CbbEvaluationRow[], fitThroughSeason: number): CbbUncertainty {
  if (rows.length < 200 || rows.some(row => row.game.season > fitThroughSeason)) throw new Error("CBB invalid residual training cohort");
  const margins = rows.map(({ game, forecast }) => game.homeScore - game.awayScore - forecast.margin + forecast.uncertainty.marginCorrection);
  const totals = rows.map(({ game, forecast }) => game.homeScore + game.awayScore - forecast.total + forecast.uncertainty.totalCorrection);
  const marginCorrection = mean(margins), totalCorrection = mean(totals);
  const marginSd = Math.sqrt(mean(margins.map(value => (value - marginCorrection) ** 2)));
  const totalSd = Math.sqrt(mean(totals.map(value => (value - totalCorrection) ** 2)));
  const covariance = mean(margins.map((value, i) => (value - marginCorrection) * (totals[i] - totalCorrection)));
  return { marginSd, totalSd, marginTotalCorrelation: covariance / (marginSd * totalSd), marginCorrection,
    totalCorrection, fitThroughSeason, games: rows.length };
}

export function evaluateCbbRows(rows: CbbEvaluationRow[]) {
  const n = rows.length;
  let wins = 0, homeWins = 0, brier = 0, logLoss = 0, teamMae = 0, marginMae = 0, totalMae = 0;
  let marginCoverage = 0, totalCoverage = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, probability: 0, outcome: 0 }));
  for (const { game, forecast } of rows) {
    const y = game.homeScore > game.awayScore ? 1 : 0;
    const p = Math.min(1 - 1e-10, Math.max(1e-10, forecast.homeWinProbability));
    wins += Number((p >= 0.5) === Boolean(y)); homeWins += y;
    brier += (p - y) ** 2; logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    teamMae += (Math.abs(game.homeScore - forecast.homeScore) + Math.abs(game.awayScore - forecast.awayScore)) / 2;
    const mError = Math.abs(game.homeScore - game.awayScore - forecast.margin), tError = Math.abs(game.homeScore + game.awayScore - forecast.total);
    marginMae += mError; totalMae += tError;
    marginCoverage += Number(mError <= 1.645 * forecast.uncertainty.marginSd);
    totalCoverage += Number(tError <= 1.645 * forecast.uncertainty.totalSd);
    const bin = bins[Math.min(9, Math.floor(p * 10))]; bin.n++; bin.probability += p; bin.outcome += y;
  }
  const calibration = bins.map(bin => ({ n: bin.n, probability: bin.n ? bin.probability / bin.n : null, frequency: bin.n ? bin.outcome / bin.n : null }));
  const ece = calibration.reduce((sum, bin) => sum + bin.n * Math.abs((bin.probability ?? 0) - (bin.frequency ?? 0)), 0) / Math.max(1, n);
  return { games: n, wins, losses: n - wins, accuracy: wins / Math.max(1, n), alwaysHomeAccuracy: homeWins / Math.max(1, n),
    brier: brier / Math.max(1, n), logLoss: logLoss / Math.max(1, n), teamScoreMae: teamMae / Math.max(1, n),
    marginMae: marginMae / Math.max(1, n), totalMae: totalMae / Math.max(1, n), calibrationGap: ece,
    margin90Coverage: marginCoverage / Math.max(1, n), total90Coverage: totalCoverage / Math.max(1, n),
    incompleteInputs: rows.filter(row => row.forecast.inputStatus !== "complete").length, calibration };
}

export function cbbMonthlyMetrics(rows: CbbEvaluationRow[]) {
  const groups = new Map<string, CbbEvaluationRow[]>();
  for (const row of rows) {
    const month = row.game.date.slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), row]);
  }
  return Object.fromEntries([...groups].map(([month, rows]) => [month, evaluateCbbRows(rows)]));
}
