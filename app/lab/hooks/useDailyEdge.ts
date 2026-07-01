"use client";

/**
 * useDailyEdge — SWR hook for /api/lab/daily-edge.
 *
 * Polls every 5 minutes (300_000 ms) — between cron refresh cycles the
 * underlying data only changes on (a) sharp action mid-day and (b) Daniel
 * publishing scores model updates. 5 min is a reasonable midpoint between
 * "fresh enough" and "don't hammer Supabase".
 *
 * Per-(sport, date) keying so switching sports doesn't ghost-render the
 * previous sport's data through SWR's stale-while-revalidate.
 *
 * Returns SWR's standard { data, error, isLoading } plus a manual `refresh`.
 *
 * Phase 7G (launch): both MLB and NBA route through /api/lab/daily-edge.
 * The route's NBA branch hands off to the shared NBA adapter service and
 * returns the same MLB-shaped DailyEdgeResponse, so the hook is sport-
 * agnostic at the URL level. The previous NBA admin-headers path was
 * removed when NBA went member-facing.
 */

import useSWR from "swr";
import { buildLabUrl, labFetcher } from "../lib/labClient";
import type { DailyEdgeResponse } from "../lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";

export type UseDailyEdgeOptions = {
  sport: Sport;
  /** Optional YYYY-MM-DD override; defaults to server's "today". */
  date?: string;
  /**
   * When true, the API may serve the latest visible slate when the requested
   * slate is not published yet. The response labels this with
   * fallback_used/slateState so the UI stays honest instead of blank.
   */
  allowStale?: boolean;
  /** Poll interval in ms. Default 300_000 (5 min). Set to 0 to disable polling. */
  refreshIntervalMs?: number;
  /** Local/admin visual preview for deterministic member copy. */
  copyPreview?: boolean;
};

export type UseDailyEdgeResult = {
  data: DailyEdgeResponse | undefined;
  error: Error | undefined;
  isLoading: boolean;
  refresh: () => Promise<DailyEdgeResponse | undefined>;
};

export function useDailyEdge(options: UseDailyEdgeOptions): UseDailyEdgeResult {
  const { sport, date, allowStale = false, refreshIntervalMs = 300_000, copyPreview = false } = options;
  const key = buildLabUrl("/api/lab/daily-edge", { sport, date, allowStale, copyPreview: copyPreview ? 1 : undefined });

  const { data, error, isLoading, mutate } = useSWR<DailyEdgeResponse>(
    key,
    labFetcher,
    {
      refreshInterval: refreshIntervalMs,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      // P0 tab-switching fix (2026-06-12): keepPreviousData=true caused the
      // shell to render the PREVIOUS sport's response while the new sport's
      // fetch was in flight, which (combined with the never-remounted shell)
      // produced the "stuck on previous sport" / "endless loading" failures.
      // With the page now remounting via key={sport}, previous-sport ghosting
      // is unnecessary; a clean isLoading state is correct on switch.
      keepPreviousData: false,
    }
  );

  return {
    data,
    error: error as Error | undefined,
    isLoading,
    refresh: () => mutate(),
  };
}
