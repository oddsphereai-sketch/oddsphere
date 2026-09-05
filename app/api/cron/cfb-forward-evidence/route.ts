import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { OpenWeatherProvider } from "@/lib/providers/real_api/OpenWeatherProvider";
import { runCfbForwardEvidenceWriter } from "@/lib/services/football/cfbForwardEvidenceWriter";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "cfb_forward_evidence", async ({ runId }) => {
    if (process.env.CFB_FORWARD_EVIDENCE_ENABLED !== "true") return { records_updated: 0, api_calls_made: 0, details: { disabled: true, reason: "CFB_FORWARD_EVIDENCE_ENABLED!=true", publication_attempted: false, tracking_attempted: false } };
    const result = await runCfbForwardEvidenceWriter({
      client: supabase,
      season: boundedInteger(process.env.CFB_FORWARD_SEASON ?? "2026", 2026, 2100, "CFB_FORWARD_SEASON"),
      runId,
      now: new Date().toISOString(),
      apply: true,
      balldontlieApiKey: requiredEnv("BALLDONTLIE_API_KEY"),
      playbookApiKey: requiredEnv("PLAYBOOK_API_KEY"),
      sharpApiKey: requiredEnv("SHARPAPI_KEY"),
      weatherProvider: process.env.OPENWEATHER_API_KEY ? new OpenWeatherProvider(process.env.OPENWEATHER_API_KEY) : null,
    });
    return { records_updated: result.inserted, api_calls_made: result.apiCallsMaximum, partial: result.healthHolds.length > 0, error_message: result.healthHolds.length > 0 ? result.healthHolds.join(",") : null, details: { writer_release: result.writerRelease, collected: result.collected, collection_reason: result.collectionReason, proposed: result.proposed, games: result.games, stages: result.stages, published_evaluations: result.publishedEvaluations, published_best_angles: result.publishedBestAngles, published_leans: result.publishedLeans, published_watchlists: result.publishedWatchlists, published_no_plays: result.publishedNoPlays, held_markets: result.heldMarkets, health_holds: result.healthHolds, capture_failures: result.captureFailures, publication_attempted: result.publicationAttempted, member_snapshot_attempted: result.memberSnapshotAttempted, member_snapshot_updated: result.memberSnapshotUpdated, member_snapshot_key: result.memberSnapshotKey, member_snapshot_error: result.memberSnapshotError, tracking_attempted: result.trackingAttempted, tracking_records_proposed: result.trackingRecordsProposed, tracking_records_inserted: result.trackingRecordsInserted, tracking_records_existing: result.trackingRecordsExisting } };
  }, { sport: "cfb", leaseGroup: "prediction_pipeline", requireLease: true, lockMinutes: 8, leaseRetryMaxWaitMs: 10_000, leaseRetryIntervalMs: 1_000 });
}

export const POST = GET;

function requiredEnv(name: string): string { const value = process.env[name]; if (!value?.trim()) throw new Error(`${name} is required for CFB forward evidence collection.`); return value; }
function boundedInteger(value: string, minimum: number, maximum: number, label: string): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`); return parsed; }
