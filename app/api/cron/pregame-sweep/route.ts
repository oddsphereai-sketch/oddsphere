/**
 * /api/cron/pregame-sweep — runs every 15 min in the final 90 min before games.
 *
 * Last-mile sweep: lines + sharp signals + verdict re-evaluation + V2.1
 * Layer-3 market signal derivation + final grade derivation. Captures any
 * final-hour sharp action (steam moves, RLM) so the Daily Edge card
 * banners reflect the latest market state heading into first pitch.
 *
 * Order of operations matters — each step depends on the prior:
 *   1. game lines + sharp signals refresh   (linesService, provider boundary)
 *   2. verdict regeneration                  (per-signal STRONG/CAUTION text)
 *   3. market signal derivation              (Layer 3 → market_signal column)
 *   4. grade derivation                      (synthesizes Layers 1+3 → grade)
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
import { updateMarketSignalsForSlate } from "@/lib/services/marketSignalDerivationService";
import { updateGradesForSlate } from "@/lib/services/gradeDerivationService";
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

      // Fix 4.1: regenerateSharpVerdicts removed. Legacy pipeline deleted;
      // signal text derives at API response time.

      // V2.1 Layer 3 + final grade — derived AFTER sharp signals + verdicts
      // are settled. updateMarketSignalsForSlate reads sharp_signals; the
      // grade step reads per-pick market_signal (just written) + edge_pct/ev_pct.
      // 6.3.5b: both services dual-write per-pick (ml/ou/nrfi) + legacy columns.
      const marketSignals = await updateMarketSignalsForSlate(sport, date);
      const marketTouched =
        marketSignals.gamePredictionsUpdated +
        marketSignals.propPredictionsUpdated;
      records += marketTouched;

      const grades = await updateGradesForSlate(sport, date);
      const gradeTouched =
        grades.gamePredictionsUpdated + grades.propPredictionsUpdated;
      records += gradeTouched;

      return {
        records_updated: records,
        api_calls_made: apiCalls,
        details: {
          game_lines: gameLines.records_updated,
          sharp_signals: signals.records_updated,
          market_signals: marketTouched,
          market_signals_perMarket: marketSignals.perMarket,
          grades: gradeTouched,
          grades_perMarket: grades.perMarket,
          best_signal_pct: grades.monitor.bestSignalPct.toFixed(1),
          best_signal_picks: grades.monitor.bestSignalPicks,
          total_derived_picks: grades.monitor.totalDerivedPicks,
        },
      };
    }
  );
}

export const POST = GET;
