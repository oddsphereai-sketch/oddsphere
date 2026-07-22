import { MLB_PROP_MARKET_KEYS, type MlbPropMarketKey } from "./config";
import type { PropGrade } from "./propGrades";

export type MlbPropMarketFamily = "pitcher" | "batter" | "milestone";
export type MlbPropMarketGroup = "Pitcher Strikeouts" | "Batter Strikeouts" | "Outs" | "Hits/Bases" | "Power" | "Walks" | "Runs/RBI" | "Speed" | "Research";
export type MlbPropDisplayStatus = "recommendation_eligible" | "watchlist" | "no_play" | "research_only";

export type MlbPropMarketDefinition = {
  marketKey: MlbPropMarketKey;
  label: string;
  family: MlbPropMarketFamily;
  marketGroup: MlbPropMarketGroup;
  displayGroup: string;
  settlementStatKey: string;
  modelFamily: string;
  requiredFeatures: string[];
  preferredFeatures: string[];
  optionalFeatures: string[];
  confidenceGates: { minimum: number; actionable: number };
  defaultGrade: PropGrade;
  twoWayEligible: boolean;
  milestone: boolean;
  recommendationEligibility: "eligible_now" | "watchlist_until_context" | "research_only";
  defaultDisplayStatus: MlbPropDisplayStatus;
  missingFeatureReasons: string[];
};

type MlbPropMarketBaseDefinition = Omit<MlbPropMarketDefinition, "marketGroup" | "displayGroup" | "requiredFeatures" | "preferredFeatures" | "optionalFeatures" | "confidenceGates" | "defaultGrade">;

