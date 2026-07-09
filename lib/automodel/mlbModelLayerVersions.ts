/**
 * Forward-only MLB model layer stamp.
 *
 * Historical rows only stored a broad model_version such as
 * auto_v2.2_mlb_full_game_projection, which is not enough to compare weekly
 * correction layers. New prediction_records snapshots carry this object so
 * future audits can separate projection, market-specific probability heads,
 * grade policy, and correction policy.
 */

export type MlbModelLayerMarket = "moneyline" | "total" | "first_inning";

export const MLB_MODEL_LAYER_VERSION_SCHEMA = "mlb_model_layer_versions_v1";

export const MLB_MODEL_LAYER_VERSION_IDS = {
  projection_core: "mlb_projection_core_v2_2_baseline_2026_07_08",
  score_distribution: "mlb_score_distribution_poisson_skellam_v2_2_baseline_2026_07_08",
  moneyline_probability_head: "mlb_moneyline_launch_profile_cap3_champion_2026_07_09",
  total_probability_head: "mlb_total_grid_calibrated_k04_cap8_2026_07_09",
  first_inning_probability_head: "mlb_first_inning_launch_probability_side_champion_2026_07_08",
  market_calibration_policy: "mlb_model_market_calibration_baseline_2026_07_08",
  grade_policy: "mlb_public_grade_policy_calibrated_edge_scale_ou_no_confirm_gate_2026_07_09",
  correction_policy: "mlb_prediction_corrections_category_champions_2026_07_09",
  tracking_contract: "member_facing_lock_v1",
} as const;

const ACTIVE_PROBABILITY_HEAD_BY_MARKET: Record<MlbModelLayerMarket, string> = {
  moneyline: MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
  total: MLB_MODEL_LAYER_VERSION_IDS.total_probability_head,
  first_inning: MLB_MODEL_LAYER_VERSION_IDS.first_inning_probability_head,
};

export type MlbModelLayerVersions = typeof MLB_MODEL_LAYER_VERSION_IDS & {
  schema_version: typeof MLB_MODEL_LAYER_VERSION_SCHEMA;
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
    ...MLB_MODEL_LAYER_VERSION_IDS,
    market,
    active_probability_head: market === null ? null : ACTIVE_PROBABILITY_HEAD_BY_MARKET[market],
    runtime_env: {
      automodel_version: env.AUTOMODEL_VERSION ?? null,
      first_inning_model_version: env.FIRST_INNING_MODEL_VERSION ?? null,
    },
  };
}
