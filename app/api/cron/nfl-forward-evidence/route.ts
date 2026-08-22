import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { OpenWeatherProvider } from "@/lib/providers/real_api/OpenWeatherProvider";
import { runNflForwardEvidenceWriter } from "@/lib/services/football/nflForwardEvidenceWriter";

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
    const result = await runNflForwardEvidenceWriter({
      client: supabase,
      season,
      week,
      runId,
      now: new Date().toISOString(),
      apply: true,
      balldontlieApiKey,
      playbookApiKey,
      sharpApiKey,
      weatherProvider,
    });
    return {
      records_updated: result.inserted,
      api_calls_made: result.apiCallsMaximum,
      partial: result.healthHolds.length > 0,
      error_message: result.healthHolds.length > 0 ? result.healthHolds.join(",") : null,
      details: {
        writer_release: result.writerRelease,
        collected: result.collected,
        collection_reason: result.collectionReason,
        proposed: result.proposed,
        games: result.games,
        stages: result.stages,
        health_holds: result.healthHolds,
        publication_attempted: result.publicationAttempted,
        tracking_attempted: result.trackingAttempted,
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
