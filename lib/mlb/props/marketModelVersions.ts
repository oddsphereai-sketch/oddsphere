import { BATTER_HITS_PA_MODEL_VERSION } from "./batterHitsPaModel";
import { BATTER_HRR_MODEL_VERSION } from "./batterHrrCountModel";
import { MLB_PROP_MARKET_KEYS, type MlbPropMarketKey } from "./config";
import { getMlbPropMarketDefinition } from "./marketCatalog";

// Immutable behavioral release stamp for the complete member-board scoring bundle.
// Any change that can alter a projection, probability, grade, promotion/demotion,
// or stake must bump this value before deployment. Per-market versions remain
// below for attribution; this release id prevents reports from silently mixing
// boards produced by different combinations of market logic.
export const MLB_PROPS_MODEL_RELEASE_ID = "mlb_props_2026_07_23_r5";

const DEDICATED_MARKET_MODEL_VERSIONS: Partial<Record<MlbPropMarketKey, string>> = {
  pitcher_strikeouts: "pitcher_strikeouts_distribution_v4_market_safety_calibrated",
  pitcher_outs: "pitcher_outs_workload_distribution_v2_verified",
  pitcher_walks: "pitcher_walks_distribution_v2_market_calibrated",
  pitcher_earned_runs: "pitcher_earned_runs_distribution_v2_actionable_calibrated",
  batter_hits: BATTER_HITS_PA_MODEL_VERSION,
  batter_hits_runs_rbis: BATTER_HRR_MODEL_VERSION,
  batter_total_bases: "batter_total_bases_event_distribution_integrated_read_v2_calibrated",
  batter_home_runs: "batter_home_runs_rare_event_integrated_read_v4_downstream_discipline_fixed",
  batter_rbis: "batter_rbi_context_opportunity_integrated_read_v2_calibrated",
  batter_runs_scored: "batter_runs_context_opportunity_integrated_read_v2_calibrated",
  batter_doubles: "batter_doubles_event_distribution_integrated_read_v2_calibrated",
};

export function activeMlbPropMarketModelVersion(marketKey: MlbPropMarketKey): string {
  const dedicated = DEDICATED_MARKET_MODEL_VERSIONS[marketKey];
  if (dedicated) return dedicated;
  const definition = getMlbPropMarketDefinition(marketKey);
  return definition.family === "batter"
    ? `${definition.modelFamily}_integrated_read_v1`
    : `${definition.modelFamily}_v1_conservative`;
}

export function activeMlbPropMarketModelVersions(): Record<MlbPropMarketKey, string> {
  return Object.fromEntries(
    MLB_PROP_MARKET_KEYS.map((marketKey) => [marketKey, activeMlbPropMarketModelVersion(marketKey)]),
  ) as Record<MlbPropMarketKey, string>;
}
