/**
 * Push 4 — member tracking API (v17 schema).
 *
 * Returns a SAFE subset of the tracking aggregate for the public/member
 * tracking page:
 *   - imported legacy baselines (always safe — historical reference)
 *   - graded prediction record counts (only if fresh tracking has begun)
 *   - launch-day records are EXCLUDED from member-facing counts
 *
 * Lives at `/api/lab/tracking-foundation` so it can coexist with the
 * legacy `/api/lab/tracking` route (which reads the pre-v17
 * `prediction_results` table). The legacy route is untouched.
 *
 * NEVER exposes:
 *   - launch-day picks
 *   - in-flight pending grades
 *   - draft/unverified records
 *   - per-game model audit
 *   - model version names / internal model labels
 */

import { supabase } from "@/lib/db/supabase";
import { computeTrackingAggregate } from "@/lib/services/trackingAggregateService";
import type { TrackedSport } from "@/lib/types/domain/Tracking";
import { unstable_cache } from "next/cache";
import {
  readLabResponseSnapshot,
  trackingFoundationSnapshotKey,
} from "@/lib/services/labResponseSnapshots";

export const maxDuration = 60;

const MEMBER_TRACKING_FROM = "2026-06-07";
const TRACKING_AGGREGATE_TIMEOUT_MS = 30000;
const TRACKING_SNAPSHOT_BUILD_TIMEOUT_MS = 120000;
const TRACKING_RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;
const TRACKING_RESPONSE_STALE_TTL_MS = 30 * 60 * 1000;
// The expensive aggregate is cached server-side with unstable_cache. Do not
// stack a browser stale cache on top: it can keep pre-repair grades visible
// after the server cache has been explicitly invalidated.
const TRACKING_RESPONSE_CACHE_CONTROL = "private, no-store";

type TrackingResponseBody = Record<string, unknown>;
type TrackingAggregateResult = Awaited<ReturnType<typeof computeTrackingAggregate>>;

type TrackingResponseCacheEntry = {
  body: TrackingResponseBody;
  freshUntilMs: number;
  staleUntilMs: number;
};

const trackingResponseCache = new Map<string, TrackingResponseCacheEntry>();

const loadSharedTrackingAggregate = unstable_cache(
  async (sportKey: TrackedSport | "all", today: string) => computeTrackingAggregate({
    supabase,
    sport: sportKey === "all" ? undefined : sportKey,
    from: MEMBER_TRACKING_FROM,
    to: today,
    includeLaunchDay: false,
  }),
  ["member-tracking-aggregate-v1"],
  { revalidate: TRACKING_RESPONSE_CACHE_TTL_MS / 1000, tags: ["member-tracking-aggregate"] },
);

function todayEt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function cacheKeyFor(sport: TrackedSport | undefined, today: string): string {
  return `${sport ?? "all"}::${today}`;
}

function trackingJson(
  body: TrackingResponseBody,
  opts: { status?: number; cacheStatus: "hit" | "miss" | "stale" | "error" },
) {
  const init: ResponseInit = {
    headers: {
      "Cache-Control": TRACKING_RESPONSE_CACHE_CONTROL,
      "X-Oddsphere-Tracking-Cache": opts.cacheStatus,
      "Vary": "Cookie",
    },
  };
  if (opts.status !== undefined) init.status = opts.status;

  return Response.json(
    {
      ...body,
      trackingCacheStatus: opts.cacheStatus,
    },
    init,
  );
}

