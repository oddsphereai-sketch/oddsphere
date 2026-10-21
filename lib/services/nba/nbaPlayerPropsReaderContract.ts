import type { NbaPlayerPropMarket, NbaPlayerPropPriceObservation } from "./nbaPlayerPropsContract";
import type { NbaPlayerPropsIndependentProjection } from "./nbaPlayerPropsIndependentModel";
import type { NbaPlayerPropsMarketEvidence } from "./nbaPlayerPropsMarketEvidence";
import type { NbaPlayerPropFeatureRow } from "./nbaPlayerPropsPointInTimeFeatures";

export const NBA_PLAYER_PROPS_READER_RESEARCH_RELEASE =
  "nba_player_props_reader_research_2026_10_20_r1_real_values_only" as const;

type NumericFeature = keyof {
  [Key in keyof NbaPlayerPropFeatureRow as NbaPlayerPropFeatureRow[Key] extends number | null ? Key : never]: true;
};

export type NbaPlayerPropsReaderMetric = {
  key: string;
  label: string;
  value: number;
  format: "decimal" | "minutes" | "percent" | "rate" | "count";
  provenance: "point_in_time_model_input" | "independent_model_output" | "sportsbook_observation";
};

export type NbaPlayerPropsReaderResearchView = {
  release: typeof NBA_PLAYER_PROPS_READER_RESEARCH_RELEASE;
  mode: "offline_research_only";
  actionable: false;
  player: { id: number; name: string | null; teamId: number; opponentTeamId: number };
  market: NbaPlayerPropMarket;
  forecast: {
    projection: number;
    line: number;
    side: "over" | "under";
    participationProbability: number;
    conditionalMinutes: number;
  };
  role: NbaPlayerPropsReaderMetric[];
  production: NbaPlayerPropsReaderMetric[];
  matchup: NbaPlayerPropsReaderMetric[];
  prices: Array<{
    sportsbook: string;
    side: "over" | "under";
    line: number;
    americanPrice: number;
    observedAt: string;
  }>;
  movement: {
    sportsbook: string;
    openingLine: number;
    currentLine: number;
    priorLine: number | null;
    lineMovement: NbaPlayerPropsMarketEvidence["lineMovement"];
    priceMovement: NbaPlayerPropsMarketEvidence["priceMovement"];
  } | null;
};

type MetricSpec = {
  key: NumericFeature;
  label: string;
  format: NbaPlayerPropsReaderMetric["format"];
};

const ROLE: MetricSpec[] = [
  { key: "minutes_mean_3", label: "Minutes · L3", format: "minutes" },
  { key: "minutes_mean_10", label: "Minutes · L10", format: "minutes" },
  { key: "participation_rate_10", label: "Games active · L10", format: "percent" },
  { key: "usage_mean_5", label: "Usage · L5", format: "percent" },
];

const PRODUCTION: Partial<Record<NbaPlayerPropMarket, MetricSpec[]>> = {
  points: [
    { key: "points_per_minute_10", label: "Points / minute · L10", format: "rate" },
    { key: "fga_per_minute_10", label: "FGA / minute · L10", format: "rate" },
    { key: "fg3a_per_minute_10", label: "3PA / minute · L10", format: "rate" },
    { key: "fta_per_minute_10", label: "FTA / minute · L10", format: "rate" },
    { key: "true_shooting_mean_5", label: "True shooting · L5", format: "percent" },
  ],
  rebounds: [
    { key: "rebounds_per_minute_10", label: "Rebounds / minute · L10", format: "rate" },
    { key: "rebound_chances_per_minute_5", label: "Rebound chances / minute · L5", format: "rate" },
  ],
  assists: [
    { key: "assists_per_minute_10", label: "Assists / minute · L10", format: "rate" },
    { key: "touches_per_minute_5", label: "Touches / minute · L5", format: "rate" },
    { key: "passes_per_minute_5", label: "Passes / minute · L5", format: "rate" },
    { key: "assist_percentage_mean_5", label: "Assist rate · L5", format: "percent" },
  ],
  threes: [
    { key: "threes_per_minute_10", label: "3PM / minute · L10", format: "rate" },
    { key: "fg3a_per_minute_10", label: "3PA / minute · L10", format: "rate" },
    { key: "true_shooting_mean_5", label: "True shooting · L5", format: "percent" },
  ],
  points_rebounds_assists: [],
  points_rebounds: [],
  points_assists: [],
  rebounds_assists: [],
};

const MATCHUP: Partial<Record<NbaPlayerPropMarket, MetricSpec[]>> = {
  points: [
    { key: "game_pace_mean_5", label: "Matchup pace · L5", format: "decimal" },
    { key: "team_adjusted_offense", label: "Team adjusted offense", format: "decimal" },
    { key: "opponent_adjusted_defense", label: "Opponent adjusted defense", format: "decimal" },
    { key: "opponent_efg_allowed_5", label: "Opponent eFG allowed · L5", format: "percent" },
  ],
  rebounds: [
    { key: "game_pace_mean_5", label: "Matchup pace · L5", format: "decimal" },
    { key: "team_offensive_rebound_rate_5", label: "Team offensive rebound rate · L5", format: "percent" },
    { key: "opponent_defensive_rebound_percentage_5", label: "Opponent defensive rebound rate · L5", format: "percent" },
    { key: "opponent_rebound_chances_per100_5", label: "Opponent rebound chances / 100 · L5", format: "decimal" },
  ],
  assists: [
    { key: "game_pace_mean_5", label: "Matchup pace · L5", format: "decimal" },
    { key: "team_assist_percentage_5", label: "Team assist rate · L5", format: "percent" },
    { key: "opponent_deflections_per100_5", label: "Opponent deflections / 100 · L5", format: "decimal" },
    { key: "opponent_adjusted_defense", label: "Opponent adjusted defense", format: "decimal" },
  ],
  threes: [
    { key: "game_pace_mean_5", label: "Matchup pace · L5", format: "decimal" },
    { key: "team_three_point_attempt_share_5", label: "Team 3PA share · L5", format: "percent" },
    { key: "opponent_matchup_three_point_pct_5", label: "Opponent matchup 3P% · L5", format: "percent" },
    { key: "opponent_contested_shots_per100_5", label: "Opponent contests / 100 · L5", format: "decimal" },
  ],
};

