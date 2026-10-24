#!/usr/bin/env tsx

/**
 * SELECT-only private player-props tracking report.
 *
 * NFL reads the immutable full-board private archive, with a canonical-snapshot
 * fallback for pre-release weeks. MLB reads the existing immutable T-60 game
 * lock snapshots. Results are joined from official season state/game logs.
 * Nothing is written unless --out is supplied, and that write is local only.
 */

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import {
  summarizePrivatePlayerPropTracking,
  type PrivatePlayerPropSettledRow,
} from "../../lib/services/playerPropsPrivateDiagnostics";
import {
  buildNflPlayerPropsPrivateTrackingRows,
  readNflPlayerPropsPrivateTrackingHistory,
  type NflPlayerPropsPrivateTrackingRow,
} from "../../lib/services/football/nflPlayerPropsPrivateTrackingStore";
import { readNflPlayerPropsSnapshot } from "../../lib/services/football/nflPlayerPropsSnapshotStore";
import {
  readNflPlayerPropsCurrentSeasonState,
  type NflPlayerPropsCurrentSeasonStat,
} from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";
import {
  parseNflPlayerPropsOutcomeSupplement,
  resolveNflPlayerPropsOutcome,
} from "../../lib/services/football/nflPlayerPropsOutcomeSupplement";
import {
  loadMlbPropsBoardSnapshotById,
  type MlbPropsGameLockPointer,
} from "../../lib/mlb/props/boardSnapshotStore";
import {
  readMlbPropsPrivateTrackingHistories,
  type MlbPropsPrivateTrackingRow,
} from "../../lib/mlb/props/privateTrackingStore";
import type { PlayerPropPreviewRow } from "../../app/mlb/props/components/PlayerPropsDashboard";
import {
  getHitterGameLogs,
  getPitcherGameLogs,
  type HitterGameLogRecord,
  type PitcherGameLogRecord,
} from "../../lib/providers/real_api/_mlbStatsApiClient";

loadEnvConfig(process.cwd());

type Args = {
  sport: "nfl" | "mlb";
  season: number;
  week: number | null;
  start: string | null;
  end: string | null;
  includeRows: boolean;
  out: string | null;
  nflOutcomeSupplement: string | null;
};

async function main(): Promise<void> {
  const args = parseArgs();
  const client = serviceClient();
  const loaded = args.sport === "nfl"
    ? await loadNflRows(client, args)
    : await loadMlbRows(client, args);
  const diagnostic = summarizePrivatePlayerPropTracking(loaded.rows);
  const { forecasts, ...summary } = diagnostic;
  const report = {
    release: "private_player_props_tracking_report_2026_10_15_r2_outcome_supplement",
    readOnly: true,
    productionWrites: 0,
    localOutputWritten: Boolean(args.out),
    publicSiteChanges: 0,
    scope: loaded.scope,
    coverage: loaded.coverage,
    summary,
    ...(args.includeRows ? { forecasts, exactOfferRows: loaded.rows } : {}),
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) writeFileSync(args.out, json, "utf8");
  else console.log(json);
}

