import {
  buildWnbaCoreModelCalibrationAudit,
  marketImpliedHomeMarginFromSpread,
} from "../lib/automodel/wnbaCoreModelCalibration";
import {
  computeWnbaPrediction,
  resolveWnbaSpreadEloStatAgreementLean,
  resolveWnbaSpreadProjectionRestLean,
  WNBA_SPREAD_ELO_STAT_AGREEMENT_RULE_ID,
  WNBA_SPREAD_PROJECTION_REST_RULE_ID,
  wnbaMoneylineGradeFromValue,
  type ModelState,
  type OddRow,
} from "../lib/services/wnba/buildWnbaDailyEdgePreview";
import { selectPreferredWnbaTipTime } from "../lib/services/wnba/refreshWnbaLines";
import {
  resolveWnbaPickedMoneylineProbabilities,
  WNBA_PREDICTION_RECORD_CONTRACT_VERSION,
} from "../lib/services/wnba/buildWnbaPredictionRecords";
import {
  EXPECTED_WNBA_GRADE_POLICY_VERSION,
  wnbaPredictionReleaseMismatches,
} from "../lib/automodel/wnbaChampionRuntime";
import { gradePrediction } from "../lib/services/predictionGrader";
import { resolveWnbaMoneylineSide } from "../lib/services/wnba/wnbaTeams";
import { applyPublicMarketContext } from "../lib/services/publicMarketContext";
import { resolveWnbaReaderGrade } from "../lib/services/wnba/buildWnbaDailyEdgeAdapted";
import {
  buildWnbaDecisionTuple,
  isWnbaDecisionTuple,
  selectWnbaEvaluatedPriceRow,
  WNBA_DECISION_TUPLE_CONTRACT_VERSION,
  type WnbaDecisionPriceRow,
} from "../lib/services/wnba/wnbaDecisionTuple";

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

check(
  "WNBA expansion nickname resolves to the canonical home side",
  resolveWnbaMoneylineSide("Fire", "POR", "LA") === "home",
);
check(
  "WNBA full expansion name resolves to the canonical home side",
  resolveWnbaMoneylineSide("Portland Fire", "POR", "LA") === "home",
);
check(
  "WNBA away nickname resolves to the canonical away side",
  resolveWnbaMoneylineSide("Sparks", "POR", "LA") === "away",
);
check(
  "WNBA abbreviation resolves without fragile display-name equality",
  resolveWnbaMoneylineSide("POR", "POR", "LA") === "home",
);
check(
  "WNBA city-only provider identity resolves canonically",
  resolveWnbaMoneylineSide("Portland", "POR", "LA") === "home",
);
check(
  "unknown WNBA team identity fails closed",
  resolveWnbaMoneylineSide("Unknown Club", "POR", "LA") === null,
);

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

