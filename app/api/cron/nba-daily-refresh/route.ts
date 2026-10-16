/**
 * Phase 7K Step 4 — NBA daily refresh cron route.
 *
 * Runs the NBA service extractions and publishes the prepared ET board:
 * sports-day:
 *   1. seedNbaGames           → upserts teams + games for the slate.
 *   2. refreshNbaTeamRatings  → scrapes Basketball Reference and
 *                                upserts nba_team_ratings.
 *   3. refreshNbaLines        → fetches SharpAPI /odds for bounded rolling
 *                                game dates, upserts `lines`, and appends
 *                                `line_history`.
 *   4. response snapshot      → computes the existing authoritative member
 *                                DTO and publishes the date readiness key.
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
 *   + a successfully published response snapshot.
 *
 * Scope (unchanged from Services 1–3):
 *   • Writes: teams, games, nba_team_ratings, lines, line_history.
 *   • Reads:  ESPN scoreboard, BBR HTML, SharpAPI /odds, our DB.
 *   • NEVER writes any MLB row. NEVER writes prediction_records /
 *     tracking. Snapshot publication reuses the existing NBA model and
 *     member adapter under the shared NBA prediction lease. NEVER logs keys.
 */

import { cronHandler } from "@/lib/cron/runCron";
import { supabase } from "@/lib/db/supabase";
import { currentSlateDate } from "@/lib/dates/slateDate";
import {
  seedNbaGames,
  type SeedNbaGamesResult,
} from "@/lib/services/nba/seedNbaGamesService";
import { refreshNbaTeamRatings } from "@/lib/services/nba/refreshNbaTeamRatingsService";
import { refreshNbaLines } from "@/lib/services/nba/refreshNbaLinesService";
import { refreshDailyEdgeResponseSnapshot } from "@/lib/services/labResponseSnapshotWriter";
import {
  loadNbaRollingSchedule,
  nbaScheduleSeedDates,
} from "@/lib/services/nba/nbaRollingSchedule";
import { collectNbaProfessionalGameInputs } from "@/lib/services/nba/nbaProfessionalGameInputs";

const NBA_CRON_ENV = "NBA_CRON_ENABLED";
const NBA_DAILY_REFRESH_RELEASE = "nba_daily_refresh_schedule_2026_10_16_r7_rolling_predictions";

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

