import assert from "node:assert/strict";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";
import {
  applyMlbMoneylineActionPromotionStability,
  type ExistingPredictionRecordState,
} from "../lib/services/predictionRecordService";
import { DAILY_EDGE_ACTION_PROMOTION_STABILITY_CONTRACT_RELEASE } from "../lib/services/dailyEdge/actionPromotionStability";
import { MLB_MODEL_LAYER_VERSION_IDS } from "../lib/automodel/mlbModelLayerVersions";

function candidate(args: {
  publishedAt: string;
  probability?: number;
  price?: number;
}): PredictionRecordRow {
  const price = args.price ?? -140;
  return {
    game_id: 56018,
    sport: "mlb",
    slate_date: "2026-08-29",
    market: "moneyline",
    pick: "home",
    side: "home",
    line_value: null,
    odds_american: price,
    model_probability: args.probability ?? 0.62,
    model_version: "auto_v2.2_mlb_full_game_projection",
    calibration_version: "mlb_public_calibration_v27_strong_winner_resistance_lean_2026_08_22",
    play_grade: "best_angle",
    best_angle: true,
    no_bet: false,
    no_bet_reason: null,
    published_at: args.publishedAt,
    snapshot_json: {
      model_layer_versions: {
        active_probability_head: MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
        moneyline_probability_head: MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
      },
      ml_evaluation_price: {
        evaluated_book: "saba",
        evaluated_odds: price,
        evaluated_observed_at: args.publishedAt,
      },
      decision_pipeline: {
        board_action: "bet",
        actionable_grade: "best_angle",
        action_rule_id: "candidate_best_angle",
        grade_source: "model",
      },
      member_facing_at_lock: {
        play_grade: "best_angle",
        best_angle: true,
        no_bet: false,
      },
    },
  } as unknown as PredictionRecordRow;
}

function existingFrom(
  row: PredictionRecordRow,
  overrides: Partial<ExistingPredictionRecordState> = {},
): ExistingPredictionRecordState {
  return {
    game_id: row.game_id,
    market: row.market,
    model_version: row.model_version,
    slate_date: row.slate_date,
    pick: row.pick,
    side: row.side,
    line_value: row.line_value,
    odds_american: row.odds_american,
    odds_decimal: row.odds_decimal,
    model_used: row.model_used,
    prediction_source: row.prediction_source,
    confidence: row.confidence,
    model_probability: row.model_probability,
    market_probability: row.market_probability,
    edge: row.edge,
    expected_value: row.expected_value,
    play_grade: row.play_grade,
    prediction_type: row.prediction_type,
    best_angle: row.best_angle,
    no_bet: row.no_bet,
    no_bet_reason: row.no_bet_reason,
    market_aligned: row.market_aligned,
    data_quality_tier: row.data_quality_tier,
    source_quality: row.source_quality,
    provisional: row.provisional,
    held: row.held,
    hold_reason: row.hold_reason,
    launch_day: row.launch_day,
    manual_outcome_expected: row.manual_outcome_expected,
    published_at: row.published_at,
    calibration_version: row.calibration_version,
    snapshot_json: row.snapshot_json,
    ...overrides,
  };
}

assert.equal(
  MLB_MODEL_LAYER_VERSION_IDS.moneyline_action_promotion_stability,
  DAILY_EDGE_ACTION_PROMOTION_STABILITY_CONTRACT_RELEASE,
);

