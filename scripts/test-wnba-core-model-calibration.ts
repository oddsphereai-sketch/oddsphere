import {
  buildWnbaCoreModelCalibrationAudit,
  marketImpliedHomeMarginFromSpread,
} from "../lib/automodel/wnbaCoreModelCalibration";
import { computeWnbaPrediction, type ModelState, type OddRow } from "../lib/services/wnba/buildWnbaDailyEdgePreview";
import { selectPreferredWnbaTipTime } from "../lib/services/wnba/refreshWnbaLines";
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
check("WNBA emergency total equals 25% market anchor", auditOnly.emergency_calibrated_projected_total === 169);
check("home spread +2.5 implies market home margin -2.5", marketImpliedHomeMarginFromSpread(2.5) === -2.5);
check("WNBA spread audit computes 25% market anchor", auditOnly.market_anchored_home_margin_25 === -2.9);
check("WNBA spread audit computes 50% market anchor", auditOnly.market_anchored_home_margin_50 === -3.2);
check("WNBA emergency spread uses the 25% market anchor without stale home bias", auditOnly.emergency_calibrated_home_margin === -2.9);
check("WNBA diagnostic home correction is additive only", auditOnly.home_bias_corrected_margin === 8);
check("audit-only total recommendation remains false", auditOnly.recommendation_uses_calibrated_total === false);
check("audit-only spread recommendation remains false", auditOnly.recommendation_uses_calibrated_spread === false);
check("audit-only does not mark total as used", auditOnly.recommendation_projected_total_used === null);
check("audit-only does not mark spread as used", auditOnly.recommendation_home_margin_used === null);
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

const recommendationEnabled = buildWnbaCoreModelCalibrationAudit({
  rawProjectedAwayScore: 88,
  rawProjectedHomeScore: 84,
  rawProjectedTotal: 172,
  rawProjectedHomeMargin: -4,
  marketTotal: 168,
  marketSpreadForHome: 2.5,
  coreModelEnabled: true,
  totalProjectionCalibrationEnabled: true,
  spreadMarginCalibrationEnabled: true,
  totalRecommendationUsesCalibratedProjection: true,
  spreadRecommendationUsesCalibratedMargin: true,
  gradeCalibrationEnabled: true,
});

