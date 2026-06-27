export const WNBA_TOTAL_MARKET_ANCHOR_25 = 0.25;
export const WNBA_TOTAL_MARKET_ANCHOR_50 = 0.5;
export const WNBA_SPREAD_MARKET_ANCHOR_25 = 0.25;
export const WNBA_SPREAD_MARKET_ANCHOR_50 = 0.5;
export const WNBA_DIAGNOSTIC_HOME_MARGIN_CORRECTION = 12;

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
  schema_version: "wnba_core_calibration_v1";
  recommendation_safe: true;
  formulas: {
    total_25: "market_total + 0.25 * (raw_projected_total - market_total)";
    total_50: "market_total + 0.50 * (raw_projected_total - market_total)";
    spread_25: "market_implied_home_margin + 0.25 * (raw_projected_home_margin - market_implied_home_margin)";
    spread_50: "market_implied_home_margin + 0.50 * (raw_projected_home_margin - market_implied_home_margin)";
    home_bias_diagnostic: "raw_projected_home_margin + 12";
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
  home_bias_corrected_margin: number | null;
  learned_calibrated_home_margin: number | null;
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

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundNullable(value: number | null): number | null {
  return finite(value) ? round1(value) : null;
}

export function marketImpliedHomeMarginFromSpread(
  marketSpreadForHome: number | null,
): number | null {
  if (!finite(marketSpreadForHome)) return null;
  return round1(-marketSpreadForHome);
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
  const homeBiasCorrected = finite(rawProjectedHomeMargin)
    ? rawProjectedHomeMargin + WNBA_DIAGNOSTIC_HOME_MARGIN_CORRECTION
    : null;

  return {
    schema_version: "wnba_core_calibration_v1",
    recommendation_safe: true,
    formulas: {
      total_25: "market_total + 0.25 * (raw_projected_total - market_total)",
      total_50: "market_total + 0.50 * (raw_projected_total - market_total)",
      spread_25: "market_implied_home_margin + 0.25 * (raw_projected_home_margin - market_implied_home_margin)",
      spread_50: "market_implied_home_margin + 0.50 * (raw_projected_home_margin - market_implied_home_margin)",
      home_bias_diagnostic: "raw_projected_home_margin + 12",
    },
    raw_projected_total: roundNullable(rawProjectedTotal),
    raw_projected_away_score: roundNullable(input.rawProjectedAwayScore),
    raw_projected_home_score: roundNullable(input.rawProjectedHomeScore),
    raw_projected_home_margin: roundNullable(rawProjectedHomeMargin),
    market_total: roundNullable(input.marketTotal),
    market_implied_home_margin: roundNullable(marketImpliedHomeMargin),
    total_model_edge_points: roundNullable(totalEdge),
    spread_model_edge_points: roundNullable(spreadEdge),
    market_anchored_projected_total_25: totalEnabled ? roundNullable(total25) : null,
    market_anchored_projected_total_50: totalEnabled ? roundNullable(total50) : null,
    learned_calibrated_projected_total: null,
    market_anchored_home_margin_25: spreadEnabled ? roundNullable(spread25) : null,
    market_anchored_home_margin_50: spreadEnabled ? roundNullable(spread50) : null,
    home_bias_corrected_margin: spreadEnabled ? roundNullable(homeBiasCorrected) : null,
    learned_calibrated_home_margin: null,
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