const priorSnapshot = {
  model_layer_versions: {
    active_probability_head: MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
    moneyline_probability_head: MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
  },
  ml_evaluation_price: {
    evaluated_book: "betrivers",
    evaluated_odds: -130,
    evaluated_observed_at: "2026-08-29T16:59:30.000Z",
  },
  decision_pipeline: {
    board_action: "no_play",
    action_rule_id: null,
    grade_source: "model",
  },
  member_facing_at_lock: {
    play_grade: null,
    best_angle: false,
    no_bet: true,
  },
  tracking_identity: {
    key: "mlb:56018:moneyline:2026-08-29",
    source_prediction_computed_at: "2026-08-29T17:00:00.000Z",
  },
};
const priorNoPlay = existingFrom(candidate({
  publishedAt: "2026-08-29T17:00:00.000Z",
  probability: 0.54,
  price: -130,
}), {
  confidence: 54,
  market_probability: 0.51,
  edge: 0.03,
  expected_value: -0.01,
  odds_decimal: 1.77,
  model_used: "v2_1",
  prediction_source: "automodel",
  prediction_type: "game_ml",
  play_grade: null,
  best_angle: false,
  no_bet: true,
  no_bet_reason: "line_movement_against_pick",
  market_aligned: false,
  data_quality_tier: "high",
  source_quality: "verified",
  provisional: false,
  held: false,
  hold_reason: null,
  launch_day: false,
  manual_outcome_expected: false,
  snapshot_json: priorSnapshot,
});
const first = applyMlbMoneylineActionPromotionStability(
  candidate({ publishedAt: "2026-08-29T17:15:00.000Z" }),
  priorNoPlay,
);
assert.equal(first.no_bet, true);
assert.equal(first.best_angle, false);
assert.equal(first.no_bet_reason, "line_movement_against_pick");
assert.equal(first.odds_american, -130, "pending promotion retains the prior public price");
assert.equal(first.model_probability, 0.54, "pending promotion retains prior model probability");
assert.equal(first.market_probability, 0.51, "pending promotion retains prior market probability");
assert.equal(first.edge, 0.03, "pending promotion retains prior edge");
assert.equal(first.expected_value, -0.01, "pending promotion retains prior expected value");
assert.equal(first.odds_decimal, 1.77, "pending promotion retains prior decimal price");
assert.equal(first.prediction_type, "game_ml", "pending promotion retains prior tracking market identity");
assert.equal(first.data_quality_tier, "high", "pending promotion retains prior data-health identity");
assert.equal(first.published_at, "2026-08-29T17:00:00.000Z", "pending promotion retains prior tuple time");
const firstSnapshot = first.snapshot_json as Record<string, unknown>;
const firstDecision = firstSnapshot.decision_pipeline as Record<string, unknown>;
const firstCandidate = firstSnapshot.action_promotion_candidate_v1 as Record<string, unknown>;
assert.deepEqual(firstSnapshot.ml_evaluation_price, priorSnapshot.ml_evaluation_price);
assert.deepEqual(firstSnapshot.model_layer_versions, priorSnapshot.model_layer_versions);
assert.deepEqual(firstSnapshot.tracking_identity, priorSnapshot.tracking_identity);
assert.equal(firstDecision.transition_candidate_grade, "best_angle");
assert.equal(firstDecision.transition_final_grade, "no_play");
assert.equal(firstCandidate.published_at, "2026-08-29T17:15:00.000Z");
assert.equal(firstCandidate.odds_american, -140);

const retry = applyMlbMoneylineActionPromotionStability(
  candidate({ publishedAt: "2026-08-29T17:15:00.000Z", price: -139 }),
  existingFrom(first),
);
assert.equal(retry.best_angle, false, "same-cycle retry cannot promote");

const confirmed = applyMlbMoneylineActionPromotionStability(
  candidate({ publishedAt: "2026-08-29T17:30:00.000Z", price: -142 }),
  existingFrom(retry),
);
assert.equal(confirmed.best_angle, false, "two cycles inside 20 minutes remain pending");

const elapsedConfirmation = applyMlbMoneylineActionPromotionStability(
  candidate({ publishedAt: "2026-08-29T17:40:00.000Z", price: -142 }),
  existingFrom(confirmed),
);
assert.equal(elapsedConfirmation.best_angle, true, "distinct cycles plus 20 elapsed minutes confirm promotion");
assert.equal(elapsedConfirmation.no_bet, false);

const negativeEv = applyMlbMoneylineActionPromotionStability(
  candidate({ publishedAt: "2026-08-29T17:45:00.000Z", probability: 0.579234, price: -148 }),
  existingFrom(elapsedConfirmation),
);
assert.equal(negativeEv.best_angle, true, "MLB retains its validated rule-specific economics");
assert.equal(negativeEv.no_bet, false);

const incoherent = candidate({ publishedAt: "2026-08-29T18:00:00.000Z" });
const incoherentSnapshot = incoherent.snapshot_json as Record<string, unknown>;
const incoherentEvaluation = incoherentSnapshot.ml_evaluation_price as Record<string, unknown>;
incoherentEvaluation.evaluated_odds = -999;
const rejected = applyMlbMoneylineActionPromotionStability(incoherent, existingFrom(elapsedConfirmation));
assert.equal(rejected.no_bet_reason, "incoherent_exact_price");

console.log("MLB action promotion stability integration tests passed");
