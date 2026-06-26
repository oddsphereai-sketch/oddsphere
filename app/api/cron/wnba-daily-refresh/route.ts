/**
 * WNBA Phase 2 — Stage 1 Step 5: hourly WNBA daily-refresh cron.
 *
 * Runs the DB-backed loop for the upcoming WNBA slate, in order:
 *   1. seedWnbaGames    → upsert teams + games (sport='wnba') for today..+2
 *   2. refreshWnbaLines → SharpAPI odds → lines / line_history / sharp_signals
 *                          + real tip times (games.game_date)
 *   3. runWnbaModel     → Elo+Platt + sharp-preferred decision → game_predictions
 *   4. buildWnbaPredictionRecords → prediction_records for tracking/audit
 *
 * Auth: cronHandler validates the CRON_SECRET bearer token. The route also
 * requires WNBA_CRON_ENABLED=true. Default OFF: when unset, the wrapper still
 * runs (lock + data_refresh_log) but the handler returns success immediately
 * with records_updated=0 and disabled:true — so the Vercel cron entry can land
 * without firing any writes until the flag is explicitly flipped.
 *
 * Safety: writes ONLY sport='wnba' rows; NEVER touches another sport. NEVER
 * overwrites a locked game_predictions row (runWnbaModel's locked guard) or a
 * locked prediction_records row (buildWnbaPredictionRecords locked guard). Does
 * NOT flip live:true. NEVER logs the API keys.
 */

import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { seedWnbaGames } from "@/lib/services/wnba/seedWnbaGames";
import { refreshWnbaLines } from "@/lib/services/wnba/refreshWnbaLines";
import { refreshWnbaPlaybookSplits } from "@/lib/services/wnba/refreshWnbaPlaybookSplits";
import { runWnbaModel } from "@/lib/services/wnba/runWnbaModel";
import { buildWnbaPredictionRecords } from "@/lib/services/wnba/buildWnbaPredictionRecords";
import { runScheduledMarketIntelligenceV2Collection } from "@/lib/services/marketIntelligenceV2/scheduledCollection";
import { addDaysToSlate, currentSlateDate } from "@/lib/dates/slateDate";

const WNBA_CRON_ENV = "WNBA_CRON_ENABLED";

function slateDateOffset(days: number): string {
  return addDaysToSlate(currentSlateDate("wnba"), days);
}

