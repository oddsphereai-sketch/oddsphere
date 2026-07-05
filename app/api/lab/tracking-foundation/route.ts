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

const MEMBER_TRACKING_FROM = "2026-06-07";

function todayEt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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

  const result = await computeTrackingAggregate({
    supabase,
    sport,
    from: MEMBER_TRACKING_FROM,
    to: todayEt(),
    includeLaunchDay: false,
  });

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
  return Response.json(
    {
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
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
