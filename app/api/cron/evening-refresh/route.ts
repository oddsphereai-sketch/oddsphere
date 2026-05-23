/**
 * /api/cron/evening-refresh — runs at 5pm ET / 10pm UTC.
 *
 * The "lineups are confirming" refresh — full pipeline except slate/games.
 *   • lines (final pre-lineup-drop pricing)
 *   • props (book prop lines)
 *   • sharp signals
 *   • lineups (confirmed lineups start dropping here)
 *   • weather (final forecast before games)
 *   • prop predictions (re-run with confirmed lineup positions)
 *   • sharp verdicts
 *
 * Skips refreshGames (slate stable) and the scores-model check (Daniel
 * uploaded by morning-slate). Heaviest mid-day cron — maxDuration=180.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import { sportsInSeasonToday } from "@/lib/cron/seasons";
import { linesService } from "@/lib/services/linesService";
import { weatherService } from "@/lib/services/weatherService";
import { lineupService } from "@/lib/services/lineupService";
import { predictionService } from "@/lib/services/predictionService";
import { loadGameIdMap } from "@/lib/services/_idMaps";

export const maxDuration = 180;

export async function GET(request: Request) {
  const date = parseDateFromUrl(request);
  return cronHandlerPerSport(
    request,
    "evening_refresh",
    sportsInSeasonToday(),
    async ({ sport }) => {
      let records = 0;
      let apiCalls = 0;

      const gameLines = await linesService.refreshGameLines(sport, date);
      records += gameLines.records_updated ?? 0;
      apiCalls += gameLines.api_calls_made ?? 0;

      const props = await linesService.refreshPlayerProps(sport, date);
      records += props.records_updated ?? 0;
      apiCalls += props.api_calls_made ?? 0;

      const signals = await linesService.refreshSharpSignals(sport, date);
      records += signals.records_updated ?? 0;
      apiCalls += signals.api_calls_made ?? 0;

      const lineups = await lineupService.refreshLineups(sport, date);
      records += lineups.records_updated ?? 0;
      apiCalls += lineups.api_calls_made ?? 0;

      const weather = await weatherService.refreshForecasts(sport, date);
      records += weather.records_updated ?? 0;
      apiCalls += weather.api_calls_made ?? 0;

      // Re-run prop predictions with confirmed lineups
      const propPreds = await predictionService.generatePropPredictions(sport, date);
      records += propPreds.records_updated ?? 0;
      apiCalls += propPreds.api_calls_made ?? 0;

      const gameIdByExt = await loadGameIdMap(sport, date);
      const verdicts = await predictionService.regenerateSharpVerdicts(
        [...gameIdByExt.values()]
      );
      records += verdicts.records_updated ?? 0;

      return {
        records_updated: records,
        api_calls_made: apiCalls,
        details: {
          game_lines: gameLines.records_updated,
          player_props_lines: props.records_updated,
          sharp_signals: signals.records_updated,
          lineups: lineups.records_updated,
          weather: weather.records_updated,
          prop_predictions: propPreds.records_updated,
          verdicts: verdicts.records_updated,
        },
      };
    }
  );
}

export const POST = GET;
