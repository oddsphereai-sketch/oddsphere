import assert from "node:assert/strict";
import {
  MLB_DAILY_EDGE_DECISION_RELEASE_ID,
  MLB_DAILY_EDGE_RULE_BUNDLE_VERSION,
  MLB_MODEL_LAYER_VERSION_IDS,
  MLB_PUBLIC_CALIBRATION_VERSION,
} from "../lib/automodel/mlbModelLayerVersions";

// This filename is retained because it is part of the mandatory verification
// command introduced on the EPL release line. The old August 15 immediate
// champion helper is intentionally not restored: current main superseded those
// operator-only rules with the production r61 first-inning release.
assert.equal(MLB_DAILY_EDGE_DECISION_RELEASE_ID, "mlb_daily_edge_decision_2026_08_20_r61");
assert.equal(MLB_DAILY_EDGE_RULE_BUNDLE_VERSION, "mlb_daily_edge_rule_bundle_v50_2026_08_20");
assert.equal(MLB_PUBLIC_CALIBRATION_VERSION, "mlb_public_calibration_v22_first_inning_market_backed_2026_08_20");
assert.equal(
  MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head,
  "mlb_first_inning_fi_v4_market_backed_weight25_2026_08_20",
);
assert.equal(
  MLB_MODEL_LAYER_VERSION_IDS.grade_policy,
  "mlb_public_grade_policy_v40_first_inning_nonnegative_novig_edge_2026_08_20",
);

console.log("forward-only MLB release guard passed");
