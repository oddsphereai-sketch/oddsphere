import { gunzipSync, gzipSync } from "node:zlib";
import type { PrelockFeed } from "./predictionMarketPrelock";

export const PRELOCK_MARKET_CACHE_RELEASE = "prelock_market_cache_2026_11_05_r2_kind_partition";
export type PrelockMarketKind = "moneyline" | "spread" | "total" | "btts";

/** A chart's existing exact matcher requires this kind. Keep every matching
 * row, checkpoint, unknown field and its order; this is only a read view. */
export function encodePrelockMarketCache(feed: PrelockFeed | null, kind: PrelockMarketKind): string {
  const selected = feed ? { ...feed, rows: feed.rows.filter(row => row.kind === kind) } : null;
  return gzipSync(JSON.stringify(selected)).toString("base64");
}

export function decodePrelockMarketCache(value: string): PrelockFeed | null {
  return JSON.parse(gunzipSync(Buffer.from(value, "base64"), { maxOutputLength: 64_000_000 }).toString());
}
