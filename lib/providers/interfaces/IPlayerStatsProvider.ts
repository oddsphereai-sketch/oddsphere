/**
 * IPlayerStatsProvider — contract for the player-stats data source.
 *
 * Fix 7.2 split slate-related methods (getTeams, getGames) out into a
 * separate ISlateProvider. This interface now covers only player-scoped
 * data: players, season stats, splits, pitch stats, injuries, lineups.
 *
 * Real implementation: BallDontLieProvider (paid GOAT tier) — Phase 8.
 * Manual implementation: AdminUploadStatsProvider — Phase 7.25.
 * Mock implementation: MockPlayerStatsProvider (reads from JSON fixtures).
 *
 * All implementations return the same record shapes — services that consume
 * this interface never know which is active. The factory picks based on the
 * PLAYER_STATS_PROVIDER env var (separate from SLATE_PROVIDER, which
 * routes ISlateProvider).
 *
 * RECORD SHAPES: methods return "insertable" records — DB-assigned fields
 * (id, created_at, updated_at) are stripped, and foreign keys are expressed
 * as the provider's `external_id` rather than our DB `id`. Services resolve
 * external_id → DB id during upsert.
 */

import type { Sport } from "../../types/domain/Sport";
import type { Player } from "../../types/domain/Player";
import type { PlayerInjury } from "../../types/domain/Lineup";

// ─────────────────────────────────────────────────────────────
// Provider record types
// ─────────────────────────────────────────────────────────────

/** Player insert record. Swaps team_id for team_external_id. */
export type StatsPlayerRecord = Omit<
  Player,
  "id" | "team_id" | "created_at" | "updated_at" | "external_id"
> & {
  team_external_id: number | null;
  /**
   * Always non-null in a stats-provider record — the BDL stats provider
   * keys by BDL player id, so any row it emits must have one. (Phase
   * 4.2.C.1.H-0 made `Player.external_id` nullable for MLB-Stats-only
   * rows, but stats-provider records never carry those.)
   */
  external_id: number;
};

/** One row per player in a game's lineup. */
export type StatsLineupRecord = {
  game_external_id: number;
  team_external_id: number;
  player_external_id: number;
  batting_position: number | null;
  starting_position: string | null;
  is_confirmed: boolean;
  is_dh: boolean;
};

/** Active injury record. */
export type StatsInjuryRecord = Omit<
  PlayerInjury,
  "id" | "player_id" | "created_at" | "updated_at"
> & {
  player_external_id: number;
};

/** Player season stats — mirrors player_season_stats table columns. */
export type StatsSeasonRecord = {
  player_external_id: number;
  team_external_id: number | null;
  season: number;
  season_type: string;
  postseason: boolean;
  // Batting
  batting_gp: number | null;
  batting_ab: number | null;
  batting_r: number | null;
  batting_h: number | null;
  batting_avg: number | null;
  batting_2b: number | null;
  batting_3b: number | null;
  batting_hr: number | null;
  batting_rbi: number | null;
  batting_tb: number | null;
  batting_bb: number | null;
  batting_so: number | null;
  batting_sb: number | null;
  batting_obp: number | null;
  batting_slg: number | null;
  batting_ops: number | null;
  batting_war: number | null;
  batting_pa: number | null;
  batting_hbp: number | null;
  batting_sf: number | null;
  // Pitching
  pitching_gp: number | null;
  pitching_gs: number | null;
  pitching_qs: number | null;
  pitching_w: number | null;
  pitching_l: number | null;
  pitching_era: number | null;
  pitching_sv: number | null;
  pitching_hld: number | null;
  pitching_ip: number | null;
  pitching_h: number | null;
  pitching_er: number | null;
  pitching_hr: number | null;
  pitching_bb: number | null;
  pitching_whip: number | null;
  pitching_k: number | null;
  pitching_k_per_9: number | null;
  pitching_war: number | null;
};

/** Hitter splits — vs LHP / vs RHP, home/away, day/night. */
export type StatsSplitRecord = {
  player_external_id: number;
  season: number;
  split_type: "vs_lhp" | "vs_rhp" | "home" | "away" | "day" | "night" | (string & {});
  ab: number | null;
  h: number | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  hr: number | null;
  rbi: number | null;
  so: number | null;
  bb: number | null;
  tb: number | null;
  pa: number | null;
};

/** Pitcher pitch-type stats — one row per pitch type (FF/SL/CU/CH/...). */
export type PitcherPitchRecord = {
  player_external_id: number;
  season: number;
  pitch_type: string;
  count: number | null;
  pct_of_total: number | null;
  avg_velo_mph: number | null;
  whiff_rate: number | null;
  k_rate: number | null;
  contact_rate: number | null;
};

/** Hitter performance vs each pitch type — used by log5 matchup math. */
export type HitterPitchRecord = {
  player_external_id: number;
  season: number;
  pitch_type: string;
  pa: number | null;
  ab: number | null;
  h: number | null;
  hr: number | null;
  so: number | null;
  bb: number | null;
  avg: number | null;
  slg: number | null;
  ops: number | null;
  whiff_rate: number | null;
  contact_rate: number | null;
};

// ─────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────

export interface IPlayerStatsProvider {
  /**
   * Fetch active players. Optionally scoped to a single team.
   * @param teamExternalId Provider's team id (NOT our DB team_id). Omit to fetch all.
   */
  getPlayers(teamExternalId?: number): Promise<StatsPlayerRecord[]>;

  /**
   * Fetch a single player by provider external id.
   * Returns null if the player is unknown to the provider.
   */
  getPlayer(playerExternalId: number): Promise<StatsPlayerRecord | null>;

  /**
   * Season stats across the requested seasons. Empty array if none found.
   * One row per (season, season_type) — Marcel only needs regular-season rows.
   */
  getPlayerSeasonStats(
    playerExternalId: number,
    seasons: number[]
  ): Promise<StatsSeasonRecord[]>;

  /**
   * Hitter splits for a single season. Empty array if not available.
   * Typically returns rows for vs_lhp, vs_rhp at minimum.
   */
  getPlayerSplits(
    playerExternalId: number,
    season: number
  ): Promise<StatsSplitRecord[]>;

  /**
   * Pitch-type breakdown for a pitcher. Typically 4–6 rows per pitcher.
   */
  getPitcherPitchStats(
    pitcherExternalId: number,
    season: number
  ): Promise<PitcherPitchRecord[]>;

  /**
   * Hitter performance vs each pitch type.
   */
  getHitterPitchStats(
    hitterExternalId: number,
    season: number
  ): Promise<HitterPitchRecord[]>;

  /**
   * Lineups for a single game.
   * Returns ~9 players per team if confirmed; may return fewer (or empty)
   * if lineups haven't been posted yet — caller must handle is_confirmed.
   */
  getLineups(gameExternalId: number): Promise<StatsLineupRecord[]>;

  /**
   * Active injury reports. Empty array if no active injuries.
   */
  getInjuries(sport?: Sport): Promise<StatsInjuryRecord[]>;
}
