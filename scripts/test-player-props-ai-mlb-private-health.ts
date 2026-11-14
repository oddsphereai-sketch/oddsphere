/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled actual-module VM tests use synthetic fluent storage and React boundaries. */
/** Private MLB process health: actual writer block/returns, cron and every member transport.
 * No environment files, real database, provider, model, count or HTTP requests. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {summarizePropsAiRuntimeHealth} from '../lib/playerPropsAi/runtimeHealth';
import {mlbPlayerPropsRefreshFailure,isInactiveMlbPropsRefresh} from '../lib/cron/playerPropsRefreshTelemetry';
import * as memberPayload from '../lib/mlb/props/memberPayload';
import * as marketEvidence from '../lib/mlb/props/marketEvidenceCapture';
import * as releaseOrdering from '../lib/mlb/props/releaseOrdering';
import {MLB_PROPS_MODEL_RELEASE_ID} from '../lib/mlb/props/marketModelVersions';
import {reviewPropsForSite,type SiteReviewOutcome} from '../lib/playerPropsAi/siteRuntime';

globalThis.fetch=async()=>{throw Error('MLB private health tests forbid real HTTP');};
const at='2030-06-01T18:00:00.000Z',slateDate='2030-06-01',sentinel='PRIVATE_MLB_HEALTH_SENTINEL';
class Clock extends Date {constructor(value?:string|number){super(value??at);}static now(){return Date.parse(at);}}
const requireHere=createRequire(`${process.cwd()}/package.json`);
function evaluate(text:string,context:Record<string,unknown>){
 const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 return vm.runInNewContext(js,{Date:Clock,Buffer,console,Request,Response,URL,AbortSignal,...context});
}
function load(file:string,dependencies:Record<string,unknown>,env:Record<string,string>={}){
 const instance={exports:{} as any};
 evaluate(readFileSync(file,'utf8'),{module:instance,exports:instance.exports,process:{env},require:(name:string)=>{assert(name in dependencies,`Unmocked ${file} dependency ${name}`);return dependencies[name];}});
 return instance.exports;
}
const fixture=JSON.parse(readFileSync('tests/fixtures/mlb-props/player-props-preview-full.json','utf8'));
const row={...fixture.props[0],id:'synthetic-prop',researchKey:'synthetic-research',providerIds:{gameId:'synthetic-game',mlbStatsPlayerId:'synthetic-player',bdlPlayerId:7},gameStartTime:'2030-06-01T20:00:00.000Z',projection:6.123456789,finalProbability:.61723891,odds:-117,lockStatus:{status:'locked',lockedAt:'2030-06-01T17:00:00.000Z',evidence:{original:'opaque-original-lock'}}};
const data={...fixture,date:slateDate,lastUpdated:at,props:[row],summary:{...fixture.summary,gamesWithProps:1},research:{'synthetic-research':{recentForm:{logs:[{value:6}]},environment:{original:'verified'},opponentProfile:{original:'verified'},pitchArsenal:{original:'verified'}}}};
function snapshot(){return{schemaVersion:1,snapshotId:'synthetic-snapshot',slateDate,asOfTimestamp:at,refreshMode:'full',data:structuredClone(data),modelContext:{modelReleaseId:MLB_PROPS_MODEL_RELEASE_ID},validation:{publishable:true,sourceRows:1,mappedRows:1,staleOddsRows:0,researchRows:1,actionableRows:0,errors:[],warnings:[]},movement:{comparedWith:null,addedRows:1,removedRows:0,changedLines:0,changedPrices:0}};}
const source=readFileSync('lib/mlb/props/liveBoard.ts','utf8'),ast=ts.createSourceFile('liveBoard.ts',source,ts.ScriptTarget.Latest,true);
const refresh=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='refreshMlbPropsBoard') as ts.FunctionDeclaration;
const statements=refresh.body!.statements;
const aiBlock=statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).includes('propsAiSiteConfig().integrated'))!;
const unpublished=statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).includes('!snapshot.validation.publishable'))!;
const finalReturn=statements.findLast(n=>ts.isReturnStatement(n))!;
assert(aiBlock&&unpublished&&finalReturn);

async function writer(outcome:SiteReviewOutcome,published=true,integrated=true,noGames=false){
 const s:any=snapshot();if(noGames){s.data.props=[];s.data.slate.matchups=[];s.validation.sourceRows=0;s.validation.errors=['PROP_ODDS_UNAVAILABLE'];}
 s.validation.publishable=published;
 const rowsBefore=JSON.stringify(s.data.props),track={status:'complete',entriesLocked:0,closingPricesUpdated:0,gameLocksCreated:0,error:null};
 let reviews=0;const scope:any={snapshot:s,args:{persist:true,writerRunId:'synthetic-lease',slateDate,aiDeadline:Clock.now()+480000},asOfTimestamp:at,client:{},games:[],probablePitchers:[],expandedDecisionProps:s.data.props,boardSourceOdds:[],openingOdds:[],environment:{errors:[]},previous:null,mappedOdds:[],providerCoverage:{},playerGameIdentityConflictRows:0,probablePitcherResolution:{fallbackAssignments:[],findings:[]},
  propsAiSiteConfig:()=>({integrated}),createPropsAiDbClient:()=>({}),createMlbPrelockHandoff:(rows:any)=>({rows:()=>rows,observe:()=>{throw Error('No callback expected in process-only failure controls');}}),MLB_PROPS_AI_HANDOFF_RELEASE:'unchanged-handoff',randomUUID:()=> 'synthetic-next-snapshot',buildDashboardData:(a:any)=>({...s.data,props:a.props}),compareMlbPropsBoardMovement:()=>s.movement,resolveMlbStatsTeamId:()=>null,liveMlbPacket:()=>{throw Error('No source reads in health-only control');},validateMlbPropsBoardData:()=>s.validation,enforceSnapshotPayloadLimits:()=>{},summarizePropsAiRuntimeHealth,
  reviewPropsForSite:async(args:any)=>{reviews++;assert.equal(args.sport,'mlb');assert.equal(args.deadline,Clock.now()+480000);return outcome;},process:{env:{}},scoringRunId:'synthetic-score',forecastTelemetry:{runtimeReleaseId:MLB_PROPS_MODEL_RELEASE_ID},tracking:track,disabledTrackingResult:()=>track,privateTrackingCapture:null,balldontlieCalls:3,providerCalls:{balldontlieOdds:1,balldontlieResearch:1,balldontlieLineups:1}};
 const result=await evaluate(`(async()=>{let aiReviewRuntime;${aiBlock.getText(ast)}${unpublished.getText(ast)}${finalReturn.getText(ast)}})()`,scope);
 assert.equal(reviews,integrated?1:0,'Exactly one existing logical runtime invocation');
 assert.equal(JSON.stringify(result.snapshot.data.props),rowsBefore,'Native/opaque locked rows stay exact');
 assert.equal(JSON.stringify(result.tracking),JSON.stringify(track));assert.equal(result.providerCalls.balldontlie,3);
 assert(!JSON.stringify(result.snapshot).includes('aiReviewRuntime'),'Health never enters canonical snapshot/data/research/rows/model context');
 assert.equal(result.snapshot.modelContext.modelReleaseId,MLB_PROPS_MODEL_RELEASE_ID);
 if(integrated){assert.equal(result.aiReviewRuntime.status,outcome.status);assert.equal(result.aiReviewRuntime.newlyCompletedReviews,outcome.newlyCompletedReviews??0);assert.equal(result.aiReviewRuntime.observedAt,at);}
 else assert.equal(result.aiReviewRuntime,undefined);
 return result;
}
async function cron(result:any){
 let refreshes=0;const before=JSON.stringify(result);
 const route=load('app/api/cron/mlb-player-props-refresh/route.ts',{
  '@/lib/cron/runCron':{cronHandler:async(_request:any,_name:any,run:any,options:any)=>{assert.equal(options.sport,'mlb');assert.equal(options.leaseGroup,'prediction_pipeline');assert.equal(options.requireLease,true);return run({runId:'synthetic-lease'});}},
  '@/lib/cron/playerPropsRefreshTelemetry':{mlbPlayerPropsRefreshFailure,isInactiveMlbPropsRefresh},
  '@/lib/mlb/props/boardSnapshotStore':{},'@/lib/mlb/props/memberReadSnapshotStore':{},'@/lib/mlb/props/internalTracking':{},
  '@/lib/mlb/props/liveBoard':{easternSlateDate:()=>slateDate,refreshMlbPropsBoard:async(args:any)=>{refreshes++;assert.equal(args.aiDeadline,Clock.now()+480000);return result;}}}, {MLB_PLAYER_PROPS_CRON_ENABLED:'true'});
 const response=await route.GET(new Request('https://offline.invalid/api/cron/mlb-player-props-refresh'));
 assert.equal(refreshes,1);assert.equal(JSON.stringify(result),before);assert.equal(response.details.published,result.published);
 if(result.aiReviewRuntime)assert.equal(JSON.stringify(response.details.aiReviewRuntime),JSON.stringify(result.aiReviewRuntime));
 return response;
}
async function healthControls(){
 const savedEnabled=process.env.PLAYER_PROPS_AI_SITE_ENABLED;
 let realUnavailable:SiteReviewOutcome;
 try{
  process.env.PLAYER_PROPS_AI_SITE_ENABLED='true';
  let reads=0;
  realUnavailable=await reviewPropsForSite({sport:'mlb',games:[],clock:()=>at,
   client:{from(table:string){reads++;assert.equal(table,'player_props_ai_control');return{select(){return this;},eq(){return this;},single:async()=>({data:null,error:{code:'synthetic_control_unavailable'}})};},rpc(){throw Error('Control failure cannot claim or fund');}} as any,
   load:()=>{throw Error('Control failure cannot read source');}});
  assert.equal(reads,1);assert.equal(realUnavailable.status,'unavailable');assert.deepEqual(realUnavailable.findings,['ai_operational_fallback_keep_independent']);
 }finally{if(savedEnabled===undefined)delete process.env.PLAYER_PROPS_AI_SITE_ENABLED;else process.env.PLAYER_PROPS_AI_SITE_ENABLED=savedEnabled;}
 const cases:[string,SiteReviewOutcome,boolean][]=[
  ['actual-control-unavailable',realUnavailable,true],
  ['incomplete',{status:'active',games:[],findings:['review_unavailable:g:source_or_preparation_timeout']},true],
  ['new-completion',{status:'active',games:[],findings:[],newlyCompletedReviews:1},false],
  ['retained-historical',{status:'active',games:[{authorityReview:{release:'original'}}] as any,findings:[],newlyCompletedReviews:0},false],
  ['disabled',{status:'disabled',games:[],findings:[]},false],
  ['paid-disabled',{status:'paid_disabled',games:[],findings:[]},false],
 ];
 for(const [name,outcome,failure] of cases){for(const published of [true,false]){
  const result=await writer(outcome,published);assert.equal(mlbPlayerPropsRefreshFailure(result)!==null,failure,name);
  const response=await cron(result);assert.equal(response.partial,!published||failure,name);
  if(failure)assert.match(response.error_message,/scheduled.*unverified/);else if(published)assert.equal(response.error_message,null);
 }}
 const healthy={status:'active',games:[],findings:[],newlyCompletedReviews:0};
 const noGames=await cron(await writer(healthy,false,true,true));assert.equal(noGames.partial,false);assert.equal(noGames.details.inactive,true);assert.equal(noGames.details.aiReviewRuntime.newlyCompletedReviews,0);
 const gateOff=await cron(await writer(healthy,true,false));assert.equal(gateOff.partial,false);assert.equal(gateOff.details.aiReviewRuntime,undefined);
 const trackingFailure=await writer(healthy);trackingFailure.tracking={...trackingFailure.tracking,status:'failed',error:'synthetic tracking exception'};const response=await cron(trackingFailure);assert.equal(response.partial,true);assert.equal(response.error_message,'synthetic tracking exception');
 const secret=await writer({status:'active',games:[],findings:['Authorization=Bearer PRIVATE_SECRET','sk-sensitive-value'],newlyCompletedReviews:0});const privateResponse=await cron(secret);assert.equal(privateResponse.partial,true);assert(!JSON.stringify(privateResponse).includes('PRIVATE_SECRET'));assert(!JSON.stringify(privateResponse).includes('sk-sensitive-value'));
}

async function memberPrivacy(){
 const privateHealth=summarizePropsAiRuntimeHealth({status:'active',games:[],findings:[sentinel],newlyCompletedReviews:0},at);
 const privateSnapshot:any={...snapshot(),aiReviewRuntime:privateHealth,futurePrivateRuntime:sentinel};
 const original=JSON.stringify(privateSnapshot),locked=JSON.stringify(privateSnapshot.data.props);
 const saved=new Map<string,any>();let writes=0,reads=0,lockReads=0;
 const db={from(table:string){assert.equal(table,'lab_response_snapshots');let key='',keys:string[]|null=null;const query:any={select(){return query;},eq(_k:string,v:string){key=v;return query;},gt(){return query;},in(_k:string,v:string[]){keys=v;return query;},abortSignal(){return query;},async upsert(rows:any){for(const r of Array.isArray(rows)?rows:[rows]){saved.set(r.snapshot_key,structuredClone(r));writes++;}return{error:null};},async maybeSingle(){reads++;return{data:saved.get(key)??null,error:null};},then(resolve:any,reject:any){reads++;return Promise.resolve({data:[...saved.values()].filter(r=>keys?.includes(r.snapshot_key)),error:null}).then(resolve,reject);}};return query;}};
 const member=load('lib/mlb/props/memberReadSnapshotStore.ts',{
  '@/lib/db/supabase':{supabase:db},'./boardSnapshotStore':{applyMlbPropsDisplayLocks:async(s:any)=>{lockReads++;return s;},loadHighestIndexedMlbPropsReleaseHead:async()=>null,loadMlbPropsLockedGameTimes:async()=>new Map([['synthetic-game',row.lockStatus.lockedAt]])},
  './memberPayload':memberPayload,'./marketModelVersions':{MLB_PROPS_MODEL_RELEASE_ID},'./releaseOrdering':releaseOrdering,'./marketEvidenceCapture':marketEvidence});
 await member.publishMlbPropsMemberReadSnapshots(privateSnapshot,{forceFull:true});
 assert.equal(lockReads,1);assert.equal(writes,4,'Compact/full manifest/game shard/player shard only; no health write');
 for(const stored of saved.values()){assert(!JSON.stringify(stored).includes(sentinel));assert(!JSON.stringify(stored).includes('aiReviewRuntime'));}
 assert.equal(JSON.stringify(privateSnapshot),original,'Publisher never mutates original private snapshot');
 const board=await member.loadMlbPropsMemberBoardSnapshot(slateDate),full=await member.loadMlbPropsMemberBoardSnapshot(slateDate,true),player=await member.loadMlbPropsPlayerReadSnapshot(slateDate,'synthetic-player');
 assert.equal(JSON.stringify(board.data.props),locked);assert.equal(JSON.stringify(full.data.props),locked);assert.equal(JSON.stringify(player.props),locked);
 assert(reads===4,'One compact, one manifest, one shard batch and one player read');
 const Dashboard=()=>null;const jsx=requireHere('react/jsx-runtime');
 const find=(value:any):any=>{if(!value||typeof value!=='object')return null;if(Array.isArray(value))return value.map(find).find(Boolean)??null;if(value.type===Dashboard)return value;return find(value.props?.children);};
 for(const indexed of [true,false]){
  let indexReads=0,fallbackReads=0;
  const deps:any={
   '@/app/lab/components/ProductAppFrame':{default:()=>null,__esModule:true},'./components/PlayerPropsDashboard':{PlayerPropsDashboard:Dashboard},
   '@/lib/mlb/props/boardSnapshotStore':{loadCachedLatestMlbPropsDisplaySnapshot:async()=>{fallbackReads++;return privateSnapshot;}},
   '@/lib/mlb/props/liveBoard':{easternSlateDate:()=>slateDate,mlbPropsSnapshotIsFresh:()=>true},
   '@/lib/mlb/props/publicPicksSafety':{getPublicPicksMode:()=>({mode:'display_enabled'})},
   '@/lib/mlb/props/memberPayload':memberPayload,
   '@/lib/mlb/props/memberReadSnapshotStore':{loadMlbPropsMemberBoardSnapshot:async()=>{indexReads++;return indexed?board:null;},loadMlbPropsPlayerReadSnapshot:async()=>{indexReads++;return indexed?player:null;}},
   '@/lib/config/productExperience':{isPlayerPropsExperienceCandidateEnabled:()=>false,isProductExperiencePreviewAvailable:()=>false},
   '@/app/player-props/components/PlayerPropsLeaguePills':{PlayerPropsLeaguePills:()=>null},
   '@/lib/services/memberDataAvailability':{readMemberDataWithDeadline:async(args:any)=>({value:await args.read()})},
   '@/lib/mlb/props/livePreviewStore':{loadMlbPropsLivePreviewSnapshot:()=>{throw Error('No public preview read');}},'react/jsx-runtime':jsx};
  const page=load('app/mlb/props/page.tsx',deps);
  const element=find(await page.default({searchParams:Promise.resolve({reader:row.id})}));assert(element);assert.equal(JSON.stringify(element.props.data.props),locked);assert(!JSON.stringify(element.props).includes(sentinel));assert(!JSON.stringify(element.props).includes('aiReviewRuntime'));assert.equal(indexReads,1);assert.equal(fallbackReads,indexed?0:1);
  indexReads=0;fallbackReads=0;
  const picks=load('app/api/mlb/props/picks/route.ts',deps);const picksResponse=await picks.GET(new Request('https://offline.invalid/api/mlb/props/picks'));const picksBody=await picksResponse.json();assert.equal(picksResponse.status,200);assert.equal(JSON.stringify(picksBody.board.props),locked);assert(!JSON.stringify(picksBody).includes(sentinel));assert(!JSON.stringify(picksBody).includes('aiReviewRuntime'));assert.equal(indexReads,1);assert.equal(fallbackReads,indexed?0:1);
  indexReads=0;fallbackReads=0;
  const playerRoute=load('app/api/mlb/props/player/[player_id]/route.ts',deps);const playerResponse=await playerRoute.GET(new Request('https://offline.invalid/api/mlb/props/player/synthetic-player'),{params:Promise.resolve({player_id:'synthetic-player'})});const playerBody=await playerResponse.json();assert.equal(playerResponse.status,200);assert.equal(JSON.stringify(playerBody.props),locked);assert(!JSON.stringify(playerBody).includes(sentinel));assert(!JSON.stringify(playerBody).includes('aiReviewRuntime'));assert.equal(indexReads,1);assert.equal(fallbackReads,indexed?0:1);
  // Scoped picks deliberately use the canonical path instead of stale full shards.
  indexReads=0;fallbackReads=0;const scopedResponse=await picks.GET(new Request('https://offline.invalid/api/mlb/props/picks?game_id=synthetic-game'));const scoped=await scopedResponse.json();assert.equal(JSON.stringify(scoped.board.props),locked);assert(!JSON.stringify(scoped).includes(sentinel));assert.equal(indexReads,0);assert.equal(fallbackReads,1);
 }
 assert.equal(JSON.stringify(privateSnapshot),original);assert.equal(JSON.stringify(privateSnapshot.data.props),locked);
}
async function main(){await healthControls();await memberPrivacy();console.log('MLB private health passed: actual writer AI block and both returns, actual cron unavailable/incomplete/new/retained/disabled/no-game and tracking controls; exact native/locked rows and calls; actual indexed compact/full/shard/player publication+reads, actual page and picks/player APIs indexed/fallback/scoped; no private health in member payloads, no extra refresh/network/provider/model/count/SQL.');}
void main().catch(error=>{console.error(error);process.exitCode=1;});