check(
  "WNBA moneyline promotes a final 4pp edge with positive offered-price EV",
  wnbaMoneylineGradeFromValue({
    finalPickedProbability: 0.66,
    marketPickedProbability: 0.61,
    pickedOdds: -150,
    conflict: false,
    marketReliability: 0.9,
    bookCount: 6,
  }) === "Best Angle",
);
check(
  "WNBA moneyline does not promote a favorite whose final probability lacks price value",
  wnbaMoneylineGradeFromValue({
    finalPickedProbability: 0.7,
    marketPickedProbability: 0.65,
    pickedOdds: -300,
    conflict: false,
    marketReliability: 0.9,
    bookCount: 6,
  }) === "Watchlist",
);
check(
  "WNBA moneyline can promote a playable underdog instead of requiring an expensive favorite",
  wnbaMoneylineGradeFromValue({
    finalPickedProbability: 0.55,
    marketPickedProbability: 0.51,
    pickedOdds: 105,
    conflict: false,
    marketReliability: 0.8,
    bookCount: 5,
  }) === "Best Angle",
);
check(
  "WNBA total/spread public money cannot create action from a Watchlist",
  applyPublicMarketContext({
    grade: "Watchlist",
    picked: { public_betting_pct: 50, public_money_pct: 65 },
    opposite: { public_betting_pct: 50, public_money_pct: 35 },
    minGradeForBoost: "Best Angle",
    maxBoostGrade: "Best Angle",
  }).gradeAfter === "Watchlist",
);
check(
  "WNBA moneyline retains its established public-money promotion behavior",
  applyPublicMarketContext({
    grade: "Watchlist",
    picked: { public_betting_pct: 50, public_money_pct: 65 },
    opposite: { public_betting_pct: 50, public_money_pct: 35 },
  }).gradeAfter === "Lean",
);
const spreadAgreementPromotion = resolveWnbaSpreadEloStatAgreementLean({
  grade: "Watchlist",
  selectedSide: "home",
  eloMargin: 4.5,
  statMargin: 2,
  bookCount: 10,
  pickedOdds: -110,
  publicConflict: "none",
});
check(
  "WNBA home spread Elo/stat agreement promotes a priced 10-book Watchlist to Lean",
  spreadAgreementPromotion.promoted && spreadAgreementPromotion.grade === "Lean" && spreadAgreementPromotion.gap === 2.5,
);
check(
  "WNBA spread agreement rule refuses away sides",
  !resolveWnbaSpreadEloStatAgreementLean({
    grade: "Watchlist", selectedSide: "away", eloMargin: 4.5, statMargin: 2,
    bookCount: 10, pickedOdds: -110, publicConflict: "none",
  }).promoted,
);
check(
  "WNBA spread agreement rule fails closed below 10 books or under public resistance",
  !resolveWnbaSpreadEloStatAgreementLean({
    grade: "Watchlist", selectedSide: "home", eloMargin: 4.5, statMargin: 2,
    bookCount: 9, pickedOdds: -110, publicConflict: "opposing_money",
  }).promoted,
);
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

const computeDisabled = computeWnbaPrediction(
  fixtureModel,
  { id: 999, date: "2026-06-27", h: 30, a: 10 },
  fixtureOdds,
  {},
  {
    coreModelEnabled: false,
    totalProjectionCalibrationEnabled: false,
    spreadMarginCalibrationEnabled: false,
    totalRecommendationUsesCalibratedProjection: false,
    spreadRecommendationUsesCalibratedMargin: false,
    gradeCalibrationEnabled: false,
  },
);

const computeSpreadEnabled = computeWnbaPrediction(
  fixtureModel,
  { id: 999, date: "2026-06-27", h: 30, a: 10 },
  fixtureOdds,
);

