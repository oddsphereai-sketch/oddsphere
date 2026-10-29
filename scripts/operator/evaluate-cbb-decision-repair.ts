import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { CBB_DEVELOPMENT_UNCERTAINTY, evaluateCbbRows, fitCbbUncertainty } from "../../lib/cbb/evaluation";
import { enrichCbbMatchupMechanisms } from "../../lib/cbb/matchupMechanismResearch";
import { applyCbbSymmetricHead, cbbRawRepairRow, cbbRepairScore, fitCbbSymmetricHead, type CbbRepairRow } from "../../lib/cbb/neutralRepairResearch";
import { applyCbbResidualStats, fitCbbResidualStats, prepareCbbResidualStatInput, type CbbResidualStatHead } from "../../lib/cbb/residualStatResearch";
import { applyCbbDecisionHead, evaluateCbbDecisionGrid, fitCbbDecisionHead, type CbbDecisionVariant } from "../../lib/cbb/decisionResearch";
import { auditCbbQuotePair, cbbQuoteDateUncertainty, summarizeCbbLossPairs, cbbLossDateUncertainty } from "../../lib/cbb/lossAudit";
import { replayCbbScoreResearch, type CbbScoreFeatureRow, type CbbScoreResearchConfig } from "../../lib/cbb/scoreResearch";
import type { CbbBox, CbbForecast, CbbGame, CbbMarket, CbbQuote, CbbUncertainty, CbbVenue } from "../../lib/cbb/types";
const dir = "/private/tmp/oddsphere-cbb-data";
if (process.argv.length > 2) throw new Error("offline CBB decision repair only");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
const save = (file: string, data: unknown) => writeFile(`${dir}/${file}`, JSON.stringify(data));
type Target = { game: CbbRepairRow["game"]; baseline: CbbForecast; targets: CbbQuote[] };
type Bundles = { development: CbbScoreFeatureRow[]; selection: CbbScoreFeatureRow[]; training: CbbScoreFeatureRow[];
  diagnostic: CbbScoreFeatureRow[]; quoteRows: CbbScoreFeatureRow[]; neutralRows: CbbScoreFeatureRow[];
  cohorts: { totalRows: Target[]; marketRows: Target[] } };
