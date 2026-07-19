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
import { getSlateProvider } from "../providers/factory";
import type { ISlateProvider } from "../providers/interfaces/ISlateProvider";
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
   *
   * Fix 7.2: `providerOverride` lets the admin upload route pass a fresh
   * ManualSlateProvider scoped to a specific staging row, avoiding any
   * process.env mutation (concurrent-request safe). When omitted, falls
   * through to `getSlateProvider()` which reads SLATE_PROVIDER env (cron
   * path).
   *
   * `opts.dryRun` (default false) is a Phase 4.1.9.C-1b operator-script
   * affordance: when true, the provider fetch + payload build still run
   * normally, but the UPSERT against `games` is skipped. Behavior for
   * existing callers (crons, admin upload route, tests) is unchanged.
   */
  async refreshGames(
    sport: Sport,
    date: string,
    providerOverride?: ISlateProvider,
    opts?: { dryRun?: boolean }
  ): Promise<CronHandlerResult> {
    const dryRun = opts?.dryRun === true;
    const stats = providerOverride ?? getSlateProvider();
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
      const suppressDuplicateHome = g.provider_ids?.oddsphere_suppress_duplicate_home_pitcher === 1;
      const suppressDuplicateAway = g.provider_ids?.oddsphere_suppress_duplicate_away_pitcher === 1;
      const row: Record<string, unknown> = {
        sport: g.sport,
        external_id: g.external_id,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
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
      };
      // A missing provider value means "not supplied yet", not "erase a
      // previously verified starter." Omit that column from the upsert so
      // an existing assignment survives. The doubleheader sanitizer marks
      // the one case that is an intentional clear: a copied game-one starter.
      if (g.home_pitcher_external_id !== null) {
        row.home_pitcher_id = playerIdByExternal.get(g.home_pitcher_external_id) ?? null;
      } else if (suppressDuplicateHome) {
        row.home_pitcher_id = null;
      }
      if (g.away_pitcher_external_id !== null) {
        row.away_pitcher_id = playerIdByExternal.get(g.away_pitcher_external_id) ?? null;
      } else if (suppressDuplicateAway) {
        row.away_pitcher_id = null;
      }
      // Fix 7.2: propagate provider_ids when the provider attached one
      // (manual provider always does — see ManualSlateProvider.getGames).
      // Mock provider omits it; the DB default '{}' applies in that case.
      if (g.provider_ids !== undefined && g.provider_ids !== null) {
        row.provider_ids = g.provider_ids;
      }
      payload.push(row);
    }

    if (payload.length > 0 && !dryRun) {
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
