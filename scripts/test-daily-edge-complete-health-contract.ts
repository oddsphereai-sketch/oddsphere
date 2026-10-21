import assert from "node:assert/strict";
import {
  certifyDailyEdgeCompleteHealth,
  DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS,
} from "../lib/services/dailyEdge/dailyEdgeCompleteHealthContract";

assert.deepEqual(Object.keys(DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS).sort(), ["cfb", "mlb", "nba", "nfl", "nhl", "soccer", "wnba"]);
for (const contract of Object.values(DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS)) {
  assert.ok(contract.expectedMarkets.length >= 3, `${contract.sport} declares all principal prediction markets`);
  assert.equal(new Set(contract.dimensions).size, 11, `${contract.sport} cannot silently omit a health dimension`);
  assert.ok(contract.availabilityAuthorities.length > 0, `${contract.sport} declares an availability authority`);
}

const completeCoverage = Object.fromEntries(DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS.nfl.dimensions.map((dimension) => [dimension, 2]));
assert.equal(certifyDailyEdgeCompleteHealth({ sport: "nfl", activeGames: 2, dimensionCoverage: completeCoverage }).status, "green");
assert.deepEqual(certifyDailyEdgeCompleteHealth({
  sport: "nfl",
  activeGames: 2,
  dimensionCoverage: { ...completeCoverage, same_book_opening_current_trail: 1 },
}).failedDimensions, ["same_book_opening_current_trail"]);
assert.deepEqual(certifyDailyEdgeCompleteHealth({
  sport: "cfb",
  activeGames: 2,
  dimensionCoverage: Object.fromEntries(DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS.cfb.dimensions.map((dimension) => [dimension, 2])),
  configuredEnvironment: { SPORTSDATAIO_CFB_API_KEY: false },
}).missingCredentials, ["SPORTSDATAIO_CFB_API_KEY"]);
assert.equal(certifyDailyEdgeCompleteHealth({ sport: "mlb", activeGames: 0, dimensionCoverage: {} }).status, "inactive");

console.log("Daily Edge complete-health contract tests passed.");
