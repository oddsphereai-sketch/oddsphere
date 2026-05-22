/**
 * Mirrors the `lineups` table.
 * `batting_position` is 1-9 for position players, null for pitcher in NL DH
 * leagues. `starting_position` is the field position abbreviation ('C', '1B',
 * '2B', '3B', 'SS', 'LF', 'CF', 'RF') or 'P' for the pitcher.
 */
export type Lineup = {
  id: number;
  game_id: number | null;
  team_id: number | null;
  player_id: number | null;
  batting_position: number | null;
  starting_position: string | null;
  is_confirmed: boolean;
  is_dh: boolean;
  created_at: string;
  updated_at: string;
};

/** Active injury entry — mirrors `player_injuries` table. */
export type PlayerInjury = {
  id: number;
  player_id: number | null;
  injury_date: string | null;
  return_date: string | null;
  type: string | null;
  detail: string | null;
  side: string | null;
  status: string | null;
  long_comment: string | null;
  short_comment: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
