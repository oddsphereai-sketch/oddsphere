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
import { loadGameIdMap, loadPlayerIdMap, loadTeamIdMap } from "./_idMaps";

export const lineupService = {
  /**
   * Refresh lineups for all of `sport`'s games on `date`.
   * Returns total lineup rows written + provider call count.
   */
  async refreshLineups(sport: Sport, date: string): Promise<CronHandlerResult> {
    const stats = getPlayerStatsProvider();
    const gameIdByExternal = await loadGameIdMap(sport, date);
    const teamIdByExternal = await loadTeamIdMap(sport);
    const playerIdByExternal = await loadPlayerIdMap(sport);

    const gameIds = [...gameIdByExternal.values()];
    if (gameIds.length === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }

    const allRows: Array<Record<string, unknown>> = [];
    let apiCalls = 0;
    const skipped: number[] = [];

    for (const [extGameId, dbGameId] of gameIdByExternal) {
      const lineupRecs = await stats.getLineups(extGameId);
      apiCalls++;
      for (const l of lineupRecs) {
        const teamId = teamIdByExternal.get(l.team_external_id);
        const playerId = playerIdByExternal.get(l.player_external_id);
        if (teamId === undefined || playerId === undefined) {
          skipped.push(l.player_external_id);
          continue;
        }
        allRows.push({
          game_id: dbGameId,
          team_id: teamId,
          player_id: playerId,
          batting_position: l.batting_position,
          starting_position: l.starting_position,
          is_confirmed: l.is_confirmed,
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

    return {
      records_updated: allRows.length,
      api_calls_made: apiCalls,
      details: skipped.length > 0 ? { skipped_player_external_ids: skipped } : undefined,
    };
  },
};
