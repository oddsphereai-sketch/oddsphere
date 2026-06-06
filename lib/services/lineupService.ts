/**
 * lineupService — pull confirmed lineups for tonight's games via the stats
 * provider and write them to the lineups table.
 *
 * Strategy: DELETE existing lineup rows for tonight's games before INSERT.
 * This naturally handles scratches (a player in DB but missing from new
 * provider response is just absent after the refresh — implicit scratch).
 *
 * Idempotent: re-running produces the same state.
 */

import { supabase } from "../db/supabase";
import { getPlayerStatsProvider } from "../providers/factory";
import type { Sport } from "../types/domain/Sport";
import type { CronHandlerResult } from "../cron/runCron";
import { loadGameIdMap, loadPlayerBdlIdMap, loadTeamIdMap } from "./_idMaps";

type SkipReason =
  | "lineup_player_map_missing"
  | "lineup_team_map_missing"
  | "lineup_game_map_missing"
  | "lineup_wrong_team_guard"
  | "lineup_no_batting_order";

type SkipEntry = {
  reason: SkipReason;
  player_external_id: number;
  team_external_id: number;
  game_external_id: number;
};

export const lineupService = {
  /**
   * Refresh lineups for all of `sport`'s games on `date`.
   *
   * Player ID resolution uses `loadPlayerBdlIdMap` (keyed by
   * `provider_ids.bdl.id`) — the BallDontLie provider returns BDL
   * player IDs which don't match the players table's `external_id`
   * column (MLB Stats API IDs). Push 3A-4 fix.
   *
   * Returns total lineup rows written + provider call count + a
   * per-reason skip breakdown for operator visibility.
   */
  async refreshLineups(sport: Sport, date: string): Promise<CronHandlerResult> {
    const stats = getPlayerStatsProvider();
    const gameIdByExternal = await loadGameIdMap(sport, date);
    const teamIdByExternal = await loadTeamIdMap(sport);
    const bdlPlayerMap = await loadPlayerBdlIdMap(sport);

    const gameIds = [...gameIdByExternal.values()];
    if (gameIds.length === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }

    // Game wrong-team guard: pull (home_team_id, away_team_id) for the
    // expected slate up front so we can reject lineup rows whose
    // team_id doesn't match either side of the game they claim.
    const { data: gameRows, error: gameRowsErr } = await supabase
      .from("games")
      .select("id, external_id, home_team_id, away_team_id")
      .in("id", gameIds);
    if (gameRowsErr) {
      throw new Error(`lineupService.refreshLineups games query failed: ${gameRowsErr.message}`);
    }
    const teamsByGame = new Map<number, Set<number>>();
    for (const g of gameRows ?? []) {
      teamsByGame.set(g.id as number, new Set([g.home_team_id as number, g.away_team_id as number]));
    }

    const allRows: Array<Record<string, unknown>> = [];
    let apiCalls = 0;
    const skipped: SkipEntry[] = [];

    for (const [extGameId, dbGameId] of gameIdByExternal) {
      const lineupRecs = await stats.getLineups(extGameId);
      apiCalls++;
      const expectedTeams = teamsByGame.get(dbGameId) ?? new Set<number>();
      for (const l of lineupRecs) {
        const teamId = teamIdByExternal.get(l.team_external_id);
        if (teamId === undefined) {
          skipped.push({ reason: "lineup_team_map_missing", player_external_id: l.player_external_id, team_external_id: l.team_external_id, game_external_id: extGameId });
          continue;
        }
        // Wrong-team guard — lineup row claims a team that isn't either
        // side of this game. Defense in depth against provider bugs.
        if (!expectedTeams.has(teamId)) {
          skipped.push({ reason: "lineup_wrong_team_guard", player_external_id: l.player_external_id, team_external_id: l.team_external_id, game_external_id: extGameId });
          continue;
        }
        const playerMeta = bdlPlayerMap.get(l.player_external_id);
        if (playerMeta === undefined) {
          skipped.push({ reason: "lineup_player_map_missing", player_external_id: l.player_external_id, team_external_id: l.team_external_id, game_external_id: extGameId });
          continue;
        }
        allRows.push({
          game_id: dbGameId,
          team_id: teamId,
          player_id: playerMeta.id,
          batting_position: l.batting_position,
          starting_position: l.starting_position,
          // BDL never returns a true is_confirmed; ingest as projected.
          // A separate confirmed-lineup source (MLB Stats API at T-60)
          // can flip this to true via a follow-up step.
          is_confirmed: l.is_confirmed === true,
          is_dh: l.is_dh,
        });
      }
    }

    const { error: delErr } = await supabase
      .from("lineups")
      .delete()
      .in("game_id", gameIds);
    if (delErr) {
      throw new Error(`lineupService.refreshLineups delete failed: ${delErr.message}`);
    }

    if (allRows.length > 0) {
      const { error } = await supabase.from("lineups").insert(allRows);
      if (error) {
        throw new Error(`lineupService.refreshLineups insert failed: ${error.message}`);
      }
    }

    const skipByReason: Record<string, number> = {};
    for (const s of skipped) {
      skipByReason[s.reason] = (skipByReason[s.reason] ?? 0) + 1;
    }

    return {
      records_updated: allRows.length,
      api_calls_made: apiCalls,
      details: skipped.length > 0
        ? { skipped_by_reason: skipByReason, sample_skipped: skipped.slice(0, 10) }
        : undefined,
    };
  },
};
