/**
 * /api/cron/morning-slate — runs at 8am ET / 1pm UTC. The big one.
 *
 * Per-sport orchestration:
 *   1. slateService.refreshGames(sport, date)
 *   2. linesService.refreshGameLines(sport, date)
 *   3. linesService.refreshPlayerProps(sport, date)
 *   4. linesService.refreshSharpSignals(sport, date)
 *   5. weatherService.refreshForecasts(sport, date)
 *   6. predictionService.generateGamePredictions(sport, date)
 *      — if partial:true (no Daniel upload yet), SKIP step 7
 *   7. predictionService.generatePropPredictions(sport, date)
 *   8. predictionService.regenerateSharpVerdicts(tonightGameIds)
 *
 * Sport-scoped lock means MLB and NBA can run in parallel without blocking.
 * If Daniel hasn't uploaded scores model yet (step 6 partial:true), the
 * sport's prop predictions defer to the next refresh cron.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import { sportsInSeasonToday } from "@/lib/cron/seasons";
import { slateService } from "@/lib/services/slateService";
import { linesService } from "@/lib/services/linesService";
import { weatherService } from "@/lib/services/weatherService";
import { predictionService } from "@/lib/services/predictionService";
import { loadGameIdMap } from "@/lib/services/_idMaps";

export const maxDuration = 300; // Vercel Pro — morning-slate can be heavy

export async function GET(request: Request) {
  const date = parseDateFromUrl(request);

  return cronHandlerPerSport(
    request,
    "morning_slate",
    sportsInSeasonToday(),
    async ({ sport }) => {
      let records = 0;
      let apiCalls = 0;
      const stepDetails: Record<string, unknown> = {};
      let skippedProps: string | null = null;

      // 1. Games
      const games = await slateService.refreshGames(sport, date);
      records += games.records_updated ?? 0;
      apiCalls += games.api_calls_made ?? 0;
      stepDetails.games = games.records_updated;

      // 2-4. Lines + props + sharp signals
      const gameLines = await linesService.refreshGameLines(sport, date);
      records += gameLines.records_updated ?? 0;
      apiCalls += gameLines.api_calls_made ?? 0;
      stepDetails.game_lines = gameLines.records_updated;

      const props = await linesService.refreshPlayerProps(sport, date);
      records += props.records_updated ?? 0;
      apiCalls += props.api_calls_made ?? 0;
      stepDetails.player_props_lines = props.records_updated;

      const signals = await linesService.refreshSharpSignals(sport, date);
      records += signals.records_updated ?? 0;
      apiCalls += signals.api_calls_made ?? 0;
      stepDetails.sharp_signals = signals.records_updated;

      // 5. Weather
      const weather = await weatherService.refreshForecasts(sport, date);
      records += weather.records_updated ?? 0;
      apiCalls += weather.api_calls_made ?? 0;
      stepDetails.weather = weather.records_updated;

      // 6. Game predictions (verify Daniel's upload)
      const gamePreds = await predictionService.generateGamePredictions(sport, date);
      records += gamePreds.records_updated ?? 0;
      apiCalls += gamePreds.api_calls_made ?? 0;
      stepDetails.game_predictions = gamePreds.records_updated;

      if (gamePreds.partial) {
        // No scores-model upload yet — defer prop predictions
        skippedProps = (gamePreds.details as { reason?: string } | undefined)?.reason ?? "no scores model uploaded";
        stepDetails.prop_predictions = "skipped — no scores model";
        return {
          records_updated: records,
          api_calls_made: apiCalls,
          partial: true,
          details: { ...stepDetails, skipped_props_reason: skippedProps },
        };
      }

      // 7. Prop predictions
      const propPreds = await predictionService.generatePropPredictions(sport, date);
      records += propPreds.records_updated ?? 0;
      apiCalls += propPreds.api_calls_made ?? 0;
      stepDetails.prop_predictions = propPreds.records_updated;

      // 8. Regenerate sharp verdicts for tonight's games
      const gameIdByExt = await loadGameIdMap(sport, date);
      const gameIds = [...gameIdByExt.values()];
      const verdicts = await predictionService.regenerateSharpVerdicts(gameIds);
      records += verdicts.records_updated ?? 0;
      apiCalls += verdicts.api_calls_made ?? 0;
      stepDetails.sharp_verdicts = verdicts.records_updated;

      return {
        records_updated: records,
        api_calls_made: apiCalls,
        details: stepDetails,
      };
    }
  );
}

export const POST = GET;
