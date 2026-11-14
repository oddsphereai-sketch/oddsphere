import {nflPlayerPropsRefreshFailure} from '../lib/cron/playerPropsRefreshTelemetry';
import {summarizePropsAiRuntimeHealth} from '../lib/playerPropsAi/runtimeHealth';
/** Actual NFL/MLB routes with virtual slow dependencies; zero external I/O. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {MLB_PROPS_MODEL_RELEASE_ID} from '../lib/mlb/props/marketModelVersions';
globalThis.fetch=async()=>{throw Error('Route proof forbids HTTP/model/provider/DB');};
const started=Date.parse('2026-11-11T16:12:00Z');
function load(file:string,imports:Record<string,unknown>,env:Record<string,string>,clock:()=>number){
 class Clock extends Date{constructor(value?:string|number){super(value??clock());}static now(){return clock();}}
 const exports:Record<string,unknown>={};const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports,Date:Clock,URL,Response,process:{env},console,require:(name:string)=>{assert(Object.hasOwn(imports,name),`Unmocked route import ${name}`);return imports[name];}},{filename:file+'.offline.cjs'});
 return exports;
}
function nfl(options:{enabled?:boolean;propsEnabled?:boolean;cadence?:boolean;leaseWait?:number;propsFault?:boolean;deFault?:boolean;cadenceFault?:boolean;aiFailure?:boolean}={}){
 let now=started,held=false,propsCalls=0,stateCalls=0,closed=false,settledProps=false;
 const events:string[]=[];let release=()=>{},propsStarted=()=>{};
 const releaseProps=new Promise<void>(resolve=>{release=resolve;}),onPropsStart=new Promise<void>(resolve=>{propsStarted=resolve;});
 const env={NFL_FORWARD_EVIDENCE_ENABLED:String(options.enabled!==false),NFL_PLAYER_PROPS_ENABLED:String(options.propsEnabled!==false),BALLDONTLIE_API_KEY:'synthetic-bdl',PLAYBOOK_API_KEY:'synthetic-playbook',OWLS_INSIGHT_API_KEY:'synthetic-owls'};
 const forward={inserted:2,apiCallsMaximum:13,healthHolds:[],memberSnapshotError:null,marketBrainPersistenceError:null,marketBrainCaptureFailures:0,marketBrainCaptureFailureReasons:[],writerRelease:'unchanged-de'};
 const imports:Record<string,unknown>={
  '@/lib/cron/playerPropsRefreshTelemetry':{nflPlayerPropsRefreshFailure},
  '@/lib/db/supabase':{supabase:{fixture:true}},
  '@/lib/providers/real_api/OpenWeatherProvider':{OpenWeatherProvider:class{constructor(){throw Error('No added weather request');}}},
  '@/lib/cron/runCron':{cronHandler:async(_r:Request,_n:string,handler:(ctx:{runId:string})=>Promise<unknown>,opts:Record<string,unknown>)=>{assert.equal(opts.sport,'nfl');assert.equal(opts.leaseGroup,'prediction_pipeline');assert.equal(opts.requireLease,true);assert.equal(opts.lockMinutes,10);assert.equal(opts.leaseRetryMaxWaitMs,10000);now+=options.leaseWait??0;held=true;events.push('lease');try{return Response.json(await handler({runId:'same-nfl-owner'}));}finally{closed=true;held=false;events.push('lease-close');}}},
  '@/lib/playerPropsAi/dueReview':{hasDuePropsAiReview:async()=>{events.push('due');if(options.cadenceFault)throw Error('injected cadence read failure');return true;}},
  '@/lib/services/football/nflForwardWeekSelection':{resolveNflForwardWeek:()=>11,resolveNflOperationalWeek:()=>11},
  '@/lib/services/football/nflForwardMemberSnapshotStore':{readNflForwardMemberSnapshot:async()=>null},
  '@/lib/services/football/nflPlayerPropsCurrentSeasonState':{readNflPlayerPropsCurrentSeasonState:async()=>{events.push('state-read');return{};},refreshNflPlayerPropsCurrentSeasonState:async()=>{events.push('state-refresh');stateCalls++;return{apiCalls:3,state:{completeThroughWeek:10}};},writeNflPlayerPropsCurrentSeasonState:async()=>{events.push('state-write');}},
  '@/lib/services/football/nflMarketBrainCaptureConfig':{resolveNflMarketBrainCaptureConfiguration:()=>({requested:false,enabled:false,maximumGames:0,attemptSchedule:null,error:null})},
  '@/lib/services/football/nflPlayerPropsSnapshotStore':{readNflPlayerPropsSnapshot:async()=>({unchanged:true})},
  '@/lib/services/football/nflPlayerPropsCadence':{planNflPlayerPropsRefresh:(args:Record<string,unknown>)=>{events.push('cadence');if(options.cadenceFault)assert.equal(args.previous,null);return{run:options.cadence!==false,reason:'unchanged-existing-cadence'};}},
  '@/lib/services/football/nflPlayerPropsProductionWriter':{runNflPlayerPropsProductionWriter:async(args:Record<string,unknown>)=>{assert(held);assert(events.includes('state-write'),'The one shared current state must persist first');propsCalls++;events.push('props-start');assert.equal(args.writerRunId,'same-nfl-owner');assert.equal(args.aiDeadline,started+480000);assert.equal(args.apply,true);assert.equal(args.now,new Date(started+(options.leaseWait??0)).toISOString());propsStarted();await releaseProps;assert(held);settledProps=true;events.push('props-complete');if(options.propsFault)throw Error('injected props fault');return{memberRows:18,apiCallsMaximum:12,healthFindings:[],aiReviewRuntime:summarizePropsAiRuntimeHealth({status:'active',newlyCompletedReviews:0,games:[],findings:options.aiFailure?['source_or_review_unavailable:game:nfl_offered_player_identity_incomplete']:[]},new Date(now).toISOString())};}},
  '@/lib/services/football/nflForwardEvidenceWriter':{runNflForwardEvidenceWriter:async(args:Record<string,unknown>)=>{assert(held);assert(events.includes('state-write'));assert.equal(args.runId,'same-nfl-owner');assert.equal(args.apply,true);assert.equal(args.exactProviderCandidate,true);events.push('de-start');if(options.propsEnabled!==false&&options.cadence!==false)await onPropsStart;now=started+(options.leaseWait??0)+339000;if(options.deFault)throw Error('injected DE fault');release();events.push('de-complete');return forward;}},
 };
 const exports=load('app/api/cron/nfl-forward-evidence/route.ts',imports,env,()=>now);assert.equal(exports.maxDuration,540);assert.equal(exports.POST,exports.GET);
 return{run:()=> (exports.GET as(r:Request)=>Promise<Response>)(new Request('https://synthetic.invalid/api/cron/nfl-forward-evidence')),release,started:onPropsStart,events,state:()=>({now,held,closed,propsCalls,stateCalls,settledProps})};
}
function mlb(options:{leaseWait?:number;fault?:boolean;empty?:boolean;disabled?:boolean;trackingFault?:boolean;locks?:number}={}){
 let now=started,held=false,calls=0,trackingCalls=0,memberCalls=0;
 const previous={modelRelease:MLB_PROPS_MODEL_RELEASE_ID,data:{props:[{id:'exact-old-lock',lockedAt:'2026-11-10T22:00:00Z',probability:.61345678,price:-117,grade:'Lean',evidence:{original:'exact',nullValue:null}}]}};const saved=JSON.stringify(previous);
 const imports:Record<string,unknown>={
  '@/lib/cron/runCron':{cronHandler:async(_r:Request,_name:string,handler:(c:{runId:string})=>Promise<unknown>,opts:Record<string,unknown>)=>{assert.equal(opts.sport,'mlb');assert.equal(opts.leaseGroup,'prediction_pipeline');assert.equal(opts.lockMinutes,10);assert.equal(opts.requireLease,true);now+=options.leaseWait??0;held=true;try{return Response.json(await handler({runId:'same-mlb-owner'}));}finally{held=false;}}},
  '@/lib/cron/playerPropsRefreshTelemetry':{isInactiveMlbPropsRefresh:()=>Boolean(options.empty)},
  '@/lib/mlb/props/liveBoard':{easternSlateDate:()=> '2026-11-11',refreshMlbPropsBoard:async(args:Record<string,unknown>)=>{assert(held);calls++;assert.equal(args.writerRunId,'same-mlb-owner');assert.equal(args.aiDeadline,started+480000);assert.equal(args.persist,true);assert.equal(args.slateDate,'2026-11-11');assert.equal(args.refreshMode,'full');now+=339000;if(options.fault)throw Error('injected source failure');return{published:!options.empty,usedPreviousSnapshot:false,tracking:{status:'ok',entriesLocked:2,closingPricesUpdated:1,error:null},privateTrackingCapture:{written:true},providerCalls:{balldontlie:12},snapshot:{refreshMode:'full',snapshotId:'current',data:{props:[]},validation:{errors:[],warnings:[],actionableRows:0}}};}},
  '@/lib/mlb/props/boardSnapshotStore':{loadLatestMlbPropsBoardSnapshot:async()=>previous},
  '@/lib/mlb/props/internalTracking':{syncInternalMlbPropsTracking:async(snapshot:unknown,at:string)=>{assert(held);trackingCalls++;assert.equal(snapshot,previous);assert.equal(at,new Date(now).toISOString());assert.equal(JSON.stringify(previous),saved);if(options.trackingFault)throw Error('injected tracking fault');return{gameLocksCreated:options.locks??1,entriesLocked:2,closingPricesUpdated:1};}},
  '@/lib/mlb/props/memberReadSnapshotStore':{publishMlbPropsMemberReadSnapshots:async(snapshot:unknown,opts:Record<string,unknown>)=>{assert(held);assert.equal(snapshot,previous);assert.equal(opts.forceFull,true);memberCalls++;assert.equal(JSON.stringify(previous),saved);}},
 };
 const exports=load('app/api/cron/mlb-player-props-refresh/route.ts',imports,{MLB_PLAYER_PROPS_CRON_ENABLED:String(!options.disabled)},()=>now);assert.equal(exports.maxDuration,540);assert.equal(exports.runtime,'nodejs');
 return{run:()=> (exports.GET as(r:Request)=>Promise<Response>)(new Request('https://synthetic.invalid/api/cron/mlb-player-props-refresh?full=true&date=2026-11-11')),state:()=>({now,held,calls,trackingCalls,memberCalls,unchanged:JSON.stringify(previous)===saved})};
}
async function main(){
 assert.equal(MLB_PROPS_MODEL_RELEASE_ID,'mlb_props_2026_10_21_r44');
 for(const opts of [{},{leaseWait:10000},{propsFault:true},{cadenceFault:true}]){const f=nfl(opts),response=await f.run(),body=await response.json();assert.equal(response.status,200);assert.equal(f.state().propsCalls,1);assert.equal(f.state().stateCalls,1);assert(f.events.indexOf('props-start')<f.events.indexOf('de-complete'));assert(f.events.indexOf('props-complete')<f.events.indexOf('lease-close'));assert(f.state().now-started<540000);assert.equal(body.api_calls_made,opts.propsFault?16:28);assert.equal(body.partial,Boolean(opts.propsFault));}
 const failedAi=nfl({aiFailure:true});const aiBody=await(await failedAi.run()).json();assert.equal(aiBody.partial,true);assert.match(aiBody.error_message,/NFL player props AI preparation or review incomplete/);assert.equal(failedAi.state().propsCalls,1,'Health reporting adds no second writer/review');assert.equal(aiBody.details.player_props.aiReviewRuntime.newlyCompletedReviews,0);
 for(const opts of [{cadence:false},{propsEnabled:false},{enabled:false}]){const f=nfl(opts);await f.run();assert.equal(f.state().propsCalls,0);assert.equal(f.state().stateCalls,opts.enabled===false?0:1);}
 const failed=nfl({deFault:true});let settled=false;const pending=failed.run().finally(()=>{settled=true;});await failed.started;await Promise.resolve();await Promise.resolve();assert(failed.state().held);assert(!settled);failed.release();await assert.rejects(pending,/injected DE fault/);assert(failed.state().settledProps);assert(failed.state().closed);
 for(const opts of [{},{leaseWait:120000},{fault:true},{fault:true,locks:0},{fault:true,trackingFault:true},{empty:true},{disabled:true}]){const f=mlb(opts),body=await(await f.run()).json();assert(f.state().unchanged);assert(!f.state().held);assert.equal(f.state().calls,opts.disabled?0:1);assert.equal(f.state().trackingCalls,opts.fault?1:0);assert.equal(f.state().memberCalls,opts.fault&&!opts.trackingFault&&opts.locks!==0?1:0);if(opts.fault)assert.equal(body.api_calls_made,0);if(opts.empty)assert.equal(body.partial,false);assert(f.state().now-started<540000);}
 console.log('Actual NFL/MLB routes passed: one shared-state refresh, sole props operation overlaps339s DE, cadence/defaults unchanged, DEthrow awaits pending props before lease close, fault isolation, original request480s deadline after leasewait, MLB R44 and exact old locked fallback preserved. Offline virtual time; no paid/provider/DB.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
