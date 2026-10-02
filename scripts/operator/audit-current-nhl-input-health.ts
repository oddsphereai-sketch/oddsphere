import { supabase } from "../../lib/db/supabase";
import {
  NHL_REGULAR_CALIBRATION_RELEASE,
  NHL_REGULAR_MODEL_RELEASE,
} from "../../lib/automodel/nhlRegularModelV1";

type Snapshot = {
  feature_inputs?: {
    home?: {
      abbreviation?: string;
      current_season_games?: number;
      goalie_xgsaa_per_60?: number | null;
      roster_prior?: { coverage?: number } | null;
    };
    away?: {
      abbreviation?: string;
      current_season_games?: number;
      goalie_xgsaa_per_60?: number | null;
      roster_prior?: { coverage?: number } | null;
    };
    provider_feature_season?: number | null;
    market?: {
      market_home_prob?: number | null;
      market_open_home_prob?: number | null;
      same_book_home_prob_move?: number | null;
      market_total_line?: number | null;
      market_open_total_line?: number | null;
      same_book_total_move?: number | null;
      ml_home_bets_pct?: number | null;
      ml_home_money_pct?: number | null;
      total_over_bets_pct?: number | null;
      total_over_money_pct?: number | null;
      ml_split_source?: string | null;
      total_split_source?: string | null;
      ml_split_confidence?: string;
      total_split_confidence?: string;
    };
  };
  model_output?: {
    independent_goal_diff?: number;
    independent_total_goals?: number;
    expected_goal_diff?: number;
    expected_total_goals?: number;
    projected_home_goals?: number;
    projected_away_goals?: number;
    layers?: { market_decision?: string; roster_prior_active?: boolean };
  };
  goalie_assumption?: {
    home?: { player_name?: string; source?: string };
    away?: { player_name?: string; source?: string };
  };
};

async function main(): Promise<void> {
  const slateDate = process.argv[2] ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const { data, error } = await supabase
    .from("prediction_records")
    .select("game_id, matchup, game_date, market, pick, play_grade, odds_american, line_value, published_at, locked_at, snapshot_json")
    .eq("sport", "nhl")
    .eq("slate_date", slateDate)
    .eq("model_version", NHL_REGULAR_MODEL_RELEASE)
    .eq("calibration_version", NHL_REGULAR_CALIBRATION_RELEASE)
    .order("game_date", { ascending: true });
  if (error) throw error;

  const grouped = new Map<number, typeof data>();
  for (const row of data ?? []) {
    const rows = grouped.get(Number(row.game_id)) ?? [];
    rows.push(row);
    grouped.set(Number(row.game_id), rows);
  }
  const games = [...grouped.values()].map((rows) => {
    const first = rows[0]!;
    const snapshot = first.snapshot_json as Snapshot | null;
    const input = snapshot?.feature_inputs;
    const model = snapshot?.model_output;
    return {
      matchup: first.matchup,
      startsAt: first.game_date,
      publishedAt: first.published_at,
      lockedAt: first.locked_at,
      providerFeatureSeason: input?.provider_feature_season ?? null,
      currentSeasonGames: {
        away: input?.away?.current_season_games ?? null,
        home: input?.home?.current_season_games ?? null,
      },
      rosterCoverage: {
        away: input?.away?.roster_prior?.coverage ?? null,
        home: input?.home?.roster_prior?.coverage ?? null,
      },
      goalie: {
        away: snapshot?.goalie_assumption?.away ?? null,
        home: snapshot?.goalie_assumption?.home ?? null,
        awayXgsaaPer60: input?.away?.goalie_xgsaa_per_60 ?? null,
        homeXgsaaPer60: input?.home?.goalie_xgsaa_per_60 ?? null,
      },
      market: input?.market ?? null,
      forecast: {
        independentMargin: model?.independent_goal_diff ?? null,
        independentTotal: model?.independent_total_goals ?? null,
        finalMargin: model?.expected_goal_diff ?? null,
        finalTotal: model?.expected_total_goals ?? null,
        away: model?.projected_away_goals ?? null,
        home: model?.projected_home_goals ?? null,
        marketDecision: model?.layers?.market_decision ?? null,
        rosterPriorActive: model?.layers?.roster_prior_active ?? null,
      },
      markets: rows.map((row) => ({
        market: row.market,
        pick: row.pick,
        grade: row.play_grade,
        line: row.line_value,
        price: row.odds_american,
      })),
    };
  });

  console.log(JSON.stringify({
    slateDate,
    release: NHL_REGULAR_MODEL_RELEASE,
    gameCount: games.length,
    markets: data?.length ?? 0,
    allThreeMarkets: games.every((game) => game.markets.length === 3),
    allPriced: games.every((game) => game.markets.every((market) => market.price !== null)),
    games,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
