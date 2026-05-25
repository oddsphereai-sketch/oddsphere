/**
 * slateService — pull tonight's games via the stats provider and upsert into
 * the games table. Powers the morning-slate cron's first step.
 *
 * Idempotent via UPSERT on (sport, external_id). Re-running on the same
 * slate date overwrites games with the latest data (probable-pitcher
 * changes, status updates, etc.).
 *
 * If FK resolution fails for a row (team/pitcher missing from DB), the row
 * is logged and SKIPPED — the rest of the slate still upserts. Returns a
 * count of records_updated representing rows that actually wrote.
 */

import { supabase } from "../db/supabase";
import { getPlayerStatsProvider } from "../providers/factory";
import type { Sport } from "../types/domain/Sport";
import type { CronHandlerResult } from "../cron/runCron";
import { computeSlateDate } from "../dates/slateDate";
import {
  loadBallparkIdByTeamId,
  loadPlayerIdMap,
  loadTeamIdMap,
} from "./_idMaps";

export const slateService = {
  /**
   * Refresh today's game slate for `sport` on `date` (YYYY-MM-DD).
   * Upserts the games table. Returns counts for refreshLogger.
   */
  async refreshGames(sport: Sport, date: string): Promise<CronHandlerResult> {
    const stats = getPlayerStatsProvider();
    let apiCalls = 0;

    const teamIdByExternal = await loadTeamIdMap(sport);
    const playerIdByExternal = await loadPlayerIdMap(sport);
    const ballparkIdByTeamId = await loadBallparkIdByTeamId();

    const gameRecords = await stats.getGames(date, sport);
    apiCalls++;

    if (gameRecords.length === 0) {
      return { records_updated: 0, api_calls_made: apiCalls };
    }

    const payload: Array<Record<string, unknown>> = [];
    const skipped: number[] = [];

    for (const g of gameRecords) {
      const homeTeamId =
        g.home_team_external_id !== null
          ? teamIdByExternal.get(g.home_team_external_id) ?? null
          : null;
      const awayTeamId =
        g.away_team_external_id !== null
          ? teamIdByExternal.get(g.away_team_external_id) ?? null
          : null;
      if (homeTeamId === null || awayTeamId === null) {
        // Missing team FK — skip this game; team refresh should run first.
        skipped.push(g.external_id);
        continue;
      }
      const ballparkId = ballparkIdByTeamId.get(homeTeamId) ?? null;
      payload.push({
        sport: g.sport,
        external_id: g.external_id,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        home_pitcher_id:
          g.home_pitcher_external_id !== null
            ? playerIdByExternal.get(g.home_pitcher_external_id) ?? null
            : null,
        away_pitcher_id:
          g.away_pitcher_external_id !== null
            ? playerIdByExternal.get(g.away_pitcher_external_id) ?? null
            : null,
        ballpark_id: ballparkId,
        game_date: g.game_date,
        // slate_date is the local-evening date in the sport's anchor timezone
        // (5E.1). Compute from the game's UTC start time + its sport.
        slate_date: computeSlateDate(g.sport as Sport, g.game_date),
        season: g.season,
        season_type: g.season_type,
        postseason: g.postseason,
        status: g.status,
        venue: g.venue,
        home_score: g.home_score,
        away_score: g.away_score,
        inning_scores: g.inning_scores,
      });
    }

    if (payload.length > 0) {
      const { error } = await supabase
        .from("games")
        .upsert(payload, { onConflict: "sport,external_id" });
      if (error) {
        throw new Error(`slateService.refreshGames upsert failed: ${error.message}`);
      }
    }

    return {
      records_updated: payload.length,
      api_calls_made: apiCalls,
      details: skipped.length > 0 ? { skipped_external_ids: skipped } : undefined,
    };
  },
};
