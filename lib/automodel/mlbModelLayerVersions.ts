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

export const MLB_MODEL_LAYER_VERSION_SCHEMA = "mlb_model_layer_versions_v2";
export const MLB_PUBLIC_CALIBRATION_VERSION = "mlb_public_calibration_v10_2026_07_27";
export const MLB_DAILY_EDGE_DECISION_RELEASE_ID = "mlb_daily_edge_decision_2026_07_27_r11";
export const MLB_DAILY_EDGE_RULE_BUNDLE_VERSION = "mlb_daily_edge_rule_bundle_v12_2026_07_27";

export const MLB_MODEL_LAYER_VERSION_IDS = {
  projection_core: "mlb_projection_core_v2_2_baseline_2026_07_08",
  score_distribution: "mlb_score_distribution_poisson_skellam_v2_2_baseline_2026_07_08",
  moneyline_probability_head: "mlb_moneyline_regularized_k01_cap6_champion_guardrails_2026_07_11",
  total_probability_head: "mlb_total_market_read_k04_cap8_thin_gap_guard_2026_07_11",
  first_inning_probability_head: "mlb_first_inning_fi_v2_signed_edge_price_gate_2026_07_11",
  market_calibration_policy: "mlb_model_market_calibration_baseline_2026_07_08",
  grade_policy: "mlb_public_grade_policy_v10_mid_price_ml_ladder_2026_07_25",
  correction_policy: "mlb_prediction_corrections_v7_total_support_preserved_2026_07_27",
  tracking_contract: "member_facing_lock_v4_edge_units_coherent_writer_authority_2026_07_27",
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
