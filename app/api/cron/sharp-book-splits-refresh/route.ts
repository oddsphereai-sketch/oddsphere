/**
 * Lightweight provider capture for the member-facing Sharp Book Splits lane.
 *
 * Owl's may publish a complete named-book pair only briefly before a book
 * becomes unavailable. Request-time reads are not a capture schedule, so this
 * route records every supported league at the provider's five-minute cadence.
 * It writes only the durable display feed: no prediction, grade, stake, lock,
 * tracking, or model-owned row is changed here.
 */

import { cronHandlerPerSport } from "@/lib/cron/runCron";
import { refreshOwlsCurrentSplitFallback } from "@/lib/providers/real_api/sharpApiCurrentSplits";
import type { Sport } from "@/lib/types/domain/Sport";

export const maxDuration = 60;

const SPORTS: readonly Sport[] = ["mlb", "wnba", "nhl", "nba", "nfl", "cfb", "cbb"];

export async function GET(request: Request): Promise<Response> {
  return cronHandlerPerSport(
    request,
    "sharp_book_splits_refresh",
    SPORTS,
    async ({ sport }) => {
      if (!process.env.OWLS_INSIGHT_API_KEY) {
        throw new Error("OWLS_INSIGHT_API_KEY is not configured");
      }
      const retainedRows = await refreshOwlsCurrentSplitFallback(sport);
      return {
        records_updated: retainedRows,
        api_calls_made: 1,
        details: { provider: "owls", retainedRows },
      };
    },
    {
      lockMinutes: 2,
      minIntervalMinutes: 4,
    },
  );
}
