import { gunzipSync } from "node:zlib";
import type { supabase } from "@/lib/db/supabase";
import { BOOK_DISPLAY_HISTORY_RELEASE, isBookDisplayFeed, type BookDisplayFeed } from "@/lib/providers/owls/owlsBookDisplayHistory";

/** Read the existing collector's tape. No provider call or additional writer. */
export async function readCbbCapturedMarketHistory(db: typeof supabase): Promise<BookDisplayFeed | null> {
  const { data, error } = await db.from("lab_response_snapshots").select("payload")
    .eq("snapshot_key", `daily-edge::prediction-market-books::cbb::${BOOK_DISPLAY_HISTORY_RELEASE}`).maybeSingle();
  if (error) throw new Error(`CBB captured history unavailable: ${error.message}`);
  let payload = data?.payload;
  if (!payload) return null;
  if (payload.encoding === "gzip-base64") payload = JSON.parse(gunzipSync(Buffer.from(payload.payload, "base64"), { maxOutputLength: 32_000_000 }).toString());
  if (!isBookDisplayFeed(payload, "cbb")) throw new Error("CBB captured history receipt is invalid");
  return payload;
}
