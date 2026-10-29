import { readFile, writeFile } from "node:fs/promises";
import { CBB_TOTAL_DECISION_THRESHOLDS } from "../../lib/cbb/decisionResearch";
import { auditCbbQuotePair, cbbQuoteDateUncertainty } from "../../lib/cbb/lossAudit";
import { cbbThresholdProbabilities, settleCbbMarket } from "../../lib/cbb/model";
import { cbbOvertimeMixtureMoments, cbbOvertimeMixtureProbabilitiesAtLine, cbbOvertimeMixtureTotalProbabilities, fitCbbOvertimeMixture } from "../../lib/cbb/overtimeDistributionResearch";
import { applyCbbResidualStats, fitCbbResidualStats, type CbbResidualStatHead } from "../../lib/cbb/residualStatResearch";
import type { CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import type { CbbForecast, CbbQuote, CbbTrainingGame } from "../../lib/cbb/types";

const dir = "/private/tmp/oddsphere-cbb-data";
if (process.argv.length > 2) throw new Error("offline CBB overtime distribution research only");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
const save = (file: string, data: unknown) => writeFile(`${dir}/${file}`, JSON.stringify(data));
type Target = { game: CbbTrainingGame; baseline: CbbForecast; targets: CbbQuote[] };
type QuoteResult = { pick: string; probability: number; result: string };
type QuoteLedgerRow = { gameId: number; date: string; quote: CbbQuote; r2: QuoteResult; r12: QuoteResult; r16: QuoteResult;
  r12ToR16Correction: boolean; r12ToR16Harm: boolean };
type Bundles = { development: CbbScoreFeatureRow[]; selection: CbbScoreFeatureRow[]; training: CbbScoreFeatureRow[];
  diagnostic: CbbScoreFeatureRow[]; quoteRows: CbbScoreFeatureRow[];
  cohorts: { totalRows: Target[]; marketRows: Target[] } };
const tally = (rows: string[]) => ({ wins: rows.filter(x => x === "win").length, losses: rows.filter(x => x === "loss").length,
  pushes: rows.filter(x => x === "push").length, passes: rows.filter(x => x === "pass").length });
function thresholdGrid(rows: CbbScoreFeatureRow[], head: ReturnType<typeof fitCbbOvertimeMixture>) {
  let baselineLoss = 0, candidateLoss = 0;
  const b: string[] = [], c: string[] = [];
  for (const row of rows) {
    const actual = row.game.homeScore + row.game.awayScore, mixture = cbbOvertimeMixtureMoments(row.forecast, head);
    for (const line of CBB_TOTAL_DECISION_THRESHOLDS) {
      const old = cbbThresholdProbabilities(row.forecast, "total", line).first;
      const next = cbbOvertimeMixtureProbabilitiesAtLine(mixture, line).first;
      const y = Number(actual > line);
      baselineLoss -= y * Math.log(Math.max(1e-12, old)) + (1 - y) * Math.log(Math.max(1e-12, 1 - old));
      candidateLoss -= y * Math.log(Math.max(1e-12, next)) + (1 - y) * Math.log(Math.max(1e-12, 1 - next));
      b.push((old >= 0.5) === Boolean(y) ? "win" : "loss");
      c.push((next >= 0.5) === Boolean(y) ? "win" : "loss");
    }
  }
  return { thresholdDecisions: b.length, baselineLogLoss: baselineLoss / b.length, candidateLogLoss: candidateLoss / c.length,
    baseline: tally(b), candidate: tally(c) };
}
function quoteSummary(targets: Target[], market: "moneyline" | "spread" | "total", forecastByKey: Map<string, CbbForecast>, head: ReturnType<typeof fitCbbOvertimeMixture>) {
  const ledger = targets.flatMap<QuoteLedgerRow>(({ game, baseline, targets }) => {
    const quote = targets.find(q => q.market === market);
    if (!quote) return [];
    const r12 = forecastByKey.get(`${game.id}|${baseline.asOf}`);
    if (!r12) throw new Error("missing exact-time R12 quote replay");
    const old = auditCbbQuotePair(game, baseline, r12, quote);
    if (market !== "total") return [{ gameId: game.id, date: game.date, quote, r2: old.baseline, r12: old.candidate, r16: old.candidate,
      r12ToR16Correction: false, r12ToR16Harm: false }];
    const probs = cbbOvertimeMixtureTotalProbabilities(r12, head, quote.line!);
    const first = probs.first >= probs.second, pick = first ? "first" : "second";
    const result = settleCbbMarket("total", pick, quote.line, game.homeScore, game.awayScore);
    return [{ gameId: game.id, date: game.date, quote, r2: old.baseline, r12: old.candidate,
      r16: { pick, probability: (first ? probs.first : probs.second) / (probs.first + probs.second), result },
      r12ToR16Correction: old.candidate.result === "loss" && result === "win",
      r12ToR16Harm: old.candidate.result === "win" && result === "loss" }];
  });
  const r2 = tally(ledger.map(r => r.r2.result)), r12 = tally(ledger.map(r => r.r12.result)), r16 = tally(ledger.map(r => r.r16.result));
  const corrections = ledger.filter(r => r.r12ToR16Correction).length, harms = ledger.filter(r => r.r12ToR16Harm).length;
  return { summary: { games: ledger.length, r2, r12, r16, corrections, harms,
    dateUncertainty: cbbQuoteDateUncertainty(ledger.map(r => ({ date: r.date, delta: Number(r.r12ToR16Correction) - Number(r.r12ToR16Harm) }))) }, ledger };
}
async function main() {
  const bundle = await read<Bundles>("cbb-decision-feature-bundles.json");
  const head2024 = fitCbbOvertimeMixture(bundle.development, "2024-07-01T00:00:00.000Z");
  const parent2024 = fitCbbResidualStats(bundle.development, "2024-07-01T00:00:00.000Z", "squared");
  const selectionRows = bundle.selection.map(r => applyCbbResidualStats(r, parent2024));
  const selection = thresholdGrid(selectionRows, head2024);
  const selectedOn2024 = selection.candidateLogLoss < selection.baselineLogLoss && selection.candidate.wins >= selection.baseline.wins;
  const head2025 = fitCbbOvertimeMixture(bundle.training, "2025-07-01T00:00:00.000Z");
  const parent2025 = await read<CbbResidualStatHead>("candidate-r12-head.json");
  const diagnosticRows = bundle.diagnostic.map(r => applyCbbResidualStats(r, parent2025));
  const diagnostic = thresholdGrid(diagnosticRows, head2025);
  const quoteForecasts = new Map(bundle.quoteRows.map(r => [`${r.game.id}|${r.forecast.asOf}`, applyCbbResidualStats(r, parent2025).forecast]));
  const market = Object.fromEntries((["moneyline", "spread", "total"] as const).map(m => [m, quoteSummary(bundle.cohorts.marketRows, m, quoteForecasts, head2025)]));
  const wider = quoteSummary(bundle.cohorts.totalRows, "total", quoteForecasts, head2025);
  const sample = diagnosticRows.map(r => cbbOvertimeMixtureMoments(r.forecast, head2025));
  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
  const invariants = { scoredGames: sample.length,
    maxMeanError: Math.max(...sample.map(m => Math.abs((1 - m.overtimeProbability) * m.regulationMean + m.overtimeProbability * m.overtimeMean - m.finalMean))),
    maxVarianceError: Math.max(...sample.map(m => Math.abs(m.withinComponentSd ** 2 + m.overtimeProbability * (1 - m.overtimeProbability) * m.overtimeAddedPoints ** 2 - m.finalVariance))),
    meanOvertimeProbability: mean(sample.map(m => m.overtimeProbability)), meanRegulationShift: mean(sample.map(m => m.regulationMean - m.finalMean)) };
  if (invariants.maxMeanError > 1e-8 || invariants.maxVarianceError > 1e-8 ||
    ["moneyline", "spread"].some(m => { const x = (market[m] as ReturnType<typeof quoteSummary>).summary; return JSON.stringify(x.r12) !== JSON.stringify(x.r16); })) throw new Error("overtime distribution coherence or margin preservation failed");
  const report = { status: "private_audit_only_not_promoted", productionWrites: 0, selectedOn2024, selection,
    head2024: { ...head2024, trainingGameIds: undefined }, head2025: { ...head2025, trainingGameIds: undefined },
    diagnostic, market353: Object.fromEntries(Object.entries(market).map(([m, x]) => [m, (x as ReturnType<typeof quoteSummary>).summary])),
    openingTotal635: wider.summary, invariants, limitations: "2025 and quote cohorts already opened; training overtime probability uses R10 margin because R12 training-season forecasts would be in sample. This is a distribution diagnostic, not a verified new betting model." };
  await save("candidate-r16-overtime-head.json", head2025);
  await save("candidate-r16-overtime-report.json", report);
  await save("candidate-r16-overtime-quote-ledgers.json", { market353: Object.fromEntries(Object.entries(market).map(([m, x]) => [m, (x as ReturnType<typeof quoteSummary>).ledger])), openingTotal635: wider.ledger });
  console.log(JSON.stringify({ selectedOn2024, selection, diagnostic, market353: report.market353, openingTotal635: wider.summary, invariants }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
