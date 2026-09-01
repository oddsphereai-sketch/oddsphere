/**
 * Forward-only MLB model layer stamp.
 *
 * Historical rows only stored a broad model_version such as
 * auto_v2.2_mlb_full_game_projection, which is not enough to compare weekly
 * correction layers. New prediction_records snapshots carry this object so
 * future audits can separate projection, market-specific probability heads,
 * grade policy, and correction policy.
 */

import { resolveAutomodelVersion } from "./modelVersion";
import { resolveFirstInningModelVersion } from "./firstInningModelVersion";

export type MlbModelLayerMarket = "moneyline" | "total" | "first_inning";

export const MLB_MODEL_LAYER_VERSION_SCHEMA = "mlb_model_layer_versions_v10_first_inning_named_book_consensus";
export const MLB_PUBLIC_CALIBRATION_VERSION = "mlb_public_calibration_v29_first_inning_named_book_consensus_2026_09_01";
export const MLB_DAILY_EDGE_DECISION_RELEASE_ID = "mlb_daily_edge_decision_2026_09_01_r77_first_inning_named_book_consensus";
export const MLB_DAILY_EDGE_RULE_BUNDLE_VERSION = "mlb_daily_edge_rule_bundle_v65_first_inning_named_book_consensus_2026_09_01";

export const MLB_MODEL_LAYER_VERSION_IDS = {
  projection_core: "mlb_projection_core_v2_3_coherent_sharp_retail_joint_forecast_2026_09_01",
  score_distribution: "mlb_score_distribution_poisson_skellam_v2_2_baseline_2026_07_08",
  moneyline_probability_head: "mlb_moneyline_coherent_sharp_retail_probability_v2_2026_09_01",
  moneyline_portfolio_ranker: "mlb_ml_sharp_portfolio_ranker_v2_selected_side_floor_train_through_2026_07_31",
  moneyline_market_led_lean: "ml_market_led_toward_move_playable_price_lean_v2_2026_08_12",
  moneyline_neutral_consensus_grade: "ml_sharpapi_consensus_grade_continuity_v2_2026_08_13",
  moneyline_confidence_value_context_lean: "mlb_ml_confidence_value_context_lean_v1_2026_08_17",
  moneyline_evaluation_price_policy: "mlb_ml_fresh_coherent_best_playable_price_same_book_movement_v4_sharp_source_recovery_2026_09_01",
  moneyline_sharp_price_source: "mlb_sharp_moneyline_source_v2_targeted_complete_pair_recovery_2026_09_01",
  moneyline_action_promotion_stability: "daily_edge_action_promotion_stability_2026_08_29_r1",
  source_aware_split_pair_selector: "mlb_source_aware_split_pair_selector_v2_recency_coherent_2026_08_31",
  total_probability_head: "mlb_total_coherent_sharp_retail_probability_v2_2026_09_01",
  coherent_market_price_map: "mlb_coherent_market_price_map_v1_2026_09_01",
  total_market_support_lean: "total_sharpapi_money_over_tickets_support_lean_v1_2026_08_12",
  total_mean_selector_original_under_lean: "total_mean_selector_original_under_lean_v1_2026_08_13",
  total_confidence_value_context_lean: "mlb_total_confidence_value_context_lean_v1_2026_08_17",
  first_inning_probability_head: "mlb_first_inning_fi_v5_named_book_consensus_weight25_2026_09_01",
  first_inning_market_price_map: "mlb_first_inning_named_book_price_map_v1_2026_09_01",
  first_inning_market_calibration_policy: "mlb_first_inning_market_calibration_v2_named_book_consensus_2026_09_01",
  market_calibration_policy: "mlb_model_market_calibration_v2_coherent_group_consensus_2026_09_01",
  grade_policy: "mlb_public_grade_policy_v55_first_inning_named_book_consensus_2026_09_01",
  correction_policy: "mlb_prediction_corrections_v23_split_pair_recency_2026_08_31",
  tracking_contract: "member_facing_lock_v8_priority_retry_minute_cadence_2026_08_11",
  schedule_time_policy: "mlb_official_schedule_time_v1_2026_07_30",
} as const;

const ACTIVE_PROBABILITY_HEAD_BY_MARKET: Record<MlbModelLayerMarket, string> = {
  moneyline: MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
  total: MLB_MODEL_LAYER_VERSION_IDS.total_probability_head,
  first_inning: MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head,
};

export type MlbModelLayerVersions = typeof MLB_MODEL_LAYER_VERSION_IDS & {
  schema_version: typeof MLB_MODEL_LAYER_VERSION_SCHEMA;
  decision_release_id: typeof MLB_DAILY_EDGE_DECISION_RELEASE_ID;
  rule_bundle_version: typeof MLB_DAILY_EDGE_RULE_BUNDLE_VERSION;
  calibration_version: typeof MLB_PUBLIC_CALIBRATION_VERSION;
  market: MlbModelLayerMarket | null;
  active_probability_head: string | null;
  runtime_env: {
    automodel_version: string | null;
    first_inning_model_version: string | null;
  };
};

export function buildMlbModelLayerVersions(
  market: MlbModelLayerMarket | null,
  env: Record<string, string | undefined> = process.env,
): MlbModelLayerVersions {
  return {
    schema_version: MLB_MODEL_LAYER_VERSION_SCHEMA,
    decision_release_id: MLB_DAILY_EDGE_DECISION_RELEASE_ID,
    rule_bundle_version: MLB_DAILY_EDGE_RULE_BUNDLE_VERSION,
    calibration_version: MLB_PUBLIC_CALIBRATION_VERSION,
    ...MLB_MODEL_LAYER_VERSION_IDS,
    market,
    active_probability_head: market === null ? null : ACTIVE_PROBABILITY_HEAD_BY_MARKET[market],
    runtime_env: {
      automodel_version: resolveAutomodelVersion(env),
      first_inning_model_version: resolveFirstInningModelVersion(env),
    },
  };
}
