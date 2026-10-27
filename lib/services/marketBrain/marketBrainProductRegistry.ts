import {
  NFL_PLAYER_PROPS_RESEARCH_MARKETS,
} from "../football/nflPlayerPropsContract";
import {
  NBA_PLAYER_PROPS_RESEARCH_MARKETS,
} from "../nba/nbaPlayerPropsContract";
import { MLB_PROP_MARKET_KEYS } from "../../mlb/props/config";

export const MARKET_BRAIN_PRODUCT_REGISTRY_RELEASE =
  "market_brain_product_registry_2026_10_27_r2_surface_and_family_scope" as const;

export const MARKET_BRAIN_ACTIVE_PRODUCT_KEYS = [
  "nfl_daily_edge",
  "cfb_daily_edge",
  "nba_daily_edge",
  "wnba_daily_edge",
  "mlb_daily_edge",
  "nhl_daily_edge",
  "epl_daily_edge",
  "ucl_daily_edge",
  "soccer_world_cup_daily_edge",
  "nfl_player_props",
  "nba_player_props",
  "mlb_player_props",
] as const;

export const MARKET_BRAIN_PRELAUNCH_PRODUCT_KEYS = ["cbb_daily_edge"] as const;
export const MARKET_BRAIN_PRODUCT_KEYS = [
  ...MARKET_BRAIN_ACTIVE_PRODUCT_KEYS,
  ...MARKET_BRAIN_PRELAUNCH_PRODUCT_KEYS,
] as const;

export type MarketBrainActiveProductKey = typeof MARKET_BRAIN_ACTIVE_PRODUCT_KEYS[number];
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
export type MarketBrainProductLifecycle =
  | "member_active"
  | "member_feature_gated"
  | "private_forward_candidate"
  | "prelaunch";

export const MARKET_BRAIN_AUTHORITATIVE_WRITER_ROUTES = Object.freeze({
  nfl_forward_evidence: "app/api/cron/nfl-forward-evidence/route.ts",
  cfb_forward_evidence: "app/api/cron/cfb-forward-evidence/route.ts",
  nba_daily_refresh: "app/api/cron/nba-daily-refresh/route.ts",
  wnba_daily_refresh: "app/api/cron/wnba-daily-refresh/route.ts",
  morning_slate: "app/api/cron/morning-slate/route.ts",
  nhl_daily_refresh: "app/api/cron/nhl-daily-refresh/route.ts",
  epl_daily_refresh: "app/api/cron/epl-daily-refresh/route.ts",
  ucl_daily_refresh: "app/api/cron/ucl-daily-refresh/route.ts",
  soccer_daily_refresh: "app/api/cron/soccer-daily-refresh/route.ts",
  mlb_player_props_refresh: "app/api/cron/mlb-player-props-refresh/route.ts",
  pregame_sweep: "app/api/cron/pregame-sweep/route.ts",
} as const);

export type MarketBrainWriterId = keyof typeof MARKET_BRAIN_AUTHORITATIVE_WRITER_ROUTES;
export type MarketBrainQualificationScope = Readonly<{
  key: string;
  adapterState: MarketBrainImplementationState;
  adapterRelease: string | null;
  evaluationReceiptId: string | null;
  productionInfluenceAllowed: boolean;
}>;
export type MarketBrainAuthorityChain = Readonly<{
  captureAndModel: readonly MarketBrainWriterId[];
  predictionRecord: readonly MarketBrainWriterId[];
  grade: readonly MarketBrainWriterId[];
  stake: Readonly<{
    policy: "not_applicable" | "recommended_units";
    writers: readonly MarketBrainWriterId[];
  }>;
  lock: readonly MarketBrainWriterId[];
  memberSnapshot: readonly MarketBrainWriterId[];
  readerSurface: "candidate_daily_edge" | "player_props" | "mlb_player_props";
}>;

