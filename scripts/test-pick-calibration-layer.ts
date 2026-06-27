import assert from "node:assert/strict";
import {
  MLB_ML_RAW_MODEL_SIDE_PICK_CALIBRATION_RULE_ID,
  resolveMlbMlPickCalibration,
} from "../lib/services/pickCalibrationLayer";

const disabled = resolveMlbMlPickCalibration({
  officialSide: "home",
  modelProbOnOfficialSide: 0.48,
  marketProbOnOfficialSide: 0.52,
  homeOdds: -120,
  awayOdds: +110,
  env: {
    MLB_PICK_CALIBRATION_ENABLED: "false",
    MLB_ML_PICK_CALIBRATION_ENABLED: "true",
  },
});
assert.deepEqual(disabled, { applied: false, reason: "flags_disabled" });

const stillFavorsOfficial = resolveMlbMlPickCalibration({
  officialSide: "away",
  modelProbOnOfficialSide: 0.53,
  marketProbOnOfficialSide: 0.47,
  homeOdds: -130,
  awayOdds: +118,
  env: {
    MLB_PICK_CALIBRATION_ENABLED: "true",
    MLB_ML_PICK_CALIBRATION_ENABLED: "true",
  },
});
assert.deepEqual(stillFavorsOfficial, {
  applied: false,
  reason: "raw_model_still_favors_official_side",
});

const missingPrice = resolveMlbMlPickCalibration({
  officialSide: "home",
  modelProbOnOfficialSide: 0.49,
  marketProbOnOfficialSide: 0.54,
  homeOdds: -130,
  awayOdds: null,
  env: {
    MLB_PICK_CALIBRATION_ENABLED: "true",
    MLB_ML_PICK_CALIBRATION_ENABLED: "true",
  },
});
assert.deepEqual(missingPrice, { applied: false, reason: "missing_opposite_price" });

const applied = resolveMlbMlPickCalibration({
  officialSide: "home",
  modelProbOnOfficialSide: 0.47,
  marketProbOnOfficialSide: 0.58,
  homeOdds: -154,
  awayOdds: +127,
  env: {
    MLB_PICK_CALIBRATION_ENABLED: "true",
    MLB_ML_PICK_CALIBRATION_ENABLED: "true",
  },
});
assert.deepEqual(applied, {
  applied: true,
  rule_id: MLB_ML_RAW_MODEL_SIDE_PICK_CALIBRATION_RULE_ID,
  originalSide: "home",
  calibratedSide: "away",
  calibratedOdds: +127,
  originalModelProb: 0.47,
  calibratedModelProb: 0.53,
  originalMarketProb: 0.58,
  calibratedMarketProb: 0.42000000000000004,
  calibratedEdgePp: 11,
  reason: "raw_model_favors_opposite_side",
});

console.log("test-pick-calibration-layer passed");
