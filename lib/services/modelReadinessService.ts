/**
 * MLB model readiness service.
 *
 * Push 3B-6 — extracted from
 *   scripts/operator/audit-mlb-model-readiness.ts
 *   scripts/operator/repair-mlb-model-readiness.ts
 *
 * so the slate-cycle orchestrator service can import readiness logic
 * without dragging CLI top-level `main()` calls into the Next build
 * worker. Same logic, same gate semantics, structured return values.
 *
 * AUDIT is read-only. REPAIR delegates to existing safe helpers:
 *   • runBdlPlayerBackfillCycle   (players table — BDL mappings)
 *   • runSeasonPitchingCycle      (player_season_stats)
 *   • lineupService.refreshLineups (lineups)
 *   • weatherService.refreshForecasts (weather_forecasts)
 *
 * Never imports anything that writes to game_predictions,
 * slate_status, locked_at, tracking, or model_version. The service
 * cannot publish, unpublish, lock, or unlock — there is simply no
 * code path here that touches those tables.
 */

import { supabase } from "../db/supabase";
import { runBdlPlayerBackfillCycle } from "./bdlPlayerBackfillService";
import { lineupService } from "./lineupService";
import { weatherService } from "./weatherService";
import { runSeasonPitchingCycle } from "../../scripts/operator/backfill-season-pitching-stats";
import type { Sport } from "../types/domain/Sport";