async function main() {
  const bundle = await read<Bundles>("cbb-decision-feature-bundles.json");
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games; history.forEach(Object.freeze); Object.freeze(history);
  const config = (await read<{ config: CbbScoreResearchConfig }>("candidate-r2-artifact.json")).config;
  const raw2022 = replayCbbScoreResearch(history, 2022, config, CBB_DEVELOPMENT_UNCERTAINTY);
  const uncertainty = fitCbbUncertainty(raw2022, 2022);
  const mean2022 = fitCbbSymmetricHead(raw2022.map(r => cbbRawRepairRow(r, history)), "2023-07-01T00:00:00.000Z", "projection");
  function alignRaw(r: CbbRepairRow, u: CbbUncertainty): CbbRepairRow {
    if (u.fitThroughSeason >= r.game.season) throw new Error("future raw residual calibration");
    const dm = u.marginCorrection - r.forecast.uncertainty.marginCorrection, dt = u.totalCorrection - r.forecast.uncertainty.totalCorrection;
    const forecast = cbbRepairScore({ ...r.forecast, uncertainty: u }, r.forecast.margin + dm, r.forecast.total + dt, r.forecast.release);
    const features = [...r.features]; features[1] = forecast.margin / 10; features[2] = (forecast.total - 140) / 20;
    features[4] = forecast.margin * Math.abs(forecast.margin) / 400;
    features[15] = r.historyKnown ? features[15] - dm / 20 : 0;
    features[16] = r.historyKnown ? features[16] - dt / 20 : 0;
    return { ...r, forecast, features };
  }
  const ids = new Set(bundle.development.map(r => r.game.id));
  const raw2023 = (await read<CbbScoreFeatureRow[]>("score-feature-development.json")).map(r => alignRaw(cbbRawRepairRow(r, history), uncertainty)).filter(r => ids.has(r.game.id));
  const matchedDevelopment = enrichCbbMatchupMechanisms(raw2023.map(r => prepareCbbResidualStatInput(r, applyCbbSymmetricHead(r, mean2022))), history, boxes);
  if (matchedDevelopment.length !== bundle.development.length) throw new Error("CBB training cohort changed");
  const parentSelection = fitCbbResidualStats(bundle.development, "2024-07-01T00:00:00.000Z", "squared");
  const r12Selection = bundle.selection.map(r => applyCbbResidualStats(r, parentSelection));
  const baseline = { grid: evaluateCbbDecisionGrid(r12Selection), metrics: evaluateCbbRows(r12Selection) };
  const candidates = [];
  const variants: CbbDecisionVariant[] = ["matched_total", "median_total", "distribution"];
  for (const variant of variants) {
    const head = fitCbbDecisionHead(matchedDevelopment, "2024-07-01T00:00:00.000Z", variant, parentSelection);
    const rows = bundle.selection.map(r => applyCbbDecisionHead(r, head)), grid = evaluateCbbDecisionGrid(rows), metrics = evaluateCbbRows(rows);
    const numerical = Object.values(head.numerical).every(r => r.converged);
    const eligible = numerical && grid.total < baseline.grid.total && grid.margin <= baseline.grid.margin &&
      metrics.wins >= baseline.metrics.wins && metrics.brier <= baseline.metrics.brier && metrics.logLoss <= baseline.metrics.logLoss;
    const entry = { variant, release: head.release, eligible, grid, metrics, numerical: head.numerical };
    candidates.push(entry); console.log(JSON.stringify({ stage: "2024 decision selection", ...entry }));
  }
  const selectedTotal = candidates.filter(r => r.variant !== "distribution" && r.eligible).sort((a, b) => a.grid.total - b.grid.total)[0]?.variant ?? null;
  const selectedDistribution = candidates.find(r => r.variant === "distribution" && r.eligible)?.variant ?? null;
  const parentFinal = await read<CbbResidualStatHead>("candidate-r12-head.json");
  const baselineDiagnostic = bundle.diagnostic.map(r => applyCbbResidualStats(r, parentFinal));
  const frozenDiagnostic = await read<CbbScoreFeatureRow[]>("candidate-r12-diagnostic.json");
  baselineDiagnostic.forEach((r, i) => {
    if (r.game.id !== frozenDiagnostic[i].game.id || Math.abs(r.forecast.margin - frozenDiagnostic[i].forecast.margin) > 1e-8 || Math.abs(r.forecast.total - frozenDiagnostic[i].forecast.total) > 1e-8) throw new Error("frozen R12 replay changed");
  });
  const frozenR2 = await read<CbbScoreFeatureRow[]>("candidate-r2-diagnostic.json");
  const matchedTraining = [...matchedDevelopment, ...bundle.selection];
  const diagnostic: Record<string, unknown> = {}, quoteLedgers: Record<string, unknown> = {};
  for (const variant of variants) {
    const head = fitCbbDecisionHead(matchedTraining, "2025-07-01T00:00:00.000Z", variant, parentFinal);
    const rows = bundle.diagnostic.map(r => applyCbbDecisionHead(r, head));
    let unchangedMarginGames = 0;
    rows.forEach((r, i) => { if (r.forecast.margin === baselineDiagnostic[i].forecast.margin && r.forecast.homeWinProbability === baselineDiagnostic[i].forecast.homeWinProbability) unchangedMarginGames++; });
    if (variant !== "distribution" && unchangedMarginGames !== rows.length) throw new Error("Total repair changed R12 margin/probability");
    const pairs = frozenR2.map((r, i) => ({ game: r.game, baseline: r.forecast, candidate: rows[i].forecast, minimumTeamGames: 0, restDifference: 0 }));
    const neutral = bundle.neutralRows.map(r => applyCbbDecisionHead(r, head));
    let maxMarginSwapError = 0, maxTotalSwapError = 0, maxProbabilitySwapError = 0;
    for (let i = 0; i < neutral.length; i += 2) { const a = neutral[i].forecast, b = neutral[i + 1].forecast;
      maxMarginSwapError = Math.max(maxMarginSwapError, Math.abs(a.margin + b.margin)); maxTotalSwapError = Math.max(maxTotalSwapError, Math.abs(a.total - b.total));
      maxProbabilitySwapError = Math.max(maxProbabilitySwapError, Math.abs(a.homeWinProbability + b.homeWinProbability - 1)); }
    if (Math.max(maxMarginSwapError, maxTotalSwapError, maxProbabilitySwapError) > 1e-8) throw new Error("CBB decision symmetry failed");
    const quoteForecasts = new Map(bundle.quoteRows.map(r => [`${r.game.id}|${r.forecast.asOf}`, applyCbbDecisionHead(r, head).forecast]));
    const ledger: ReturnType<typeof auditCbbQuotePair>[] = [];
    function marketSummary(targets: Target[], market: CbbMarket) {
      const ls = targets.flatMap(r => { const q = r.targets.find(q => q.market === market); return q ? [auditCbbQuotePair(r.game, r.baseline, quoteForecasts.get(`${r.game.id}|${r.baseline.asOf}`)!, q)] : []; });
      ledger.push(...ls);
      let brier = 0, logLoss = 0, scored = 0;
      for (const r of ls) if (r.candidate.brier !== null) { const p = Math.max(1e-12, Math.min(1 - 1e-12, r.candidate.probability));
        brier += r.candidate.brier; logLoss -= Math.log(r.candidate.result === "win" ? p : 1 - p); scored++; }
      return { wins: ls.filter(r => r.candidate.result === "win").length, losses: ls.filter(r => r.candidate.result === "loss").length,
        pushes: ls.filter(r => r.candidate.result === "push").length, passes: ls.filter(r => r.candidate.result === "pass").length,
        corrections: ls.filter(r => r.correction).length, harms: ls.filter(r => r.harm).length, conditionalWlBrier: brier / scored, conditionalWlLogLoss: logLoss / scored,
        dateUncertainty: cbbQuoteDateUncertainty(ls.map(r => ({ date: r.date, delta: Number(r.correction) - Number(r.harm) }))) };
    }
    diagnostic[variant] = { release: head.release, selectedOn2024: variant === selectedTotal || variant === selectedDistribution,
      metrics: evaluateCbbRows(rows), grid: evaluateCbbDecisionGrid(rows), pairedVsR2: summarizeCbbLossPairs(pairs),
      dateUncertaintyVsR2: cbbLossDateUncertainty(pairs), numerical: head.numerical, unchangedMarginGames,
      invariants: { neutralGames: neutral.length / 2, maxMarginSwapError, maxTotalSwapError, maxProbabilitySwapError },
      threeMarket353: Object.fromEntries((["moneyline", "spread", "total"] as const).map(m => [m, marketSummary(bundle.cohorts.marketRows, m)])),
      openingTotal635: marketSummary(bundle.cohorts.totalRows, "total") };
    quoteLedgers[variant] = ledger;
    await save(`candidate-${variant}-head.json`, head); await save(`candidate-${variant}-diagnostic.json`, rows);
    console.log(JSON.stringify({ stage: "2025 opened diagnostic", variant, result: diagnostic[variant] }));
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const monthly = new Map(bundle.development.map(r => [r.game.id, r]));
  const trainingShift = { globalCalibration2022: uncertainty, developmentGames: matchedDevelopment.length,
    monthlyMeanBias: mean(bundle.development.map(r => r.forecast.total - r.game.homeScore - r.game.awayScore)),
    matchedMeanBias: mean(matchedDevelopment.map(r => r.forecast.total - r.game.homeScore - r.game.awayScore)),
    matchedMinusMonthlyTotal: mean(matchedDevelopment.map(r => r.forecast.total - monthly.get(r.game.id)!.forecast.total)) };
  const report = { status: "private_audit_only_not_promoted", productionWrites: 0, defaultPreviewUnchanged: true,
    providerCallsInFitting: 0, earlierQuoteProbe: (await read<{ summary: unknown }>("earlier-quote-probe-20261028.json")).summary,
    baseline2024R12: baseline, selection2024: candidates, selectedTotal, selectedDistribution, trainingShift, diagnostic,
    limitations: "2025 and these quote cohorts were already opened. Threshold grids are proper probability diagnostics, NOT historical market lines. No 2025 outcome enters fitting or selects the candidate. All three prespecified candidates are retained, even if rejected." };
  await save("cbb-decision-repair-report.json", report); await save("cbb-decision-repair-quote-ledgers.json", quoteLedgers);
  console.log(JSON.stringify({ selectedTotal, selectedDistribution, trainingShift }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
