import assert from "node:assert/strict";

import {
  MARKET_BRAIN_ACTIVE_PRODUCT_KEYS,
  MARKET_BRAIN_PRELAUNCH_PRODUCT_KEYS,
  MARKET_BRAIN_PRODUCT_KEYS,
  MARKET_BRAIN_PRODUCT_REGISTRY,
  assertCompleteMarketBrainProductRegistry,
} from "../lib/services/marketBrain/marketBrainProductRegistry";

assert.doesNotThrow(() => assertCompleteMarketBrainProductRegistry());
assert.equal(MARKET_BRAIN_ACTIVE_PRODUCT_KEYS.length, 11);
assert.deepEqual(MARKET_BRAIN_PRELAUNCH_PRODUCT_KEYS, ["cbb_daily_edge"]);
assert.equal(MARKET_BRAIN_PRODUCT_KEYS.length, 12);
assert.deepEqual(
  MARKET_BRAIN_ACTIVE_PRODUCT_KEYS.filter((key) => key.endsWith("player_props")),
  ["nfl_player_props", "nba_player_props", "mlb_player_props"],
);
assert.deepEqual(
  MARKET_BRAIN_ACTIVE_PRODUCT_KEYS.filter((key) => key.endsWith("daily_edge")),
  [
    "nfl_daily_edge", "cfb_daily_edge", "nba_daily_edge", "wnba_daily_edge", "mlb_daily_edge",
    "nhl_daily_edge", "epl_daily_edge", "ucl_daily_edge",
  ],
);
assert.equal(MARKET_BRAIN_PRODUCT_REGISTRY.nfl_daily_edge.adapterState, "research_executable");
for (const key of MARKET_BRAIN_PRODUCT_KEYS) {
  const row = MARKET_BRAIN_PRODUCT_REGISTRY[key];
  assert.equal(row.productionInfluenceAllowed, false, `${key} must remain non-live before qualification`);
  assert.equal(row.qualificationRequired, true);
  assert.deepEqual(row.consequenceActions, ["confirm", "recenter", "flip", "fade_market", "retain", "stand_down"]);
}
assert.equal(MARKET_BRAIN_PRODUCT_REGISTRY.cbb_daily_edge.lifecycle, "prelaunch");
assert.equal(MARKET_BRAIN_PRODUCT_REGISTRY.cbb_daily_edge.adapterState, "not_started");

console.log("Market Brain complete active-product registry passed.");
