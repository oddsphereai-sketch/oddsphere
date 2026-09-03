export const WNBA_TOTAL_MARKET_ANCHOR_25 = 0.25;
export const WNBA_TOTAL_MARKET_ANCHOR_50 = 0.5;
export const WNBA_SPREAD_MARKET_ANCHOR_25 = 0.25;
export const WNBA_SPREAD_MARKET_ANCHOR_50 = 0.5;
export const WNBA_EMERGENCY_TOTAL_FORMULA_VERSION =
  "wnba_total_independent_complete_pair_target_excluded_value_2026_09_02_v3";
export const WNBA_EMERGENCY_SPREAD_FORMULA_VERSION =
  "wnba_spread_ml_coherent_target_excluded_evaluation_2026_09_02_v3";

export type WnbaCoreModelCalibrationInput = {
  rawProjectedAwayScore: number | null;
  rawProjectedHomeScore: number | null;
  rawProjectedTotal: number | null;
  rawProjectedHomeMargin: number | null;
  marketTotal: number | null;
  marketSpreadForHome: number | null;
  coreModelEnabled?: boolean;
  totalProjectionCalibrationEnabled?: boolean;
  spreadMarginCalibrationEnabled?: boolean;
  totalRecommendationUsesCalibratedProjection?: boolean;
  spreadRecommendationUsesCalibratedMargin?: boolean;
  gradeCalibrationEnabled?: boolean;
};

export type WnbaCoreModelCalibrationAudit = {
  schema_version: "wnba_core_calibration_v3_complete_pair_target_exclusion";
  recommendation_safe: true;
  formulas: {
    total_25: "market_total + 0.25 * (raw_projected_total - market_total)";
    total_50: "market_total + 0.50 * (raw_projected_total - market_total)";
    spread_25: "market_implied_home_margin + 0.25 * (raw_projected_home_margin - market_implied_home_margin)";
    spread_50: "market_implied_home_margin + 0.50 * (raw_projected_home_margin - market_implied_home_margin)";
  };
  formula_versions: {
    total_recommendation: typeof WNBA_EMERGENCY_TOTAL_FORMULA_VERSION;
    spread_recommendation: typeof WNBA_EMERGENCY_SPREAD_FORMULA_VERSION;
  };
  raw_projected_total: number | null;
  raw_projected_away_score: number | null;
  raw_projected_home_score: number | null;
  raw_projected_home_margin: number | null;
  market_total: number | null;
  market_implied_home_margin: number | null;
  total_model_edge_points: number | null;
  spread_model_edge_points: number | null;
  market_anchored_projected_total_25: number | null;
  market_anchored_projected_total_50: number | null;
  learned_calibrated_projected_total: number | null;
  market_anchored_home_margin_25: number | null;
  market_anchored_home_margin_50: number | null;
  learned_calibrated_home_margin: number | null;
  emergency_calibrated_projected_total: number | null;
  emergency_calibrated_home_margin: number | null;
  recommendation_projected_total_used: number | null;
  recommendation_home_margin_used: number | null;
  recommendation_reason_codes: {
    total: string[];
    spread: string[];
  };
  projection_calibration_enabled: boolean;
  total_projection_calibration_enabled: boolean;
  spread_margin_calibration_enabled: boolean;
  recommendation_uses_calibrated_total: boolean;
  recommendation_uses_calibrated_spread: boolean;
  grade_calibration_enabled: boolean;
  feature_flags: {
    WNBA_CORE_MODEL_CALIBRATION_ENABLED: boolean;
    WNBA_TOTAL_PROJECTION_CALIBRATION_ENABLED: boolean;
    WNBA_SPREAD_MARGIN_CALIBRATION_ENABLED: boolean;
    WNBA_TOTAL_RECOMMENDATION_USES_CALIBRATED_PROJECTION_ENABLED: boolean;
    WNBA_SPREAD_RECOMMENDATION_USES_CALIBRATED_MARGIN_ENABLED: boolean;
    WNBA_GRADE_CALIBRATION_ENABLED: boolean;
  };
  skipped_reason: string | null;
  display_hint:
    | "calibration_disabled"
    | "calibrated_projection_available_for_audit_only"
    | "calibrated_projection_used_for_recommendation";
};

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function preserveFinite(value: number | null): number | null {
  return finite(value) ? value : null;
}

export function readWnbaCoreModelCalibrationFlagsFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  const enabledUnlessFalse = (name: string) => env[name] !== "false";
  return {
    coreModelEnabled: enabledUnlessFalse("WNBA_CORE_MODEL_CALIBRATION_ENABLED"),
    totalProjectionCalibrationEnabled:
      enabledUnlessFalse("WNBA_TOTAL_PROJECTION_CALIBRATION_ENABLED"),
    spreadMarginCalibrationEnabled:
      enabledUnlessFalse("WNBA_SPREAD_MARGIN_CALIBRATION_ENABLED"),
    totalRecommendationUsesCalibratedProjection:
      env.WNBA_TOTAL_RECOMMENDATION_USES_CALIBRATED_PROJECTION_ENABLED !== "false",
    spreadRecommendationUsesCalibratedMargin:
      env.WNBA_SPREAD_RECOMMENDATION_USES_CALIBRATED_MARGIN_ENABLED !== "false",
    gradeCalibrationEnabled: enabledUnlessFalse("WNBA_GRADE_CALIBRATION_ENABLED"),
  };
}

export function marketImpliedHomeMarginFromSpread(
  marketSpreadForHome: number | null,
): number | null {
  if (!finite(marketSpreadForHome)) return null;
  return -marketSpreadForHome;
}

