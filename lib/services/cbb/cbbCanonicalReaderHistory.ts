import {isMissingRpcFunction} from "@/lib/db/missingRpcFunction";
import type { supabase } from "@/lib/db/supabase";
import type { CbbCanonicalPriceRow, CbbCanonicalSplitRow } from "./cbbCanonicalMarketEvidence";

export const CBB_CANONICAL_READER_HISTORY_RELEASE = "cbb_canonical_reader_history_2026_11_05_r3_indexed_price_watermark" as const;
const PAGE_SIZE = 1000;
const MAX_ROWS = 32_000;
const MAX_BYTES = 24_000_000;
const PRICE_FIELDS = "id,provider,provider_event_id,ingestion_run_id,canonical_event_id,canonical_market_id,league,sportsbook,sharp_book,market_type,selection_key,american_price,decimal_price,no_vig_probability,line,provider_timestamp,fetched_at,inserted_at,minutes_to_start,raw_payload_hash";
const SPLIT_FIELDS = "id,provider,provider_event_id,ingestion_run_id,canonical_event_id,canonical_market_id,league,source_book,source_type,market_type,selection_key,bets_pct,money_pct,market_line,market_price,split_line_basis,source_timestamp_verified,source_observed_at,fetched_at,inserted_at,minutes_to_start,raw_payload_hash,books_used";
type Client = typeof supabase;
type Row = CbbCanonicalPriceRow | CbbCanonicalSplitRow;
export type CbbCanonicalHistoryFamilyReceipt = {
  complete: boolean; reason: string; highWaterId: number; lastId: number;
  rows: number; bytes: number; queries: number;
};

/** Same existing canonical tape as the NBA reader, consumed once per slate.
 * This is a bounded observation reader, not another collector or writer.
 * A partial family cannot masquerade as a complete path. */
