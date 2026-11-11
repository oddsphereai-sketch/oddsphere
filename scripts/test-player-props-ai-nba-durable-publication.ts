import * as completionWindow from '../lib/playerPropsAi/completionWindow';
/** Actual shipped NBA writer + canonical codec/reader + lock/tracking, mocked I/O.
 * No environment files, provider HTTP, real SQL or paid calls are permitted. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as nbaSourceIdentity from '../lib/playerPropsAi/nbaSourceIdentity';
import * as evidence from '../lib/playerPropsAi/evidence';
import * as bindings from '../lib/playerPropsAi/siteBindings';
import * as publication from '../lib/playerPropsAi/publication';
import * as sourceContextAudit from '../lib/playerPropsAi/sourceContextAudit';
import * as authority from '../lib/playerPropsAi/nbaLockAuthority';
import * as lifecycle from '../lib/services/nba/nbaPlayerPropsLifecycle';
import * as product from '../lib/services/nba/nbaPlayerPropsProductContract';
import * as store from '../lib/services/nba/nbaPlayerPropsPrivateStore';
import * as tracking from '../lib/services/nba/nbaPlayerPropsPrivateTrackingStore';
import {attachCapturedNbaParticipationReports,type CapturedNbaParticipationReport} from '../lib/playerPropsAi/participationEligibility';
import {PROPS_AI_NBA_CURRENT_SOURCE_RELEASE} from '../lib/playerPropsAi/nbaSourceIdentity';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {reviewPropsForSite} from '../lib/playerPropsAi/siteRuntime';
import type {refreshNbaPlayerPropsPrivateCandidate} from '../lib/services/nba/nbaPlayerPropsPrivateWriter';
import {nbaAuthorityFixture,nbaAuthorityReview} from './test-player-props-ai-nba-lock-authority';

globalThis.fetch=async()=>{throw Error('Durable NBA proof forbids HTTP');};
type Snapshot=product.NbaPlayerPropsMemberSnapshot;
type ReviewArgs=Parameters<typeof reviewPropsForSite>[0];
type RecordRow={snapshot_key:string;payload:unknown;generated_at:string};
const initial='2026-11-10T22:24:00.000Z',completed='2026-11-10T22:26:00.000Z',after='2026-11-10T22:30:01.000Z',slateDate='2026-11-10';
const weights=[1,4,5,...Array(13).fill(0)];
const fail=()=>{throw Error('injected_unrelated_game_timeout_after_ready');};
const outcome={status:'active',games:[],findings:[]};
function harness(options:{games?:number;staggered?:boolean;emptyLive?:boolean;emptyGameIds?:string[];findings?:string[];allOut?:boolean;previous?:(snapshot:Snapshot,packets:GamePacket[])=>Snapshot}={}){
 let emptyLive=options.emptyLive??false;
 let tick=initial,writes=0,rpcs=0,activeWrites=0,maxActiveWrites=0;
 const packets=Array.from({length:options.games??1},(_,i)=>{
  const f=nbaAuthorityFixture(initial),id=`nba-bdl:${i+1}`,ids=new Map([['a',`nba-bdl-player:${i*2+1}`],['b',`nba-bdl-player:${i*2+2}`]]);
  return{...f.packet,gameId:id,sourceInputRelease:PROPS_AI_NBA_CURRENT_SOURCE_RELEASE,sourceOfferSetStatus:'nonempty' as const,players:f.packet.players.map(p=>({...p,id:ids.get(p.id)!})),quotes:f.packet.quotes.map(q=>({...q,id:`${id}:${q.id}`,playerId:ids.get(q.playerId)!})),executionQuotes:f.packet.executionQuotes!.map(q=>({...q,id:`${id}:${q.id}`,playerId:ids.get(q.playerId)!}))};
 });
 if(options.staggered)for(let i=1;i<packets.length;i++){packets[i].start=new Date(Date.parse(packets[i].start)+i*7200000).toISOString();packets[i].lock=new Date(Date.parse(packets[i].lock)+i*7200000).toISOString();}
 const nativeRows=packets.flatMap((p,i)=>[nbaAuthorityFixture(initial).row('a'),nbaAuthorityFixture(initial).row('a','rebounds')].map(r=>({...r,decisionKey:`${p.gameId}:${r.decisionKey}`,gameId:p.gameId,scheduledStart:p.start,playerId:`nba-bdl-player:${i*2+1}`})));
 const games=packets.map(p=>({gameId:p.gameId,scheduledStart:p.start,homeTeam:'NYK',awayTeam:'BOS'}));
 const baseline=product.buildNbaPlayerPropsMemberSnapshot({mode:'private_forward_candidate',generatedAt:initial,slateDate,games,decisions:nativeRows,inputRows:6*packets.length});
 const previous=options.previous?.(baseline,packets)??baseline;
 const records=new Map<string,RecordRow>([[store.nbaPlayerPropsCandidateSnapshotKey(slateDate),{snapshot_key:store.nbaPlayerPropsCandidateSnapshotKey(slateDate),payload:store.encodeNbaPlayerPropsPrivatePayload(previous,'candidate_snapshot'),generated_at:previous.generatedAt}]]);
 const persisted:Snapshot[]=[];
 const observations=packets.flatMap(p=>p.quotes.map(q=>({canonicalGameId:p.gameId,canonicalPlayerId:q.playerId,providerPlayerId:q.playerId.split(':').at(-1),playerName:p.players.find(a=>a.id===q.playerId)!.name,playerTeam:'1',market:q.market,line:q.line,side:q.side,sportsbook:q.book,americanPrice:q.american,observedAt:q.observedAt,receivedAt:q.receivedAt,fetchedAt:q.receivedAt,provider:q.provider,isOpening:false,isLive:false})));
 const state={games:Array(100).fill({}),boxes:Array(500).fill({}),advanced:[],players:packets.flatMap(p=>p.players.map(a=>({playerId:Number(a.id.split(':').at(-1)),playerName:a.name,latestTeamId:1})))};
 let runtime:(args:ReviewArgs)=>Promise<unknown>=async()=>outcome;
 let delayWrite:(record:RecordRow)=>Promise<void>=async()=>{};
 let delayTrackingRead:()=>Promise<void>=async()=>{};
 const client={from(table:string){assert.equal(table,'lab_response_snapshots');let key:string|null=null;const q={select(){return q;},eq(field:string,value:string){if(field==='snapshot_key')key=value;return q;},like(){return q;},order(){return q;},limit:async()=>({data:[],error:null}),maybeSingle:async()=>{if(key?.includes("player-props-private-tracking"))await delayTrackingRead();return{data:key?records.get(key)??null:null,error:null};},upsert:async(row:RecordRow)=>{records.set(row.snapshot_key,structuredClone(row));return{error:null};}};return q;},async rpc(name:string,args:{p_record:RecordRow;p_expected_checksum:string|null;p_admit_before:string|null;p_source_cutoff:string|null;p_writer_run:string}){
  assert.equal(name,'publish_nba_player_props_private_snapshot_v1');assert.equal(args.p_writer_run,'synthetic-lease-owner');rpcs++;
  const current=records.get(args.p_record.snapshot_key)?.payload as {checksum:string}|undefined;
  if((current?.checksum??null)!==args.p_expected_checksum)return{data:{written:false,status:'superseded'},error:null};
  if(args.p_admit_before&&(Date.parse(tick)>=Date.parse(args.p_admit_before)||Date.parse(args.p_source_cutoff!)>Date.parse(tick)))return{data:{written:false,status:'publication_window_closed'},error:null};
  const admitted=tick;activeWrites++;maxActiveWrites=Math.max(maxActiveWrites,activeWrites);
  try{await delayWrite(args.p_record);
   if(args.p_admit_before&&Date.parse(tick)>=Date.parse(args.p_admit_before))return{data:{written:false,status:'publication_window_closed'},error:null};
   records.set(args.p_record.snapshot_key,structuredClone(args.p_record));writes++;
   const snapshot=store.decodeNbaPlayerPropsPrivatePayload<Snapshot>(args.p_record.payload,'candidate_snapshot');assert(snapshot);persisted.push(snapshot);
   return{data:{written:true,status:'written',checksum:(args.p_record.payload as {checksum:string}).checksum,server_admitted_at:admitted,server_write_completed_at:tick},error:null};
  }finally{activeWrites--;}
 }};
 const modules:Record<string,unknown>={completionWindow,sourceContextAudit,
  nbaSourceIdentity,evidence,siteBindings:bindings,publication,nbaPlayerPropsLifecycle:lifecycle,nbaPlayerPropsProductContract:product,
  nbaLockAuthority:{...authority,observeNbaSourceAuthority:authority.testNbaSourceAuthority(()=>tick),captureNbaHandoffBundle:authority.testNbaHandoffCapture(()=>tick)},
  siteConfig:{propsAiSiteConfig:()=>({integrated:true})},espnNbaInjuries:{canonicalNbaAbbreviation:(s:string)=>s,fetchEspnNbaGameInjuries:async(id:string|number)=>options.allOut?{eventId:String(id),teams:new Map([['BOS',[{name:'Synthetic a',status:'out',reported_at:null},{name:'Synthetic b',status:'out',reported_at:null}]],['NYK',[]]])}:null},nbaPlayerPropsSettlementStore:{},
  nbaPlayerPropsCurrentState:{readNbaPlayerPropsCurrentState:async()=>state},
  nbaPlayerPropsLiveCollector:{collectNbaPlayerPropsLiveMarket:async()=>({observations:emptyLive?[]:observations.filter(q=>!options.emptyGameIds?.includes(q.canonicalGameId)),games:packets.map((p,i)=>({canonicalGameId:p.gameId,providerGameId:String(i+1),scheduledStart:p.start,homeTeam:'NYK',awayTeam:'BOS'})),teamIdsByGame:Object.fromEntries(packets.map(p=>[p.gameId,{home:2,away:1}])),providerRequests:{balldontlie:0,theOddsApi:0,owls:0},theOddsApiCreditsUsed:0,findings:options.findings??[]})},
  nbaPlayerPropsPrivateStore:{...store,writeNbaPlayerPropsMarketHistory:async()=>{},readNbaPlayerPropsMarketHistory:async()=>null,mergeNbaPlayerPropsMarketHistory:()=>({history:{release:'synthetic',observations},added:0,refreshed:0,conflicts:0})},
  nbaPlayerPropsPointInTimeFeatures:{buildNbaPlayerPropsPointInTimeFeatures:()=>packets.flatMap((_,i)=>[1,2].map(n=>({game_id:i+1,player_id:i*2+n,team_id:1,player_name:n===1?'Synthetic a':'Synthetic b'})))},
  nbaPlayerPropsFrozenRuntime:{buildNbaPlayerPropsForwardDecisions:()=>emptyLive||options.allOut?[]:nativeRows.filter(r=>!options.emptyGameIds?.includes(r.gameId)).map(r=>({...r,release:'synthetic',gameId:Number(r.gameId.split(':').at(-1)),playerId:Number(r.playerId.split(':').at(-1)),finalProjection:r.projection}))},
  nbaPlayerPropsMovement:{selectNbaPlayerPropsMovementTarget:(args:{observations:typeof observations;sportsbook:string;side:string})=>args.observations.find(q=>q.sportsbook===args.sportsbook&&q.side===args.side),buildNbaPlayerPropsSameBookMovement:()=>null},
  nbaPlayerPropsReaderContract:{buildNbaPlayerPropsReaderEvidence:()=>({role:[],production:[],matchup:[]})},
  nbaPlayerPropsMemberPrices:{buildNbaPlayerPropsMemberPrices:(args:{target:typeof observations[number]})=>observations.filter(q=>q.canonicalPlayerId===args.target.canonicalPlayerId&&q.market===args.target.market).map(q=>({sportsbook:q.sportsbook,line:q.line,side:q.side,americanPrice:q.americanPrice,observedAt:q.observedAt}))},
  nbaPlayerPropsPrivateTrackingStore:tracking,
  siteRuntime:{reviewPropsForSite:(args:ReviewArgs)=>runtime(args)},liveSources:{liveNbaPacket:(args:{game:{id:string};participationReports:CapturedNbaParticipationReport[]})=>{const packet=packets.find(p=>p.gameId===args.game.id)!;return options.allOut?attachCapturedNbaParticipationReports(structuredClone(packet),args.participationReports):packet;}},
 };
 class Clock extends Date{constructor(value?:string|number){super(value??tick);}static now(){return Date.parse(tick);}}
 const exports={};const javascript=ts.transpileModule(readFileSync('lib/services/nba/nbaPlayerPropsPrivateWriter.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(javascript,{module:{exports},exports,Date:Clock,console,require:(request:string)=>{const name=request.split('/').at(-1)!;assert(Object.hasOwn(modules,name),`Unmocked dependency ${request}`);return modules[name];}},{filename:'actual-nba-durable-writer-under-offline-test.cjs'});
 const writer=(exports as {refreshNbaPlayerPropsPrivateCandidate:typeof refreshNbaPlayerPropsPrivateCandidate}).refreshNbaPlayerPropsPrivateCandidate;
 const run=(review:(args:ReviewArgs)=>Promise<unknown>)=>{runtime=review;return writer({client:client as unknown as Parameters<typeof writer>[0]['client'],writerRunId:'synthetic-lease-owner',slateDate,season:2026,schedule:packets.map((p,i)=>({id:`schedule-${i}`,externalId:i+1,gameStartAt:p.start,slateDate,status:'STATUS_SCHEDULED',homeTeam:'NYK',homeTeamDisplayName:'New York',homeTeamLogo:'',awayTeam:'BOS',awayTeamDisplayName:'Boston',awayTeamLogo:'',venue:null})),ballDontLieApiKey:'synthetic-not-real',fullRefresh:false,now:tick,fetchImpl:globalThis.fetch});};
 const read=async()=>{const snapshot=await store.readNbaPlayerPropsPrivateSnapshot({client:client as unknown as Parameters<typeof store.readNbaPlayerPropsPrivateSnapshot>[0]['client'],slateDate});assert(snapshot);return snapshot;};
 return{run,read,packets,baseline,previous,records,persisted,client,setEmptyLive:(value:boolean)=>{emptyLive=value;},setTick:(value:string)=>{tick=value;},delay:(fn:typeof delayWrite)=>{delayWrite=fn;},delayTracking:(fn:()=>Promise<void>)=>{delayTrackingRead=fn;},counts:()=>({writes,rpcs,maxActiveWrites}),refreshSource:(at:string)=>{for(const packet of packets){packet.cutoff=at;for(const q of [...packet.quotes,...packet.executionQuotes!]){q.observedAt=at;q.receivedAt=at;}}for(const q of observations){q.observedAt=at;q.receivedAt=at;q.fetchedAt=at;}},review:(packet:GamePacket=packets[0],values=weights)=>nbaAuthorityReview(packet,values,tick)};
}
async function ready(args:ReviewArgs,packet:GamePacket,review:AcceptedGameReview){await args.onReviewObserved?.(packet,review,true);await args.onReviewReady?.(packet,review);}
const empty=(packet:GamePacket,at=completed):GamePacket=>({...structuredClone(packet),cutoff:at,sourceOfferSetStatus:'empty',executionQuotes:[]});
async function main(){
 const beforeEnv=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'test'});
 try{
  // Negative prefix proof is separately frozen at /private/tmp before editing.
  // Fault after ready: canonical row values must already exist when sibling dies.
  const fault=harness();await assert.rejects(fault.run(async args=>{fault.setTick(completed);const review=fault.review();await ready(args,fault.packets[0],review);assert.equal((await fault.read()).decisions.filter(r=>r.aiReview).length,3);fail();}),/injected_unrelated/);
  const beforeLock=await fault.read();assert.equal(beforeLock.decisions.length,3);assert(beforeLock.decisions.every(r=>r.aiReview&&r.lockedAt===null));
  fault.setTick(after);await fault.run(async()=>outcome);
  const locked=await fault.read();assert.equal(locked.decisions.length,3);for(const row of locked.decisions){const old=beforeLock.decisions.find(r=>r.playerId===row.playerId&&r.market===row.market)!;assert.deepEqual({...row,lockedAt:null},old);assert.equal(row.lockedAt,new Date(fault.packets[0].lock).toISOString());}
  const tracked=await tracking.readNbaPlayerPropsPrivateTracking({client:fault.client as unknown as Parameters<typeof tracking.readNbaPlayerPropsPrivateTracking>[0]['client'],season:2026,slateDate});assert.equal(tracked?.rows.length,3);
  // Staggered ordinary game callbacks must latch already-due canonical
  // locks before another game's write advances the shared slate header.
  const staggered=harness({games:2,staggered:true});let firstGameRows:Snapshot['decisions']=[];
  await assert.rejects(staggered.run(async args=>{staggered.setTick(completed);await ready(args,staggered.packets[0],staggered.review(staggered.packets[0]));firstGameRows=(await staggered.read()).decisions.filter(r=>r.gameId===staggered.packets[0].gameId);staggered.setTick('2026-11-10T22:31:00.000Z');await ready(args,staggered.packets[1],staggered.review(staggered.packets[1]));fail();}),/injected_unrelated/);
  await staggered.run(async()=>outcome);const staggeredRead=await staggered.read();
  const survived=staggeredRead.decisions.filter(row=>row.gameId===staggered.packets[0].gameId);assert.equal(survived.length,3,'All three durably published scopes survive a later game write, route fault and next invocation');
  for(const row of survived){const prior=firstGameRows.find(r=>r.playerId===row.playerId&&r.market===row.market)!;assert.deepEqual({...row,lockedAt:null},prior);assert.equal(row.lockedAt,new Date(staggered.packets[0].lock).toISOString());}
  const assertFirstLock=(rows:Snapshot['decisions'],original:Snapshot['decisions'],lock:string)=>{
   assert.equal(rows.length,original.length);for(const row of rows){const prior=original.find(r=>r.playerId===row.playerId&&r.market===row.market)!;assert(prior);assert.deepEqual({...row,lockedAt:prior.lockedAt},prior);assert.equal(row.lockedAt,new Date(lock).toISOString());}
  };
  // A new invocation has no old in-memory handoff. The checkpoint must use
  // the actual prelock canonical publication, never just evaluatedAt.
  const crossCycle=harness({games:2,staggered:true});crossCycle.setTick(completed);await crossCycle.run(async args=>{await ready(args,crossCycle.packets[0],crossCycle.review(crossCycle.packets[0]));return outcome;});const crossOriginal=(await crossCycle.read()).decisions.filter(r=>r.gameId===crossCycle.packets[0].gameId);
  crossCycle.setTick('2026-11-10T22:31:00.000Z');await assert.rejects(crossCycle.run(async args=>{await ready(args,crossCycle.packets[1],crossCycle.review(crossCycle.packets[1]));assertFirstLock((await crossCycle.read()).decisions.filter(r=>r.gameId===crossCycle.packets[0].gameId),crossOriginal,crossCycle.packets[0].lock);fail();}),/injected_unrelated/);
  await crossCycle.run(async()=>outcome);assertFirstLock((await crossCycle.read()).decisions.filter(r=>r.gameId===crossCycle.packets[0].gameId),crossOriginal,crossCycle.packets[0].lock);
  const crossTracking=await tracking.readNbaPlayerPropsPrivateTracking({client:crossCycle.client as unknown as Parameters<typeof tracking.readNbaPlayerPropsPrivateTracking>[0]['client'],season:2026,slateDate});assert.equal(crossTracking?.rows.filter(row=>row.gameId===crossCycle.packets[0].gameId).length,3);
  // A later-game write may start before A's lock and acknowledge after it. Its
  // original prelock header stays truthful; a subsequent write latches A first.
  const delayedOther=harness({games:2,staggered:true});let delayedB=false;
  await assert.rejects(delayedOther.run(async args=>{delayedOther.setTick(completed);await ready(args,delayedOther.packets[0],delayedOther.review(delayedOther.packets[0]));const original=(await delayedOther.read()).decisions.filter(r=>r.gameId===delayedOther.packets[0].gameId);delayedOther.setTick('2026-11-10T22:29:00.000Z');delayedOther.delay(async record=>{const snapshot=store.decodeNbaPlayerPropsPrivatePayload<Snapshot>(record.payload,'candidate_snapshot');if(!delayedB&&snapshot?.decisions.some(row=>row.gameId==='nba-bdl:2'&&row.aiReview)){delayedB=true;delayedOther.setTick('2026-11-10T22:31:00.000Z');}});await ready(args,delayedOther.packets[1],delayedOther.review(delayedOther.packets[1]));const updated=structuredClone(delayedOther.packets[1]);updated.cutoff='2026-11-10T22:31:00.000Z';await args.onReviewObserved?.(updated,delayedOther.review(updated),true);assertFirstLock((await delayedOther.read()).decisions.filter(row=>row.gameId==='nba-bdl:1'),original,delayedOther.packets[0].lock);fail();}),/injected_unrelated/);assert(delayedB);
  // Already stored native/AI locks are exact and never trigger a redundant due
  // checkpoint, even if their optional old provenance is incomplete.
  const lockedPrior=harness({games:2,staggered:true,previous:(base,packets)=>{const ai=bindings.applyNbaSiteAi(base,packets[0],publication.siteAiDecisions(packets[0],nbaAuthorityReview(packets[0]),initial),initial);const rows=[...ai.decisions.filter(row=>row.gameId===packets[0].gameId).map((row,i)=>({...row,...(i===0?{aiReview:undefined,modelRelease:'legacy-native',calibrationRelease:'legacy-native',decisionRelease:'legacy-native',marketEvidenceMode:'candidate_projection' as const,gradePolicySource:'forecast_only' as const,targetExcludedProbability:.5}:{}),lockedAt:new Date(packets[0].lock).toISOString()})),...base.decisions.filter(row=>row.gameId!==packets[0].gameId)];return JSON.parse(JSON.stringify(product.buildNbaPlayerPropsMemberSnapshot({...base,generatedAt:after,decisions:rows,inputRows:6}))) as Snapshot;}});
  lockedPrior.setTick('2026-11-10T22:31:00.000Z');await assert.rejects(lockedPrior.run(async args=>{await ready(args,lockedPrior.packets[1],lockedPrior.review(lockedPrior.packets[1]));fail();}),/injected_unrelated/);assert.deepEqual((await lockedPrior.read()).decisions.filter(row=>row.gameId==='nba-bdl:1'),lockedPrior.previous.decisions.filter(row=>row.gameId==='nba-bdl:1'));assert.equal(lockedPrior.counts().writes,1);
  // A late whole-board header or missing execution evidence cannot be repaired
  // from old row evaluation times. If A is the only old game and is ineligible,
  // its empty due result composes with valid new B in one canonical write.
  for(const reason of ['late_publication','missing_execution'] as const){
   const invalid=harness({games:2,staggered:true,previous:(base,packets)=>{const ai=bindings.applyNbaSiteAi(base,packets[0],publication.siteAiDecisions(packets[0],nbaAuthorityReview(packets[0],weights,completed),completed),completed);const rows=ai.decisions.filter(row=>row.gameId===packets[0].gameId).map(row=>{if(reason!=='missing_execution')return row;const{executionEvidence:ignored,...e}=row.aiReview!;void ignored;return{...row,aiReview:e};});return product.buildNbaPlayerPropsMemberSnapshot({...base,generatedAt:reason==='late_publication'?after:completed,decisions:rows,inputRows:6});}});
   invalid.setTick('2026-11-10T22:31:00.000Z');await assert.rejects(invalid.run(async args=>{await ready(args,invalid.packets[1],invalid.review(invalid.packets[1]));const snapshot=await invalid.read();assert(!snapshot.decisions.some(row=>row.gameId==='nba-bdl:1'));assert.equal(snapshot.decisions.filter(row=>row.gameId==='nba-bdl:2'&&row.aiReview).length,3);fail();}),/injected_unrelated/);assert.equal(invalid.counts().writes,1);
  }
  // A true prelock source withdrawal stays absent after another game advances
  // the slate header; neither the original baseline nor due sweep revives it.
  const staggeredWithdrawal=harness({games:2,staggered:true,emptyGameIds:['nba-bdl:1']});await assert.rejects(staggeredWithdrawal.run(async args=>{staggeredWithdrawal.setTick('2026-11-10T22:28:00.000Z');await args.onSourceReady?.(empty(staggeredWithdrawal.packets[0],'2026-11-10T22:28:00.000Z'),null,'2026-11-10T22:28:00.000Z',true);staggeredWithdrawal.setTick('2026-11-10T22:31:00.000Z');await ready(args,staggeredWithdrawal.packets[1],staggeredWithdrawal.review(staggeredWithdrawal.packets[1]));assert(!(await staggeredWithdrawal.read()).decisions.some(row=>row.gameId==='nba-bdl:1'));fail();}),/injected_unrelated/);
  // New genuinely prelock unavailable context revokes the old AI at lock. The
  // zero-row intermediate cannot prevent independently complete B publication.
  const blockedEarlier=harness({games:2,staggered:true,previous:(base,packets)=>{const ai=bindings.applyNbaSiteAi(base,packets[0],publication.siteAiDecisions(packets[0],nbaAuthorityReview(packets[0]),initial),initial);return product.buildNbaPlayerPropsMemberSnapshot({...base,decisions:ai.decisions.filter(row=>row.gameId===packets[0].gameId),inputRows:6});}});
  await assert.rejects(blockedEarlier.run(async args=>{blockedEarlier.setTick('2026-11-10T22:28:00.000Z');const blocked=structuredClone(blockedEarlier.packets[0]);blocked.cutoff='2026-11-10T22:28:00.000Z';for(const actor of blocked.players)actor.evidence.push({id:`${actor.id}:new-own-out`,kind:'availability',source:'synthetic exact own current report',availableAt:blocked.cutoff,value:{canonicalGameId:blocked.gameId,scheduledStart:blocked.start,context:{away:{team:'BOS',known:true,players:[{name:actor.name,status:'out',reportedAt:blocked.cutoff}]},home:{team:'NYK',known:true,players:[]}}}});await args.onSourceReady?.(blocked,null,blocked.cutoff,true);blockedEarlier.setTick('2026-11-10T22:31:00.000Z');await ready(args,blockedEarlier.packets[1],blockedEarlier.review(blockedEarlier.packets[1]));const snapshot=await blockedEarlier.read();assert(!snapshot.decisions.some(row=>row.gameId==='nba-bdl:1'));assert.equal(snapshot.decisions.filter(row=>row.gameId==='nba-bdl:2'&&row.aiReview).length,3);return outcome;}),/no ready forecast/);assert.equal(blockedEarlier.counts().writes,1);
  // If checkpoint I/O consumes B's own remaining window, its later refusal
  // cannot erase A's newly durable first lock or fabricate a late B AI row.
  const checkpointLate=harness({games:2,staggered:true});let checkpointDelayed=false;let checkpointOriginal:Snapshot['decisions']=[];
  await assert.rejects(checkpointLate.run(async args=>{checkpointLate.setTick(completed);await ready(args,checkpointLate.packets[0],checkpointLate.review(checkpointLate.packets[0]));checkpointOriginal=(await checkpointLate.read()).decisions.filter(row=>row.gameId==='nba-bdl:1');checkpointLate.setTick('2026-11-10T22:31:00.000Z');checkpointLate.delay(async record=>{const snapshot=store.decodeNbaPlayerPropsPrivatePayload<Snapshot>(record.payload,'candidate_snapshot');if(!checkpointDelayed&&snapshot?.decisions.some(row=>row.gameId==='nba-bdl:1'&&row.lockedAt)){checkpointDelayed=true;checkpointLate.setTick(new Date(Date.parse(checkpointLate.packets[1].lock)+1000).toISOString());}});await assert.rejects(async()=>{await ready(args,checkpointLate.packets[1],checkpointLate.review(checkpointLate.packets[1]));},/publication_window_closed/);return outcome;}),/publication_window_closed/);const checkpointRead=await checkpointLate.read();assertFirstLock(checkpointRead.decisions.filter(row=>row.gameId==='nba-bdl:1'),checkpointOriginal,checkpointLate.packets[0].lock);assert(!checkpointRead.decisions.some(row=>row.gameId==='nba-bdl:2'&&row.aiReview));
  // An observation arriving after A's cutoff cannot retroactively revoke its
  // actual prelock publication when B causes the normal due-lock checkpoint.
  const lateContext=harness({games:2,staggered:true});let lateContextOriginal:Snapshot['decisions']=[];await assert.rejects(lateContext.run(async args=>{lateContext.setTick(completed);await ready(args,lateContext.packets[0],lateContext.review(lateContext.packets[0]));lateContextOriginal=(await lateContext.read()).decisions.filter(row=>row.gameId==='nba-bdl:1');lateContext.setTick('2026-11-10T22:31:00.000Z');const packet=structuredClone(lateContext.packets[0]);packet.cutoff='2026-11-10T22:28:00.000Z';for(const actor of packet.players)actor.evidence.push({id:`${actor.id}:late-observed-out`,kind:'availability',source:'synthetic source observed only after lock',availableAt:packet.cutoff,value:{status:'out'}});await args.onSourceReady?.(packet,null,packet.cutoff,true);await ready(args,lateContext.packets[1],lateContext.review(lateContext.packets[1]));assertFirstLock((await lateContext.read()).decisions.filter(row=>row.gameId==='nba-bdl:1'),lateContextOriginal,lateContext.packets[0].lock);fail();}),/injected_unrelated/);
  // Positive full-return control and source-ready native publication.
  const normal=harness();const success=await normal.run(async args=>{await args.onSourceReady?.(normal.packets[0],null,initial,true);assert.equal((await normal.read()).decisions.filter(r=>r.aiReview).length,0);normal.setTick(completed);await ready(args,normal.packets[0],normal.review());return outcome;});assert.equal(success.status,'published_private');assert.equal((await normal.read()).decisions.filter(r=>r.aiReview).length,3);
  // Concurrent callbacks have one in-flight canonical write; neither game loses.
  const concurrent=harness({games:2});await concurrent.run(async args=>{concurrent.setTick(completed);await Promise.all(concurrent.packets.map(p=>ready(args,p,concurrent.review(p))));assert.equal((await concurrent.read()).decisions.filter(r=>r.aiReview).length,6);return outcome;});assert.equal(concurrent.counts().maxActiveWrites,1);
  // A failed game does not prevent an unrelated later complete game from
  // becoming durable. The writer still refuses an overall success result.
  const isolatedFailure=harness({games:2});await assert.rejects(isolatedFailure.run(async args=>{isolatedFailure.setTick(completed);const bad:GamePacket=structuredClone(isolatedFailure.packets[0]);delete bad.executionQuotes;await assert.rejects(async()=>{await args.onSourceReady!(bad,null,completed,true);});await ready(args,isolatedFailure.packets[1],isolatedFailure.review(isolatedFailure.packets[1]));assert.equal((await isolatedFailure.read()).decisions.filter(r=>r.gameId==='nba-bdl:2'&&r.aiReview).length,3);return outcome;}),/complete execution/);assert.equal((await isolatedFailure.read()).decisions.filter(r=>r.aiReview).length,3);
  // A second game queued before lock cannot publish when it reaches queue late.
  const queued=harness({games:2});let delayed=false;queued.delay(async()=>{if(!delayed){delayed=true;queued.setTick(after);}});
  await assert.rejects(queued.run(async args=>{queued.setTick(completed);await Promise.all(queued.packets.map(p=>ready(args,p,queued.review(p))));return outcome;}),/publication_window_closed/);assert.equal(queued.counts().writes,0);assert((await queued.read()).decisions.every(r=>!r.aiReview));
  // First publication succeeds before an unrelated tracking wait crosses lock.
  // The second callback was queued earlier but must use its actual exit clock.
  const lateQueue=harness({games:2});let trackedOnce=false;lateQueue.delayTracking(async()=>{if(!trackedOnce){trackedOnce=true;lateQueue.setTick(after);}});
  await lateQueue.run(async args=>{lateQueue.setTick(completed);await Promise.all(lateQueue.packets.map(p=>ready(args,p,lateQueue.review(p))));return outcome;});const lateQueueRead=await lateQueue.read();assert.equal(lateQueueRead.decisions.filter(r=>r.gameId==='nba-bdl:1'&&r.aiReview).length,3);assert(!lateQueueRead.decisions.some(r=>r.gameId==='nba-bdl:2'&&r.aiReview));
  // A callback initially arriving after lock cannot manufacture any AI lock.
  const late=harness();late.setTick(after);await late.run(async args=>{await ready(args,late.packets[0],late.review());return outcome;});assert((await late.read()).decisions.every(r=>!r.aiReview));
  const declined=harness();await declined.run(async args=>{declined.setTick(completed);const review=declined.review();review.players=review.players.map(player=>player.playerId==='nba-bdl-player:1'?{...player,sourceDeclinedMarkets:['points']}:player);await ready(args,declined.packets[0],review);const rows=(await declined.read()).decisions;assert.equal(rows.length,3);assert(!rows.find(r=>r.playerId==='nba-bdl-player:1'&&r.market==='points')!.aiReview);assert.equal(rows.filter(r=>r.aiReview).length,2);return outcome;});
  // No valid native rows yet is a pending handoff, not a generic empty
  // publication or a completed AI evaluation. Failed lookup/declined laws must
  // leave the canonical clock and all original values exact, without new locks.
  for(const mode of ['no_review','lookup_failed','declined'] as const){
   const unavailable=harness({allOut:true});await assert.rejects(unavailable.run(async args=>{
    const packet=await args.load({id:unavailable.packets[0].gameId,start:unavailable.packets[0].start,away:'BOS',home:'NYK'},{cutoff:initial,stage:'final'} as Parameters<ReviewArgs['load']>[1]);
    await args.onSourceReady?.(packet,null,initial,mode!=='lookup_failed');assert.equal(unavailable.counts().writes,0);
    if(mode==='declined'){unavailable.setTick(completed);const review=unavailable.review(packet);review.players=review.players.map(player=>({...player,law:null,sourceDeclinedMarkets:review.marketScopes[player.playerId]}));await ready(args,packet,review);assert.equal(unavailable.counts().writes,0);}
    else{unavailable.setTick(after);await args.onReviewObserved?.(packet,null,mode!=='lookup_failed');}
    return outcome;
   }),/no ready forecast/);
   assert.equal(unavailable.counts().writes,0);assert.deepEqual(await unavailable.read(),unavailable.previous);assert((await unavailable.read()).decisions.every(row=>row.lockedAt===null));
  }
  // Whole-game empty-source authority can withdraw the final unlocked game.
  const withdrawn=harness({emptyLive:true});await withdrawn.run(async args=>{withdrawn.setTick(completed);await args.onSourceReady?.(empty(withdrawn.packets[0]),null,completed,true);assert.equal((await withdrawn.read()).decisions.length,0);return outcome;});assert.equal((await withdrawn.read()).decisions.length,0);assert.equal(withdrawn.counts().writes,1);
  // A withdrawal cannot erase an unrelated already-ready game, and a true
  // current return restores independently qualified Over and Under paths.
  const mixed=harness({games:2,emptyGameIds:['nba-bdl:1']});await mixed.run(async args=>{
   mixed.setTick(completed);await ready(args,mixed.packets[1],mixed.review(mixed.packets[1]));
   const healthy=(await mixed.read()).decisions.filter(r=>r.gameId==='nba-bdl:2');
   await args.onSourceReady?.(empty(mixed.packets[0]),null,completed,true);
   const withdrawnRead=await mixed.read();assert(!withdrawnRead.decisions.some(r=>r.gameId==='nba-bdl:1'));assert.deepEqual(withdrawnRead.decisions.filter(r=>r.gameId==='nba-bdl:2'),healthy);
   // Return in this invocation uses the original successful nonempty collector
   // only for game2. Game1's empty raw collector cannot authorize invented odds.
   return outcome;
  });assert.equal((await mixed.read()).decisions.length,3);
  for(const law of [weights,[8,1,1,...Array(13).fill(0)]]){
   const returned=harness();await returned.run(async args=>{returned.setTick(completed);await ready(args,returned.packets[0],returned.review(returned.packets[0],law));const rows=(await returned.read()).decisions;assert.equal(rows.length,3);assert(rows.every(r=>r.aiReview&&r.grade==='Best Angle'));assert(rows.some(r=>r.side===(law[0]===8?'under':'over')));return outcome;});
  }
  // An ordinary later invocation with real returning collector rows can
  // republish either qualified direction after a durable whole-game withdrawal.
  for(const law of [weights,[8,1,1,...Array(13).fill(0)]]){
   const recovery=harness({emptyLive:true});await recovery.run(async args=>{recovery.setTick(completed);await args.onSourceReady?.(empty(recovery.packets[0]),null,completed,true);return outcome;});assert.equal((await recovery.read()).decisions.length,0);
   recovery.setEmptyLive(false);recovery.setTick('2026-11-10T22:27:00.000Z');recovery.refreshSource('2026-11-10T22:27:00.000Z');await recovery.run(async args=>{await ready(args,recovery.packets[0],recovery.review(recovery.packets[0],law));return outcome;});const rows=(await recovery.read()).decisions;assert.equal(rows.length,3);assert(rows.every(r=>r.aiReview&&r.grade==='Best Angle'));assert(rows.some(r=>r.side===(law[0]===8?'under':'over')));
  }
  // Generic, forged or non-authoritative empty board still fails closed.
  const unsafe=harness(),prior=await unsafe.read(),zero=product.buildNbaPlayerPropsMemberSnapshot({...prior,decisions:[],inputRows:0});
  await assert.rejects(store.writeNbaPlayerPropsPrivateSnapshot({client:unsafe.client as unknown as Parameters<typeof store.writeNbaPlayerPropsPrivateSnapshot>[0]['client'],snapshot:zero,source:'synthetic'}),/refuses an empty/);
  await assert.rejects(store.writeNbaPlayerPropsPrivateSnapshot({client:unsafe.client as unknown as Parameters<typeof store.writeNbaPlayerPropsPrivateSnapshot>[0]['client'],snapshot:zero,source:'synthetic',writerRunId:'synthetic-lease-owner',expectedSnapshot:prior,withdrawalAuthority:{} as authority.NbaWithdrawalAuthority}),/actual capture/);
  const wrongEmpty=harness({emptyLive:true});await assert.rejects(wrongEmpty.run(async args=>{wrongEmpty.setTick(completed);const p=empty(wrongEmpty.packets[0]);delete p.sourceInputRelease;await args.onSourceReady?.(p,null,completed,true);return outcome;}));assert.equal(wrongEmpty.counts().writes,0);
  // An explicit empty packet cannot launder nonempty raw current collector rows.
  const falseEmpty=harness();await assert.rejects(falseEmpty.run(async args=>{falseEmpty.setTick(completed);await args.onSourceReady?.(empty(falseEmpty.packets[0]),null,completed,true);return outcome;}),/zero current collector/);assert.equal(falseEmpty.counts().writes,0);
  const futureEmpty=harness({emptyLive:true});await assert.rejects(futureEmpty.run(async args=>{futureEmpty.setTick(completed);await args.onSourceReady?.(empty(futureEmpty.packets[0],'2026-11-10T22:27:00Z'),null,completed,true);return outcome;}));assert.equal(futureEmpty.counts().writes,0);
  const partialEmpty=harness({emptyLive:true});await assert.rejects(partialEmpty.run(async args=>{partialEmpty.setTick(completed);const p=empty(partialEmpty.packets[0]);p.players=p.players.filter(a=>a.id!=='nba-bdl-player:1');await args.onSourceReady?.(p,null,completed,true);return outcome;}));assert.equal(partialEmpty.counts().writes,0);
  // Content change is observed even if a caller accidentally reuses an object.
  const reused=harness();await reused.run(async args=>{reused.setTick(completed);const p=reused.packets[0];await ready(args,p,reused.review(p));const writes=reused.counts().writes;p.players[0].name='Synthetic Current Label';await ready(args,p,reused.review(p));assert(reused.counts().writes>writes);assert((await reused.read()).decisions.filter(r=>r.playerId===p.players[0].id).every(r=>r.playerName==='Synthetic Current Label'));return outcome;});
  const failedOptional=harness({emptyLive:true,findings:['owls_player_props_capture_failed']});await assert.rejects(failedOptional.run(async args=>{failedOptional.setTick(completed);await args.onSourceReady?.(empty(failedOptional.packets[0]),null,completed,true);return outcome;}),/complete successful/);assert.equal(failedOptional.counts().writes,0);
  const staleWithdrawal=harness({emptyLive:true,previous:(base,packets)=>bindings.applyNbaSiteAi(base,packets[0],publication.siteAiDecisions(packets[0],nbaAuthorityReview(packets[0],weights,completed),completed),completed)});await assert.rejects(staleWithdrawal.run(async args=>{staleWithdrawal.setTick('2026-11-10T22:27:00.000Z');await args.onSourceReady?.(empty(staleWithdrawal.packets[0],initial),null,completed,true);return outcome;}),/predates/);assert.equal(staleWithdrawal.counts().writes,0);assert.equal((await staleWithdrawal.read()).decisions.filter(r=>r.aiReview).length,3);
  const staleReturn=harness({emptyLive:true});await staleReturn.run(async args=>{staleReturn.setTick(completed);await args.onSourceReady?.(empty(staleReturn.packets[0]),null,completed,true);return outcome;});staleReturn.setEmptyLive(false);staleReturn.setTick('2026-11-10T22:27:00.000Z');await assert.rejects(staleReturn.run(async args=>{await ready(args,staleReturn.packets[0],staleReturn.review());return outcome;}),/predates/);assert.equal((await staleReturn.read()).decisions.length,0);
  const mutation=harness(),mutablePrior=await mutation.read();(mutablePrior.decisions[0] as {probability:number}).probability=.2;await assert.rejects(store.writeNbaPlayerPropsPrivateSnapshot({client:mutation.client as unknown as Parameters<typeof store.writeNbaPlayerPropsPrivateSnapshot>[0]['client'],snapshot:mutation.baseline,source:'synthetic',writerRunId:'synthetic-lease-owner',expectedSnapshot:mutablePrior}),/changed after its read/);
  // Original native + AI locks retain every field through source withdrawal,
  // same-ID current label change, later review and reader round-trip.
  const protectedCase=harness({previous:(base,packets)=>{const applied=bindings.applyNbaSiteAi(base,packets[0],publication.siteAiDecisions(packets[0],nbaAuthorityReview(packets[0]),initial),initial);return product.buildNbaPlayerPropsMemberSnapshot({...base,decisions:[{...base.decisions[0],lockedAt:'2026-11-10T21:00:00Z'},{...applied.decisions.find(r=>r.market==='rebounds')!,lockedAt:'2026-11-10T21:00:00Z'}],inputRows:6});}});
  const protectedRows=protectedCase.previous.decisions;await protectedCase.run(async args=>{protectedCase.setTick(completed);const changed=structuredClone(protectedCase.packets[0]);changed.players[0].name='Synthetic Current Name';await ready(args,changed,protectedCase.review(changed));return outcome;});const protectedRead=await protectedCase.read();for(const row of protectedRows)assert.deepEqual(protectedRead.decisions.find(r=>r.playerId===row.playerId&&r.market===row.market),row);
  const lockedWithdrawal=harness({emptyLive:true,previous:()=>protectedCase.previous});await lockedWithdrawal.run(async args=>{lockedWithdrawal.setTick(completed);await args.onSourceReady?.(empty(lockedWithdrawal.packets[0]),null,completed,true);return outcome;});assert.deepEqual((await lockedWithdrawal.read()).decisions,protectedRows);
  console.log('Durable NBA actual writer passed: ready-before-fault canonical handoff, positive control, actual next-invocation first lock + tracking, serialized concurrent games, staggered same/cross-invocation due locks + exact legacy/invalid/withdrawn/context controls, empty checkpoint with independent new game, delayed SQL/late queue refusal, strict single/multi-game withdrawal + current Over/Under return, forged/missing/stale/future/partial/optional-failed-source refusal, exact native/AI legacy locks and canonical reader. Zero real HTTP/DB/paid calls.');
 }finally{if(beforeEnv===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:beforeEnv});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
