/**
 * /api/cron/midday-refresh — runs at 12pm ET / 5pm UTC.
 *
 * Per-sport: refresh game lines + sharp signals, then re-evaluate verdicts
 * for tonight's games. No game-slate refresh (slate stable by midday), no
 * weather refresh (afternoon picks up that responsibility), no prop regen
 * (props re-run when lineups confirm at evening-refresh).
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import { sportsInSeasonToday } from "@/lib/cron/seasons";
import { linesService } from "@/lib/services/linesService";
import { predictionService } from "@/lib/services/predictionService";
import { loadGameIdMap } from "@/lib/services/_idMaps";

export const maxDuration = 60;

export async function GET(request: Request) {
  const date = parseDateFromUrl(request);
  return cronHandlerPerSport(
    request,
    "midday_refresh",
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

      const gameIdByExt = await loadGameIdMap(sport, date);
      const verdicts = await predictionService.regenerateSharpVerdicts(
        [...gameIdByExt.values()]
      );
      records += verdicts.records_updated ?? 0;
      apiCalls += verdicts.api_calls_made ?? 0;

      return {
        records_updated: records,
        api_calls_made: apiCalls,
        details: {
          game_lines: gameLines.records_updated,
          sharp_signals: signals.records_updated,
          verdicts: verdicts.records_updated,
        },
      };
    }
  );
}

export const POST = GET;