export type MarketBrainProductRegistration = Readonly<{
  key: MarketBrainProductKey;
  lifecycle: MarketBrainProductLifecycle;
  sport: "nfl" | "cfb" | "cbb" | "nba" | "wnba" | "mlb" | "nhl" | "soccer";
  competition: string;
  geometry: MarketBrainMarketGeometry;
  markets: readonly string[];
  /** Smallest units that must qualify independently; parent qualification never transfers. */
  qualificationScopeKeys: readonly string[];
  qualificationScopes: readonly MarketBrainQualificationScope[];
  independentPriorOwner: string;
  authoritativeWriter: MarketBrainWriterId | null;
  authorityChain: MarketBrainAuthorityChain | null;
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
    key: "nfl_daily_edge", lifecycle: "member_feature_gated", sport: "nfl", competition: "NFL", geometry: "two_team_score",
    markets: ["moneyline", "spread", "total"], independentPriorOwner: "NFL independent joint score distribution",
    qualificationScopes: [
      unqualifiedScope("moneyline", "research_executable"),
      unqualifiedScope("spread", "research_executable"),
      unqualifiedScope("total", "research_executable"),
    ],
    authoritativeWriter: "nfl_forward_evidence", predictionLease: "prediction_pipeline:nfl",
    authorityChain: singleWriterAuthority("nfl_forward_evidence", "candidate_daily_edge"),
    adapterState: "research_executable",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "availability", "weather"],
    releaseRegistrySection: "NFL Daily Edge generalized weekly production release",
  }),
  cfb_daily_edge: registration({
    key: "cfb_daily_edge", lifecycle: "member_feature_gated", sport: "cfb", competition: "NCAA Football", geometry: "two_team_score",
    markets: ["moneyline", "spread", "total"], independentPriorOwner: "CFB independent joint score distribution",
    authoritativeWriter: "cfb_forward_evidence", predictionLease: "prediction_pipeline:cfb",
    authorityChain: singleWriterAuthority("cfb_forward_evidence", "candidate_daily_edge"),
    adapterState: "not_started",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "availability", "weather"],
    releaseRegistrySection: "CFB Daily Edge generalized weekly production release",
  }),
  nba_daily_edge: registration({
    key: "nba_daily_edge", lifecycle: "member_active", sport: "nba", competition: "NBA", geometry: "two_team_score",
    markets: ["moneyline", "spread", "total"], independentPriorOwner: "NBA independent joint score distribution",
    authoritativeWriter: "nba_daily_refresh", predictionLease: "prediction_pipeline:nba",
    authorityChain: {
      captureAndModel: ["nba_daily_refresh", "pregame_sweep"], predictionRecord: ["pregame_sweep"],
      grade: ["pregame_sweep"], stake: { policy: "not_applicable", writers: [] }, lock: ["pregame_sweep"],
      memberSnapshot: ["nba_daily_refresh", "pregame_sweep"], readerSurface: "candidate_daily_edge",
    },
    adapterState: "not_started",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "availability", "roster_state"],
    releaseRegistrySection: "NBA regular-season champion",
  }),
  wnba_daily_edge: registration({
    key: "wnba_daily_edge", lifecycle: "member_active", sport: "wnba", competition: "WNBA", geometry: "two_team_score",
    markets: ["moneyline", "spread", "total"], independentPriorOwner: "WNBA independent joint score distribution",
    authoritativeWriter: "wnba_daily_refresh", predictionLease: "prediction_pipeline:wnba",
    authorityChain: {
      captureAndModel: ["wnba_daily_refresh"], predictionRecord: ["wnba_daily_refresh"],
      grade: ["wnba_daily_refresh"], stake: { policy: "not_applicable", writers: [] }, lock: ["wnba_daily_refresh", "pregame_sweep"],
      memberSnapshot: ["wnba_daily_refresh", "pregame_sweep"], readerSurface: "candidate_daily_edge",
    },
    adapterState: "not_started",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "availability"],
    releaseRegistrySection: "WNBA champion",
  }),
  mlb_daily_edge: registration({
    key: "mlb_daily_edge", lifecycle: "member_active", sport: "mlb", competition: "MLB", geometry: "two_team_score",
    markets: ["moneyline", "total", "first_inning"], independentPriorOwner: "MLB unified game distribution",
    qualificationScopeKeys: ["full_game_moneyline", "full_game_total", "first_inning_nrfi_yrfi"],
    authoritativeWriter: "morning_slate", predictionLease: "prediction_pipeline:mlb",
    authorityChain: {
      captureAndModel: ["morning_slate", "pregame_sweep"], predictionRecord: ["pregame_sweep"],
      grade: ["morning_slate", "pregame_sweep"], stake: { policy: "not_applicable", writers: [] }, lock: ["pregame_sweep"],
      memberSnapshot: ["pregame_sweep"], readerSurface: "candidate_daily_edge",
    },
    adapterState: "not_started",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "lineups", "probable_pitchers", "weather"],
    releaseRegistrySection: "MLB champion",
  }),
  nhl_daily_edge: registration({
    key: "nhl_daily_edge", lifecycle: "member_active", sport: "nhl", competition: "NHL", geometry: "two_team_score",
    markets: ["moneyline", "spread", "total"], independentPriorOwner: "NHL coherent Poisson score distribution",
    authoritativeWriter: "nhl_daily_refresh", predictionLease: "prediction_pipeline:nhl",
    authorityChain: {
      captureAndModel: ["nhl_daily_refresh", "pregame_sweep"], predictionRecord: ["nhl_daily_refresh", "pregame_sweep"],
      grade: ["nhl_daily_refresh", "pregame_sweep"], stake: { policy: "not_applicable", writers: [] }, lock: ["pregame_sweep"],
      memberSnapshot: ["nhl_daily_refresh", "pregame_sweep"], readerSurface: "candidate_daily_edge",
    },
    adapterState: "not_started",
    expectedEvidenceFamilies: ["two_sided_prices", "same_book_chronology", "identified_splits", "public_splits", "availability", "goalie_state"],
    releaseRegistrySection: "NHL regular-season champion",
  }),
  epl_daily_edge: registration({
    key: "epl_daily_edge", lifecycle: "member_feature_gated", sport: "soccer", competition: "Premier League", geometry: "three_way_goal_score",
    markets: ["match_result", "double_chance", "total", "btts"], independentPriorOwner: "EPL coherent regulation-time goal distribution",
    authoritativeWriter: "epl_daily_refresh", predictionLease: "prediction_pipeline:soccer",
    authorityChain: singleWriterAuthority("epl_daily_refresh", "candidate_daily_edge"),
    adapterState: "not_started",
    expectedEvidenceFamilies: ["three_way_prices", "two_sided_prices", "same_book_chronology", "availability", "club_state"],
    releaseRegistrySection: "Premier League production release",
  }),
  ucl_daily_edge: registration({
    key: "ucl_daily_edge", lifecycle: "member_feature_gated", sport: "soccer", competition: "UEFA Champions League", geometry: "three_way_goal_score",
    markets: ["match_result", "double_chance", "total", "btts"], independentPriorOwner: "UCL coherent regulation-time goal distribution",
    authoritativeWriter: "ucl_daily_refresh", predictionLease: "prediction_pipeline:soccer",
    authorityChain: singleWriterAuthority("ucl_daily_refresh", "candidate_daily_edge"),
    adapterState: "not_started",
    expectedEvidenceFamilies: ["three_way_prices", "two_sided_prices", "same_book_chronology", "availability", "club_state"],
    releaseRegistrySection: "UEFA Champions League production release",
  }),
  soccer_world_cup_daily_edge: registration({
    key: "soccer_world_cup_daily_edge", lifecycle: "member_active", sport: "soccer", competition: "FIFA World Cup", geometry: "three_way_goal_score",
    markets: ["match_result", "double_chance", "total", "btts"], independentPriorOwner: "World Cup Dixon-Coles regulation-time goal distribution",
    authoritativeWriter: "soccer_daily_refresh", predictionLease: "prediction_pipeline:soccer",
    authorityChain: singleWriterAuthority("soccer_daily_refresh", "candidate_daily_edge"),
    adapterState: "not_started",
    expectedEvidenceFamilies: ["three_way_prices", "two_sided_prices", "same_book_chronology", "availability", "team_state"],
    releaseRegistrySection: "FIFA World Cup Daily Edge legacy production release",
  }),
  nfl_player_props: registration({
    key: "nfl_player_props", lifecycle: "member_active", sport: "nfl", competition: "NFL Player Props", geometry: "player_stat_distribution",
    markets: NFL_PLAYER_PROPS_RESEARCH_MARKETS, independentPriorOwner: "NFL player-prop stat distributions",
    authoritativeWriter: "nfl_forward_evidence", predictionLease: "prediction_pipeline:nfl",
    authorityChain: singleWriterAuthority("nfl_forward_evidence", "player_props"),
    adapterState: "not_started",
    expectedEvidenceFamilies: ["exact_prop_offers", "target_excluded_reference_offers", "same_line_chronology", "availability", "role_state", "game_context"],
    releaseRegistrySection: "NFL Player Props production release",
  }),
  nba_player_props: registration({
    key: "nba_player_props", lifecycle: "private_forward_candidate", sport: "nba", competition: "NBA Player Props", geometry: "player_stat_distribution",
    markets: NBA_PLAYER_PROPS_RESEARCH_MARKETS, independentPriorOwner: "NBA player-prop component distributions",
    authoritativeWriter: "nba_daily_refresh", predictionLease: "prediction_pipeline:nba",
    authorityChain: singleWriterAuthority("nba_daily_refresh", "player_props"),
    adapterState: "not_started",
    expectedEvidenceFamilies: ["exact_prop_offers", "target_excluded_reference_offers", "same_line_chronology", "availability", "role_state", "component_relationships"],
    releaseRegistrySection: "NBA regular-season champion",
  }),
  mlb_player_props: registration({
    key: "mlb_player_props", lifecycle: "member_active", sport: "mlb", competition: "MLB Player Props", geometry: "player_stat_distribution",
    markets: MLB_PROP_MARKET_KEYS, independentPriorOwner: "MLB player-prop stat distributions",
    authoritativeWriter: "mlb_player_props_refresh", predictionLease: "prediction_pipeline:mlb",
    authorityChain: {
      captureAndModel: ["mlb_player_props_refresh"],
      predictionRecord: ["mlb_player_props_refresh"],
      grade: ["mlb_player_props_refresh"],
      stake: { policy: "recommended_units", writers: ["mlb_player_props_refresh"] },
      lock: ["mlb_player_props_refresh", "pregame_sweep"],
      memberSnapshot: ["mlb_player_props_refresh", "pregame_sweep"],
      readerSurface: "mlb_player_props",
    },
    adapterState: "not_started",
    expectedEvidenceFamilies: ["exact_prop_offers", "target_excluded_reference_offers", "same_line_chronology", "lineups", "probable_pitchers", "weather", "role_state"],
    releaseRegistrySection: "MLB Player Props production release",
  }),
  cbb_daily_edge: registration({
    key: "cbb_daily_edge", lifecycle: "prelaunch", sport: "cbb", competition: "NCAA Basketball", geometry: "two_team_score",
    markets: ["moneyline", "spread", "total"], independentPriorOwner: "CBB independent joint score distribution (not yet qualified)",
    authoritativeWriter: null, predictionLease: "prediction_pipeline:cbb",
    authorityChain: null,
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
    if (row.key !== key || row.markets.length === 0 || row.qualificationScopeKeys.length === 0 ||
      new Set(row.qualificationScopeKeys).size !== row.qualificationScopeKeys.length ||
      row.qualificationScopes.map((scope) => scope.key).join("|") !== row.qualificationScopeKeys.join("|") ||
      row.expectedEvidenceFamilies.length === 0 ||
      row.qualificationRequired !== true || row.consequenceActions.join("|") !== GAME_ACTIONS.join("|") ||
      !row.predictionLease.startsWith("prediction_pipeline:") || !row.releaseRegistrySection) {
      throw new Error(`Market Brain product registration is incomplete: ${key}`);
    }
    if (row.adapterState !== "production_eligible" && row.productionInfluenceAllowed) {
      throw new Error(`Unqualified Market Brain adapter cannot influence production: ${key}`);
    }
    if (row.qualificationScopes.some((scope) =>
      scope.adapterState !== "production_eligible" && scope.productionInfluenceAllowed)) {
      throw new Error(`Unqualified Market Brain scope cannot influence production: ${key}`);
    }
    if (row.productionInfluenceAllowed && !row.qualificationScopes.every((scope) =>
      scope.adapterState === "production_eligible" && scope.productionInfluenceAllowed &&
      scope.adapterRelease !== null && scope.evaluationReceiptId !== null)) {
      throw new Error(`Product authority cannot transfer across unqualified scopes: ${key}`);
    }
    if (row.lifecycle !== "prelaunch" && (row.authoritativeWriter === null || row.authorityChain === null)) {
      throw new Error(`Active Market Brain product must resolve an authoritative writer: ${key}`);
    }
    if (row.authorityChain && ((row.authorityChain.stake.policy === "not_applicable" &&
      row.authorityChain.stake.writers.length > 0) ||
      (row.authorityChain.stake.policy === "recommended_units" &&
      row.authorityChain.stake.writers.length === 0))) {
      throw new Error(`Market Brain stake authority is ambiguous: ${key}`);
    }
    if (row.lifecycle === "prelaunch" && row.adapterState === "production_eligible") {
      throw new Error(`Prelaunch Market Brain adapter cannot be production eligible: ${key}`);
    }
  }
}

