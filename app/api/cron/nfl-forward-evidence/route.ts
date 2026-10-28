import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { OpenWeatherProvider } from "@/lib/providers/real_api/OpenWeatherProvider";
import { runNflForwardEvidenceWriter } from "@/lib/services/football/nflForwardEvidenceWriter";
import { readNflForwardMemberSnapshot } from "@/lib/services/football/nflForwardMemberSnapshotStore";
import {
  readNflPlayerPropsCurrentSeasonState,
  refreshNflPlayerPropsCurrentSeasonState,
  writeNflPlayerPropsCurrentSeasonState,
} from "@/lib/services/football/nflPlayerPropsCurrentSeasonState";
import { runNflPlayerPropsProductionWriter } from "@/lib/services/football/nflPlayerPropsProductionWriter";
import { planNflPlayerPropsRefresh } from "@/lib/services/football/nflPlayerPropsCadence";
import { readNflPlayerPropsSnapshot } from "@/lib/services/football/nflPlayerPropsSnapshotStore";
import { resolveNflForwardWeek, resolveNflOperationalWeek } from "@/lib/services/football/nflForwardWeekSelection";
import { resolveNflMarketBrainCaptureConfiguration } from
  "@/lib/services/football/nflMarketBrainCaptureConfig";

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
    const owlsApiKey = requiredEnv("OWLS_INSIGHT_API_KEY");
    const season = boundedInteger(process.env.NFL_FORWARD_SEASON ?? "2026", 2026, 2100, "NFL_FORWARD_SEASON");
    const configuredWeek = boundedInteger(process.env.NFL_FORWARD_WEEK ?? "1", 1, 18, "NFL_FORWARD_WEEK");
    const weatherProvider = process.env.OPENWEATHER_API_KEY
      ? new OpenWeatherProvider(process.env.OPENWEATHER_API_KEY)
      : null;
    const cycleNow = new Date().toISOString();
    const calendarWeek = resolveNflForwardWeek({ season, configuredWeek, now: new Date(cycleNow) });
    const currentPublished = await readNflForwardMemberSnapshot({
      client: supabase,
      season,
      week: calendarWeek,
      now: cycleNow,
    });
    const week = resolveNflOperationalWeek({
      season,
      configuredWeek,
      scheduledStarts: currentPublished?.fixture.snapshot.games
        .map((game) => game.gameStartAt)
        .filter((value): value is string => typeof value === "string") ?? [],
      now: new Date(cycleNow),
    });
    // The Week N+1 football forecast consumes the completed Week N team state.
    // Refresh it once under this existing sport lease before either downstream
    // writer reads it; the props writer then reuses the persisted state with
    // zero duplicate state-provider calls.
    const priorCurrentSeasonState = await readNflPlayerPropsCurrentSeasonState({ client: supabase, season });
    const currentSeasonState = await refreshNflPlayerPropsCurrentSeasonState({
      season,
      week,
      now: cycleNow,
      apiKey: balldontlieApiKey,
      previous: priorCurrentSeasonState,
    });
    if (currentSeasonState.apiCalls > 0) {
      await writeNflPlayerPropsCurrentSeasonState({ client: supabase, state: currentSeasonState.state });
    }
    // Resolved after the authoritative current-season state refresh. Invalid
    // research configuration is data, never an exception from this route.
    const marketBrainConfiguration = resolveNflMarketBrainCaptureConfiguration(process.env);
    const marketBrainCaptureRequested = marketBrainConfiguration.requested;
    const marketBrainCaptureEnabled = marketBrainConfiguration.enabled;
    const marketBrainCaptureMaxGames = marketBrainConfiguration.maximumGames;
    const marketBrainCaptureAttemptSchedule = marketBrainConfiguration.attemptSchedule;
    const marketBrainConfigurationError = marketBrainConfiguration.error;
    const result = await runNflForwardEvidenceWriter({
      client: supabase,
      season,
      week,
      runId,
      now: cycleNow,
      apply: true,
      balldontlieApiKey,
      playbookApiKey,
      owlsApiKey,
      weatherProvider,
      exactProviderCandidate: true,
      marketBrainCaptureEnabled,
      marketBrainCaptureMaxGames,
      marketBrainCaptureAttemptSchedule,
    });
    let playerProps: Awaited<ReturnType<typeof runNflPlayerPropsProductionWriter>> | null = null;
    let playerPropsError: string | null = null;
    const playerPropsEnabled = process.env.NFL_PLAYER_PROPS_ENABLED === "true";
    let playerPropsCadence: ReturnType<typeof planNflPlayerPropsRefresh> | null = null;
    let playerPropsCadenceError: string | null = null;
    if (playerPropsEnabled) {
      try {
        playerPropsCadence = planNflPlayerPropsRefresh({
          now: cycleNow,
          previous: await readNflPlayerPropsSnapshot({ client: supabase, season, week }),
        });
      } catch (error) {
        // A cadence lookup failure must not suppress either the NFL Daily Edge
        // publication or the props recovery attempt. The writer retains its
        // own complete-snapshot/LKG contract and remains inside this route's
        // shared NFL lease.
        playerPropsCadenceError = error instanceof Error ? error.message : String(error);
        playerPropsCadence = planNflPlayerPropsRefresh({ now: cycleNow, previous: null });
      }
    }
    if (playerPropsEnabled && playerPropsCadence?.run) {
      try {
        playerProps = await runNflPlayerPropsProductionWriter({
          client: supabase,
          season,
          week,
          now: cycleNow,
          apply: true,
          ballDontLieApiKey: balldontlieApiKey,
        });
      } catch (error) {
        // Props retains its last complete snapshot. A provider failure must not
        // roll back or suppress the authoritative NFL Daily Edge publication.
        playerPropsError = error instanceof Error ? error.message : String(error);
      }
    }
    const playerPropsCriticalHealth = playerProps?.healthFindings.filter((finding) =>
      finding === "NFL_PLAYER_PROPS_SOURCE_AWARE_REFERENCE_OFFERS_UNAVAILABLE"
      || finding === "NFL_PLAYER_PROPS_REFERENCE_OFFER_CACHE_FAILED"
      || finding === "NFL_PLAYER_PROPS_PRIVATE_TRACKING_CAPTURE_FAILED") ?? [];
    const marketBrainDetails = marketBrainCaptureRequested || marketBrainConfigurationError !== null
      ? {
          market_brain_capture_requested: marketBrainCaptureRequested,
          market_brain_capture_enabled: marketBrainCaptureEnabled,
          market_brain_configuration_error: marketBrainConfigurationError,
          market_brain_capture_canary_limit: marketBrainCaptureMaxGames,
          market_brain_shadows_proposed: result.marketBrainShadowsProposed,
          market_brain_shadows_inserted: result.marketBrainShadowsInserted,
          market_brain_shadows_existing: result.marketBrainShadowsExisting,
          market_brain_capture_failures: result.marketBrainCaptureFailures,
          market_brain_capture_failure_reasons: result.marketBrainCaptureFailureReasons,
          market_brain_persistence_attempted: result.marketBrainPersistenceAttempted,
          market_brain_persistence_error: result.marketBrainPersistenceError,
        }
      : {};
    return {
      records_updated: result.inserted + (playerProps?.memberRows ?? 0),
      api_calls_made: currentSeasonState.apiCalls + result.apiCallsMaximum + (playerProps?.apiCallsMaximum ?? 0),
      partial: result.healthHolds.length > 0 || result.memberSnapshotError !== null
        || result.marketBrainPersistenceError !== null
        || result.marketBrainCaptureFailures > 0
        || marketBrainConfigurationError !== null
        || playerPropsError !== null || playerPropsCriticalHealth.length > 0,
      error_message: [result.healthHolds.join(","), result.memberSnapshotError,
        result.marketBrainPersistenceError, ...result.marketBrainCaptureFailureReasons,
        marketBrainConfigurationError,
        playerPropsError, playerPropsCriticalHealth.join(",")]
        .filter(Boolean).join(",") || null,
      details: {
        writer_release: result.writerRelease,
        calendar_week: calendarWeek,
        operational_week: week,
        current_season_state_api_calls: currentSeasonState.apiCalls,
        current_season_state_complete_through_week: currentSeasonState.state.completeThroughWeek,
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
        owls_capture: result.owlsCapture,
        ...marketBrainDetails,
        player_props_enabled: playerPropsEnabled,
        player_props_cadence: playerPropsCadence,
        player_props_cadence_error: playerPropsCadenceError,
        player_props: playerProps,
        player_props_error: playerPropsError,
        player_props_critical_health: playerPropsCriticalHealth,
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
