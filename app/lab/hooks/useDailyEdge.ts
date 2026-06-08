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
import { buildLabUrl, labFetcher, LabApiError } from "../lib/labClient";
import type { DailyEdgeResponse } from "../lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";

// Phase 7F (Path A) — NBA admin headers from localStorage so the
// useDailyEdge hook can forward them when fetching the admin-gated
// NBA-as-DailyEdge route. Stored once via the page-level entry form
// (one-time on localhost); on Vercel preview the route's nba-v0a
// bypass means these aren't needed.
const NBA_ADMIN_EMAIL_KEY = "oddsphere.nba.adminEmail";
const NBA_ADMIN_TOKEN_KEY = "oddsphere.nba.adminToken";

async function nbaAdminFetcher<T>(url: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (typeof window !== "undefined") {
    const email = window.localStorage.getItem(NBA_ADMIN_EMAIL_KEY);
    const token = window.localStorage.getItem(NBA_ADMIN_TOKEN_KEY);
    if (email !== null && email !== "" && token !== null && token !== "") {
      headers["x-admin-email"] = email;
      headers["x-admin-token"] = token;
    }
  }
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LabApiError(res.status, body, url);
  }
  return res.json() as Promise<T>;
}

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

// Today's date in ET as YYYY-MM-DD. The NBA admin adapter route
// requires ?date= (no server-side auto-default) because the ET-slate
// helper needs an explicit input; the hook supplies today_ET when
// the caller doesn't pass one. MLB's /api/lab/daily-edge auto-defaults
// to today UTC server-side and is unaffected.
function todayEtYyyyMmDd(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

export function useDailyEdge(options: UseDailyEdgeOptions): UseDailyEdgeResult {
  const { sport, date, refreshIntervalMs = 300_000 } = options;
  // Phase 7F (Path A): NBA routes through the admin-gated adapter route
  // (/api/admin/nba-as-daily-edge). MLB keeps the existing /api/lab path
  // unchanged. Same DailyEdgeResponse shape from both — the shell
  // doesn't care which source it came from.
  const isNba = sport === "nba";
  // NBA needs an explicit date — default to today (ET) when not passed.
  const effectiveDate = isNba ? (date ?? todayEtYyyyMmDd()) : date;
  const key = isNba
    ? buildLabUrl("/api/admin/nba-as-daily-edge", { date: effectiveDate ?? null })
    : buildLabUrl("/api/lab/daily-edge", { sport, date });
  const fetcher = isNba ? nbaAdminFetcher : labFetcher;

  const { data, error, isLoading, mutate } = useSWR<DailyEdgeResponse>(
    key,
    fetcher,
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