function trackingResponseBody(
  result: TrackingAggregateResult,
  sport: TrackedSport | undefined,
): TrackingResponseBody {
  const safeBaselines = result.baselines.map((b) => ({
    sport: b.sport,
    market: b.market,
    source_label: b.source_label,
    model_family: b.model_family,
    lifetime_wins: b.lifetime_wins,
    lifetime_total: b.lifetime_total,
    lifetime_pct: b.lifetime_pct,
    current_season_wins: b.current_season_wins,
    current_season_total: b.current_season_total,
    current_season_pct: b.current_season_pct,
  }));
  return {
    sport: sport ?? "all",
    baselines: safeBaselines,
    overall: result.overall,
    bySport: result.bySport,
    byMarket: result.byMarket,
    bySportMarket: result.bySportMarket,
    byPlayGrade: result.byPlayGrade,
    bestAngles: result.bestAngles,
    leans: result.leans,
    yesterday: result.yesterday,
    thisWeek: result.thisWeek,
    thisMonth: result.thisMonth,
    dailyTrend: result.dailyTrend,
    recentPicks: result.recentPicks,
    recentlySettled: result.recentlySettled,
    tablesInitialized: result.tablesInitialized,
    freshTrackingStarted: result.overall.picks > 0,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildTrackingFoundationSnapshotBody(input: {
  timeoutMs?: number;
} = {}): Promise<TrackingResponseBody> {
  const today = todayEt();
  const result = await withTimeout(
    computeTrackingAggregate({
      supabase,
      from: MEMBER_TRACKING_FROM,
      to: today,
      includeLaunchDay: false,
    }),
    input.timeoutMs ?? TRACKING_SNAPSHOT_BUILD_TIMEOUT_MS,
    "tracking aggregate",
  );
  return trackingResponseBody(result, undefined);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sportRaw = url.searchParams.get("sport");
  const sport: TrackedSport | undefined =
    sportRaw === "mlb" ||
    sportRaw === "nfl" ||
    sportRaw === "nba" ||
    sportRaw === "cfb" ||
    sportRaw === "cbb" ||
    sportRaw === "nhl" ||
    sportRaw === "ucl" ||
    sportRaw === "soccer"
      ? (sportRaw as TrackedSport)
      : undefined;

  const today = todayEt();
  if (url.searchParams.get("snapshotBypass") !== "true") {
    const snapshotKey = trackingFoundationSnapshotKey({ sport, date: today });
    const snapshot = await readLabResponseSnapshot<Record<string, unknown>>(snapshotKey, "fresh")
      ?? await readLabResponseSnapshot<Record<string, unknown>>(snapshotKey, "stale");
    if (snapshot) {
      return trackingJson(snapshot.payload, {
        cacheStatus: snapshot.cacheState === "DB_SNAPSHOT" ? "hit" : "stale",
      });
    }
  }
  const cacheKey = cacheKeyFor(sport, today);
  const nowMs = Date.now();
  const cached = trackingResponseCache.get(cacheKey);
  let result;
  try {
    result = await withTimeout(
      loadSharedTrackingAggregate(sport ?? "all", today),
      TRACKING_AGGREGATE_TIMEOUT_MS,
      "tracking aggregate",
    );
  } catch (error) {
    if (cached !== undefined && cached.staleUntilMs > nowMs) {
      return trackingJson(
        {
          ...cached.body,
          warning: "tracking_served_stale_after_refresh_error",
        },
        { cacheStatus: "stale" },
      );
    }
    return trackingJson(
      {
        error: "tracking_temporarily_unavailable",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503, cacheStatus: "error" },
    );
  }

  // Phase 6B.2d — member tracking expansion. Surfaces additional safe
  // aggregations the redesigned page needs:
  //   • bySportMarket — joint MLB-ML / MLB-O-U / MLB-NRFI / MLB-YRFI
  //     buckets with their own Best Angle + Lean cuts. Drives the
  //     "core" sport/category section instead of one blended total.
  //   • yesterday / thisWeek — date-bucketed slices for hero metrics
  //     and weekly module. Honest empty when no slate has graded yet.
  //   • dailyTrend — trailing 14-day buckets for the line chart.
  //   • recentPicks — 20 most recent member-safe picks for the
  //     stacked-card recent-results list. No raw audit fields.
  //   • recentlySettled — 6B.21 — 20 most recently settled picks
  //     ordered by prediction_grades.graded_at DESC. Pending and
  //     no_bet=true are excluded upstream. FI rows enter as soon as
  //     inning 1 closes; ML/OU enter at status=final. Slate_date is
  //     preserved so the daily/weekly/lifetime rollups stay correct.
  // Toss-Up / Held remain as state counts only. No raw model audit
  // or model-version labels leak to the member API.
  const body = trackingResponseBody(result, sport);

  const cacheWrittenAtMs = Date.now();
  trackingResponseCache.set(cacheKey, {
    body,
    freshUntilMs: cacheWrittenAtMs + TRACKING_RESPONSE_CACHE_TTL_MS,
    staleUntilMs: cacheWrittenAtMs + TRACKING_RESPONSE_STALE_TTL_MS,
  });

  return trackingJson(body, { cacheStatus: "miss" });
}