const COMBINATION_COMPONENTS: Partial<Record<NbaPlayerPropMarket, NbaPlayerPropMarket[]>> = {
  points_rebounds_assists: ["points", "rebounds", "assists"],
  points_rebounds: ["points", "rebounds"],
  points_assists: ["points", "assists"],
  rebounds_assists: ["rebounds", "assists"],
};

export function buildNbaPlayerPropsReaderResearchView(args: {
  feature: NbaPlayerPropFeatureRow;
  projection: NbaPlayerPropsIndependentProjection;
  market: NbaPlayerPropMarket;
  line: number;
  observations: readonly NbaPlayerPropPriceObservation[];
  movement?: NbaPlayerPropsMarketEvidence | null;
}): NbaPlayerPropsReaderResearchView {
  const projected = projectionValue(args.projection, args.market);
  if (projected === null) throw new Error(`NBA props reader does not have a projection for ${args.market}.`);
  const exactPrices = args.observations.filter((row) =>
    row.market === args.market && row.line === args.line && (row.side === "over" || row.side === "under"));
  const movement = args.movement?.openingLine !== null && args.movement?.openingLine !== undefined
    ? {
        sportsbook: args.movement.targetSportsbook,
        openingLine: args.movement.openingLine,
        currentLine: args.movement.currentLine,
        priorLine: args.movement.priorLine,
        lineMovement: args.movement.lineMovement,
        priceMovement: args.movement.priceMovement,
      }
    : null;
  const evidence = buildNbaPlayerPropsReaderEvidence(args.feature, args.market);
  return {
    release: NBA_PLAYER_PROPS_READER_RESEARCH_RELEASE,
    mode: "offline_research_only",
    actionable: false,
    player: {
      id: args.feature.player_id,
      name: args.feature.player_name,
      teamId: args.feature.team_id,
      opponentTeamId: args.feature.opponent_team_id,
    },
    market: args.market,
    forecast: {
      projection: projected,
      line: args.line,
      side: projected > args.line ? "over" : "under",
      participationProbability: args.projection.participationProbability,
      conditionalMinutes: args.projection.conditionalMinutes,
    },
    ...evidence,
    prices: exactPrices.map((row) => ({
      sportsbook: row.sportsbook,
      side: row.side as "over" | "under",
      line: row.line,
      americanPrice: row.americanPrice,
      observedAt: row.observedAt,
    })).sort((left, right) => left.side.localeCompare(right.side) || right.americanPrice - left.americanPrice),
    movement,
  };
}

export function buildNbaPlayerPropsReaderEvidence(
  feature: NbaPlayerPropFeatureRow,
  market: NbaPlayerPropMarket,
): Pick<NbaPlayerPropsReaderResearchView, "role" | "production" | "matchup"> {
  return {
    role: metrics(feature, ROLE),
    production: metrics(feature, productionSpecs(market)),
    matchup: metrics(feature, matchupSpecs(market)),
  };
}

function productionSpecs(market: NbaPlayerPropMarket): MetricSpec[] {
  const direct = PRODUCTION[market];
  if (direct && direct.length > 0) return direct;
  return uniqueSpecs((COMBINATION_COMPONENTS[market] ?? []).flatMap((component) => PRODUCTION[component] ?? []));
}

function matchupSpecs(market: NbaPlayerPropMarket): MetricSpec[] {
  const direct = MATCHUP[market];
  if (direct && direct.length > 0) return direct;
  return uniqueSpecs((COMBINATION_COMPONENTS[market] ?? []).flatMap((component) => MATCHUP[component] ?? []));
}

function uniqueSpecs(specs: readonly MetricSpec[]): MetricSpec[] {
  return [...new Map(specs.map((spec) => [spec.key, spec])).values()];
}

function metrics(row: NbaPlayerPropFeatureRow, specs: readonly MetricSpec[]): NbaPlayerPropsReaderMetric[] {
  return specs.flatMap((spec) => {
    const value = row[spec.key];
    if (typeof value !== "number" || !Number.isFinite(value)) return [];
    return [{
      key: String(spec.key),
      label: spec.label,
      value,
      format: spec.format,
      provenance: "point_in_time_model_input" as const,
    }];
  });
}

function projectionValue(
  projection: NbaPlayerPropsIndependentProjection,
  market: NbaPlayerPropMarket,
): number | null {
  if (market in projection.combinations) {
    return projection.combinations[market as keyof typeof projection.combinations];
  }
  return null;
}
