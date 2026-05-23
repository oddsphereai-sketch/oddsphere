/**
 * statsService — refresh player rosters, season stats, splits, pitch-type
 * stats, and active injuries.
 *
 * Heaviest service in terms of API calls (~5 calls per player). The
 * underlying providers handle batching/retry/rate-limit concerns.
 *
 * All UPSERTs idempotent on their natural keys:
 *   players                  UNIQUE(sport, external_id)
 *   player_season_stats      UNIQUE(player_id, season, season_type)
 *   player_splits            UNIQUE(player_id, season, split_type)
 *   pitcher_pitch_stats      UNIQUE(player_id, season, pitch_type)
 *   hitter_pitch_stats       UNIQUE(player_id, season, pitch_type)
 *
 * player_injuries has no UNIQUE — strategy is delete-active-then-insert:
 * before inserting, we delete is_active=TRUE rows for the sport's players,
 * preserving the historical (is_active=FALSE) archive.
 */

import { supabase } from "../db/supabase";
import { getStatsProvider } from "../providers/factory";
import type { Sport } from "../types/domain/Sport";
import type { CronHandlerResult } from "../cron/runCron";
import {
  loadPlayerIdMap,
  loadPlayerMetadata,
  loadTeamIdMap,
} from "./_idMaps";

export const statsService = {
  /**
   * Refresh active player rosters for a sport.
   * Updates team_id (handles trades, call-ups) + active flag.
   */
  async refreshPlayers(sport: Sport): Promise<CronHandlerResult> {
    const stats = getStatsProvider();
    const teamIdByExternal = await loadTeamIdMap(sport);

    const recs = await stats.getPlayers();
    let apiCalls = 1;
    const playersForSport = recs.filter((p) => p.sport === sport);
    if (playersForSport.length === 0) {
      return { records_updated: 0, api_calls_made: apiCalls };
    }

    const payload = playersForSport.map((p) => ({
      sport: p.sport,
      external_id: p.external_id,
      team_id:
        p.team_external_id !== null
          ? teamIdByExternal.get(p.team_external_id) ?? null
          : null,
      first_name: p.first_name,
      last_name: p.last_name,
      full_name: p.full_name,
      jersey: p.jersey,
      position: p.position,
      position_abbr: p.position_abbr,
      is_pitcher: p.is_pitcher,
      active: p.active,
      bats: p.bats,
      throws: p.throws,
      birth_place: p.birth_place,
      dob: p.dob,
      age: p.age,
      height: p.height,
      weight: p.weight,
      debut_year: p.debut_year,
    }));

    const { error } = await supabase
      .from("players")
      .upsert(payload, { onConflict: "sport,external_id" });
    if (error) {
      throw new Error(`statsService.refreshPlayers upsert failed: ${error.message}`);
    }

    return { records_updated: payload.length, api_calls_made: apiCalls };
  },

  /**
   * Refresh season stats for all players in the sport.
   * Per-player API call (provider handles batching internally if available).
   */
  async refreshSeasonStats(
    sport: Sport,
    seasons: number[]
  ): Promise<CronHandlerResult> {
    const stats = getStatsProvider();
    const teamIdByExternal = await loadTeamIdMap(sport);
    const playerIdByExternal = await loadPlayerIdMap(sport);

    const allRows: Array<Record<string, unknown>> = [];
    let apiCalls = 0;

    for (const [extId, dbId] of playerIdByExternal) {
      const rows = await stats.getPlayerSeasonStats(extId, seasons);
      apiCalls++;
      for (const r of rows) {
        allRows.push({
          player_id: dbId,
          team_id:
            r.team_external_id !== null
              ? teamIdByExternal.get(r.team_external_id) ?? null
              : null,
          season: r.season,
          season_type: r.season_type,
          postseason: r.postseason,
          batting_gp: r.batting_gp, batting_ab: r.batting_ab, batting_r: r.batting_r,
          batting_h: r.batting_h, batting_avg: r.batting_avg, batting_2b: r.batting_2b,
          batting_3b: r.batting_3b, batting_hr: r.batting_hr, batting_rbi: r.batting_rbi,
          batting_tb: r.batting_tb, batting_bb: r.batting_bb, batting_so: r.batting_so,
          batting_sb: r.batting_sb, batting_obp: r.batting_obp, batting_slg: r.batting_slg,
          batting_ops: r.batting_ops, batting_war: r.batting_war, batting_pa: r.batting_pa,
          batting_hbp: r.batting_hbp, batting_sf: r.batting_sf,
          pitching_gp: r.pitching_gp, pitching_gs: r.pitching_gs, pitching_qs: r.pitching_qs,
          pitching_w: r.pitching_w, pitching_l: r.pitching_l, pitching_era: r.pitching_era,
          pitching_sv: r.pitching_sv, pitching_hld: r.pitching_hld, pitching_ip: r.pitching_ip,
          pitching_h: r.pitching_h, pitching_er: r.pitching_er, pitching_hr: r.pitching_hr,
          pitching_bb: r.pitching_bb, pitching_whip: r.pitching_whip, pitching_k: r.pitching_k,
          pitching_k_per_9: r.pitching_k_per_9, pitching_war: r.pitching_war,
        });
      }
    }

    if (allRows.length > 0) {
      const { error } = await supabase
        .from("player_season_stats")
        .upsert(allRows, { onConflict: "player_id,season,season_type" });
      if (error) {
        throw new Error(`statsService.refreshSeasonStats upsert failed: ${error.message}`);
      }
    }

    return { records_updated: allRows.length, api_calls_made: apiCalls };
  },

  /**
   * Refresh hitter splits (vs_lhp / vs_rhp etc.) for a season.
   * Skips pitchers (their splits don't drive the prop model).
   */
  async refreshSplits(sport: Sport, season: number): Promise<CronHandlerResult> {
    const stats = getStatsProvider();
    const players = await loadPlayerMetadata(sport);

    const allRows: Array<Record<string, unknown>> = [];
    let apiCalls = 0;
    for (const [extId, p] of players) {
      if (p.is_pitcher) continue;
      const rows = await stats.getPlayerSplits(extId, season);
      apiCalls++;
      for (const r of rows) {
        allRows.push({
          player_id: p.id,
          season: r.season,
          split_type: r.split_type,
          ab: r.ab, h: r.h, avg: r.avg, obp: r.obp, slg: r.slg, ops: r.ops,
          hr: r.hr, rbi: r.rbi, so: r.so, bb: r.bb, tb: r.tb, pa: r.pa,
        });
      }
    }

    if (allRows.length > 0) {
      const { error } = await supabase
        .from("player_splits")
        .upsert(allRows, { onConflict: "player_id,season,split_type" });
      if (error) {
        throw new Error(`statsService.refreshSplits upsert failed: ${error.message}`);
      }
    }

    return { records_updated: allRows.length, api_calls_made: apiCalls };
  },

  /**
   * Refresh pitch-type stats for both pitchers and hitters.
   * Writes to pitcher_pitch_stats AND hitter_pitch_stats; counts combined.
   */
  async refreshPitchStats(sport: Sport, season: number): Promise<CronHandlerResult> {
    const stats = getStatsProvider();
    const players = await loadPlayerMetadata(sport);

    const pitcherRows: Array<Record<string, unknown>> = [];
    const hitterRows: Array<Record<string, unknown>> = [];
    let apiCalls = 0;

    for (const [extId, p] of players) {
      if (p.is_pitcher) {
        const rows = await stats.getPitcherPitchStats(extId, season);
        apiCalls++;
        for (const r of rows) {
          pitcherRows.push({
            player_id: p.id, season: r.season, pitch_type: r.pitch_type,
            count: r.count, pct_of_total: r.pct_of_total, avg_velo_mph: r.avg_velo_mph,
            whiff_rate: r.whiff_rate, k_rate: r.k_rate, contact_rate: r.contact_rate,
          });
        }
      } else {
        const rows = await stats.getHitterPitchStats(extId, season);
        apiCalls++;
        for (const r of rows) {
          hitterRows.push({
            player_id: p.id, season: r.season, pitch_type: r.pitch_type,
            pa: r.pa, ab: r.ab, h: r.h, hr: r.hr, so: r.so, bb: r.bb,
            avg: r.avg, slg: r.slg, ops: r.ops,
            whiff_rate: r.whiff_rate, contact_rate: r.contact_rate,
          });
        }
      }
    }

    if (pitcherRows.length > 0) {
      const { error: pErr } = await supabase
        .from("pitcher_pitch_stats")
        .upsert(pitcherRows, { onConflict: "player_id,season,pitch_type" });
      if (pErr) {
        throw new Error(`statsService.refreshPitchStats (pitcher) upsert failed: ${pErr.message}`);
      }
    }
    if (hitterRows.length > 0) {
      const { error: hErr } = await supabase
        .from("hitter_pitch_stats")
        .upsert(hitterRows, { onConflict: "player_id,season,pitch_type" });
      if (hErr) {
        throw new Error(`statsService.refreshPitchStats (hitter) upsert failed: ${hErr.message}`);
      }
    }

    return {
      records_updated: pitcherRows.length + hitterRows.length,
      api_calls_made: apiCalls,
      details: {
        pitcher_rows: pitcherRows.length,
        hitter_rows: hitterRows.length,
      },
    };
  },

  /**
   * Refresh active injuries for the sport. delete-active-then-insert so
   * resolved injuries (is_active=false) keep their historical row.
   */
  async refreshInjuries(sport: Sport): Promise<CronHandlerResult> {
    const stats = getStatsProvider();
    const players = await loadPlayerMetadata(sport);
    const playerIds = [...players.values()].map((p) => p.id);

    const injuries = await stats.getInjuries(sport);
    const apiCalls = 1;

    if (playerIds.length > 0) {
      const { error: delErr } = await supabase
        .from("player_injuries")
        .delete()
        .eq("is_active", true)
        .in("player_id", playerIds);
      if (delErr) {
        throw new Error(`statsService.refreshInjuries delete failed: ${delErr.message}`);
      }
    }

    const payload = injuries
      .filter((i) => players.has(i.player_external_id))
      .map((i) => ({
        player_id: players.get(i.player_external_id)!.id,
        injury_date: i.injury_date,
        return_date: i.return_date,
        type: i.type,
        detail: i.detail,
        side: i.side,
        status: i.status,
        long_comment: i.long_comment,
        short_comment: i.short_comment,
        is_active: i.is_active,
      }));

    if (payload.length > 0) {
      const { error } = await supabase.from("player_injuries").insert(payload);
      if (error) {
        throw new Error(`statsService.refreshInjuries insert failed: ${error.message}`);
      }
    }

    return { records_updated: payload.length, api_calls_made: apiCalls };
  },
};
