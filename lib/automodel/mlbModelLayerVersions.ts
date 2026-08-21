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

export const MLB_MODEL_LAYER_VERSION_SCHEMA = "mlb_model_layer_versions_v5";
export const MLB_PUBLIC_CALIBRATION_VERSION = "mlb_public_calibration_v25_coherent_playable_price_2026_08_21";
export const MLB_DAILY_EDGE_DECISION_RELEASE_ID = "mlb_daily_edge_decision_2026_08_21_r65";
export const MLB_DAILY_EDGE_RULE_BUNDLE_VERSION = "mlb_daily_edge_rule_bundle_v53_2026_08_21";

export const MLB_MODEL_LAYER_VERSION_IDS = {
  projection_core: "mlb_projection_core_v2_2_baseline_2026_07_08",
  score_distribution: "mlb_score_distribution_poisson_skellam_v2_2_baseline_2026_07_08",
  moneyline_probability_head: "mlb_moneyline_away_market_40_45_raw_side_champion_v1_2026_08_15",
  moneyline_portfolio_ranker: "mlb_ml_sharp_portfolio_ranker_v2_selected_side_floor_train_through_2026_07_31",
  moneyline_market_led_lean: "ml_market_led_toward_move_playable_price_lean_v2_2026_08_12",
  moneyline_neutral_consensus_grade: "ml_sharpapi_consensus_grade_continuity_v2_2026_08_13",
  moneyline_confidence_value_context_lean: "mlb_ml_confidence_value_context_lean_v1_2026_08_17",
  moneyline_evaluation_price_policy: "mlb_ml_fresh_coherent_best_playable_price_v1_2026_08_21",
  total_probability_head: "mlb_total_runtime_residual_guarded40_champion_v1_2026_08_15",
  total_market_support_lean: "total_sharpapi_money_over_tickets_support_lean_v1_2026_08_12",
  total_mean_selector_original_under_lean: "total_mean_selector_original_under_lean_v1_2026_08_13",
  total_confidence_value_context_lean: "mlb_total_confidence_value_context_lean_v1_2026_08_17",
  first_inning_probability_head: "mlb_first_inning_fi_v4_market_backed_weight25_2026_08_20",
  market_calibration_policy: "mlb_model_market_calibration_baseline_2026_07_08",
  grade_policy: "mlb_public_grade_policy_v43_coherent_playable_price_2026_08_21",
  correction_policy: "mlb_prediction_corrections_v17_price_only_promotion_ceiling_2026_08_21",
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
