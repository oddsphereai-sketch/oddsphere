import {
  buildWnbaCoreModelCalibrationAudit,
  marketImpliedHomeMarginFromSpread,
} from "../lib/automodel/wnbaCoreModelCalibration";
import { gradePrediction } from "../lib/services/predictionGrader";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, details = "") {
  if (ok) {
    pass += 1;
    console.log(`ok - ${name}`);
  } else {
    fail += 1;
    console.error(`not ok - ${name}${details ? ` (${details})` : ""}`);
  }
}

const disabled = buildWnbaCoreModelCalibrationAudit({
  rawProjectedAwayScore: 88,
  rawProjectedHomeScore: 84,
  rawProjectedTotal: 172,
  rawProjectedHomeMargin: -4,
  marketTotal: 168,
  marketSpreadForHome: 2.5,
  coreModelEnabled: false,
  totalProjectionCalibrationEnabled: false,
  spreadMarginCalibrationEnabled: false,
  totalRecommendationUsesCalibratedProjection: false,
  spreadRecommendationUsesCalibratedMargin: false,
  gradeCalibrationEnabled: false,
});

check("flags off records raw projected total", disabled.raw_projected_total === 172);
check("flags off records raw home margin", disabled.raw_projected_home_margin === -4);
check("flags off does not expose enabled calibrated total", disabled.market_anchored_projected_total_25 === null);
check("flags off does not expose enabled calibrated margin", disabled.market_anchored_home_margin_25 === null);
check("flags off cannot use calibrated total for recommendations", disabled.recommendation_uses_calibrated_total === false);
check("flags off cannot use calibrated spread for recommendations", disabled.recommendation_uses_calibrated_spread === false);
check("flags off keeps grade calibration disabled", disabled.grade_calibration_enabled === false);
check("flags off display hint is disabled", disabled.display_hint === "calibration_disabled");

const auditOnly = buildWnbaCoreModelCalibrationAudit({
  rawProjectedAwayScore: 88,
  rawProjectedHomeScore: 84,
  rawProjectedTotal: 172,
  rawProjectedHomeMargin: -4,
  marketTotal: 168,
  marketSpreadForHome: 2.5,
  coreModelEnabled: true,
  totalProjectionCalibrationEnabled: true,
  spreadMarginCalibrationEnabled: true,
  totalRecommendationUsesCalibratedProjection: false,
  spreadRecommendationUsesCalibratedMargin: false,
  gradeCalibrationEnabled: false,
});

check("WNBA total audit computes 25% market anchor", auditOnly.market_anchored_projected_total_25 === 169);
check("WNBA total audit computes 50% market anchor", auditOnly.market_anchored_projected_total_50 === 170);
check("home spread +2.5 implies market home margin -2.5", marketImpliedHomeMarginFromSpread(2.5) === -2.5);
check("WNBA spread audit computes 25% market anchor", auditOnly.market_anchored_home_margin_25 === -2.9);
check("WNBA spread audit computes 50% market anchor", auditOnly.market_anchored_home_margin_50 === -3.2);
check("WNBA diagnostic home correction is additive only", auditOnly.home_bias_corrected_margin === 8);
check("audit-only total recommendation remains false", auditOnly.recommendation_uses_calibrated_total === false);
check("audit-only spread recommendation remains false", auditOnly.recommendation_uses_calibrated_spread === false);
check("audit-only grade remains disabled", auditOnly.grade_calibration_enabled === false);
check("audit-only display hint is audit-only", auditOnly.display_hint === "calibrated_projection_available_for_audit_only");

const recommendationRequestedWithoutProjection = buildWnbaCoreModelCalibrationAudit({
  rawProjectedAwayScore: 88,
  rawProjectedHomeScore: 84,
  rawProjectedTotal: 172,
  rawProjectedHomeMargin: -4,
  marketTotal: 168,
  marketSpreadForHome: 2.5,
  coreModelEnabled: true,
  totalProjectionCalibrationEnabled: false,
  spreadMarginCalibrationEnabled: false,
  totalRecommendationUsesCalibratedProjection: true,
  spreadRecommendationUsesCalibratedMargin: true,
  gradeCalibrationEnabled: false,
});

check(
  "recommendation-use flags alone cannot activate total recommendation",
  recommendationRequestedWithoutProjection.recommendation_uses_calibrated_total === false,
);
check(
  "recommendation-use flags alone cannot activate spread recommendation",
  recommendationRequestedWithoutProjection.recommendation_uses_calibrated_spread === false,
);

const spreadWin = gradePrediction({
  record: {
    id: 1,
    game_id: 1,
    sport: "wnba",
    market: "spread",
    pick: "AWAY +6.5",
    side: "away",
    line_value: 6.5,
    no_bet: false,
  } as any,
  game: { status: "final", home_score: 90, away_score: 86, first_inning_runs: null },
  source: "manual_operator",
});
check("WNBA away +6.5 covers when away loses by 4", spreadWin.result === "win");

const spreadPush = gradePrediction({
  record: {
    id: 2,
    game_id: 2,
    sport: "wnba",
    market: "spread",
    pick: "HOME -4",
    side: "home",
    line_value: -4,
    no_bet: false,
  } as any,
  game: { status: "final", home_score: 84, away_score: 80, first_inning_runs: null },
  source: "manual_operator",
});
check("WNBA spread push remains push", spreadPush.result === "push");

const totalPush = gradePrediction({
  record: {
    id: 3,
    game_id: 3,
    sport: "wnba",
    market: "total",
    pick: "Over 164",
    side: "over",
    line_value: 164,
    no_bet: false,
  } as any,
  game: { status: "final", home_score: 80, away_score: 84, first_inning_runs: null },
  source: "manual_operator",
});
check("WNBA total push remains push", totalPush.result === "push");

if (fail > 0) {
  console.error(`wnba core model calibration tests: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log(`wnba core model calibration tests: ${pass} passed, ${fail} failed`);