const MLB_PROP_MARKET_BASE_CATALOG: Record<MlbPropMarketKey, MlbPropMarketBaseDefinition> = {
  pitcher_strikeouts: {
    marketKey: "pitcher_strikeouts",
    label: "Pitcher Strikeouts",
    family: "pitcher",
    settlementStatKey: "pitcher_strikeouts",
    modelFamily: "pitcher_strikeouts_distribution",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "eligible_now",
    defaultDisplayStatus: "recommendation_eligible",
    missingFeatureReasons: ["recent_logs_unavailable", "opponent_k_profile_unavailable"],
  },
  pitcher_outs: {
    marketKey: "pitcher_outs",
    label: "Pitcher Outs",
    family: "pitcher",
    settlementStatKey: "pitcher_outs",
    modelFamily: "pitcher_outs_workload_distribution",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "eligible_now",
    defaultDisplayStatus: "recommendation_eligible",
    missingFeatureReasons: ["recent_logs_unavailable", "bullpen_context_unavailable"],
  },
  pitcher_hits_allowed: {
    marketKey: "pitcher_hits_allowed",
    label: "Pitcher Hits Allowed",
    family: "pitcher",
    settlementStatKey: "pitcher_hits_allowed",
    modelFamily: "pitcher_hits_allowed_distribution",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["opponent_contact_profile_unavailable", "recent_logs_unavailable"],
  },
  pitcher_walks: {
    marketKey: "pitcher_walks",
    label: "Pitcher Walks",
    family: "pitcher",
    settlementStatKey: "pitcher_walks",
    modelFamily: "pitcher_walks_distribution",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["opponent_walk_profile_unavailable", "recent_logs_unavailable"],
  },
  pitcher_earned_runs: {
    marketKey: "pitcher_earned_runs",
    label: "Pitcher Earned Runs",
    family: "pitcher",
    settlementStatKey: "pitcher_earned_runs",
    modelFamily: "pitcher_earned_runs_distribution",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "eligible_now",
    defaultDisplayStatus: "recommendation_eligible",
    missingFeatureReasons: ["team_total_unavailable", "park_weather_context_unavailable"],
  },
  pitcher_record_a_win: {
    marketKey: "pitcher_record_a_win",
    label: "Pitcher Record A Win",
    family: "pitcher",
    settlementStatKey: "pitcher_win",
    modelFamily: "pitcher_win_context_proxy",
    twoWayEligible: false,
    milestone: true,
    recommendationEligibility: "research_only",
    defaultDisplayStatus: "research_only",
    missingFeatureReasons: ["PITCHER_WIN_CONTEXT_INSUFFICIENT"],
  },
  batter_strikeouts: {
    marketKey: "batter_strikeouts",
    label: "Batter Strikeouts",
    family: "batter",
    settlementStatKey: "batter_strikeouts",
    modelFamily: "batter_strikeouts_pa_distribution",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["lineup_spot_unavailable", "opposing_pitcher_k_profile_unavailable"],
  },
  batter_hits: {
    marketKey: "batter_hits",
    label: "Batter Hits",
    family: "batter",
    settlementStatKey: "batter_hits",
    modelFamily: "batter_hits_pa_distribution",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["lineup_spot_unavailable", "opposing_pitcher_contact_profile_unavailable"],
  },
  batter_total_bases: {
    marketKey: "batter_total_bases",
    label: "Total Bases",
    family: "batter",
    settlementStatKey: "batter_total_bases",
    modelFamily: "batter_total_bases_event_distribution",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["hit_type_rates_unavailable", "park_weather_context_unavailable"],
  },
  batter_home_runs: {
    marketKey: "batter_home_runs",
    label: "Home Runs",
    family: "batter",
    settlementStatKey: "batter_home_runs",
    modelFamily: "batter_home_runs_rare_event",
    twoWayEligible: false,
    milestone: true,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["power_context_unavailable", "opposing_pitcher_hr_profile_unavailable"],
  },
  batter_rbis: {
    marketKey: "batter_rbis",
    label: "RBIs",
    family: "batter",
    settlementStatKey: "batter_rbis",
    modelFamily: "batter_rbi_context_opportunity",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["LINEUP_CONTEXT_INSUFFICIENT", "team_total_unavailable"],
  },
  batter_runs_scored: {
    marketKey: "batter_runs_scored",
    label: "Runs Scored",
    family: "batter",
    settlementStatKey: "batter_runs_scored",
    modelFamily: "batter_runs_context_opportunity",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "eligible_now",
    defaultDisplayStatus: "recommendation_eligible",
    missingFeatureReasons: ["LINEUP_CONTEXT_INSUFFICIENT", "teammate_on_base_context_unavailable"],
  },
  batter_hits_runs_rbis: {
    marketKey: "batter_hits_runs_rbis",
    label: "Hits + Runs + RBIs",
    family: "batter",
    settlementStatKey: "batter_hits_runs_rbis",
    modelFamily: "batter_hrr_context_opportunity",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["LINEUP_CONTEXT_INSUFFICIENT", "team_total_unavailable"],
  },
  batter_singles: {
    marketKey: "batter_singles",
    label: "Singles",
    family: "batter",
    settlementStatKey: "batter_singles",
    modelFamily: "batter_singles_event_distribution",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["event_specific_rates_unavailable"],
  },
  batter_doubles: {
    marketKey: "batter_doubles",
    label: "Doubles",
    family: "batter",
    settlementStatKey: "batter_doubles",
    modelFamily: "batter_doubles_event_distribution",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["event_specific_rates_unavailable"],
  },
  batter_triples: {
    marketKey: "batter_triples",
    label: "Triples",
    family: "batter",
    settlementStatKey: "batter_triples",
    modelFamily: "batter_triples_rare_event",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["event_specific_rates_unavailable"],
  },
  batter_walks: {
    marketKey: "batter_walks",
    label: "Batter Walks",
    family: "batter",
    settlementStatKey: "batter_walks",
    modelFamily: "batter_walks_pa_distribution",
    twoWayEligible: true,
    milestone: false,
    recommendationEligibility: "watchlist_until_context",
    defaultDisplayStatus: "watchlist",
    missingFeatureReasons: ["lineup_spot_unavailable", "opposing_pitcher_control_profile_unavailable"],
  },
  batter_stolen_bases: {
    marketKey: "batter_stolen_bases",
    label: "Stolen Bases",
    family: "batter",
    settlementStatKey: "batter_stolen_bases",
    modelFamily: "batter_stolen_bases_opportunity",
    twoWayEligible: false,
    milestone: true,
    recommendationEligibility: "research_only",
    defaultDisplayStatus: "research_only",
    missingFeatureReasons: ["STOLEN_BASE_CONTEXT_INSUFFICIENT"],
  },
  first_home_run: {
    marketKey: "first_home_run",
    label: "First Home Run",
    family: "milestone",
    settlementStatKey: "first_home_run",
    modelFamily: "first_home_run_field_model",
    twoWayEligible: false,
    milestone: true,
    recommendationEligibility: "research_only",
    defaultDisplayStatus: "research_only",
    missingFeatureReasons: ["FIRST_HR_FIELD_MODEL_NOT_PROMOTED"],
  },
};

