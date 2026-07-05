"use client";

/**
 * useRefreshStatus — SWR hook for /api/lab/refresh-status.
 *
 * Polls every 5 minutes by default so the RefreshIndicator in the navbar stays
 * reasonably fresh without hammering Supabase. SWR also revalidates
 * on focus + reconnect — when a user tabs back in we recheck immediately.
 *
 * Returns the raw `RefreshStatusResponse` plus SWR's loading/error state.
 * The visual badge derivation (color, icon, "Updated 4 min ago" text) lives
 * inside the RefreshIndicator component (5E) — this hook just delivers data.
 *
 * Per-sport keying: a separate cache entry per sport so switching sports
 * doesn't ghost the previous sport's data through SWR's stale-while-revalidate.
 */

import useSWR from "swr";
import { buildLabUrl, labFetcher } from "../lib/labClient";
import type { RefreshStatusResponse } from "../lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";

export type UseRefreshStatusOptions = {
  /** Sport scope. Pass undefined for the default (MLB) view. */
  sport?: Sport;
  /** Poll interval in ms. Default 300_000 (5 min). Set to 0 to disable polling. */
  refreshIntervalMs?: number;
};

export type UseRefreshStatusResult = {
  data: RefreshStatusResponse | undefined;
  error: Error | undefined;
  isLoading: boolean;
  /** Manually re-fetch (e.g., after a known publish event). */
  refresh: () => Promise<RefreshStatusResponse | undefined>;
};

export function useRefreshStatus(
  options: UseRefreshStatusOptions = {}
): UseRefreshStatusResult {
  const { sport, refreshIntervalMs = 300_000 } = options;
  const key = buildLabUrl("/api/lab/refresh-status", { sport });

  const { data, error, isLoading, mutate } = useSWR<RefreshStatusResponse>(
    key,
    labFetcher,
    {
      refreshInterval: refreshIntervalMs,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      errorRetryCount: 0,
      dedupingInterval: 60_000,
      // Keep last good data visible while a revalidation runs — prevents the
      // indicator from flickering to a loading state every 60s.
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
