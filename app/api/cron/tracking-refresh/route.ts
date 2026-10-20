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
 * NBA writes moneyline + total prediction_records for legacy eligible dates,
 * then moneyline + spread + total prospectively from the 2026-10-20 regular-
 * season opener. There are NO FI/NRFI rows for NBA and no Spread backfill.
 *
 * WNBA writes moneyline + total + spread prediction_records and grades
 * them through the shared sport-generic grader once finals land.
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
import { revalidateTag } from "next/cache";
import {
  refreshTrackingFoundationResponseSnapshot,
  refreshTrackingResponseSnapshot,
} from "@/lib/services/labResponseSnapshotWriter";
import { assertMlbChampionRuntime } from "@/lib/automodel/mlbChampionRuntime";

export const maxDuration = 300;

const TRACKING_REFRESH_PUBLICATION_RELEASE =
  "tracking_refresh_publication_2026_10_20_r2_nba_and_final_checkpoint";

// The active EPL pipeline stores under sport="soccer" and is competition-
// scoped in snapshot_json. Include soccer in the scheduled cycle so EPL
// scores and grades settle automatically; the ingest service only touches the
// EPL external-id namespace and cannot rewrite historical World Cup games.
const DEFAULT_SPORTS: Sport[] = ["mlb", "nba", "wnba", "soccer", "nfl", "cfb", "nhl"];

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
      if (sport === "mlb") assertMlbChampionRuntime();
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

      // Grades are the source of truth for the member Tracking aggregate.
      // Expire it immediately after writes so repaired/settled FI results do
      // not remain hidden behind the previous five-minute aggregate.
      if (apply && summary.totals.grades_upserted > 0) {
        revalidateTag("member-tracking-aggregate", { expire: 0 });
      }

      // NBA remains the early safety checkpoint. NHL is the final scheduled
      // checkpoint and therefore includes later WNBA, soccer/UCL, NFL and CFB
      // grades that the NBA-time snapshot cannot yet contain. A one-sport
      // operator invocation remains self-publishing. Both checkpoints use the
      // same existing writer and route; no second writer or schedule exists.
      const publishAfterSports = sports.length === 1 ? new Set(sports) : new Set<Sport>(["nba", "nhl"]);
      const responseSnapshot = apply && publishAfterSports.has(sport)
        ? {
            legacy: await refreshTrackingResponseSnapshot({ source: "tracking_refresh" }),
            member: await refreshTrackingFoundationResponseSnapshot({ source: "tracking_refresh" }),
          }
        : null;

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
          settlementContractVersion: summary.settlementContractVersion,
          trackingPublicationRelease: TRACKING_REFRESH_PUBLICATION_RELEASE,
          stalePendingRepair: summary.stalePendingRepair,
          responseSnapshot,
        },
      };
    },
    {
      leaseGroup: "prediction_pipeline",
      requireLease: true,
      lockMinutes: 6,
    },
  );
}

export const POST = GET;