export const MLB_PROP_MARKET_CATALOG = Object.fromEntries(
  MLB_PROP_MARKET_KEYS.map((marketKey) => {
    const base = MLB_PROP_MARKET_BASE_CATALOG[marketKey];
    return [marketKey, {
      ...base,
      marketGroup: marketGroupFor(marketKey),
      displayGroup: base.family === "pitcher" ? "Pitcher" : base.family === "milestone" ? "Research" : "Batter",
      requiredFeatures: requiredFeaturesFor(marketKey),
      preferredFeatures: preferredFeaturesFor(marketKey),
      optionalFeatures: ["park_factor", "weather", "handedness_split", "recent_form"],
      confidenceGates: base.recommendationEligibility === "eligible_now"
        ? { minimum: 0.75, actionable: 0.82 }
        : base.recommendationEligibility === "watchlist_until_context"
          ? { minimum: 0.65, actionable: 0.85 }
          : { minimum: 0.9, actionable: 1 },
      defaultGrade: base.recommendationEligibility === "research_only" ? "RESEARCH" : base.defaultDisplayStatus === "watchlist" ? "WATCHLIST" : "NO_PLAY",
    } satisfies MlbPropMarketDefinition];
  }),
) as Record<MlbPropMarketKey, MlbPropMarketDefinition>;

export function getMlbPropMarketDefinition(marketKey: MlbPropMarketKey): MlbPropMarketDefinition {
  return MLB_PROP_MARKET_CATALOG[marketKey];
}

export function allMlbPropMarketDefinitions(): MlbPropMarketDefinition[] {
  return MLB_PROP_MARKET_KEYS.map((marketKey) => MLB_PROP_MARKET_CATALOG[marketKey]);
}

export function marketDisplayStatus(marketKey: MlbPropMarketKey, confidence: number, hasTwoWayPair: boolean): MlbPropDisplayStatus {
  const definition = getMlbPropMarketDefinition(marketKey);
  if (definition.recommendationEligibility === "research_only") return "research_only";
  if (!hasTwoWayPair) return "no_play";
  if (definition.recommendationEligibility === "eligible_now" && confidence >= 0.75) return "recommendation_eligible";
  return "watchlist";
}

function marketGroupFor(marketKey: MlbPropMarketKey): MlbPropMarketGroup {
  if (marketKey === "pitcher_strikeouts") return "Pitcher Strikeouts";
  if (marketKey === "batter_strikeouts") return "Batter Strikeouts";
  if (marketKey === "pitcher_outs") return "Outs";
  if (marketKey.includes("walks")) return "Walks";
  if (["batter_hits", "batter_total_bases", "batter_singles", "batter_doubles", "batter_triples", "pitcher_hits_allowed"].includes(marketKey)) return "Hits/Bases";
  if (["batter_home_runs", "first_home_run"].includes(marketKey)) return marketKey === "first_home_run" ? "Research" : "Power";
  if (["batter_rbis", "batter_runs_scored", "batter_hits_runs_rbis", "pitcher_earned_runs"].includes(marketKey)) return "Runs/RBI";
  if (marketKey === "batter_stolen_bases") return "Speed";
  return "Research";
}

function requiredFeaturesFor(marketKey: MlbPropMarketKey): string[] {
  if (marketKey.startsWith("pitcher_")) {
    if (marketKey === "pitcher_record_a_win") return ["starter_confirmation", "team_win_context", "workload_projection"];
    return ["starter_confirmation", "season_rate", "workload_projection", "two_way_odds"];
  }
  if (marketKey === "first_home_run") return ["field_wide_hr_probabilities", "batting_order", "milestone_odds"];
  if (["batter_rbis", "batter_runs_scored", "batter_hits_runs_rbis"].includes(marketKey)) return ["plate_appearance_projection", "projected_or_confirmed_lineup", "team_run_context", "two_way_odds"];
  if (marketKey === "batter_stolen_bases") return ["times_on_base_projection", "steal_attempt_rate", "opposing_battery_context"];
  if (marketKey === "batter_home_runs") return ["plate_appearance_projection", "home_run_rate", "milestone_odds"];
  return ["plate_appearance_projection", "season_event_rate", "two_way_odds"];
}

function preferredFeaturesFor(marketKey: MlbPropMarketKey): string[] {
  if (marketKey.startsWith("pitcher_")) return ["recent_game_logs", "opponent_profile", "pitch_count", "days_rest"];
  if (marketKey === "batter_stolen_bases") return ["catcher_pop_time", "pitcher_hold_profile", "lineup_spot"];
  if (["batter_home_runs", "first_home_run", "batter_total_bases"].includes(marketKey)) return ["contact_quality", "opposing_pitcher_profile", "lineup_spot"];
  return ["lineup_spot", "opposing_pitcher_profile", "event_specific_rate"];
}
