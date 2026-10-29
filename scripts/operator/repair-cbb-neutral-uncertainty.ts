/** Offline private research. Reads existing receipts; never calls a provider or writes predictions. */
import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { evaluateCbbRows } from "../../lib/cbb/evaluation";
import { forecastCbbGame, settleCbbMarket, cbbThresholdProbabilities } from "../../lib/cbb/model";
import { correctCbbScoreForecast, fitCbbScoreResearchState, type CbbScoreCorrection, type CbbScoreFeatureRow, type CbbScoreResearchConfig } from "../../lib/cbb/scoreResearch";
import { applyCbbNoise, applyCbbSymmetricHead, cbbRawRepairRow, cbbRepairRowFromState, cbbReverseNeutralRow,
  fitCbbNoise, fitCbbSymmetricHead, projectCbbNeutralR2, type CbbNoiseRow,
  type CbbRepairRow, type CbbSymmetricHead } from "../../lib/cbb/neutralRepairResearch";
import type { CbbBox, CbbForecast, CbbGame, CbbMarket, CbbQuote, CbbRatingState, CbbUncertainty, CbbVenue } from "../../lib/cbb/types";
const dir = "/private/tmp/oddsphere-cbb-data";
if (process.argv.length > 2) throw new Error("private CBB repair accepts no activation or publication options");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
const save = async (file: string, data: unknown) => writeFile(`${dir}/${file}`, JSON.stringify(data, null, 2));
const compare = (before: CbbForecast, after: CbbForecast, actual: number) => ({
  correction: Number(Math.sign(before.margin) !== Math.sign(actual) && Math.sign(after.margin) === Math.sign(actual)),
  harm: Number(Math.sign(before.margin) === Math.sign(actual) && Math.sign(after.margin) !== Math.sign(actual)),
});
const metrics = (rows: CbbRepairRow[], fs: CbbForecast[]) => evaluateCbbRows(rows.map((r, i) => ({ game: r.game, forecast: fs[i] })));
function gaussianScore(rows: CbbNoiseRow[]) {
  return rows.reduce((s, { game: g, forecast: f }) => s + Math.log(f.uncertainty.marginSd) + Math.log(f.uncertainty.totalSd) +
    0.5 * (((g.homeScore - g.awayScore - f.margin) / f.uncertainty.marginSd) ** 2 + ((g.homeScore + g.awayScore - f.total) / f.uncertainty.totalSd) ** 2), 0) / rows.length;
}
function paired(rows: CbbRepairRow[], before: CbbForecast[], after: CbbForecast[]) {
  let corrections = 0, harms = 0;
  const byDate: Record<string, { corrections: number; harms: number }> = {};
  rows.forEach((r, i) => { const c = compare(before[i], after[i], r.game.homeScore - r.game.awayScore);
    corrections += c.correction; harms += c.harm;
    const day = r.game.date.slice(0, 10); byDate[day] ??= { corrections: 0, harms: 0 };
    byDate[day].corrections += c.correction; byDate[day].harms += c.harm;
  });
  return { corrections, harms, net: corrections - harms, byDate };
}
async function main() {
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games;
  history.forEach(Object.freeze); Object.freeze(history);
  const artifact = await read<{ config: CbbScoreResearchConfig; uncertainty: CbbUncertainty; correction: CbbScoreCorrection }>("candidate-r2-artifact.json");
  const oldReport = await read<{ candidates: Array<{ config: CbbScoreResearchConfig; mode: string; correction: CbbScoreCorrection }> }>("score-improvement-report.json");
  const correction2023 = oldReport.candidates.find(r => r.config.id === artifact.config.id && r.mode === "matchup")!.correction;
  const sourceDev = await read<CbbScoreFeatureRow[]>("score-feature-development.json"), sourceSelect = await read<CbbScoreFeatureRow[]>("score-feature-selection.json");
  const sourceDiagnostic = await read<CbbScoreFeatureRow[]>("candidate-r2-diagnostic.json");
  const development = sourceDev.map(r => cbbRawRepairRow(r, history)), selection = sourceSelect.map(r => cbbRawRepairRow(r, history));
  const diagnostic = sourceDiagnostic.map(r => cbbRawRepairRow(r, history));
  const baselineSelect = selection.map(r => correctCbbScoreForecast(r.forecast, r.features, correction2023, 2024));
  const baseline = sourceDiagnostic.map(r => r.forecast);
  diagnostic.forEach((r, i) => { const f = correctCbbScoreForecast(r.forecast, r.features, artifact.correction, 2025);
    if (Math.abs(f.margin - baseline[i].margin) > 1e-8 || Math.abs(f.total - baseline[i].total) > 1e-8) throw new Error("frozen R2 reconstruction mismatch"); });
  const selectHead = fitCbbSymmetricHead(development, "2024-07-01T00:00:00.000Z");
  const projectionSelect = selection.map(r => projectCbbNeutralR2(r, correction2023));
  const refitSelect = selection.map(r => applyCbbSymmetricHead(r, selectHead));
  const pm = metrics(selection, projectionSelect), rm = metrics(selection, refitSelect);
  const variant = rm.marginMae <= pm.marginMae && rm.totalMae <= pm.totalMae && rm.brier <= pm.brier && rm.logLoss <= pm.logLoss && rm.wins >= pm.wins ? "refit" : "projection";
  const allFit = [...development, ...selection], head = fitCbbSymmetricHead(allFit, "2025-07-01T00:00:00.000Z");
  const choose = (row: CbbRepairRow, h: CbbSymmetricHead, correction: CbbScoreCorrection) => variant === "refit" ? applyCbbSymmetricHead(row, h) : projectCbbNeutralR2(row, correction);
  const meanSelect = variant === "refit" ? refitSelect : projectionSelect;
  console.log(JSON.stringify({ stage: "2024 mean selection", variant, baseline: metrics(selection, baselineSelect), projection: pm, refit: rm }));

  // Each residual is from a mean fitted before its calendar month. No in-sample noise fitting.
  const rolling: CbbNoiseRow[] = [], foldReceipts = [];
  const months = [...new Set(allFit.map(r => r.game.date.slice(0, 7)))].sort();
  for (const month of months) {
    const cutoff = `${month}-01T00:00:00.000Z`, before = allFit.filter(r => Date.parse(r.game.date) + 21600000 <= Date.parse(cutoff));
    if (before.length < 200) continue;
    const inMonth = allFit.filter(r => r.game.date.startsWith(month));
    const fitted = fitCbbSymmetricHead(before, cutoff, variant);
    const rs = inMonth.map(r => ({ game: r.game, forecast: applyCbbSymmetricHead(r, fitted), minimumTeamGames: r.minimumTeamGames }));
    rolling.push(...rs); foldReceipts.push({ month, cutoff, trainingGames: before.length, residualGames: rs.length,
      latestLabelAvailableAt: new Date(Math.max(...before.map(r => Date.parse(r.game.date) + 21600000))).toISOString() });
  }
  const developmentResiduals = rolling.filter(r => r.game.season === 2023);
  await save("cbb-repair-rolling-means.json", rolling);
  const noiseSelection = (["constant", "conditional"] as const).map(kind => {
    const h = fitCbbNoise(developmentResiduals, "2024-07-01T00:00:00.000Z", kind, variant);
    const rows = selection.map((r, i) => ({ game: r.game, minimumTeamGames: r.minimumTeamGames, forecast: applyCbbNoise({ ...r, forecast: meanSelect[i] }, h) }));
    return { kind, head: h, metrics: evaluateCbbRows(rows), gaussianScore: gaussianScore(rows) };
  });
  const [constant, conditional] = noiseSelection, mm = metrics(selection, meanSelect);
  const noiseKind = conditional.gaussianScore < constant.gaussianScore && conditional.metrics.brier <= constant.metrics.brier && conditional.metrics.logLoss <= constant.metrics.logLoss ? "conditional" : "constant";
  const chosenNoiseSelection = noiseSelection.find(r => r.kind === noiseKind)!;
  const meanGaussian = gaussianScore(selection.map((r, i) => ({ ...r, forecast: meanSelect[i] })));
  const useNoise = chosenNoiseSelection.gaussianScore < meanGaussian && chosenNoiseSelection.metrics.brier <= mm.brier && chosenNoiseSelection.metrics.logLoss <= mm.logLoss;
  const noise = fitCbbNoise(rolling, "2025-07-01T00:00:00.000Z", noiseKind, variant);
  const r10 = diagnostic.map(r => choose(r, head, artifact.correction));
  const r11 = diagnostic.map((r, i) => applyCbbNoise({ ...r, forecast: r10[i] }, noise));
  console.log(JSON.stringify({ stage: "noise selection", useNoise, noiseKind, meanGaussian,
    noiseSelection: noiseSelection.map(r => ({ kind: r.kind, metrics: r.metrics, gaussianScore: r.gaussianScore })) }));

  // Prove cached reflection formulas against actual refitted states and fresh score features.
  let prior: CbbRatingState | undefined;
  for (const season of [2022, 2023, 2024]) prior = fitCbbScoreResearchState(history, { season, asOf: `${season + 1}-07-01T00:00:00.000Z`, config: artifact.config, prior });
  const states = new Map<string, CbbRatingState>();
  const rawAt = (game: CbbRepairRow["game"], asOf: string) => {
    let state = states.get(asOf);
    if (!state) { state = fitCbbScoreResearchState(history, { season: 2025, asOf, config: artifact.config, prior }); states.set(asOf, state); }
    const available = history.filter(g => g.season === 2025 && Date.parse(g.date) + 21600000 <= Date.parse(asOf));
    return cbbRepairRowFromState(forecastCbbGame(state, game, artifact.uncertainty), state, game, available);
  };
  const neutralPairs: Array<{ original: CbbRepairRow; reverse: CbbRepairRow; forward: CbbForecast; backward: CbbForecast }> = [];
  let neutralGames = 0, maxFeatureReflectionError = 0, maxMarginSwapError = 0, maxTotalSwapError = 0, maxProbabilitySwapError = 0, maxScoreSwapError = 0, nonNeutralNumericalChanges = 0;
  for (let i = 0; i < diagnostic.length; i++) {
    const row = diagnostic[i];
    if (row.game.neutral !== true) { nonNeutralNumericalChanges += Number(Math.abs(r10[i].margin - baseline[i].margin) > 1e-8 || Math.abs(r10[i].total - baseline[i].total) > 1e-8); continue; }
    neutralGames++;
    const original = rawAt(row.game, row.forecast.asOf), reflected = cbbReverseNeutralRow(original), actualReverse = rawAt(reflected.game, row.forecast.asOf);
    const error = Math.max(...actualReverse.features.map((v, j) => Math.abs(v - reflected.features[j])));
    maxFeatureReflectionError = Math.max(maxFeatureReflectionError, error);
    const forward = choose(original, head, artifact.correction), backward = choose(actualReverse, head, artifact.correction);
    neutralPairs.push({ original, reverse: actualReverse, forward, backward });
    if (Math.abs(forward.margin - r10[i].margin) > 1e-8 || Math.abs(forward.total - r10[i].total) > 1e-8) throw new Error("cached/actual repair mismatch");
    for (const [a, b] of [[forward, backward], [applyCbbNoise({ ...original, forecast: forward }, noise), applyCbbNoise({ ...actualReverse, forecast: backward }, noise)]]) {
      maxMarginSwapError = Math.max(maxMarginSwapError, Math.abs(a.margin + b.margin));
      maxTotalSwapError = Math.max(maxTotalSwapError, Math.abs(a.total - b.total));
      maxProbabilitySwapError = Math.max(maxProbabilitySwapError, Math.abs(a.homeWinProbability + b.homeWinProbability - 1));
      maxScoreSwapError = Math.max(maxScoreSwapError, Math.abs(a.homeScore - b.awayScore), Math.abs(a.awayScore - b.homeScore));
    }
  }
  await save("cbb-repair-neutral-pairs.json", neutralPairs);
  if (maxFeatureReflectionError > 1e-8 || maxMarginSwapError > 1e-8 || maxTotalSwapError > 1e-8 || maxProbabilitySwapError > 1e-8 || maxScoreSwapError > 1e-8 || (variant === "projection" && nonNeutralNumericalChanges)) throw new Error("CBB repair invariant failed");
  console.log(JSON.stringify({ stage: "actual-state invariants", neutralGames, maxFeatureReflectionError, nonNeutralNumericalChanges }));

  type QuoteInput = { game: CbbRepairRow["game"]; baseline: CbbForecast; targets: CbbQuote[] };
  const quotes = await read<{ totalRows: QuoteInput[]; marketRows: QuoteInput[] }>("independent-quote-loss-audit-inputs.json");
  const quoteCache = new Map<string, { row: CbbRepairRow; forecasts: Record<string, CbbForecast> }>();
  for (const input of [...quotes.totalRows, ...quotes.marketRows]) {
    const key = `${input.game.id}|${input.baseline.asOf}`; if (quoteCache.has(key)) continue;
    const row = rawAt(input.game, input.baseline.asOf);
    const old = correctCbbScoreForecast(row.forecast, row.features, artifact.correction, 2025);
    if (Math.abs(old.margin - input.baseline.margin) > 1e-8 || Math.abs(old.total - input.baseline.total) > 1e-8) throw new Error("frozen quote-time R2 mismatch");
    const repaired = choose(row, head, artifact.correction), calibrated = applyCbbNoise({ ...row, forecast: repaired }, noise);
    quoteCache.set(key, { row, forecasts: { r2: old, r10: repaired, r11: calibrated } });
    if (quoteCache.size % 100 === 0) console.log(JSON.stringify({ stage: "quote-time replays", games: quoteCache.size }));
  }
  await save("cbb-repair-quote-inputs.json", [...quoteCache.values()]);
  function summarize(inputs: QuoteInput[], market: CbbMarket) {
    return Object.fromEntries(["r2", "r10", "r11"].map(version => {
      let wins = 0, losses = 0, pushes = 0, corrections = 0, harms = 0, brier = 0, logLoss = 0, scored = 0;
      const byDate: Record<string, { corrections: number; harms: number }> = {};
      for (const input of inputs) {
        const q = input.targets.find(q => q.market === market); if (!q) continue;
        const fs = quoteCache.get(`${input.game.id}|${input.baseline.asOf}`)!.forecasts;
        const select = (f: CbbForecast) => market === "moneyline" ? f.margin >= 0 : market === "spread" ? f.margin + q.line! > 0 : f.total > q.line!;
        const before = settleCbbMarket(market, select(fs.r2) ? "first" : "second", q.line, input.game.homeScore, input.game.awayScore);
        const after = settleCbbMarket(market, select(fs[version]) ? "first" : "second", q.line, input.game.homeScore, input.game.awayScore);
        wins += Number(after === "win"); losses += Number(after === "loss"); pushes += Number(after === "push");
        const c = Number(before === "loss" && after === "win"), h = Number(before === "win" && after === "loss"); corrections += c; harms += h;
        const day = input.game.date.slice(0, 10); byDate[day] ??= { corrections: 0, harms: 0 }; byDate[day].corrections += c; byDate[day].harms += h;
        if (after !== "push") { const p0 = cbbThresholdProbabilities(fs[version], market, q.line), p = Math.max(1e-10, Math.min(1 - 1e-10, p0.first / (p0.first + p0.second)));
          const y = settleCbbMarket(market, "first", q.line, input.game.homeScore, input.game.awayScore) === "win" ? 1 : 0;
          brier += (p - y) ** 2; logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p); scored++; }
      }
      return [version, { wins, losses, pushes, corrections, harms, net: corrections - harms, conditionalWlBrier: brier / scored, conditionalWlLogLoss: logLoss / scored, byDate }];
    }));
  }
  const intervals = (rows: CbbRepairRow[], fs: CbbForecast[]) => Object.fromEntries([["slow", -Infinity, 65], ["middle", 65, 72], ["fast", 72, Infinity]].map(([name, low, high]) => {
    const indexes = rows.flatMap((r, i) => r.forecast.possessions >= Number(low) && r.forecast.possessions < Number(high) ? [i] : []);
    return [String(name), metrics(indexes.map(i => rows[i]), indexes.map(i => fs[i]))];
  }));
  const report = { release: "cbb_private_repair_r10_r11", status: "private_audit_only_not_promoted", defaultPreviewUnchanged: true,
    productionWrites: 0, providerCalls: 0, boardCountChange: 0,
    diagnosticStatus: "2025 previously opened. These are retrospective diagnostics, not untouched proof or guaranteed future accuracy.",
    selection2024: { baseline: metrics(selection, baselineSelect), projection: pm, refit: rm, selectedMeanVariant: variant,
      meanGaussian, noiseSelection, selectedNoiseKind: noiseKind, useNoise },
    rollingResidualReceipts: foldReceipts,
    diagnostic2025: { r2: metrics(diagnostic, baseline), r10: metrics(diagnostic, r10), r11: metrics(diagnostic, r11),
      pairedR10: paired(diagnostic, baseline, r10), pairedR11: paired(diagnostic, baseline, r11),
      neutral: { r2: metrics(diagnostic.filter(r => r.game.neutral === true), baseline.filter((_, i) => diagnostic[i].game.neutral === true)), r10: metrics(diagnostic.filter(r => r.game.neutral === true), r10.filter((_, i) => diagnostic[i].game.neutral === true)) },
      paceIntervals: { r2: intervals(diagnostic, baseline), r10: intervals(diagnostic, r10), r11: intervals(diagnostic, r11) } },
    invariants: { neutralGames, maxFeatureReflectionError, maxMarginSwapError, maxTotalSwapError, maxProbabilitySwapError, maxScoreSwapError, nonNeutralNumericalChanges },
    threeMarket353: Object.fromEntries((["moneyline", "spread", "total"] as const).map(m => [m, summarize(quotes.marketRows, m)])),
    openingTotal635: summarize(quotes.totalRows, "total"),
    selectionOnlyRelease: useNoise ? noise.release : head.release,
    limitations: ["No production activation or grades/stakes changes", "Opening prices are not sharp price-movement evidence", "353 fixtures have corroborated orientation, not independent selection-level side proof", "Unverified historical injuries/rosters remain unverified", "Full overtime-mixture modeling remains separate", "2025 quotes cannot retune a 2024-selected head"] };
  await save("cbb-repair-r10-r11-report.json", report);
  await save("candidate-r10-diagnostic.json", diagnostic.map((r, i) => ({ ...r, forecast: r10[i] })));
  await save("candidate-r11-diagnostic.json", diagnostic.map((r, i) => ({ ...r, forecast: r11[i] })));
  await save("candidate-repair-artifact.json", { variant, useNoise, head, noise });
  console.log(JSON.stringify({ selectedMean: variant, useNoise, selectedNoise: noiseKind, diagnostic: { r2: report.diagnostic2025.r2, r10: report.diagnostic2025.r10, r11: report.diagnostic2025.r11 }, invariants: report.invariants, threeMarket353: report.threeMarket353, openingTotal635: report.openingTotal635 }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
