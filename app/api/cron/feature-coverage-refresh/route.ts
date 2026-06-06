/**
 * Push 3A-4 Phase 5 — /api/cron/feature-coverage-refresh
 *
 * Cron-callable, expected-slate-driven feature refresh that fills the
 * two gaps Push 3A-3 identified:
 *
 *   1. weather_forecasts (via weatherService.refreshForecasts)
 *   2. lineups            (via lineupService.refreshLineups)
 *
 * Runs OUTSIDE the slate-cycle orchestrator so it can't accidentally
 * break the lines / starter / pitcher / season-stats chain that
 * V2.1 currently depends on. Both services are idempotent (delete-by-
 * game_id then insert).
 *
 * Auth: CRON_SECRET via cronHandler wrapper (same pattern as
 * /api/cron/slate-cycle and /api/cron/tracking-refresh).
 *
 * SAFETY GATES (every gate must pass before any write fires):
 *
 *   1. CRON_SECRET                            — wrapper enforces.
 *   2. FEATURE_COVERAGE_AUTO_REFRESH_ENABLED  — must be "true". If
 *      missing, route returns a structured blocked report. Mirrors
 *      ORCHESTRATOR_SKIP_CONFIRMATION pattern in slate-cycle.
 *   3. WEATHER_PROVIDER=real_api               — refuses to write when
 *      the mock provider is wired (would persist fake forecasts).
 *   4. PLAYER_STATS_PROVIDER=real_api          — same for lineups.
 *
 * NEVER writes:
 *   • game_predictions / slate_status / locked_at
 *   • tracking records
 *   • model version flags
 *   • prediction grades
 *
 * Suggested schedule (vercel.json, UTC):
 *   `30 13 * * *`  — 13:30 UTC (~9:30am ET) for projected lineups +
 *                    initial weather
 *   Add a second entry for closer-to-game refresh once a confirmed
 *   lineup source is wired (Push 3A-5+).
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import { weatherService } from "@/lib/services/weatherService";
import { lineupService } from "@/lib/services/lineupService";
import type { Sport } from "@/lib/types/domain/Sport";

export const maxDuration = 120;

type FeatureRefreshDetails = {
  weather: {
    enabled: boolean;
    records_updated: number;
    api_calls_made: number;
    reason?: string;
  };
  lineup: {
    enabled: boolean;
    records_updated: number;
    api_calls_made: number;
    reason?: string;
    skipped_by_reason?: Record<string, number>;
  };
};

function buildBlockedDetails(reason: string): FeatureRefreshDetails {
  return {
    weather: { enabled: false, records_updated: 0, api_calls_made: 0, reason },
    lineup: { enabled: false, records_updated: 0, api_calls_made: 0, reason },
  };
}

export async function GET(request: Request) {
  const date = parseDateFromUrl(request);
  const sports: Sport[] = ["mlb"];

  return cronHandlerPerSport(
    request,
    "feature_coverage_refresh",
    sports,
    async ({ sport }) => {
      // Hard gate — explicit env opt-in. Missing → blocked report,
      // 200 to prevent scheduler retries, partial:true for monitoring.
      if (process.env.FEATURE_COVERAGE_AUTO_REFRESH_ENABLED !== "true") {
        return {
          records_updated: 0,
          api_calls_made: 0,
          partial: true,
          details: buildBlockedDetails(
            "FEATURE_COVERAGE_AUTO_REFRESH_ENABLED env flag not set; refresh not enabled.",
          ),
        };
      }

      const weatherProviderReal = process.env.WEATHER_PROVIDER === "real_api";
      const playerStatsProviderReal = process.env.PLAYER_STATS_PROVIDER === "real_api";

      const details: FeatureRefreshDetails = {
        weather: { enabled: weatherProviderReal, records_updated: 0, api_calls_made: 0 },
        lineup: { enabled: playerStatsProviderReal, records_updated: 0, api_calls_made: 0 },
      };

      let totalRecords = 0;
      let totalApiCalls = 0;
      let partial = false;

      if (weatherProviderReal) {
        try {
          const r = await weatherService.refreshForecasts(sport, date);
          details.weather.records_updated = r.records_updated ?? 0;
          details.weather.api_calls_made = r.api_calls_made ?? 0;
          totalRecords += r.records_updated ?? 0;
          totalApiCalls += r.api_calls_made ?? 0;
        } catch (e) {
          details.weather.reason = (e as Error).message;
          partial = true;
        }
      } else {
        details.weather.reason = "WEATHER_PROVIDER!=real_api; weather refresh skipped to avoid mock writes.";
        partial = true;
      }

      if (playerStatsProviderReal) {
        try {
          const r = await lineupService.refreshLineups(sport, date);
          details.lineup.records_updated = r.records_updated ?? 0;
          details.lineup.api_calls_made = r.api_calls_made ?? 0;
          const d = (r.details ?? {}) as { skipped_by_reason?: Record<string, number> };
          if (d.skipped_by_reason) details.lineup.skipped_by_reason = d.skipped_by_reason;
          totalRecords += r.records_updated ?? 0;
          totalApiCalls += r.api_calls_made ?? 0;
        } catch (e) {
          details.lineup.reason = (e as Error).message;
          partial = true;
        }
      } else {
        details.lineup.reason = "PLAYER_STATS_PROVIDER!=real_api; lineup refresh skipped to avoid mock writes.";
        partial = true;
      }

      return {
        records_updated: totalRecords,
        api_calls_made: totalApiCalls,
        partial,
        details,
      };
    },
  );
}

export const POST = GET;
