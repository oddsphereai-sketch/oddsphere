/** Deterministic private-storage latency; all DB/model/provider I/O is mocked. */
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import type {SupabaseClient} from '@supabase/supabase-js';
import {nbaAuthorityFixture,nbaAuthorityReview} from './test-player-props-ai-nba-lock-authority';
import {digest} from '../lib/playerPropsAi/evidence';
import {buildPropsSourceContextAudit} from '../lib/playerPropsAi/sourceContextAudit';
import {retainPropsSourceEvidence,verifyPropsSourceEvidence,PROPS_SOURCE_EVIDENCE_LIMITS,PROPS_SOURCE_EVIDENCE_STORAGE_RELEASE} from '../lib/playerPropsAi/sourceEvidenceStore';

globalThis.fetch=async()=>{throw Error('Network forbidden');};
async function main(){
 const original=nbaAuthorityFixture().packet,raw=JSON.stringify(original),review={...nbaAuthorityReview(original),gameId:original.gameId,inputEvidence:{encoding:'gzip-base64' as const,digest:digest(original),bytes:Buffer.byteLength(raw),data:gzipSync(raw).toString('base64')}};
 const packet=structuredClone(original),at='2026-11-10T22:24:00Z';packet.cutoff=at;
 packet.players[0].evidence.push({id:'changed-source-for-storage-control',kind:'availability',source:'synthetic exact-game report',availableAt:at,value:{changed:true}});
 const audit=buildPropsSourceContextAudit({packet,review,observedAt:at});assert(audit.comparisonComplete);
 const before=digest({packet,review,audit}),timeout=AbortSignal.timeout;
 type Options={insertDelay?:number;readDelay?:number;ackDelay?:number;lostAck?:boolean;commitOnAbort?:boolean;corruptAck?:boolean;inventoryFull?:boolean};
 type Result={error:unknown;data?:unknown};
 type Query={select:()=>Query;eq:()=>Query;like:()=>Query;limit:(n:number)=>Query;abortSignal:(signal:AbortSignal)=>Query;maybeSingle:()=>Promise<Result>;insert:(row:{payload:unknown})=>Query;then:(resolve:(v:Result)=>unknown,reject:(e:unknown)=>unknown)=>Promise<unknown>};
 async function run(options:Options={}){
  let now=0,reads=0,inserts=0,inventories=0,prepared=false,payload:unknown;
  const timers:{at:number;controller:AbortController}[]=[],signals:AbortSignal[]=[];
  AbortSignal.timeout=(ms:number)=>{const controller=new AbortController();timers.push({at:now+ms,controller});return controller.signal;};
  const advance=(ms:number)=>{now+=ms;for(const t of timers)if(t.at<=now&&!t.controller.signal.aborted)t.controller.abort(new Error('synthetic deadline'));};
  const client={from:(table:string)=>{assert.equal(table,'lab_response_snapshots');let action='read',signal:AbortSignal;const query:Query={
   select:()=>query,eq:()=>query,like:()=>{action='inventory';return query;},limit:(n:number)=>{assert.equal(n,64);return query;},
   abortSignal:(s:AbortSignal)=>{signal=s;signals.push(s);if(!prepared){prepared=true;advance(1200);}return query;},
   maybeSingle:async()=>{reads++;advance(reads===1?(options.readDelay??700):(options.ackDelay??700));return{error:signal.aborted?{message:'timeout'}:null,data:signal.aborted||!payload?null:{payload}};},
   insert:(row:{payload:unknown})=>{action='insert';payload=structuredClone(row.payload);return query;},
   then:(resolve:(v:Result)=>unknown,reject:(e:unknown)=>unknown)=>{
    if(action==='inventory'){inventories++;advance(700);return Promise.resolve({error:signal.aborted?{message:'timeout'}:null,data:options.inventoryFull?Array(64).fill({snapshot_key:'full'}):[]}).then(resolve,reject);}
    assert.equal(action,'insert');inserts++;advance(options.insertDelay??700);
    if(signal.aborted&&!options.commitOnAbort)payload=undefined;
    if(options.corruptAck&&payload)(payload as {packetHash:string}).packetHash='f'.repeat(64);
    return Promise.resolve({error:signal.aborted||options.lostAck?{message:'unknown acknowledgement'}:null}).then(resolve,reject);
   },
  };return query;}} as unknown as SupabaseClient;
  try{
   const receipt=await retainPropsSourceEvidence({client,writerRunId:'mock-existing-owner',packet,review,audit,observedAt:at});
   assert.equal(digest({packet,review,audit}),before,'Original sources/review/law never mutate');
   return{receipt,reads,inserts,inventories,payload,signals,now};
  }finally{AbortSignal.timeout=timeout;}
 }
 assert.equal(PROPS_SOURCE_EVIDENCE_STORAGE_RELEASE,'player_props_source_evidence_storage_2026_11_17_r2_bounded_ack');
 assert.equal(PROPS_SOURCE_EVIDENCE_LIMITS.writeWindowMs,5000);assert.equal(PROPS_SOURCE_EVIDENCE_LIMITS.reconcileWindowMs,1500);
 const ordinary=await run();assert.equal(ordinary.receipt.status,'retained');assert.equal(ordinary.now,3300);assert.equal(ordinary.reads,1);assert.equal(ordinary.inserts,1);verifyPropsSourceEvidence(ordinary.payload,review);
 const ack=await run({insertDelay:2500,lostAck:true,commitOnAbort:true});assert.equal(ack.receipt.status,'retained');assert.equal(ack.reads,2);assert.equal(ack.inserts,1);assert.notEqual(ack.signals[0],ack.signals.at(-1),'Acknowledgement read owns a fresh bounded signal');verifyPropsSourceEvidence(ack.payload,review);
 const expired=await run({insertDelay:3000,lostAck:true,commitOnAbort:true});assert.equal(expired.receipt.status,'retained');assert(expired.signals[0].aborted);assert(!expired.signals.at(-1)!.aborted);verifyPropsSourceEvidence(expired.payload,review);
 const absent=await run({insertDelay:3000,lostAck:true});assert.equal(absent.receipt.status,'unavailable');assert.equal(absent.reads,2);assert.equal(absent.inserts,1,'No blind second insert');
 const slowAck=await run({insertDelay:3000,lostAck:true,commitOnAbort:true,ackDelay:1600});assert.equal(slowAck.receipt.status,'unavailable');assert.equal(slowAck.reads,2);assert(slowAck.signals.at(-1)!.aborted);
 const corrupt=await run({insertDelay:3000,lostAck:true,commitOnAbort:true,corruptAck:true});assert.equal(corrupt.receipt.status,'unavailable','Fresh ACK cannot accept corrupt source');
 const readFailure=await run({readDelay:6000});assert.equal(readFailure.receipt.status,'unavailable');assert.equal(readFailure.inserts,0);assert.equal(readFailure.reads,1,'No reconciliation without an attempted insert');
 const full=await run({inventoryFull:true});assert.equal(full.receipt.reason,'evidence_context_limit');assert.equal(full.inserts,0,'Window repair never bypasses inventory limit');
 console.log('Evidence storage window PASS: 3300ms bounded admission, original bytes, fresh lost-ACK read, abort/missing/corrupt refusal, no retry insert, no network/model/provider calls.');
}
void main();
