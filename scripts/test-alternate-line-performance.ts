import {
  alternateLineOutcome,
  buildAlternateLineCategories,
} from "../lib/services/tracking/alternateLinePerformance";
import type {
  PredictionGradeRow,
  PredictionRecordRow,
} from "../lib/types/domain/Tracking";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

function record(input: Partial<PredictionRecordRow>): PredictionRecordRow {
  return {
    id: 1,
    game_prediction_id: null,
    game_id: 1,
    external_id: 1,
    sport: "nfl",
    slate_date: "2026-10-11",
    game_date: "2026-10-11",
    matchup: "AWAY @ HOME",
    market: "total",
    pick: "Over 45.5",
    side: "over",
    line_value: 45.5,
    odds_american: -110,
    odds_decimal: 1.91,
    model_used: "test",
    model_version: "test",
    prediction_source: "test",
    confidence: 55,
    model_probability: 0.55,
    market_probability: 0.5,
    edge: 0.05,
    expected_value: 0.02,
    play_grade: "lean",
    prediction_type: "game_total",
    best_angle: false,
    no_bet: false,
    no_bet_reason: null,
    market_aligned: true,
    data_quality_tier: "verified",
    source_quality: "verified",
    provisional: false,
    held: false,
    hold_reason: null,
    launch_day: false,
    manual_outcome_expected: false,
    locked_at: "2026-10-11T12:00:00.000Z",
    published_at: "2026-10-11T12:00:00.000Z",
    snapshot_json: null,
    calibration_version: "test",
    ...input,
  };
}

function grade(input: Partial<PredictionGradeRow>): PredictionGradeRow {
  return {
    id: 1,
    prediction_record_id: 1,
    game_id: 1,
    market: "total",
    result: "loss",
    push: false,
    win: false,
    loss: true,
    void: false,
    pending: false,
    actual_home_score: 24,
    actual_away_score: 20,
    actual_total: 44,
    actual_first_inning_runs: null,
    winning_team: "HOME",
    graded_at: "2026-10-11T23:00:00.000Z",
    grade_source: "auto_score_ingest",
    grade_notes: null,
    ...input,
  };
}

console.log("\n━━━ alternate line performance ━━━\n");

const over = record({ side: "over", line_value: 45.5 });
const overGrade = grade({ actual_total: 44 });
check("Over retains the locked-line loss at delta 0", alternateLineOutcome(over, overGrade, 0) === "loss");
check("Over receives a favorable lower total line", alternateLineOutcome(over, overGrade, 3) === "win");

const under = record({ id: 2, side: "under", pick: "Under 45.5", line_value: 45.5 });
const underGrade = grade({ prediction_record_id: 2, actual_home_score: 27, actual_away_score: 20, actual_total: 47 });
check("Under retains the locked-line loss at delta 0", alternateLineOutcome(under, underGrade, 0) === "loss");
check("Under receives a favorable higher total line", alternateLineOutcome(under, underGrade, 3) === "win");

const spread = record({ id: 3, market: "spread", prediction_type: "game_spread", side: "away", pick: "AWAY +1.5", line_value: 1.5 });
const spreadGrade = grade({ prediction_record_id: 3, market: "spread", actual_home_score: 24, actual_away_score: 20, actual_total: 44 });
check("Spread retains the locked-line loss at delta 0", alternateLineOutcome(spread, spreadGrade, 0) === "loss");
check("Spread adds points to the selected team's locked handicap", alternateLineOutcome(spread, spreadGrade, 3) === "win");

const categories = buildAlternateLineCategories([
  { record: over, grade: overGrade, displaySport: "nfl" },
  { record: under, grade: underGrade, displaySport: "nfl" },
  { record: spread, grade: spreadGrade, displaySport: "nfl" },
], { from: "2026-10-05", to: "2026-10-12" });
const total = categories.find((row) => row.market === "total");
const spreadCategory = categories.find((row) => row.market === "spread");
check("NFL Total exposes +3 and +6 point records", total?.adjustments.map((row) => row.label).join(",") === "+3 POINTS,+6 POINTS");
check("Same-sample main line preserves stored grades", total?.original.losses === 2 && total.original.wins === 0);
check("Favorable +3 Total regrade converts both test losses", total?.adjustments[0]?.metrics.wins === 2);
check("NFL Spread exposes +3 and +6 point records", spreadCategory?.adjustments.map((row) => row.label).join(",") === "+3 POINTS,+6 POINTS");

const mismatchedGrade = grade({ result: "win", win: true, loss: false });
const mismatch = buildAlternateLineCategories([
  { record: over, grade: mismatchedGrade, displaySport: "nfl" },
], { from: "2026-10-05", to: "2026-10-12" });
check("A delta-0 disagreement never reinterprets an immutable stored grade", mismatch.length === 0);

const ucl = buildAlternateLineCategories([
  {
    record: record({ id: 4, sport: "soccer", slate_date: "2026-09-08", line_value: 2.5 }),
    grade: grade({ prediction_record_id: 4, actual_home_score: 2, actual_away_score: 1, actual_total: 3, result: "win", win: true, loss: false }),
    displaySport: "ucl",
  },
], {
  from: "2026-06-07",
  to: "2026-10-12",
  source: "prior_release",
  sourceLabel: "Prior locked release",
});
check("UCL prior release exposes +0.5 and +1 goal records", ucl[0]?.adjustments.map((row) => row.label).join(",") === "+0.5 GOAL,+1 GOAL");
check("UCL prior release remains explicitly labeled and separate", ucl[0]?.source === "prior_release" && ucl[0].sourceLabel === "Prior locked release");

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);

