import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MARKET_BRAIN_ACTIVE_PRODUCT_KEYS,
  MARKET_BRAIN_AUTHORITATIVE_WRITER_ROUTES,
  MARKET_BRAIN_PRELAUNCH_PRODUCT_KEYS,
  MARKET_BRAIN_PRODUCT_KEYS,
  MARKET_BRAIN_PRODUCT_REGISTRY,
  MARKET_BRAIN_PRODUCT_REGISTRY_RELEASE,
  assertCompleteMarketBrainProductRegistry,
} from "../lib/services/marketBrain/marketBrainProductRegistry";
import { NFL_PLAYER_PROPS_RESEARCH_MARKETS } from
  "../lib/services/football/nflPlayerPropsContract";
import { NBA_PLAYER_PROPS_RESEARCH_MARKETS } from
  "../lib/services/nba/nbaPlayerPropsContract";
import { MLB_PROP_MARKET_KEYS } from "../lib/mlb/props/config";
import { resolveCronLeaseJobName } from "../lib/cron/leaseIdentity";

assert.doesNotThrow(() => assertCompleteMarketBrainProductRegistry());
assert.equal(MARKET_BRAIN_ACTIVE_PRODUCT_KEYS.length, 12);
assert.deepEqual(MARKET_BRAIN_PRELAUNCH_PRODUCT_KEYS, ["cbb_daily_edge"]);
assert.equal(MARKET_BRAIN_PRODUCT_KEYS.length, 13);
assert.deepEqual(
  MARKET_BRAIN_ACTIVE_PRODUCT_KEYS.filter((key) => key.endsWith("player_props")),
  ["nfl_player_props", "nba_player_props", "mlb_player_props"],
);
assert.deepEqual(
  MARKET_BRAIN_ACTIVE_PRODUCT_KEYS.filter((key) => key.endsWith("daily_edge")),
  [
    "nfl_daily_edge", "cfb_daily_edge", "nba_daily_edge", "wnba_daily_edge", "mlb_daily_edge",
    "nhl_daily_edge", "epl_daily_edge", "ucl_daily_edge",
    "soccer_world_cup_daily_edge",
  ],
);
assert.equal(MARKET_BRAIN_PRODUCT_REGISTRY.nfl_daily_edge.adapterState, "research_executable");
assert.equal(MARKET_BRAIN_PRODUCT_REGISTRY.soccer_world_cup_daily_edge.authoritativeWriter,
  "soccer_daily_refresh", "the shipped World Cup surface must not disappear inside a generic soccer label");
assert.equal(MARKET_BRAIN_PRODUCT_REGISTRY.nba_player_props.lifecycle, "private_forward_candidate");
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.nfl_player_props.markets,
  NFL_PLAYER_PROPS_RESEARCH_MARKETS, "every NFL prop stat family must remain an independent qualification scope");
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.nba_player_props.markets,
  NBA_PLAYER_PROPS_RESEARCH_MARKETS, "every NBA prop stat family must remain an independent qualification scope");
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.mlb_player_props.markets,
  MLB_PROP_MARKET_KEYS, "every MLB prop stat family must remain an independent qualification scope");
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.mlb_daily_edge.qualificationScopeKeys,
  ["full_game_moneyline", "full_game_total", "first_inning_nrfi_yrfi"],
  "the independent first-inning model must qualify separately from MLB full-game targets");
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.mlb_daily_edge.markets,
  ["moneyline", "total", "first_inning"], "capture-only run line must not masquerade as an actionable target");
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.nhl_daily_edge.markets,
  ["moneyline", "spread", "total"], "NHL must use its persisted canonical spread market ID");
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.nba_daily_edge.authorityChain?.predictionRecord,
  ["pregame_sweep"], "NBA refresh publishes the snapshot but pregame sweep owns prediction records");
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.nba_daily_edge.authorityChain?.memberSnapshot,
  ["nba_daily_refresh", "pregame_sweep"]);
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.mlb_daily_edge.authorityChain?.lock,
  ["pregame_sweep"]);
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.nhl_daily_edge.authorityChain?.lock,
  ["pregame_sweep"]);
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.mlb_player_props.authorityChain?.lock,
  ["mlb_player_props_refresh", "pregame_sweep"]);
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.nfl_daily_edge.authorityChain?.stake,
  { policy: "not_applicable", writers: [] });
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.cfb_daily_edge.authorityChain?.stake,
  { policy: "not_applicable", writers: [] });
