import { unstable_cache } from "next/cache";
import { OwlsInsightClient } from "@/lib/providers/owls/owlsInsightClient";
import {
  isPredictionMarketFeed, mergePredictionMarketFeeds, parseOwlsPredictionMarkets,
  PREDICTION_MARKET_RELEASE, PREDICTION_MARKET_TARGETS,
  type PredictionMarketFeed, type PredictionMarketSport,
} from "@/lib/providers/owls/owlsPredictionMarkets";
import { readLatestLabResponseSnapshot, upsertLabResponseSnapshot } from "../labResponseSnapshots";
import { backfillKalshiDisplayHistory } from "@/lib/providers/owls/kalshiDisplayHistory";

export function predictionMarketSnapshotKey(sport: PredictionMarketSport): string {
  return `daily-edge::prediction-market-display::${sport}::${PREDICTION_MARKET_RELEASE}`;
}
async function readStored(sport: PredictionMarketSport): Promise<PredictionMarketFeed | null> {
  const stored = await readLatestLabResponseSnapshot<Record<string, unknown>>(predictionMarketSnapshotKey(sport));
  return isPredictionMarketFeed(stored?.payload, sport) ? stored.payload : null;
}
/** Member requests only read a shared stored feed. They never call OWLS. */
export const readPredictionMarketDisplayFeed = unstable_cache(readStored,
  [PREDICTION_MARKET_RELEASE], { revalidate:30, tags:[PREDICTION_MARKET_RELEASE] });

/** Sole capture path: existing five-minute display-feed cron, same sport lease. */
export async function refreshPredictionMarketDisplayFeed(sport: PredictionMarketSport): Promise<number> {
  const key = process.env.OWLS_INSIGHT_API_KEY;
  if (!key) throw new Error("OWLS_INSIGHT_API_KEY is not configured");
  const target = PREDICTION_MARKET_TARGETS[sport];
  const [previous,response] = await Promise.all([
    readStored(sport),
    new OwlsInsightClient(key, {timeoutMs:5000}).get<unknown>(`/api/v2/kalshi/${target.sport}`, {league:target.series}),
  ]);
  const current = parseOwlsPredictionMarkets(response.body, sport);
  if (!current) throw new Error(`Kalshi ${sport} returned an invalid or old source receipt`);
  const captured = await backfillKalshiDisplayHistory(mergePredictionMarketFeeds(previous,current));
  const feed = mergePredictionMarketFeeds(captured,{...captured,rows:[]});
  const stored = await upsertLabResponseSnapshot({ snapshotKey:predictionMarketSnapshotKey(sport),kind:"daily_edge",
    payload:feed as unknown as Record<string, unknown>,ttlMs:5*60_000,staleMs:24*60*60_000,
    sport:sport === "ucl" ? "soccer" : sport,source:"owls_kalshi_display",payloadVersion:PREDICTION_MARKET_RELEASE });
  if (!stored.ok) throw new Error(`Kalshi display receipt could not be stored: ${stored.error}`);
  return current.rows.length;
}
