/**
 * Public-splits observation refresh cron — dual-source Phase 1 FRESHNESS.
 *
 * Keeps `public_splits_observations` fresh so the Phase 2 resolved read can
 * display Playbook-preferred splits without going stale (resolver staleness
 * threshold = 15 min). Runs every 15 minutes.
 *
 * ADDITIVE / SAFE:
 *   • Writes ONLY public_splits_observations (mirror sharp_signals -> sharpapi
 *     for MLB + fetch Playbook -> playbook). Touches NO other table, cron, UI,
 *     grade, model, or the automodel files.
 *   • Graceful no-op if the table isn't applied (schema-migration-v25.sql).
 *   • Gate: PUBLIC_SPLITS_OBSERVATIONS_ENABLED=true. Default OFF so the Vercel
 *     cron entry can land without firing any write until explicitly enabled.
 *   • MLB + WNBA current ET slate, live Playbook /splits.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { syncPublicSplitsObservations } from "@/lib/services/syncPublicSplitsObservations";
import { currentSlateDate } from "@/lib/dates/slateDate";
import type { Sport } from "@/lib/types/domain/Sport";
import { refreshDailyEdgeResponseSnapshot } from "@/lib/services/labResponseSnapshotWriter";

const ENV = "PUBLIC_SPLITS_OBSERVATIONS_ENABLED";
const SPORTS: Sport[] = ["mlb", "wnba"];

export async function GET(request: Request): Promise<Response> {
  return cronHandlerPerSport(
    request,
    "public_splits_observations_refresh",
    SPORTS,
    async ({ sport }) => {
      if (process.env[ENV] !== "true") {
        return { records_updated: 0, details: { disabled: true, reason: `${ENV}!=true` } };
      }
      const slate = currentSlateDate(sport);
      const result = await syncPublicSplitsObservations({
        supabase,
        sport,
        slateDate: slate,
        apply: true,
        todayUtc: slate,
      });
      const errors = [
        ...(result.skippedTableMissing ? [`${sport} ${slate}: table not applied`] : []),
        ...result.errors,
      ];
      const responseSnapshot = errors.length === 0
        ? await refreshDailyEdgeResponseSnapshot({
            sport,
            date: slate,
            source: "public_splits_observations_refresh",
          })
        : null;
      if (responseSnapshot?.ok === false) {
        errors.push(`daily-edge snapshot publish failed: ${responseSnapshot.error ?? "unknown error"}`);
      }
      return {
        records_updated: result.upserted + (responseSnapshot?.ok ? 1 : 0),
        api_calls_made: 1,
        partial: errors.length > 0,
        error_message: errors.length ? errors.slice(0, 5).join(" | ").slice(0, 1500) : null,
        details: {
          slate,
          sharpapi: result.sharpapiRows,
          playbook: result.playbookRows,
          upserted: result.upserted,
          response_snapshot: responseSnapshot,
          errors: errors.slice(0, 20),
        },
      };
    },
    {
      leaseGroup: "prediction_pipeline",
      requireLease: true,
      lockMinutes: 5,
    },
  );
}
