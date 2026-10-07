/**
 * lineupService — pull confirmed lineups for tonight's games via the stats
 * provider and write them to the lineups table.
 *
 * Strategy: publish a complete mapped team replacement before removing stale
 * projected rows. Empty or partial provider responses retain the last verified
 * lineup, and projected data never replaces an already confirmed team unit.
 *
 * Idempotent: re-running produces the same state.
 */

import { supabase } from "../db/supabase";
import { getPlayerStatsProvider } from "../providers/factory";
import type { Sport } from "../types/domain/Sport";
import type { CronHandlerResult } from "../cron/runCron";
import { loadGameIdMap, loadPlayerBdlIdMap, loadTeamIdMap } from "./_idMaps";
import { refreshMlbOfficialLineups } from "./mlbOfficialLineupService";
import {
  lineupTeamKey,
  selectCompleteProjectedLineupUnits,
  type ProjectedLineupPersistenceRow,
} from "./projectedLineupContinuity";

export type LineupRefreshOptions = {
  deadlineAtMs?: number;
};

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
  async refreshLineups(
    sport: Sport,
    date: string,
    options: LineupRefreshOptions = {},
  ): Promise<CronHandlerResult> {
    const deadlineReached = () =>
      options.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs;
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

    const { data: confirmedRows, error: confirmedRowsErr } = await supabase
      .from("lineups")
      .select("game_id, team_id, player_id, batting_position")
      .in("game_id", gameIds)
      .eq("is_confirmed", true);
    if (confirmedRowsErr) {
      throw new Error(`lineupService.refreshLineups confirmed query failed: ${confirmedRowsErr.message}`);
    }
    const confirmedBattersByTeam = new Map<string, Set<number>>();
    for (const row of confirmedRows ?? []) {
      const battingPosition = Number(row.batting_position);
      if (!Number.isInteger(battingPosition) || battingPosition < 1 || battingPosition > 9) continue;
      const key = lineupTeamKey(Number(row.game_id), Number(row.team_id));
      const players = confirmedBattersByTeam.get(key) ?? new Set<number>();
      players.add(Number(row.player_id));
      confirmedBattersByTeam.set(key, players);
    }
    const confirmedTeamKeys = new Set(
      [...confirmedBattersByTeam.entries()]
        .filter(([, playerIds]) => playerIds.size >= 8)
        .map(([key]) => key),
    );

    const allRows: ProjectedLineupPersistenceRow[] = [];
    let apiCalls = 0;
    const skipped: SkipEntry[] = [];
    let providerGamesRead = 0;
    let deadlineStage: string | null = null;

    for (const [extGameId, dbGameId] of gameIdByExternal) {
      if (deadlineReached()) {
        deadlineStage = "projected_lineup_provider_loop";
        break;
      }
      const lineupRecs = await stats.getLineups(extGameId);
      apiCalls++;
      providerGamesRead++;
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

    const selected = selectCompleteProjectedLineupUnits({
      rows: allRows,
      expectedTeamIdsByGame: teamsByGame,
      confirmedTeamKeys,
    });
    let projectedRowsWritten = 0;
    for (const unit of selected.units) {
      // Publish the complete replacement first. If cleanup fails, the next
      // cycle may briefly see extra projected rows but never an empty lineup.
      const { error: upsertErr } = await supabase
        .from("lineups")
        .upsert(unit.rows, { onConflict: "game_id,team_id,player_id" });
      if (upsertErr) {
        throw new Error(`lineupService.refreshLineups upsert failed: ${upsertErr.message}`);
      }
      projectedRowsWritten += unit.rows.length;

      const retainedPlayerIds = unit.rows.map((row) => row.player_id);
      const { error: deleteErr } = await supabase
        .from("lineups")
        .delete()
        .eq("game_id", unit.gameId)
        .eq("team_id", unit.teamId)
        .eq("is_confirmed", false)
        .not("player_id", "in", `(${retainedPlayerIds.join(",")})`);
      if (deleteErr) {
        throw new Error(`lineupService.refreshLineups stale cleanup failed: ${deleteErr.message}`);
      }
    }

    let officialMlb: Awaited<ReturnType<typeof refreshMlbOfficialLineups>> | null = null;
    if (sport === "mlb" && !deadlineReached()) {
      officialMlb = await refreshMlbOfficialLineups(date, options);
      if (officialMlb.details.deadline_reached) {
        deadlineStage = officialMlb.details.deadline_stage ?? "official_lineups";
      }
    } else if (sport === "mlb" && deadlineStage === null) {
      deadlineStage = "before_official_lineups";
    }

    const skipByReason: Record<string, number> = {};
    for (const s of skipped) {
      skipByReason[s.reason] = (skipByReason[s.reason] ?? 0) + 1;
    }

    return {
      records_updated: projectedRowsWritten + (officialMlb?.records_updated ?? 0),
      api_calls_made: apiCalls + (officialMlb?.api_calls_made ?? 0),
      details:
        skipped.length > 0 ||
        officialMlb !== null ||
        selected.incompleteTeamKeys.length > 0 ||
        selected.confirmedTeamKeys.length > 0
          ? {
              skipped_by_reason: skipByReason,
              sample_skipped: skipped.slice(0, 10),
              official_mlb_lineups: officialMlb?.details ?? null,
              projected_complete_teams: selected.units.length,
              projected_incomplete_teams_retained: selected.incompleteTeamKeys.length,
              projected_confirmed_teams_retained: selected.confirmedTeamKeys.length,
              deadline_reached: deadlineStage !== null,
              deadline_stage: deadlineStage,
              deferred_games: Math.max(0, gameIds.length - providerGamesRead),
            }
          : deadlineStage === null
            ? undefined
            : {
                deadline_reached: true,
                deadline_stage: deadlineStage,
                deferred_games: Math.max(0, gameIds.length - providerGamesRead),
                official_mlb_lineups: null,
              },
    };
  },
};
