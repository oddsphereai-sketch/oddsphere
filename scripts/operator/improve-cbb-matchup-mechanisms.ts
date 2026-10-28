import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { evaluateCbbRows } from "../../lib/cbb/evaluation";
import { applyCbbScoreCorrection, fitCbbScoreCorrection, type CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import { applyCbbShotHead, fitCbbShotHead } from "../../lib/cbb/shotProfileResearch";
import { enrichCbbMatchupMechanisms, enrichCbbEvidenceMaturity, CBB_MATCHUP_MECHANISM_RELEASE, CBB_EVIDENCE_MATURITY_RELEASE } from "../../lib/cbb/matchupMechanismResearch";
import type { CbbBox, CbbGame, CbbVenue } from "../../lib/cbb/types";

const dir = "/private/tmp/oddsphere-cbb-data";
const maturity = process.argv.includes("--maturity"), version = maturity ? "r8" : "r7";
const release = maturity ? CBB_EVIDENCE_MATURITY_RELEASE : CBB_MATCHUP_MECHANISM_RELEASE;
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
  const rawDev = await read<CbbScoreFeatureRow[]>("score-feature-development.json"), rawSel = await read<CbbScoreFeatureRow[]>("score-feature-selection.json");
  const enrich = (rows: CbbScoreFeatureRow[]) => {
    const enriched = enrichCbbMatchupMechanisms(rows, history, boxes);
    return maturity ? enrichCbbEvidenceMaturity(enriched) : enriched;
  };
  const development = enrich(rawDev), selection = enrich(rawSel);
  const baseline = evaluateCbbRows(applyCbbScoreCorrection(rawSel, fitCbbScoreCorrection(rawDev, "matchup", 2023)));
  const candidates = [];
  for (const penalty of [10, 100, 1000]) for (const loss of ["squared", "huber"] as const) {
    const head = { ...fitCbbShotHead(development, 2023, penalty, loss), release };
    const metrics = evaluateCbbRows(applyCbbShotHead(selection, head));
    const eligible = metrics.marginMae < baseline.marginMae && metrics.totalMae < baseline.totalMae && metrics.brier <= baseline.brier && metrics.accuracy >= baseline.accuracy - 0.005;
    const score = (metrics.marginMae / baseline.marginMae + metrics.totalMae / baseline.totalMae) / 2;
    candidates.push({ penalty, loss, metrics, eligible, score });
    console.log(JSON.stringify({ penalty, loss, eligible, marginMae: metrics.marginMae, totalMae: metrics.totalMae, accuracy: metrics.accuracy, brier: metrics.brier }));
  }
  const selected = candidates.filter(c => c.eligible).sort((a, b) => a.score - b.score)[0] ?? null;
  const report: Record<string, unknown> = { release, productionWrites: 0, baseline, candidates, selected,
    trainingSeason: 2023, selectionSeason: 2024, diagnosticStatus: "2025 already opened; not pristine holdout" };
  if (selected) {
    const old = await read<CbbScoreFeatureRow[]>("candidate-r2-diagnostic.json");
    const artifact = await read<{ correction: { featureIndexes: number[]; coefficientsMargin: number[]; coefficientsTotal: number[] } }>("candidate-r2-artifact.json");
    const raw = old.map(row => {
      const dot = (c: number[]) => artifact.correction.featureIndexes.reduce((sum, index, i) => sum + row.features[index] * c[i], 0);
      const margin = row.forecast.margin - dot(artifact.correction.coefficientsMargin), total = row.forecast.total - dot(artifact.correction.coefficientsTotal);
      return { ...row, forecast: { ...row.forecast, margin, total, homeScore: (total + margin) / 2, awayScore: (total - margin) / 2 } };
    });
    const head = { ...fitCbbShotHead([...development, ...selection], 2024, selected.penalty, selected.loss), release };
    const enriched = enrich(raw), rows = applyCbbShotHead(enriched, head);
    let corrections = 0, harms = 0;
    rows.forEach((row, i) => {
      if (row.game.id !== old[i].game.id) throw new Error("CBB mechanism cohort mismatch");
      const outcome = row.game.homeScore > row.game.awayScore;
      const before = (old[i].forecast.homeWinProbability >= 0.5) === outcome, after = (row.forecast.homeWinProbability >= 0.5) === outcome;
      corrections += Number(!before && after); harms += Number(before && !after);
    });
    report.diagnostic = { baseline: evaluateCbbRows(old), candidate: evaluateCbbRows(rows), corrections, harms, net: corrections - harms };
    await writeFile(`${dir}/candidate-${version}-head.json`, JSON.stringify(head, null, 2));
    await writeFile(`${dir}/candidate-${version}-diagnostic.json`, JSON.stringify(rows));
  }
  await writeFile(`${dir}/${maturity ? "evidence-maturity" : "matchup-mechanism"}-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ selected: selected ? { penalty: selected.penalty, loss: selected.loss } : null, diagnostic: report.diagnostic }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