async function loadNflRows(client: SupabaseClient, args: Args) {
  const state = await readNflPlayerPropsCurrentSeasonState({ client, season: args.season });
  if (!state) throw new Error(`NFL current-season state is unavailable for ${args.season}.`);
  const maximumWeek = args.week ?? state.completeThroughWeek;
  const statsById = new Map(state.stats.map((row) => [`${row.gameId}|id:${row.playerId}`, row]));
  const statsByName = new Map(state.stats.map((row) => [`${row.gameId}|name:${normalize(row.playerName)}`, row]));
  const supplement = args.nflOutcomeSupplement
    ? parseNflPlayerPropsOutcomeSupplement(JSON.parse(readFileSync(args.nflOutcomeSupplement, "utf8")), {
      season: args.season,
      week: args.week ?? state.completeThroughWeek,
    })
    : null;
  const captured: NflPlayerPropsPrivateTrackingRow[] = [];
  const archiveWeeks: number[] = [];
  const fallbackWeeks: number[] = [];
  const missingWeeks: number[] = [];
  for (let week = 1; week <= maximumWeek; week += 1) {
    const history = await readNflPlayerPropsPrivateTrackingHistory({ client, season: args.season, week });
    if (history) {
      captured.push(...history.rows);
      archiveWeeks.push(week);
      continue;
    }
    const snapshot = await readNflPlayerPropsSnapshot({ client, season: args.season, week });
    if (snapshot) {
      captured.push(...buildNflPlayerPropsPrivateTrackingRows({ snapshot, writerRelease: "pre_archive_snapshot_fallback" }));
      fallbackWeeks.push(week);
    } else {
      missingWeeks.push(week);
    }
  }
  let officialStatOmissions = 0;
  let supplementedOutcomes = 0;
  let excludedNonparticipants = 0;
  let unmatchedOutcomes = 0;
  const rows = captured.flatMap((row): PrivatePlayerPropSettledRow[] => {
    const stat = (row.providerPlayerId ? statsById.get(`${row.gameId}|id:${row.providerPlayerId}`) : undefined)
      ?? statsByName.get(`${row.gameId}|name:${normalize(row.playerName)}`);
    const storedActual = stat ? nflActual(row.market, stat) : null;
    const resolution = resolveNflPlayerPropsOutcome({
      storedActual,
      gameId: row.gameId,
      playerName: row.playerName,
      market: row.market,
      supplement,
    });
    if (storedActual === null) {
      officialStatOmissions += 1;
      if (resolution.disposition === "supplemented") supplementedOutcomes += 1;
      else if (resolution.disposition === "excluded") {
        excludedNonparticipants += 1;
        return [];
      }
    }
    const actual = resolution.actual;
    if (actual === null) { unmatchedOutcomes += 1; return []; }
    return [{
      sport: "nfl",
      gameId: row.gameId,
      playerName: row.playerName,
      market: row.market,
      line: row.line,
      side: row.side,
      sportsbook: row.sportsbook,
      americanPrice: row.americanPrice,
      canonicalMainLine: row.canonicalMainLine,
      projection: row.projection,
      independentProjection: row.independentProjection,
      rawModelProbability: row.rawModelProbability,
      marketProbability: row.marketProbability,
      finalProbability: row.finalProbability,
      publishedPrediction: null,
      grade: row.grade,
      marketMovement: row.marketMovement,
      decisionRelease: row.decisionRelease,
      lockedAt: row.lockedAt,
      actual,
    }];
  });
  return {
    rows,
    scope: { sport: "nfl", season: args.season, throughWeek: maximumWeek },
    coverage: {
      archiveWeeks,
      preArchiveSnapshotFallbackWeeks: fallbackWeeks,
      missingWeeks,
      capturedExactOffers: captured.length,
      settledExactOffers: rows.length,
      officialStatOmissions,
      supplementedOutcomes,
      excludedNonparticipants,
      unmatchedOutcomes,
      classifiedExactOffers: rows.length + excludedNonparticipants,
      complete: missingWeeks.length === 0 && unmatchedOutcomes === 0
        && rows.length + excludedNonparticipants === captured.length,
      outcomeSupplementRelease: supplement?.release ?? null,
    },
  };
}

