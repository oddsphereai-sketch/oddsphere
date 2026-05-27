/**
 * /api/cron/lineup-watch — runs every 30 min from 5pm ET until games start.
 *
 * Catches late lineup drops + scratches. Refreshes lineups and regenerates
 * prop predictions for the slate (cheap due to provider caching) so any
 * late scratches drop affected props.
 *
 * Lightweight + frequent → maxDuration=60.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import { sportsInSeasonToday } from "@/lib/cron/seasons";
import { lineupService } from "@/lib/services/lineupService";
import { predictionService } from "@/lib/services/predictionService";
import { loadGameIdMap } from "@/lib/services/_idMaps";

export const maxDuration = 60;

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
          prop_predictions: propPreds.records_updated,
        },
      };
    }
  );
}

export const POST = GET;
