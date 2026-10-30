/** Frozen private r18 replay. No provider calls, grade changes, or production writes. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateCbbRows } from "../../lib/cbb/evaluation";
import { reviewCbbQuote } from "../../lib/cbb/marketEvidence";
import { cbbThresholdProbabilities, settleCbbMarket } from "../../lib/cbb/model";
import { applyCbbMarketHead, buildCbbMarketReaderFeatures, CBB_EXACT_CENTER_RESEARCH_RELEASE,
  fitCbbMarketHead, type CbbReaderQuote } from "../../lib/cbb/marketReaderResearch";
import { assertCbbR2ResearchCohort } from "../../lib/cbb/researchCohort";
import type { CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import type { CbbMarket, CbbQuote } from "../../lib/cbb/types";

type Row = CbbScoreFeatureRow & { targets: CbbQuote[]; evidence: CbbReaderQuote[] };
const dir = resolve(process.argv.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const files = ["market-reader-feature-rows.json", "date-diverse-feature-rows.json", "weekdays-feature-rows.json",
  "saturation-feature-rows.json"];
const original = files.flatMap(file => JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Row[]);
assertCbbR2ResearchCohort(original);
if (original.length !== 1070) throw new Error("CBB r18 predeclared cohort changed");
const exact = original.map(row => {
  if (row.targets.length !== 3 || new Set(row.targets.map(q => q.market)).size !== 3 ||
    new Set(row.targets.map(q => q.sportsbook)).size !== 1) throw new Error("CBB r18 target bundle changed");
  const targetBook = row.targets[0].sportsbook;
  const old = buildCbbMarketReaderFeatures(row.forecast, row.evidence, targetBook, { archiveReplay: true });
  if (old.features.some((value, i) => Math.abs(value - row.features[i]) > 1e-10)) {
    throw new Error(`CBB r18 cannot reproduce old context: ${row.game.id}`);
  }
  const context = buildCbbMarketReaderFeatures(row.forecast, row.evidence, targetBook,
    { archiveReplay: true, centerMethod: "exact" });
  if (context.retained.length !== old.retained.length || context.rejected.length !== old.rejected.length) {
    throw new Error(`CBB r18 changed evidence coverage: ${row.game.id}`);
  }
  return { ...row, features: context.features, context };
});
const early = (rows: Row[]) => rows.filter(r => r.game.date < "2026-02-15");
const selection = (rows: Row[]) => rows.filter(r => r.game.date >= "2026-02-15" && r.game.date < "2026-03-01");
const later = (rows: Row[]) => rows.filter(r => r.game.date >= "2026-03-01");
if (early(exact).length !== 433 || selection(exact).length !== 408 || later(exact).length !== 229) {
  throw new Error("CBB r18 chronology changed");
}
const markets: CbbMarket[] = ["moneyline", "spread", "total"];
function summary(rows: Row[], baseline: Row[]) {
  if (rows.length !== baseline.length || rows.some((row, i) => row.game.id !== baseline[i].game.id)) {
    throw new Error("CBB r18 paired rows changed");
  }
  const score = evaluateCbbRows(rows);
  const market = Object.fromEntries(markets.map(name => {
    const count = { wins: 0, losses: 0, pushes: 0, units: 0, corrections: 0, harms: 0, brier: 0, logLoss: 0 };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], quote = row.targets.find(q => q.market === name);
      if (!quote || quote.gameId !== row.game.id || Date.parse(quote.providerObservedAt) > Date.parse(row.forecast.asOf)) {
        throw new Error(`CBB r18 invalid target ${row.game.id}/${name}`);
      }
      const reviewed = reviewCbbQuote(row.forecast, quote), before = reviewCbbQuote(baseline[i].forecast, quote);
      const result = settleCbbMarket(name, reviewed.selection as "first" | "second", quote.line, row.game.homeScore, row.game.awayScore);
      const old = settleCbbMarket(name, before.selection as "first" | "second", quote.line, row.game.homeScore, row.game.awayScore);
      count.wins += Number(result === "win"); count.losses += Number(result === "loss"); count.pushes += Number(result === "push");
      count.corrections += Number(old === "loss" && result === "win");
      count.harms += Number(old === "win" && result === "loss");
      const price = reviewed.selection === "first" ? quote.firstPrice : quote.secondPrice;
      count.units += result === "push" ? 0 : result === "loss" ? -1 : price > 0 ? price / 100 : 100 / -price;
      if (result !== "push") {
        const p = cbbThresholdProbabilities(row.forecast, name, quote.line);
        const first = p.first / (p.first + p.second);
        const actual = name === "total" ? row.game.homeScore + row.game.awayScore - quote.line! :
          row.game.homeScore - row.game.awayScore + (name === "spread" ? quote.line! : 0);
        const y = Number(actual > 0), safe = Math.max(1e-9, Math.min(1 - 1e-9, first));
        count.brier += (safe - y) ** 2;
        count.logLoss -= y * Math.log(safe) + (1 - y) * Math.log(1 - safe);
      }
    }
    const settled = count.wins + count.losses;
    return [name, { ...count, units: Number(count.units.toFixed(2)), brier: Number((count.brier / settled).toFixed(4)),
      logLoss: Number((count.logLoss / settled).toFixed(4)) }];
  }));
  return { games: rows.length, winnerAccuracy: Number(score.accuracy.toFixed(4)),
    marginMae: Number(score.marginMae.toFixed(3)), totalMae: Number(score.totalMae.toFixed(3)),
    markets: market };
}
const applyHead = (rows: Row[], head: ReturnType<typeof fitCbbMarketHead>) => rows.map(row =>
  ({ ...row, forecast: applyCbbMarketHead(row, head) }));
const centerDiagnostics = (() => {
  const sums = { moneyline: 0, spread: 0, total: 0 };
  let canonicalSpreadChanges = 0, canonicalSpreadCorrections = 0, canonicalSpreadHarms = 0;
  let legacySignDisagreements = 0;
  for (let i = 0; i < original.length; i++) {
    const a = original[i], b = exact[i];
    if (a.game.id !== b.game.id) throw new Error("CBB r18 center pair mismatch");
    sums.moneyline += 10 * Math.abs(a.features[5] - b.features[5]);
    sums.spread += 10 * Math.abs(a.features[4] - b.features[4]);
    sums.total += 20 * Math.abs(a.features[6] - b.features[6]);
    const quote = a.targets.find(q => q.market === "spread");
    if (!quote || quote.line === null) throw new Error("CBB r18 Spread quote missing");
    const oldCenter = a.forecast.margin + 10 * a.features[4];
    const exactCenter = b.forecast.margin + 10 * b.features[4];
    const oldSide = reviewCbbQuote({ ...a.forecast, margin: oldCenter }, quote).selection as "first" | "second";
    const exactSide = reviewCbbQuote({ ...b.forecast, margin: exactCenter }, quote).selection as "first" | "second";
    const signedSide = oldCenter + quote.line > 0 ? "first" : "second";
    legacySignDisagreements += Number(signedSide !== oldSide);
    if (oldSide !== exactSide) {
      canonicalSpreadChanges++;
      const oldResult = settleCbbMarket("spread", oldSide, quote.line, a.game.homeScore, a.game.awayScore);
      const exactResult = settleCbbMarket("spread", exactSide, quote.line, a.game.homeScore, a.game.awayScore);
      canonicalSpreadCorrections += Number(oldResult === "loss" && exactResult === "win");
      canonicalSpreadHarms += Number(oldResult === "win" && exactResult === "loss");
    }
  }
  return { medianReferenceCenterMeanAbsoluteChange: Object.fromEntries(Object.entries(sums).map(([market, sum]) =>
    [market, Number((sum / original.length).toFixed(4))])), canonicalSpreadChanges,
    canonicalSpreadCorrections, canonicalSpreadHarms, legacySignDisagreements };
})();
const oldHead = fitCbbMarketHead(early(original), { rounds: 40 });
const exactHead = fitCbbMarketHead(early(exact), { rounds: 40, release: CBB_EXACT_CENTER_RESEARCH_RELEASE });
const selectOld = selection(original).filter(row => Date.parse(row.forecast.asOf) >= Date.parse(oldHead.trainedThrough));
const selectExact = selection(exact).filter(row => Date.parse(row.forecast.asOf) >= Date.parse(exactHead.trainedThrough));
const laterOld = later(original), laterExact = later(exact);
const oldRefit = fitCbbMarketHead([...early(original), ...selection(original)], { rounds: 40 });
const exactRefit = fitCbbMarketHead([...early(exact), ...selection(exact)],
  { rounds: 40, release: CBB_EXACT_CENTER_RESEARCH_RELEASE });
const laterRefitOld = laterOld.filter(row => Date.parse(row.forecast.asOf) >= Date.parse(oldRefit.trainedThrough));
const laterRefitExact = laterExact.filter(row => Date.parse(row.forecast.asOf) >= Date.parse(exactRefit.trainedThrough));
const report = { scope: "private_opened_exact_opening_r18", productionWrites: 0, providerCalls: 0,
  caveat: "One opened season, heterogeneous target-opening cutoffs, stale reference openings, no movement/splits or Owls-source parity.",
  train: early(exact).length, centerDiagnostics,
  selection: { baseline: summary(selectOld, selectOld), oldHead: summary(applyHead(selectOld, oldHead), selectOld),
    exactHead: summary(applyHead(selectExact, exactHead), selectExact) },
  later: { baseline: summary(laterOld, laterOld), oldHead: summary(applyHead(laterOld, oldHead), laterOld),
    exactHead: summary(applyHead(laterExact, exactHead), laterExact) },
  postSelectionRefit: { baseline: summary(laterRefitOld, laterRefitOld),
    oldHead: summary(applyHead(laterRefitOld, oldRefit), laterRefitOld),
    exactHead: summary(applyHead(laterRefitExact, exactRefit), laterRefitExact) } };
console.log(JSON.stringify(report));