async function loadMlbRows(client: SupabaseClient, args: Args) {
  const start = args.start ?? `${args.season}-01-01`;
  const end = args.end ?? `${args.season}-12-31`;
  const locks = await readMlbLocks(client, start, end);
  const privateHistories = await readMlbPropsPrivateTrackingHistories({ client, start, end });
  const privateGames = privateHistories.flatMap((history) => history.games);
  const privateRaw = privateGames.flatMap((game) => game.rows);
  const privatelyCapturedGames = new Set(privateHistories.flatMap((history) =>
    history.games.map((game) => `${history.slateDate}|${game.gameId}`)));
  const fallbackLocks = locks.filter((lock) => !privatelyCapturedGames.has(`${lock.slate_date}|${lock.external_game_id}`));
  const snapshotCache = new Map<string, Awaited<ReturnType<typeof loadMlbPropsBoardSnapshotById>>>();
  const raw: Array<{ row: PlayerPropPreviewRow; lock: MlbPropsGameLockPointer; canonical: boolean }> = [];
  for (const lock of fallbackLocks) {
    const cacheKey = `${lock.slate_date}|${lock.board_snapshot_id}`;
    let snapshot = snapshotCache.get(cacheKey);
    if (snapshot === undefined) {
      snapshot = await loadMlbPropsBoardSnapshotById(lock.slate_date, lock.board_snapshot_id);
      snapshotCache.set(cacheKey, snapshot);
    }
    if (!snapshot) continue;
    const gameRows = snapshot.data.props.filter((row) => row.providerIds?.gameId === lock.external_game_id);
    const canonical = canonicalMlbRowIds(gameRows);
    raw.push(...gameRows.map((row) => ({ row, lock, canonical: canonical.has(row.id) })));
  }
  const outcomeCache = new Map<string, number | null>();
  const uniquePlayers = new Map<string, { playerId: number; family: "pitcher" | "hitter"; season: number }>();
  for (const row of privateRaw) {
    const playerId = prefixedInteger(row.providerPlayerId, "mlbstats-player-");
    if (playerId === null) continue;
    const family = row.market.startsWith("pitcher_") ? "pitcher" : "hitter";
    uniquePlayers.set(`${family}|${playerId}|${row.scheduledStart.slice(0, 4)}`, {
      playerId,
      family,
      season: Number(row.scheduledStart.slice(0, 4)),
    });
  }
  for (const { row, lock } of raw) {
    const playerId = prefixedInteger(row.providerIds?.mlbStatsPlayerId, "mlbstats-player-");
    if (playerId === null) continue;
    const family = row.marketFamily === "pitcher" ? "pitcher" : "hitter";
    uniquePlayers.set(`${family}|${playerId}|${lock.slate_date.slice(0, 4)}`, {
      playerId,
      family,
      season: Number(lock.slate_date.slice(0, 4)),
    });
  }
  const players = [...uniquePlayers.values()];
  for (let index = 0; index < players.length; index += 6) {
    await Promise.all(players.slice(index, index + 6).map(async (player) => {
      const logs = player.family === "pitcher"
        ? await getPitcherGameLogs(player.playerId, player.season, { quiet: true })
        : await getHitterGameLogs(player.playerId, player.season, { quiet: true });
      for (const log of logs ?? []) {
        for (const market of marketsForLog(player.family)) {
          outcomeCache.set(`${log.game_pk}|${player.playerId}|${market}`, mlbActual(market, log));
        }
      }
    }));
  }
  let unmatchedOutcomes = 0;
  const privateRows = privateRaw.flatMap((row): PrivatePlayerPropSettledRow[] => {
    const playerId = prefixedInteger(row.providerPlayerId, "mlbstats-player-");
    const gamePk = prefixedInteger(row.gameId, "mlbstats-game-");
    const actual = playerId === null || gamePk === null ? null : outcomeCache.get(`${gamePk}|${playerId}|${row.market}`) ?? null;
    if (actual === null) { unmatchedOutcomes += 1; return []; }
    return [privateMlbSettledRow(row, actual)];
  });
  const fallbackRows = raw.flatMap(({ row, lock, canonical }): PrivatePlayerPropSettledRow[] => {
    const playerId = prefixedInteger(row.providerIds?.mlbStatsPlayerId, "mlbstats-player-");
    const gamePk = prefixedInteger(row.providerIds?.gameId, "mlbstats-game-");
    const actual = playerId === null || gamePk === null ? null : outcomeCache.get(`${gamePk}|${playerId}|${row.market}`) ?? null;
    if (actual === null) { unmatchedOutcomes += 1; return []; }
    return [{
      sport: "mlb",
      gameId: row.providerIds?.gameId ?? String(gamePk),
      playerName: row.player,
      market: row.market,
      line: row.line,
      side: row.side,
      sportsbook: row.book,
      americanPrice: row.odds,
      canonicalMainLine: canonical,
      projection: row.projection,
      // The locked MLB board preserves the final market-aware point but not
      // every release's pre-market point. Do not reconstruct or mislabel it.
      independentProjection: null,
      rawModelProbability: row.independentProbability,
      marketProbability: row.marketProbability,
      finalProbability: row.finalProbability,
      publishedPrediction: mlbPublishedPrediction(row),
      grade: row.playGrade,
      marketMovement: mlbMovement(row),
      decisionRelease: snapshotRelease(row, lock),
      lockedAt: lock.locked_at,
      actual,
    }];
  });
  const rows = [...privateRows, ...fallbackRows];
  return {
    rows,
    scope: { sport: "mlb", season: args.season, start, end },
    coverage: {
      gameLocks: locks.length,
      privateArchiveDates: privateHistories.map((history) => history.slateDate),
      privateArchiveGames: privateGames.length,
      privateArchiveExactOffers: privateRaw.length,
      historicalMainLineFallbackLocks: fallbackLocks.length,
      lockedSnapshots: snapshotCache.size,
      capturedExactOffers: privateRaw.length + raw.length,
      settledExactOffers: rows.length,
      unmatchedOutcomes,
      complete: unmatchedOutcomes === 0,
    },
  };
}

