/**
 * Push 3A-4 Phase 5 — /api/cron/feature-coverage-refresh
 *
 * Cron-callable, expected-slate-driven feature refresh that fills the
 * two gaps Push 3A-3 identified:
 *
 *   1. weather_forecasts (via weatherService.refreshForecasts)
 *   2. lineups            (via lineupService.refreshLineups)
 *
 * Runs as a separate route from the slate-cycle orchestrator but uses the
 * same sport-scoped prediction_pipeline lease. This keeps feature writes
 * from overlapping a slate rebuild while preserving refresh frequency.
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
 * Schedule (vercel.json, UTC):
 *   `55 7,9,11,13,15,17,19,21,23 * * *` and `55 0-2 * * *`.
 *
 * Runs shortly before slate-cycle so lineups, weather, player mappings,
 * and starter stats are available before predictions are rebuilt. This is
 * intentionally independent of slate-cycle: backfillable feature gaps are
 * data-pipeline failures first, not reasons to silently weaken every card.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import { weatherService } from "@/lib/services/weatherService";
import { lineupService } from "@/lib/services/lineupService";
import { runBdlPlayerBackfillCycle } from "@/lib/services/bdlPlayerBackfillService";
import type { Sport } from "@/lib/types/domain/Sport";

export const maxDuration = 120;

type FeatureRefreshDetails = {
  // Push 3B-5: BDL player backfill runs BEFORE the lineup refresh so
  // any new BDL player IDs the provider returns today already have
  // a `players` row by the time lineupService.refreshLineups inserts.
  bdl_players: {
    enabled: boolean;
    write_enabled: boolean;
    status?: string;
    api_calls_made: number;
    linked: number;
    created: number;
    failed: number;
    pre_map_size: number;
    post_map_size: number;
    counts?: Record<string, number>;
    reason?: string;
  };
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
    bdl_players: { enabled: false, write_enabled: false, api_calls_made: 0, linked: 0, created: 0, failed: 0, pre_map_size: 0, post_map_size: 0, reason },
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
      const bdlWritesEnabled = process.env.BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED === "true";
      const bdlWriteMode = playerStatsProviderReal && bdlWritesEnabled;

      const details: FeatureRefreshDetails = {
        bdl_players: { enabled: playerStatsProviderReal, write_enabled: bdlWriteMode, api_calls_made: 0, linked: 0, created: 0, failed: 0, pre_map_size: 0, post_map_size: 0 },
        weather: { enabled: weatherProviderReal, records_updated: 0, api_calls_made: 0 },
        lineup: { enabled: playerStatsProviderReal, records_updated: 0, api_calls_made: 0 },
      };

      let totalRecords = 0;
      let totalApiCalls = 0;
      let partial = false;

      // ─── Step 0 — BDL player backfill ─────────────────────────────
      // Runs FIRST so lineup refresh doesn't skip rows when BDL emits
      // a new player_external_id we haven't mapped yet. Write-gated on
      // BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED + PLAYER_STATS_PROVIDER=
      // real_api. In observe-only mode (real provider, write flag off)
      // it still runs the classification so the report shows what
      // WOULD be backfilled — purely diagnostic.
      if (playerStatsProviderReal) {
        try {
          const r = await runBdlPlayerBackfillCycle({ sport, date, writeMode: bdlWriteMode });
          details.bdl_players.status = r.status;
          details.bdl_players.api_calls_made = r.api_calls;
          details.bdl_players.linked = r.linked;
          details.bdl_players.created = r.created;
          details.bdl_players.failed = r.failed;
          details.bdl_players.pre_map_size = r.pre_map_size;
          details.bdl_players.post_map_size = r.post_map_size;
          details.bdl_players.counts = r.counts as unknown as Record<string, number>;
          totalApiCalls += r.api_calls;
          if (r.failed > 0) partial = true;
        } catch (e) {
          details.bdl_players.reason = (e as Error).message;
          partial = true;
        }
      } else {
        details.bdl_players.reason = "PLAYER_STATS_PROVIDER!=real_api; BDL player backfill skipped.";
      }

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
    {
      leaseGroup: "prediction_pipeline",
      requireLease: true,
      lockMinutes: 4,
    },
  );
}

export const POST = GET;
