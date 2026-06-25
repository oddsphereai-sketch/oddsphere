/**
 * Market Intelligence v2 feature flags.
 *
 * Defaults are intentionally inert:
 *   - v2 collection/resolution disabled
 *   - v2 UI disabled
 *   - split features shadow-only
 *
 * This file is pure and safe to import from services/tests. It does not
 * trigger provider calls, DB reads, or DB writes.
 */

export const MARKET_INTELLIGENCE_V2_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_ENABLED";
export const MARKET_INTELLIGENCE_V2_UI_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_UI_ENABLED";
export const MARKET_SPLITS_MODEL_MODE_ENV = "MARKET_SPLITS_MODEL_MODE";

export type MarketSplitsModelMode = "shadow" | "limited" | "production";

export type MarketIntelligenceV2Config = {
  enabled: boolean;
  uiEnabled: boolean;
  splitsModelMode: MarketSplitsModelMode;
};

type EnvLike = Record<string, string | undefined>;

function strictTrue(v: string | undefined): boolean {
  return v === "true";
}

function readSplitsMode(v: string | undefined): MarketSplitsModelMode {
  return v === "limited" || v === "production" || v === "shadow"
    ? v
    : "shadow";
}

export function readMarketIntelligenceV2Config(
  env: EnvLike = process.env,
): MarketIntelligenceV2Config {
  return {
    enabled: strictTrue(env[MARKET_INTELLIGENCE_V2_ENABLED_ENV]),
    uiEnabled: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_ENABLED_ENV]),
    splitsModelMode: readSplitsMode(env[MARKET_SPLITS_MODEL_MODE_ENV]),
  };
}

export function marketSplitsAreProductionInput(
  config: MarketIntelligenceV2Config,
): boolean {
  return config.enabled && config.splitsModelMode === "production";
}
