import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { evaluateCbbRows } from "../../lib/cbb/evaluation";
import { applyCbbScoreCorrection, fitCbbScoreCorrection, type CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import { applyCbbShotHead, fitCbbShotHead, enrichCbbShotProfiles, CBB_SHOT_PROFILE_RELEASE } from "../../lib/cbb/shotProfileResearch";
import { applyCbbScoreTrees, trainCbbScoreTrees } from "../../lib/cbb/scoreTrees";
import type { CbbBox, CbbGame, CbbVenue } from "../../lib/cbb/types";

const dir = "/private/tmp/oddsphere-cbb-data";
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("private research only");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
async function main() {
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games;
  const rawDevelopment = await read<CbbScoreFeatureRow[]>("score-feature-development.json");
  const rawSelection = await read<CbbScoreFeatureRow[]>("score-feature-selection.json");
  const development = enrichCbbShotProfiles(rawDevelopment, history, boxes);
  const selection = enrichCbbShotProfiles(rawSelection, history, boxes);
  const baselineRows = applyCbbScoreCorrection(rawSelection, fitCbbScoreCorrection(rawDevelopment, "matchup", 2023));
  const baseline = evaluateCbbRows(baselineRows);
  const candidates: Array<{ id: string; metrics: ReturnType<typeof evaluateCbbRows>; score: number; eligible: boolean }> = [];
  const register = (id: string, rows: CbbScoreFeatureRow[]) => {
    const metrics = evaluateCbbRows(rows);
    const eligible = metrics.marginMae < baseline.marginMae && metrics.totalMae < baseline.totalMae && metrics.accuracy >= baseline.accuracy - 0.005 && metrics.brier <= baseline.brier;
    const score = (metrics.marginMae / baseline.marginMae + metrics.totalMae / baseline.totalMae) / 2;
    candidates.push({ id, metrics, eligible, score });
    console.log(JSON.stringify({ id, eligible, marginMae: metrics.marginMae, totalMae: metrics.totalMae, accuracy: metrics.accuracy, brier: metrics.brier }));
  };
  for (const penalty of [10, 100, 1000]) for (const loss of ["squared", "huber"] as const) {
    register(`linear_${penalty}_${loss}`, applyCbbShotHead(selection, fitCbbShotHead(development, 2023, penalty, loss)));
  }
  for (const depth of [2, 3]) register(`tree_${depth}`, applyCbbScoreTrees(selection,
    trainCbbScoreTrees(development, 2023, { depth, rounds: 80, learningRate: 0.05, minLeaf: 100, bins: 16 })));
  const selected = candidates.filter(c => c.eligible).sort((a, b) => a.score - b.score)[0] ?? null;
  const report: Record<string, unknown> = { release: CBB_SHOT_PROFILE_RELEASE, productionWrites: 0, baseline, candidates, selected,
    selectionSeason: 2024, trainingSeason: 2023, diagnosticStatus: "2025 is already opened; not pristine holdout" };
  if (selected) {
    const r2 = await read<CbbScoreFeatureRow[]>("candidate-r2-diagnostic.json");
    const frozen = await read<{ correction: { featureIndexes: number[]; coefficientsMargin: number[]; coefficientsTotal: number[] } }>("candidate-r2-artifact.json");
    const raw = r2.map(row => {
      const dot = (c: number[]) => frozen.correction.featureIndexes.reduce((s, index, i) => s + row.features[index] * c[i], 0);
      const margin = row.forecast.margin - dot(frozen.correction.coefficientsMargin), total = row.forecast.total - dot(frozen.correction.coefficientsTotal);
      return { ...row, forecast: { ...row.forecast, margin, total, homeScore: (total + margin) / 2, awayScore: (total - margin) / 2 } };
    });
    const enriched = enrichCbbShotProfiles(raw, history, boxes), fit = [...development, ...selection];
    let result: CbbScoreFeatureRow[];
    if (selected.id.startsWith("linear")) {
      const [, penalty, loss] = selected.id.split("_");
      const head = fitCbbShotHead(fit, 2024, Number(penalty), loss as "squared" | "huber");
      result = applyCbbShotHead(enriched, head);
      await writeFile(`${dir}/candidate-r3-head.json`, JSON.stringify(head, null, 2));
    } else {
      const head = trainCbbScoreTrees(fit, 2024, { depth: Number(selected.id.split("_")[1]), rounds: 80, learningRate: 0.05, minLeaf: 100, bins: 16 });
      result = applyCbbScoreTrees(enriched, head);
      await writeFile(`${dir}/candidate-r3-head.json`, JSON.stringify(head, null, 2));
    }
    let corrections = 0, harms = 0;
    result.forEach((row, i) => {
      const outcome = row.game.homeScore > row.game.awayScore;
      const old = (r2[i].forecast.homeWinProbability >= 0.5) === outcome, next = (row.forecast.homeWinProbability >= 0.5) === outcome;
      corrections += Number(!old && next); harms += Number(old && !next);
    });
    report.diagnosticBaseline = evaluateCbbRows(r2); report.diagnostic = evaluateCbbRows(result);
    report.corrections = corrections; report.harms = harms;
    await writeFile(`${dir}/candidate-r3-diagnostic.json`, JSON.stringify(result));
  }
  await writeFile(`${dir}/shot-profile-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ selected, diagnostic: report.diagnostic, corrections: report.corrections, harms: report.harms }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
