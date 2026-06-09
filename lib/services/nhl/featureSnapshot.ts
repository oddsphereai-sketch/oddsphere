/**
 * Phase 7L Phase 2 — NHL feature snapshot.
 *
 * Reads the previously-ingested NHL data (games row + team_stats +
 * goalie_stats + lines) and assembles the FeatureSnapshot the model
 * consumes. Pure aggregation; no fetching or DB writes here.
 *
 * Inputs (all read-only):
 *   • games row (sport='nhl', slate_date)
 *   • teams rows (home + away)
 *   • nhl_team_stats rows (playoffs + regular for both teams)
 *   • nhl_goalie_stats rows (selected by manual override OR best-by-GP
 *     fallback per team)
 *   • lines rows (moneyline + total for the game) — for market layer
 *
 * Manual goalie override: callers pass home/away player_external_ids.
 * If unset, fallback selects the goalie with the most games_played
 * for that team in the requested season+season_type.
 */

import { supabase } from "../../db/supabase";
import type { NhlFeatureSnapshot, NhlModelTeam } from "../../automodel/nhlAutoModelV0";
import { fetchNhlScheduleForDate } from "../../providers/nhl/_nhlApiClient";

export type BuildSnapshotOptions = {
  /** games.id (sport='nhl'). */
  gameId: number;
  /** MoneyPuck start-year (2025 for 2025-26 playoffs). */
  season: number;
  /** Manual goalie overrides — player_external_id from nhl_goalie_stats. */
  homeGoalieExternalId?: number;
  awayGoalieExternalId?: number;
  logger?: (msg: string) => void;
};

type DbGameRow = {
  id: number;
  external_id: number;
  sport: string;
  home_team_id: number | null;
  away_team_id: number | null;
  game_date: string;
  slate_date: string;
  status: string;
};

type DbTeamRow = { id: number; abbreviation: string };

type DbTeamStatsRow = {
  team_id: number;
  season: number;
  season_type: "regular" | "playoffs";
  situation: "all" | "5on5" | "4on5" | "5on4" | "other";
  games_played: number | null;
  ice_time: number | null;
  xgoals_pct: number | null;
  x_goals_for: number | null;
  x_goals_against: number | null;
};

type DbGoalieStatsRow = {
  player_external_id: number;
  player_name: string;
  team_abbr: string;
  season: number;
  season_type: "regular" | "playoffs";
  situation: "all" | "5on5" | "4on5" | "5on4" | "other";
  games_played: number | null;
  ice_time: number | null;
  x_goals: number | null;
  goals: number | null;
};

type DbLineRow = {
  market_type: string;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  implied_probability: number | null;
};

/**
 * Pick the team-stats row most representative of the team for the
 * model: prefer playoffs/all, fall back to regular/all.
 */
function pickAllSituationStats(rows: DbTeamStatsRow[]): DbTeamStatsRow | null {
  return (
    rows.find((r) => r.season_type === "playoffs" && r.situation === "all") ??
    rows.find((r) => r.season_type === "regular" && r.situation === "all") ??
    null
  );
}

function pickSituationStats(
  rows: DbTeamStatsRow[],
  situation: "5on4" | "4on5",
): DbTeamStatsRow | null {
  return (
    rows.find((r) => r.season_type === "playoffs" && r.situation === situation) ??
    rows.find((r) => r.season_type === "regular" && r.situation === situation) ??
    null
  );
}

/**
 * Compute xG-for-per-60 from raw xG totals and ice_time (in seconds).
 * MoneyPuck "iceTime" is per-team total ice-time in seconds, so per-60
 * = xG / (ice_time / 3600).
 */
function per60(value: number | null, iceTimeSeconds: number | null): number | null {
  if (value === null || iceTimeSeconds === null || iceTimeSeconds <= 0) return null;
  return value / (iceTimeSeconds / 3600);
}

/**
 * Pick the best goalie row when no manual override is set: most
 * games_played in playoffs for that team's abbreviation. Falls back to
 * regular if no playoff row.
 */
