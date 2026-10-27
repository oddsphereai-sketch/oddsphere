export const MARKET_BRAIN_PRODUCT_REGISTRY_RELEASE =
  "market_brain_product_registry_2026_10_27_r1_complete_active_product_scope" as const;

export const MARKET_BRAIN_ACTIVE_PRODUCT_KEYS = [
  "nfl_daily_edge",
  "cfb_daily_edge",
  "nba_daily_edge",
  "wnba_daily_edge",
  "mlb_daily_edge",
  "nhl_daily_edge",
  "epl_daily_edge",
  "ucl_daily_edge",
  "nfl_player_props",
  "nba_player_props",
  "mlb_player_props",
] as const;

export const MARKET_BRAIN_PRELAUNCH_PRODUCT_KEYS = ["cbb_daily_edge"] as const;
export const MARKET_BRAIN_PRODUCT_KEYS = [
  ...MARKET_BRAIN_ACTIVE_PRODUCT_KEYS,
  ...MARKET_BRAIN_PRELAUNCH_PRODUCT_KEYS,
] as const;

export type MarketBrainProductKey = typeof MARKET_BRAIN_PRODUCT_KEYS[number];
export type MarketBrainMarketGeometry =
  | "two_team_score"
  | "three_way_goal_score"
  | "player_stat_distribution";
export type MarketBrainImplementationState =
  | "not_started"
  | "contract_only"
  | "capture_only"
  | "research_executable"
  | "qualified_shadow"
  | "production_eligible";

export type MarketBrainProductRegistration = Readonly<{
  key: MarketBrainProductKey;
  lifecycle: "active" | "prelaunch";
  sport: "nfl" | "cfb" | "cbb" | "nba" | "wnba" | "mlb" | "nhl" | "soccer";
  competition: string;
  geometry: MarketBrainMarketGeometry;
  markets: readonly string[];
  independentPriorOwner: string;
  authoritativeWriter: string;
  predictionLease: `prediction_pipeline:${string}`;
  adapterState: MarketBrainImplementationState;
  expectedEvidenceFamilies: readonly string[];
  consequenceActions: readonly ["confirm", "recenter", "flip", "fade_market", "retain", "stand_down"];
  qualificationRequired: true;
  productionInfluenceAllowed: boolean;
  releaseRegistrySection: string;
}>;

const GAME_ACTIONS = [
  "confirm", "recenter", "flip", "fade_market", "retain", "stand_down",
] as const;

/**
 * Exhaustive registry for every active prediction product. A shared contract is
 * not permission to transfer NFL evidence, parameters, authority, or
 * qualification to another product. Each row needs its own adapter and proof.
 */
export const MARKET_BRAIN_PRODUCT_REGISTRY: Readonly<Record<
  MarketBrainProductKey,
  MarketBrainProductRegistration
