/**
 * /api/cron/pregame-sweep — runs every 15 min in the final 90 min before games.
 *
 * Last-mile sweep: lines + sharp signals + verdict re-evaluation. Captures
 * any final-hour sharp action (steam moves, RLM) so the Daily Edge card
 * banners reflect the latest market state heading into first pitch.
 *
 * Does NOT refresh lineups (lineup-watch handles that) or weather (final
 * forecast already captured by evening-refresh). Lightweight + frequent →
 * maxDuration=60.
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
    "pregame_sweep",
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
