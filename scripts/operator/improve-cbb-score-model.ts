import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { CBB_DEVELOPMENT_UNCERTAINTY, cbbMonthlyMetrics, evaluateCbbRows, fitCbbUncertainty } from "../../lib/cbb/evaluation";
import { applyCbbScoreCorrection, fitCbbScoreCorrection, fitCbbScoreResearchState, replayCbbScoreResearch, CBB_SCORE_RESEARCH_RELEASE,
  type CbbScoreResearchConfig } from "../../lib/cbb/scoreResearch";
import baseline from "../../lib/cbb/artifacts/evaluation-r1.json";
import type { CbbBox, CbbGame, CbbRatingState, CbbVenue } from "../../lib/cbb/types";

const directory = "/private/tmp/oddsphere-cbb-data";
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("CBB score research cannot publish");
const read = async <T>(name: string): Promise<T[]> => JSON.parse(await readFile(resolve(directory, name), "utf8")).data;
const brief = (metrics: ReturnType<typeof evaluateCbbRows>) => ({ games: metrics.games, wins: metrics.wins, accuracy: metrics.accuracy,
  marginMae: metrics.marginMae, totalMae: metrics.totalMae, teamScoreMae: metrics.teamScoreMae, brier: metrics.brier, logLoss: metrics.logLoss });
async function main() {
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...await read<CbbGame>(`games-${season}.json`)); boxes.push(...await read<CbbBox>(`boxes-${season}.json`)); venues.push(...await read<CbbVenue>(`venues-${season}.json`));
  }
  const dataset = buildCbbTrainingGames(games, boxes, venues).games;
  const configs: CbbScoreResearchConfig[] = [];
  for (const ridge of [1, 3, 6]) for (const paceRidge of [0.25, 1, 3]) for (const priorCarry of [0.5, 0.8]) {
    configs.push({ id: `score_r${ridge}_p${paceRidge}_c${priorCarry}`, ridge, paceRidge, priorCarry, recencyDays: 90 });
  }
  const candidates = [];
  const baseTuning = baseline.selection.find(row => row.config.id === "adjusted_ridge_10_carry_80")!.metrics;
  for (const config of configs) {
    const development = replayCbbScoreResearch(dataset, 2023, config, CBB_DEVELOPMENT_UNCERTAINTY);
    const uncertainty = fitCbbUncertainty(development, 2023);
    const tuning = replayCbbScoreResearch(dataset, 2024, config, uncertainty);
    for (const mode of ["none", "affine", "matchup"] as const) {
      const correction = fitCbbScoreCorrection(development, mode, 2023);
      const corrected = applyCbbScoreCorrection(tuning, correction);
      const metrics = evaluateCbbRows(corrected);
      const score = (metrics.marginMae / baseTuning.marginMae + metrics.totalMae / baseTuning.totalMae) / 2;
      const eligible = metrics.marginMae < baseTuning.marginMae && metrics.totalMae < baseTuning.totalMae &&
        metrics.accuracy >= baseTuning.accuracy - 0.005 && metrics.brier <= baseTuning.brier;
      candidates.push({ config, mode, score, eligible, metrics, correction });
    }
    const last = candidates.slice(-3).map(row => ({ mode: row.mode, eligible: row.eligible, ...brief(row.metrics) }));
    console.log(JSON.stringify({ config: config.id, results: last }));
  }
  const selected = [...candidates].filter(row => row.eligible).sort((a, b) => a.score - b.score || a.metrics.logLoss - b.metrics.logLoss)[0];
  if (!selected) {
    await writeFile(resolve(directory, "score-improvement-report.json"), JSON.stringify({ release: CBB_SCORE_RESEARCH_RELEASE,
      selected: null, candidates, productionWrites: 0 }, null, 2));
    console.log("No candidate improved both score heads while preserving winner accuracy and Brier on selection."); return;
  }
  const development = replayCbbScoreResearch(dataset, 2023, selected.config, CBB_DEVELOPMENT_UNCERTAINTY);
  const devUncertainty = fitCbbUncertainty(development, 2023);
  const tuning = replayCbbScoreResearch(dataset, 2024, selected.config, devUncertainty);
  await writeFile(resolve(directory, "score-feature-development.json"), JSON.stringify(development));
  await writeFile(resolve(directory, "score-feature-selection.json"), JSON.stringify(tuning));
  const uncertainty = fitCbbUncertainty([...development, ...tuning], 2024);
  const correction = fitCbbScoreCorrection([...development, ...tuning], selected.mode, 2024);
  const diagnostic = applyCbbScoreCorrection(replayCbbScoreResearch(dataset, 2025, selected.config, uncertainty), correction);
  const diagnosticMetrics = evaluateCbbRows(diagnostic);
  let prior: CbbRatingState | undefined;
  for (const season of [2022, 2023, 2024, 2025]) prior = fitCbbScoreResearchState(dataset, {
    season, asOf: `${season + 1}-07-01T00:00:00.000Z`, config: selected.config, prior,
  });
  const report = { release: CBB_SCORE_RESEARCH_RELEASE, productionWrites: 0,
    selected: { config: selected.config, mode: selected.mode, metrics: selected.metrics },
    selectionCriterion: "2024 normalized margin/Total MAE; both improve, winner decline at most 0.5 pp, Brier no worse",
    diagnosticStatus: "2025 already opened; diagnostic confirmation, not pristine holdout", candidates,
    baseline: baseline.confirmation, diagnostic: diagnosticMetrics, diagnosticMonthly: cbbMonthlyMetrics(diagnostic),
    targets: { marginBelow6: diagnosticMetrics.marginMae < 6, totalBelow10: diagnosticMetrics.totalMae < 10 } };
  await writeFile(resolve(directory, "score-improvement-report.json"), JSON.stringify(report, null, 2));
  await writeFile(resolve(directory, "candidate-r2-artifact.json"), JSON.stringify({ release: CBB_SCORE_RESEARCH_RELEASE,
    config: selected.config, uncertainty, correction, prior, selectedThroughSeason: 2024 }, null, 2));
  await writeFile(resolve(directory, "candidate-r2-diagnostic.json"), JSON.stringify(diagnostic));
  console.log(JSON.stringify({ selected: report.selected, baseline: brief(baseline.confirmation), diagnostic: brief(diagnosticMetrics), targets: report.targets }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
