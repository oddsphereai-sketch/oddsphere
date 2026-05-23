/**
 * /api/cron/daily-refresh — runs at 4am ET / 9am UTC (winter; EDT differs).
 *
 * Foundational stats refresh before the day's slate processing begins.
 * Per-sport iteration (cronHandlerPerSport) for sports in season today.
 *
 * For each in-season sport:
 *   1. statsService.refreshPlayers      — roster updates (trades, call-ups)
 *   2. statsService.refreshSeasonStats  — 3 years (Marcel input)
 *   3. statsService.refreshSplits       — vs LHP / vs RHP
 *   4. statsService.refreshPitchStats   — pitcher + hitter pitch-type stats
 *   5. statsService.refreshInjuries     — active injuries snapshot
 *
 * Weather and lines are refreshed by morning-slate (8am ET) — daily-refresh
 * is the slow-changing roster + stats layer only.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { sportsInSeasonToday } from "@/lib/cron/seasons";
import { statsService } from "@/lib/services/statsService";

const SEASON_YEARS = [2024, 2025, 2026];
// Splits / pitch-type stats are snapshotted from the most recent COMPLETE
// season. Mid-season ingestion of in-progress year data is a Phase 7 follow-up.
const SPLITS_SEASON = 2025;

export async function GET(request: Request) {
  return cronHandlerPerSport(
    request,
    "daily_refresh",
    sportsInSeasonToday(),
    async ({ sport }) => {
      let records = 0;
      let apiCalls = 0;

      const players = await statsService.refreshPlayers(sport);
      records += players.records_updated ?? 0;
      apiCalls += players.api_calls_made ?? 0;

      const season = await statsService.refreshSeasonStats(sport, SEASON_YEARS);
      records += season.records_updated ?? 0;
      apiCalls += season.api_calls_made ?? 0;

      const splits = await statsService.refreshSplits(sport, SPLITS_SEASON);
      records += splits.records_updated ?? 0;
      apiCalls += splits.api_calls_made ?? 0;

      const pitch = await statsService.refreshPitchStats(sport, SPLITS_SEASON);
      records += pitch.records_updated ?? 0;
      apiCalls += pitch.api_calls_made ?? 0;

      const injuries = await statsService.refreshInjuries(sport);
      records += injuries.records_updated ?? 0;
      apiCalls += injuries.api_calls_made ?? 0;

      return {
        records_updated: records,
        api_calls_made: apiCalls,
        details: {
          players: players.records_updated,
          season_stats: season.records_updated,
          splits: splits.records_updated,
          pitch_stats: pitch.records_updated,
          injuries: injuries.records_updated,
        },
      };
    }
  );
}

// Vercel cron uses GET; allow POST for manual triggering during dev
export const POST = GET;
