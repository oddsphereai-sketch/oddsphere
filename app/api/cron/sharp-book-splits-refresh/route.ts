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
import { refreshPredictionMarketDisplayFeed } from "@/lib/services/dailyEdge/predictionMarketDisplayFeed";
import type { PredictionMarketSport } from "@/lib/providers/owls/owlsPredictionMarkets";

export const maxDuration = 120;

const SPORTS: readonly Sport[] = ["mlb", "wnba", "nhl", "nba", "nfl", "cfb", "cbb", "soccer", "ucl"];

export async function GET(request: Request): Promise<Response> {
  return cronHandlerPerSport(
    request,
    "sharp_book_splits_refresh",
    SPORTS,
    async ({ sport }) => {
      if (!process.env.OWLS_INSIGHT_API_KEY) {
        throw new Error("OWLS_INSIGHT_API_KEY is not configured");
      }
      // Isolated display capture only. A Kalshi failure must not block splits.
      const [splitResult,predictionResult] = await Promise.allSettled([
        sport === "soccer" || sport === "ucl" ? Promise.resolve(0) : refreshOwlsCurrentSplitFallback(sport),
        sport === "cbb" ? Promise.resolve(0) : refreshPredictionMarketDisplayFeed(sport as PredictionMarketSport),
      ]);
      if (splitResult.status === "rejected") throw splitResult.reason;
      const retainedRows = splitResult.value;
      const predictionMarketRows = predictionResult.status === "fulfilled" ? predictionResult.value : 0;
      const predictionMarketError = predictionResult.status === "rejected" ? String(predictionResult.reason) : null;
      return {
        records_updated: retainedRows + predictionMarketRows,
        partial: predictionMarketError !== null,
        error_message: predictionMarketError,
        api_calls_made: sport === "cbb" || sport === "soccer" || sport === "ucl" ? 1 : 2,
        details: { provider: "owls", retainedRows, predictionMarketRows, predictionMarketError },
      };
    },
    {
      lockMinutes: 2,
      minIntervalMinutes: 4,
    },
  );
}