const agreementOdds: OddRow[] = Array.from({ length: 10 }).flatMap((_, index) => {
  const book = `book${index}`;
  return [
    { book, sharp: index < 4, mkt: "moneyline", selType: "home", odds: -110, line: null, date: "2026-06-27", h: 30, a: 10 },
    { book, sharp: index < 4, mkt: "moneyline", selType: "away", odds: -110, line: null, date: "2026-06-27", h: 30, a: 10 },
    { book, sharp: index < 4, mkt: "point_spread", selType: "home", odds: -110, line: 6.5, date: "2026-06-27", h: 30, a: 10 },
    { book, sharp: index < 4, mkt: "point_spread", selType: "away", odds: -110, line: -6.5, date: "2026-06-27", h: 30, a: 10 },
    { book, sharp: index < 4, mkt: "total_points", selType: "over", odds: -110, line: 172.5, date: "2026-06-27", h: 30, a: 10 },
    { book, sharp: index < 4, mkt: "total_points", selType: "under", odds: -110, line: 172.5, date: "2026-06-27", h: 30, a: 10 },
  ];
});
const agreementCompute = computeWnbaPrediction(fixtureModel, { id: 1000, date: "2026-06-27", h: 30, a: 10 }, agreementOdds);
check(
  "WNBA spread agreement promotion is integrated and stamped",
  agreementCompute.spread.grade === "Lean" &&
    agreementCompute.spread_grade_policy.promoted === true &&
    agreementCompute.spread_grade_policy.rule_id === WNBA_SPREAD_ELO_STAT_AGREEMENT_RULE_ID,
);
const projectionRestLean = resolveWnbaSpreadProjectionRestLean({
  grade: "Watchlist",
  selectedSide: "away",
  selectedProjectionGap: 1.2,
  restDifference: -1,
  bookCount: 10,
  pickedOdds: -110,
  publicConflict: "none",
});
check(
  "WNBA side-agnostic projection/rest agreement promotes Watchlist spread to Lean",
  projectionRestLean.grade === "Lean" && projectionRestLean.promoted === true,
);
check(
  "WNBA projection/rest rule is stamped in the integrated policy audit",
  agreementCompute.spread_grade_policy.projection_rest_rule_id === WNBA_SPREAD_PROJECTION_REST_RULE_ID,
);
check(
  "WNBA projection/rest agreement rejects rest against the selected side",
  resolveWnbaSpreadProjectionRestLean({
    grade: "Watchlist",
    selectedSide: "away",
    selectedProjectionGap: 1.2,
    restDifference: 1,
    bookCount: 10,
    pickedOdds: -110,
    publicConflict: "none",
  }).promoted === false,
);
check(
  "WNBA projection/rest agreement requires an exact selected-side price",
  resolveWnbaSpreadProjectionRestLean({
    grade: "Watchlist",
    selectedSide: "away",
    selectedProjectionGap: 1.2,
    restDifference: -1,
    bookCount: 10,
    pickedOdds: null,
    publicConflict: "none",
  }).promoted === false,
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
check(
  "compute keeps the blended pre-calibration margin for audit",
  computeSpreadEnabled.model.components.blended_precalibration_margin === computeDisabled.model.margin,
);
check(
  "displayed score uses the exact canonical spread margin",
  Math.abs(displayedHomeMargin - computeSpreadEnabled.model.margin) <= 0.2,
);
check(
  "final ML winner and displayed projection winner agree",
  (computeSpreadEnabled.moneyline.side === computeSpreadEnabled.home) === (displayedHomeMargin > 0),
);
check(
  "WNBA Playbook tip overrides stale provider anchor",
  selectPreferredWnbaTipTime(["2026-07-03T00:00:00Z"], "2026-07-01T17:35:00Z") === "2026-07-03T00:00:00Z",
);
check(
  "WNBA preferred tip chooses nearest Playbook meeting",
  selectPreferredWnbaTipTime(["2026-07-03T00:00:00Z", "2026-07-04T00:00:00Z"], "2026-07-03T01:00:00Z") === "2026-07-03T00:00:00Z",
);
check("WNBA preferred tip returns null without Playbook schedule", selectPreferredWnbaTipTime([], "2026-07-01T17:35:00Z") === null);

const homeProbabilityContract = resolveWnbaPickedMoneylineProbabilities({
  pickedHome: true, independentHomeProbability: 0.58, finalHomeProbability: 0.54,
});
check(
  "WNBA tracking stores the final published home probability",
  homeProbabilityContract.publishedPickedProbability === 0.54 && homeProbabilityContract.independentPickedProbability === 0.58,
);
const awayProbabilityContract = resolveWnbaPickedMoneylineProbabilities({
  pickedHome: false, independentHomeProbability: 0.58, finalHomeProbability: 0.54,
});
check(
  "WNBA tracking complements both probability layers for an away pick",
  Math.abs(awayProbabilityContract.publishedPickedProbability - 0.46) < 1e-12 &&
    Math.abs(awayProbabilityContract.independentPickedProbability - 0.42) < 1e-12,
);
check(
  "WNBA prediction-record probability contract has a new immutable identifier",
  WNBA_PREDICTION_RECORD_CONTRACT_VERSION === "wnba_prediction_record_contract_v3_exact_decision_tuple_2026_08_21",
);
const decisionRows: WnbaDecisionPriceRow[] = [
  { market: "spread", side: "away", sportsbook: "fanduel", line: -3.5, priceAmerican: -115, observedAt: "2026-08-21T14:00:00Z" },
  { market: "spread", side: "home", sportsbook: "fanduel", line: 3.5, priceAmerican: -105, observedAt: "2026-08-21T14:00:00Z" },
  { market: "spread", side: "away", sportsbook: "betmgm", line: -3.5, priceAmerican: -110, observedAt: "2026-08-21T14:00:00Z" },
  { market: "spread", side: "home", sportsbook: "betmgm", line: 3.5, priceAmerican: -110, observedAt: "2026-08-21T14:00:00Z" },
  { market: "spread", side: "away", sportsbook: "circa", line: -3.5, priceAmerican: -105, observedAt: "2026-08-21T14:00:00Z" },
  { market: "spread", side: "home", sportsbook: "circa", line: 3.5, priceAmerican: -115, observedAt: "2026-08-21T14:00:00Z" },
];
const evaluatedSpread = selectWnbaEvaluatedPriceRow(decisionRows, "spread", "away", -3.5);
check(
  "WNBA decision tuple resolves the exact book row represented by the existing median price",
  evaluatedSpread?.priceAmerican === -110 && evaluatedSpread.sportsbook === "betmgm",
);
const spreadDecisionTuple = buildWnbaDecisionTuple({
  rows: decisionRows,
  market: "spread",
  side: "away",
  line: -3.5,
  modelProbability: 0.56,
  outcomeConfidence: 0.56,
  betGrade: "Lean",
  decisionAt: "2026-08-21T14:00:05Z",
});
check(
  "WNBA decision tuple freezes price, book, quote time, probabilities, grade, and release",
  spreadDecisionTuple?.contract_version === WNBA_DECISION_TUPLE_CONTRACT_VERSION &&
    spreadDecisionTuple.evaluated_price_american === -110 &&
    spreadDecisionTuple.evaluated_sportsbook === "betmgm" &&
    spreadDecisionTuple.evaluated_at === "2026-08-21T14:00:00Z" &&
    spreadDecisionTuple.decision_at === "2026-08-21T14:00:05Z" &&
    spreadDecisionTuple.model_probability === 0.56 &&
    spreadDecisionTuple.market_fair_probability === 0.5 &&
    spreadDecisionTuple.bet_grade === "Lean" &&
    isWnbaDecisionTuple(spreadDecisionTuple),
);
check(
  "WNBA decision tuple fails closed without a timestamped exact evaluated price",
  buildWnbaDecisionTuple({
    rows: decisionRows.map((row) => ({ ...row, observedAt: null })),
    market: "spread",
    side: "away",
    line: -3.5,
    modelProbability: 0.56,
    outcomeConfidence: 0.56,
    betGrade: "Lean",
    decisionAt: "2026-08-21T14:00:05Z",
  }) === null,
);
check(
  "WNBA record writer accepts only the exact current source release",
  wnbaPredictionReleaseMismatches({
    model_version: "wnba_v1_1_team_identity",
    distribution_version: "wnba_market_heads_value_calibrated_2026_08_02_v3",
    grade_policy_version: EXPECTED_WNBA_GRADE_POLICY_VERSION,
  }).length === 0,
);
check(
  "WNBA v6 reader preserves the authoritative writer Lean",
  resolveWnbaReaderGrade({
    gradePolicyVersion: EXPECTED_WNBA_GRADE_POLICY_VERSION,
    grade: "Lean",
    modelProbPick: 0.52,
    marketFairProbPick: 0.522,
    aligned: null,
  }) === "Lean",
);
check(
  "WNBA reader preserves the legacy cap for locked v5 history",
  resolveWnbaReaderGrade({
    gradePolicyVersion: "wnba_grade_policy_v5_projection_rest_spread_agreement_2026_08_12",
    grade: "Lean",
    modelProbPick: 0.52,
    marketFairProbPick: 0.522,
    aligned: null,
  }) === "Watchlist",
);
check(
  "WNBA record writer refuses stale or incomplete source releases",
  wnbaPredictionReleaseMismatches({
    model_version: "wnba_v1",
    distribution_version: "wnba_market_heads_value_calibrated_2026_08_02_v3",
  }).length === 2,
);

if (fail > 0) {
  console.error(`wnba core model calibration tests: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log(`wnba core model calibration tests: ${pass} passed, ${fail} failed`);
