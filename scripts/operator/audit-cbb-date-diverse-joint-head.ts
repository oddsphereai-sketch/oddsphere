/** Private, read-only chronological comparison of score-error and market-loss objectives. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateCbbMarketReaderRows, type CbbMarketEvaluationRow } from "../../lib/cbb/marketReaderEvaluation";
import { fitCbbJointMarketLogLoss } from "../../lib/cbb/marketReaderResearch";

const dir = resolve(process.argv.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const files = ["market-reader-feature-rows.json", "date-diverse-feature-rows.json", "weekdays-feature-rows.json",
  "saturation-feature-rows.json"];
const rows = files.flatMap(file => JSON.parse(readFileSync(resolve(dir, file), "utf8")) as CbbMarketEvaluationRow[]);
if (rows.length !== 1070 || new Set(rows.map(r => r.game.id)).size !== rows.length) throw new Error("invalid CBB joint cohort");
const early = rows.filter(r => r.game.date < "2026-02-15");
const selection = rows.filter(r => r.game.date >= "2026-02-15" && r.game.date < "2026-03-01");
const later = rows.filter(r => r.game.date >= "2026-03-01");
if (early.length !== 433 || selection.length !== 408 || later.length !== 229) throw new Error("CBB joint chronology changed");
const summary = (items: CbbMarketEvaluationRow[], head?: ReturnType<typeof fitCbbJointMarketLogLoss>) => {
  const r = evaluateCbbMarketReaderRows(items, head);
  return { games: r.score.games, marginMae: r.score.marginMae, totalMae: r.score.totalMae,
    markets: Object.fromEntries(Object.entries(r.markets).map(([market, m]) => [market,
      { wins: m.wins, corrections: m.corrections, harms: m.harms, units: Number(m.hypotheticalOneRiskedUnits.toFixed(2)),
        logLoss: Number(m.logLoss.toFixed(4)) }])) };
};
const candidates = [];
let eligibleSelection: CbbMarketEvaluationRow[] = [];
for (const penalty of [1, 10, 100]) {
  const head = fitCbbJointMarketLogLoss(early, penalty);
  const eligible = selection.filter(r => Date.parse(r.forecast.asOf) >= Date.parse(head.trainedThrough));
  if (!eligibleSelection.length) eligibleSelection = eligible;
  else if (eligible.length !== eligibleSelection.length) throw new Error("CBB joint selection availability changed");
  for (const authority of ["joint", "total_only"] as const) {
    const candidate = authority === "joint" ? head : { ...head, margin: head.margin.map(() => 0) };
    candidates.push({ penalty, authority, selection: summary(eligible, candidate), later: summary(later, candidate) });
  }
}
const refits = [];
for (const penalty of [1, 10, 100]) {
  const head = fitCbbJointMarketLogLoss([...early, ...selection], penalty);
  const eligibleLater = later.filter(r => Date.parse(r.forecast.asOf) >= Date.parse(head.trainedThrough));
  for (const authority of ["joint", "total_only"] as const) {
    const candidate = authority === "joint" ? head : { ...head, margin: head.margin.map(() => 0) };
    refits.push({ penalty, authority, excluded: later.length - eligibleLater.length,
      baseline: summary(eligibleLater), candidate: summary(eligibleLater, candidate) });
  }
}
console.log(JSON.stringify({ scope: "private_1070_exact_opening_joint_market_objective", productionWrites: 0,
  baseline: { selection: summary(eligibleSelection), later: summary(later) }, candidates, refits,
  limitations: "Previously opened one-season retrospective cohort; opening prices only, no movement or splits replay." }, null, 2));
