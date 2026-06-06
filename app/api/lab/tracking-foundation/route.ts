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
 */

import { supabase } from "@/lib/db/supabase";
import { computeTrackingAggregate } from "@/lib/services/trackingAggregateService";
import type { TrackedSport } from "@/lib/types/domain/Tracking";

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
    sportRaw === "ucl"
      ? (sportRaw as TrackedSport)
      : undefined;

  const result = await computeTrackingAggregate({
    supabase,
    sport,
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

  return Response.json(
    {
      sport: sport ?? "all",
      baselines: safeBaselines,
      overall: result.overall,
      bySport: result.bySport,
      byMarket: result.byMarket,
      bestAngles: result.bestAngles,
      tablesInitialized: result.tablesInitialized,
      freshTrackingStarted: result.overall.picks > 0,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
