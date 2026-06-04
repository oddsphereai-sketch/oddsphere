/**
 * Phase 4.2.C.1.R-16D — Market coverage gate (read-only).
 *
 * Single function: `assessMarketCoverage(sport, date, opts?)`. Returns a
 * per-game + aggregate report describing whether the slate has enough
 * market data for the automodel + reviewer to run safely.
 *
 * NOT wired into automodel today. Dry-run / report-only. Designed so a
 * future step (R-16D step 2 or R-17 orchestrator) can pipe the result
 * into automodel and either fail closed or hold affected markets when
 * coverage drops.
 *
 * What it checks (per game):
 *   • lines exist for moneyline / total / spread
 *   • sharp_signals exist for moneyline / total / spread
 *   • lines freshness (max age in minutes vs the most recent fetched_at)
 *   • mismatches: games with sharp_signals but NO lines (the R-16D
 *     coverage shrink failure mode)
 *
 * Pure read-only — no writes anywhere. Safe to call from operator
 * scripts, future cron handlers, and tests.
 */

import { supabase } from "../db/supabase";
import type { Sport } from "../types/domain/Sport";
import { loadGameIdMap } from "./_idMaps";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type PerGameCoverage = {
  game_id: number;
  external_id: number;
  ml_lines: number;
  total_lines: number;
  spread_lines: number;
  books_count: number;
  oldest_line_minutes_ago: number | null;
  newest_line_minutes_ago: number | null;
  ml_signals: number;
  total_signals: number;
  spread_signals: number;
  has_lines: boolean;
  has_signals: boolean;
  /** True iff sharp_signals rows exist but `lines` is empty for this game. */
  has_signals_no_lines: boolean;
  /**
   * Suggested per-game gate decision. Conservative; consumer may decide
   * to ignore it and use raw counts.
   *   "ok"             — both lines and signals present for the markets
   *                      we model (ML + Total)
   *   "hold_ml"        — ML lines missing
   *   "hold_total"     — Total lines missing
   *   "hold_both"      — Neither ML nor Total lines available
   *   "stale"          — Lines exist but newest is older than threshold
   */
  suggested_decision:
    | "ok"
    | "hold_ml"
    | "hold_total"
    | "hold_both"
    | "stale";
};

export type AggregateCoverage = {
  total_games: number;
  games_with_ml_lines: number;
  games_with_total_lines: number;
  games_with_spread_lines: number;
  games_with_signals: number;
  games_with_signals_no_lines: number;
  games_with_stale_lines: number;
  ml_coverage_pct: number;
  total_coverage_pct: number;
  spread_coverage_pct: number;
};

export type CoverageGateOverall =
  | "ok"
  | "degraded"
  | "fail_closed";

export type MarketCoverageReport = {
  sport: Sport;
  date: string;
  assessed_at: string;
  per_game: PerGameCoverage[];
  aggregate: AggregateCoverage;
  overall: CoverageGateOverall;
  /** Human-readable reasons that contributed to the overall verdict. */
  reasons: string[];
};

export type AssessMarketCoverageOpts = {
  /**
   * Lines older than this many minutes are considered stale. Default 60.
   * 0 disables the staleness check (lines never stale).
   */
  staleThresholdMinutes?: number;
  /**
   * Overall verdict thresholds. Default:
   *   • fail_closed when ml_coverage_pct < 50 OR total_coverage_pct < 50
   *   • degraded   when either < 100 OR any "has_signals_no_lines" game
   *   • ok         otherwise
   */
  failClosedMlPct?: number;
  failClosedTotalPct?: number;
};

// ─────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────

const MARKETS_GAME_LEVEL = ["moneyline", "total", "spread"] as const;