check("recommendation-use can activate total only with projection flag", recommendationEnabled.recommendation_uses_calibrated_total === true);
check("recommendation-use can activate spread only with margin flag", recommendationEnabled.recommendation_uses_calibrated_spread === true);
check("recommendation total used is recorded", recommendationEnabled.recommendation_projected_total_used === 169);
check("recommendation spread used is recorded", recommendationEnabled.recommendation_home_margin_used === -2.9);
check("recommendation mode display hint is explicit", recommendationEnabled.display_hint === "calibrated_projection_used_for_recommendation");
check(
  "recommendation audit records stale launch-bias removal",
  recommendationEnabled.recommendation_reason_codes.spread.includes("stale_launch_home_bias_removed"),
);
check(
  "recommendation audit records total formula reason code",
  recommendationEnabled.recommendation_reason_codes.total.includes("market_anchor_25_total_used_for_recommendation"),
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

const oldEnv = {
  WNBA_CORE_MODEL_CALIBRATION_ENABLED: process.env.WNBA_CORE_MODEL_CALIBRATION_ENABLED,
  WNBA_TOTAL_PROJECTION_CALIBRATION_ENABLED: process.env.WNBA_TOTAL_PROJECTION_CALIBRATION_ENABLED,
  WNBA_SPREAD_MARGIN_CALIBRATION_ENABLED: process.env.WNBA_SPREAD_MARGIN_CALIBRATION_ENABLED,
  WNBA_TOTAL_RECOMMENDATION_USES_CALIBRATED_PROJECTION_ENABLED: process.env.WNBA_TOTAL_RECOMMENDATION_USES_CALIBRATED_PROJECTION_ENABLED,
  WNBA_SPREAD_RECOMMENDATION_USES_CALIBRATED_MARGIN_ENABLED: process.env.WNBA_SPREAD_RECOMMENDATION_USES_CALIBRATED_MARGIN_ENABLED,
  WNBA_GRADE_CALIBRATION_ENABLED: process.env.WNBA_GRADE_CALIBRATION_ENABLED,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(oldEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const fixtureModel: ModelState = {
  elo: new Map([[10, 1500], [30, 1500]]),
  games: new Map([[10, 30], [30, 30]]),
  pf: new Map([[10, Array(10).fill(86)], [30, Array(10).fill(86)]]),
  pa: new Map([[10, Array(10).fill(86)], [30, Array(10).fill(86)]]),
  nameById: new Map([[10, "Phoenix Mercury"], [30, "Toronto Tempo"]]),
  mascot: [],
  rawGames: [],
  computedAt: Date.now(),
};

const fixtureOdds: OddRow[] = ["draftkings", "betmgm", "caesars", "circa"].flatMap((book) => [
  { book, sharp: true, mkt: "moneyline", selType: "home", odds: -190, line: null, date: "2026-06-27", h: 30, a: 10 },
  { book, sharp: true, mkt: "moneyline", selType: "away", odds: 160, line: null, date: "2026-06-27", h: 30, a: 10 },
  { book, sharp: true, mkt: "point_spread", selType: "home", odds: -110, line: -6.5, date: "2026-06-27", h: 30, a: 10 },
  { book, sharp: true, mkt: "point_spread", selType: "away", odds: -110, line: 6.5, date: "2026-06-27", h: 30, a: 10 },
  { book, sharp: true, mkt: "total_points", selType: "over", odds: -110, line: 177.5, date: "2026-06-27", h: 30, a: 10 },
  { book, sharp: true, mkt: "total_points", selType: "under", odds: -110, line: 177.5, date: "2026-06-27", h: 30, a: 10 },
]);

restoreEnv();
process.env.WNBA_CORE_MODEL_CALIBRATION_ENABLED = "false";
process.env.WNBA_TOTAL_PROJECTION_CALIBRATION_ENABLED = "false";
process.env.WNBA_SPREAD_MARGIN_CALIBRATION_ENABLED = "false";
process.env.WNBA_TOTAL_RECOMMENDATION_USES_CALIBRATED_PROJECTION_ENABLED = "false";
process.env.WNBA_SPREAD_RECOMMENDATION_USES_CALIBRATED_MARGIN_ENABLED = "false";
process.env.WNBA_GRADE_CALIBRATION_ENABLED = "false";
const computeDisabled = computeWnbaPrediction(
  fixtureModel,
  { id: 999, date: "2026-06-27", h: 30, a: 10 },
  fixtureOdds,
);

process.env.WNBA_CORE_MODEL_CALIBRATION_ENABLED = "true";
process.env.WNBA_TOTAL_PROJECTION_CALIBRATION_ENABLED = "true";
process.env.WNBA_SPREAD_MARGIN_CALIBRATION_ENABLED = "true";
process.env.WNBA_TOTAL_RECOMMENDATION_USES_CALIBRATED_PROJECTION_ENABLED = "false";
process.env.WNBA_SPREAD_RECOMMENDATION_USES_CALIBRATED_MARGIN_ENABLED = "true";
process.env.WNBA_GRADE_CALIBRATION_ENABLED = "true";
const computeSpreadEnabled = computeWnbaPrediction(
  fixtureModel,
  { id: 999, date: "2026-06-27", h: 30, a: 10 },
  fixtureOdds,
);

check("compute flags off leaves spread on raw side", computeDisabled.spread.side === "PHX +6.5");
check("compute spread recommendation stays on the displayed projection ATS side", computeSpreadEnabled.spread.side === "PHX +6.5");
const displayedHomeMargin = computeSpreadEnabled.projected_score.home - computeSpreadEnabled.projected_score.away;
const displayedHomeCovers = displayedHomeMargin - 6.5 > 0;
check(
  "WNBA spread pick cannot oppose the ATS side implied by the displayed score",
  displayedHomeCovers
    ? computeSpreadEnabled.spread.side === "TOR -6.5"
    : computeSpreadEnabled.spread.side === "PHX +6.5",
);
check("compute total recommendation flag off leaves total side unchanged", computeSpreadEnabled.total.side === computeDisabled.total.side);
check("compute moneyline remains unchanged by spread calibration", computeSpreadEnabled.moneyline.side === computeDisabled.moneyline.side);
check("compute total grade calibration avoids unvalidated total Best Angle", computeSpreadEnabled.total.grade !== "Best Angle");
check("compute records spread recommendation-used audit", computeSpreadEnabled.wnba_core_model_calibration.recommendation_uses_calibrated_spread === true);
check("compute keeps raw model margin for audit", computeSpreadEnabled.model.margin === computeDisabled.model.margin);
check(
  "WNBA Playbook tip overrides stale provider anchor",
  selectPreferredWnbaTipTime(["2026-07-03T00:00:00Z"], "2026-07-01T17:35:00Z") === "2026-07-03T00:00:00Z",
);
check(
  "WNBA preferred tip chooses nearest Playbook meeting",
  selectPreferredWnbaTipTime(["2026-07-03T00:00:00Z", "2026-07-04T00:00:00Z"], "2026-07-03T01:00:00Z") === "2026-07-03T00:00:00Z",
);
check("WNBA preferred tip returns null without Playbook schedule", selectPreferredWnbaTipTime([], "2026-07-01T17:35:00Z") === null);
restoreEnv();

if (fail > 0) {
  console.error(`wnba core model calibration tests: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log(`wnba core model calibration tests: ${pass} passed, ${fail} failed`);