export async function readCbbCanonicalReaderHistory(args: {
  db: Client; gameIds: number[]; asOf: string; since?: string;
  maxRowsPerFamily?: number; maxBytesPerFamily?: number; budgetMs?: number;
  nowMs?: () => number;
}) {
  const ids = [...new Set(args.gameIds)].sort((a,b)=>a-b);
  const at = Date.parse(args.asOf), since = args.since ?? new Date(at - 6*3600_000).toISOString();
  const floor = Date.parse(since), maxRows = args.maxRowsPerFamily ?? MAX_ROWS;
  const maxBytes = args.maxBytesPerFamily ?? MAX_BYTES, budget = args.budgetMs ?? 20_000;
  if (!Number.isFinite(at) || !Number.isFinite(floor) || floor > at || ids.length > 500 ||
    ids.some(id=>!Number.isSafeInteger(id)||id<=0) || !Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS ||
    !Number.isFinite(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES || !Number.isFinite(budget) || budget < 1 || budget > 30_000) {
    throw new Error("CBB canonical reader scope/budget invalid");
  }
  const now = args.nowMs ?? Date.now, started = now(), deadline = started + budget;
  // The event-indexed maximum is an upper bound for the narrower price/book/
  // availability window below. It must not select observations or confer source
  // authority. Reuse one bounded read for the professional and retail families.
  let priceWatermark: Promise<{data:unknown;error:unknown}> | undefined;
  const priceHigh = () => priceWatermark ??= Promise.resolve(args.db.rpc("market_price_observation_high_water",
    {p_league:"cbb",p_event_ids:ids.map(String)})
    .abortSignal(AbortSignal.timeout(Math.max(1,deadline-now()))));
  const load = async (kind: "price"|"split"|"retail") => {
    const priceFamily=kind!=="split",rowLimit=kind==="retail"?Math.min(maxRows,8000):maxRows;
    const byteLimit=kind==="retail"?Math.min(maxBytes,6_000_000):maxBytes;
    const table = priceFamily ? "market_price_observations_v2" : "market_split_observations_v2";
    const fields = priceFamily ? PRICE_FIELDS : SPLIT_FIELDS;
    const receipt: CbbCanonicalHistoryFamilyReceipt = {complete:false,reason:"not_started",highWaterId:0,lastId:0,rows:0,bytes:0,queries:0};
    const rows: Row[] = [];
    if (!ids.length) return {rows,receipt:{...receipt,complete:true,reason:"empty_scope"}};
    const query = (select: string) => {
      let q = args.db.from(table).select(select).eq("league","cbb").eq("provider","owls")
        .in("canonical_event_id",ids.map(String)).gte("fetched_at",since).lte("inserted_at",args.asOf);
      q = kind === "price" ? q.in("sportsbook",["circa","pinnacle","ps3838","bookmaker"])
        : kind==="retail"?q.in("sportsbook",["draftkings","betmgm"]).gte("fetched_at",new Date(Math.max(floor,at-3*3600_000)).toISOString())
        : q.in("source_book",["circa","draftkings","betmgm"]);
      return q;
    };
    try {
      if (now() >= deadline) return {rows,receipt:{...receipt,reason:"deadline_before_query"}};
      receipt.queries++;
      let highId: number;
      if(priceFamily){
        const high=await priceHigh();
        if(isMissingRpcFunction(high.error as Parameters<typeof isMissingRpcFunction>[0],"market_price_observation_high_water")){
          receipt.queries++;
          const fallback=await query("id").order("id",{ascending:false}).limit(1)
            .abortSignal(AbortSignal.timeout(Math.max(1,deadline-now()))).maybeSingle();
          if(fallback.error)throw fallback.error;
          highId=Number((fallback.data as unknown as {id?:unknown}|null)?.id??0);
        }else{
          if(high.error)throw high.error;
          highId=Number(high.data??0);
        }
      }else{
        const high = await query("id").order("id",{ascending:false}).limit(1)
          .abortSignal(AbortSignal.timeout(Math.max(1,deadline-now()))).maybeSingle();
        if (high.error) throw high.error;
        highId = Number((high.data as unknown as {id?:unknown}|null)?.id ?? 0);
      }
      if (!Number.isSafeInteger(highId) || highId < 0) throw new Error("invalid high-water ID");
      receipt.highWaterId = highId;
      if (!highId) return {rows,receipt:{...receipt,complete:true,reason:"no_observations_in_window"}};
      while (receipt.lastId < highId) {
        if (now() >= deadline) { receipt.reason = "deadline_exceeded"; break; }
        if (rows.length >= rowLimit) {
          // The indexed watermark may belong to another book or time. At an
          // exact row cap, prove the filtered window has no remaining row.
          receipt.queries++;
          const probe=await query("id").gt("id",receipt.lastId).lte("id",highId)
            .order("id",{ascending:true}).limit(1)
            .abortSignal(AbortSignal.timeout(Math.max(1,deadline-now())));
          if(probe.error)throw probe.error;
          receipt.complete=(probe.data??[]).length===0;
          receipt.reason=receipt.complete?"complete_bounded_window":"row_budget_exceeded";
          break;
        }
        receipt.queries++;
        const size = Math.min(PAGE_SIZE,rowLimit-rows.length);
        const page = await query(fields).gt("id",receipt.lastId).lte("id",highId).order("id",{ascending:true}).limit(size)
          .abortSignal(AbortSignal.timeout(Math.max(1,deadline-now())));
        if (page.error) throw page.error;
        const data = (page.data ?? []) as unknown as Row[];
        if (data.some((r,i)=>!Number.isSafeInteger(Number(r.id)) || Number(r.id) <= (i ? Number(data[i-1].id) : receipt.lastId) || Number(r.id)>highId)) {
          throw new Error("non-monotonic canonical observation IDs");
        }
        const bytes = Buffer.byteLength(JSON.stringify(data));
        if (receipt.bytes + bytes > byteLimit) { receipt.reason = "byte_budget_exceeded"; break; }
        rows.push(...data); receipt.rows = rows.length; receipt.bytes += bytes;
        if (data.length) receipt.lastId = Number(data.at(-1)!.id);
        if (data.length < size || receipt.lastId === highId) {
          receipt.complete = true; receipt.reason = "complete_bounded_window"; break;
        }
      }
    } catch (error) { receipt.reason = `read_failed:${error instanceof Error ? error.message : error&&typeof error==="object"&&"message" in error ? String(error.message) : String(error)}`; }
    return {rows,receipt};
  };
  const [price,split] = await Promise.all([load("price"),load("split")]);
  // Context reads cannot consume the professional family's deadline or row
  // budget. Missing retail history never erases a valid professional episode.
  const retail=await load("retail");
  return {release:CBB_CANONICAL_READER_HISTORY_RELEASE,asOf:args.asOf,since,
    sourceWindow:"six_hour_bootstrap_or_explicit_since" as const,
    priceRows:price.rows as CbbCanonicalPriceRow[],splitRows:split.rows as CbbCanonicalSplitRow[],
    retailPriceRows:retail.receipt.complete?retail.rows as CbbCanonicalPriceRow[]:[],retailPrice:retail.receipt,
    price:price.receipt,split:split.receipt,complete:price.receipt.complete&&split.receipt.complete,
    elapsedMs:now()-started,providerRequests:0 as const,databaseWrites:0 as const};
}