export async function assessMarketCoverage(
  sport: Sport,
  date: string,
  opts?: AssessMarketCoverageOpts
): Promise<MarketCoverageReport> {
  const staleMin = opts?.staleThresholdMinutes ?? 60;
  const failMlPct = opts?.failClosedMlPct ?? 50;
  const failTotalPct = opts?.failClosedTotalPct ?? 50;

  const assessedAt = new Date();
  const assessedAtIso = assessedAt.toISOString();

  const gameIdByExternal = await loadGameIdMap(sport, date);
  const gameIds = [...gameIdByExternal.values()];
  if (gameIds.length === 0) {
    return {
      sport,
      date,
      assessed_at: assessedAtIso,
      per_game: [],
      aggregate: {
        total_games: 0,
        games_with_ml_lines: 0,
        games_with_total_lines: 0,
        games_with_spread_lines: 0,
        games_with_signals: 0,
        games_with_signals_no_lines: 0,
        games_with_stale_lines: 0,
        ml_coverage_pct: 0,
        total_coverage_pct: 0,
        spread_coverage_pct: 0,
      },
      overall: "fail_closed",
      reasons: [`no slate games in DB for ${sport}/${date}`],
    };
  }

  const externalIdByGameId = new Map<number, number>();
  for (const [ext, id] of gameIdByExternal.entries()) {
    externalIdByGameId.set(id, ext);
  }

  // Pull all relevant lines + sharp_signals rows in two queries.
  const [{ data: linesRows, error: linesErr }, { data: sigsRows, error: sigsErr }] =
    await Promise.all([
      supabase
        .from("lines")
        .select("game_id, market_type, sportsbook, fetched_at")
        .in("game_id", gameIds)
        .is("player_id", null),
      supabase
        .from("sharp_signals")
        .select("game_id, market_type")
        .in("game_id", gameIds),
    ]);
  if (linesErr) {
    throw new Error(`assessMarketCoverage lines read failed: ${linesErr.message}`);
  }
  if (sigsErr) {
    throw new Error(`assessMarketCoverage sharp_signals read failed: ${sigsErr.message}`);
  }

  type LineRow = {
    game_id: number;
    market_type: string;
    sportsbook: string;
    fetched_at: string | null;
  };
  type SigRow = { game_id: number; market_type: string };

  const linesByGame = new Map<number, LineRow[]>();
  for (const row of (linesRows ?? []) as LineRow[]) {
    let bucket = linesByGame.get(row.game_id);
    if (bucket === undefined) {
      bucket = [];
      linesByGame.set(row.game_id, bucket);
    }
    bucket.push(row);
  }
  const sigsByGame = new Map<number, SigRow[]>();
  for (const row of (sigsRows ?? []) as SigRow[]) {
    let bucket = sigsByGame.get(row.game_id);
    if (bucket === undefined) {
      bucket = [];
      sigsByGame.set(row.game_id, bucket);
    }
    bucket.push(row);
  }

  const perGame: PerGameCoverage[] = [];
  let gamesMl = 0,
    gamesTotal = 0,
    gamesSpread = 0,
    gamesSignals = 0,
    gamesSignalsNoLines = 0,
    gamesStale = 0;

  const nowMs = assessedAt.getTime();
  for (const gameId of gameIds) {
    const ext = externalIdByGameId.get(gameId) ?? -1;
    const lines = linesByGame.get(gameId) ?? [];
    const sigs = sigsByGame.get(gameId) ?? [];

    const mlLines = lines.filter((l) => l.market_type === "moneyline").length;
    const totalLines = lines.filter((l) => l.market_type === "total").length;
    const spreadLines = lines.filter((l) => l.market_type === "spread").length;
    const books = new Set<string>();
    let oldestMs: number | null = null;
    let newestMs: number | null = null;
    for (const l of lines) {
      books.add(l.sportsbook);
      if (l.fetched_at !== null) {
        const t = Date.parse(l.fetched_at);
        if (!Number.isNaN(t)) {
          if (oldestMs === null || t < oldestMs) oldestMs = t;
          if (newestMs === null || t > newestMs) newestMs = t;
        }
      }
    }
    const mlSignals = sigs.filter((s) => s.market_type === "moneyline").length;
    const totalSignals = sigs.filter((s) => s.market_type === "total").length;
    const spreadSignals = sigs.filter((s) => s.market_type === "spread").length;

    const hasLines = lines.length > 0;
    const hasSignals = sigs.length > 0;
    const hasSignalsNoLines = hasSignals && !hasLines;

    const oldestMinutesAgo =
      oldestMs === null ? null : Math.floor((nowMs - oldestMs) / 60000);
    const newestMinutesAgo =
      newestMs === null ? null : Math.floor((nowMs - newestMs) / 60000);

    if (mlLines > 0) gamesMl++;
    if (totalLines > 0) gamesTotal++;
    if (spreadLines > 0) gamesSpread++;
    if (hasSignals) gamesSignals++;
    if (hasSignalsNoLines) gamesSignalsNoLines++;
    const isStale =
      staleMin > 0 && newestMinutesAgo !== null && newestMinutesAgo > staleMin;
    if (isStale) gamesStale++;

    let decision: PerGameCoverage["suggested_decision"];
    if (isStale && hasLines) {
      decision = "stale";
    } else if (mlLines === 0 && totalLines === 0) {
      decision = "hold_both";
    } else if (mlLines === 0) {
      decision = "hold_ml";
    } else if (totalLines === 0) {
      decision = "hold_total";
    } else {
      decision = "ok";
    }

    perGame.push({
      game_id: gameId,
      external_id: ext,
      ml_lines: mlLines,
      total_lines: totalLines,
      spread_lines: spreadLines,
      books_count: books.size,
      oldest_line_minutes_ago: oldestMinutesAgo,
      newest_line_minutes_ago: newestMinutesAgo,
      ml_signals: mlSignals,
      total_signals: totalSignals,
      spread_signals: spreadSignals,
      has_lines: hasLines,
      has_signals: hasSignals,
      has_signals_no_lines: hasSignalsNoLines,
      suggested_decision: decision,
    });
  }

  const totalGames = gameIds.length;
  const mlPct = totalGames === 0 ? 0 : (gamesMl / totalGames) * 100;
  const totalPct = totalGames === 0 ? 0 : (gamesTotal / totalGames) * 100;
  const spreadPct = totalGames === 0 ? 0 : (gamesSpread / totalGames) * 100;

  const reasons: string[] = [];
  let overall: CoverageGateOverall = "ok";
  if (mlPct < failMlPct) {
    overall = "fail_closed";
    reasons.push(
      `ML lines coverage ${mlPct.toFixed(1)}% < fail-closed threshold ${failMlPct}%`
    );
  }
  if (totalPct < failTotalPct) {
    overall = "fail_closed";
    reasons.push(
      `Total lines coverage ${totalPct.toFixed(1)}% < fail-closed threshold ${failTotalPct}%`
    );
  }
  if (overall !== "fail_closed") {
    if (mlPct < 100) {
      overall = "degraded";
      reasons.push(
        `ML lines coverage ${mlPct.toFixed(1)}% < 100% (${gamesMl}/${totalGames} games)`
      );
    }
    if (totalPct < 100) {
      overall = "degraded";
      reasons.push(
        `Total lines coverage ${totalPct.toFixed(1)}% < 100% (${gamesTotal}/${totalGames} games)`
      );
    }
    if (gamesSignalsNoLines > 0) {
      overall = "degraded";
      reasons.push(
        `${gamesSignalsNoLines} game(s) have sharp_signals but no lines — coverage shrink suspected`
      );
    }
    if (gamesStale > 0) {
      overall = "degraded";
      reasons.push(
        `${gamesStale} game(s) have stale lines (> ${staleMin} min old)`
      );
    }
  }
  if (reasons.length === 0) reasons.push("all checks passed");

  return {
    sport,
    date,
    assessed_at: assessedAtIso,
    per_game: perGame,
    aggregate: {
      total_games: totalGames,
      games_with_ml_lines: gamesMl,
      games_with_total_lines: gamesTotal,
      games_with_spread_lines: gamesSpread,
      games_with_signals: gamesSignals,
      games_with_signals_no_lines: gamesSignalsNoLines,
      games_with_stale_lines: gamesStale,
      ml_coverage_pct: round(mlPct),
      total_coverage_pct: round(totalPct),
      spread_coverage_pct: round(spreadPct),
    },
    overall,
    reasons,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
