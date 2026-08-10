/**
 * NHL daily refresh cron route.
 *
 * Mirrors /api/cron/nba-daily-refresh in shape. Runs the NHL seed +
 * lines refresh once per day:
 *   1. seedNhlGames       → upserts teams + games (sport='nhl') for the
 *                            ET slate.
 *   2. refreshNhlLines    → fetches SharpAPI /odds for the slate and
 *                            writes `lines` + appends `line_history`.
 *
 * Final-score ingest + grading + tracking are NOT in this cron — those
 * run on the existing /api/cron/tracking-refresh hourly cycle, which
 * already iterates ["mlb","nba","nhl"]. This cron's job is purely to
 * make sure today's NHL games exist in the table for tracking-refresh
 * to operate on.
 *
 * Auth: cronHandler validates the CRON_SECRET bearer token. The route
 * also requires NHL_CRON_ENABLED=true in the env. When NOT enabled, the
 * route still hits the cron wrapper (lock + data_refresh_log) but the
 * handler returns success immediately with records_updated=0 and a
 * `disabled: true` detail.
 *
 * Status semantics (mapped to refresh_status in data_refresh_log):
 *   • success — every step ran without errors.
 *   • partial — pipeline completed but at least one step reported a
 *               soft failure (SharpAPI lines had errors, etc.).
 *   • failed  — hard failure that throws.
 *   • skipped — another nhl_daily_refresh run is in progress.
 *
 * records_updated tallies useful writes only:
 *   teamsUpserted + gamesUpserted + linesWritten + lineHistoryWritten
 *
 * Scope:
 *   • Writes: teams (sport='nhl'), games (sport='nhl'), lines, line_history.
 *   • Reads:  NHL public API /v1/schedule/{date}, SharpAPI /odds, our DB.
 *   • NEVER writes any MLB / NBA row. NEVER logs SHARPAPI_KEY.
 */

import { cronHandler } from "@/lib/cron/runCron";
import { currentSlateDate } from "@/lib/dates/slateDate";
import { seedNhlGames } from "@/lib/services/nhl/seedNhlGamesService";
import { refreshNhlLines } from "@/lib/services/nhl/refreshNhlLinesService";
import { writeNhlPredictionRecords } from "@/lib/services/nhl/buildNhlPredictionRecords";

const NHL_CRON_ENV = "NHL_CRON_ENABLED";
const NHL_PREDS_ENV = "NHL_PREDICTIONS_DB_WRITES_ENABLED";

/**
 * Returns the MoneyPuck-style season start-year for a given UTC date.
 * NHL season runs roughly October–June. October onward → that year.
 * January–September → previous calendar year.
 *
 * For 2026-06-11 → 2025 (the 2025-26 season). Matches the value the
 * operator scripts pass via --season.
 */
function nhlSeasonStartYearFromDate(date: Date = new Date()): number {
  const m = date.getUTCMonth(); // 0-11
  const y = date.getUTCFullYear();
  return m >= 9 ? y : y - 1;
}

