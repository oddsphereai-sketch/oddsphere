/** Private chronological market-head falsification. Never writes a live score or release. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateCbbRows } from "../../lib/cbb/evaluation";
import { reviewCbbQuote } from "../../lib/cbb/marketEvidence";
import { settleCbbMarket } from "../../lib/cbb/model";
import { applyCbbMarketHead, fitCbbMarketHead } from "../../lib/cbb/marketReaderResearch";
import { assertCbbR2ResearchCohort } from "../../lib/cbb/researchCohort";
import type { CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import type { CbbMarket, CbbQuote } from "../../lib/cbb/types";

type Row = CbbScoreFeatureRow & { targets: CbbQuote[] };
const dir = resolve(process.argv.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const files = ["market-reader-feature-rows.json", "date-diverse-feature-rows.json", "weekdays-feature-rows.json",
  "saturation-feature-rows.json"];
const rows = files.flatMap(file => JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Row[]);
const sourceByGame = new Map<number, string>(files.flatMap(file =>
  (JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Row[]).map(row => [row.game.id, file] as const)));
if (rows.length !== 1070 || new Set(rows.map(r => r.game.id)).size !== rows.length) throw new Error("invalid CBB date-diverse score cohort");
assertCbbR2ResearchCohort(rows);
const early = rows.filter(r => r.game.date < "2026-02-15"),
  selection = rows.filter(r => r.game.date >= "2026-02-15" && r.game.date < "2026-03-01"),
  later = rows.filter(r => r.game.date >= "2026-03-01");
if (early.length !== 433 || selection.length !== 408 || later.length !== 229) throw new Error("CBB score chronology changed");
const markets: CbbMarket[] = ["moneyline", "spread", "total"];
function metrics(items: Row[]) {
  const score = evaluateCbbRows(items);
  const byMarket = Object.fromEntries(markets.map(market => {
    const outcomes = items.map(row => {
      const q = row.targets.find(quote => quote.market === market);
      if (!q || q.gameId !== row.game.id || Date.parse(q.providerObservedAt) > Date.parse(row.forecast.asOf))
        throw new Error(`invalid CBB target ${row.game.id}/${market}`);
      const review = reviewCbbQuote(row.forecast, q), result = settleCbbMarket(market, review.selection as "first" | "second", q.line,
        row.game.homeScore, row.game.awayScore);
      const price = review.selection === "first" ? q.firstPrice : q.secondPrice;
      return { result, units: result === "push" ? 0 : result === "loss" ? -1 : price > 0 ? price / 100 : 100 / -price };
    });
    return [market, { wins: outcomes.filter(o => o.result === "win").length,
      losses: outcomes.filter(o => o.result === "loss").length, pushes: outcomes.filter(o => o.result === "push").length,
      units: Number(outcomes.reduce((sum, o) => sum + o.units, 0).toFixed(2)) }];
  }));
  return { games: score.games, wins: score.wins, brier: Number(score.brier.toFixed(4)),
    marginMae: Number(score.marginMae.toFixed(2)), totalMae: Number(score.totalMae.toFixed(2)), byMarket };
}
function totalFlipDiagnostics(baseline: Row[], candidate: Row[]) {
  if (baseline.length !== candidate.length) throw new Error("CBB diagnostic cohort mismatch");
  const byDate = new Map<string, { corrected: number; harmed: number; unchanged: number }>();
  const bySource = new Map<string, { corrected: number; harmed: number; unchanged: number }>();
  const flips: Array<{ gameId: number; date: string; baseline: string; candidate: string; actual: string;
    line: number; correction: number; result: "corrected" | "harmed" }> = [];
  let corrected = 0, harmed = 0, unchanged = 0;
  for (let i = 0; i < baseline.length; i++) {
    const a = baseline[i], b = candidate[i];
    if (a.game.id !== b.game.id) throw new Error("CBB diagnostic game mismatch");
    const q = a.targets.find(quote => quote.market === "total");
    if (!q || q.line === null) throw new Error("CBB diagnostic target missing");
    const first = reviewCbbQuote(a.forecast, q).selection;
    const second = reviewCbbQuote(b.forecast, q).selection;
    const actual = a.game.homeScore + a.game.awayScore > q.line ? "first" :
      a.game.homeScore + a.game.awayScore < q.line ? "second" : "push";
    const date = a.game.date.slice(0, 10);
    const source = sourceByGame.get(a.game.id);
    if (!source) throw new Error("CBB diagnostic source missing");
    const count = byDate.get(date) ?? { corrected: 0, harmed: 0, unchanged: 0 };
    const sourceCount = bySource.get(source) ?? { corrected: 0, harmed: 0, unchanged: 0 };
    if (first === second || actual === "push") { unchanged++; count.unchanged++; sourceCount.unchanged++; }
    else {
      const result = second === actual ? "corrected" : "harmed";
      if (result === "corrected") { corrected++; count.corrected++; sourceCount.corrected++; }
      else { harmed++; count.harmed++; sourceCount.harmed++; }
      flips.push({ gameId: a.game.id, date, baseline: first, candidate: second, actual,
        line: q.line, correction: Number((b.forecast.total - a.forecast.total).toFixed(2)), result });
    }
    byDate.set(date, count);
    bySource.set(source, sourceCount);
  }
  return { corrected, harmed, unchanged, flips, byDate: Object.fromEntries(byDate), bySource: Object.fromEntries(bySource) };
}
const totalTreeRoots = (head: ReturnType<typeof fitCbbMarketHead>) => head.trees?.total.trees.reduce<Record<string, number>>((count, tree) => {
  const feature = "feature" in tree ? String(tree.feature) : "leaf";
  count[feature] = (count[feature] ?? 0) + 1;
  return count;
}, {}) ?? null;
const report: Record<string, unknown> = { scope: "private_1070_exact_opening_chronological_market_head",
  productionWrites: 0, training: early.length, selection: selection.length, later: later.length,
  caveat: "Retrospective one-season cohort; no untouched prospective holdout or live market movement/splits." };
const candidates = [];
let eligibleSelection: Row[] = [];
for (const option of [{ penalty: 10 }, { penalty: 100 }, { penalty: 1000 }, { rounds: 40 }, { rounds: 80 }]) {
  const full = fitCbbMarketHead(early, option);
  const eligible = selection.filter(row => Date.parse(row.forecast.asOf) >= Date.parse(full.trainedThrough));
  if (!eligibleSelection.length) eligibleSelection = eligible;
  else if (eligible.length !== eligibleSelection.length) throw new Error("CBB market-head availability changed by penalty");
  for (const mode of ["full", "total_only"] as const) {
    const apply = (items: Row[]) => items.map(row => {
      const candidate = applyCbbMarketHead(row, full);
      const forecast = mode === "full" ? candidate : { ...row.forecast, total: candidate.total,
        homeScore: (candidate.total + row.forecast.margin) / 2,
        awayScore: (candidate.total - row.forecast.margin) / 2 };
      return { ...row, forecast };
    });
    const selectionMetrics = metrics(apply(eligible)), laterMetrics = metrics(apply(later));
    candidates.push({ option, mode, totalTreeRoots: totalTreeRoots(full), selection: selectionMetrics, later: laterMetrics,
      ...(mode === "total_only" ? { selectionFlips: totalFlipDiagnostics(eligible, apply(eligible)),
        laterFlips: totalFlipDiagnostics(later, apply(later)) } : {}) });
  }
}
report.baseline = { selection: metrics(eligibleSelection), later: metrics(later),
  selectionExcludedBeforeHeadAvailable: selection.length - eligibleSelection.length };
report.candidates = candidates;
report.postSelectionRefit = [{ penalty: 1000 }, { rounds: 40 }, { rounds: 80 }].map(option => {
  const head = fitCbbMarketHead([...early, ...selection], option);
  const eligibleLater = later.filter(row => Date.parse(row.forecast.asOf) >= Date.parse(head.trainedThrough));
  const candidate = eligibleLater.map(row => {
    const market = applyCbbMarketHead(row, head);
    return { ...row, forecast: { ...row.forecast, total: market.total,
      homeScore: (market.total + row.forecast.margin) / 2,
      awayScore: (market.total - row.forecast.margin) / 2 } };
  });
  return { option, trainedThrough: head.trainedThrough, totalTreeRoots: totalTreeRoots(head),
    excludedBeforeHeadAvailable: later.length - eligibleLater.length,
    baseline: metrics(eligibleLater), candidate: metrics(candidate),
    flips: totalFlipDiagnostics(eligibleLater, candidate) };
});
console.log(JSON.stringify(report, null, 2));
