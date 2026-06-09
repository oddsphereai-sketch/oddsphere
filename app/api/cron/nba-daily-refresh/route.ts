/**
 * Phase 7K Step 4 — NBA daily refresh cron route.
 *
 * Runs the three NBA service extractions in sequence for today's ET
 * sports-day:
 *   1. seedNbaGames           → upserts teams + games for the slate.
 *   2. refreshNbaTeamRatings  → scrapes Basketball Reference and
 *                                upserts nba_team_ratings.
 *   3. refreshNbaLines        → fetches SharpAPI /odds and upserts
 *                                `lines` + appends `line_history`.
 *
 * Auth: cronHandler validates the CRON_SECRET bearer token. The route
 * also requires NBA_CRON_ENABLED=true in the env. When NOT enabled, the
 * route still hits the cron wrapper (lock + data_refresh_log) but the
 * handler returns success immediately with records_updated=0 and a
 * `disabled: true` detail. This lets us add the Vercel cron entry
 * without firing real writes until the flag is explicitly flipped.
 *
 * Status semantics (mapped to refresh_status in data_refresh_log):
 *   • success  — every step ran without errors.
 *   • partial  — pipeline completed but at least one step reported a
 *                soft failure (BBR season fetch failed; SharpAPI lines
 *                had errors; Service 1 had per-row errors but kept
 *                going). The cron is still considered healthy enough
 *                that the day's data is usable.
 *   • failed   — a hard failure that blocks downstream work:
 *                Service 2 returns mode="no-teams" (no NBA teams
 *                resident, so ratings + lines can't be matched).
 *                Surfaced by throwing from the handler.
 *   • skipped  — another nba_daily_refresh run is already in progress
 *                within the lock window. Wrapper-level behavior.
 *
 * records_updated tallies useful writes only:
 *   teamsUpserted + ratings.written + linesWritten + lineHistoryWritten
 *
 * Scope (unchanged from Services 1–3):
 *   • Writes: teams, games, nba_team_ratings, lines, line_history.
 *   • Reads:  ESPN scoreboard, BBR HTML, SharpAPI /odds, our DB.
 *   • NEVER writes any MLB row. NEVER writes prediction_records /
 *     tracking. NEVER logs SHARPAPI_KEY.
 */

import { cronHandler } from "@/lib/cron/runCron";
import { currentSlateDate } from "@/lib/dates/slateDate";
import { seedNbaGames } from "@/lib/services/nba/seedNbaGamesService";
import { refreshNbaTeamRatings } from "@/lib/services/nba/refreshNbaTeamRatingsService";
import { refreshNbaLines } from "@/lib/services/nba/refreshNbaLinesService";

const NBA_CRON_ENV = "NBA_CRON_ENABLED";

/**
 * NBA-ratings season convention: Basketball Reference uses the END-year
 * of the season (e.g. the 2025-26 season → BBR 2026). Regular season
 * starts in October; from October onward we increment the calendar
 * year to point at the upcoming season's end-year.
 */
function currentNbaRatingsSeason(now: Date): number {
  const utcMonth = now.getUTCMonth(); // 0 = Jan, 9 = Oct
  const utcYear = now.getUTCFullYear();
  return utcMonth >= 9 ? utcYear + 1 : utcYear;
}

/**
 * Convert "YYYY-MM-DD" → "YYYYMMDD" for ESPN's date param. Returns
 * undefined when input doesn't match (defensive — currentSlateDate
 * always returns the dashed form, so this is for type safety).
 */
function dashedToEspnDate(dashed: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(dashed) ? dashed.replace(/-/g, "") : undefined;
}

