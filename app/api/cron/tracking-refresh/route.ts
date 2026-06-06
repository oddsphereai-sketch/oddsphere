/**
 * /api/cron/tracking-refresh — Push 4c
 *
 * Automated tracking lifecycle:
 *   1. Create prediction records for published slates (idempotent;
 *      skips dates where launch_day=true records already exist)
 *   2. Ingest MLB first-inning linescores from MLB Stats API
 *   3. Ingest final scores from BDL slate provider
 *   4. Grade prediction records into prediction_grades
 *
 * Auth: CRON_SECRET via cronHandler wrapper (same pattern as
 * /api/cron/post-game-results and /api/cron/weekly-park-factors).
 *
 * SAFETY:
 *   - NEVER writes game_predictions
 *   - NEVER writes slate_status
 *   - NEVER writes locked_at
 *   - All sub-services already enforce their own safety rules
 *
 * Idempotent — running multiple times per hour is safe. Records
 * upsert on stable keys; grades skip when an existing non-pending
 * grade would be downgraded to pending.
 *
 * Schedule (UTC, vercel.json):
 *   `0 *\/2 * * *` — every 2 hours
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<your-domain>/api/cron/tracking-refresh
 */

import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import {
  runTrackingRefresh,
  computeRefreshDates,
} from "@/lib/services/trackingRefreshService";

export const maxDuration = 120;

export async function GET(request: Request) {
  return cronHandler(
    request,
    "tracking_refresh",
    async () => {
      // Allow override via ?date=YYYY-MM-DD for ops testing.
      const url = new URL(request.url);
      const overrideDate = url.searchParams.get("date");
      const dates = overrideDate
        ? [overrideDate]
        : computeRefreshDates(new Date());
      const apply = url.searchParams.get("dry_run") !== "true";

      const summary = await runTrackingRefresh({
        dates,
        apply,
        supabase,
      });

      return {
        records_updated:
          summary.totals.records_created +
          summary.totals.linescores_updated +
          summary.totals.final_scores_updated +
          summary.totals.grades_upserted,
        api_calls_made: summary.datesProcessed, // one MLB Stats API call per processed date
        partial: summary.totals.errors > 0,
        details: {
          apply,
          dates,
          datesProcessed: summary.datesProcessed,
          totals: summary.totals,
          perDate: summary.perDate,
          startedAtIso: summary.startedAtIso,
          finishedAtIso: summary.finishedAtIso,
          durationMs: summary.durationMs,
        },
      };
    },
    { sport: "mlb" },
  );
}

export const POST = GET;
