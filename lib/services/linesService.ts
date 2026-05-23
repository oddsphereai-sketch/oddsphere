/**
 * linesService — pull game lines, player props, and sharp signals from the
 * betting provider and write them to lines / line_history / sharp_signals.
 *
 * `lines` has no UNIQUE constraint — strategy is DELETE-then-INSERT scoped
 * to tonight's game IDs so the table always reflects the latest snapshot.
 * `line_history` is append-only (the change-log archive). `sharp_signals`
 * also gets DELETE-then-INSERT scoped to tonight to handle stale signals
 * being removed when the underlying market normalizes.
 *
 * Skips rows where FK resolution fails — surfaces the skip count in details.
 */

import { supabase } from "../db/supabase";
import { getBettingProvider } from "../providers/factory";
import type { Sport } from "../types/domain/Sport";
import type { CronHandlerResult } from "../cron/runCron";
import { loadGameIdMap, loadPlayerIdMap } from "./_idMaps";

export const linesService = {
  /**
   * Refresh game lines (ML / Total / NRFI etc.) for the slate.
   * DELETE existing rows for tonight's games then INSERT fresh.
   * Also writes an append-only row to line_history per line.
   */
  async refreshGameLines(sport: Sport, date: string): Promise<CronHandlerResult> {
    const betting = getBettingProvider();
    const gameIdByExternal = await loadGameIdMap(sport, date);
    const gameIds = [...gameIdByExternal.values()];

    if (gameIds.length === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }

    const lines = await betting.getGameLines(date, sport);
    const apiCalls = 1;
    const skipped: number[] = [];

    const linesPayload: Array<Record<string, unknown>> = [];
    const historyPayload: Array<Record<string, unknown>> = [];

    for (const l of lines) {
      const gameId = gameIdByExternal.get(l.game_external_id);
      if (gameId === undefined) {
        skipped.push(l.game_external_id);
        continue;
      }
      const lineRow = {
        game_id: gameId,
        market_type: l.market_type,
        player_id: null,
        sportsbook: l.sportsbook,
        side: l.side,
        line_value: l.line_value,
        odds_american: l.odds_american,
        odds_decimal: l.odds_decimal,
        implied_probability: l.implied_probability,
        ev_percent: l.ev_percent,
        fair_odds: l.fair_odds,
        is_ev_positive: l.is_ev_positive,
        fetched_at: l.fetched_at,
      };
      linesPayload.push(lineRow);
      historyPayload.push({
        game_id: gameId,
        market_type: l.market_type,
        player_id: null,
        sportsbook: l.sportsbook,
        side: l.side,
        line_value: l.line_value,
        odds_american: l.odds_american,
        is_opener: false,
        recorded_at: l.fetched_at,
      });
    }

    // DELETE existing rows for tonight's games scoped to game lines only
    // (player_id IS NULL → game-level rows). Player props are handled by
    // refreshPlayerProps so we don't accidentally nuke them here.
    const { error: delErr } = await supabase
      .from("lines")
      .delete()
      .in("game_id", gameIds)
      .is("player_id", null);
    if (delErr) {
      throw new Error(`linesService.refreshGameLines delete failed: ${delErr.message}`);
    }

    if (linesPayload.length > 0) {
      const { error } = await supabase.from("lines").insert(linesPayload);
      if (error) {
        throw new Error(`linesService.refreshGameLines insert failed: ${error.message}`);
      }
    }
    if (historyPayload.length > 0) {
      const { error: histErr } = await supabase
        .from("line_history")
        .insert(historyPayload);
      if (histErr) {
        throw new Error(`linesService.refreshGameLines history insert failed: ${histErr.message}`);
      }
    }

    return {
      records_updated: linesPayload.length,
      api_calls_made: apiCalls,
      details: skipped.length > 0 ? { skipped_game_external_ids: skipped } : undefined,
    };
  },

  /**
   * Refresh player props for the slate. DELETE existing prop rows
   * (player_id IS NOT NULL) for tonight's games, then INSERT fresh.
   */
  async refreshPlayerProps(sport: Sport, date: string): Promise<CronHandlerResult> {
    const betting = getBettingProvider();
    const gameIdByExternal = await loadGameIdMap(sport, date);
    const gameIds = [...gameIdByExternal.values()];
    const playerIdByExternal = await loadPlayerIdMap(sport);

    if (gameIds.length === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }

    const props = await betting.getPlayerProps(date, sport);
    const apiCalls = 1;
    const skipped: number[] = [];

    const payload: Array<Record<string, unknown>> = [];
    for (const p of props) {
      const gameId = gameIdByExternal.get(p.game_external_id);
      const playerId =
        p.player_external_id !== null
          ? playerIdByExternal.get(p.player_external_id) ?? null
          : null;
      if (gameId === undefined || playerId === null) {
        skipped.push(p.player_external_id ?? p.game_external_id);
        continue;
      }
      payload.push({
        game_id: gameId,
        market_type: p.market_type,
        player_id: playerId,
        sportsbook: p.sportsbook,
        side: p.side,
        line_value: p.line_value,
        odds_american: p.odds_american,
        odds_decimal: p.odds_decimal,
        implied_probability: p.implied_probability,
        ev_percent: p.ev_percent,
        fair_odds: p.fair_odds,
        is_ev_positive: p.is_ev_positive,
        fetched_at: p.fetched_at,
      });
    }

    const { error: delErr } = await supabase
      .from("lines")
      .delete()
      .in("game_id", gameIds)
      .not("player_id", "is", null);
    if (delErr) {
      throw new Error(`linesService.refreshPlayerProps delete failed: ${delErr.message}`);
    }

    if (payload.length > 0) {
      const { error } = await supabase.from("lines").insert(payload);
      if (error) {
        throw new Error(`linesService.refreshPlayerProps insert failed: ${error.message}`);
      }
    }

    return {
      records_updated: payload.length,
      api_calls_made: apiCalls,
      details: skipped.length > 0 ? { skipped_external_ids: skipped } : undefined,
    };
  },

  /**
   * Refresh sharp signals for the slate. DELETE-then-INSERT scoped to
   * tonight's games. (Signals can disappear when markets normalize — we
   * want the DB to reflect *current* signals only.)
   */
  async refreshSharpSignals(sport: Sport, date: string): Promise<CronHandlerResult> {
    const betting = getBettingProvider();
    const gameIdByExternal = await loadGameIdMap(sport, date);
    const gameIds = [...gameIdByExternal.values()];

    if (gameIds.length === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }

    const signals = await betting.getSharpSignals(date);
    const apiCalls = 1;
    const skipped: number[] = [];

    const payload: Array<Record<string, unknown>> = [];
    for (const s of signals) {
      const gameId = gameIdByExternal.get(s.game_external_id);
      if (gameId === undefined) {
        skipped.push(s.game_external_id);
        continue;
      }
      payload.push({
        game_id: gameId,
        market_type: s.market_type,
        side: s.side,
        pinnacle_fair_probability: s.pinnacle_fair_probability,
        is_plus_ev: s.is_plus_ev,
        ev_pct: s.ev_pct,
        has_steam_move: s.has_steam_move,
        steam_detected_at: s.steam_detected_at,
        steam_books_count: s.steam_books_count,
        has_reverse_line_movement: s.has_reverse_line_movement,
        rlm_direction: s.rlm_direction,
        public_betting_pct: s.public_betting_pct,
        public_money_pct: s.public_money_pct,
        signal_strength: s.signal_strength,
        signal_summary: s.signal_summary,
        computed_at: s.computed_at,
      });
    }

    const { error: delErr } = await supabase
      .from("sharp_signals")
      .delete()
      .in("game_id", gameIds);
    if (delErr) {
      throw new Error(`linesService.refreshSharpSignals delete failed: ${delErr.message}`);
    }

    if (payload.length > 0) {
      const { error } = await supabase.from("sharp_signals").insert(payload);
      if (error) {
        throw new Error(`linesService.refreshSharpSignals insert failed: ${error.message}`);
      }
    }

    return {
      records_updated: payload.length,
      api_calls_made: apiCalls,
      details: skipped.length > 0 ? { skipped_game_external_ids: skipped } : undefined,
    };
  },
};
