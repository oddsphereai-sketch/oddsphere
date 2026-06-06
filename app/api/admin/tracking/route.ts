/**
 * Push 4 — admin tracking API.
 *
 * Returns the full computeTrackingAggregate output for the admin
 * tracking page. Includes launch-day records by default so admin
 * can see today's launch picks. Member route excludes them.
 *
 * Same auth pattern as /api/admin/auto-predictions.
 */

import { validateAdminAuth } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { computeTrackingAggregate } from "@/lib/services/trackingAggregateService";
import type { TrackedSport } from "@/lib/types/domain/Tracking";

export async function GET(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

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
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const includeLaunchDay = url.searchParams.get("include_launch_day") !== "false";

  const result = await computeTrackingAggregate({
    supabase,
    sport,
    from,
    to,
    includeLaunchDay,
  });
  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
