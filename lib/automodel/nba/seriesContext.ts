/**
 * Phase 7A — NBA Finals v0a — series context derivation.
 *
 * Pure. No DB, no network. Given:
 *   • home_team_external_id
 *   • away_team_external_id
 *   • slate_date (the date of THIS game)
 *   • prior_games_in_series (list of completed games BEFORE this one
 *                            between the same team pair)
 *
 * Returns a NbaSeriesContext describing where in the series this game
 * is: game number, series score (from the perspective of THIS game's
 * home team), elimination flags, days of rest, venue shift.
 *
 * Best-of-7 semantics:
 *   • A series ends when one side reaches 4 wins.
 *   • is_elimination_for_X means "X would be eliminated by losing this
 *     game" — i.e. X currently has 3 losses (the opposing team has 3 wins).
 *
 * Defensive: when prior_games_in_series is empty, returns a Game 1
 * default with no series score, no rest data, no venue shift.
 */

import type { NbaSeriesContext } from "./types";

export type PriorGameInput = {
  /** External_id of the game. */
  game_external_id: number;
  /** YYYY-MM-DD or ISO of when it was played. */
  game_date: string;
  /** External_id of the home team in that prior game. */
  home_team_external_id: number;
  /** External_id of the away team in that prior game. */
  away_team_external_id: number;
  /** Final score, used to derive series winner of that game. Both null →
   *  game not yet complete, will be ignored. */
  home_score: number | null;
  away_score: number | null;
};

export type DeriveSeriesContextInput = {
  this_game_home_team_external_id: number;
  this_game_away_team_external_id: number;
  this_game_date: string;
  prior_games: PriorGameInput[];
};

const NBA_SERIES_WINS_TO_CLINCH = 4;

function parseDate(d: string): Date | null {
  const parsed = new Date(d);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function daysBetween(later: string, earlier: string): number | null {
  const a = parseDate(later);
  const b = parseDate(earlier);
  if (a === null || b === null) return null;
  const ms = a.getTime() - b.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Pure derivation of NbaSeriesContext from prior-game data.
 *
 * Returns Game 1 defaults when prior_games is empty or when none of the
 * prior games involve the same team pair.
 */
export function deriveSeriesContext(
  input: DeriveSeriesContextInput,
): NbaSeriesContext {
  const teamA = input.this_game_home_team_external_id;
  const teamB = input.this_game_away_team_external_id;

  // Filter to prior games that involve THIS pair AND are finished.
  const relevant = input.prior_games
    .filter((g) =>
      (g.home_team_external_id === teamA && g.away_team_external_id === teamB) ||
      (g.home_team_external_id === teamB && g.away_team_external_id === teamA),
    )
    .filter((g) => g.home_score !== null && g.away_score !== null)
    // chronological
    .sort((a, b) => {
      const ad = parseDate(a.game_date)?.getTime() ?? 0;
      const bd = parseDate(b.game_date)?.getTime() ?? 0;
      return ad - bd;
    });

  // Tally wins from THIS game's home perspective.
  let homeWins = 0;
  let awayWins = 0;
  for (const g of relevant) {
    const homeWonGame = (g.home_score ?? 0) > (g.away_score ?? 0);
    // Winner of the prior game = the actual home_team_external_id of THAT
    // game when homeWonGame, else the away. Map back to "is the winner
    // THIS game's home team?"
    const priorWinnerExtId = homeWonGame
      ? g.home_team_external_id
      : g.away_team_external_id;
    if (priorWinnerExtId === teamA) homeWins += 1;
    else if (priorWinnerExtId === teamB) awayWins += 1;
  }

  const gameNumber = relevant.length + 1;

  // Elimination: a team needs 4 wins to clinch a best-of-7; they're on
  // elimination when they currently have 3 LOSSES (opponent has 3 wins).
  const isElimHome = awayWins >= NBA_SERIES_WINS_TO_CLINCH - 1;
  const isElimAway = homeWins >= NBA_SERIES_WINS_TO_CLINCH - 1;

  // Days rest: find the LAST game each team played in the series and
  // compute the gap to this_game_date.
  let lastHomeGameDate: string | null = null;
  let lastAwayGameDate: string | null = null;
  for (const g of relevant) {
    const involvedHome =
      g.home_team_external_id === teamA || g.away_team_external_id === teamA;
    const involvedAway =
      g.home_team_external_id === teamB || g.away_team_external_id === teamB;
    if (involvedHome) lastHomeGameDate = g.game_date;
    if (involvedAway) lastAwayGameDate = g.game_date;
  }
  const daysRestHome =
    lastHomeGameDate !== null
      ? daysBetween(input.this_game_date, lastHomeGameDate)
      : null;
  const daysRestAway =
    lastAwayGameDate !== null
      ? daysBetween(input.this_game_date, lastAwayGameDate)
      : null;

  // Venue shift: true when the most recent prior game in the series had a
  // DIFFERENT home team than THIS game.
  let venueShift = false;
  if (relevant.length > 0) {
    const last = relevant[relevant.length - 1]!;
    venueShift = last.home_team_external_id !== teamA;
  }

  return {
    game_number: gameNumber,
    series_score_home: homeWins,
    series_score_away: awayWins,
    home_team_leads_series_by: homeWins - awayWins,
    is_elimination_for_home: isElimHome,
    is_elimination_for_away: isElimAway,
    days_rest_home: daysRestHome,
    days_rest_away: daysRestAway,
    venue_shift: venueShift,
  };
}
