import assert from "node:assert/strict";
import {
  buildMlbCoherentMarketPriceMap,
  inferPoissonMeanFromNoVigTotalPrice,
  splitConflictsWithPriceMap,
  type MlbMarketPriceRow,
} from "../lib/automodel/mlbCoherentMarketPriceMap";
import { computeMarketBaseline } from "../lib/automodel/marketPrior";
import { overProbabilityPoisson, poissonPmf } from "../lib/automodel/runDistribution";
import type { MarketSnapshot, SharpSnapshot } from "../lib/automodel/types";

const asOf = "2026-09-01T20:00:00.000Z";
const rows: MlbMarketPriceRow[] = [
  ...pair("pinnacle", "moneyline", "home", "away", -135, 120, null),
  ...pair("circa", "moneyline", "home", "away", -132, 118, null),
  ...pair("draftkings", "moneyline", "home", "away", -120, 108, null),
  ...pair("fanduel", "moneyline", "home", "away", -118, 106, null),
  ...pair("pinnacle", "total", "over", "under", -135, 115, 8.5),
  ...pair("circa", "total", "over", "under", -130, 110, 8.5),
  ...pair("draftkings", "total", "over", "under", 105, -125, 8.5),
  ...pair("fanduel", "total", "over", "under", 100, -120, 8.5),
];

const priceMap = buildMlbCoherentMarketPriceMap({ rows, listedTotal: 8.5, asOf });
assert.equal(priceMap.moneyline_home.eligible, true);
assert.equal(priceMap.total_over.eligible, true);
assert.equal(priceMap.moneyline_home.sharp_book_count, 2);
assert.equal(priceMap.total_over.retail_book_count, 2);
assert.ok((priceMap.total_over.sharp_retail_gap ?? 0) > 0);

const sharpOver = priceMap.total_over.sharp_no_vig_probability!;
const impliedMean = inferPoissonMeanFromNoVigTotalPrice({
  listedTotal: 8.5,
  overNoVigProbability: sharpOver,
});
assert.ok(impliedMean !== null && impliedMean > 8.5);
assert.ok(Math.abs(overProbabilityPoisson(impliedMean!, 0, 8.5) - sharpOver) < 1e-8);

const integerMean = inferPoissonMeanFromNoVigTotalPrice({
  listedTotal: 8,
  overNoVigProbability: 0.54,
});
assert.ok(integerMean !== null);
const integerOver = overProbabilityPoisson(integerMean!, 0, 8);
const integerNoPush = 1 - poissonPmf(8, integerMean!);
assert.ok(Math.abs(integerOver / integerNoPush - 0.54) < 1e-8);

const alignedSharp: SharpSnapshot = sharpSnapshot({ totalBets: 35, totalMoney: 55 });
const baseline = computeMarketBaseline(marketSnapshot(priceMap), alignedSharp);
assert.equal(baseline.source, "coherent_sharp_retail_price_map");
assert.equal(baseline.coherentMoneylinePriceMapApplied, true);
assert.equal(baseline.coherentTotalPriceMapApplied, true);
assert.ok((baseline.marketExpectedTotal ?? 0) > 8.5);
assert.ok(
  Math.abs(
    (baseline.homeImpliedTotal ?? 0)
      + (baseline.awayImpliedTotal ?? 0)
      - (baseline.marketExpectedTotal ?? 0),
  ) <= 0.11,
  "one-decimal team components retain the inferred scoring environment",
);

const conflictSharp = sharpSnapshot({ totalBets: 60, totalMoney: 40 });
const conflict = computeMarketBaseline(marketSnapshot(priceMap), conflictSharp);
assert.equal(conflict.coherentTotalSplitConflict, true);
assert.equal(conflict.coherentTotalPriceMapApplied, false);
assert.equal(conflict.marketExpectedTotal, 8.5);

assert.equal(splitConflictsWithPriceMap({
  priceMap: priceMap.total_over,
  publicBettingPct: null,
  publicMoneyPct: null,
}), false, "missing splits are neutral rather than a hold");

const thinMap = buildMlbCoherentMarketPriceMap({
  rows: rows.filter((row) => row.sportsbook !== "circa"),
  listedTotal: 8.5,
  asOf,
});
assert.equal(thinMap.total_over.eligible, false);
const thinBaseline = computeMarketBaseline(marketSnapshot(thinMap), sharpSnapshot({}));
assert.equal(thinBaseline.coherentTotalPriceMapApplied, false);
assert.equal(thinBaseline.marketExpectedTotal, 8.5);

const staleMap = buildMlbCoherentMarketPriceMap({
  rows: rows.map((row) => ({ ...row, fetched_at: "2026-09-01T18:29:59.000Z" })),
  listedTotal: 8.5,
  asOf,
});
assert.equal(staleMap.moneyline_home.eligible, false);
assert.equal(staleMap.total_over.ineligible_reason, "stale_price_map");

const boundaryMap = buildMlbCoherentMarketPriceMap({
  rows: rows.map((row) => ({ ...row, fetched_at: "2026-09-01T18:30:00.000Z" })),
  listedTotal: 8.5,
  asOf,
});
assert.equal(boundaryMap.moneyline_home.eligible, true);
assert.equal(boundaryMap.total_over.eligible, true);

const skewedRows = rows.map((row) =>
  row.sportsbook === "circa" && (row.side === "away" || row.side === "under")
    ? { ...row, fetched_at: "2026-09-01T19:50:00.000Z" }
    : row,
);
const skewedMap = buildMlbCoherentMarketPriceMap({
  rows: skewedRows,
  listedTotal: 8.5,
  asOf,
});
assert.equal(skewedMap.moneyline_home.eligible, false, "widely skewed same-book sides are not paired");
assert.equal(skewedMap.total_over.eligible, false, "total pairs also require coherent capture time");

console.log("mlb-coherent-market-price-map: all assertions passed");

function pair(
  sportsbook: string,
  market_type: string,
  selectedSide: string,
  oppositeSide: string,
  selectedOdds: number,
  oppositeOdds: number,
  line_value: number | null,
): MlbMarketPriceRow[] {
  return [
    { market_type, sportsbook, side: selectedSide, line_value, odds_american: selectedOdds, fetched_at: "2026-09-01T19:55:00.000Z" },
    { market_type, sportsbook, side: oppositeSide, line_value, odds_american: oppositeOdds, fetched_at: "2026-09-01T19:55:00.000Z" },
  ];
}

function marketSnapshot(coherent_price_map: MarketSnapshot["coherent_price_map"]): MarketSnapshot {
  return {
    listed_total: 8.5,
    home_ml_odds_american: -120,
    away_ml_odds_american: 108,
    over_odds_american: 105,
    under_odds_american: -125,
    has_pinnacle_total: true,
    coherent_price_map,
  };
}

function sharpSnapshot(args: {
  totalBets?: number;
  totalMoney?: number;
}): SharpSnapshot {
  return {
    pinnacle_ml_fair_prob_home: null,
    pinnacle_ml_fair_prob_away: null,
    pinnacle_total_ev_pct: null,
    pinnacle_ml_ev_pct: null,
    public_betting_pct_home: null,
    public_money_pct_home: null,
    public_betting_pct_over: args.totalBets ?? null,
    public_money_pct_over: args.totalMoney ?? null,
    ml_plus_ev_side: null,
    total_plus_ev_side: null,
  };
}
