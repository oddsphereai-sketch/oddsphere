import assert from "node:assert/strict";
import { MLB_PROP_MARKET_KEYS, type MlbPropMarketKey } from "../lib/mlb/props/config";
import {
  applyMlbPropMarketAwareForecast,
  buildMlbPropMarketContexts,
  marketContextQuoteKey,
  qualifiesMlbPropMarketAwareWatchlist,
  type MlbPropMarketContext,
} from "../lib/mlb/props/marketAwareContext";
import type { PropOddsSnapshot } from "../lib/mlb/props/providers";

const now = "2026-09-01T18:00:00.000Z";
const opened = "2026-09-01T12:00:00.000Z";

function quote(args: {
  market?: MlbPropMarketKey;
  book: string;
  side: "over" | "under";
  line?: number;
  odds: number;
  role?: "opening" | "current";
  player?: string;
  raw?: Record<string, unknown>;
}): PropOddsSnapshot {
  return {
    gameId: "balldontlie-game-1",
    playerId: `balldontlie-player-${args.player ?? "10"}`,
    marketKey: args.market ?? "batter_hits",
    sportsbook: args.book,
    side: args.side,
    line: args.line ?? 1.5,
    americanOdds: args.odds,
    decimalOdds: args.odds > 0 ? 1 + args.odds / 100 : 1 + 100 / -args.odds,
    impliedProbability: args.odds > 0 ? 100 / (args.odds + 100) : -args.odds / (-args.odds + 100),
    asOfTimestamp: args.role === "opening" ? opened : now,
    snapshotRole: args.role ?? "current",
    provider: "balldontlie",
    rawPayload: args.raw ?? {},
  };
}

const current = [
  quote({ book: "draftkings", side: "over", odds: -120 }),
  quote({ book: "draftkings", side: "under", odds: 100 }),
  quote({ book: "fanduel", side: "over", odds: -110 }),
  quote({ book: "fanduel", side: "under", odds: -110 }),
  quote({ book: "caesars", side: "over", odds: 105 }),
  quote({ book: "caesars", side: "under", odds: -125 }),
  ...(["batter_total_bases", "batter_runs_scored"] as const).flatMap((market) => [
    quote({ market, book: "draftkings", side: "over", odds: -130 }),
    quote({ market, book: "draftkings", side: "under", odds: 105 }),
    quote({ market, book: "fanduel", side: "over", odds: -125 }),
    quote({ market, book: "fanduel", side: "under", odds: 100 }),
  ]),
];
const openings = current.map((row) => quote({
  market: row.marketKey,
  book: row.sportsbook,
  side: row.side,
  line: row.line + (row.side === "over" ? 0.5 : 0.5),
  odds: row.side === "over" ? -105 : -115,
  role: "opening",
}));

const contexts = buildMlbPropMarketContexts({ currentOdds: current, openingOdds: openings });
const draftKingsOver = contexts.get(marketContextQuoteKey(current[0]));
assert.ok(draftKingsOver);
assert.equal(draftKingsOver.completePairBooks, 3);
assert.equal(draftKingsOver.targetExcludedBooks, 2);
assert.ok((draftKingsOver.currentOverProbability ?? 0) > 0.49);
assert.ok((draftKingsOver.targetExcludedOverProbability ?? 0) < (draftKingsOver.currentOverProbability ?? 0.5));
assert.ok(draftKingsOver.movementAdjustmentOver < 0, "lower current lines move the latent stat forecast down");
assert.equal(draftKingsOver.relatedMarkets, 2);
assert.ok(draftKingsOver.relatedMovementAdjustmentOver < 0);
assert.equal(draftKingsOver.splitAdjustmentOver, 0, "missing split evidence is neutral");

const noEvidence = buildMlbPropMarketContexts({
  currentOdds: [quote({ book: "draftkings", side: "over", odds: 120 })],
  openingOdds: [],
}).get(marketContextQuoteKey(quote({ book: "draftkings", side: "over", odds: 120 })));
assert.ok(noEvidence);
assert.equal(noEvidence.movementAdjustmentOver, 0);
assert.equal(noEvidence.relatedMovementAdjustmentOver, 0);
assert.equal(noEvidence.splitAdjustmentOver, 0);

const splitCurrent = quote({
  book: "fanduel",
  side: "over",
  odds: 110,
  raw: {
    split_source: "playbook",
    split_updated_at: "2026-09-01T17:30:00.000Z",
    bet_percentage: 42,
    money_percentage: 61,
  },
});
const splitContext = buildMlbPropMarketContexts({ currentOdds: [splitCurrent], openingOdds: [] })
  .get(marketContextQuoteKey(splitCurrent));
assert.ok(splitContext && splitContext.splitAdjustmentOver > 0);

const forecast = applyMlbPropMarketAwareForecast({
  marketKey: "batter_hits",
  line: 1.5,
  independentOverProbability: 0.48,
  independentProjection: 1.42,
  modelWeight: 0.3,
  context: draftKingsOver,
});
assert.equal(Number((forecast.overProbability + forecast.underProbability).toFixed(6)), 1);
assert.notEqual(forecast.overProbability, 0.48);
assert.equal(Math.sign(forecast.projection - 1.42), Math.sign(forecast.overProbability - 0.48));
assert.notEqual(
  forecast.projection,
  Number(forecast.projection.toFixed(2)),
  "authoritative projections retain model precision; member formatting owns display rounding",
);

const valueContext: MlbPropMarketContext = {
  currentOverProbability: 0.18,
  targetExcludedOverProbability: 0.15,
  completePairBooks: 0,
  targetExcludedBooks: 3,
  movementAdjustmentOver: 0.005,
  relatedMovementAdjustmentOver: 0.0025,
  splitAdjustmentOver: 0,
  openingBooks: 2,
  relatedMarkets: 2,
  splitEvidenceRows: 0,
};
assert.equal(qualifiesMlbPropMarketAwareWatchlist({
  side: "over",
  americanOdds: 600,
  overProbability: 0.19,
  context: valueContext,
}), true, "a positive-EV side below 50% can be monitored without becoming actionable");
assert.equal(qualifiesMlbPropMarketAwareWatchlist({
  side: "under",
  americanOdds: -150,
  overProbability: 0.19,
  context: { ...valueContext, movementAdjustmentOver: 0.015, relatedMovementAdjustmentOver: 0.0075 },
}), false, "materially adverse context cannot create a Watchlist");

const memberSupported = MLB_PROP_MARKET_KEYS.filter((market) =>
  market !== "first_home_run" && market !== "pitcher_record_a_win");
for (const market of memberSupported) {
  const categoryForecast = applyMlbPropMarketAwareForecast({
    marketKey: market,
    line: 0.5,
    independentOverProbability: 0.54,
    independentProjection: 0.55,
    modelWeight: 0.5,
    context: { ...valueContext, currentOverProbability: 0.56, targetExcludedOverProbability: 0.5 },
  });
  assert.equal(qualifiesMlbPropMarketAwareWatchlist({
    side: "over",
    americanOdds: 105,
    overProbability: categoryForecast.overProbability,
    context: { ...valueContext, currentOverProbability: 0.56, targetExcludedOverProbability: 0.5 },
  }), true, `${market} retains a coherent value-Watchlist path`);
}

console.log("MLB props market-aware current/opening/cross-market/split and category invariants passed.");