export async function GET(request: Request): Promise<Response> {
  return cronHandler(
    request,
    "nhl_daily_refresh",
    async () => {
      if (process.env[NHL_CRON_ENV] !== "true") {
        return {
          records_updated: 0,
          details: { disabled: true, reason: `${NHL_CRON_ENV}!=true` },
        };
      }

      const sharpApiKey = process.env.SHARPAPI_KEY;
      if (!sharpApiKey) {
        throw new Error("SHARPAPI_KEY missing from env");
      }

      const slateDate = currentSlateDate("nhl");
      const stepLog =
        (label: string) =>
        (msg: string): void => {
          console.log(`[nhl-daily-refresh:${label}] ${msg}`);
        };

      let partial = false;
      const stepDetails: Record<string, unknown> = { slate_date_et: slateDate };

      // Step 1 — seed NHL games + teams for today's ET slate.
      console.log(`[nhl-daily-refresh] step=seed  date=${slateDate}`);
      const seedResult = await seedNhlGames({
        dryRun: false,
        slateDate,
        logger: stepLog("seed"),
      });
      stepDetails.seed = {
        mode: seedResult.mode,
        eventsFound: seedResult.eventsFound,
        teamsUpserted: seedResult.teamsUpserted,
        gamesUpserted: seedResult.gamesUpserted,
        gamesSkippedMissingTeam: seedResult.gamesSkippedMissingTeam,
        errorCount: seedResult.errors.length,
      };

      if (seedResult.mode === "no-events") {
        return {
          records_updated: 0,
          details: { ...stepDetails, outcome: "no_nhl_today" },
        };
      }
      if (seedResult.errors.length > 0) partial = true;

      // Step 2 — refresh SharpAPI odds for the slate.
      console.log(`[nhl-daily-refresh] step=lines  slateDate=${slateDate}`);
      const linesResult = await refreshNhlLines({
        slateDate,
        sharpApiKey,
        dryRun: false,
        logger: stepLog("lines"),
      });
      stepDetails.lines = {
        mode: linesResult.mode,
        gamesInDb: linesResult.gamesInDb,
        oddsRowsFetched: linesResult.oddsRowsFetched,
        matched: linesResult.matched,
        unmatched: linesResult.unmatched,
        parsed: linesResult.parsed,
        linesWritten: linesResult.linesWritten,
        lineHistoryWritten: linesResult.lineHistoryWritten,
        errorCount: linesResult.errors.length,
      };
      if (linesResult.errors.length > 0) partial = true;

      // Step 3 — write prediction_records for tonight's NHL slate.
      //
      // Two-key gate: NHL_PREDICTIONS_DB_WRITES_ENABLED=true must be set
      // in env, same gate as the operator script. When unset, this step
      // is a no-op so the existing seed+lines behavior is unchanged.
      //
      // Goalie selection: default to "default_most_playoff_gp" (most
      // postseason GP per team). Operator-script manual overrides
      // (--home-goalie / --away-goalie) are not exposed via cron; the
      // operator script remains for one-off corrections.
      //
      // Season derivation: NHL season is start-year (e.g. 2025 for the
      // 2025-26 season). Oct-Dec maps to current year, Jan-Sep to prior.
      let predictionsResult:
        | {
            mode: "dry-run" | "write" | "no-games" | "disabled";
            gamesProcessed: number;
            recordsCreated: number;
            recordsSkippedLocked: number;
            recordsSkippedPass: number;
            errors: string[];
          }
        | undefined;
      if (process.env[NHL_PREDS_ENV] !== "true") {
        predictionsResult = {
          mode: "disabled",
          gamesProcessed: 0,
          recordsCreated: 0,
          recordsSkippedLocked: 0,
          recordsSkippedPass: 0,
          errors: [],
        };
      } else {
        console.log(`[nhl-daily-refresh] step=predictions  slateDate=${slateDate}`);
        try {
          const season = nhlSeasonStartYearFromDate(new Date());
          const wp = await writeNhlPredictionRecords({
            slateDate,
            season,
            apply: true,
            goalieSource: "default_most_playoff_gp",
            logger: stepLog("predictions"),
          });
          predictionsResult = {
            mode: wp.mode,
            gamesProcessed: wp.gamesProcessed,
            recordsCreated: wp.recordsCreated,
            recordsSkippedLocked: wp.recordsSkippedLocked,
            recordsSkippedPass: wp.recordsSkippedPass,
            errors: wp.errors,
          };
          if (wp.errors.length > 0) partial = true;
        } catch (e) {
          // Never let the prediction-write step take down the daily
          // refresh. seed + lines already succeeded; surface as partial.
          partial = true;
          predictionsResult = {
            mode: "write",
            gamesProcessed: 0,
            recordsCreated: 0,
            recordsSkippedLocked: 0,
            recordsSkippedPass: 0,
            errors: [e instanceof Error ? e.message : String(e)],
          };
        }
      }
      stepDetails.predictions = predictionsResult;

      const recordsUpdated =
        seedResult.teamsUpserted +
        seedResult.gamesUpserted +
        linesResult.linesWritten +
        linesResult.lineHistoryWritten +
        (predictionsResult.recordsCreated ?? 0);

      return {
        records_updated: recordsUpdated,
        partial,
        details: stepDetails,
      };
    },
    {
      sport: "nhl",
      leaseGroup: "prediction_pipeline",
      requireLease: true,
      lockMinutes: 10,
    },
  );
}
