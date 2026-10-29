import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { evaluateCbbRows } from "../../lib/cbb/evaluation";
import { enrichCbbMatchupMechanisms } from "../../lib/cbb/matchupMechanismResearch";
import { cbbRawRepairRow, projectCbbNeutralR2, type CbbNoiseRow, type CbbRepairRow } from "../../lib/cbb/neutralRepairResearch";
import { applyCbbResidualStats, fitCbbResidualStats } from "../../lib/cbb/residualStatResearch";
import { auditCbbQuotePair, cbbLossDateUncertainty, cbbQuoteDateUncertainty, summarizeCbbLossPairs } from "../../lib/cbb/lossAudit";
import type { CbbScoreCorrection, CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import type { CbbBox, CbbForecast, CbbGame, CbbMarket, CbbQuote, CbbVenue } from "../../lib/cbb/types";
const dir = "/private/tmp/oddsphere-cbb-data";
if (process.argv.length > 2) throw new Error("private CBB offsets accept no activation options");
const read = async <T>(name: string): Promise<T> => JSON.parse(await readFile(`${dir}/${name}`, "utf8"));
const save = (name: string, data: unknown) => writeFile(`${dir}/${name}`, JSON.stringify(data, null, 2));
async function main() {
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const s of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${s}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${s}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${s}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games;
  history.forEach(Object.freeze); Object.freeze(history);
  const rawDev = (await read<CbbScoreFeatureRow[]>("score-feature-development.json")).map(r => cbbRawRepairRow(r, history));
  const rawSel = (await read<CbbScoreFeatureRow[]>("score-feature-selection.json")).map(r => cbbRawRepairRow(r, history));
  const rolling = await read<CbbNoiseRow[]>("cbb-repair-rolling-means.json");
  const rollingMap = new Map(rolling.map(r => [r.game.id, r.forecast]));
  const oldReport = await read<{ candidates: Array<{ config: { id: string }; mode: string; correction: CbbScoreCorrection }> }>("score-improvement-report.json");
  const correction2023 = oldReport.candidates.find(r => r.config.id === "score_r1_p0.25_c0.8" && r.mode === "matchup")!.correction;
  // Existing features 15/16 are residual forms. Re-express them around the frozen R10 offset.
  function prepare(raw: CbbRepairRow[], fs: Map<number, CbbForecast>, enrich = true) {
    const rows = raw.map(r => {
      const forecast = fs.get(r.game.id); if (!forecast) throw new Error("missing pregame offset");
      const features = [...r.features]; features[1] = forecast.margin / 10; features[2] = (forecast.total - 140) / 20;
      features[4] = forecast.margin * Math.abs(forecast.margin) / 400;
      features[15] = r.historyKnown ? features[15] + (r.forecast.margin - forecast.margin) / 20 : 0;
      features[16] = r.historyKnown ? features[16] + (r.forecast.total - forecast.total) / 20 : 0;
      return { game: r.game, forecast, features };
    });
    return enrich ? enrichCbbMatchupMechanisms(rows, history, boxes) : rows;
  }
  const development = prepare(rawDev.filter(r => rollingMap.has(r.game.id)), rollingMap);
  const selectedMeans = new Map(rawSel.map(r => [r.game.id, projectCbbNeutralR2(r, correction2023)]));
  const selection = prepare(rawSel, selectedMeans), baseline = evaluateCbbRows(selection);
  console.log(JSON.stringify({ stage: "offset inputs", training: development.length, selection: selection.length }));
  const candidates = (["squared", "huber"] as const).map(loss => {
    const head = fitCbbResidualStats(development, "2024-07-01T00:00:00.000Z", loss);
    const rows = selection.map(r => applyCbbResidualStats(r, head)), metrics = evaluateCbbRows(rows);
    const eligible = metrics.marginMae < baseline.marginMae && metrics.totalMae < baseline.totalMae && metrics.wins >= baseline.wins && metrics.brier <= baseline.brier && metrics.logLoss <= baseline.logLoss;
    return { loss, metrics, eligible, score: metrics.marginMae / baseline.marginMae + metrics.totalMae / baseline.totalMae };
  });
  const selected = candidates.filter(r => r.eligible).sort((a, b) => a.score - b.score)[0] ?? null;
  console.log(JSON.stringify({ stage: "offset selection", baseline, candidates, selected }));
  const report: Record<string, unknown> = { release: "cbb_candidate_2026_10_28_r12_residual_stats", status: "private_audit_only_not_promoted", defaultPreviewUnchanged: true,
    productionWrites: 0, providerCalls: 0,
    baseline, candidates, selected, training: "monthly out-of-sample 2023 mean residuals", selection: 2024, diagnosticStatus: "2025 already opened, not pristine holdout" };
  if (selected) {
    const allRollingRaw = [...rawDev, ...rawSel].filter(r => rollingMap.has(r.game.id));
    const allTraining = prepare(allRollingRaw, rollingMap), head = fitCbbResidualStats(allTraining, "2025-07-01T00:00:00.000Z", selected.loss);
    const frozenR2 = await read<CbbScoreFeatureRow[]>("candidate-r2-diagnostic.json");
    const rawDiagnostic = frozenR2.map(r => cbbRawRepairRow(r, history));
    const meanDiagnostic = await read<CbbScoreFeatureRow[]>("candidate-r10-diagnostic.json");
    const diagnostic = prepare(rawDiagnostic, new Map(meanDiagnostic.map(r => [r.game.id, r.forecast])));
    const corrected = diagnostic.map(r => applyCbbResidualStats(r, head));
    const pairs = await read<Array<{ original: CbbRepairRow; reverse: CbbRepairRow; forward: CbbForecast; backward: CbbForecast }>>("cbb-repair-neutral-pairs.json");
    const invariantRaw = pairs.flatMap(p => [p.original, p.reverse]);
    const neutralRows = enrichCbbMatchupMechanisms(pairs.flatMap(p => [
      ...prepare([p.original], new Map([[p.original.game.id, p.forward]]), false),
      ...prepare([p.reverse], new Map([[p.reverse.game.id, p.backward]]), false),
    ]), history, boxes).map(r => applyCbbResidualStats(r, head));
    let maxMarginSwapError = 0, maxTotalSwapError = 0, maxProbabilitySwapError = 0, maxScoreSwapError = 0;
    const correctedMap = new Map(corrected.map(r => [r.game.id, r.forecast]));
    for (let i = 0; i < invariantRaw.length; i += 2) {
      const a = neutralRows[i].forecast, b = neutralRows[i + 1].forecast, frozen = correctedMap.get(neutralRows[i].game.id)!;
      if (Math.abs(a.margin - frozen.margin) > 1e-8 || Math.abs(a.total - frozen.total) > 1e-8) throw new Error("R12 actual-state replay mismatch");
      maxMarginSwapError = Math.max(maxMarginSwapError, Math.abs(a.margin + b.margin));
      maxTotalSwapError = Math.max(maxTotalSwapError, Math.abs(a.total - b.total));
      maxProbabilitySwapError = Math.max(maxProbabilitySwapError, Math.abs(a.homeWinProbability + b.homeWinProbability - 1));
      maxScoreSwapError = Math.max(maxScoreSwapError, Math.abs(a.homeScore - b.awayScore), Math.abs(a.awayScore - b.homeScore));
    }
    if (Math.max(maxMarginSwapError, maxTotalSwapError, maxProbabilitySwapError, maxScoreSwapError) > 1e-8) throw new Error("R12 neutral symmetry failed");
    report.invariants = { games: pairs.length, maxMarginSwapError, maxTotalSwapError, maxProbabilitySwapError, maxScoreSwapError };
    let corrections = 0, harms = 0;
    corrected.forEach((r, i) => { const y = r.game.homeScore > r.game.awayScore, a = diagnostic[i].forecast.margin >= 0, b = r.forecast.margin >= 0;
      corrections += Number(a !== y && b === y); harms += Number(a === y && b !== y); });
    const quoteInputs = await read<Array<{ row: CbbRepairRow; forecasts: Record<string, CbbForecast> }>>("cbb-repair-quote-inputs.json");
    const correctedQuotes = new Map<string, CbbForecast>();
    const quoteRows = quoteInputs.flatMap(input => prepare([input.row], new Map([[input.row.game.id, input.forecasts.r10]]), false));
    for (const row of enrichCbbMatchupMechanisms(quoteRows, history, boxes)) {
      correctedQuotes.set(`${row.game.id}|${row.forecast.asOf}`, applyCbbResidualStats(row, head).forecast);
    }
    type Target = { game: CbbRepairRow["game"]; baseline: CbbForecast; targets: CbbQuote[] };
    const quotes = await read<{ totalRows: Target[]; marketRows: Target[] }>("independent-quote-loss-audit-inputs.json");
    const summarize = (rows: Target[], market: CbbMarket) => {
      let wins = 0, losses = 0, pushes = 0, passes = 0, corrections = 0, harms = 0, brier = 0, logLoss = 0, scored = 0;
      const dates: Array<{ date: string; delta: number }> = [];
      for (const r of rows) { const q = r.targets.find(q => q.market === market)!; if (!q) continue;
        const after = correctedQuotes.get(`${r.game.id}|${r.baseline.asOf}`)!;
        const pair = auditCbbQuotePair(r.game, r.baseline, after, q), b = pair.candidate.result;
        wins += Number(b === "win"); losses += Number(b === "loss"); pushes += Number(b === "push"); passes += Number(b === "pass");
        corrections += Number(pair.correction); harms += Number(pair.harm);
        dates.push({ date: r.game.date, delta: Number(pair.correction) - Number(pair.harm) });
        if (pair.candidate.brier !== null) {
          const p = Math.max(1e-10, Math.min(1 - 1e-10, pair.candidate.probability));
          brier += pair.candidate.brier; logLoss -= Math.log(b === "win" ? p : 1 - p); scored++;
        }
      }
      return { wins, losses, pushes, passes, corrections, harms, net: corrections - harms,
        conditionalWlBrier: brier / scored, conditionalWlLogLoss: logLoss / scored, dateUncertainty: cbbQuoteDateUncertainty(dates) };
    };
    const pairsR2 = frozenR2.map((r, i) => {
      if (r.game.id !== corrected[i].game.id || r.forecast.asOf !== corrected[i].forecast.asOf) throw new Error("R12 full paired cohort mismatch");
      return { game: r.game, baseline: r.forecast, candidate: corrected[i].forecast,
        minimumTeamGames: rawDiagnostic[i].minimumTeamGames, restDifference: rawDiagnostic[i].features[5] * 7 };
    });
    report.diagnostic = { baselineR10: evaluateCbbRows(diagnostic), candidate: evaluateCbbRows(corrected), corrections, harms,
      pairedVsR2: summarizeCbbLossPairs(pairsR2), dateUncertaintyVsR2: cbbLossDateUncertainty(pairsR2),
      threeMarket353: Object.fromEntries((["moneyline", "spread", "total"] as const).map(m => [m, summarize(quotes.marketRows, m)])), openingTotal635: summarize(quotes.totalRows, "total") };
    await save("candidate-r12-diagnostic.json", corrected); await save("candidate-r12-head.json", head);
  }
  await save("cbb-residual-stat-report.json", report);
  console.log(JSON.stringify({ selected: report.selected, diagnostic: report.diagnostic ?? "not opened: neither fixed candidate qualified" }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
