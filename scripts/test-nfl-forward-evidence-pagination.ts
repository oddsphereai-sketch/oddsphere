import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE, NFL_FORWARD_EVIDENCE_PREVIOUS_SCHEMA_RELEASE,
  NFL_FORWARD_EVIDENCE_PRIOR_SCHEMA_RELEASE, NFL_FORWARD_EVIDENCE_LEGACY_SCHEMA_RELEASE,
  hashNflForwardEvidencePayload, type NflForwardEvidencePayload } from "../lib/services/football/nflForwardEvidence";
import { NFL_FORWARD_EVIDENCE_PAGE_SIZE, NFL_FORWARD_EVIDENCE_MAX_ROWS_PER_RELEASE,
  readNflForwardEvidence, readPreviousNflForwardEvidence, readPriorNflForwardEvidence,
  readLegacyNflForwardEvidence, appendNflForwardEvidence } from "../lib/services/football/nflForwardEvidenceStore";

function freeze<T>(value:T):T {
  if(value&&typeof value==="object"){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;
}
function rows(count:number,release:string){return Array.from({length:count},(_,i)=>{
 const capturedAt=new Date(Date.UTC(2026,9,27,4,0,i)).toISOString();
 const payload=freeze({schemaRelease:release,collectorRelease:"stored-collector",season:2026,week:8,
  stage:"t60",capturedAt,cutoffAt:capturedAt,game:{providerGameId:`game-${i%13}`,scheduledStart:"2026-10-28T00:00:00.000Z",away:{abbreviation:"AWAY"},home:{abbreviation:"HOME"}},
  coverage:{currentOdds:true},storedLockedValues:{probability:0.6123,line:-3.5,price:-108,stake:1.25,pick:"original",grade:"stored-grade",opaqueLegacy:{nullable:null,empty:[],zero:0}}}) as unknown as NflForwardEvidencePayload;
 return freeze({id:String(i).padStart(6,"0"),provider_game_id:payload.game.providerGameId,stage:payload.stage,captured_at:capturedAt,game_start_at:payload.game.scheduledStart,payload_sha256:hashNflForwardEvidencePayload(payload),payload});
});}
function clientFor(source:ReturnType<typeof rows>,release:string,failAt=-1){
 const ranges:number[][]=[];const filters:unknown[][]=[];
 const client={from(table:string){assert.equal(table,"nfl_forward_evidence_snapshots");const order:string[]=[];
  const q={select(s:string){assert.equal(s,"id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload");return q;},
   eq(k:string,v:unknown){filters.push([k,v]);return q;},
   order(k:string,v:{ascending:boolean}){assert(v.ascending);order.push(k);return q;},
   async range(a:number,b:number){assert.deepEqual(order,["captured_at","id"]);assert.equal(b-a+1,NFL_FORWARD_EVIDENCE_PAGE_SIZE);ranges.push([a,b]);return a===failAt?{data:null,error:{message:"injected timeout"}}:{data:source.slice(a,b+1),error:null};}};return q;
 }} as unknown as SupabaseClient;
 return {client,ranges,filters,verify(){for(let i=0;i<filters.length;i+=3)assert.deepEqual(filters.slice(i,i+3),[["evidence_release",release],["season",2026],["week",8]]);}};
}
async function main(){
 assert.equal(NFL_FORWARD_EVIDENCE_PAGE_SIZE,50);assert.equal(NFL_FORWARD_EVIDENCE_MAX_ROWS_PER_RELEASE,5000);
 for(const[read,release]of [[readNflForwardEvidence,NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE],[readPreviousNflForwardEvidence,NFL_FORWARD_EVIDENCE_PREVIOUS_SCHEMA_RELEASE],[readPriorNflForwardEvidence,NFL_FORWARD_EVIDENCE_PRIOR_SCHEMA_RELEASE],[readLegacyNflForwardEvidence,NFL_FORWARD_EVIDENCE_LEGACY_SCHEMA_RELEASE]] as const){
  for(const count of [0,49,50,51,251,4999,5000]){
   const source=rows(count,release),mock=clientFor(source,release);
   const run=()=>read({client:mock.client,season:2026,week:8});
   if(count===5000)await assert.rejects(run,/bounded 5000-row release limit/);
   else{const actual=await run();assert.equal(actual.length,count);for(let i=0;i<count;i++){assert.equal(actual[i]!.id,source[i]!.id);assert.equal(actual[i]!.payload,source[i]!.payload,"exact stored locked object takes precedence");assert.equal(actual[i]!.payloadSha256,source[i]!.payload_sha256);}}
   mock.verify();mock.ranges.forEach(([a],i)=>assert.equal(a,i*50));assert(mock.ranges.at(-1)![1]<5000);
  }
 }
 const source=rows(51,NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE),failure=clientFor(source,NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,50);
 await assert.rejects(readNflForwardEvidence({client:failure.client,season:2026,week:8}),/injected timeout/);
 const corrupt=source.map((r,i)=>i===50?{...r,payload_sha256:"0".repeat(64)}:r),bad=clientFor(corrupt,NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE);
 await assert.rejects(readNflForwardEvidence({client:bad.client,season:2026,week:8}),/checksum mismatch/);
 let inserts=0;const writer={from(){return {insert(values:unknown[]){inserts++;assert.equal(values.length,1);return {async select(){return {data:[{id:"new"}],error:null};}};},update(){throw new Error("locked update forbidden");},upsert(){throw new Error("locked replacement forbidden");},delete(){throw new Error("locked deletion forbidden");}};}} as unknown as SupabaseClient;
 const payload=source[0]!.payload,oldHash=hashNflForwardEvidencePayload(payload);
 await appendNflForwardEvidence({client:writer,runId:"append-only-proof",payloads:[payload],apply:true});
 assert.equal(inserts,1);assert.equal(hashNflForwardEvidencePayload(payload),oldHash);
 console.log("NFL pagination: all 4 releases, boundary-complete chronology, unchanged ceiling, original locked values/hashes, error/corruption rejection and append-only writer PASS");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
