import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { CBB_DEVELOPMENT_UNCERTAINTY, evaluateCbbRows, fitCbbUncertainty, cbbMonthlyMetrics } from "../../lib/cbb/evaluation";
import { replayCbbScoreResearch, type CbbScoreFeatureRow, type CbbScoreResearchConfig } from "../../lib/cbb/scoreResearch";
import { trainCbbScoreTrees, applyCbbScoreTrees, type CbbScoreTreeOptions } from "../../lib/cbb/scoreTrees";
import type { CbbBox, CbbGame, CbbVenue } from "../../lib/cbb/types";
import baseline from "../../lib/cbb/artifacts/evaluation-r1.json";

const dir = "/private/tmp/oddsphere-cbb-data";
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("CBB tree research cannot publish");
const load = async (name: string) => JSON.parse(await readFile(`${dir}/${name}`, "utf8"));
async function main() {
  const original = await load("score-improvement-report.json");
  const artifact = await load("candidate-r2-artifact.json");
  const config: CbbScoreResearchConfig = original.selected.config;
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await load(`games-${season}.json`)).data);
    boxes.push(...(await load(`boxes-${season}.json`)).data);
    venues.push(...(await load(`venues-${season}.json`)).data);
  }
  const dataset = buildCbbTrainingGames(games, boxes, venues).games;
  const development = replayCbbScoreResearch(dataset, 2023, config, CBB_DEVELOPMENT_UNCERTAINTY);
  const tuning = replayCbbScoreResearch(dataset, 2024, config, fitCbbUncertainty(development, 2023));
  await writeFile(`${dir}/score-feature-development.json`, JSON.stringify(development));
  await writeFile(`${dir}/score-feature-selection.json`, JSON.stringify(tuning));
  const baseMetrics = baseline.selection.find(row => row.config.id === "adjusted_ridge_10_carry_80")!.metrics;
  const score = (m: ReturnType<typeof evaluateCbbRows>) => (m.marginMae / baseMetrics.marginMae + m.totalMae / baseMetrics.totalMae) / 2;
  let winner: { options: CbbScoreTreeOptions; metrics: ReturnType<typeof evaluateCbbRows> } | null = null;
  let winningScore = score(original.selected.metrics);
  const results = [];
  for (const options of [
    { depth: 2, rounds: 80, learningRate: 0.05, minLeaf: 100, bins: 16 },
    { depth: 3, rounds: 100, learningRate: 0.03, minLeaf: 100, bins: 16 },
  ]) {
    const fitted = trainCbbScoreTrees(development, 2023, options);
    const metrics = evaluateCbbRows(applyCbbScoreTrees(tuning, fitted));
    const eligible = metrics.marginMae < baseMetrics.marginMae && metrics.totalMae < baseMetrics.totalMae &&
      metrics.accuracy >= baseMetrics.accuracy - 0.005 && metrics.brier <= baseMetrics.brier;
    results.push({ options, metrics, eligible });
    if (eligible && score(metrics) < winningScore) { winner = { options, metrics }; winningScore = score(metrics); }
    console.log(JSON.stringify({ options, eligible, marginMae: metrics.marginMae, totalMae: metrics.totalMae, accuracy: metrics.accuracy }));
  }
  let diagnostic: CbbScoreFeatureRow[] = await load("candidate-r2-diagnostic.json");
  if (winner) {
    const trees = trainCbbScoreTrees([...development, ...tuning], 2024, winner.options);
    diagnostic = applyCbbScoreTrees(replayCbbScoreResearch(dataset, 2025, config, artifact.uncertainty), trees);
    await writeFile(`${dir}/candidate-r2-artifact.json`, JSON.stringify({ ...artifact, selectedHead: "trees", trees }, null, 2));
    await writeFile(`${dir}/candidate-r2-diagnostic.json`, JSON.stringify(diagnostic));
  } else await writeFile(`${dir}/candidate-r2-artifact.json`, JSON.stringify({ ...artifact, selectedHead: "matchup" }, null, 2));
  const metrics = evaluateCbbRows(diagnostic);
  const report = { ...original, treeSelection: results, finalHead: winner ? "trees" : original.selected.mode,
    finalSelectionMetrics: winner?.metrics ?? original.selected.metrics, diagnostic: metrics, diagnosticMonthly: cbbMonthlyMetrics(diagnostic),
    targets: { marginBelow6: metrics.marginMae < 6, totalBelow10: metrics.totalMae < 10 } };
  await writeFile(`${dir}/score-improvement-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ head: report.finalHead, baseline: baseline.confirmation, candidate: metrics, targets: report.targets }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
