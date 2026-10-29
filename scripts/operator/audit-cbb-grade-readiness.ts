/** Private read-only grade diagnostic. Never emits a Best Angle, Lean, stake or pick change. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { settleCbbMarket } from "../../lib/cbb/model";
import { reviewCbbQuote } from "../../lib/cbb/marketEvidence";
import type { CbbForecast, CbbQuote, CbbTrainingGame } from "../../lib/cbb/types";

type Row = { game: CbbTrainingGame; forecast: CbbForecast; targets: CbbQuote[] };
const dir = resolve(process.argv.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const rows = JSON.parse(readFileSync(resolve(dir, "market-reader-feature-rows.json"), "utf8")) as Row[];
const markets = ["moneyline", "spread", "total"] as const;
const periods = {
  early: (date: string) => date < "2026-02-15",
  selection: (date: string) => date >= "2026-02-21" && date < "2026-03-01",
  later: (date: string) => date >= "2026-03-01",
};
const summarize = (samples: Array<{ ev: number; confidence: number; units: number; result: string }>) => ({
  bets: samples.length, wins: samples.filter(row => row.result === "win").length,
  losses: samples.filter(row => row.result === "loss").length,
  pushes: samples.filter(row => row.result === "push").length,
  units: Number(samples.reduce((sum, row) => sum + row.units, 0).toFixed(2)),
  meanModelEv: samples.length ? Number((samples.reduce((sum, row) => sum + row.ev, 0) / samples.length).toFixed(3)) : null,
  meanModelConfidence: samples.length ? Number((samples.reduce((sum, row) => sum + row.confidence, 0) / samples.length).toFixed(3)) : null,
});
if (rows.length !== 353 || new Set(rows.map(row => `${row.game.id}|${row.forecast.asOf}`)).size !== rows.length)
  throw new Error("CBB exact-opening cohort changed; requalify grade audit");
const report: Record<string, unknown> = {
  scope: "private_opened_2025_season_exact_opening_quotes_only", productionWrites: 0,
  decision: "diagnostic_only_no_grade_or_stake_policy_approved",
  caveat: "This opened retrospective cohort and its existing forecasts are not an untouched holdout or a current-season prospective grade record. Tertiles describe discrimination; they are not promotion thresholds.",
  byMarket: {},
};
const byMarket = report.byMarket as Record<string, unknown>;
for (const market of markets) {
  const byPeriod: Record<string, unknown> = {};
  for (const [period, include] of Object.entries(periods)) {
    const samples = rows.filter(row => include(row.game.date)).map(row => {
      const quote = row.targets.find(item => item.market === market);
      if (!quote || quote.gameId !== row.game.id || Date.parse(quote.providerObservedAt) > Date.parse(row.forecast.asOf))
        throw new Error(`missing or future ${market} target for ${row.game.id}`);
      const review = reviewCbbQuote(row.forecast, quote);
      const selection = review.selection === "first" ? "first" : "second";
      const result = settleCbbMarket(market, selection, quote.line, row.game.homeScore, row.game.awayScore);
      const price = review.selection === "first" ? quote.firstPrice : quote.secondPrice;
      return { ev: review.expectedValue, confidence: review.probability, result,
        units: result === "push" ? 0 : result === "loss" ? -1 : price > 0 ? price / 100 : 100 / -price };
    });
    const ranked = [...samples].sort((a, b) => a.ev - b.ev);
    const third = Math.floor(ranked.length / 3);
    byPeriod[period] = { all: summarize(samples), lowestModelEvThird: summarize(ranked.slice(0, third)),
      middleModelEvThird: summarize(ranked.slice(third, 2 * third)), highestModelEvThird: summarize(ranked.slice(2 * third)) };
  }
  byMarket[market] = byPeriod;
}
console.log(JSON.stringify(report, null, 2));