function selectGoalieByDefault(
  rows: DbGoalieStatsRow[],
  teamAbbr: string,
): DbGoalieStatsRow | null {
  const playoffs = rows
    .filter((r) => r.team_abbr === teamAbbr && r.season_type === "playoffs" && r.situation === "all")
    .sort((a, b) => (b.games_played ?? 0) - (a.games_played ?? 0));
  if (playoffs[0]) return playoffs[0];
  const regular = rows
    .filter((r) => r.team_abbr === teamAbbr && r.season_type === "regular" && r.situation === "all")
    .sort((a, b) => (b.games_played ?? 0) - (a.games_played ?? 0));
  return regular[0] ?? null;
}

function selectGoalieByOverride(
  rows: DbGoalieStatsRow[],
  externalId: number,
): DbGoalieStatsRow | null {
  return rows.find(
    (r) => r.player_external_id === externalId && r.situation === "all" &&
      (r.season_type === "playoffs" || r.season_type === "regular"),
  ) ?? null;
}

function goalieXgsaaPer60(g: DbGoalieStatsRow | null): number | null {
  if (g === null || g.x_goals === null || g.goals === null) return null;
  const saved = g.x_goals - g.goals; // positive = saved more than expected
  return per60(saved, g.ice_time);
}

function pickMlImpliedProbHome(lines: DbLineRow[]): { prob: number | null; bookCount: number } {
  const ml = lines.filter((l) => l.market_type === "moneyline" && (l.side === "home" || l.side === "away"));
  if (ml.length === 0) return { prob: null, bookCount: 0 };
  // De-vig by book: for each (sportsbook), find home + away implied probs,
  // normalize them, take the home-side normalized prob, then average across books.
  const byBook = new Map<string, { home?: number; away?: number }>();
  for (const l of ml) {
    const p = l.implied_probability;
    if (p === null) continue;
    const cur = byBook.get(l.sportsbook) ?? {};
    if (l.side === "home") cur.home = p;
    if (l.side === "away") cur.away = p;
    byBook.set(l.sportsbook, cur);
  }
  const devigged: number[] = [];
  for (const { home, away } of byBook.values()) {
    if (home === undefined || away === undefined) continue;
    const sum = home + away;
    if (sum <= 0) continue;
    devigged.push(home / sum);
  }
  if (devigged.length === 0) return { prob: null, bookCount: 0 };
  const avg = devigged.reduce((a, b) => a + b, 0) / devigged.length;
  return { prob: avg, bookCount: devigged.length };
}

