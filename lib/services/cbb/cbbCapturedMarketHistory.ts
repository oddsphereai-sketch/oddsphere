import { gunzipSync } from "node:zlib";
import type { supabase } from "@/lib/db/supabase";
import { BOOK_DISPLAY_HISTORY_RELEASE, isBookDisplayFeed, type BookDisplayFeed } from "@/lib/providers/owls/owlsBookDisplayHistory";
import type { CbbCapturedNamedSplitFeed } from "./cbbReaderMarketEvidence";

export async function readCbbCapturedNamedSplits(db:typeof supabase):Promise<CbbCapturedNamedSplitFeed|null>{
  const release="owls_current_splits_2026_10_27_r1_complete_named_book";
  const {data,error}=await db.from("lab_response_snapshots").select("payload")
    .eq("snapshot_key",`daily-edge::named-book-current-splits::cbb::${release}`).maybeSingle();
  if(error)throw new Error(`CBB captured named splits unavailable: ${error.message}`);
  let payload=data?.payload;
  if(!payload)return null;
  if(payload.encoding==="gzip-base64")payload=JSON.parse(gunzipSync(Buffer.from(payload.payload,"base64"),{maxOutputLength:32_000_000}).toString());
  if(payload.release!==release||payload.source!=="owls_current_splits"||payload.sport!=="cbb"||
    !Array.isArray(payload.rows)||!payload.rows.every((row:unknown)=>row!==null&&typeof row==="object"&&!Array.isArray(row))||
    !Number.isFinite(Date.parse(payload.fetchedAt)))throw new Error("CBB captured named split receipt is invalid");
  if(payload.rows.length===0)return null;
  return payload as CbbCapturedNamedSplitFeed;
}

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