/** BALLDONTLIE keys an NBA season by its starting calendar year. */
function currentNbaProviderSeason(now: Date): number {
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function recentUtcDates(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    new Date(now.getTime() - index * 86_400_000).toISOString().slice(0, 10));
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
  const intraday = new URL(request.url).searchParams.get("intraday") === "true";
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
            refresh_release: NBA_DAILY_REFRESH_RELEASE,
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
      const balldontlieApiKey = process.env.BALLDONTLIE_API_KEY;
      if (!balldontlieApiKey) {
        throw new Error("BALLDONTLIE_API_KEY missing from env");
      }

      const now = new Date();
      const etDateDashed = currentSlateDate("nba"); // YYYY-MM-DD
      const season = currentNbaRatingsSeason(now);
      const providerSeason = currentNbaProviderSeason(now);

      const stepLog = (label: string) => (msg: string) => {
        console.log(`[nba-daily-refresh:${label}] ${msg}`);
      };

      // Tracks whether any step set partial. Aggregated across all
      // three steps so the wrapper marks the whole run partial when
      // soft failures occur.
      let partial = false;
      const stepDetails: Record<string, unknown> = {
        refresh_release: NBA_DAILY_REFRESH_RELEASE,
        slate_date_et: etDateDashed,
        ratings_season: season,
        provider_season: providerSeason,
        mode: intraday ? "intraday_market" : "daily_full",
      };

      // ─── Step 1: seedNbaGames ─────────────────────────────────────
      const seedDates = nbaScheduleSeedDates(etDateDashed, intraday);
      console.log(
        `[nba-daily-refresh] step=seed  dates=${seedDates.join(",")}  season=${season}`,
      );
      const seedResults: Array<{ date: string; result: SeedNbaGamesResult }> = [];
      for (const seedDate of seedDates) {
        const result = await seedNbaGames({
          dryRun: false,
          dateOverride: dashedToEspnDate(seedDate),
          logger: stepLog(`seed:${seedDate}`),
        });
        seedResults.push({ date: seedDate, result });
        if (result.errors.length > 0) partial = true;
      }
      const currentSeedResult = seedResults.find((entry) => entry.date === etDateDashed)?.result;
      if (!currentSeedResult) {
        throw new Error(`NBA rolling seed omitted current slate date ${etDateDashed}`);
      }
      const seedTotals = seedResults.reduce(
        (total, entry) => ({
          teamsUpserted: total.teamsUpserted + entry.result.teamsUpserted,
          gamesUpserted: total.gamesUpserted + entry.result.gamesUpserted,
        }),
        { teamsUpserted: 0, gamesUpserted: 0 },
      );
      stepDetails.seed = {
        dates: seedResults.map(({ date, result }) => ({
          date,
          mode: result.mode,
          primaryEventsFound: result.primaryEventsFound,
          uniqueEvents: result.uniqueEvents,
          teamsUpserted: result.teamsUpserted,
          gamesUpserted: result.gamesUpserted,
          gamesSkippedMissingTeam: result.gamesSkippedMissingTeam,
          errorCount: result.errors.length,
        })),
        teamsUpserted: seedTotals.teamsUpserted,
        gamesUpserted: seedTotals.gamesUpserted,
      };

      // ─── Step 2: append finalized point-in-time model inputs ──────
      // Full daily runs recover up to seven missed dates even when today's
      // slate is empty. Intraday cycles stay market-only.
      const professionalInputs = intraday
        ? {
            release: "skipped_intraday",
            providerRequests: 0,
            finalGamesFound: 0,
            alreadyStored: 0,
            written: 0,
          }
        : await collectNbaProfessionalGameInputs({
            supabase,
            season: providerSeason,
            dates: recentUtcDates(now, 7),
            apiKey: balldontlieApiKey,
            apply: true,
          });
      stepDetails.professional_game_inputs = professionalInputs;

      // ─── Step 3: refreshNbaTeamRatings ────────────────────────────
      console.log(`[nba-daily-refresh] step=ratings  season=${season}  mode=${intraday ? "skip" : "full"}`);
      const ratingsResult = intraday
        ? {
            mode: "skipped" as const,
            teamsInDb: 0,
            seasonFetchStatus: "skipped" as const,
            seasonRowsParsed: 0,
            playoffFetchStatus: "skipped" as const,
            playoffRowsParsed: 0,
            payloadsBuilt: 0,
            written: 0,
            errors: [] as string[],
          }
        : await refreshNbaTeamRatings({
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
      if (!intraday && ratingsResult.mode === "no-teams") {
        throw new Error("ratings step returned mode=no-teams (no NBA teams resident in DB after seed step)");
      }
      if (!intraday && ratingsResult.seasonFetchStatus === "failed") partial = true;
      if (ratingsResult.errors.length > 0) partial = true;

      // ─── Step 4: refreshNbaLines ──────────────────────────────────
      // The member product is a rolling seven-day analyzed board. A full
      // cycle refreshes every seeded date that actually has games. Intraday
      // stays bounded to the two nearest active game dates in the rolling
      // window so opening prices continue to mature without multiplying a
      // 30-minute run by all seven calendar dates.
      const lineDates = intraday
        ? Array.from(new Set(
            (await loadNbaRollingSchedule(etDateDashed)).games.map((game) => game.slateDate),
          )).sort().slice(0, 2)
        : seedResults
            .filter((entry) => entry.result.mode !== "no-events")
            .map((entry) => entry.date);
      const lineResults: Array<{
        date: string;
        result: Awaited<ReturnType<typeof refreshNbaLines>>;
      }> = [];
      const lineFailures: Array<{ date: string; error: string }> = [];
      for (const lineDate of lineDates) {
        console.log(`[nba-daily-refresh] step=lines  slateDate=${lineDate}`);
        try {
          lineResults.push({
            date: lineDate,
            result: await refreshNbaLines({
              slateDate: lineDate,
              sharpApiKey,
              dryRun: false,
              logger: stepLog(`lines:${lineDate}`),
            }),
          });
        } catch (error) {
          partial = true;
          lineFailures.push({
            date: lineDate,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const lineTotals = lineResults.reduce(
        (total, entry) => ({
          gamesInDb: total.gamesInDb + entry.result.gamesInDb,
          oddsRowsFetched: total.oddsRowsFetched + entry.result.oddsRowsFetched,
          matched: total.matched + entry.result.matched,
          unmatched: total.unmatched + entry.result.unmatched,
          parsed: total.parsed + entry.result.parsed,
          linesWritten: total.linesWritten + entry.result.linesWritten,
          lineHistoryWritten: total.lineHistoryWritten + entry.result.lineHistoryWritten,
          errorCount: total.errorCount + entry.result.errors.length,
        }),
        {
          gamesInDb: 0,
          oddsRowsFetched: 0,
          matched: 0,
          unmatched: 0,
          parsed: 0,
          linesWritten: 0,
          lineHistoryWritten: 0,
          errorCount: 0,
        },
      );
      stepDetails.lines = {
        dates: lineResults.map(({ date, result }) => ({
          date,
          mode: result.mode,
          gamesInDb: result.gamesInDb,
          oddsRowsFetched: result.oddsRowsFetched,
          matched: result.matched,
          unmatched: result.unmatched,
          parsed: result.parsed,
          linesWritten: result.linesWritten,
          lineHistoryWritten: result.lineHistoryWritten,
          errorCount: result.errors.length,
        })),
        failures: lineFailures,
        ...lineTotals,
      };
      if (lineTotals.errorCount > 0) partial = true;

      // The date-keyed response snapshot is the readiness boundary for the
      // 3 AM ET member rollover. A partial source cycle must not replace the
      // prior complete board; the next scheduled run retries the same date.
      const responseSnapshot = partial
        ? null
        : await refreshDailyEdgeResponseSnapshot({
            sport: "nba",
            date: etDateDashed,
            source: "nba_daily_refresh_rolling_board",
          });
      stepDetails.response_snapshot = responseSnapshot ?? {
        skipped: true,
        reason: "incomplete_source_cycle",
      };
      if (responseSnapshot?.ok === false) partial = true;

      // ─── records_updated: tally useful writes only ────────────────
      const recordsUpdated =
        seedTotals.teamsUpserted +
        seedTotals.gamesUpserted +
        ratingsResult.written +
        professionalInputs.written +
        lineTotals.linesWritten +
        lineTotals.lineHistoryWritten +
        (responseSnapshot?.ok ? 1 : 0);

      return {
        records_updated: recordsUpdated,
        partial,
        error_message: responseSnapshot?.ok === false
          ? `NBA response snapshot publish failed: ${responseSnapshot.error ?? "unknown error"}`
          : null,
        details: stepDetails,
      };
    },
    {
      sport: "nba",
      leaseGroup: "prediction_pipeline",
      requireLease: true,
      lockMinutes: 10,
    },
  );
}
