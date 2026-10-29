/** Private read-only grade diagnostic. Never emits a Best Angle, Lean, stake or pick change. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cbbThresholdProbabilities, normalCdf, settleCbbMarket } from "../../lib/cbb/model";
import { reviewCbbQuote } from "../../lib/cbb/marketEvidence";
import type { CbbForecast, CbbQuote, CbbTrainingGame } from "../../lib/cbb/types";

type Row = { game: CbbTrainingGame; forecast: CbbForecast; targets: CbbQuote[];
  context: { centers: Record<"moneyline" | "spread" | "total", number[]> } };
const dir = resolve(process.argv.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const rows = JSON.parse(readFileSync(resolve(dir, "market-reader-feature-rows.json"), "utf8")) as Row[];
const markets = ["moneyline", "spread", "total"] as const;
const periods = {
  early: (date: string) => date < "2026-02-15",
  selection: (date: string) => date >= "2026-02-21" && date < "2026-03-01",
  later: (date: string) => date >= "2026-03-01",
};
const summarize = (samples: Array<{ date: string; ev: number; confidence: number; units: number; result: string }>) => ({
  bets: samples.length, wins: samples.filter(row => row.result === "win").length,
  losses: samples.filter(row => row.result === "loss").length,
  pushes: samples.filter(row => row.result === "push").length,
  gameDaysWithPick: new Set(samples.map(row => row.date)).size,
  units: Number(samples.reduce((sum, row) => sum + row.units, 0).toFixed(2)),
  meanModelEv: samples.length ? Number((samples.reduce((sum, row) => sum + row.ev, 0) / samples.length).toFixed(3)) : null,
  meanModelConfidence: samples.length ? Number((samples.reduce((sum, row) => sum + row.confidence, 0) / samples.length).toFixed(3)) : null,
});
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
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
  // Freeze a distributional cut from the earliest block before inspecting later outcomes.
  // This is a diagnostic ranking boundary, not a proposed Best Angle threshold.
  const earlyEv = rows.filter(row => periods.early(row.game.date)).map(row => {
    const quote = row.targets.find(item => item.market === market);
    if (!quote) throw new Error(`missing early ${market} target`);
    return reviewCbbQuote(row.forecast, quote).expectedValue;
  }).sort((a, b) => a - b);
  const earlyHighEvCut = earlyEv[Math.floor(earlyEv.length * 2 / 3)];
  const earlyConfidence = rows.filter(row => periods.early(row.game.date)).map(row => {
    const quote = row.targets.find(item => item.market === market)!;
    return reviewCbbQuote(row.forecast, quote).probability;
  }).sort((a, b) => a - b);
  const earlyHighConfidenceCut = earlyConfidence[Math.floor(earlyConfidence.length * 2 / 3)];
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
      const centers = row.context.centers[market];
      const referenceEdge = centers.length ? median(centers) + (market === "spread" ? quote.line! : market === "total" ? -quote.line! : 0) : null;
      const referenceAgreement = referenceEdge === null || referenceEdge === 0 ? "unavailable_or_tied" :
        (referenceEdge > 0) === (selection === "first") ? "agrees" : "opposes";
      let referenceEv: number | null = null;
      if (referenceEdge !== null) {
        const center = median(centers);
        const sd = row.forecast.uncertainty.marginSd;
        const zero = normalCdf((0.5 - center) / sd) - normalCdf((-0.5 - center) / sd);
        const referenceForecast = { ...row.forecast,
          margin: market === "total" ? row.forecast.margin : center,
          total: market === "total" ? center : row.forecast.total,
          homeWinProbability: (1 - normalCdf((0.5 - center) / sd)) / (1 - zero),
        };
        const probabilities = cbbThresholdProbabilities(referenceForecast, market, quote.line);
        const p = selection === "first" ? probabilities.first : probabilities.second;
        const lose = selection === "first" ? probabilities.second : probabilities.first;
        referenceEv = p * (price > 0 ? price / 100 : 100 / -price) - lose;
      }
      return { date: row.game.date.slice(0, 10), ev: review.expectedValue, confidence: review.probability, result, referenceAgreement, referenceEv, price,
        units: result === "push" ? 0 : result === "loss" ? -1 : price > 0 ? price / 100 : 100 / -price };
    });
    const ranked = [...samples].sort((a, b) => a.ev - b.ev);
    const rankedConfidence = [...samples].sort((a, b) => a.confidence - b.confidence);
    const third = Math.floor(ranked.length / 3);
    const high = ranked.slice(2 * third);
    const forwardHigh = samples.filter(row => row.ev >= Math.max(0, earlyHighEvCut));
    const unapprovedBestAngle = samples.filter(row => market === "moneyline" ?
      row.ev > 0 && row.price >= -250 : row.ev >= Math.max(0, earlyHighEvCut) && row.referenceAgreement === "agrees");
    const bestSet = new Set(unapprovedBestAngle);
    const unapprovedLean = samples.filter(row => !bestSet.has(row) && (market === "moneyline" ?
      row.confidence >= earlyHighConfidenceCut && row.price >= -250 : row.ev > 0 && row.referenceAgreement === "agrees"));
    byPeriod[period] = { all: summarize(samples), lowestModelEvThird: summarize(ranked.slice(0, third)),
      middleModelEvThird: summarize(ranked.slice(third, 2 * third)), highestModelEvThird: summarize(high),
      highEvWithMarketAgreement: summarize(high.filter(row => row.referenceAgreement === "agrees")),
      highEvAgainstMarket: summarize(high.filter(row => row.referenceAgreement === "opposes")),
      highEvNoReference: summarize(high.filter(row => row.referenceAgreement === "unavailable_or_tied")),
      steepFavoriteHighEv: summarize(high.filter(row => row.price <= -250)),
      highestModelConfidenceThird: summarize(rankedConfidence.slice(2 * third)),
      positiveEvPriceNoSteeperThanMinus250: summarize(samples.filter(row => row.ev > 0 && row.price >= -250)),
      fixedEarlyEvCutAll: summarize(forwardHigh),
      fixedEarlyEvCutMarketAgrees: summarize(forwardHigh.filter(row => row.referenceAgreement === "agrees")),
      fixedEarlyEvCutMarketOpposes: summarize(forwardHigh.filter(row => row.referenceAgreement === "opposes")),
      positiveEvBothIndependentAndReference: summarize(samples.filter(row => row.ev > 0 && row.referenceEv !== null && row.referenceEv > 0)),
      positiveIndependentEvReferenceUnfavorable: summarize(samples.filter(row => row.ev > 0 && row.referenceEv !== null && row.referenceEv <= 0)),
      unapprovedSimpleGradeProbe: { bestAngle: summarize(unapprovedBestAngle), lean: summarize(unapprovedLean),
        watchlistOrNoPlay: summarize(samples.filter(row => !bestSet.has(row) && !unapprovedLean.includes(row))) },
    };
  }
  byMarket[market] = { earlyHighEvCut: Number(earlyHighEvCut.toFixed(4)), earlyHighConfidenceCut: Number(earlyHighConfidenceCut.toFixed(4)), periods: byPeriod };
}
console.log(JSON.stringify(report, null, 2));
