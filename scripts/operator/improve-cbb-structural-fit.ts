import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { CBB_DEVELOPMENT_UNCERTAINTY, cbbMonthlyMetrics, evaluateCbbRows, fitCbbUncertainty } from "../../lib/cbb/evaluation";
import { applyCbbScoreCorrection, fitCbbScoreCorrection, type CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import { CBB_STRUCTURAL_RESEARCH_RELEASE, CBB_STRUCTURAL_VARIANTS, replayCbbStructuralResearch, type CbbFitDiagnostics } from "../../lib/cbb/structuralResearch";
import type { CbbBox, CbbGame, CbbVenue } from "../../lib/cbb/types";

const dir = "/private/tmp/oddsphere-cbb-data";
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("private research only");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
const fitSummary = (ds: CbbFitDiagnostics[]) => ({ fits: ds.length, unconverged: ds.filter(d => !d.converged).length,
  maxIterations: Math.max(...ds.map(d => d.iterations)), maxFinalChange: Math.max(...ds.map(d => d.maxChange)),
  maxInitialChange: Math.max(...ds.map(d => d.initialMaxChange)) });
function compare(baseline: CbbScoreFeatureRow[], candidate: CbbScoreFeatureRow[]) {
  if (baseline.length !== candidate.length || baseline.some((r, i) => r.game.id !== candidate[i].game.id || r.forecast.asOf !== candidate[i].forecast.asOf)) throw new Error("CBB paired cohort mismatch");
  let corrections = 0, harms = 0;
  const changes: Array<{ gameId: number; date: string; kind: string; oldMargin: number; newMargin: number; actualMargin: number }> = [];
  candidate.forEach((r, i) => {
    const outcome = r.game.homeScore > r.game.awayScore;
    const old = (baseline[i].forecast.homeWinProbability >= 0.5) === outcome, next = (r.forecast.homeWinProbability >= 0.5) === outcome;
    corrections += Number(!old && next); harms += Number(old && !next);
    if (old !== next) changes.push({ gameId: r.game.id, date: r.game.date, kind: next ? "correction" : "harm", oldMargin: baseline[i].forecast.margin, newMargin: r.forecast.margin, actualMargin: r.game.homeScore - r.game.awayScore });
  });
  return { corrections, harms, net: corrections - harms, changes };
}
async function main() {
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games;
  const development = await read<CbbScoreFeatureRow[]>("score-feature-development.json"), selection = await read<CbbScoreFeatureRow[]>("score-feature-selection.json");
  const baselineRows = applyCbbScoreCorrection(selection, fitCbbScoreCorrection(development, "matchup", 2023)), baseline = evaluateCbbRows(baselineRows);
  const config = { id: "structural_r6", ridge: 1, paceRidge: 0.25, priorCarry: 0.8, recencyDays: 90 };
  const candidates = [], cache = new Map<string, { development: CbbScoreFeatureRow[]; selection: CbbScoreFeatureRow[] }>();
  for (const variant of CBB_STRUCTURAL_VARIANTS) {
    console.log(JSON.stringify({ starting: variant.id, at: new Date().toISOString() }));
    const dev = replayCbbStructuralResearch(history, 2023, config, CBB_DEVELOPMENT_UNCERTAINTY, variant);
    const sel = replayCbbStructuralResearch(history, 2024, config, fitCbbUncertainty(dev.rows, 2023), variant);
    const rows = applyCbbScoreCorrection(sel.rows, fitCbbScoreCorrection(dev.rows, "matchup", 2023));
    const metrics = evaluateCbbRows(rows), numerical = fitSummary([...dev.diagnostics, ...sel.diagnostics]);
    const eligible = numerical.unconverged === 0 && metrics.marginMae < baseline.marginMae && metrics.totalMae < baseline.totalMae && metrics.brier <= baseline.brier && metrics.accuracy >= baseline.accuracy - 0.005;
    const score = (metrics.marginMae / baseline.marginMae + metrics.totalMae / baseline.totalMae) / 2;
    const result = { variant, metrics, numerical, eligible, score, paired: compare(baselineRows, rows) };
    candidates.push(result); cache.set(variant.id, { development: dev.rows, selection: sel.rows });
    console.log(JSON.stringify({ completed: variant.id, eligible, marginMae: metrics.marginMae, totalMae: metrics.totalMae, accuracy: metrics.accuracy, brier: metrics.brier, numerical }));
  }
  const selected = candidates.filter(c => c.eligible).sort((a, b) => a.score - b.score)[0] ?? null;
  const report: Record<string, unknown> = { release: CBB_STRUCTURAL_RESEARCH_RELEASE, productionWrites: 0, config,
    datasetSha256: createHash("sha256").update(JSON.stringify(history)).digest("hex"), baseline, candidates, selected,
    trainingSeason: 2023, selectionSeason: 2024, diagnosticStatus: "2025 already opened; not pristine holdout" };
  if (selected) {
    const fit = cache.get(selected.variant.id)!;
    const training = [...fit.development, ...fit.selection], uncertainty = fitCbbUncertainty(training, 2024);
    const raw = replayCbbStructuralResearch(history, 2025, config, uncertainty, selected.variant);
    const correction = fitCbbScoreCorrection(training, "matchup", 2024), rows = applyCbbScoreCorrection(raw.rows, correction);
    if (raw.diagnostics.some(d => !d.converged)) throw new Error("unconverged diagnostic fit");
    const old = await read<CbbScoreFeatureRow[]>("candidate-r2-diagnostic.json");
    report.diagnostic = { baseline: evaluateCbbRows(old), candidate: evaluateCbbRows(rows), paired: compare(old, rows),
      monthly: cbbMonthlyMetrics(rows), baselineMonthly: cbbMonthlyMetrics(old), numerical: fitSummary(raw.diagnostics),
      overtime: { baseline: evaluateCbbRows(old.filter(r => r.game.overtime)), candidate: evaluateCbbRows(rows.filter(r => r.game.overtime)) },
      regulation: { baseline: evaluateCbbRows(old.filter(r => !r.game.overtime)), candidate: evaluateCbbRows(rows.filter(r => !r.game.overtime)) } };
    await writeFile(`${dir}/candidate-r6-diagnostic.json`, JSON.stringify(rows));
    await writeFile(`${dir}/candidate-r6-head.json`, JSON.stringify({ release: CBB_STRUCTURAL_RESEARCH_RELEASE, config, variant: selected.variant, correction, uncertainty }, null, 2));
  }
  await writeFile(`${dir}/structural-fit-report.json`, JSON.stringify(report, null, 2));
  const diagnostic = report.diagnostic as { baseline: ReturnType<typeof evaluateCbbRows>; candidate: ReturnType<typeof evaluateCbbRows>; paired: ReturnType<typeof compare> } | undefined;
  console.log(JSON.stringify({ selected: selected?.variant, diagnostic: diagnostic ? { baseline: diagnostic.baseline, candidate: diagnostic.candidate,
    corrections: diagnostic.paired.corrections, harms: diagnostic.paired.harms } : null }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
