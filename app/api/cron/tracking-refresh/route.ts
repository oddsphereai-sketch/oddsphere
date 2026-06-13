/**
 * /api/cron/tracking-refresh — Push 4c (MLB) · Phase 7H (NBA)
 *
 * Automated tracking lifecycle, per-sport. Each sport gets its own
 * cron_runs row + advisory lock via `cronHandlerPerSport`, so a
 * failure in one sport doesn't block the other.
 *
 * MLB sequence (unchanged from Push 4c):
 *   1. createPredictionRecords({sport:"mlb"})
 *   2. ingestMlbLinescores                       (MLB-only step)
 *   3. ingestFinalScores({sport:"mlb"})          (BDL slate provider)
 *   4. gradePredictionsForSlate({sport:"mlb"})
 *
 * NBA sequence (Phase 7H — added):
 *   1. createNbaPredictionRecords({date})        (NBA pipeline writer)
 *   2. ingestNbaFinalScores({date})              (ESPN scoreboard)
 *   3. gradePredictionsForSlate({sport:"nba"})   (shared sport-generic)
 *
 * NBA writes ONLY moneyline + total prediction_records. Spread is
 * intentionally deferred. There are NO FI/NRFI rows for NBA.
 *
 * Auth: CRON_SECRET via cronHandlerPerSport wrapper.
 *
 * SAFETY:
 *   - NEVER writes game_predictions (either sport)
 *   - NEVER writes slate_status
 *   - NEVER writes locked_at MLB rows (NBA writer sets lock_at only
 *     on insert for tip-soon games; locked rows are never updated)
 *   - All sub-services enforce their own safety rules
 *
 * Idempotent — re-running is safe.
 *
 * Schedule (UTC, vercel.json):
 *   `0 *\/2 * * *` — every 2 hours
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<your-domain>/api/cron/tracking-refresh
 *
 * Per-sport override:
 *   ?sport=mlb or ?sport=nba — runs only that sport (handy for ops).
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import type { Sport } from "@/lib/types/domain/Sport";
import {
  runTrackingRefresh,
  computeRefreshDates,
} from "@/lib/services/trackingRefreshService";

export const maxDuration = 180;

// Phase 7L Step 6 — NHL added alongside MLB/NBA. The trackingRefreshService
// has had an NHL branch since Step 5; this flip turns on automated hourly
// refreshes so NHL prediction_records update pre-lock, freeze at T-60, and
// grade after final — same operational contract as MLB/NBA. NHL is still
// hidden from members: SportRail keeps live=false, so this is admin/data
// pipeline activation only, not a public-facing launch.
const DEFAULT_SPORTS: Sport[] = ["mlb", "nba", "nhl", "soccer"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const overrideSport = url.searchParams.get("sport") as Sport | null;
  const sports: readonly Sport[] = overrideSport
    ? [overrideSport]
    : DEFAULT_SPORTS;

  return cronHandlerPerSport(
    request,
    "tracking_refresh",
    sports,
    async ({ sport }) => {
      const overrideDate = url.searchParams.get("date");
      const dates = overrideDate
        ? [overrideDate]
        : computeRefreshDates(new Date());
      const apply = url.searchParams.get("dry_run") !== "true";

      const summary = await runTrackingRefresh({
        sport,
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
        api_calls_made: summary.datesProcessed,
        partial: summary.totals.errors > 0,
        details: {
          sport,
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
  );
}

export const POST = GET;
