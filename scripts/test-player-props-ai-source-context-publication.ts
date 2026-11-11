/** Actual runtime callback + actual NBA canonical writer/store, synthetic I/O. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
import vm from 'node:vm';
import ts from 'typescript';
import {reviewPropsForSite,type reviewPropsForSite as ReviewFunction} from '../lib/playerPropsAi/siteRuntime';
import {buildPropsSourceContextAudit,type PropsSourceContextAudit} from '../lib/playerPropsAi/sourceContextAudit';
import {digest} from '../lib/playerPropsAi/evidence';
import {nbaAuthorityFixture,nbaAuthorityReview} from './test-player-props-ai-nba-lock-authority';
import {PROPS_AI_CONTROL_RELEASE} from '../lib/playerPropsAi/siteConfig';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {NbaPlayerPropsMemberSnapshot as Snapshot} from '../lib/services/nba/nbaPlayerPropsProductContract';
const at='2026-11-10T22:24:00Z';globalThis.fetch=async()=>{throw Error('Source context publication proof forbids HTTP');};
function archive(packet:GamePacket,review:AcceptedGameReview){const original={...packet,sourceGameId:packet.sourceGameId??packet.gameId,gameId:review.gameId},text=JSON.stringify(original);return{...review,inputHash:digest(original),inputEvidence:{encoding:'gzip-base64' as const,digest:digest(original),bytes:Buffer.byteLength(text),data:gzipSync(text).toString('base64')}};}
async function main(){
const env={site:process.env.PLAYER_PROPS_AI_SITE_ENABLED,paid:process.env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED,key:process.env.PLAYER_PROPS_AI_OPENAI_API_KEY,node:process.env.NODE_ENV};
Object.assign(process.env,{PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'false',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-never-real',NODE_ENV:'test'});
try{
 const packet=nbaAuthorityFixture().packet,review=archive(packet,nbaAuthorityReview(packet));let loads=0,reads=0;const audits:PropsSourceContextAudit[]=[];
 const client={from(table:string){reads++;assert(['player_props_ai_control','player_props_ai_reviews'].includes(table));const q={select(){return q;},eq(){return q;},gte(){return q;},order(){return q;},single:async()=>({data:{release:PROPS_AI_CONTROL_RELEASE,paid_enabled:false},error:null}),limit:async()=>({data:[{result:review}],error:null})};return q;}};
 const outcome=await reviewPropsForSite({client:client as never,sport:'nba',games:[{id:packet.gameId,start:packet.start,home:'NYK',away:'BOS'}],writerRunId:'synthetic',clock:()=>at,
  load:()=>{loads++;return structuredClone(packet);},onSourceAudit:a=>{audits.push(a);},onSourceReady:()=>{assert.equal(audits.length,1);},onReviewObserved:()=>{assert.equal(audits.length,2);}});
 assert.equal(outcome.status,'paid_disabled');assert.equal(loads,2);assert.equal(reads,3,'No extra audit database or source reads');assert.equal(audits.length,2);assert(audits.every(a=>a.currentPacketHash===digest(packet)&&a.review.status==='verified'));assert(outcome.sourceContextAudits?.comparisonComplete);
 // Reuse the shipped isolated actual-writer harness without executing its suite.
 const path='scripts/test-player-props-ai-nba-durable-publication.ts',prefix=readFileSync(path,'utf8').split('async function main(){')[0]+'\nexport {harness,ready,outcome};';
 const javascript=ts.transpileModule(prefix,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const exports:Record<string,unknown>={};vm.runInNewContext(javascript,{module:{exports},exports,require:createRequire(`${process.cwd()}/${path}`),process,Date,Buffer,console,AbortSignal,structuredClone},{filename:'source-audit-actual-writer-harness.cjs'});
 type Harness={packets:GamePacket[];previous:Snapshot;run:(run:(args:Parameters<typeof ReviewFunction>[0])=>Promise<unknown>)=>Promise<unknown>;read:()=>Promise<Snapshot>;review:(p?:GamePacket)=>AcceptedGameReview;setTick:(at:string)=>void;counts:()=>{writes:number}};
 const harness=exports.harness as (options?:{games?:number;previous?:(snapshot:Snapshot)=>Snapshot})=>Harness,ready=exports.ready as (args:Parameters<typeof ReviewFunction>[0],packet:GamePacket,review:AcceptedGameReview)=>Promise<void>;
 const result=exports.outcome;
 const run=async(includeAudit:boolean)=>{const h=harness({previous:snapshot=>({...snapshot,decisions:snapshot.decisions.map((r,i)=>i? r:{...r,lockedAt:'2026-11-10T21:00:00Z'})})});h.setTick(at);const p=h.packets[0],r=archive(p,h.review(p));
  await h.run(async args=>{if(includeAudit)await args.onSourceAudit?.(buildPropsSourceContextAudit({packet:p,review:r,observedAt:at}));await ready(args,p,r);return result;});return{h,snapshot:await h.read()};};
 const plain=await run(false),audited=await run(true);assert.deepEqual(audited.snapshot.decisions,plain.snapshot.decisions,'Audit never changes selected rows, grades, numeric fields or locks');assert.equal(audited.h.counts().writes,plain.h.counts().writes,'Audit adds no canonical writes');assert.deepEqual(audited.snapshot.decisions.find(r=>r.lockedAt),audited.h.previous.decisions.find(r=>r.lockedAt),'Stored lock exact');
 const stored=audited.snapshot.diagnostics.sourceContextAudits;assert(stored?.comparisonComplete);assert.equal(stored.audits.length,1);assert.equal(stored.audits[0].currentPacketHash,digest(audited.h.packets[0]));
 const priorAudit=structuredClone(stored),priorLocks=audited.snapshot.decisions.filter(r=>r.lockedAt);
 await audited.h.run(async()=>result);assert.deepEqual((await audited.h.read()).diagnostics.sourceContextAudits,priorAudit,'An ordinary invocation with no callback keeps the exact prior audit and source clocks');
 audited.h.setTick('2026-11-10T22:31:00Z');await audited.h.run(async()=>result);const afterLock=await audited.h.read();assert.deepEqual(afterLock.diagnostics.sourceContextAudits,priorAudit,'A post-lock invocation retains provenance rather than claiming a fresh source');for(const row of priorLocks)assert.deepEqual(afterLock.decisions.find(r=>r.playerId===row.playerId&&r.market===row.market),row,'Existing locked payload remains exact through provenance retention');
 const two=harness({games:2});two.setTick(at);await two.run(async args=>{for(const p of two.packets){const r=archive(p,two.review(p));await args.onSourceAudit?.(buildPropsSourceContextAudit({packet:p,review:r,observedAt:at}));await ready(args,p,r);}return result;});
 const beforeTwo=(await two.read()).diagnostics.sourceContextAudits!,first=structuredClone(beforeTwo.audits.find(a=>a.gameId===two.packets[0].gameId)!);two.setTick('2026-11-10T22:25:00Z');
 await two.run(async args=>{const p=two.packets[1],r=archive(p,two.review(p));await args.onSourceAudit?.(buildPropsSourceContextAudit({packet:p,review:r,observedAt:'2026-11-10T22:25:00Z'}));await ready(args,p,r);return result;});
 const replaced=(await two.read()).diagnostics.sourceContextAudits!;assert.deepEqual(replaced.audits.find(a=>a.gameId===first.gameId),first,'A new callback replaces only its own game');assert.equal(replaced.audits.find(a=>a.gameId===two.packets[1].gameId)!.observedAt,'2026-11-10T22:25:00Z');
 for(const metadata of [{...stored,release:'unknown'}, {...stored,audits:[{...stored.audits[0],currentPacketHash:'broken'}]}]){const invalid=harness({previous:snapshot=>({...snapshot,diagnostics:{...snapshot.diagnostics,sourceContextAudits:metadata as typeof stored}})});invalid.setTick(at);await invalid.run(async()=>result);const read=await invalid.read();assert.equal(read.diagnostics.sourceContextAuditRetention,'prior_metadata_unavailable');assert.equal(read.diagnostics.sourceContextAudits!.comparisonComplete,false);assert.equal(read.diagnostics.sourceContextAudits!.audits.length,0,'Unknown/malformed prior metadata cannot be retained as source proof');}
 // Withhold a changed actor's accepted review; its actual new source hashes
 // remain durable even though that actor receives no AI publication.
 const h=harness();h.setTick(at);const p=h.packets[0],r=archive(p,h.review(p)),changed=structuredClone(p);changed.players[0].evidence.push({id:'new-own-out',kind:'availability',source:'synthetic current source',availableAt:at,value:{canonicalGameId:p.gameId,scheduledStart:p.start,context:{away:{team:'BOS',known:true,players:[{name:p.players[0].name,status:'out',reportedAt:at}]},home:{team:'NYK',known:true,players:[]}}}});changed.cutoff=at;
 await h.run(async args=>{await args.onSourceAudit?.(buildPropsSourceContextAudit({packet:changed,review:r,observedAt:at}));await args.onSourceReady?.(changed,r,at,true);return result;});
 const withheld=await h.read(),proof=withheld.diagnostics.sourceContextAudits!.audits[0],actor=proof.actors.find(a=>a.actorId===p.players[0].id)!;assert(actor.canonicalChanged&&actor.availabilityChanged&&actor.currentQualification?.blocked);assert(!withheld.decisions.some(row=>row.playerId===p.players[0].id&&row.aiReview));
 console.log('Actual source-context publication passed: runtime audits precede source/member callbacks; exact original archive/actual packet binding; no extra reads/writes; future private canonical reader retains withheld-actor cause; unchanged decisions and exact existing locks.');
}finally{for(const[k,v]of Object.entries({PLAYER_PROPS_AI_SITE_ENABLED:env.site,PLAYER_PROPS_AI_PAID_RUNS_ENABLED:env.paid,PLAYER_PROPS_AI_OPENAI_API_KEY:env.key,NODE_ENV:env.node})){if(v===undefined)Reflect.deleteProperty(process.env,k);else process.env[k]=v;}}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