function privateMlbSettledRow(row: MlbPropsPrivateTrackingRow, actual: number): PrivatePlayerPropSettledRow {
  return {
    sport: "mlb",
    gameId: row.gameId,
    playerName: row.playerName,
    market: row.market,
    line: row.line,
    side: row.side,
    sportsbook: row.sportsbook,
    americanPrice: row.americanPrice,
    canonicalMainLine: row.canonicalMainLine,
    projection: row.projection,
    independentProjection: null,
    rawModelProbability: row.rawModelProbability,
    marketProbability: row.marketProbability,
    finalProbability: row.finalProbability,
    publishedPrediction: row.publishedPrediction,
    grade: row.grade,
    marketMovement: null,
    decisionRelease: row.modelRelease,
    lockedAt: row.lockCutoff,
    actual,
  };
}

function mlbPublishedPrediction(row: PlayerPropPreviewRow): "over" | "under" | null {
  if (row.overProbability !== null && row.underProbability !== null && row.overProbability !== row.underProbability) {
    return row.overProbability > row.underProbability ? "over" : "under";
  }
  if (row.projection !== null && row.projection !== row.line) return row.projection > row.line ? "over" : "under";
  return null;
}

async function readMlbLocks(client: SupabaseClient, start: string, end: string): Promise<MlbPropsGameLockPointer[]> {
  const locks: MlbPropsGameLockPointer[] = [];
  for (let page = 0; page < 20; page += 1) {
    const from = page * 500;
    const { data, error } = await client.from("admin_audit_log")
      .select("after_state,created_at")
      .eq("action_type", "mlb_props.game_locked_t60")
      .eq("target_table", "prop_scoring_runs")
      .gte("created_at", `${start}T00:00:00.000Z`)
      .lte("created_at", `${end}T23:59:59.999Z`)
      .order("created_at", { ascending: true })
      .range(from, from + 499);
    if (error) throw new Error(`MLB private tracking lock read failed: ${error.message}`);
    for (const value of data ?? []) {
      const lock = value.after_state as Partial<MlbPropsGameLockPointer> | null;
      if (lock && typeof lock.slate_date === "string" && typeof lock.external_game_id === "string"
        && typeof lock.board_snapshot_id === "string" && typeof lock.locked_at === "string") {
        locks.push(lock as MlbPropsGameLockPointer);
      }
    }
    if ((data ?? []).length < 500) break;
  }
  return [...new Map(locks.map((lock) => [`${lock.slate_date}|${lock.external_game_id}`, lock])).values()];
}

function canonicalMlbRowIds(rows: readonly PlayerPropPreviewRow[]): Set<string> {
  const scopes = new Map<string, PlayerPropPreviewRow[]>();
  for (const row of rows) {
    const key = `${row.providerIds?.gameId}|${normalize(row.player)}|${row.market}`;
    scopes.set(key, [...(scopes.get(key) ?? []), row]);
  }
  const selected = new Set<string>();
  for (const scopeRows of scopes.values()) {
    const byLine = new Map<number, PlayerPropPreviewRow[]>();
    for (const row of scopeRows) byLine.set(row.line, [...(byLine.get(row.line) ?? []), row]);
    const line = [...byLine.entries()].sort((first, second) => {
      const firstBooks = new Set(first[1].map((row) => normalize(row.book))).size;
      const secondBooks = new Set(second[1].map((row) => normalize(row.book))).size;
      if (firstBooks !== secondBooks) return secondBooks - firstBooks;
      return lineBalance(first[1]) - lineBalance(second[1]) || first[0] - second[0];
    })[0]?.[0];
    if (line !== undefined) for (const row of scopeRows) if (row.line === line) selected.add(row.id);
  }
  return selected;
}

