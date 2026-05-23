"use client";

/**
 * usePlayerProps — SWR hook for /api/lab/player-props.
 *
 * Filter state flows through as URL query params so SWR's cache key is the
 * full URL — switching filters spawns a new SWR entry; switching back is a
 * cache hit and instant. Per-(sport, propMarket, tier set, minEdge, signals,
 * player_id) keying.
 *
 * Polls every 5 minutes. revalidateOnFocus + keepPreviousData so the list
 * doesn't flash empty between refreshes.
 *
 * Two call sites in Phase 5C:
 *   • TonightsBestView (premium+strong tiers, no other filters)
 *   • SearchFilterView (caller passes whatever the UI selected)
 *   • PlayerDrillDown   (caller passes player_id=…)
 */

import useSWR from "swr";
import { buildLabUrl, labFetcher } from "../lib/labClient";
import type { PlayerPropsResponse, PropTier } from "../lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";

export type UsePlayerPropsOptions = {
  sport: Sport;
  /** Optional UI prop-type key (hits / home_runs / total_bases / strikeouts / er_allowed). */
  propMarket?: string;
  /** Optional tier subset. Empty/undefined → server returns all four tiers. */
  tiers?: PropTier[];
  /** Optional decimal threshold (0..1). 0.05 = 5%. */
  minEdge?: number;
  /** Optional signal keys to intersect-filter on. V1: not wired server-side. */
  signals?: string[];
  /** Optional single-player filter (used by PlayerDrillDown). */
  playerId?: string | number | null;
  /** Optional date override (YYYY-MM-DD). */
  date?: string;
  /** Poll interval in ms. Default 300_000 (5 min). 0 disables polling. */
  refreshIntervalMs?: number;
  /** Pause fetching entirely (e.g., sport not live). */
  enabled?: boolean;
};

export type UsePlayerPropsResult = {
  data: PlayerPropsResponse | undefined;
  error: Error | undefined;
  isLoading: boolean;
  refresh: () => Promise<PlayerPropsResponse | undefined>;
};

export function usePlayerProps(options: UsePlayerPropsOptions): UsePlayerPropsResult {
  const {
    sport,
    propMarket,
    tiers,
    minEdge,
    signals,
    playerId,
    date,
    refreshIntervalMs = 300_000,
    enabled = true,
  } = options;

  const key = enabled
    ? buildLabUrl("/api/lab/player-props", {
        sport,
        date,
        prop_market: propMarket,
        tier: tiers && tiers.length > 0 ? tiers.slice().sort().join(",") : undefined,
        minEdge: minEdge && minEdge > 0 ? minEdge : undefined,
        signals: signals && signals.length > 0 ? signals.slice().sort().join(",") : undefined,
        player_id: playerId ?? undefined,
      })
    : null;

  const { data, error, isLoading, mutate } = useSWR<PlayerPropsResponse>(
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
