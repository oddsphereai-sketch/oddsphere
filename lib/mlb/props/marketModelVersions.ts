import { BATTER_HITS_PA_MODEL_VERSION } from "./batterHitsPaModel";
import { BATTER_HRR_MODEL_VERSION } from "./batterHrrCountModel";
import { BATTER_HOME_RUNS_RESIDUAL_MODEL_VERSION } from "./batterHomeRunsResidualModel";
import { MLB_PROP_MARKET_KEYS, type MlbPropMarketKey } from "./config";
import { getMlbPropMarketDefinition } from "./marketCatalog";
import { MLB_PROPS_MARKET_AWARE_CONTEXT_RELEASE } from "./marketAwareContext";

// Immutable behavioral release stamp for the complete member-board scoring bundle.
// Any change that can alter a projection, probability, grade, promotion/demotion,
// or stake must bump this value before deployment. Per-market versions remain
// below for attribution; this release id prevents reports from silently mixing
// boards produced by different combinations of market logic.
export const MLB_PROPS_MODEL_RELEASE_ID = "mlb_props_2026_09_02_r40";

const DEDICATED_MARKET_MODEL_VERSIONS: Partial<Record<MlbPropMarketKey, string>> = {
  pitcher_strikeouts: "pitcher_strikeouts_distribution_v6_weak_baseline_market_control_display_projection_calibration_r1",
  pitcher_outs: "pitcher_outs_peer_consensus_compact_core_v6_mixed_role_workload_guard",
  pitcher_walks: "pitcher_walks_distribution_v1_conservative_over_market_only_calibrated",
  pitcher_earned_runs: "pitcher_earned_runs_distribution_v2_watchlist_only_display_projection_calibration_r1",
  pitcher_hits_allowed: "pitcher_hits_allowed_distribution_v1_conservative_display_projection_calibration_r1",
  batter_hits: `${BATTER_HITS_PA_MODEL_VERSION}_actionability_v6_uncapped_validated_under_best_angle`,
  batter_hits_runs_rbis: `${BATTER_HRR_MODEL_VERSION}_actionability_v6_empirical_market_anchored_under_accuracy_display_projection_calibration_r1`,
  batter_total_bases: "batter_total_bases_event_distribution_integrated_read_v3_watchlist_only_display_projection_calibration_r1",
  batter_home_runs: `${BATTER_HOME_RUNS_RESIDUAL_MODEL_VERSION}_actionability_v4_three_play_plus_medium_price_complement`,
  batter_rbis: "batter_rbi_context_opportunity_integrated_read_v3_value_portfolio",
  batter_runs_scored: "batter_runs_context_opportunity_integrated_read_v4_unvalidated_special_promotion_removed",
  batter_singles: "batter_singles_event_distribution_integrated_read_v5_under_lean_only",
  batter_doubles: "batter_doubles_market_residual_v1_actionability_v2_empirical_market_under_accuracy",
  batter_strikeouts: "batter_strikeouts_event_distribution_integrated_read_v2_empirical_market_over_accuracy_display_projection_calibration_r1",
  batter_walks: "batter_walks_event_distribution_integrated_read_v2_under_lean_only",
};

export function activeMlbPropMarketModelVersion(marketKey: MlbPropMarketKey): string {
  const dedicated = DEDICATED_MARKET_MODEL_VERSIONS[marketKey];
  const base = dedicated ?? (() => {
    const definition = getMlbPropMarketDefinition(marketKey);
    return definition.family === "batter"
    ? `${definition.modelFamily}_integrated_read_v1`
    : `${definition.modelFamily}_v1_conservative`;
  })();
  return `${base}__${MLB_PROPS_MARKET_AWARE_CONTEXT_RELEASE}`;
}

export function activeMlbPropMarketModelVersions(): Record<MlbPropMarketKey, string> {
  return Object.fromEntries(
    MLB_PROP_MARKET_KEYS.map((marketKey) => [marketKey, activeMlbPropMarketModelVersion(marketKey)]),
  ) as Record<MlbPropMarketKey, string>;
}