>> = Object.freeze({
  nfl_daily_edge: registration({
    key: "nfl_daily_edge", lifecycle: "active", sport: "nfl", competition: "NFL", geometry: "two_team_score",
    markets: ["moneyline", "spread", "total"], independentPriorOwner: "NFL independent joint score distribution",
    authoritativeWriter: "nfl-forward-evidence", predictionLease: "prediction_pipeline:nfl",
    adapterState: "research_executable",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "availability", "weather"],
    releaseRegistrySection: "NFL Daily Edge generalized weekly production release",
  }),
  cfb_daily_edge: registration({
    key: "cfb_daily_edge", lifecycle: "active", sport: "cfb", competition: "NCAA Football", geometry: "two_team_score",
    markets: ["moneyline", "spread", "total"], independentPriorOwner: "CFB independent joint score distribution",
    authoritativeWriter: "cfb-forward-evidence", predictionLease: "prediction_pipeline:cfb",
    adapterState: "not_started",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "availability", "weather"],
    releaseRegistrySection: "CFB Daily Edge generalized weekly production release",
  }),
  nba_daily_edge: registration({
    key: "nba_daily_edge", lifecycle: "active", sport: "nba", competition: "NBA", geometry: "two_team_score",
    markets: ["moneyline", "spread", "total"], independentPriorOwner: "NBA independent joint score distribution",
    authoritativeWriter: "nba-combined-refresh", predictionLease: "prediction_pipeline:nba",
    adapterState: "not_started",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "availability", "roster_state"],
    releaseRegistrySection: "NBA regular-season champion",
  }),
  wnba_daily_edge: registration({
    key: "wnba_daily_edge", lifecycle: "active", sport: "wnba", competition: "WNBA", geometry: "two_team_score",
    markets: ["moneyline", "spread", "total"], independentPriorOwner: "WNBA independent joint score distribution",
    authoritativeWriter: "wnba-refresh", predictionLease: "prediction_pipeline:wnba",
    adapterState: "not_started",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "availability"],
    releaseRegistrySection: "WNBA champion",
  }),
  mlb_daily_edge: registration({
    key: "mlb_daily_edge", lifecycle: "active", sport: "mlb", competition: "MLB", geometry: "two_team_score",
    markets: ["moneyline", "run_line", "total", "first_inning"], independentPriorOwner: "MLB unified game distribution",
    authoritativeWriter: "mlb-daily-refresh", predictionLease: "prediction_pipeline:mlb",
    adapterState: "not_started",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "lineups", "probable_pitchers", "weather"],
    releaseRegistrySection: "MLB champion",
  }),
  nhl_daily_edge: registration({
    key: "nhl_daily_edge", lifecycle: "active", sport: "nhl", competition: "NHL", geometry: "two_team_score",
    markets: ["moneyline", "puck_line", "total"], independentPriorOwner: "NHL coherent Poisson score distribution",
    authoritativeWriter: "nhl-regular-refresh", predictionLease: "prediction_pipeline:nhl",
    adapterState: "not_started",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "availability", "goalie_state"],
    releaseRegistrySection: "NHL regular-season champion",
  }),
  epl_daily_edge: registration({
    key: "epl_daily_edge", lifecycle: "active", sport: "soccer", competition: "Premier League", geometry: "three_way_goal_score",
    markets: ["match_result", "double_chance", "total", "btts"], independentPriorOwner: "EPL coherent regulation-time goal distribution",
    authoritativeWriter: "soccer-production-refresh", predictionLease: "prediction_pipeline:soccer",
    adapterState: "not_started",
    expectedEvidenceFamilies: ["three_way_prices", "two_sided_prices", "same_book_chronology", "availability", "club_state"],
    releaseRegistrySection: "Premier League production release",
  }),
  ucl_daily_edge: registration({
    key: "ucl_daily_edge", lifecycle: "active", sport: "soccer", competition: "UEFA Champions League", geometry: "three_way_goal_score",
    markets: ["match_result", "double_chance", "total", "btts"], independentPriorOwner: "UCL coherent regulation-time goal distribution",
    authoritativeWriter: "soccer-production-refresh", predictionLease: "prediction_pipeline:soccer",
    adapterState: "not_started",
    expectedEvidenceFamilies: ["three_way_prices", "two_sided_prices", "same_book_chronology", "availability", "club_state"],
    releaseRegistrySection: "UEFA Champions League production release",
  }),
  nfl_player_props: registration({
    key: "nfl_player_props", lifecycle: "active", sport: "nfl", competition: "NFL Player Props", geometry: "player_stat_distribution",
    markets: ["player_prop"], independentPriorOwner: "NFL player-prop stat distributions",
    authoritativeWriter: "nfl-player-props-writer", predictionLease: "prediction_pipeline:nfl",
    adapterState: "not_started",
    expectedEvidenceFamilies: ["exact_prop_offers", "target_excluded_reference_offers", "same_line_chronology", "availability", "role_state", "game_context"],
    releaseRegistrySection: "NFL Player Props production release",
  }),
  nba_player_props: registration({
    key: "nba_player_props", lifecycle: "active", sport: "nba", competition: "NBA Player Props", geometry: "player_stat_distribution",
    markets: ["player_prop"], independentPriorOwner: "NBA player-prop component distributions",
    authoritativeWriter: "nba-player-props-private-writer", predictionLease: "prediction_pipeline:nba",
    adapterState: "not_started",
    expectedEvidenceFamilies: ["exact_prop_offers", "target_excluded_reference_offers", "same_line_chronology", "availability", "role_state", "component_relationships"],
    releaseRegistrySection: "NBA regular-season champion",
  }),
  mlb_player_props: registration({
    key: "mlb_player_props", lifecycle: "active", sport: "mlb", competition: "MLB Player Props", geometry: "player_stat_distribution",
    markets: ["player_prop"], independentPriorOwner: "MLB player-prop stat distributions",
    authoritativeWriter: "mlb-player-props-writer", predictionLease: "prediction_pipeline:mlb",
    adapterState: "not_started",
    expectedEvidenceFamilies: ["exact_prop_offers", "target_excluded_reference_offers", "same_line_chronology", "lineups", "probable_pitchers", "weather", "role_state"],
    releaseRegistrySection: "MLB Player Props production release",
  }),
  cbb_daily_edge: registration({
    key: "cbb_daily_edge", lifecycle: "prelaunch", sport: "cbb", competition: "NCAA Basketball", geometry: "two_team_score",
    markets: ["moneyline", "spread", "total"], independentPriorOwner: "CBB independent joint score distribution (not yet qualified)",
    authoritativeWriter: "cbb-authoritative-writer-required-before-launch", predictionLease: "prediction_pipeline:cbb",
    adapterState: "not_started",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "availability", "roster_state"],
    releaseRegistrySection: "Explicitly not active",
  }),
});

export function assertCompleteMarketBrainProductRegistry(): void {
  const keys = Object.keys(MARKET_BRAIN_PRODUCT_REGISTRY).sort();
  const expected = [...MARKET_BRAIN_PRODUCT_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error("Market Brain product registry does not cover every active prediction product.");
  }
  for (const key of MARKET_BRAIN_PRODUCT_KEYS) {
    const row = MARKET_BRAIN_PRODUCT_REGISTRY[key];
    if (row.key !== key || row.markets.length === 0 || row.expectedEvidenceFamilies.length === 0 ||
      row.qualificationRequired !== true || row.consequenceActions.join("|") !== GAME_ACTIONS.join("|") ||
      !row.predictionLease.startsWith("prediction_pipeline:") || !row.releaseRegistrySection) {
      throw new Error(`Market Brain product registration is incomplete: ${key}`);
    }
    if (row.adapterState !== "production_eligible" && row.productionInfluenceAllowed) {
      throw new Error(`Unqualified Market Brain adapter cannot influence production: ${key}`);
    }
    if (row.lifecycle === "prelaunch" && row.adapterState === "production_eligible") {
      throw new Error(`Prelaunch Market Brain adapter cannot be production eligible: ${key}`);
    }
  }
}

function registration(args: Omit<MarketBrainProductRegistration,
  "consequenceActions" | "qualificationRequired" | "productionInfluenceAllowed">): MarketBrainProductRegistration {
  return Object.freeze({
    ...args,
    markets: Object.freeze([...args.markets]),
    expectedEvidenceFamilies: Object.freeze([...args.expectedEvidenceFamilies]),
    consequenceActions: GAME_ACTIONS,
    qualificationRequired: true,
    productionInfluenceAllowed: false,
  });
}
