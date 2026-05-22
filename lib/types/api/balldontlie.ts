/**
 * BALLDONTLIE MLB API response shapes.
 * Source: https://mlb.balldontlie.io · OpenAPI spec at /openapi/mlb.yml
 *
 * These shapes are mirrored exactly by the mock provider so the system never
 * knows whether it's talking to the real API or the mock layer. Field
 * nullability matches what the API can actually return.
 */

// ───────────────────── Envelope ─────────────────────

export type BalldontlieEnvelope<T> = {
  data: T[];
  meta?: {
    per_page?: number;
    next_cursor?: string;
  };
};

// ───────────────────── Team ─────────────────────

export type BalldontlieTeam = {
  id: number;
  slug: string;
  abbreviation: string;
  display_name: string;
  short_display_name: string;
  name: string;
  location: string;
  league?: string | null;
  division?: string | null;
  logo_url?: string | null;
};

// ───────────────────── Player ─────────────────────

export type BalldontliePlayer = {
  id: number;
  first_name: string;
  last_name: string;
  full_name?: string;
  jersey?: string | null;
  jersey_number?: string | null;
  position?: string | null;
  position_abbr?: string | null;
  is_pitcher?: boolean;
  active?: boolean;
  bats?: "L" | "R" | "S" | null;
  throws?: "L" | "R" | null;
  birth_place?: string | null;
  dob?: string | null;
  age?: number | null;
  height?: string | null;
  weight?: string | null;
  debut_year?: number | null;
  draft?: string | null;
  team?: BalldontlieTeam;
};

// ───────────────────── Game ─────────────────────

export type BalldontlieGame = {
  id: number;
  date: string;
  status: string;
  season: number;
  season_type?: string;
  postseason?: boolean;
  home_team?: BalldontlieTeam;
  away_team?: BalldontlieTeam;
  home_team_score?: number | null;
  away_team_score?: number | null;
  venue?: string | null;
  attendance?: number | null;
};

// ───────────────────── Season stats ─────────────────────

export type BalldontliePlayerSeasonStats = {
  player_id: number;
  team_id?: number;
  season: number;
  season_type: string;
  postseason?: boolean;
  // Batting
  batting_gp?: number | null;
  batting_ab?: number | null;
  batting_r?: number | null;
  batting_h?: number | null;
  batting_avg?: number | null;
  batting_2b?: number | null;
  batting_3b?: number | null;
  batting_hr?: number | null;
  batting_rbi?: number | null;
  batting_tb?: number | null;
  batting_bb?: number | null;
  batting_so?: number | null;
  batting_sb?: number | null;
  batting_obp?: number | null;
  batting_slg?: number | null;
  batting_ops?: number | null;
  batting_war?: number | null;
  batting_pa?: number | null;
  batting_hbp?: number | null;
  batting_sf?: number | null;
  // Pitching
  pitching_gp?: number | null;
  pitching_gs?: number | null;
  pitching_qs?: number | null;
  pitching_w?: number | null;
  pitching_l?: number | null;
  pitching_era?: number | null;
  pitching_sv?: number | null;
  pitching_hld?: number | null;
  pitching_ip?: number | null;
  pitching_h?: number | null;
  pitching_er?: number | null;
  pitching_hr?: number | null;
  pitching_bb?: number | null;
  pitching_whip?: number | null;
  pitching_k?: number | null;
  pitching_k_per_9?: number | null;
  pitching_war?: number | null;
};

// ───────────────────── Splits ─────────────────────

export type BalldontlieSplitType =
  | "vs_lhp"
  | "vs_rhp"
  | "home"
  | "away"
  | "day"
  | "night";

export type BalldontliePlayerSplit = {
  player_id: number;
  season: number;
  split_type: BalldontlieSplitType | string;
  ab?: number | null;
  h?: number | null;
  avg?: number | null;
  obp?: number | null;
  slg?: number | null;
  ops?: number | null;
  hr?: number | null;
  rbi?: number | null;
  so?: number | null;
  bb?: number | null;
  tb?: number | null;
  pa?: number | null;
};

// ───────────────────── Lineups ─────────────────────

export type BalldontlieLineupEntry = {
  game_id: number;
  team_id: number;
  player_id: number;
  batting_position: number | null;
  starting_position: string; // 'C', '1B', ..., 'P'
  is_confirmed: boolean;
  is_dh?: boolean;
};

// ───────────────────── Injuries ─────────────────────

export type BalldontlieInjury = {
  player_id: number;
  injury_date: string | null;
  return_date: string | null;
  type?: string | null;
  detail?: string | null;
  side?: string | null;
  status?: string | null;
  long_comment?: string | null;
  short_comment?: string | null;
  is_active?: boolean;
};

// ───────────────────── Pitch type stats ─────────────────────

export type BalldontliePitcherPitchType = {
  player_id: number;
  season: number;
  pitch_type: string; // 'FF', 'SL', 'CU', etc.
  count?: number | null;
  pct_of_total?: number | null;
  avg_velo_mph?: number | null;
  whiff_rate?: number | null;
  k_rate?: number | null;
  contact_rate?: number | null;
};

export type BalldontlieHitterPitchType = {
  player_id: number;
  season: number;
  pitch_type: string;
  pa?: number | null;
  ab?: number | null;
  h?: number | null;
  hr?: number | null;
  so?: number | null;
  bb?: number | null;
  avg?: number | null;
  slg?: number | null;
  ops?: number | null;
  whiff_rate?: number | null;
  contact_rate?: number | null;
};
