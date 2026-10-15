import assert from "node:assert/strict";
import {
  nbaOpeningHomeProbabilityByGame,
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
  }),
  normalizeNbaHistoricalOpeningOdds({
    id: 2,
    game_id: 10,
    vendor: "FanDuel",
    opened_at: "2025-10-20T15:00:00Z",
    moneyline_home_odds: -160,
    moneyline_away_odds: 135,
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

assert.throws(() => nbaOpeningHomeProbabilityByGame({
  rows: [rows[0]!, { ...rows[0]!, rowId: 4 }],
  gameStartById: new Map([[10, "2025-10-21T00:00:00Z"]]),
}), /duplicate/);

console.log("NBA historical opening-market evaluation boundary tests passed.");
