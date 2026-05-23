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
 */

import useSWR from "swr";
import { buildLabUrl, labFetcher } from "../lib/labClient";
import type { DailyEdgeResponse } from "../lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";

export type UseDailyEdgeOptions = {
  sport: Sport;
  /** Optional YYYY-MM-DD override; defaults to server's "today UTC". */
  date?: string;
  /** Poll interval in ms. Default 300_000 (5 min). Set to 0 to disable polling. */
  refreshIntervalMs?: number;
};

export type UseDailyEdgeResult = {
  data: DailyEdgeResponse | undefined;
  error: Error | undefined;
  isLoading: boolean;
  refresh: () => Promise<DailyEdgeResponse | undefined>;
};

export function useDailyEdge(options: UseDailyEdgeOptions): UseDailyEdgeResult {
  const { sport, date, refreshIntervalMs = 300_000 } = options;
  const key = buildLabUrl("/api/lab/daily-edge", { sport, date });

  const { data, error, isLoading, mutate } = useSWR<DailyEdgeResponse>(
    key,
    labFetcher,
    {
      refreshInterval: refreshIntervalMs,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    }
  );

  return {
    data,
    error: error as Error | undefined,
    isLoading,
    refresh: () => mutate(),
  };
}
