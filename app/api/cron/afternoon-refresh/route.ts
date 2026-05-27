/**
 * /api/cron/afternoon-refresh — runs at 3pm ET / 8pm UTC.
 *
 * Per-sport: lines + sharp signals + weather (first authoritative forecast
 * pull for tonight's outdoor games) + verdicts. Still no prop regen — wait
 * for evening's confirmed lineups.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import { sportsInSeasonToday } from "@/lib/cron/seasons";
import { linesService } from "@/lib/services/linesService";
import { weatherService } from "@/lib/services/weatherService";
import { predictionService } from "@/lib/services/predictionService";
import { loadGameIdMap } from "@/lib/services/_idMaps";

export const maxDuration = 60;

export async function GET(request: Request) {
  const date = parseDateFromUrl(request);
  return cronHandlerPerSport(
    request,
    "afternoon_refresh",
    sportsInSeasonToday(),
    async ({ sport }) => {
      let records = 0;
      let apiCalls = 0;

      const gameLines = await linesService.refreshGameLines(sport, date);
      records += gameLines.records_updated ?? 0;
      apiCalls += gameLines.api_calls_made ?? 0;

      const signals = await linesService.refreshSharpSignals(sport, date);
      records += signals.records_updated ?? 0;
      apiCalls += signals.api_calls_made ?? 0;

      const weather = await weatherService.refreshForecasts(sport, date);
      records += weather.records_updated ?? 0;
      apiCalls += weather.api_calls_made ?? 0;

      // Fix 4.1: regenerateSharpVerdicts removed. Legacy pipeline deleted;
      // signal text derives at API response time.

      return {
        records_updated: records,
        api_calls_made: apiCalls,
        details: {
          game_lines: gameLines.records_updated,
          sharp_signals: signals.records_updated,
          weather: weather.records_updated,
        },
      };
    }
  );
}

export const POST = GET;