assert.deepEqual(MARKET_BRAIN_PRODUCT_REGISTRY.mlb_player_props.authorityChain?.stake,
  { policy: "recommended_units", writers: ["mlb_player_props_refresh"] });
for (const key of MARKET_BRAIN_PRODUCT_KEYS) {
  const row = MARKET_BRAIN_PRODUCT_REGISTRY[key];
  assert.equal(row.productionInfluenceAllowed, false, `${key} must remain non-live before qualification`);
  assert.equal(row.qualificationRequired, true);
  assert.deepEqual(row.consequenceActions, ["confirm", "recenter", "flip", "fade_market", "retain", "stand_down"]);
  assert.deepEqual(row.qualificationScopes.map((scope) => scope.key), row.qualificationScopeKeys);
  assert.ok(row.qualificationScopes.every((scope) => !scope.productionInfluenceAllowed),
    `${key} child scopes must stay independently non-live before proof`);
}
for (const key of MARKET_BRAIN_ACTIVE_PRODUCT_KEYS) {
  const registration = MARKET_BRAIN_PRODUCT_REGISTRY[key];
  const writer = registration.authoritativeWriter;
  assert.ok(writer, `${key} must resolve a real authoritative writer`);
  assert.ok(registration.authorityChain, `${key} must declare every authority stage explicitly`);
  const chainWriters = new Set([
    ...registration.authorityChain.captureAndModel,
    ...registration.authorityChain.predictionRecord,
    ...registration.authorityChain.grade,
    ...registration.authorityChain.stake.writers,
    ...registration.authorityChain.lock,
    ...registration.authorityChain.memberSnapshot,
  ]);
  for (const chainWriter of chainWriters) {
    const routePath = MARKET_BRAIN_AUTHORITATIVE_WRITER_ROUTES[chainWriter];
    const routeSource = readFileSync(resolve(process.cwd(), routePath), "utf8");
    assert.match(routeSource, new RegExp(`[\"']${chainWriter}[\"']`),
      `${key} authority stage must resolve to the configured cron route: ${chainWriter}`);
    assert.match(routeSource, /leaseGroup:\s*["']prediction_pipeline["']/,
      `${key} authority stage must join the shared sport prediction lease: ${chainWriter}`);
    assert.match(routeSource, /requireLease:\s*true/,
      `${key} authority stage must fail closed when the shared lease is unavailable: ${chainWriter}`);
    assert.equal(resolveCronLeaseJobName(chainWriter, registration.sport,
      "prediction_pipeline"), registration.predictionLease);
  }
}
const releaseRegistry = readFileSync(resolve(process.cwd(), "docs/current-model-releases.md"), "utf8");
assert.match(releaseRegistry, /^## FIFA World Cup Daily Edge legacy production release/m,
  "the shipped World Cup model must have an explicit current-release handoff section");
assert.equal(releaseRegistry.split(MARKET_BRAIN_PRODUCT_REGISTRY_RELEASE).length - 1, 2,
  "the current-release handoff must register the exact runtime product-registry release at both foundation and World Cup boundaries");
assert.doesNotMatch(releaseRegistry, /market_brain_product_registry_2026_10_27_r1_complete_active_product_scope/);
assert.equal(MARKET_BRAIN_PRODUCT_REGISTRY.cbb_daily_edge.lifecycle, "prelaunch");
assert.equal(MARKET_BRAIN_PRODUCT_REGISTRY.cbb_daily_edge.adapterState, "not_started");
assert.equal(MARKET_BRAIN_PRODUCT_REGISTRY.cbb_daily_edge.authoritativeWriter, null);

console.log("Market Brain complete active-product registry passed.");
