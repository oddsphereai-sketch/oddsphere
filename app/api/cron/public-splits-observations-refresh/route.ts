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
 *   • Playbook public consensus plus Owls named-book splits and sharp-book
 *     prices for every supported Daily Edge sport.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { syncPublicSplitsObservations } from "@/lib/services/syncPublicSplitsObservations";
import { addDaysToSlate, currentSlateDate } from "@/lib/dates/slateDate";
import type { Sport } from "@/lib/types/domain/Sport";
import { refreshDailyEdgeResponseSnapshot } from "@/lib/services/labResponseSnapshotWriter";
import { runScheduledMarketIntelligenceV2Collection } from "@/lib/services/marketIntelligenceV2/scheduledCollection";
import { readMarketCaptureActivity } from "@/lib/services/dailyEdge/marketCaptureActivity";
import { refreshDraftKingsNetworkSplitSource } from "@/lib/providers/draftkings/draftKingsNetworkSplits";

const ENV = "PUBLIC_SPLITS_OBSERVATIONS_ENABLED";
// This remains an observation-only collector. Capability gates continue to
// decide whether any sport may display or use the stored evidence.
// CBB's sole member writer starts at :02/:17/:32/:47. Capture it first,
// before slower unrelated snapshot rebuilds can consume that lead time and
// cause its sport-scoped lease to skip the source refresh. Every other sport
// retains its relative order, provider calls, cadence and lease protection.
const SPORTS: Sport[] = ["cbb", "mlb", "wnba", "nhl", "nba", "nfl", "cfb"];

export async function GET(request: Request): Promise<Response> {
  return cronHandlerPerSport(
    request,
    "public_splits_observations_refresh",
    SPORTS,
    async ({ sport }) => {
      if (process.env[ENV] !== "true") {
        return { records_updated: 0, details: { disabled: true, reason: `${ENV}!=true` } };
      }
      const activity = await readMarketCaptureActivity({ client: supabase, sport });
      if (activity.skip) {
        return { records_updated: 0, api_calls_made: 0, details: { skipped: true, activity } };
      }
      const slate = currentSlateDate(sport);
      // Reuse the existing free-source cache inside the same CBB lease. This
      // does not call Owls again or put provider work on member reads.
      const draftKingsFallback=sport==="cbb"?await refreshDraftKingsNetworkSplitSource("cbb").catch(()=>null):null;
      const result = await syncPublicSplitsObservations({
        supabase,
        sport,
        slateDate: slate,
        apply: true,
        todayUtc: slate,
      });
      // One league-level Owls request is matched to the same bounded member
      // window. Basketball and weekly football retain a seven-day window;
      // daily sports stay on the exact ET slate. This writes only the v2
      // observation substrate and grants no prediction or grade authority.
      const marketIntelligenceV2 = await runScheduledMarketIntelligenceV2Collection({
        supabase,
        sport,
        slateDate: slate,
        phase: "public_splits_refresh",
        slateDateThrough: ["nba", "nfl", "cfb", "cbb"].includes(sport)
          ? addDaysToSlate(slate, 6)
          : undefined,
      });
      const errors = [
        ...(result.skippedTableMissing ? [`${sport} ${slate}: table not applied`] : []),
        ...result.errors,
        ...(marketIntelligenceV2?.errors ?? []),
      ];
      // CBB already publishes its own source-qualified board under the same
      // sport lease. The reader overlays fresh captured splits independently.
      // Copying that board through the generic publisher rereads/rewrites its
      // complete history, replaces the pipeline release with v1 and advances
      // freshness even when the authoritative board has not refreshed.
      const responseSnapshot = sport !== "cbb" && result.errors.length === 0 && !result.skippedTableMissing
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
        records_updated:
          result.upserted +
          (marketIntelligenceV2?.recordsUpdated ?? 0) +
          (responseSnapshot?.ok ? 1 : 0),
        api_calls_made: 1 + (marketIntelligenceV2?.apiCallsMade ?? 0),
        partial: errors.length > 0,
        error_message: errors.length ? errors.slice(0, 5).join(" | ").slice(0, 1500) : null,
        details: {
          activity,
          slate,
          ...(sport==="cbb"?{draftkings_fallback:{games:draftKingsFallback?.games.length??0,
            markets:draftKingsFallback?.games.reduce((sum,game)=>sum+Object.keys(game.markets).length,0)??0,
            fetched_at:draftKingsFallback?.fetchedAt??null,public_html_page_request_ceiling:12,additional_paid_provider_calls:0}}:{}),
          sharpapi: result.sharpapiRows,
          playbook: result.playbookRows,
          upserted: result.upserted,
          market_intelligence_v2: marketIntelligenceV2,
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
