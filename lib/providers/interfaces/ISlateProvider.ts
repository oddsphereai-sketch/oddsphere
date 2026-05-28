/**
 * ISlateProvider — contract for "what games are on tonight" data.
 *
 * Fix 7.2 extracted this from IPlayerStatsProvider so slate (games + teams)
 * and player stats (players + stats + splits + injuries) can have
 * independent provider modes. Pre-Fix-7.2, both shared the
 * PLAYER_STATS_PROVIDER env var, which forced an all-or-nothing choice
 * (e.g. manual slate ingestion would have also broken mock player props).
 *
 * Real implementation (Phase 8): SharpAPISlateProvider or similar paid feed.
 * Manual implementation (Fix 7.2): ManualSlateProvider — reads from
 *   `manual_slate_staging` table populated by /api/admin/upload-slate.
 * Mock implementation (V1 default): MockSlateProvider — JSON fixtures
 *   (extracted from MockPlayerStatsProvider in Fix 7.2).
 *
 * The factory picks based on the SLATE_PROVIDER env var. Default = mock.
 * Admin upload route passes a fresh ManualSlateProvider directly to
 * `slateService.refreshGames(sport, date, providerOverride)` so it doesn't
 * mutate process.env (concurrent-request safe).
 *
 * RECORD SHAPES: methods return "insertable" records — DB-assigned fields
 * (id, created_at, updated_at) are stripped, and foreign keys are
 * expressed as the provider's `external_id` rather than our DB `id`.
 * Services resolve external_id → DB id during upsert.
 */

import type { Sport } from "../../types/domain/Sport";
import type { Team } from "../../types/domain/Team";
import type { Game } from "../../types/domain/Game";

// ─────────────────────────────────────────────────────────────
// Provider record types (moved from IPlayerStatsProvider in Fix 7.2)
// ─────────────────────────────────────────────────────────────

/** Team insert record. Omits DB-assigned fields. */
export type SlateTeamRecord = Omit<Team, "id" | "created_at" | "updated_at">;

/** Game insert record. All FK columns expressed as external_ids. */
export type SlateGameRecord = Omit<
  Game,
  | "id"
  | "home_team_id"
  | "away_team_id"
  | "home_pitcher_id"
  | "away_pitcher_id"
  | "ballpark_id"
  | "created_at"
  | "updated_at"
> & {
  home_team_external_id: number | null;
  away_team_external_id: number | null;
  home_pitcher_external_id: number | null;
  away_pitcher_external_id: number | null;
  /** Ballpark resolved by service from home_team_external_id (1:1 home park). */
};

// ─────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────

export interface ISlateProvider {
  /**
   * Fetch all teams for a sport. Used by seed scripts; not called by
   * slateService.refreshGames (which resolves teams via direct table query).
   */
  getTeams(sport: Sport): Promise<SlateTeamRecord[]>;

  /**
   * Games scheduled for a single date. Primary slate ingestion entry point.
   * @param date YYYY-MM-DD format.
   * @param sport Optional sport filter. Omit for cross-sport.
   */
  getGames(date: string, sport?: Sport): Promise<SlateGameRecord[]>;
}
