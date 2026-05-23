/**
 * /api/cron/post-game-results — runs at 1am ET / 6am UTC (after all games).
 *
 * Two phases in a single cronHandler invocation:
 *   Phase A · per-sport · for each in-season sport:
 *     1. Read yesterday's finished games + box scores (BALLDONTLIE in prod)
 *     2. resultsService.resolveFinishedGames(sport, yesterday, actuals)
 *
 *   Phase B · cross-sport · after all sports resolved:
 *     3. resultsService.refreshTrackingAggregates()    cross-sport refresh
 *     4. resultsService.computeClvForResults()         CLV math
 *
 * V1 mock has no finished-game box scores — Phase A produces 0 results.
 * Phase B still runs over the historical 450 picks and recomputes
 * aggregates + CLV regardless. Production: cron iterates BALLDONTLIE
 * per-sport, assembles actuals, then calls resolveFinishedGames.
 */

import { cronHandler } from "@/lib/cron/runCron";
import { sportsInSeasonToday } from "@/lib/cron/seasons";
import { resultsService } from "@/lib/services/resultsService";
import type { FinishedGameActuals } from "@/lib/services/resultsService";

export const maxDuration = 300;

function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Load actuals for finished games on `date` for a sport. V1 returns empty —
 * mock games never finish. Production hook: query BALLDONTLIE box scores
 * via the stats provider, assemble FinishedGameActuals payload.
 */
async function loadFinishedGameActuals(
  _sport: string,
  _date: string
): Promise<FinishedGameActuals[]> {
  // Phase 7 will implement this when real BALLDONTLIE wires in.
  return [];
}

export async function GET(request: Request) {
  const yesterday = yesterdayUTC();

  return cronHandler(
    request,
    "post_game_results",
    async () => {
      let records = 0;
      const perSport: Record<string, number> = {};

      // Phase A — per-sport resolution
      for (const sport of sportsInSeasonToday()) {
        const actuals = await loadFinishedGameActuals(sport, yesterday);
        const r = await resultsService.resolveFinishedGames(
          sport,
          yesterday,
          actuals
        );
        records += r.records_updated ?? 0;
        perSport[sport] = r.records_updated ?? 0;
      }

      // Phase B — cross-sport aggregation + CLV
      const aggregates = await resultsService.refreshTrackingAggregates();
      records += aggregates.records_updated ?? 0;
      const clv = await resultsService.computeClvForResults();
      records += clv.records_updated ?? 0;

      return {
        records_updated: records,
        api_calls_made: 0,
        details: {
          resolved_per_sport: perSport,
          tracking_aggregates: aggregates.records_updated,
          clv_updated: clv.records_updated,
          clv_silent: (clv.details as { silent_within_30d_or_missing?: number } | undefined)
            ?.silent_within_30d_or_missing,
        },
      };
    }
  );
}

export const POST = GET;