export function buildWnbaCoreModelCalibrationAudit(
  input: WnbaCoreModelCalibrationInput,
): WnbaCoreModelCalibrationAudit {
  const coreEnabled = input.coreModelEnabled === true;
  const totalEnabled = coreEnabled && input.totalProjectionCalibrationEnabled === true;
  const spreadEnabled = coreEnabled && input.spreadMarginCalibrationEnabled === true;
  const totalRecommendationUse =
    totalEnabled && input.totalRecommendationUsesCalibratedProjection === true;
  const spreadRecommendationUse =
    spreadEnabled && input.spreadRecommendationUsesCalibratedMargin === true;
  const gradeEnabled = coreEnabled && input.gradeCalibrationEnabled === true;

  const rawProjectedTotal = finite(input.rawProjectedTotal)
    ? input.rawProjectedTotal
    : finite(input.rawProjectedAwayScore) && finite(input.rawProjectedHomeScore)
      ? input.rawProjectedAwayScore + input.rawProjectedHomeScore
      : null;
  const rawProjectedHomeMargin = finite(input.rawProjectedHomeMargin)
    ? input.rawProjectedHomeMargin
    : finite(input.rawProjectedHomeScore) && finite(input.rawProjectedAwayScore)
      ? input.rawProjectedHomeScore - input.rawProjectedAwayScore
      : null;
  const marketImpliedHomeMargin = marketImpliedHomeMarginFromSpread(input.marketSpreadForHome);

  const totalEdge = finite(rawProjectedTotal) && finite(input.marketTotal)
    ? rawProjectedTotal - input.marketTotal
    : null;
  const spreadEdge = finite(rawProjectedHomeMargin) && finite(marketImpliedHomeMargin)
    ? rawProjectedHomeMargin - marketImpliedHomeMargin
    : null;

  const total25 = finite(input.marketTotal) && finite(totalEdge)
    ? input.marketTotal + WNBA_TOTAL_MARKET_ANCHOR_25 * totalEdge
    : null;
  const total50 = finite(input.marketTotal) && finite(totalEdge)
    ? input.marketTotal + WNBA_TOTAL_MARKET_ANCHOR_50 * totalEdge
    : null;
  const spread25 = finite(marketImpliedHomeMargin) && finite(spreadEdge)
    ? marketImpliedHomeMargin + WNBA_SPREAD_MARKET_ANCHOR_25 * spreadEdge
    : null;
  const spread50 = finite(marketImpliedHomeMargin) && finite(spreadEdge)
    ? marketImpliedHomeMargin + WNBA_SPREAD_MARKET_ANCHOR_50 * spreadEdge
    : null;
  const emergencyTotal = total25;
  // The original launch hotfix added 25% of a +11.944 point home bias learned
  // from only nine settled games. By 2026-07-22 the 72-game replay measured
  // effectively zero home bias, while production spread sides were 30-42.
  // Keep the stable 25% market anchor, but remove the stale additive bias.
  // Because this is a convex blend of the market line and the raw projection,
  // it cannot select the opposite ATS side from the published score margin.
  const emergencySpread = spread25;
  const totalReasonCodes = [
    ...(totalEnabled ? ["market_anchor_25_total_available"] : []),
    ...(totalEnabled && !totalRecommendationUse ? ["total_recommendation_use_disabled"] : []),
    ...(totalRecommendationUse ? ["market_anchor_25_total_used_for_recommendation"] : []),
  ];
  const spreadReasonCodes = [
    ...(spreadEnabled ? ["market_anchor_25_spread_available"] : []),
    ...(spreadEnabled ? ["stale_launch_home_bias_removed"] : []),
    ...(spreadEnabled && !spreadRecommendationUse ? ["spread_recommendation_use_disabled"] : []),
    ...(spreadRecommendationUse ? ["market_anchor_25_spread_used_for_recommendation"] : []),
  ];

  return {
    schema_version: "wnba_core_calibration_v3_complete_pair_target_exclusion",
    recommendation_safe: true,
    formulas: {
      total_25: "market_total + 0.25 * (raw_projected_total - market_total)",
      total_50: "market_total + 0.50 * (raw_projected_total - market_total)",
      spread_25: "market_implied_home_margin + 0.25 * (raw_projected_home_margin - market_implied_home_margin)",
      spread_50: "market_implied_home_margin + 0.50 * (raw_projected_home_margin - market_implied_home_margin)",
    },
    formula_versions: {
      total_recommendation: WNBA_EMERGENCY_TOTAL_FORMULA_VERSION,
      spread_recommendation: WNBA_EMERGENCY_SPREAD_FORMULA_VERSION,
    },
    raw_projected_total: preserveFinite(rawProjectedTotal),
    raw_projected_away_score: preserveFinite(input.rawProjectedAwayScore),
    raw_projected_home_score: preserveFinite(input.rawProjectedHomeScore),
    raw_projected_home_margin: preserveFinite(rawProjectedHomeMargin),
    market_total: preserveFinite(input.marketTotal),
    market_implied_home_margin: preserveFinite(marketImpliedHomeMargin),
    total_model_edge_points: preserveFinite(totalEdge),
    spread_model_edge_points: preserveFinite(spreadEdge),
    market_anchored_projected_total_25: totalEnabled ? preserveFinite(total25) : null,
    market_anchored_projected_total_50: totalEnabled ? preserveFinite(total50) : null,
    learned_calibrated_projected_total: null,
    market_anchored_home_margin_25: spreadEnabled ? preserveFinite(spread25) : null,
    market_anchored_home_margin_50: spreadEnabled ? preserveFinite(spread50) : null,
    learned_calibrated_home_margin: null,
    emergency_calibrated_projected_total: totalEnabled ? preserveFinite(emergencyTotal) : null,
    emergency_calibrated_home_margin: spreadEnabled ? preserveFinite(emergencySpread) : null,
    recommendation_projected_total_used: totalRecommendationUse ? preserveFinite(emergencyTotal) : null,
    recommendation_home_margin_used: spreadRecommendationUse ? preserveFinite(emergencySpread) : null,
    recommendation_reason_codes: {
      total: totalReasonCodes,
      spread: spreadReasonCodes,
    },
    projection_calibration_enabled: totalEnabled || spreadEnabled,
    total_projection_calibration_enabled: totalEnabled,
    spread_margin_calibration_enabled: spreadEnabled,
    recommendation_uses_calibrated_total: totalRecommendationUse,
    recommendation_uses_calibrated_spread: spreadRecommendationUse,
    grade_calibration_enabled: gradeEnabled,
    feature_flags: {
      WNBA_CORE_MODEL_CALIBRATION_ENABLED: coreEnabled,
      WNBA_TOTAL_PROJECTION_CALIBRATION_ENABLED: input.totalProjectionCalibrationEnabled === true,
      WNBA_SPREAD_MARGIN_CALIBRATION_ENABLED: input.spreadMarginCalibrationEnabled === true,
      WNBA_TOTAL_RECOMMENDATION_USES_CALIBRATED_PROJECTION_ENABLED:
        input.totalRecommendationUsesCalibratedProjection === true,
      WNBA_SPREAD_RECOMMENDATION_USES_CALIBRATED_MARGIN_ENABLED:
        input.spreadRecommendationUsesCalibratedMargin === true,
      WNBA_GRADE_CALIBRATION_ENABLED: input.gradeCalibrationEnabled === true,
    },
    skipped_reason:
      totalRecommendationUse || spreadRecommendationUse
        ? null
        : !coreEnabled
          ? "core_model_calibration_flag_disabled"
          : !totalEnabled && !spreadEnabled
            ? "projection_calibration_flags_disabled"
            : "recommendation_use_flags_disabled",
    display_hint:
      totalRecommendationUse || spreadRecommendationUse
        ? "calibrated_projection_used_for_recommendation"
        : totalEnabled || spreadEnabled
          ? "calibrated_projection_available_for_audit_only"
          : "calibration_disabled",
  };
}
