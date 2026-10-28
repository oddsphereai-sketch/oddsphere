import { readFile, writeFile } from "node:fs/promises";
import { applyCbbMarketHead, fitCbbJointMarketLogLoss, CBB_MARKET_READER_RESEARCH_RELEASE } from "../../lib/cbb/marketReaderResearch";
import { evaluateCbbMarketReaderRows as metrics, type CbbMarketEvaluationRow } from "../../lib/cbb/marketReaderEvaluation";
const dir = "/private/tmp/oddsphere-cbb-data";
type Candidate = { penalty: number; authority: "joint" | "margin_only" | "total_only"; eligible: boolean; rows: number;
  baseline: ReturnType<typeof metrics>; result: ReturnType<typeof metrics>; deltas: Record<string, number>; net: number };
async function main() {
  const rows: CbbMarketEvaluationRow[] = JSON.parse(await readFile(`${dir}/market-reader-feature-rows.json`, "utf8"));
  const train = rows.filter(r => r.game.date < "2026-02-15"), selection = rows.filter(r => r.game.date >= "2026-02-21" && r.game.date < "2026-03-01");
  const later = rows.filter(r => r.game.date >= "2026-03-01"), candidates: Candidate[] = [];
  for (const penalty of [1, 10, 100]) {
    const fitted = fitCbbJointMarketLogLoss(train, penalty);
    for (const authority of ["joint", "margin_only", "total_only"] as const) {
    const head = { ...fitted, margin: authority === "total_only" ? fitted.margin.map(() => 0) : fitted.margin,
      total: authority === "margin_only" ? fitted.total.map(() => 0) : fitted.total };
    const eligibleRows = selection.filter(r => Date.parse(r.forecast.asOf) >= Date.parse(head.trainedThrough));
    const base = metrics(eligibleRows), result = metrics(eligibleRows, head);
    const deltas = Object.fromEntries(Object.keys(result.markets).map(k => [k, result.markets[k].wins - base.markets[k].wins]));
    const net = Object.values(deltas).reduce((s, n) => s + n, 0);
    const eligible = eligibleRows.length >= 50 && Object.values(deltas).every(n => n >= 0) && net > 0;
    candidates.push({ penalty, authority, eligible, rows: eligibleRows.length, baseline: base, result, deltas, net });
    console.log(JSON.stringify({ penalty, authority, eligible, deltas, net }));
    }
  }
  const loss = (c: typeof candidates[number]) => Object.values(c.result.markets).reduce((s, m) => s + m.logLoss, 0);
  const selected = candidates.filter(c => c.eligible).sort((a, b) => b.net - a.net || loss(a) - loss(b))[0] ?? null;
  const report: Record<string, unknown> = { release: CBB_MARKET_READER_RESEARCH_RELEASE, productionWrites: 0,
    scope: "conditional opening-price information, not qualified movement/splits inference", objective: "joint_market_log_loss", selected,
    cohortStatus: "selection reused research data; later evaluation is already-opened 2025 season, not pristine", candidates,
    counts: { train: train.length, selection: selection.length, later: later.length } };
  if (selected) {
    const fitted = fitCbbJointMarketLogLoss([...train, ...selection], selected.penalty);
    const head = { ...fitted, margin: selected.authority === "total_only" ? fitted.margin.map(() => 0) : fitted.margin,
      total: selected.authority === "margin_only" ? fitted.total.map(() => 0) : fitted.total };
    const eligibleRows = later.filter(r => Date.parse(r.forecast.asOf) >= Date.parse(head.trainedThrough));
    report.laterBaseline = metrics(eligibleRows); report.laterCandidate = metrics(eligibleRows, head);
    report.laterExcludedModelNotYetAvailable = later.length - eligibleRows.length;
    await writeFile(`${dir}/candidate-r5-joint-head.json`, JSON.stringify(head, null, 2));
    await writeFile(`${dir}/candidate-r5-joint-evaluation-rows.json`, JSON.stringify(eligibleRows.map(r => ({ ...r, candidate: applyCbbMarketHead(r, head) }))));
  }
  await writeFile(`${dir}/market-reader-joint-objective-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ selected: selected ? { penalty: selected.penalty, authority: selected.authority } : null, laterBaseline: report.laterBaseline, laterCandidate: report.laterCandidate }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "joint CBB objective failed"); process.exitCode = 1; });
