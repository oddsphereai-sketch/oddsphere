import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { OpenWeatherProvider } from "@/lib/providers/real_api/OpenWeatherProvider";
import { runNflForwardEvidenceWriter } from "@/lib/services/football/nflForwardEvidenceWriter";
import { runNflPlayerPropsProductionWriter } from "@/lib/services/football/nflPlayerPropsProductionWriter";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(request, "nfl_forward_evidence", async ({ runId }) => {
    if (process.env.NFL_FORWARD_EVIDENCE_ENABLED !== "true") {
      return {
        records_updated: 0,
        api_calls_made: 0,
        details: {
          disabled: true,
          reason: "NFL_FORWARD_EVIDENCE_ENABLED!=true",
          publication_attempted: false,
          tracking_attempted: false,
        },
      };
    }
    const balldontlieApiKey = requiredEnv("BALLDONTLIE_API_KEY");
    const playbookApiKey = requiredEnv("PLAYBOOK_API_KEY");
    const sharpApiKey = requiredEnv("SHARPAPI_KEY");
    const season = boundedInteger(process.env.NFL_FORWARD_SEASON ?? "2026", 2026, 2100, "NFL_FORWARD_SEASON");
    const week = boundedInteger(process.env.NFL_FORWARD_WEEK ?? "1", 1, 18, "NFL_FORWARD_WEEK");
    const weatherProvider = process.env.OPENWEATHER_API_KEY
      ? new OpenWeatherProvider(process.env.OPENWEATHER_API_KEY)
      : null;
    const cycleNow = new Date().toISOString();
    const result = await runNflForwardEvidenceWriter({
      client: supabase,
      season,
      week,
      runId,
      now: cycleNow,
      apply: true,
      balldontlieApiKey,
      playbookApiKey,
      sharpApiKey,
      weatherProvider,
    });
    let playerProps: Awaited<ReturnType<typeof runNflPlayerPropsProductionWriter>> | null = null;
    let playerPropsError: string | null = null;
    if (process.env.NFL_PLAYER_PROPS_ENABLED === "true") {
      try {
        playerProps = await runNflPlayerPropsProductionWriter({
          client: supabase,
          season,
          week,
          now: cycleNow,
          apply: true,
          ballDontLieApiKey: balldontlieApiKey,
          sharpApiKey,
        });
      } catch (error) {
        // Props retains its last complete snapshot. A provider failure must not
        // roll back or suppress the authoritative NFL Daily Edge publication.
        playerPropsError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      records_updated: result.inserted + (playerProps?.memberRows ?? 0),
      api_calls_made: result.apiCallsMaximum + (playerProps?.apiCallsMaximum ?? 0),
      partial: result.healthHolds.length > 0 || result.memberSnapshotError !== null || playerPropsError !== null,
      error_message: [result.healthHolds.join(","), result.memberSnapshotError, playerPropsError].filter(Boolean).join(",") || null,
      details: {
        writer_release: result.writerRelease,
        collected: result.collected,
        collection_reason: result.collectionReason,
        proposed: result.proposed,
        games: result.games,
        stages: result.stages,
        quarterback_health_reasons: result.quarterbackHealthReasons,
        published_evaluations: result.publishedEvaluations,
        published_best_angles: result.publishedBestAngles,
        published_leans: result.publishedLeans,
        published_watchlists: result.publishedWatchlists,
        published_no_plays: result.publishedNoPlays,
        published_held_games: result.publishedHeldGames,
        health_holds: result.healthHolds,
        publication_attempted: result.publicationAttempted,
        member_snapshot_attempted: result.memberSnapshotAttempted,
        member_snapshot_updated: result.memberSnapshotUpdated,
        member_snapshot_key: result.memberSnapshotKey,
        member_snapshot_error: result.memberSnapshotError,
        tracking_attempted: result.trackingAttempted,
        tracking_records_proposed: result.trackingRecordsProposed,
        tracking_records_inserted: result.trackingRecordsInserted,
        tracking_records_existing: result.trackingRecordsExisting,
        player_props_enabled: process.env.NFL_PLAYER_PROPS_ENABLED === "true",
        player_props: playerProps,
        player_props_error: playerPropsError,
      },
    };
  }, {
    sport: "nfl",
    leaseGroup: "prediction_pipeline",
    requireLease: true,
    lockMinutes: 8,
    leaseRetryMaxWaitMs: 10_000,
    leaseRetryIntervalMs: 1_000,
  });
}

export const POST = GET;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required for NFL forward evidence collection.`);
  return value;
}

function boundedInteger(value: string, minimum: number, maximum: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}
