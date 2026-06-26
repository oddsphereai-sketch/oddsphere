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
export const MARKET_INTELLIGENCE_V2_UI_MLB_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_UI_MLB_ENABLED";
export const MARKET_INTELLIGENCE_V2_UI_WNBA_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_UI_WNBA_ENABLED";
export const MARKET_INTELLIGENCE_V2_UI_NBA_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_UI_NBA_ENABLED";
export const MARKET_INTELLIGENCE_V2_UI_NFL_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_UI_NFL_ENABLED";
export const MARKET_INTELLIGENCE_V2_UI_NCAAF_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_UI_NCAAF_ENABLED";
export const MARKET_INTELLIGENCE_V2_UI_NCAAB_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_UI_NCAAB_ENABLED";
export const MARKET_INTELLIGENCE_V2_UI_NHL_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_UI_NHL_ENABLED";
export const MARKET_INTELLIGENCE_V2_UI_WNBA_ML_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_UI_WNBA_ML_ENABLED";
export const MARKET_INTELLIGENCE_V2_UI_WNBA_TOTAL_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_UI_WNBA_TOTAL_ENABLED";
export const MARKET_INTELLIGENCE_V2_UI_WNBA_SPREAD_ENABLED_ENV = "MARKET_INTELLIGENCE_V2_UI_WNBA_SPREAD_ENABLED";
export const MARKET_SPLITS_MODEL_MODE_ENV = "MARKET_SPLITS_MODEL_MODE";
export const MARKET_AWARE_ENGINE_ENABLED_ENV = "MARKET_AWARE_ENGINE_ENABLED";
export const LEGACY_MARKET_SIGNAL_GRADE_INFLUENCE_ENABLED_ENV =
  "LEGACY_MARKET_SIGNAL_GRADE_INFLUENCE_ENABLED";

export type MarketSplitsModelMode = "shadow" | "limited" | "production";

export type MarketIntelligenceV2Config = {
  enabled: boolean;
  uiEnabled: boolean;
  uiEnabledBySport: {
    mlb: boolean;
    wnba: boolean;
    nba: boolean;
    nfl: boolean;
    cfb: boolean;
    cbb: boolean;
    nhl: boolean;
  };
  uiEnabledByWnbaMarket: {
    moneyline: boolean;
    total: boolean;
    spread: boolean;
  };
  splitsModelMode: MarketSplitsModelMode;
  marketAwareEngineEnabled: boolean;
  legacyMarketSignalGradeInfluenceEnabled: boolean;
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
  const marketAwareEngineEnabled = strictTrue(env[MARKET_AWARE_ENGINE_ENABLED_ENV]);
  const legacyRequested =
    env[LEGACY_MARKET_SIGNAL_GRADE_INFLUENCE_ENABLED_ENV] === undefined
      ? true
      : strictTrue(env[LEGACY_MARKET_SIGNAL_GRADE_INFLUENCE_ENABLED_ENV]);
  return {
    enabled: strictTrue(env[MARKET_INTELLIGENCE_V2_ENABLED_ENV]),
    uiEnabled: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_ENABLED_ENV]),
    uiEnabledBySport: {
      mlb: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_MLB_ENABLED_ENV]),
      wnba: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_WNBA_ENABLED_ENV]),
      nba: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_NBA_ENABLED_ENV]),
      nfl: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_NFL_ENABLED_ENV]),
      cfb: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_NCAAF_ENABLED_ENV]),
      cbb: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_NCAAB_ENABLED_ENV]),
      nhl: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_NHL_ENABLED_ENV]),
    },
    uiEnabledByWnbaMarket: {
      moneyline: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_WNBA_ML_ENABLED_ENV]),
      total: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_WNBA_TOTAL_ENABLED_ENV]),
      spread: strictTrue(env[MARKET_INTELLIGENCE_V2_UI_WNBA_SPREAD_ENABLED_ENV]),
    },
    splitsModelMode: readSplitsMode(env[MARKET_SPLITS_MODEL_MODE_ENV]),
    marketAwareEngineEnabled,
    legacyMarketSignalGradeInfluenceEnabled: marketAwareEngineEnabled
      ? false
      : legacyRequested,
  };
}

export function marketSplitsAreProductionInput(
  config: MarketIntelligenceV2Config,
): boolean {
  return config.enabled && config.splitsModelMode === "production";
}

export function marketAwareEngineCanRun(
  config: MarketIntelligenceV2Config,
): boolean {
  return config.marketAwareEngineEnabled && !config.legacyMarketSignalGradeInfluenceEnabled;
}

export function marketIntelligenceV2UiEnabledForSport(
  config: MarketIntelligenceV2Config,
  sport: string,
): boolean {
  if (!config.uiEnabled) return false;
  if (sport === "mlb") return config.uiEnabledBySport.mlb;
  if (sport === "wnba") return config.uiEnabledBySport.wnba;
  if (sport === "nba") return config.uiEnabledBySport.nba;
  if (sport === "nfl") return config.uiEnabledBySport.nfl;
  if (sport === "cfb" || sport === "ncaaf") return config.uiEnabledBySport.cfb;
  if (sport === "cbb" || sport === "ncaab") return config.uiEnabledBySport.cbb;
  if (sport === "nhl") return config.uiEnabledBySport.nhl;
  return false;
}

export function marketIntelligenceV2UiEnabledForWnbaMarket(
  config: MarketIntelligenceV2Config,
  market: "moneyline" | "total" | "spread",
): boolean {
  if (!marketIntelligenceV2UiEnabledForSport(config, "wnba")) return false;
  return config.uiEnabledByWnbaMarket[market];
}
