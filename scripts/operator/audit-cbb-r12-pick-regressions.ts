import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { enrichCbbMatchupMechanisms, CBB_MECHANISM_FEATURE_NAMES } from "../../lib/cbb/matchupMechanismResearch";
import { CBB_SHOT_FEATURE_NAMES } from "../../lib/cbb/shotProfileResearch";
import { applyCbbResidualStats, cbbResidualStatDesign, prepareCbbResidualStatInput, type CbbResidualStatHead } from "../../lib/cbb/residualStatResearch";
import { cbbRawRepairRow, projectCbbNeutralR2, type CbbNoiseRow, type CbbRepairRow } from "../../lib/cbb/neutralRepairResearch";
import { auditCbbQuotePair } from "../../lib/cbb/lossAudit";
import type { CbbScoreCorrection, CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import type { CbbBox, CbbForecast, CbbGame, CbbQuote, CbbVenue } from "../../lib/cbb/types";
const dir = "/private/tmp/oddsphere-cbb-data";
if (process.argv.length > 2) throw new Error("offline CBB audit only");
const read = async <T>(name: string): Promise<T> => JSON.parse(await readFile(`${dir}/${name}`, "utf8"));
const save = (name: string, data: unknown) => writeFile(`${dir}/${name}`, JSON.stringify(data));
async function main() {
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games; history.forEach(Object.freeze); Object.freeze(history);
  const head = await read<CbbResidualStatHead>("candidate-r12-head.json");
  const quoteInputs = await read<Array<{ row: CbbRepairRow; forecasts: Record<string, CbbForecast> }>>("cbb-repair-quote-inputs.json");
  const enriched = enrichCbbMatchupMechanisms(quoteInputs.map(r => prepareCbbResidualStatInput(r.row, r.forecasts.r10)), history, boxes);
  const forecastMap = new Map(enriched.map(r => [`${r.game.id}|${r.forecast.asOf}`, applyCbbResidualStats(r, head).forecast]));
  type Target = { game: CbbRepairRow["game"]; baseline: CbbForecast; targets: CbbQuote[] };
  const cohorts = await read<{ totalRows: Target[]; marketRows: Target[] }>("independent-quote-loss-audit-inputs.json");
  const marketIds = new Set(cohorts.marketRows.map(r => r.game.id));
  const featureMap = new Map(enriched.map(r => [`${r.game.id}|${r.forecast.asOf}`, r]));
  const ledger = cohorts.totalRows.map(r => {
    const key = `${r.game.id}|${r.baseline.asOf}`, forecast = forecastMap.get(key)!, features = featureMap.get(key)!;
    const quote = r.targets[0], pair = auditCbbQuotePair(r.game, r.baseline, forecast, quote);
    const x = cbbResidualStatDesign(features, "total");
    const contribution = head.total.coefficients.map((c, j) => ({ name: [...CBB_SHOT_FEATURE_NAMES, ...CBB_MECHANISM_FEATURE_NAMES][j],
      points: c * (x[j + 19] - head.total.regressions[j].reduce((s, b, i) => s + b * x[i], 0)) }));
    const delta = forecast.total - features.forecast.total;
    if (Math.abs(contribution.reduce((s, c) => s + c.points, 0) - delta) > 1e-8) throw new Error("CBB Total attribution mismatch");
    return { ...pair, neutral: r.game.neutral, in353: marketIds.has(r.game.id), baselineTotal: r.baseline.total, r10Total: features.forecast.total,
      r12Total: forecast.total, actualTotal: r.game.homeScore + r.game.awayScore, overtime: r.game.overtime,
      actualRegulationTotal: r.game.homeRegulation + r.game.awayRegulation, independentMargin: forecast.margin,
      rawDelta: delta, contribution };
  });
  type Ledger = typeof ledger;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const summary = (rows: Ledger) => ({ games: rows.length, corrections: rows.filter(r => r.correction).length, harms: rows.filter(r => r.harm).length,
    winsR2: rows.filter(r => r.baseline.result === "win").length, winsR12: rows.filter(r => r.candidate.result === "win").length,
    toOver: rows.filter(r => r.baseline.pick === "second" && r.candidate.pick === "first").length,
    toUnder: rows.filter(r => r.baseline.pick === "first" && r.candidate.pick === "second").length,
    meanDelta: mean(rows.map(r => r.r12Total - r.baselineTotal)), r2Mae: mean(rows.map(r => Math.abs(r.actualTotal - r.baselineTotal))),
    r12Mae: mean(rows.map(r => Math.abs(r.actualTotal - r.r12Total))),
    contributors: [...CBB_SHOT_FEATURE_NAMES, ...CBB_MECHANISM_FEATURE_NAMES].map((name, j) => ({ name,
      meanPoints: mean(rows.map(r => r.contribution[j].points)), meanAbsolutePoints: mean(rows.map(r => Math.abs(r.contribution[j].points))) })).sort((a, b) => b.meanAbsolutePoints - a.meanAbsolutePoints).slice(0, 8) });
  const group = (cut: (r: Ledger[number]) => string) => Object.fromEntries([...new Set(ledger.map(cut))].map(key => [key, summary(ledger.filter(r => cut(r) === key))]));
  const report = { status: "offline_diagnostic_not_causal_or_validation", productionWrites: 0, providerCalls: 0,
    overall: summary(ledger), bySubset: group(r => r.in353 ? "game_in_three_market_sample" : "game_outside_three_market_sample"),
    byDate: group(r => r.date.slice(0, 10)), byFlip: group(r => r.baseline.pick === r.candidate.pick ? "unchanged" : r.candidate.pick === "first" ? "to_over" : "to_under"),
    byOldEdge: group(r => Math.abs(r.baseline.signedEdge) < 1 ? "under1" : Math.abs(r.baseline.signedEdge) < 3 ? "1to3" : "3plus"),
    byVenue: group(r => String(r.neutral)), byBook: group(r => r.quote.sportsbook),
    postgameOnlyOvertime: group(r => r.overtime ? "overtime_diagnostic_only" : "regulation_diagnostic_only"),
    harmful: summary(ledger.filter(r => r.harm)), helpful: summary(ledger.filter(r => r.correction)) };
  await save("cbb-r12-total-regression-ledger.json", ledger); await save("cbb-r12-total-regression-audit.json", report);
  // Feature bundles for the declared follow-up. No 2025 label can enter fitting or selection.
  const rawDev = (await read<CbbScoreFeatureRow[]>("score-feature-development.json")).map(r => cbbRawRepairRow(r, history));
  const rawSel = (await read<CbbScoreFeatureRow[]>("score-feature-selection.json")).map(r => cbbRawRepairRow(r, history));
  const rolling = await read<CbbNoiseRow[]>("cbb-repair-rolling-means.json"), rollingMap = new Map(rolling.map(r => [r.game.id, r.forecast]));
  const old = await read<{ candidates: Array<{ config: { id: string }; mode: string; correction: CbbScoreCorrection }> }>("score-improvement-report.json");
  const correction = old.candidates.find(r => r.config.id === "score_r1_p0.25_c0.8" && r.mode === "matchup")!.correction;
  const enrich = (rows: CbbRepairRow[], forecasts: Map<number, CbbForecast>) => enrichCbbMatchupMechanisms(rows.map(r => prepareCbbResidualStatInput(r, forecasts.get(r.game.id)!)), history, boxes);
  const all = [...rawDev, ...rawSel].filter(r => rollingMap.has(r.game.id));
  const development = enrich(rawDev.filter(r => rollingMap.has(r.game.id)), rollingMap);
  const selection = enrich(rawSel, new Map(rawSel.map(r => [r.game.id, projectCbbNeutralR2(r, correction)])));
  const diagnosticRaw = (await read<CbbScoreFeatureRow[]>("candidate-r2-diagnostic.json")).map(r => cbbRawRepairRow(r, history));
  const diagnosticMean = await read<CbbScoreFeatureRow[]>("candidate-r10-diagnostic.json");
  const diagnostic = enrich(diagnosticRaw, new Map(diagnosticMean.map(r => [r.game.id, r.forecast])));
  const neutral = await read<Array<{ original: CbbRepairRow; reverse: CbbRepairRow; forward: CbbForecast; backward: CbbForecast }>>("cbb-repair-neutral-pairs.json");
  const neutralRows = enrichCbbMatchupMechanisms(neutral.flatMap(p => [prepareCbbResidualStatInput(p.original, p.forward), prepareCbbResidualStatInput(p.reverse, p.backward)]), history, boxes);
  await save("cbb-decision-feature-bundles.json", { development, selection, training: enrich(all, rollingMap), diagnostic, quoteRows: enriched, neutralRows, cohorts });
  console.log(JSON.stringify({ overall: report.overall, bySubset: report.bySubset, byFlip: report.byFlip, byDate: report.byDate, overtime: report.postgameOnlyOvertime }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
