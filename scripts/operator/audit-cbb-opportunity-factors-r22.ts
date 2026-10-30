import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { CBB_DEVELOPMENT_UNCERTAINTY, evaluateCbbRows, fitCbbUncertainty } from "../../lib/cbb/evaluation";
import { CBB_OPPORTUNITY_FACTOR_RESEARCH_RELEASE, enrichOpportunityFactors,
  type CbbOpportunityFactorVariant } from "../../lib/cbb/opportunityFactorResearch";
import { applyCbbScoreCorrection, fitCbbScoreCorrection, replayCbbScoreResearch,
  type CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import artifact from "../../lib/cbb/artifacts/candidate-r2.json";
import type { CbbBox, CbbGame, CbbTrainingGame, CbbVenue } from "../../lib/cbb/types";

const directory = "/private/tmp/oddsphere-cbb-data";
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("private CBB opportunity-factor audit only");
const allowDirty = process.argv.includes("--development");
const inputSha256: Record<string, string> = {};
async function read<T>(name: string): Promise<T> {
  const raw = await readFile(`${directory}/${name}`, "utf8");
  inputSha256[name] = createHash("sha256").update(raw).digest("hex");
  return JSON.parse(raw) as T;
}
const metrics = (rows: CbbScoreFeatureRow[]) => {
  const m = evaluateCbbRows(rows);
  return { games: m.games, wins: m.wins, marginMae: m.marginMae, totalMae: m.totalMae,
    brier: m.brier, logLoss: m.logLoss, incompleteInputs: m.incompleteInputs };
};
function checkCohort(rows: CbbScoreFeatureRow[], season: number, history: CbbTrainingGame[]) {
  const games = history.filter(game => game.season === season);
  const byId = new Map(games.map(game => [game.id, game]));
  if (rows.length !== byId.size || new Set(rows.map(row => row.game.id)).size !== rows.length ||
    rows.some((row, i) => JSON.stringify(row.game) !== JSON.stringify(byId.get(row.game.id)) ||
      Date.parse(row.forecast.asOf) > Date.parse(row.game.date) || row.features.length !== 19 ||
      !row.features.every(Number.isFinite) || (i > 0 && (rows[i - 1].game.date > row.game.date ||
      (rows[i - 1].game.date === row.game.date && rows[i - 1].game.id > row.game.id))))) {
    throw new Error(`CBB opportunity-factor ${season} cohort mismatch`);
  }
}
function paired(reference: CbbScoreFeatureRow[], candidate: CbbScoreFeatureRow[]) {
  const byId = new Map(reference.map(row => [row.game.id, row]));
  let corrections = 0, harms = 0, changedWinners = 0, marginMaeDelta = 0, totalMaeDelta = 0;
  let marginPredictionDelta = 0, totalPredictionDelta = 0;
  for (const row of candidate) {
    const old = byId.get(row.game.id);
    if (!old) throw new Error("CBB opportunity-factor paired game missing");
    const before = old.forecast.homeWinProbability >= 0.5;
    const after = row.forecast.homeWinProbability >= 0.5;
    if (before !== after) {
      changedWinners++;
      if (after === (row.game.homeScore > row.game.awayScore)) corrections++; else harms++;
    }
    const actualMargin = row.game.homeScore - row.game.awayScore;
    const actualTotal = row.game.homeScore + row.game.awayScore;
    marginMaeDelta += Math.abs(row.forecast.margin - actualMargin) - Math.abs(old.forecast.margin - actualMargin);
    totalMaeDelta += Math.abs(row.forecast.total - actualTotal) - Math.abs(old.forecast.total - actualTotal);
    marginPredictionDelta += Math.abs(row.forecast.margin - old.forecast.margin);
    totalPredictionDelta += Math.abs(row.forecast.total - old.forecast.total);
  }
  return { corrections, harms, changedWinners, marginMaeDelta: marginMaeDelta / candidate.length,
    totalMaeDelta: totalMaeDelta / candidate.length,
    meanAbsoluteMarginPredictionChange: marginPredictionDelta / candidate.length,
    meanAbsoluteTotalPredictionChange: totalPredictionDelta / candidate.length };
}
function compare(train: CbbScoreFeatureRow[], test: CbbScoreFeatureRow[], history: CbbTrainingGame[], boxes: CbbBox[],
  fitThroughSeason: number) {
  const baseline = applyCbbScoreCorrection(test, fitCbbScoreCorrection(train, "matchup", fitThroughSeason));
  const variants = (["pooled", "pooled_recency_90"] as CbbOpportunityFactorVariant[]).map(variant => {
    const revisedTrain = enrichOpportunityFactors(train, history, boxes, variant);
    const revisedTest = enrichOpportunityFactors(test, history, boxes, variant);
    const correction = fitCbbScoreCorrection(revisedTrain, "matchup", fitThroughSeason);
    const candidate = applyCbbScoreCorrection(revisedTest, correction);
    return { variant, metrics: metrics(candidate), paired: paired(baseline, candidate),
      coefficientsMargin: correction.coefficientsMargin, coefficientsTotal: correction.coefficientsTotal };
  });
  return { baseline: metrics(baseline), variants };
}
async function main() {
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  if (dirty && !allowDirty) throw new Error("CBB opportunity-factor audit requires clean committed source");
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
  checkCohort(development, 2023, history); checkCohort(selection, 2024, history);
  const replayDevelopment = replayCbbScoreResearch(history, 2023, artifact.config, CBB_DEVELOPMENT_UNCERTAINTY);
  const replaySelection = replayCbbScoreResearch(history, 2024, artifact.config,
    fitCbbUncertainty(replayDevelopment, 2023));
  for (const [name, replay] of [["score-feature-development.json", replayDevelopment],
    ["score-feature-selection.json", replaySelection]] as const) {
    if (createHash("sha256").update(JSON.stringify(replay)).digest("hex") !== inputSha256[name]) {
      throw new Error(`CBB opportunity-factor ${name} did not regenerate from source`);
    }
  }
  const selected = compare(development, selection, history, boxes, 2023);
  const uncertainty = fitCbbUncertainty([...development, ...selection], 2024);
  const openedRaw = replayCbbScoreResearch(history, 2025, artifact.config, uncertainty);
  checkCohort(openedRaw, 2025, history);
  const opened = compare([...development, ...selection], openedRaw, history, boxes, 2024);
  if (selected.baseline.games !== 5710 || selected.baseline.wins !== 4113 ||
    Math.abs(selected.baseline.marginMae - 9.2420393) > 1e-5 || Math.abs(selected.baseline.totalMae - 12.9061366) > 1e-5 ||
    opened.baseline.games !== 5721 || opened.baseline.wins !== 4112 ||
    Math.abs(opened.baseline.marginMae - 9.2788746) > 1e-5 || Math.abs(opened.baseline.totalMae - 13.6378307) > 1e-5) {
    throw new Error("CBB opportunity-factor frozen r2 baseline failed reproduction");
  }
  const report = { release: CBB_OPPORTUNITY_FACTOR_RESEARCH_RELEASE, productionWrites: 0,
    sourceCommit, dirtyDevelopmentRun: Boolean(dirty), inputSha256,
    trainSeason: 2023, selectionSeason: 2024, openedDiagnosticSeason: 2025,
    selected, opened,
    limitations: "Both 2024 and 2025 have been previously opened; no variant can be declared a new untouched model improvement or activated from this audit." };
  await writeFile(`${directory}/opportunity-factors-r22-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ release: report.release, sourceCommit, selected: { baseline: selected.baseline,
    variants: selected.variants.map(({ variant, metrics, paired }) => ({ variant, metrics, paired })) },
    opened: { baseline: opened.baseline,
      variants: opened.variants.map(({ variant, metrics, paired }) => ({ variant, metrics, paired })) } }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
