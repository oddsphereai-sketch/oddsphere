"use client";

/**
 * useTracking — SWR hook for /api/lab/tracking.
 *
 * Single fetch covers the whole Tracking page (yesterday recap + weekly +
 * 30-day + lifetime + streak + tallies matrix). The response is small
 * (~2 KB JSON) so one fetch beats multi-section fanout. 5-minute poll keeps
 * the page fresh when post-game-results resolves overnight picks.
 */

import useSWR from "swr";
import { labFetcher } from "../lib/labClient";
import type { TrackingResponse } from "../lib/labTypes";

export type UseTrackingOptions = {
  /** Poll interval in ms. Default 300_000 (5 min). 0 disables polling. */
  refreshIntervalMs?: number;
};

export type UseTrackingResult = {
  data: TrackingResponse | undefined;
  error: Error | undefined;
  isLoading: boolean;
  refresh: () => Promise<TrackingResponse | undefined>;
};

export function useTracking(options: UseTrackingOptions = {}): UseTrackingResult {
  const { refreshIntervalMs = 300_000 } = options;
  const { data, error, isLoading, mutate } = useSWR<TrackingResponse>(
    "/api/lab/tracking",
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
