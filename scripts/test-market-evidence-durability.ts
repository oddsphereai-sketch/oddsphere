import assert from "node:assert/strict";
import {observationWriteBatches,MARKET_OBSERVATION_WRITE_MAX_BYTES,MARKET_OBSERVATION_WRITE_MAX_ROWS} from "../lib/services/marketIntelligenceV2/observationWriteBatches";
import {collectOwlsPrices,collectOwlsSplits,writeRows} from "../lib/services/marketIntelligenceV2/shadowSync";
import type {MarketPriceObservationV2,MarketSplitObservationV2} from "../lib/types/domain/MarketIntelligenceV2";

async function main(){
 const source=Array.from({length:1801},(_,i)=>({id:i,text:"校".repeat(170),sourceAt:"2026-11-06T18:00:00.123456Z",missing:null}));
 const batches=[...observationWriteBatches(source)];
 assert.deepEqual(batches.flat(),source);assert(batches.length>4);
 for(const batch of batches){assert(Buffer.byteLength(JSON.stringify(batch))<=MARKET_OBSERVATION_WRITE_MAX_BYTES);assert(batch.length<=MARKET_OBSERVATION_WRITE_MAX_ROWS);}
 assert.throws(()=>[...observationWriteBatches([{raw:"x".repeat(MARKET_OBSERVATION_WRITE_MAX_BYTES)}])],/not truncated/);
 assert.deepEqual([...observationWriteBatches([])],[]);
 const at="2026-11-06T18:00:00Z",hash="a".repeat(64);
 const splits:MarketSplitObservationV2[]=source.map(r=>({canonical_event_id:String(r.id),canonical_market_id:`${r.id}:moneyline`,league:"nba",market_type:"moneyline",selection_key:`${r.id}:moneyline:home`,provider:"owls",source_book:"circa",source_type:"sharp_adjacent_book",bets_pct:.55,money_pct:.65,market_line:null,market_price:-150,split_line_basis:"provider_explicit",books_used:null,provider_event_id:r.text,source_observed_at:at,fetched_at:at,source_timestamp_verified:true,minutes_to_start:60,ingestion_run_id:"proof",raw_payload_hash:hash}));
 const prices:MarketPriceObservationV2[]=source.map(r=>({canonical_event_id:String(r.id),canonical_market_id:`${r.id}:moneyline`,league:"nba",market_type:"moneyline",selection_key:`${r.id}:moneyline:home`,provider:"owls",provider_event_id:r.text,sportsbook:"circa",sharp_book:true,line:null,american_price:-150,decimal_price:1+100/150,no_vig_probability:.58,provider_timestamp:at,fetched_at:at,minutes_to_start:60,ingestion_run_id:"proof",raw_payload_hash:hash}));
 const seen:Record<string,unknown[]>={},requests:number[]=[];let active=0,maxActive=0,checks=0;
 const db={from:(table:string)=>({upsert:async(rows:unknown[],options:any)=>{
  assert.equal(options.ignoreDuplicates,true);
  assert.equal(options.onConflict,table==="market_split_observations_v2"?"provider,source_book,canonical_event_id,canonical_market_id,selection_key,raw_payload_hash,fetched_at":"provider,canonical_market_id,sportsbook,selection_key,line,american_price,provider_timestamp");
  active++;maxActive=Math.max(maxActive,active);await Promise.resolve();
  requests.push(Buffer.byteLength(JSON.stringify(rows)));(seen[table]??=[]).push(...structuredClone(rows));active--;
  return {error:null};
 }})};
 const before=JSON.stringify({splits,prices});
 const result=await writeRows({supabase:db as never,splitObservations:splits,priceObservations:prices,beforeWrite:()=>{checks++;}});
 assert.deepEqual(result,{splitWritten:1801,priceWritten:1801,tableMissing:false,errors:[]});
 assert.deepEqual(seen.market_split_observations_v2,splits);assert.deepEqual(seen.market_price_observations_v2,prices);
 assert.equal(JSON.stringify({splits,prices}),before);assert.equal(maxActive,1);assert.equal(checks,requests.length);
 assert(Math.max(...requests)<=MARKET_OBSERVATION_WRITE_MAX_BYTES);
 let failedCalls=0;
 const failDb={from:()=>({upsert:async()=>({error:++failedCalls===2?{message:"bounded write failure"}:null})})};
 const partial=await writeRows({supabase:failDb as never,splitObservations:splits,priceObservations:[]});
 assert.equal(failedCalls,2);assert(partial.splitWritten>0&&partial.splitWritten<splits.length);assert.equal(partial.errors.length,1);
 let deadlines=0,writes=0;
 await assert.rejects(writeRows({supabase:{from:()=>({upsert:async()=>{writes++;return{error:null};}})} as never,
  splitObservations:splits,priceObservations:[],beforeWrite:()=>{if(++deadlines===2)throw Error("lock deadline passed");}}),/lock deadline/);
 assert.equal(writes,1,"No next batch may begin after the T-60 write deadline");

 // A run-start clock is deliberately older than a provider quote that arrives
 // during that run. The collector must retain the actual response completion.
 const oldNow=new Date(Date.now()-60_000),native=new Date(Date.now()-1000).toISOString(),start=new Date(Date.now()+3600_000).toISOString();
 const event=`nba:Detroit Pistons@New York Knicks-${start.slice(0,10).replaceAll("-","")}`;
 const game={id:1,externalId:77,slateDate:start.slice(0,10),gameDate:start,homeTeamId:1,awayTeamId:2,homeAbbr:"NY",awayAbbr:"DET",homeName:"New York Knicks",awayName:"Detroit Pistons"};
 const originalFetch=globalThis.fetch;let calls=0,responseAt=0;
 globalThis.fetch=async(url)=>{
  calls++;responseAt=Date.now();
  const body=String(url).endsWith("/splits")?{sport:"nba",data:[{event_id:event,home_team:game.homeName,away_team:game.awayName,splits:[{book:"circa",as_of:native,moneyline:{home_price:-150,away_price:130,home_bets_pct:55,away_bets_pct:45,home_handle_pct:65,away_handle_pct:35}}]}],meta:{books:["circa"],total_games:1,status:"complete"}}:
   {success:true,data:{circa:[{eventId:event,sport:"nba",commence_time:start,home_team:game.homeName,away_team:game.awayName,bookmakers:[{key:"circa",last_update:native,markets:[{key:"h2h",outcomes:[{name:game.homeName,price:-150},{name:game.awayName,price:130}]}]}]}]}};
  return new Response(JSON.stringify(body),{status:200});
 };
 try{
  const options={sport:"nba" as const,games:[game],apiKey:"test-never-network",now:oldNow,ingestionRunId:"receipt-proof"};
  const p=await collectOwlsPrices(options);assert.equal(p.observations.length,2);
  for(const row of p.observations){assert(Date.parse(row.fetched_at)>=responseAt);assert.equal(row.provider_timestamp,native);assert(Date.parse(row.fetched_at)>oldNow.getTime());}
  assert.equal(p.details?.receivedAt,p.observations[0].fetched_at);
  const s=await collectOwlsSplits(options);assert.equal(s.observations.length,2);
  for(const row of s.observations){assert(Date.parse(row.fetched_at)>=responseAt);assert.equal(row.source_observed_at,native);assert(row.source_timestamp_verified);}
  assert.equal(s.details?.receivedAt,s.observations[0].fetched_at);assert.equal(calls,2,"No extra provider request is introduced");
 }finally{globalThis.fetch=originalFetch;}
 console.log(JSON.stringify({passed:true,normalizedRows:3602,writeRequests:requests.length,maxWriteBytes:Math.max(...requests),maxConcurrentWrites:maxActive,
  checks:"lossless ordering and native clocks; Unicode byte bound; no dropped polls; exact response availability; partial acknowledgements; unchanged idempotency; per-batch T-60 deadline; no new provider calls"}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