function providerMlbStatsId(
  providerIds: Record<string, unknown> | null | undefined
): number | null {
  const mlbStats = providerIds?.mlb_stats;
  if (typeof mlbStats !== "object" || mlbStats === null) return null;
  const id = (mlbStats as { id?: unknown }).id;
  if (typeof id === "number" && Number.isFinite(id)) return id;
  const parsed = typeof id === "string" ? Number(id) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function effectiveMlbStatsId(player: {
  mlb_person_id?: number | null;
  provider_ids?: Record<string, unknown> | null;
} | undefined): number | null {
  if (player === undefined) return null;
  return providerMlbStatsId(player.provider_ids) ?? player.mlb_person_id ?? null;
}

export type ReadinessBlocker =
  | "starter_assignment_missing"
  | "starter_mlb_id_missing"
  | "starter_stats_missing_backfillable"
  | "starter_stats_provider_empty"
  | "lineup_missing_backfillable"
  | "fi_market_missing"
  | "weather_missing_backfillable"
  | "weather_stale_refreshable"
  | "park_factor_missing";

export type ReadinessPerGame = {
  matchup: string;
  game_id: number;
  external_id: number;
  home_pitcher_id: number | null;
  away_pitcher_id: number | null;
  home_pitcher_name: string | null;
  away_pitcher_name: string | null;
  home_pitcher_mlb_id: number | null;
  away_pitcher_mlb_id: number | null;
  home_starter_stats: boolean;
  away_starter_stats: boolean;
  home_lineup_count: number;
  away_lineup_count: number;
  fi_market_rows: number;
  full_game_market_rows: number;
  weather_present: boolean;
  /** Present-but-stale: a forecast row exists but is older than the
   * freshness window AND the game has not started — so it should be
   * re-fetched to sharpen toward first pitch. */
  weather_stale: boolean;
  park_present: boolean;
  v22_ready: boolean;
  fi_v2_ready: boolean;
  blockers: ReadinessBlocker[];
};

export type ReadinessAuditReport = {
  sport: Sport;
  date: string;
  games_total: number;
  v22_ready_count: number;
  fi_v2_ready_count: number;
  blocker_counts: Record<string, number>;
  pitchers_needing_stats: Array<{ id: number; name: string | null; mlb_id: number | null }>;
  per_game: ReadinessPerGame[];
};

/**
 * Pure read of DB state. Never writes. Never calls external providers.
 */
export async function auditMlbModelReadiness(args: {
  sport: Sport;
  date: string;
}): Promise<ReadinessAuditReport> {
  const { sport, date } = args;
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, ballpark_id, game_date")
    .eq("slate_date", date)
    .eq("sport", sport)
    .order("game_date");

  const empty: ReadinessAuditReport = {
    sport, date, games_total: 0, v22_ready_count: 0, fi_v2_ready_count: 0,
    blocker_counts: {}, pitchers_needing_stats: [], per_game: [],
  };
  if (!games || games.length === 0) return empty;

  const gameIds = games.map((g) => g.id as number);
  const { data: teams } = await supabase.from("teams").select("id, abbreviation");
  const abbr = new Map((teams ?? []).map((t) => [t.id as number, t.abbreviation as string]));

  const allPitcherIds = Array.from(new Set(
    games.flatMap((g) => [g.home_pitcher_id, g.away_pitcher_id]).filter((x): x is number => x !== null),
  ));
  const { data: pitchers } = await supabase
    .from("players")
    .select("id, full_name, team_id, mlb_person_id, provider_ids")
    .in("id", allPitcherIds);
  const pitcherById = new Map((pitchers ?? []).map((p) => [p.id as number, p]));

  const season = Number(date.slice(0, 4));
  const { data: pStats } = await supabase
    .from("player_season_stats")
    .select("player_id, pitching_era, first_inning_era, first_inning_starts")
    .in("player_id", allPitcherIds)
    .eq("season", season);
  const statsByPlayer = new Map((pStats ?? []).map((s) => [s.player_id as number, s]));

  const { data: lineupRows } = await supabase
    .from("lineups")
    .select("game_id, team_id, starting_position")
    .in("game_id", gameIds);
  const lineupCounts = new Map<string, number>();
  for (const l of lineupRows ?? []) {
    const sp = (l.starting_position as string | null) ?? "";
    if (sp === "P" || sp === "SP" || sp === "RP") continue;
    const k = `${l.game_id}|${l.team_id}`;
    lineupCounts.set(k, (lineupCounts.get(k) ?? 0) + 1);
  }

  const { data: lineRows } = await supabase
    .from("lines")
    .select("game_id, market_type")
    .in("game_id", gameIds);
  const fiCounts = new Map<number, number>();
  const fullGameCounts = new Map<number, number>();
  for (const l of lineRows ?? []) {
    const k = l.game_id as number;
    if (l.market_type === "first_inning_total") fiCounts.set(k, (fiCounts.get(k) ?? 0) + 1);
    if (l.market_type === "moneyline" || l.market_type === "total" || l.market_type === "spread") {
      fullGameCounts.set(k, (fullGameCounts.get(k) ?? 0) + 1);
    }
  }

  // Pull fetched_at so we can detect present-but-stale forecasts (not just
  // missing ones). Keep the NEWEST fetched_at per game.
  const { data: wxRows } = await supabase
    .from("weather_forecasts")
    .select("game_id, fetched_at")
    .in("game_id", gameIds);
  const weatherPresent = new Set((wxRows ?? []).map((w) => w.game_id as number));
  const weatherFetchedAt = new Map<number, number>();
  for (const w of wxRows ?? []) {
    const gid = w.game_id as number;
    const ts = w.fetched_at ? new Date(w.fetched_at as string).getTime() : NaN;
    if (!Number.isNaN(ts)) {
      weatherFetchedAt.set(gid, Math.max(weatherFetchedAt.get(gid) ?? 0, ts));
    }
  }
  // Stale-weather window. A forecast is "stale" once it is older than
  // WEATHER_STALE_MS AND the game starts within WEATHER_REFRESH_WINDOW_MS
  // (so we sharpen toward first pitch without re-hitting the API all day
  // for far-off games). Games already started are left alone — their
  // prediction snapshots have locked, and refreshing weather then would
  // not change a frozen snapshot. Tuned for an hourly cron.
  const WEATHER_STALE_MS = 3 * 60 * 60 * 1000;
  const WEATHER_REFRESH_WINDOW_MS = 8 * 60 * 60 * 1000;
  const nowMsReadiness = Date.now();

  const parkIds = Array.from(new Set(games.map((g) => g.ballpark_id).filter((x): x is number => x !== null)));
  const { data: parks } = await supabase.from("ballparks").select("id, park_factor_runs").in("id", parkIds);
  const parkPresent = new Map((parks ?? []).map((p) => [p.id as number, (p.park_factor_runs as number | null) !== null]));

  const perGame: ReadinessPerGame[] = [];
  for (const g of games) {
    const matchup = `${abbr.get(g.away_team_id as number) ?? "?"}@${abbr.get(g.home_team_id as number) ?? "?"}`;
    const homePitcher = g.home_pitcher_id !== null ? pitcherById.get(g.home_pitcher_id as number) : undefined;
    const awayPitcher = g.away_pitcher_id !== null ? pitcherById.get(g.away_pitcher_id as number) : undefined;
    const homeStats = g.home_pitcher_id !== null ? statsByPlayer.get(g.home_pitcher_id as number) : undefined;
    const awayStats = g.away_pitcher_id !== null ? statsByPlayer.get(g.away_pitcher_id as number) : undefined;
    const homeStatsOk = homeStats !== undefined && homeStats.pitching_era !== null;
    const awayStatsOk = awayStats !== undefined && awayStats.pitching_era !== null;
    const homeLineupCount = lineupCounts.get(`${g.id}|${g.home_team_id}`) ?? 0;
    const awayLineupCount = lineupCounts.get(`${g.id}|${g.away_team_id}`) ?? 0;
    const fiMktRows = fiCounts.get(g.id as number) ?? 0;
    const fgMktRows = fullGameCounts.get(g.id as number) ?? 0;
    const weather = weatherPresent.has(g.id as number);
    // Stale = present, older than the freshness window, and the game has
    // not started yet (and starts within the refresh window).
    const gameStartMs = g.game_date ? new Date(g.game_date as string).getTime() : NaN;
    const fetchedMs = weatherFetchedAt.get(g.id as number);
    const weatherStale =
      weather &&
      fetchedMs !== undefined &&
      !Number.isNaN(gameStartMs) &&
      gameStartMs > nowMsReadiness &&
      gameStartMs - nowMsReadiness <= WEATHER_REFRESH_WINDOW_MS &&
      nowMsReadiness - fetchedMs > WEATHER_STALE_MS;
    const park = g.ballpark_id !== null ? (parkPresent.get(g.ballpark_id as number) === true) : false;

    const blockers: ReadinessBlocker[] = [];
    if (g.home_pitcher_id === null) blockers.push("starter_assignment_missing");
    if (g.away_pitcher_id === null) blockers.push("starter_assignment_missing");
    const homePitcherMlbId = effectiveMlbStatsId(homePitcher as {
      mlb_person_id?: number | null;
      provider_ids?: Record<string, unknown> | null;
    } | undefined);
    const awayPitcherMlbId = effectiveMlbStatsId(awayPitcher as {
      mlb_person_id?: number | null;
      provider_ids?: Record<string, unknown> | null;
    } | undefined);
    if (homePitcher && homePitcherMlbId === null) {
      blockers.push("starter_mlb_id_missing");
    }
    if (awayPitcher && awayPitcherMlbId === null) {
      blockers.push("starter_mlb_id_missing");
    }
    if (g.home_pitcher_id !== null && !homeStatsOk && homePitcherMlbId !== null) blockers.push("starter_stats_missing_backfillable");
    if (g.away_pitcher_id !== null && !awayStatsOk && awayPitcherMlbId !== null) blockers.push("starter_stats_missing_backfillable");
    if (homeLineupCount < 8 || awayLineupCount < 8) blockers.push("lineup_missing_backfillable");
    if (fiMktRows === 0) blockers.push("fi_market_missing");
    if (!weather) blockers.push("weather_missing_backfillable");
    else if (weatherStale) blockers.push("weather_stale_refreshable");
    if (!park) blockers.push("park_factor_missing");

    const v22Ready =
      g.home_pitcher_id !== null && g.away_pitcher_id !== null &&
      homeStatsOk && awayStatsOk && fgMktRows >= 4 && park;
    const fiV2Ready =
      g.home_pitcher_id !== null && g.away_pitcher_id !== null &&
      homeStatsOk && awayStatsOk && fiMktRows >= 2 && park;

    perGame.push({
      matchup, game_id: g.id as number, external_id: g.external_id as number,
      home_pitcher_id: g.home_pitcher_id as number | null,
      away_pitcher_id: g.away_pitcher_id as number | null,
      home_pitcher_name: (homePitcher?.full_name as string | null) ?? null,
      away_pitcher_name: (awayPitcher?.full_name as string | null) ?? null,
      home_pitcher_mlb_id: homePitcherMlbId,
      away_pitcher_mlb_id: awayPitcherMlbId,
      home_starter_stats: homeStatsOk,
      away_starter_stats: awayStatsOk,
      home_lineup_count: homeLineupCount,
      away_lineup_count: awayLineupCount,
      fi_market_rows: fiMktRows,
      full_game_market_rows: fgMktRows,
      weather_present: weather,
      weather_stale: weatherStale,
      park_present: park,
      v22_ready: v22Ready,
      fi_v2_ready: fiV2Ready,
      blockers: Array.from(new Set(blockers)),
    });
  }

  const blockerCounts: Record<string, number> = {};
  for (const p of perGame) for (const b of p.blockers) blockerCounts[b] = (blockerCounts[b] ?? 0) + 1;

  const pitchersNeedingStats: Array<{ id: number; name: string | null; mlb_id: number | null }> = [];
  for (const p of perGame) {
    if (!p.home_starter_stats && p.home_pitcher_id !== null) pitchersNeedingStats.push({ id: p.home_pitcher_id, name: p.home_pitcher_name, mlb_id: p.home_pitcher_mlb_id });
    if (!p.away_starter_stats && p.away_pitcher_id !== null) pitchersNeedingStats.push({ id: p.away_pitcher_id, name: p.away_pitcher_name, mlb_id: p.away_pitcher_mlb_id });
  }
  const uniqStats = Array.from(new Map(pitchersNeedingStats.map((x) => [x.id, x])).values());

  return {
    sport, date,
    games_total: perGame.length,
    v22_ready_count: perGame.filter((p) => p.v22_ready).length,
    fi_v2_ready_count: perGame.filter((p) => p.fi_v2_ready).length,
    blocker_counts: blockerCounts,
    pitchers_needing_stats: uniqStats,
    per_game: perGame,
  };
}

// ─── Repair ─────────────────────────────────────────────────────────

export type ReadinessRepairReason =
  | "readiness_ok"
  | "bdl_player_backfill_ok"
  | "bdl_player_backfill_skipped"
  | "starter_stats_backfilled"
  | "starter_stats_provider_empty"
  | "starter_stats_api_error"
  | "lineup_backfilled"
  | "lineup_provider_empty"
  | "weather_backfilled"
  | "weather_provider_error";

export type ReadinessRepairReport = {
  sport: Sport;
  date: string;
  write_mode: boolean;
  steps: {
    bdl_players: { ran: boolean; status?: string; counts?: Record<string, number>; linked?: number; created?: number; failed?: number; pre_map_size?: number; post_map_size?: number; reason?: string };
    season_pitching: { ran: boolean; planned_inserts?: number; rows_written?: number; errors?: number; status?: string; reason?: string };
    lineup: { ran: boolean; records_updated?: number; skipped_by_reason?: Record<string, number>; reason?: string };
    weather: { ran: boolean; records_updated?: number; reason?: string };
  };
  reasons: ReadinessRepairReason[];
};

export async function repairMlbModelReadiness(args: {
  sport: Sport;
  date: string;
  writeMode: boolean;
  providerGuards: {
    playerStatsProviderReal: boolean;
    weatherProviderReal: boolean;
    bdlWritesEnabled: boolean;
  };
  audit?: ReadinessAuditReport;
  log?: (m: string) => void;
}): Promise<ReadinessRepairReport> {
  const log = args.log ?? (() => {});
  const audit = args.audit ?? (await auditMlbModelReadiness({ sport: args.sport, date: args.date }));
  const reasons: ReadinessRepairReport["reasons"] = [];

  const report: ReadinessRepairReport = {
    sport: args.sport,
    date: args.date,
    write_mode: args.writeMode,
    steps: {
      bdl_players: { ran: false },
      season_pitching: { ran: false },
      lineup: { ran: false },
      weather: { ran: false },
    },
    reasons,
  };

  if (audit.games_total === 0) {
    log("readiness: no slate; nothing to repair");
    reasons.push("readiness_ok");
    return report;
  }

  let activeAudit = audit;
  let pitchersNeedingStats = activeAudit.pitchers_needing_stats
    .filter((p) => p.mlb_id !== null)
    .map((p) => p.id);
  const lineupGapPresent = activeAudit.per_game.some((p) => p.home_lineup_count < 8 || p.away_lineup_count < 8);
  // Gap = a game with NO forecast OR a present-but-stale forecast (so the
  // refresh below sharpens weather toward first pitch instead of only
  // filling missing rows once in the morning). refreshForecasts is a full
  // slate re-fetch, so one stale game refreshes the whole slate cleanly.
  const weatherGapPresent = activeAudit.per_game.some((p) => !p.weather_present || p.weather_stale);

  if (
    pitchersNeedingStats.length === 0 &&
    !lineupGapPresent &&
    !weatherGapPresent
  ) {
    reasons.push("readiness_ok");
    log("readiness: all gates green");
    return report;
  }

  // ─── Step A — BDL player backfill (always runs in real-provider mode) ───
  // This is the upstream of lineup refresh — if BDL emits a new
  // player_external_id today that we haven't mapped, this populates
  // `players` first so lineup refresh won't skip it.
  if (args.providerGuards.playerStatsProviderReal) {
    try {
      const bdlWriteMode = args.writeMode && args.providerGuards.bdlWritesEnabled;
      const r = await runBdlPlayerBackfillCycle({
        sport: args.sport,
        date: args.date,
        writeMode: bdlWriteMode,
        log: (m) => log(`  [bdl] ${m}`),
      });
      report.steps.bdl_players = {
        ran: true,
        status: r.status,
        counts: r.counts as unknown as Record<string, number>,
        linked: r.linked,
        created: r.created,
        failed: r.failed,
        pre_map_size: r.pre_map_size,
        post_map_size: r.post_map_size,
      };
      if (bdlWriteMode && (r.linked + r.created) > 0) reasons.push("bdl_player_backfill_ok");
      else reasons.push("bdl_player_backfill_skipped");

      // BDL player backfill can create/link probable-starter rows during
      // this same repair pass. Re-audit before the season-pitching step so
      // newly mapped starters are immediately eligible for stats backfill
      // instead of waiting for the next cron cycle.
      if (bdlWriteMode && (r.linked + r.created) > 0) {
        activeAudit = await auditMlbModelReadiness({ sport: args.sport, date: args.date });
        pitchersNeedingStats = activeAudit.pitchers_needing_stats
          .filter((p) => p.mlb_id !== null)
          .map((p) => p.id);
      }
    } catch (e) {
      report.steps.bdl_players = { ran: false, reason: (e as Error).message };
      reasons.push("bdl_player_backfill_skipped");
    }
  } else {
    report.steps.bdl_players = { ran: false, reason: "PLAYER_STATS_PROVIDER!=real_api" };
    reasons.push("bdl_player_backfill_skipped");
  }

  // ─── Step B — pitcher season-stats backfill ─────────────────────────
  if (pitchersNeedingStats.length > 0) {
    if (args.writeMode && !args.providerGuards.playerStatsProviderReal) {
      report.steps.season_pitching = { ran: false, reason: "PLAYER_STATS_PROVIDER!=real_api" };
      reasons.push("starter_stats_api_error");
    } else {
      try {
        const season = Number(args.date.slice(0, 4));
        const r = await runSeasonPitchingCycle({
          sport: args.sport,
          playerIds: pitchersNeedingStats,
          season,
          writeMode: args.writeMode,
          log: (m) => log(`  [pitcher] ${m}`),
        });
        report.steps.season_pitching = {
          ran: true,
          planned_inserts: r.planned_inserts,
          rows_written: r.rows_written,
          errors: r.errors,
          status: r.status,
        };
        if (r.rows_written > 0) reasons.push("starter_stats_backfilled");
        else if (r.errors > 0) reasons.push("starter_stats_api_error");
        else reasons.push("starter_stats_provider_empty");
      } catch (e) {
        report.steps.season_pitching = { ran: false, reason: (e as Error).message };
        reasons.push("starter_stats_api_error");
      }
    }
  }

  // ─── Step C — lineup refresh ────────────────────────────────────────
  if (lineupGapPresent) {
    if (args.writeMode && !args.providerGuards.playerStatsProviderReal) {
      report.steps.lineup = { ran: false, reason: "PLAYER_STATS_PROVIDER!=real_api" };
    } else if (!args.writeMode) {
      report.steps.lineup = { ran: false, reason: "dry_run" };
    } else {
      try {
        const r = await lineupService.refreshLineups(args.sport, args.date);
        const details = (r.details ?? {}) as { skipped_by_reason?: Record<string, number> };
        report.steps.lineup = {
          ran: true,
          records_updated: r.records_updated ?? 0,
          skipped_by_reason: details.skipped_by_reason,
        };
        if ((r.records_updated ?? 0) > 0) reasons.push("lineup_backfilled");
        else reasons.push("lineup_provider_empty");
      } catch (e) {
        report.steps.lineup = { ran: false, reason: (e as Error).message };
        reasons.push("lineup_provider_empty");
      }
    }
  }

  // ─── Step D — weather refresh ───────────────────────────────────────
  if (weatherGapPresent) {
    if (args.writeMode && !args.providerGuards.weatherProviderReal) {
      report.steps.weather = { ran: false, reason: "WEATHER_PROVIDER!=real_api" };
      reasons.push("weather_provider_error");
    } else if (!args.writeMode) {
      report.steps.weather = { ran: false, reason: "dry_run" };
    } else {
      try {
        const r = await weatherService.refreshForecasts(args.sport, args.date);
        report.steps.weather = { ran: true, records_updated: r.records_updated ?? 0 };
        if ((r.records_updated ?? 0) > 0) reasons.push("weather_backfilled");
        else reasons.push("weather_provider_error");
      } catch (e) {
        report.steps.weather = { ran: false, reason: (e as Error).message };
        reasons.push("weather_provider_error");
      }
    }
  }

  return report;
}
