/**
 * Soccer (FIFA World Cup) daily refresh cron route.
 *
 * Mirrors /api/cron/nhl-daily-refresh in shape. Runs the soccer seed +
 * prediction + (optional) line persistence once per cron tick.
 *
 *   1. seedSoccerGames           → upserts teams + games (sport='soccer')
 *                                   for the ET slate, filtered to BDL
 *                                   fixtures whose kickoff falls in the
 *                                   target sports-day.
 *   2. writeSoccerPredictionRecords → fetches BDL + SharpAPI live, runs
 *                                   the WC-3 auto-model (with Pass 1+2
 *                                   corrections), upserts 4 rows per game.
 *   3. writeSoccerLines          → optionally persists `lines` +
 *                                   `line_history` (Option A scope) when
 *                                   the env-gate enables it.
 *
 * Grading / tracking refresh is NOT in this cron — those live on the
 * shared /api/cron/tracking-refresh cycle once it's extended for soccer
 * (Phase 6 follow-up).
 *
 * Auth: cronHandler validates the CRON_SECRET bearer token. The route
 * also requires SOCCER_CRON_ENABLED=true in env. When NOT enabled, the
 * route still hits the cron wrapper (lock + data_refresh_log) but the
 * handler returns success immediately with records_updated=0 and a
 * `disabled: true` detail. This is the same gate-pattern NHL uses.
 *
 * Each writer's individual gate (SOCCER_SEED_DB_WRITES_ENABLED,
 * SOCCER_PREDICTIONS_DB_WRITES_ENABLED, SOCCER_LINES_DB_WRITES_ENABLED)
 * is honored independently. Steps with missing per-step gates run as
 * dry-runs and report what they WOULD have done — no silent failures.
 *
 * Safety rules:
 *   • Locked rows (locked_at IS NOT NULL) are preserved by
 *     writeSoccerPredictionRecords automatically.
 *   • In-progress games show up in the games table after seed; their
 *     `status` becomes "in_progress" or "completed" via the BDL feed.
 *     The model writer does NOT have a status-gate today — running this
 *     cron post-kickoff IS a known sharp edge (see Phase 6 followup:
 *     extend lock-stamping for soccer). For now, schedule the cron to
 *     fire BEFORE the day's first kickoff so post-kickoff rewrites are
 *     avoided.
 *
 * Status semantics (mapped to refresh_status in data_refresh_log):
 *   • success — every step ran without errors.
 *   • partial — pipeline completed but at least one step reported a
 *               soft failure.
 *   • failed  — hard failure that throws.
 *   • skipped — another soccer_daily_refresh run is in progress.
 *
 * Scope:
 *   • Writes: teams (sport='soccer'), games (sport='soccer'),
 *     prediction_records (sport='soccer'), and (gated) lines / line_history.
 *   • Reads:  BDL FIFA, SharpAPI, our DB.
 *   • NEVER writes any MLB / NBA / NHL row.
 *   • NEVER fabricates sharp_signals (WC-2 empty_as_of_probe contract).
 */

import { cronHandler } from "@/lib/cron/runCron";
import { seedSoccerGames } from "@/lib/services/soccer/seedSoccerGamesService";
import { writeSoccerPredictionRecords } from "@/lib/services/soccer/writeSoccerPredictionRecords";
import { writeSoccerLines } from "@/lib/services/soccer/writeSoccerLines";

const CRON_ENV = "SOCCER_CRON_ENABLED";
const SEED_ENV = "SOCCER_SEED_DB_WRITES_ENABLED";
const PREDS_ENV = "SOCCER_PREDICTIONS_DB_WRITES_ENABLED";
const LINES_ENV = "SOCCER_LINES_DB_WRITES_ENABLED";

/**
 * ET sports-day in YYYY-MM-DD for "today" at request time. WC slate dates
 * are filed under ET because the seeder bucket-maps BDL UTC kickoffs to
 * the containing America/New_York date (see seedSoccerGamesService).
 */
function currentSoccerSlateDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return cronHandler(
    request,
    "soccer_daily_refresh",
    async () => {
      if (process.env[CRON_ENV] !== "true") {
        return {
          records_updated: 0,
          details: { disabled: true, reason: `${CRON_ENV}!=true` },
        };
      }

      const slateDate = currentSoccerSlateDate();
      const stepLog =
        (label: string) =>
        (msg: string): void => {
          console.log(`[soccer-daily-refresh:${label}] ${msg}`);
        };

      let partial = false;
      const stepDetails: Record<string, unknown> = { slate_date_et: slateDate };

      // ── Step 1: seed soccer games + teams for the ET slate. ──
      console.log(`[soccer-daily-refresh] step=seed  date=${slateDate}`);
      const seedDryRun = process.env[SEED_ENV] !== "true";
      const seedResult = await seedSoccerGames({
        dryRun: seedDryRun,
        slateDate,
        logger: stepLog("seed"),
      });
      stepDetails.seed = {
        mode: seedResult.mode,
        eventsFound: seedResult.eventsFound,
        teamsAttempted: seedResult.teamsAttempted,
        teamsUpserted: seedResult.teamsUpserted,
        gamesAttempted: seedResult.gamesAttempted,
        gamesUpserted: seedResult.gamesUpserted,
        gamesSkippedMissingTeam: seedResult.gamesSkippedMissingTeam,
        errorCount: seedResult.errors.length,
        gate: seedDryRun ? `dry-run: ${SEED_ENV}!=true` : "writes enabled",
      };

      if (seedResult.mode === "no-events") {
        return {
          records_updated: 0,
          details: { ...stepDetails, outcome: "no_soccer_today" },
        };
      }
      if (seedResult.errors.length > 0) partial = true;

      // ── Step 2: write prediction_records for the slate. ──
      console.log(`[soccer-daily-refresh] step=predictions  date=${slateDate}`);
      const predsApply = process.env[PREDS_ENV] === "true";
      let predsResult: {
        mode: "dry-run" | "write" | "no-games" | "disabled";
        gamesProcessed: number;
        fixturesMatched: number;
        fixturesUnmatched: number;
        recordsCreated: number;
        recordsSkippedLocked: number;
        errors: string[];
      };
      try {
        const wp = await writeSoccerPredictionRecords({
          slateDate,
          apply: predsApply,
          logger: stepLog("predictions"),
        });
        predsResult = {
          mode: wp.mode,
          gamesProcessed: wp.gamesProcessed,
          fixturesMatched: wp.fixturesMatched,
          fixturesUnmatched: wp.fixturesUnmatched,
          recordsCreated: wp.recordsCreated,
          recordsSkippedLocked: wp.recordsSkippedLocked,
          errors: wp.errors,
        };
        if (wp.errors.length > 0) partial = true;
      } catch (e) {
        partial = true;
        predsResult = {
          mode: "write",
          gamesProcessed: 0,
          fixturesMatched: 0,
          fixturesUnmatched: 0,
          recordsCreated: 0,
          recordsSkippedLocked: 0,
          errors: [e instanceof Error ? e.message : String(e)],
        };
      }
      stepDetails.predictions = {
        ...predsResult,
        gate: predsApply ? "writes enabled" : `dry-run: ${PREDS_ENV}!=true`,
      };

      // ── Step 3 (optional): persist lines + line_history (Option A). ──
      console.log(`[soccer-daily-refresh] step=lines  date=${slateDate}`);
      const linesApply = process.env[LINES_ENV] === "true";
      let linesResult: {
        mode: "dry-run" | "write" | "no-games";
        linesProposed: number;
        linesWritten: number;
        historyProposed: number;
        historyWritten: number;
        openersFlagged: number;
        errors: string[];
      };
      try {
        const wl = await writeSoccerLines({
          slateDate,
          apply: linesApply,
          logger: stepLog("lines"),
        });
        linesResult = {
          mode: wl.mode,
          linesProposed: wl.linesProposed,
          linesWritten: wl.linesWritten,
          historyProposed: wl.historyProposed,
          historyWritten: wl.historyWritten,
          openersFlagged: wl.openersFlagged,
          errors: wl.errors,
        };
        if (wl.errors.length > 0) partial = true;
      } catch (e) {
        partial = true;
        linesResult = {
          mode: "write",
          linesProposed: 0,
          linesWritten: 0,
          historyProposed: 0,
          historyWritten: 0,
          openersFlagged: 0,
          errors: [e instanceof Error ? e.message : String(e)],
        };
      }
      stepDetails.lines = {
        ...linesResult,
        gate: linesApply ? "writes enabled" : `dry-run: ${LINES_ENV}!=true`,
      };

      const recordsUpdated =
        (predsApply ? predsResult.recordsCreated : 0) +
        (linesApply ? linesResult.linesWritten + linesResult.historyWritten : 0) +
        (process.env[SEED_ENV] === "true" ? seedResult.teamsUpserted + seedResult.gamesUpserted : 0);

      return {
        records_updated: recordsUpdated,
        partial,
        details: stepDetails,
      };
    },
    { sport: "soccer" },
  );
}