export async function GET(request: Request): Promise<Response> {
  return cronHandler(
    request,
    "nba_daily_refresh",
    async () => {
      // ─── Gate 1: NBA_CRON_ENABLED env flag ────────────────────────
      // Default off. When unset, the route logs a clean "disabled"
      // success row so we can verify the cron is firing without
      // performing any writes.
      if (process.env[NBA_CRON_ENV] !== "true") {
        return {
          records_updated: 0,
          details: {
            disabled: true,
            reason: `${NBA_CRON_ENV}!=true`,
          },
        };
      }

      // ─── Gate 2: SharpAPI key for Service 3 ───────────────────────
      // Lines refresh needs the key. Missing key → fail the run (this
      // is a config error, not a data condition).
      const sharpApiKey = process.env.SHARPAPI_KEY;
      if (!sharpApiKey) {
        throw new Error("SHARPAPI_KEY missing from env");
      }

      const now = new Date();
      const etDateDashed = currentSlateDate("nba"); // YYYY-MM-DD
      const etDateEspn = dashedToEspnDate(etDateDashed);
      const season = currentNbaRatingsSeason(now);

      const stepLog = (label: string) => (msg: string) => {
        console.log(`[nba-daily-refresh:${label}] ${msg}`);
      };

      // Tracks whether any step set partial. Aggregated across all
      // three steps so the wrapper marks the whole run partial when
      // soft failures occur.
      let partial = false;
      const stepDetails: Record<string, unknown> = {
        slate_date_et: etDateDashed,
        ratings_season: season,
      };

      // ─── Step 1: seedNbaGames ─────────────────────────────────────
      console.log(
        `[nba-daily-refresh] step=seed  date=${etDateDashed}  season=${season}`,
      );
      const seedResult = await seedNbaGames({
        dryRun: false,
        dateOverride: etDateEspn,
        logger: stepLog("seed"),
      });
      stepDetails.seed = {
        mode: seedResult.mode,
        primaryEventsFound: seedResult.primaryEventsFound,
        uniqueEvents: seedResult.uniqueEvents,
        teamsUpserted: seedResult.teamsUpserted,
        gamesUpserted: seedResult.gamesUpserted,
        gamesSkippedMissingTeam: seedResult.gamesSkippedMissingTeam,
        errorCount: seedResult.errors.length,
      };

      // No NBA today → clean success exit. Ratings + lines have
      // nothing to attach to; no point firing the BBR scrape or
      // SharpAPI hit.
      if (seedResult.mode === "no-events") {
        return {
          records_updated: 0,
          details: {
            ...stepDetails,
            outcome: "no_nba_today",
          },
        };
      }
      if (seedResult.errors.length > 0) partial = true;

      // ─── Step 2: refreshNbaTeamRatings ────────────────────────────
      console.log(
        `[nba-daily-refresh] step=ratings  season=${season}  include_playoffs=true`,
      );
      const ratingsResult = await refreshNbaTeamRatings({
        season,
        includePlayoffs: true,
        dryRun: false,
        logger: stepLog("ratings"),
      });
      stepDetails.ratings = {
        mode: ratingsResult.mode,
        teamsInDb: ratingsResult.teamsInDb,
        seasonFetchStatus: ratingsResult.seasonFetchStatus,
        seasonRowsParsed: ratingsResult.seasonRowsParsed,
        playoffFetchStatus: ratingsResult.playoffFetchStatus,
        playoffRowsParsed: ratingsResult.playoffRowsParsed,
        payloadsBuilt: ratingsResult.payloadsBuilt,
        written: ratingsResult.written,
        errorCount: ratingsResult.errors.length,
      };

      // Hard failure: no NBA teams in DB. Service 1 should have just
      // populated them; if Service 2 still sees zero, something is
      // structurally wrong.
      if (ratingsResult.mode === "no-teams") {
        throw new Error("ratings step returned mode=no-teams (no NBA teams resident in DB after seed step)");
      }
      if (ratingsResult.seasonFetchStatus === "failed") partial = true;
      if (ratingsResult.errors.length > 0) partial = true;

      // ─── Step 3: refreshNbaLines ──────────────────────────────────
      console.log(`[nba-daily-refresh] step=lines  date=${etDateDashed}`);
      const linesResult = await refreshNbaLines({
        date: etDateDashed,
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

      // ─── records_updated: tally useful writes only ────────────────
      const recordsUpdated =
        seedResult.teamsUpserted +
        seedResult.gamesUpserted +
        ratingsResult.written +
        linesResult.linesWritten +
        linesResult.lineHistoryWritten;

      return {
        records_updated: recordsUpdated,
        partial,
        details: stepDetails,
      };
    },
    { sport: "nba" },
  );
}
