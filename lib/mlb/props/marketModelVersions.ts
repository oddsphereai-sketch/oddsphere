import { BATTER_HITS_PA_MODEL_VERSION } from "./batterHitsPaModel";
import { BATTER_HRR_MODEL_VERSION } from "./batterHrrCountModel";
import { MLB_PROP_MARKET_KEYS, type MlbPropMarketKey } from "./config";
import { getMlbPropMarketDefinition } from "./marketCatalog";

const DEDICATED_MARKET_MODEL_VERSIONS: Partial<Record<MlbPropMarketKey, string>> = {
  pitcher_strikeouts: "pitcher_strikeouts_distribution_v3_verified",
  pitcher_outs: "pitcher_outs_workload_distribution_v2_verified",
  batter_hits: BATTER_HITS_PA_MODEL_VERSION,
  batter_hits_runs_rbis: BATTER_HRR_MODEL_VERSION,
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