function lineBalance(rows: readonly PlayerPropPreviewRow[]): number {
  const probabilities = rows.map((row) => row.marketProbability).filter((value): value is number => value !== null);
  if (!probabilities.length) return Number.POSITIVE_INFINITY;
  return Math.min(...probabilities.map((value) => Math.abs(value - 0.5)));
}

function nflActual(market: string, stat: NflPlayerPropsCurrentSeasonStat): number | null {
  if (market === "anytime_td") return stat.rushing_touchdowns + stat.receiving_touchdowns
    + stat.kick_return_touchdowns + stat.punt_return_touchdowns + stat.fumbles_touchdowns;
  const value = stat[market as keyof NflPlayerPropsCurrentSeasonStat];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function marketsForLog(family: "pitcher" | "hitter"): string[] {
  return family === "pitcher"
    ? ["pitcher_strikeouts", "pitcher_outs", "pitcher_hits_allowed", "pitcher_walks", "pitcher_earned_runs"]
    : ["batter_hits", "batter_singles", "batter_doubles", "batter_home_runs", "batter_total_bases",
      "batter_strikeouts", "batter_walks", "batter_runs_scored", "batter_rbis",
      "batter_hits_runs_rbis", "batter_stolen_bases"];
}

function mlbActual(market: string, log: PitcherGameLogRecord | HitterGameLogRecord): number | null {
  const normalized = market === "batter_runs_scored"
    ? "runs"
    : market.replace(/^pitcher_|^batter_/, "");
  const field = normalized as keyof typeof log;
  const value = log[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function snapshotRelease(row: PlayerPropPreviewRow, lock: MlbPropsGameLockPointer): string {
  return row.reasonCodes.find((value) => value.startsWith("model_release:"))?.slice("model_release:".length)
    ?? lock.model_release_id;
}

function mlbMovement(row: PlayerPropPreviewRow): "support" | "adverse" | "neutral" | null {
  const movement = row.oddsMovement;
  if (!movement) return null;
  const lineSignal = row.side === "over" ? -Math.sign(movement.lineDelta) : Math.sign(movement.lineDelta);
  const priceSignal = Math.sign(movement.impliedProbabilityDelta);
  if (lineSignal === 0 && priceSignal === 0) return "neutral";
  if (lineSignal >= 0 && priceSignal >= 0) return "support";
  if (lineSignal <= 0 && priceSignal <= 0) return "adverse";
  return "neutral";
}

function prefixedInteger(value: string | null | undefined, prefix: string): number | null {
  if (!value) return null;
  const parsed = Number(value.startsWith(prefix) ? value.slice(prefix.length) : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseArgs(): Args {
  const value = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  const sport = value("sport");
  if (sport !== "nfl" && sport !== "mlb") throw new Error("Expected --sport=nfl|mlb.");
  const season = Number(value("season") ?? "2026");
  if (!Number.isInteger(season) || season < 2000) throw new Error("--season must be a valid year.");
  const weekValue = value("week");
  const week = weekValue === null ? null : Number(weekValue);
  if (week !== null && (!Number.isInteger(week) || week < 1 || week > 25)) throw new Error("--week must be 1-25.");
  const start = value("start");
  const end = value("end");
  for (const [label, date] of [["start", start], ["end", end]] as const) {
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--${label} must use YYYY-MM-DD.`);
  }
  return {
    sport,
    season,
    week,
    start,
    end,
    includeRows: process.argv.includes("--include-rows"),
    out: value("out"),
    nflOutcomeSupplement: value("nfl-outcome-supplement"),
  };
}

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials are required.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, "");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