function pickTotalLine(lines: DbLineRow[]): number | null {
  const totals = lines.filter((l) => l.market_type === "total" && l.line_value !== null);
  if (totals.length === 0) return null;
  // Median to be robust to outliers (alternate lines should have been
  // filtered upstream, but defensive).
  const sorted = [...totals].map((l) => l.line_value!).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Build a complete feature snapshot for a single NHL game. Throws on
 * fatal missing data (no game row, no teams). Soft-fails (null fields)
 * on missing stats — the model handles nulls with safe fallbacks.
 */
export async function buildNhlFeatureSnapshot(
  opts: BuildSnapshotOptions,
): Promise<{ snapshot: NhlFeatureSnapshot; meta: { home_goalie?: string; away_goalie?: string; market_line?: number | null } }> {
  const log = opts.logger ?? (() => {});

  // 1. Game row.
  const { data: gameData, error: gameErr } = await supabase
    .from("games")
    .select("id, external_id, sport, home_team_id, away_team_id, game_date, slate_date, status")
    .eq("id", opts.gameId)
    .eq("sport", "nhl")
    .single();
  if (gameErr || !gameData) throw new Error(`game ${opts.gameId} not found or not NHL: ${gameErr?.message ?? "no row"}`);
  const game = gameData as DbGameRow;
  if (game.home_team_id === null || game.away_team_id === null) {
    throw new Error(`game ${opts.gameId} missing team_ids`);
  }

  // 2. Teams.
  const { data: teamsData, error: teamsErr } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", [game.home_team_id, game.away_team_id]);
  if (teamsErr || !teamsData || teamsData.length < 2) {
    throw new Error(`teams lookup failed: ${teamsErr?.message ?? "missing rows"}`);
  }
  const teams = teamsData as DbTeamRow[];
  const homeTeam = teams.find((t) => t.id === game.home_team_id)!;
  const awayTeam = teams.find((t) => t.id === game.away_team_id)!;
  log(`Snapshot for game ${opts.gameId}: ${awayTeam.abbreviation} @ ${homeTeam.abbreviation}`);

  // 3. Team stats for both teams + the season.
  const { data: teamStatsData, error: teamStatsErr } = await supabase
    .from("nhl_team_stats")
    .select("team_id, season, season_type, situation, games_played, ice_time, xgoals_pct, x_goals_for, x_goals_against")
    .in("team_id", [game.home_team_id, game.away_team_id])
    .eq("season", opts.season);
  if (teamStatsErr) throw new Error(`team stats lookup: ${teamStatsErr.message}`);
  const teamStats = (teamStatsData as DbTeamStatsRow[] | null) ?? [];
  const homeStatsAll = pickAllSituationStats(teamStats.filter((r) => r.team_id === game.home_team_id));
  const awayStatsAll = pickAllSituationStats(teamStats.filter((r) => r.team_id === game.away_team_id));
  const homeStats5on4 = pickSituationStats(teamStats.filter((r) => r.team_id === game.home_team_id), "5on4");
  const awayStats5on4 = pickSituationStats(teamStats.filter((r) => r.team_id === game.away_team_id), "5on4");
  const homeStats4on5 = pickSituationStats(teamStats.filter((r) => r.team_id === game.home_team_id), "4on5");
  const awayStats4on5 = pickSituationStats(teamStats.filter((r) => r.team_id === game.away_team_id), "4on5");

  // 4. Goalie stats — full table for the season. Filter team-side.
  const { data: goalieData, error: goalieErr } = await supabase
    .from("nhl_goalie_stats")
    .select("player_external_id, player_name, team_abbr, season, season_type, situation, games_played, ice_time, x_goals, goals")
    .eq("season", opts.season);
  if (goalieErr) throw new Error(`goalie stats lookup: ${goalieErr.message}`);
  const goalies = (goalieData as DbGoalieStatsRow[] | null) ?? [];

  const homeGoalie = opts.homeGoalieExternalId !== undefined
    ? selectGoalieByOverride(goalies, opts.homeGoalieExternalId)
    : selectGoalieByDefault(goalies, homeTeam.abbreviation);
  const awayGoalie = opts.awayGoalieExternalId !== undefined
    ? selectGoalieByOverride(goalies, opts.awayGoalieExternalId)
    : selectGoalieByDefault(goalies, awayTeam.abbreviation);

  if (homeGoalie) log(`  home goalie: ${homeGoalie.player_name} (id=${homeGoalie.player_external_id}, ${homeGoalie.season_type})`);
  else log(`  home goalie: <none found>`);
  if (awayGoalie) log(`  away goalie: ${awayGoalie.player_name} (id=${awayGoalie.player_external_id}, ${awayGoalie.season_type})`);
  else log(`  away goalie: <none found>`);

  // 5. Lines (moneyline + total) for the market layer.
  const { data: linesData } = await supabase
    .from("lines")
    .select("market_type, sportsbook, side, line_value, odds_american, implied_probability")
    .eq("game_id", opts.gameId)
    .is("player_id", null)
    .in("market_type", ["moneyline", "total"]);
  const lines = (linesData as DbLineRow[] | null) ?? [];
  const { prob: marketHomeProb, bookCount } = pickMlImpliedProbHome(lines);
  const marketTotalLine = pickTotalLine(lines);
  log(`  market: ML home prob=${marketHomeProb?.toFixed(3) ?? "n/a"} (${bookCount} books), total line=${marketTotalLine?.toFixed(1) ?? "n/a"}`);

  // 6. Series context — fetch fresh from NHL API at prediction time.
  // Cheap (~1 HTTP call per snapshot); always up-to-date (NHL API
  // updates wins immediately after each game).
  let homeSeriesWins = 0;
  let awaySeriesWins = 0;
  let seriesAbbrev: string | null = null;
  let gameNumberInSeries = 0;
  let gamesToWin = 4;
  try {
    const scheduleEvents = await fetchNhlScheduleForDate(game.slate_date);
    const apiEvent = scheduleEvents.find((e) => e.nhl_game_id === String(game.external_id));
    const series = apiEvent?.series ?? null;
    if (series && series.top_seed_abbrev && series.bottom_seed_abbrev) {
      seriesAbbrev = series.series_abbrev || null;
      gameNumberInSeries = series.game_number_in_series;
      gamesToWin = series.games_to_win;
      if (series.top_seed_abbrev === homeTeam.abbreviation) {
        homeSeriesWins = series.top_seed_wins;
        awaySeriesWins = series.bottom_seed_wins;
      } else if (series.bottom_seed_abbrev === homeTeam.abbreviation) {
        homeSeriesWins = series.bottom_seed_wins;
        awaySeriesWins = series.top_seed_wins;
      }
    }
  } catch (e) {
    log(`  ⚠ series context fetch failed (continuing without): ${(e as Error).message}`);
  }
  const isElim = (seriesAbbrev !== null) && (homeSeriesWins === gamesToWin - 1 || awaySeriesWins === gamesToWin - 1);

  // 7. Build the model snapshot.
  const homeModel: NhlModelTeam = {
    abbreviation: homeTeam.abbreviation,
    xgoals_pct: homeStatsAll?.xgoals_pct ?? null,
    x_goals_for_per_60: per60(homeStatsAll?.x_goals_for ?? null, homeStatsAll?.ice_time ?? null),
    x_goals_against_per_60: per60(homeStatsAll?.x_goals_against ?? null, homeStatsAll?.ice_time ?? null),
    pp_xgoals_pct: homeStats5on4?.xgoals_pct ?? null,
    pk_xgoals_pct: homeStats4on5?.xgoals_pct ?? null,
    goalie_xgsaa_per_60: goalieXgsaaPer60(homeGoalie),
    rest_days: null,            // not yet sourced; v0.5 will add via schedule lookback
    series_wins: homeSeriesWins,
    is_home: true,
  };
  const awayModel: NhlModelTeam = {
    abbreviation: awayTeam.abbreviation,
    xgoals_pct: awayStatsAll?.xgoals_pct ?? null,
    x_goals_for_per_60: per60(awayStatsAll?.x_goals_for ?? null, awayStatsAll?.ice_time ?? null),
    x_goals_against_per_60: per60(awayStatsAll?.x_goals_against ?? null, awayStatsAll?.ice_time ?? null),
    pp_xgoals_pct: awayStats5on4?.xgoals_pct ?? null,
    pk_xgoals_pct: awayStats4on5?.xgoals_pct ?? null,
    goalie_xgsaa_per_60: goalieXgsaaPer60(awayGoalie),
    rest_days: null,
    series_wins: awaySeriesWins,
    is_home: false,
  };

  const snapshot: NhlFeatureSnapshot = {
    home: homeModel,
    away: awayModel,
    market: {
      market_home_prob: marketHomeProb,
      market_total_line: marketTotalLine,
      market_book_count: bookCount,
    },
    series: {
      series_abbrev: seriesAbbrev,
      game_number_in_series: gameNumberInSeries,
      is_elimination_game: isElim,
    },
  };

  return {
    snapshot,
    meta: {
      home_goalie: homeGoalie?.player_name,
      away_goalie: awayGoalie?.player_name,
      market_line: marketTotalLine,
    },
  };
}
