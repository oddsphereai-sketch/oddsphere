/**
 * OddSphere Pick Calibration Layer.
 *
 * Pure helpers only. These functions choose whether a historically validated
 * official-pick correction may apply before lock. They do not read DB state,
 * mutate rows, or affect grades by themselves.
 */

export const MLB_PICK_CALIBRATION_ENABLED_ENV = "MLB_PICK_CALIBRATION_ENABLED";
export const MLB_ML_PICK_CALIBRATION_ENABLED_ENV = "MLB_ML_PICK_CALIBRATION_ENABLED";
export const MLB_TOTAL_PICK_CALIBRATION_ENABLED_ENV = "MLB_TOTAL_PICK_CALIBRATION_ENABLED";
export const WNBA_PICK_CALIBRATION_ENABLED_ENV = "WNBA_PICK_CALIBRATION_ENABLED";
export const WNBA_SPREAD_PICK_CALIBRATION_ENABLED_ENV = "WNBA_SPREAD_PICK_CALIBRATION_ENABLED";
export const WNBA_TOTAL_PICK_CALIBRATION_ENABLED_ENV = "WNBA_TOTAL_PICK_CALIBRATION_ENABLED";
export const WORLD_CUP_PICK_CALIBRATION_ENABLED_ENV = "WORLD_CUP_PICK_CALIBRATION_ENABLED";

export const MLB_ML_RAW_MODEL_SIDE_PICK_CALIBRATION_RULE_ID =
  "mlb_ml_raw_model_side_pick_calibration_v1";

export type PickCalibrationEnv = Record<string, string | undefined>;
export type BinarySide = "home" | "away";

export type MlbMlPickCalibrationInput = {
  officialSide: BinarySide | null;
  modelProbOnOfficialSide: number | null;
  marketProbOnOfficialSide: number | null;
  homeOdds: number | null;
  awayOdds: number | null;
  env?: PickCalibrationEnv;
};

export type MlbMlPickCalibrationResult =
  | {
      applied: true;
      rule_id: typeof MLB_ML_RAW_MODEL_SIDE_PICK_CALIBRATION_RULE_ID;
      originalSide: BinarySide;
      calibratedSide: BinarySide;
      calibratedOdds: number;
      originalModelProb: number;
      calibratedModelProb: number;
      originalMarketProb: number | null;
      calibratedMarketProb: number | null;
      calibratedEdgePp: number | null;
      reason: "raw_model_favors_opposite_side";
    }
  | { applied: false; reason: string };

function strictTrue(v: string | undefined): boolean {
  return v === "true";
}

function finiteNumber(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function mlbMlPickCalibrationEnabled(env: PickCalibrationEnv = process.env): boolean {
  return strictTrue(env[MLB_PICK_CALIBRATION_ENABLED_ENV]) &&
    strictTrue(env[MLB_ML_PICK_CALIBRATION_ENABLED_ENV]);
}

export function resolveMlbMlPickCalibration(
  input: MlbMlPickCalibrationInput,
): MlbMlPickCalibrationResult {
  const env = input.env ?? process.env;
  if (!mlbMlPickCalibrationEnabled(env)) {
    return { applied: false, reason: "flags_disabled" };
  }
  if (input.officialSide !== "home" && input.officialSide !== "away") {
    return { applied: false, reason: "no_official_side" };
  }
  if (!finiteNumber(input.modelProbOnOfficialSide)) {
    return { applied: false, reason: "missing_model_probability" };
  }
  if (input.modelProbOnOfficialSide >= 0.5) {
    return { applied: false, reason: "raw_model_still_favors_official_side" };
  }

  const calibratedSide: BinarySide = input.officialSide === "home" ? "away" : "home";
  const calibratedOdds = calibratedSide === "home" ? input.homeOdds : input.awayOdds;
  if (!finiteNumber(calibratedOdds)) {
    return { applied: false, reason: "missing_opposite_price" };
  }

  const calibratedModelProb = 1 - input.modelProbOnOfficialSide;
  const calibratedMarketProb = finiteNumber(input.marketProbOnOfficialSide)
    ? 1 - input.marketProbOnOfficialSide
    : null;
  const calibratedEdgePp = calibratedMarketProb !== null
    ? round1((calibratedModelProb - calibratedMarketProb) * 100)
    : null;

  return {
    applied: true,
    rule_id: MLB_ML_RAW_MODEL_SIDE_PICK_CALIBRATION_RULE_ID,
    originalSide: input.officialSide,
    calibratedSide,
    calibratedOdds,
    originalModelProb: input.modelProbOnOfficialSide,
    calibratedModelProb,
    originalMarketProb: input.marketProbOnOfficialSide,
    calibratedMarketProb,
    calibratedEdgePp,
    reason: "raw_model_favors_opposite_side",
  };
}