export async function GET(request: Request): Promise<Response> {
  return cronHandler(
    request,
    "wnba_daily_refresh",
    async () => {
      // ─── Gate 1: WNBA_CRON_ENABLED (default off → no writes) ───────
      if (process.env[WNBA_CRON_ENV] !== "true") {
        return { records_updated: 0, details: { disabled: true, reason: `${WNBA_CRON_ENV}!=true` } };
      }
      // ─── Gate 2: required keys (config errors, not data conditions) ─
      if (!process.env.BALLDONTLIE_API_KEY) throw new Error("BALLDONTLIE_API_KEY missing from env");
      if (!process.env.SHARPAPI_KEY) throw new Error("SHARPAPI_KEY missing from env");

      const log = (label: string) => (msg: string) => console.log(`[wnba-daily-refresh:${label}] ${msg}`);
      const errors: string[] = [];
      const details: Record<string, unknown> = {};

      // ─── Step 1: seed the upcoming slate window (today..+2) ─────────
      let teamsUpserted = 0, gamesUpserted = 0;
      for (const n of [0, 1, 2]) {
        const slate = slateDateOffset(n);
        try {
          const s = await seedWnbaGames({ supabase, slateDate: slate, apply: true, logger: log("seed") });
          teamsUpserted = Math.max(teamsUpserted, s.teamsUpserted);
          gamesUpserted += s.gamesUpserted;
          errors.push(...s.errors);
        } catch (e) {
          errors.push(`seed ${slate}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      details.seed = { teamsUpserted, gamesUpserted };

      // ─── Step 2: refresh odds + tip times ──────────────────────────
      let linesWritten = 0, lineHistoryWritten = 0, sharpSignalsWritten = 0, tipTimesUpdated = 0;
      try {
        const l = await refreshWnbaLines({ supabase, apply: true, logger: log("lines") });
        linesWritten = l.linesWritten; lineHistoryWritten = l.lineHistoryWritten;
        sharpSignalsWritten = l.sharpSignalsWritten; tipTimesUpdated = l.tipTimesUpdated;
        errors.push(...l.errors);
        details.lines = { gamesMatched: l.gamesMatched, linesWritten, lineHistoryWritten, sharpSignalsWritten, tipTimesUpdated, unmatched: l.unmatchedOddsRows, missingTips: l.missingTipTimes };
      } catch (e) {
        errors.push(`lines: ${e instanceof Error ? e.message : String(e)}`);
      }

      // ─── Step 2b: Playbook public splits (pregame, display context only) ──
      // Fills sharp_signals.public_betting_pct/public_money_pct for the existing
      // UI. WNBA-only. NEVER touches +EV/steam/RLM/Pinnacle/CLV/grades/model.
      // Skipped (not fatal) if PLAYBOOK_API_KEY is absent, so the cron keeps
      // running during rollout.
      let publicSplitsUpdated = 0, publicSplitsInserted = 0;
      if (process.env.PLAYBOOK_API_KEY) {
        for (const n of [0, 1, 2]) {
          const slate = slateDateOffset(n);
          try {
            const p = await refreshWnbaPlaybookSplits({ supabase, slateDate: slate, apply: true, logger: log("splits") });
            publicSplitsUpdated += p.rowsUpdated; publicSplitsInserted += p.rowsInserted;
            errors.push(...p.errors);
          } catch (e) {
            errors.push(`playbook-splits ${slate}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        details.playbookSplits = { updated: publicSplitsUpdated, inserted: publicSplitsInserted };
      } else {
        details.playbookSplits = { skipped: "PLAYBOOK_API_KEY missing" };
      }

      // ─── Step 3: run model → game_predictions (locked guard) ───────
      let predictionsWritten = 0, skippedLocked = 0;
      try {
        const m = await runWnbaModel({ supabase, apply: true, logger: log("model") });
        predictionsWritten = m.written; skippedLocked = m.skippedLocked;
        errors.push(...m.errors);
        details.model = { gamesPredicted: m.gamesPredicted, predictionsWritten, skippedLocked, missingMarkets: m.missingMarkets };
      } catch (e) {
        errors.push(`model: ${e instanceof Error ? e.message : String(e)}`);
      }

      // ─── Step 4: prediction_records for WNBA public tracking/audit ──
      // Mirrors the displayed ML / O-U / Spread picks into the durable tracking
      // substrate. Locked records are preserved by the writer; grading happens
      // in tracking-refresh after final scores land.
      let predictionRecordsWritten = 0, predictionRecordsLockedSkipped = 0;
      const recordDetails: Array<Record<string, unknown>> = [];
      for (const n of [0, 1, 2]) {
        const slate = slateDateOffset(n);
        try {
          const r = await buildWnbaPredictionRecords({
            supabase,
            apply: true,
            slateDate: slate,
            windowDays: 0,
            logger: log("records"),
          });
          predictionRecordsWritten += r.written;
          predictionRecordsLockedSkipped += r.lockedSkipped;
          errors.push(...r.errors);
          recordDetails.push({
            slate,
            eligibleGames: r.eligibleGames,
            written: r.written,
            lockedSkipped: r.lockedSkipped,
            counts: r.counts,
            withheld: r.withheld.slice(0, 20),
            missingLinePrice: r.missingLinePrice,
          });
        } catch (e) {
          errors.push(`records ${slate}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      details.records = recordDetails;

      // ─── Step 5: Market Intelligence v2 collection substrate ───────
      // Member-facing v2 UI remains gated elsewhere. This keeps WNBA evidence
      // fresh for validation without restoring the old broad sport cron set.
      const marketIntelligenceRuns = [];
      for (const n of [0, 1, 2]) {
        const slate = slateDateOffset(n);
        const run = await runScheduledMarketIntelligenceV2Collection({
          supabase,
          sport: "wnba",
          slateDate: slate,
          phase: "wnba_daily_refresh",
        });
        marketIntelligenceRuns.push(run);
        errors.push(...run.errors.map((err) => `market intelligence ${slate}: ${err}`));
      }
      const marketIntelligenceV2 = {
        enabled: marketIntelligenceRuns.some((run) => run.enabled),
        sport: "wnba",
        slateDates: marketIntelligenceRuns.map((run) => run.slateDate),
        phase: "wnba_daily_refresh",
        runs: marketIntelligenceRuns,
        recordsUpdated: marketIntelligenceRuns.reduce((sum, run) => sum + run.recordsUpdated, 0),
        apiCallsMade: marketIntelligenceRuns.reduce((sum, run) => sum + run.apiCallsMade, 0),
        errors: marketIntelligenceRuns.flatMap((run) => run.errors),
      };
      details.marketIntelligenceV2 = marketIntelligenceV2;

      const recordsUpdated = teamsUpserted + gamesUpserted + linesWritten + lineHistoryWritten + sharpSignalsWritten + publicSplitsUpdated + publicSplitsInserted + predictionsWritten + predictionRecordsWritten + marketIntelligenceV2.recordsUpdated;
      console.log(`[wnba-daily-refresh] done — teams:${teamsUpserted} games:${gamesUpserted} lines:${linesWritten} history:${lineHistoryWritten} signals:${sharpSignalsWritten} pubSplits:${publicSplitsUpdated + publicSplitsInserted} predictions:${predictionsWritten} records:${predictionRecordsWritten} marketIntel:${marketIntelligenceV2.recordsUpdated} lockedSkipped:${skippedLocked}/${predictionRecordsLockedSkipped} errors:${errors.length}`);
      if (errors.length) details.errors = errors.slice(0, 20);
      return {
        records_updated: recordsUpdated,
        api_calls_made: marketIntelligenceV2.apiCallsMade,
        partial: errors.length > 0,
        details,
      };
    },
    { sport: "wnba" },
  );
}
