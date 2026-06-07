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
 *      — if partial:true (no Daniel upload yet), SKIP steps 7-11
 *   7. predictionService.generatePropPredictions(sport, date)
 *   8. predictionService.regenerateSharpVerdicts(tonightGameIds)
 *   9. marketSignalDerivationService.updateMarketSignalsForSlate (V2.1 Layer 3)
 *  10. gradeDerivationService.updateGradesForSlate           (V2.1 grade engine)
 *  11. slatePublishService.publishSlate                      (auto-publish for V1)
 *
 * Steps 9-11 are V2.1 additions (Phase 6.4a) — they sit at the end of the
 * pipeline because each depends on the prior step's writes:
 *   • marketSignal reads sharp_signals (step 4 already wrote them)
 *   • grade reads market_signal (step 9 just wrote it) + ev_pct from sharp_signals
 *   • publish is the final V1 gate — until Phase 7.5 ships an admin review UI,
 *     "morning-slate ran successfully" IS the admin promotion action, so we
 *     auto-promote draft → published immediately after grades land. Phase 7.5
 *     replaces this auto-publish with a manual review step.
 *
 * Sport-scoped lock means MLB and NBA can run in parallel without blocking.
 * If Daniel hasn't uploaded scores model yet (step 6 partial:true), the
 * sport's prop predictions defer to the next refresh cron — and grade
 * derivation + publish are also skipped so a draft slate doesn't surface
 * to members before the model lands.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { parseDateFromUrl } from "@/lib/cron/dates";
import { sportsInSeasonToday } from "@/lib/cron/seasons";
import { slateService } from "@/lib/services/slateService";
import { linesService } from "@/lib/services/linesService";
import { weatherService } from "@/lib/services/weatherService";
import { predictionService } from "@/lib/services/predictionService";
import { updateMarketSignalsForSlate } from "@/lib/services/marketSignalDerivationService";
import { updateGradesForSlate } from "@/lib/services/gradeDerivationService";
import { publishSlate } from "@/lib/services/slatePublishService";
import { loadGameIdMap } from "@/lib/services/_idMaps";
import {
  shouldAutoPublishMorningSlate,
  publishDecisionLabel,
} from "@/lib/services/morningSlatePublishPolicy";

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
      const gameLines = await linesService.refreshGameLinesV2(sport, date);
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

      // 8. Fix 4.1 (Gap-18+19): sharp verdict regeneration removed. The
      // legacy pipeline (sharpSignalEvaluator + verdictGenerator) is gone;
      // signal text derives at API response time via signalSummaryGenerator.
      // Sharp signals were already ingested in step 4; no cron-side
      // signal-text pass needed.

      // 9. V2.1 Layer 3 — market signal derivation. Reads sharp_signals
      // (written in step 4) + predictions (step 6/7); writes market_signal
      // onto game_predictions + prop_predictions. 6.3.5b: dual-writes
      // per-pick (ml/ou/nrfi) + legacy market_signal columns.
      const marketSignals = await updateMarketSignalsForSlate(sport, date);
      const marketTouched =
        marketSignals.gamePredictionsUpdated +
        marketSignals.propPredictionsUpdated;
      records += marketTouched;
      stepDetails.market_signals = marketTouched;
      stepDetails.market_signals_perMarket = marketSignals.perMarket;

      // 10. V2.1 grade engine. Reads per-pick market_signal (just written)
      // + ev_pct from sharp_signals + prop edge_pct; writes the 7-category
      // grade + signal_type attribution. 6.3.5b: dual-writes per-pick
      // (ml/ou/nrfi grade + signal_type) + legacy grade/signal_type columns.
      const grades = await updateGradesForSlate(sport, date);
      const gradeTouched =
        grades.gamePredictionsUpdated + grades.propPredictionsUpdated;
      records += gradeTouched;
      stepDetails.grades = gradeTouched;
      stepDetails.grades_perMarket = grades.perMarket;
      stepDetails.best_signal_pct = grades.monitor.bestSignalPct.toFixed(1);
      stepDetails.best_signal_picks = grades.monitor.bestSignalPicks;
      stepDetails.total_derived_picks = grades.monitor.totalDerivedPicks;

      // 11. Publish gate — R-19 Phase 1 (C4). HOLD-as-draft is the new
      // default. Auto-publish is opt-in via MORNING_SLATE_AUTO_PUBLISH=true
      // until Phase 7.5's manual review UI lands. When the gate is closed
      // the slate stays at draft and an operator runs publish-slate.ts to
      // promote. When the gate is open (env="true"), behaviour matches the
      // pre-R-19 auto-publish path. Idempotent either way.
      const autoPublish = shouldAutoPublishMorningSlate(process.env);
      if (autoPublish) {
        const publish = await publishSlate(sport, date);
        records += publish.promoted;
        stepDetails.slate_published = publish.promoted;
        stepDetails.slate_publish_decision = publishDecisionLabel(true);
      } else {
        stepDetails.slate_published = 0;
        stepDetails.slate_publish_decision = publishDecisionLabel(false);
      }

      return {
        records_updated: records,
        api_calls_made: apiCalls,
        details: stepDetails,
      };
    }
  );
}

export const POST = GET;
