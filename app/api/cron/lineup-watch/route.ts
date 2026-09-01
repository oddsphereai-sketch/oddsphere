/**
 * /api/cron/lineup-watch — runs every 30 min from 5pm ET until games start.
 *
 * Catches late lineup drops + scratches. Refreshes lineups, refreshes
 * MLB FI inputs, and regenerates predictions for still-unlocked games so
 * cards shown to users can move from held/stale to fresh confirmed data.
 *
 * More than prop-only now because MLB FI may need line + starter-split
 * refreshes before rerunning the automodel.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import { sportsInSeasonToday } from "@/lib/cron/seasons";
import { supabase } from "@/lib/db/supabase";
import { linesService } from "@/lib/services/linesService";
import { lineupService } from "@/lib/services/lineupService";
import { predictionService } from "@/lib/services/predictionService";
import { generatePredictionsForSlate } from "@/lib/services/automodelService";
import { createPredictionRecords } from "@/lib/services/predictionRecordService";
import { refreshDailyEdgeResponseSnapshot } from "@/lib/services/labResponseSnapshotWriter";
import { runFirstInningCycle } from "@/scripts/operator/backfill-first-inning-stats";
import { assertMlbChampionRuntime } from "@/lib/automodel/mlbChampionRuntime";

export const maxDuration = 300;

export async function GET(request: Request) {
  const date = parseDateFromUrl(request);
  return cronHandlerPerSport(
    request,
    "lineup_watch",
    sportsInSeasonToday(),
    async ({ sport }) => {
      if (sport === "mlb") assertMlbChampionRuntime();
      let records = 0;
      let apiCalls = 0;

      const lineups = await lineupService.refreshLineups(sport, date);
      records += lineups.records_updated ?? 0;
      apiCalls += lineups.api_calls_made ?? 0;

      let gameLines: Awaited<ReturnType<typeof linesService.refreshGameLinesV2>> | null = null;
      let firstInning: Awaited<ReturnType<typeof runFirstInningCycle>> | null = null;
      let automodel:
        | {
            skipped?: false;
            game_count: number;
            held_count: number;
            errors: number;
            inserted: number;
            updated: number;
          }
        | { skipped: true; reason: string }
        | null = null;
      let memberRecords:
        | {
            proposed: number;
            written: number;
            skipped_existing: number;
            errors: unknown[];
          }
        | null = null;
      let responseSnapshot:
        | Awaited<ReturnType<typeof refreshDailyEdgeResponseSnapshot>>
        | null = null;
      let propPredictions:
        | { delegated: true; writer: "mlb_player_props_refresh" }
        | { delegated: false; records_updated: number } = {
          delegated: true,
          writer: "mlb_player_props_refresh",
        };

      if (sport === "mlb") {
        gameLines = await linesService.refreshGameLinesV2(sport, date);
        records += gameLines.records_updated ?? 0;
        apiCalls += gameLines.api_calls_made ?? 0;

        firstInning = await runFirstInningCycle({
          sport,
          slateDate: date,
          writeMode: process.env.FIRST_INNING_DB_WRITES_ENABLED === "true",
          log: () => undefined,
        });
        records += firstInning.rows_written;
        apiCalls += firstInning.mlb_api_calls;

        if (process.env.AUTOMODEL_DB_WRITES_ENABLED === "true") {
          const modelRun = await generatePredictionsForSlate(sport, date, "morning_draft", {
            writeToDb: true,
            respectLocks: true,
          });
          const inserted = modelRun.db_writes?.ingest.inserted ?? 0;
          const updated = modelRun.db_writes?.ingest.updated ?? 0;
          records += inserted + updated;
          automodel = {
            game_count: modelRun.game_count,
            held_count: modelRun.held_count,
            errors: modelRun.errors.length,
            inserted,
            updated,
          };
          const sync = await createPredictionRecords({
            sport: "mlb",
            slateDate: date,
            launchDay: false,
            apply: true,
            supabase,
            authoritativeFiPredictions: modelRun.authoritative_fi_predictions,
          });
          records += sync.insertedCount;
          memberRecords = {
            proposed: sync.proposed.length,
            written: sync.insertedCount,
            skipped_existing: sync.skippedExisting,
            errors: sync.errors,
          };
          if (sync.errors.length === 0) {
            responseSnapshot = await refreshDailyEdgeResponseSnapshot({
              sport,
              date,
              source: "lineup_watch",
            });
          }
        } else {
          automodel = {
            skipped: true,
            reason: "AUTOMODEL_DB_WRITES_ENABLED!=true; skipped MLB automodel rerun after lineup refresh",
          };
        }
      } else {
        // Preserve the legacy generator for sports that do not yet have the
        // dedicated MLB props snapshot pipeline.
        const propPreds = await predictionService.generatePropPredictions(sport, date);
        records += propPreds.records_updated ?? 0;
        apiCalls += propPreds.api_calls_made ?? 0;
        propPredictions = {
          delegated: false,
          records_updated: propPreds.records_updated ?? 0,
        };
      }

      return {
        records_updated: records,
        api_calls_made: apiCalls,
        partial:
          (memberRecords?.errors.length ?? 0) > 0 ||
          responseSnapshot?.ok === false,
        error_message:
          (memberRecords?.errors.length ?? 0) > 0
            ? `prediction-record sync failed: ${JSON.stringify(memberRecords?.errors).slice(0, 1000)}`
            : responseSnapshot?.ok === false
              ? `daily-edge snapshot publish failed: ${responseSnapshot.error ?? "unknown error"}`
              : null,
        details: {
          lineups: lineups.records_updated,
          game_lines: gameLines?.records_updated ?? null,
          first_inning_refresh: firstInning === null ? null : {
            status: firstInning.status,
            rows_written: firstInning.rows_written,
            rows_dry_run: firstInning.rows_dry_run,
            errors: firstInning.errors,
            mlb_api_calls: firstInning.mlb_api_calls,
          },
          automodel,
          member_records: memberRecords,
          response_snapshot: responseSnapshot,
          // MLB's member props board has one authoritative refresh writer.
          // Non-MLB sports retain their legacy generator above.
          prop_predictions: propPredictions,
        },
      };
    },
    {
      leaseGroup: "prediction_pipeline",
      requireLease: true,
      lockMinutes: 6,
      minIntervalMinutes: 20,
    },
  );
}

export const POST = GET;
