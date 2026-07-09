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
import { linesService } from "@/lib/services/linesService";
import { lineupService } from "@/lib/services/lineupService";
import { predictionService } from "@/lib/services/predictionService";
import { generatePredictionsForSlate } from "@/lib/services/automodelService";
import { runFirstInningCycle } from "@/scripts/operator/backfill-first-inning-stats";

export const maxDuration = 300;

export async function GET(request: Request) {
  const date = parseDateFromUrl(request);
  return cronHandlerPerSport(
    request,
    "lineup_watch",
    sportsInSeasonToday(),
    async ({ sport }) => {
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
        } else {
          automodel = {
            skipped: true,
            reason: "AUTOMODEL_DB_WRITES_ENABLED!=true; skipped MLB automodel rerun after lineup refresh",
          };
        }
      }

      // Idempotent prop regeneration — caught scratches drop affected
      // predictions naturally because the underlying lineup row no longer
      // exists for that player.
      const propPreds = await predictionService.generatePropPredictions(sport, date);
      records += propPreds.records_updated ?? 0;
      apiCalls += propPreds.api_calls_made ?? 0;

      // Fix 4.1: regenerateSharpVerdicts removed. Legacy pipeline deleted;
      // signal text derives at API response time.

      return {
        records_updated: records,
        api_calls_made: apiCalls,
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
          prop_predictions: propPreds.records_updated,
        },
      };
    }
  );
}

export const POST = GET;
