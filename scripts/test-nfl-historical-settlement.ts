import assert from "node:assert/strict";
import {
  canonicalHomeSpreadLine,
  settleHistoricalMarket,
} from "./operator/nfl-historical-settlement";

assert.equal(canonicalHomeSpreadLine({
  selectedLine: -3.5,
  selectedTeam: "PHI",
  homeTeam: "PHI",
  awayTeam: "CHI",
}), -3.5);
assert.equal(canonicalHomeSpreadLine({
  selectedLine: 3.5,
  selectedTeam: "CHI",
  homeTeam: "PHI",
  awayTeam: "CHI",
}), -3.5, "an away +3.5 selection must remain a home -3.5 market");
assert.throws(() => canonicalHomeSpreadLine({
  selectedLine: 3.5,
  selectedTeam: "DAL",
  homeTeam: "PHI",
  awayTeam: "CHI",
}), /unknown team/);

assert.equal(settleHistoricalMarket({
  market: "spread",
  side: -1,
  actualHome: 24,
  actualAway: 21,
  canonicalLine: -3.5,
}), "win");
assert.equal(settleHistoricalMarket({
  market: "spread",
  side: 1,
  actualHome: 24,
  actualAway: 21,
  canonicalLine: -3.5,
  cushion: 3,
}), "win");
assert.equal(settleHistoricalMarket({
  market: "total",
  side: -1,
  actualHome: 24,
  actualAway: 21,
  canonicalLine: 44,
  cushion: 3,
}), "win", "an under teased by three points should win at 45 against 47");
assert.equal(settleHistoricalMarket({
  market: "total",
  side: 1,
  actualHome: 24,
  actualAway: 21,
  canonicalLine: 48,
  cushion: 3,
}), "push");

console.log("NFL historical settlement tests passed");
