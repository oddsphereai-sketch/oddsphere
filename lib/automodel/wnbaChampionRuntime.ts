import {
  readWnbaCoreModelCalibrationFlagsFromEnv,
  WNBA_EMERGENCY_SPREAD_FORMULA_VERSION,
  WNBA_EMERGENCY_TOTAL_FORMULA_VERSION,
} from "./wnbaCoreModelCalibration";

export const EXPECTED_WNBA_MODEL_VERSION = "wnba_v1_1_team_identity" as const;
export const EXPECTED_WNBA_DISTRIBUTION_VERSION =
  "wnba_market_heads_value_calibrated_2026_08_02_v3" as const;
export const EXPECTED_WNBA_CALIBRATION_SCHEMA_VERSION = "wnba_core_calibration_v1" as const;
export const EXPECTED_WNBA_GRADE_POLICY_VERSION =
  "wnba_grade_policy_v4_market_resistance_and_elo_stat_agreement_2026_08_10" as const;
export const EXPECTED_WNBA_FORMULA_VERSIONS = {
  total_recommendation: WNBA_EMERGENCY_TOTAL_FORMULA_VERSION,
  spread_recommendation: WNBA_EMERGENCY_SPREAD_FORMULA_VERSION,
} as const;

export function wnbaPredictionReleaseMismatches(
  sportSpecific: Record<string, unknown>,
): string[] {
  const expected: Array<[string, string]> = [
    ["model_version", EXPECTED_WNBA_MODEL_VERSION],
    ["distribution_version", EXPECTED_WNBA_DISTRIBUTION_VERSION],
    ["grade_policy_version", EXPECTED_WNBA_GRADE_POLICY_VERSION],
  ];
  return expected
    .filter(([field, value]) => sportSpecific[field] !== value)
    .map(([field, value]) => `${field} expected ${value}, got ${String(sportSpecific[field] ?? "missing")}`);
}

/**
 * This is the production WNBA champion contract currently represented by the
 * locked and upcoming public records. In particular, total calibration remains
 * available for conservative grading, but does not select the displayed side.
 */
export const EXPECTED_WNBA_CALIBRATION_FLAGS = {
  coreModelEnabled: true,
  totalProjectionCalibrationEnabled: true,
  spreadMarginCalibrationEnabled: true,
  totalRecommendationUsesCalibratedProjection: false,
  spreadRecommendationUsesCalibratedMargin: true,
  gradeCalibrationEnabled: true,
} as const;

export function assertWnbaChampionRuntime(
  env: Record<string, string | undefined> = process.env,
): void {
  const resolved = readWnbaCoreModelCalibrationFlagsFromEnv(env);
  const mismatches = Object.entries(EXPECTED_WNBA_CALIBRATION_FLAGS)
    .filter(([key, expected]) => resolved[key as keyof typeof resolved] !== expected)
    .map(
      ([key, expected]) =>
        `${key}: expected ${String(expected)}, resolved ${String(resolved[key as keyof typeof resolved])}`,
    );
  if (mismatches.length > 0) {
    throw new Error(
      `WNBA champion runtime mismatch (${mismatches.join("; ")}). Writer refused to run.`,
    );
  }
}
