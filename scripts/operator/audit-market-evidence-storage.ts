/** Read-only bounded evidence/retention audit. No provider calls or writes.
 * node --env-file=.env.local --import tsx scripts/operator/audit-market-evidence-storage.ts
 * --out=/absolute/report.json */
import {createHash} from "node:crypto";
import {writeFileSync} from "node:fs";
import {supabase} from "../../lib/db/supabase";
import {decodeCurrentSplitFeedTransport} from "../../lib/providers/real_api/currentSplitFeedTransport";
import {readOriginalCurrentSplitCapture,currentSplitEventDate,splitArchiveState} from "../../lib/providers/real_api/currentSplitObservationArchive";
import type {SharpApiCurrentSplitFeed} from "../../lib/providers/real_api/sharpApiCurrentSplits";

const sports=["cbb","nba","nhl","cfb","nfl","mlb","wnba"] as const;
const release="owls_current_splits_2026_10_27_r1_complete_named_book";
const from=new Date(Date.now()-24*3600_000).toISOString();
const reports:unknown[]=[];
let queries=0,maxResponseBytes=0;
const checked=<T>(data:T)=>{maxResponseBytes=Math.max(maxResponseBytes,Buffer.byteLength(JSON.stringify(data)));return data;};
async function main(){
 for(const sport of sports){
  queries++;
  const hot=await supabase.from("lab_response_snapshots").select("generated_at,payload").eq("snapshot_key",`daily-edge::named-book-current-splits::${sport}::${release}`).maybeSingle();
  if(hot.error)throw Error(`${sport}: current feed read ${hot.error.code}`);
  if(!hot.data){reports.push({sport,status:"no_current_feed"});continue;}
  checked(hot.data);
  const wireBytes=Buffer.byteLength(JSON.stringify(hot.data.payload));
  const feed=(decodeCurrentSplitFeedTransport(hot.data.payload)??hot.data.payload) as SharpApiCurrentSplitFeed;
  if(!feed||!Array.isArray(feed.rows))throw Error(`${sport}: invalid current feed envelope`);
  const state=splitArchiveState(feed),rows=feed.rows as Record<string,unknown>[];
  const groupKeys=new Set(rows.map(r=>`${r.event_id}::${r.sportsbook}`));
  let latestCapture:any=null,captures=0,totalCapturedRows=0,decodedBytes=0,cursor=0,complete=false,earliest:string|null=null;
  for(let page=0;page<20;page++){
   queries++;
   const result=await supabase.from("current_split_capture_archive").select("id,capture_sha256,fetched_at,parts,decoded_bytes,row_count,capture_kind")
    .eq("sport",sport).eq("feed_release",release).eq("part",0).gte("fetched_at",from).gt("id",cursor).order("id").limit(250);
   if(result.error)throw Error(`${sport}: archive metadata read ${result.error.code}`);
   const data=checked(result.data??[]);
   for(const row of data){cursor=Number(row.id);earliest??=row.fetched_at;
    if(!latestCapture||Date.parse(row.fetched_at)>Date.parse(latestCapture.fetched_at))latestCapture=row;
    if(row.capture_kind==="capture"){captures++;totalCapturedRows+=Number(row.row_count);decodedBytes+=Number(row.decoded_bytes);}}
   if(data.length<250){complete=true;break;}
  }
  let originalReceipt:any=null;
  if(latestCapture&&Number(latestCapture.decoded_bytes)<=4_000_000){
   const original=await readOriginalCurrentSplitCapture(supabase,latestCapture.capture_sha256);
   queries+=Number(latestCapture.parts);
   const raw=JSON.parse(original);
   originalReceipt={verified:true,sha256:createHash("sha256").update(original).digest("hex"),decodedBytes:Buffer.byteLength(original),
    rows:raw.rows.length,kind:latestCapture.capture_kind,source:raw.source,fetchedAt:raw.fetchedAt};
  }else if(latestCapture)originalReceipt={verified:false,reason:"capture_exceeds_this_bounded_audit_decode_budget;archive_unchanged"};
  const coldInHot=state?rows.filter(row=>{const date=currentSplitEventDate(row);return date!==null&&date<state.hotFromDate;}).length:null;
  const clocks=rows.reduce<{missingSourceClock:number;missingLocalReceiptClock:number;sourceAfterLocalReceipt:number}>((n,row)=>{
   const native=Date.parse(typeof row.fetched_at==="string"?row.fetched_at:""),received=Date.parse(typeof row._oddsphere_received_at==="string"?row._oddsphere_received_at:"");
   if(!Number.isFinite(native))n.missingSourceClock++;
   if(!Number.isFinite(received))n.missingLocalReceiptClock++;
   if(Number.isFinite(native)&&Number.isFinite(received)&&native>received)n.sourceAfterLocalReceipt++;
   return n;
  },{missingSourceClock:0,missingLocalReceiptClock:0,sourceAfterLocalReceipt:0});
  const observations:any={};
  for(const table of ["market_price_observations_v2","market_split_observations_v2"] as const){
   const columns=table.includes("price")?"id,provider,fetched_at,provider_timestamp,raw_payload_hash":"id,provider,fetched_at,source_observed_at,source_timestamp_verified,raw_payload_hash";
   queries++;
   const sample=await supabase.from(table).select(columns).eq("league",sport).order("id",{ascending:false}).limit(100);
   if(sample.error)throw Error(`${sport}: canonical observation sample ${sample.error.code}`);
   const data=checked(sample.data??[]) as any[];
   observations[table]={sampleRows:data.length,newestFetchedAt:data[0]?.fetched_at??null,
    byProvider:Object.fromEntries([...new Set(data.map(row=>row.provider))].map(provider=>{const sample=data.filter(row=>row.provider===provider);return[provider,{rows:sample.length,missingHashes:sample.filter(row=>!row.raw_payload_hash).length,nativeClockUnavailable:sample.filter(row=>!(row.provider_timestamp??row.source_observed_at)).length}];})),
    sourceAfterReceipt:data.filter(row=>Date.parse(row.provider_timestamp??row.source_observed_at??"")>Date.parse(row.fetched_at)).length,
    missingHashes:data.filter(row=>!row.raw_payload_hash).length,
    nativeClockUnavailable:data.filter(row=>!(row.provider_timestamp??row.source_observed_at)).length,
    scope:"latest_100_rows_not_a_whole_history_certificate"};
  }
  reports.push({sport,generatedAt:hot.data.generated_at,hotWireBytes:wireBytes,hotDecodedBytes:Buffer.byteLength(JSON.stringify(feed)),
   hotRows:rows.length,hotGroups:groupKeys.size,archiveInitialized:!!state,hotFromDate:state?.hotFromDate??null,
   coldRowsInHot:coldInHot,unknownDateHotRows:rows.filter(row=>currentSplitEventDate(row)===null).length,
   metadataGroups:state?Object.keys(state.groupOrders).length:null,metadataColdGroups:state?.coldGroups.length??null,
   clocks,originalReceipt,canonicalSamples:observations,last24Hours:{from,complete,captures,capturedRows:totalCapturedRows,decodedCaptureBytes:decodedBytes,
    earliestAvailableAt:earliest,storageMeaning:"decoded_source_bytes_not_database_disk_or_RAM;baseline_captures_excluded"}});
 }
 const output={generatedAt:new Date().toISOString(),productionWrites:0,providerCalls:0,queries,maxResponseBytes,reports,
  limits:["Samples are bounded, not complete chronology certification.","Archives retain normalized provider payloads; unmapped raw provider fields and events between polls are not claimed.","RAM and retained disk are different budgets. A bounded hot feed does not make permanent storage growth zero.","No old evidence or locked record was corrected, compacted away or deleted."]};
 const out=process.argv.find(x=>x.startsWith("--out="))?.slice(6);if(out)writeFileSync(out,JSON.stringify(output,null,2)+"\n");
 console.log(JSON.stringify(output,null,2));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
