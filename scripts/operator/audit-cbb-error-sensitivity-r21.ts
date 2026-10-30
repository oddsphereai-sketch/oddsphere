import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { evaluateCbbRows, fitCbbUncertainty, CBB_DEVELOPMENT_UNCERTAINTY } from "../../lib/cbb/evaluation";
import { applyCbbScoreCorrection, fitCbbScoreCorrection, replayCbbScoreResearch,
  type CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import artifact from "../../lib/cbb/artifacts/candidate-r2.json";
import type { CbbBox, CbbGame, CbbTrainingGame, CbbVenue } from "../../lib/cbb/types";

const directory = "/private/tmp/oddsphere-cbb-data";
const release = "cbb_private_2026_10_29_r21_error_sensitivity";
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("private CBB diagnostic only");
const allowDirty = process.argv.includes("--development");
const inputSha256: Record<string, string> = {};
async function read<T>(name: string): Promise<T> {
  const raw = await readFile(`${directory}/${name}`, "utf8");
  inputSha256[name] = createHash("sha256").update(raw).digest("hex");
  return JSON.parse(raw) as T;
}
const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => Math.sqrt(mean(xs.map(x => (x - mean(xs)) ** 2)));
const summary = (rows: CbbScoreFeatureRow[]) => {
  const m = evaluateCbbRows(rows);
  return { games: m.games, wins: m.wins, marginMae: m.marginMae, totalMae: m.totalMae,
    brier: m.brier, logLoss: m.logLoss, incompleteInputs: m.incompleteInputs };
};
const variants = [
  { id: "full", remove: [] },
  { id: "without_rest", remove: [5, 6] },
  { id: "without_four_factors", remove: [7, 8, 9, 10, 11, 12, 13, 14] },
  { id: "without_recent_form", remove: [15, 16, 17] },
  { id: "without_nonlinear_margin", remove: [4] },
  { id: "without_pace_correction", remove: [3, 17] },
  { id: "intercept_only", remove: Array.from({ length: 18 }, (_, i) => i + 1) },
] as const;
function mask(rows: CbbScoreFeatureRow[], remove: readonly number[]): CbbScoreFeatureRow[] {
  const excluded = new Set<number>(remove);
  return rows.map(row => ({ ...row, features: row.features.map((value, index) => excluded.has(index) ? 0 : value) }));
}
function validate(rows: CbbScoreFeatureRow[], season: number, seasonGames: CbbTrainingGame[]) {
  const gameById = new Map(seasonGames.map(game => [game.id, game]));
  if (rows.length !== gameById.size || rows.some((row, i) => row.game.season !== season ||
      JSON.stringify(row.game) !== JSON.stringify(gameById.get(row.game.id)) ||
      Date.parse(row.forecast.asOf) > Date.parse(row.game.date) ||
      row.forecast.gameId !== row.game.id || row.forecast.homeId !== row.game.homeId ||
      row.forecast.awayId !== row.game.awayId || row.features.length !== 19 || !row.features.every(Number.isFinite) ||
      (i > 0 && (rows[i - 1].game.date > row.game.date ||
        (rows[i - 1].game.date === row.game.date && rows[i - 1].game.id > row.game.id)))) ||
      new Set(rows.map(row => row.game.id)).size !== rows.length) throw new Error(`CBB ${season} feature cohort mismatch`);
}
function paired(reference: CbbScoreFeatureRow[], candidate: CbbScoreFeatureRow[]) {
  const byId = new Map(reference.map(row => [row.game.id, row]));
  let corrections = 0, harms = 0, changedWinners = 0;
  let marginAbsDelta = 0, totalAbsDelta = 0, marginPredictionDelta = 0, totalPredictionDelta = 0;
  for (const row of candidate) {
    const old = byId.get(row.game.id);
    if (!old) throw new Error("CBB paired audit missing baseline game");
    const actualHome = row.game.homeScore > row.game.awayScore;
    const oldSide = old.forecast.homeWinProbability >= 0.5;
    const newSide = row.forecast.homeWinProbability >= 0.5;
    if (newSide !== oldSide) {
      changedWinners++;
      if (newSide === actualHome) corrections++; else harms++;
    }
    const actualMargin = row.game.homeScore - row.game.awayScore;
    const actualTotal = row.game.homeScore + row.game.awayScore;
    marginAbsDelta += Math.abs(row.forecast.margin - actualMargin) - Math.abs(old.forecast.margin - actualMargin);
    totalAbsDelta += Math.abs(row.forecast.total - actualTotal) - Math.abs(old.forecast.total - actualTotal);
    marginPredictionDelta += Math.abs(row.forecast.margin - old.forecast.margin);
    totalPredictionDelta += Math.abs(row.forecast.total - old.forecast.total);
  }
  return { corrections, harms, changedWinners, marginMaeDelta: marginAbsDelta / candidate.length,
    totalMaeDelta: totalAbsDelta / candidate.length, meanAbsoluteMarginPredictionChange: marginPredictionDelta / candidate.length,
    meanAbsoluteTotalPredictionChange: totalPredictionDelta / candidate.length };
}
function fitVariants(train: CbbScoreFeatureRow[], test: CbbScoreFeatureRow[], fitThroughSeason: number) {
  const fullFit = fitCbbScoreCorrection(train, "matchup", fitThroughSeason);
  const baseline = applyCbbScoreCorrection(test, fullFit);
  const out: Array<{ id: string; metrics: ReturnType<typeof summary>; paired: ReturnType<typeof paired>;
    coefficientsMargin: number[]; coefficientsTotal: number[] }> = variants.map(variant => {
    const fit = fitCbbScoreCorrection(mask(train, variant.remove), "matchup", fitThroughSeason);
    const rows = applyCbbScoreCorrection(mask(test, variant.remove), fit);
    return { id: variant.id, metrics: summary(rows), paired: paired(baseline, rows),
      coefficientsMargin: fit.coefficientsMargin, coefficientsTotal: fit.coefficientsTotal };
  });
  const none = applyCbbScoreCorrection(test, fitCbbScoreCorrection(train, "none", fitThroughSeason));
  out.push({ id: "no_correction", metrics: summary(none), paired: paired(baseline, none),
    coefficientsMargin: [], coefficientsTotal: [] });
  return { baseline, variants: out };
}
function moments(predicted: number[], actual: number[]) {
  const residual = predicted.map((x, i) => x - actual[i]);
  const xMean = mean(predicted), yMean = mean(actual);
  const variance = mean(predicted.map(x => (x - xMean) ** 2));
  const covariance = mean(predicted.map((x, i) => (x - xMean) * (actual[i] - yMean)));
  return { predictedSd: sd(predicted), actualSd: sd(actual), residualSd: sd(residual),
    signedBias: mean(residual), actualOnPredictedSlope: covariance / variance,
    mae: mean(residual.map(Math.abs)), over10: mean(residual.map(x => Number(Math.abs(x) > 10))),
    over20: mean(residual.map(x => Number(Math.abs(x) > 20))) };
}
function group(rows: CbbScoreFeatureRow[], id: string) {
  const m = summary(rows);
  return { id, ...m, wrongWinners: m.games - m.wins,
    marginBias: mean(rows.map(row => row.forecast.margin - row.game.homeScore + row.game.awayScore)),
    totalBias: mean(rows.map(row => row.forecast.total - row.game.homeScore - row.game.awayScore)) };
}
function decomposition(rows: CbbScoreFeatureRow[], rawRows: CbbScoreFeatureRow[]) {
  const rawById = new Map(rawRows.map(row => [row.game.id, row]));
  const paceOracle = (row: CbbScoreFeatureRow) => {
    const raw = rawById.get(row.game.id);
    if (!raw) throw new Error("CBB pace diagnosis missing raw forecast");
    const baseScoring = raw.forecast.total - raw.forecast.uncertainty.totalCorrection;
    // Keep the fitted residual head and uncertainty correction fixed. Only the
    // base scoring-rate component receives the impossible postgame tempo.
    return row.forecast.total + baseScoring * (row.game.tempo / raw.forecast.possessions - 1);
  };
  const totalMae = mean(rows.map(row => Math.abs(row.forecast.total - row.game.homeScore - row.game.awayScore)));
  const postgamePaceTotal = rows.map(paceOracle);
  const paceOracleMae = mean(rows.map((row, i) => Math.abs(postgamePaceTotal[i] - row.game.homeScore - row.game.awayScore)));
  const regulationOnly = rows.filter(row => !row.game.overtime);
  const overtimeOnly = rows.filter(row => row.game.overtime);
  return { allGamesTotalMae: totalMae, postgamePaceOracleMae: paceOracleMae,
    regulationGames: regulationOnly.length,
    regulationTotalMae: mean(regulationOnly.map(row => Math.abs(row.forecast.total - row.game.homeScore - row.game.awayScore))),
    regulationPostgamePaceOracleMae: mean(regulationOnly.map(row =>
      Math.abs(paceOracle(row) - row.game.homeScore - row.game.awayScore))),
    overtimeGames: overtimeOnly.length,
    overtimeTotalMae: mean(overtimeOnly.map(row => Math.abs(row.forecast.total - row.game.homeScore - row.game.awayScore))),
    warning: "Postgame tempo is unavailable pregame. Overtime tempo is normalized to 40 minutes but the target includes OT points, so the all-game pace arithmetic mixes two effects. This is not a model candidate or a lower bound." };
}
function perturbation(rows: CbbScoreFeatureRow[], corrected: CbbScoreFeatureRow[]) {
  // Algebraic local sensitivity of the uncorrected single-game base forecast.
  // These do not refit the residual head and are never an achievable-gain claim.
  const correctedById = new Map(corrected.map(row => [row.game.id, row]));
  const observed = rows.map(row => {
    const p = row.forecast.possessions;
    const final = correctedById.get(row.game.id);
    if (!final) throw new Error("CBB sensitivity diagnosis missing final forecast");
    return { margin: final.forecast.margin,
      paceMargin: (row.forecast.margin - row.forecast.uncertainty.marginCorrection) / p,
      paceTotal: (row.forecast.total - row.forecast.uncertainty.totalCorrection) / p,
      effPoint: p / 100 };
  });
  const perturb = [
    { id: "plus_one_possession", delta: (x: typeof observed[number]) => ({ margin: x.paceMargin, total: x.paceTotal }) },
    { id: "plus_one_home_offense_per_100", delta: (x: typeof observed[number]) => ({ margin: x.effPoint, total: x.effPoint }) },
    { id: "plus_one_away_defense_per_100", delta: (x: typeof observed[number]) => ({ margin: x.effPoint, total: x.effPoint }) },
    { id: "plus_one_away_offense_per_100", delta: (x: typeof observed[number]) => ({ margin: -x.effPoint, total: x.effPoint }) },
    { id: "plus_one_home_defense_per_100", delta: (x: typeof observed[number]) => ({ margin: -x.effPoint, total: x.effPoint }) },
    { id: "plus_one_margin_correction", delta: () => ({ margin: 1, total: 0 }) },
    { id: "plus_one_total_correction", delta: () => ({ margin: 0, total: 1 }) },
  ];
  return perturb.map(item => ({ id: item.id,
    meanMarginChange: mean(observed.map(x => item.delta(x).margin)),
    meanTotalChange: mean(observed.map(x => item.delta(x).total)),
    changedWinnerSides: observed.filter(x => (x.margin >= 0) !== (x.margin + item.delta(x).margin >= 0)).length,
    caveat: "Base-equation local leverage only; residual head not refit or re-evaluated." }));
}
async function main() {
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  if (dirty && !allowDirty) throw new Error("CBB audit requires a clean source commit");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const development = await read<CbbScoreFeatureRow[]>("score-feature-development.json");
  const selection = await read<CbbScoreFeatureRow[]>("score-feature-selection.json");
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games;
  for (const [season, rows] of [[2023, development], [2024, selection]] as const) {
    validate(rows, season, history.filter(game => game.season === season));
  }
  const replayDevelopment = replayCbbScoreResearch(history, 2023, artifact.config, CBB_DEVELOPMENT_UNCERTAINTY);
  const replaySelection = replayCbbScoreResearch(history, 2024, artifact.config,
    fitCbbUncertainty(replayDevelopment, 2023));
  for (const [name, replay] of [["score-feature-development.json", replayDevelopment],
    ["score-feature-selection.json", replaySelection]] as const) {
    if (createHash("sha256").update(JSON.stringify(replay)).digest("hex") !== inputSha256[name]) {
      throw new Error(`CBB ${name} generation does not reproduce from source receipts`);
    }
  }
  const selected = fitVariants(development, selection, 2023);
  const uncertainty = fitCbbUncertainty([...development, ...selection], 2024);
  const confirmationRaw = replayCbbScoreResearch(history, 2025, artifact.config, uncertainty);
  validate(confirmationRaw, 2025, history.filter(game => game.season === 2025));
  const confirmed = fitVariants([...development, ...selection], confirmationRaw, 2024);
  const expected = { games: 5721, wins: 4112, marginMae: 9.2789, totalMae: 13.6378 };
  const actual = summary(confirmed.baseline);
  if (actual.games !== expected.games || actual.wins !== expected.wins ||
    Math.abs(actual.marginMae - expected.marginMae) > 0.002 || Math.abs(actual.totalMae - expected.totalMae) > 0.002) {
    throw new Error(`CBB r2 2025 reproduction failed: ${JSON.stringify(actual)}`);
  }
  const rows = selected.baseline;
  const report = { release, productionWrites: 0, sourceCommit, dirtyDevelopmentRun: Boolean(dirty), inputSha256,
    trainSeason: 2023, selectionSeason: 2024, openedDiagnosticSeason: 2025,
    selection: { baseline: summary(rows), variants: selected.variants },
    openedDiagnostic: { baseline: actual, variants: confirmed.variants },
    selectionResiduals: {
      margin: moments(rows.map(row => row.forecast.margin), rows.map(row => row.game.homeScore - row.game.awayScore)),
      total: moments(rows.map(row => row.forecast.total), rows.map(row => row.game.homeScore + row.game.awayScore)),
      groups: [
        group(rows.filter(row => Math.abs(row.forecast.margin) < 5), "predicted_margin_under_5"),
        group(rows.filter(row => Math.abs(row.forecast.margin) >= 5 && Math.abs(row.forecast.margin) < 15), "predicted_margin_5_to_15"),
        group(rows.filter(row => Math.abs(row.forecast.margin) >= 15), "predicted_margin_15_plus"),
        group(rows.filter(row => row.forecast.total < 130), "predicted_total_under_130"),
        group(rows.filter(row => row.forecast.total >= 130 && row.forecast.total < 150), "predicted_total_130_to_150"),
        group(rows.filter(row => row.forecast.total >= 150), "predicted_total_150_plus"),
        ...[...new Set(rows.map(row => row.game.date.slice(0, 7)))].sort().map(month =>
          group(rows.filter(row => row.game.date.startsWith(month)), month)),
      ],
      postgamePace: decomposition(rows, selection),
      localBaseEquationSensitivity: perturbation(selection, rows),
    },
    limitation: "Both 2024 selection and 2025 diagnostic have been opened; no variant is qualified for activation from this audit. Ablations are not causal attributions and postgame tempo is illegal pregame." };
  await writeFile(`${directory}/error-sensitivity-r21-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ release, sourceCommit, selectionBaseline: report.selection.baseline,
    selectionVariants: report.selection.variants.map(({ id, metrics, paired }) => ({ id, metrics, paired })),
    openedDiagnosticBaseline: report.openedDiagnostic.baseline,
    openedDiagnosticVariants: report.openedDiagnostic.variants.map(({ id, metrics, paired }) => ({ id, metrics, paired })),
    residuals: report.selectionResiduals }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