function registration(args: Omit<MarketBrainProductRegistration,
  "qualificationScopeKeys" | "qualificationScopes" | "consequenceActions" |
  "qualificationRequired" | "productionInfluenceAllowed"> & {
    qualificationScopeKeys?: readonly string[];
    qualificationScopes?: readonly MarketBrainQualificationScope[];
  }): MarketBrainProductRegistration {
  const scopeKeys = [...(args.qualificationScopeKeys ?? args.markets)];
  if (args.qualificationScopes === undefined && args.adapterState !== "not_started") {
    throw new Error(`Started Market Brain adapter requires explicit child scopes: ${args.key}`);
  }
  const qualificationScopes = args.qualificationScopes ?? scopeKeys.map((key) =>
    unqualifiedScope(key, "not_started"));
  return Object.freeze({
    ...args,
    markets: Object.freeze([...args.markets]),
    qualificationScopeKeys: Object.freeze(scopeKeys),
    qualificationScopes: Object.freeze(qualificationScopes.map((scope) => Object.freeze({ ...scope }))),
    authorityChain: args.authorityChain === null ? null : Object.freeze({
      ...args.authorityChain,
      captureAndModel: Object.freeze([...args.authorityChain.captureAndModel]),
      predictionRecord: Object.freeze([...args.authorityChain.predictionRecord]),
      grade: Object.freeze([...args.authorityChain.grade]),
      stake: Object.freeze({
        ...args.authorityChain.stake,
        writers: Object.freeze([...args.authorityChain.stake.writers]),
      }),
      lock: Object.freeze([...args.authorityChain.lock]),
      memberSnapshot: Object.freeze([...args.authorityChain.memberSnapshot]),
    }),
    expectedEvidenceFamilies: Object.freeze([...args.expectedEvidenceFamilies]),
    consequenceActions: GAME_ACTIONS,
    qualificationRequired: true,
    productionInfluenceAllowed: false,
  });
}

function unqualifiedScope(
  key: string,
  adapterState: Exclude<MarketBrainImplementationState, "production_eligible">,
): MarketBrainQualificationScope {
  return Object.freeze({
    key,
    adapterState,
    adapterRelease: null,
    evaluationReceiptId: null,
    productionInfluenceAllowed: false,
  });
}

function singleWriterAuthority(
  writer: MarketBrainWriterId,
  readerSurface: MarketBrainAuthorityChain["readerSurface"],
): MarketBrainAuthorityChain {
  return Object.freeze({
    captureAndModel: Object.freeze([writer]),
    predictionRecord: Object.freeze([writer]),
    grade: Object.freeze([writer]),
    stake: Object.freeze({ policy: "not_applicable" as const, writers: Object.freeze([]) }),
    lock: Object.freeze([writer]),
    memberSnapshot: Object.freeze([writer]),
    readerSurface,
  });
}
