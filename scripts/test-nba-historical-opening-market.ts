import assert from "node:assert/strict";
import {
  nbaOpeningHomeProbabilityByGame,
  nbaOpeningMarketByGame,
  normalizeNbaHistoricalOpeningOdds,
} from "../lib/services/nba/nbaHistoricalOpeningMarket";

const rows = [
  normalizeNbaHistoricalOpeningOdds({
    id: 1,
    game_id: 10,
    vendor: "DraftKings",
    opened_at: "2025-10-20T14:00:00Z",
    moneyline_home_odds: -150,
    moneyline_away_odds: 130,
    spread_home_value: "-4.5",
    spread_home_odds: -110,
    spread_away_value: "4.5",
    spread_away_odds: -110,
    total_value: "224.5",
    total_over_odds: -112,
    total_under_odds: -108,
  }),
  normalizeNbaHistoricalOpeningOdds({
    id: 2,
    game_id: 10,
    vendor: "FanDuel",
    opened_at: "2025-10-20T15:00:00Z",
    moneyline_home_odds: -160,
    moneyline_away_odds: 135,
    spread_home_value: "-5.5",
    spread_home_odds: -105,
    spread_away_value: "5.5",
    spread_away_odds: -115,
    total_value: "225.5",
    total_over_odds: -110,
    total_under_odds: -110,
  }),
  normalizeNbaHistoricalOpeningOdds({
    id: 4,
    game_id: 10,
    vendor: "BetMGM",
    opened_at: "2025-10-20T16:00:00Z",
    moneyline_home_odds: -155,
    moneyline_away_odds: 132,
    spread_home_value: "-4.5",
    spread_home_odds: -108,
    spread_away_value: "4.5",
    spread_away_odds: -112,
    total_value: "224.5",
    total_over_odds: -105,
    total_under_odds: -115,
  }),
  normalizeNbaHistoricalOpeningOdds({
    id: 3,
    game_id: 11,
    vendor: "DraftKings",
    opened_at: "2025-10-22T01:01:00Z",
    moneyline_home_odds: -500,
    moneyline_away_odds: 350,
  }),
];
const result = nbaOpeningHomeProbabilityByGame({
  rows,
  gameStartById: new Map([
    [10, "2025-10-21T00:00:00Z"],
    [11, "2025-10-22T01:00:00Z"],
  ]),
});
assert.equal(result.size, 1, "post-tip odds must not become a pregame evaluation label");
assert.ok((result.get(10) ?? 0) > 0.58 && (result.get(10) ?? 0) < 0.62);

const markets = nbaOpeningMarketByGame({
  rows,
  gameStartById: new Map([
    [10, "2025-10-21T00:00:00Z"],
    [11, "2025-10-22T01:00:00Z"],
  ]),
});
assert.equal(markets.get(10)?.homeSpread, -4.5, "the most-supported exact spread line must win");
assert.equal(markets.get(10)?.total, 224.5, "the most-supported exact total line must win");
assert.ok((markets.get(10)?.homeCoverProbability ?? 0) > 0.48);
assert.ok((markets.get(10)?.overProbability ?? 0) < 0.51);
assert.equal(markets.get(10)?.homeMoneylinePrice, -150);
assert.equal(markets.get(10)?.awayMoneylinePrice, 135);
assert.equal(markets.get(10)?.homeSpreadPrice, -108);
assert.equal(markets.get(10)?.awaySpreadPrice, -110);
assert.equal(markets.get(10)?.overPrice, -105);
assert.equal(markets.get(10)?.underPrice, -108);
assert.equal(markets.has(11), false, "post-tip rows must be rejected for every market");

assert.throws(() => nbaOpeningHomeProbabilityByGame({
  rows: [rows[0]!, { ...rows[0]!, rowId: 4 }],
  gameStartById: new Map([[10, "2025-10-21T00:00:00Z"]]),
}), /duplicate/);

console.log("NBA historical opening-market evaluation boundary tests passed.");
