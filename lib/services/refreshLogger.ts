/**
 * refreshLogger — service that writes lifecycle rows to data_refresh_log.
 *
 * Every cron run flows through this. Schema columns the logger touches:
 *   data_source, sport, refresh_started_at, refresh_completed_at,
 *   refresh_status ('in_progress' | 'success' | 'partial' | 'failed'),
 *   records_updated, api_calls_made, error_message, scheduled_next_refresh.
 *
 * The lock pattern: a cron run is "active" if a row exists with the same
 * (data_source, sport), refresh_status='in_progress', and started within
 * the last N minutes (default 5). The cronHandler wrapper checks this
 * before starting work and skips with 200 if true — prevents two
 * `morning_slate_mlb` invocations from racing if a long-running run hasn't
 * completed yet.
 *
 * isAnotherRunActive uses `.is(sport, null)` for cross-sport crons because
 * `.eq(sport, null)` doesn't match NULL in Postgres semantics.
 */

import { supabase } from "../db/supabase";
import type { Sport } from "../types/domain/Sport";

export type RefreshCompleteOptions = {
  success: boolean;
  /** If true, status becomes 'partial' instead of 'success'/'failed'. */
  partial?: boolean;
  records_updated?: number | null;
  api_calls_made?: number | null;
  error_message?: string | null;
  scheduled_next_refresh?: string | null;
};

function resolveStatus(opts: RefreshCompleteOptions): "success" | "partial" | "failed" {
  if (opts.partial) return "partial";
  return opts.success ? "success" : "failed";
}

export const refreshLogger = {
  /**
   * Close abandoned lifecycle rows left behind when the runtime is killed
   * before the handler's finally block can execute. A current run is guarded
   * by the lease; this only touches older rows for the same job and sport.
   */
  async closeStaleRuns(
    dataSource: string,
    sport: Sport | null,
    olderThanMinutes: number = 15
  ): Promise<number> {
    const threshold = new Date(
      Date.now() - olderThanMinutes * 60_000
    ).toISOString();
    let q = supabase
      .from("data_refresh_log")
      .update({
        refresh_completed_at: new Date().toISOString(),
        refresh_status: "failed",
        error_message: "stale_run_reconciled: runtime ended before lifecycle close",
      })
      .eq("data_source", dataSource)
      .eq("refresh_status", "in_progress")
      .lt("refresh_started_at", threshold)
      .select("id");
    q = sport === null ? q.is("sport", null) : q.eq("sport", sport);
    const { data, error } = await q;
    if (error) {
      throw new Error(`refreshLogger.closeStaleRuns failed: ${error.message}`);
    }
    return data?.length ?? 0;
  },

  /**
   * Start a new run row. Returns the row id used by complete() and any
   * downstream tracing.
   *
   * sport=null indicates a cross-sport run (e.g., weekly-park-factors).
   */
  async start(dataSource: string, sport: Sport | null = null): Promise<number> {
    const { data, error } = await supabase
      .from("data_refresh_log")
      .insert({
        data_source: dataSource,
        sport,
        refresh_started_at: new Date().toISOString(),
        refresh_status: "in_progress",
      })
      .select("id")
      .single();
    if (error) {
      throw new Error(`refreshLogger.start failed: ${error.message}`);
    }
    return (data as { id: number }).id;
  },

  /**
   * Mark a run row complete with success/partial/failed + optional counters.
   */
  async complete(
    logId: number,
    opts: RefreshCompleteOptions
  ): Promise<void> {
    const { error } = await supabase
      .from("data_refresh_log")
      .update({
        refresh_completed_at: new Date().toISOString(),
        refresh_status: resolveStatus(opts),
        records_updated: opts.records_updated ?? null,
        api_calls_made: opts.api_calls_made ?? null,
        error_message: opts.error_message ?? null,
        scheduled_next_refresh: opts.scheduled_next_refresh ?? null,
      })
      .eq("id", logId);
    if (error) {
      throw new Error(`refreshLogger.complete failed: ${error.message}`);
    }
  },

  /**
   * Is there an in-progress run for this (data_source, sport) that started
   * within the last `withinMinutes` minutes?
   *
   * Used by cronHandler to skip duplicate invocations (race condition
   * protection). Returns false if no recent in-progress row exists.
   */
  async isAnotherRunActive(
    dataSource: string,
    sport: Sport | null,
    withinMinutes: number = 5
  ): Promise<boolean> {
    const threshold = new Date(
      Date.now() - withinMinutes * 60_000
    ).toISOString();
    let q = supabase
      .from("data_refresh_log")
      .select("id", { count: "exact", head: true })
      .eq("data_source", dataSource)
      .eq("refresh_status", "in_progress")
      .gte("refresh_started_at", threshold);
    q = sport === null ? q.is("sport", null) : q.eq("sport", sport);
    const { count, error } = await q;
    if (error) {
      throw new Error(
        `refreshLogger.isAnotherRunActive failed: ${error.message}`
      );
    }
    return (count ?? 0) > 0;
  },

  /**
   * Get the most recent completed run timestamp for a (data_source, sport).
   * Used by UI "Updated N min ago" indicators. Returns null if no run exists.
   */
  async getLastCompleted(
    dataSource: string,
    sport: Sport | null
  ): Promise<Date | null> {
    let q = supabase
      .from("data_refresh_log")
      .select("refresh_completed_at")
      .eq("data_source", dataSource)
      .neq("refresh_status", "in_progress")
      .not("refresh_completed_at", "is", null)
      .order("refresh_completed_at", { ascending: false })
      .limit(1);
    q = sport === null ? q.is("sport", null) : q.eq("sport", sport);
    const { data, error } = await q.maybeSingle();
    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(
        `refreshLogger.getLastCompleted failed: ${error.message}`
      );
    }
    if (!data?.refresh_completed_at) return null;
    return new Date(data.refresh_completed_at);
  },

  /**
   * Latest successful/partial completion for cadence protection. Failed runs
   * are ignored so an operator can retry immediately after a real failure.
   */
  async getLastHealthyCompleted(
    dataSource: string,
    sport: Sport | null
  ): Promise<Date | null> {
    let q = supabase
      .from("data_refresh_log")
      .select("refresh_completed_at")
      .eq("data_source", dataSource)
      .in("refresh_status", ["success", "partial"])
      .not("refresh_completed_at", "is", null)
      .order("refresh_completed_at", { ascending: false })
      .limit(1);
    q = sport === null ? q.is("sport", null) : q.eq("sport", sport);
    const { data, error } = await q.maybeSingle();
    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(
        `refreshLogger.getLastHealthyCompleted failed: ${error.message}`
      );
    }
    if (!data?.refresh_completed_at) return null;
    return new Date(data.refresh_completed_at);
  },
};
