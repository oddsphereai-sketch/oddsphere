/** Actual route, virtual elapsed time and isolated I/O. No real provider/model/DB. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

globalThis.fetch=async()=>{throw Error('Priority route proof forbids HTTP');};
const start=Date.parse('2026-11-11T16:12:00Z'),slate='2026-11-11';
function fixture(options:{due?:boolean;leaseWait?:number;intraday?:boolean;seedFault?:boolean;propsFault?:boolean;manualProps?:boolean}={}){
 let now=start,held=false,propsCalls=0,sourceCalls=0,scheduleReads=0,closed=false;
 const events:string[]=[],games=Array.from({length:6},(_,i)=>({id:`game-${i}`,slateDate:slate}));
 let finishProps=()=>{};
 const pendingProps=new Promise<void>(resolve=>{finishProps=resolve;});
 const env={NBA_CRON_ENABLED:'true',NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED:'true',OWLS_INSIGHT_API_KEY:'synthetic-owls',BALLDONTLIE_API_KEY:'synthetic-bdl'};
 const ratings={release:'fixture',mode:'updated',teamsInDb:30,seasonFetchStatus:'ok',playoffFetchStatus:'ok',errors:[],written:3};
 const imports:Record<string,unknown>={
  '@/lib/db/supabase':{supabase:{fixture:true}},
  '@/lib/cron/auth':{validateCronAuth:()=>({ok:true})},
  '@/lib/cron/runCron':{cronHandler:async(_request:Request,_name:string,handler:(ctx:{runId:string})=>Promise<unknown>,opts:Record<string,unknown>)=>{
   assert.equal(opts.sport,'nba');assert.equal(opts.leaseGroup,'prediction_pipeline');assert.equal(opts.requireLease,true);assert.equal(opts.lockMinutes,10);now+=options.leaseWait??0;held=true;events.push('lease');
   try{return Response.json(await handler({runId:'same-owner'}));}finally{events.push('lease-close');held=false;closed=true;}
  }},
  '@/lib/playerPropsAi/dueReview':{hasDuePropsAiReview:async()=>{assert(held);events.push('due');return options.due!==false;}},
  '@/lib/playerPropsAi/nbaReviewRescue':{runNbaPropsReviewRescue:async()=>{throw Error('Normal route must not invoke rescue or a second writer');}},
  '@/lib/services/nba/nbaProviderSeason':{currentNbaProviderSeason:()=>2026},
  '@/lib/dates/slateDate':{currentSlateDate:()=>slate},
  '@/lib/cron/playerPropsRefreshTelemetry':{nbaPlayerPropsRefreshFailure:()=>null},
  '@/lib/services/nba/nbaRollingSchedule':{nbaScheduleSeedDates:()=>[slate],loadNbaRollingSchedule:async()=>{scheduleReads++;events.push('schedule');return{games};}},
  '@/lib/services/nba/nbaPlayerPropsLifecycle':{nbaPlayerPropsSlateDate:()=>slate},
  '@/lib/services/nba/nbaPlayerPropsPrivateWriter':{refreshNbaPlayerPropsPrivateCandidate:async(args:Record<string,unknown>)=>{
   assert(held);propsCalls++;sourceCalls++;events.push('props-start');assert.equal(args.writerRunId,'same-owner');assert.equal(args.schedule,games);assert.equal(args.fullRefresh,!options.intraday);assert.equal(args.aiDeadline,start+480000);assert.equal(args.reserveReviewWindow,options.due!==false);assert.equal(args.now,new Date(now).toISOString());
   if(options.due!==false){assert(now<start+339000,'Due props begin before the slow Daily Edge preparation');await pendingProps;}
   if(options.propsFault)throw Error('injected props preparation fault');
   assert(held,'Props must finish before releasing the shared lease');events.push('props-complete');
   return{status:'published_private',providerRequests:12,findings:[],decisions:18};
  }},
  '@/lib/services/nba/seedNbaGamesService':{seedNbaGames:async()=>{assert(held);events.push('seed');if(options.seedFault)throw Error('injected Daily Edge seed fault');return{mode:'updated',errors:[],teamsUpserted:2,gamesUpserted:6};}},
  '@/lib/services/nba/nbaProfessionalGameInputs':{collectNbaProfessionalGameInputs:async()=>{events.push('professional-inputs');return{written:2};}},
  '@/lib/services/nba/refreshNbaTeamRatingsService':{NBA_TEAM_RATINGS_REFRESH_RELEASE:'fixture',refreshNbaTeamRatings:async()=>{events.push('ratings');return ratings;}},
  '@/lib/services/nba/refreshNbaLinesService':{refreshNbaLines:async()=>{throw Error('Unexpected independent line writer');},refreshNbaLineDates:async()=>{
   events.push('lines');now=start+(options.leaseWait??0)+339000;if(!options.manualProps)finishProps();return{failures:[],results:[{date:slate,result:{gamesInDb:6,errors:[],warnings:[]}}]};
  }},
  '@/lib/services/nba/nbaTheOddsApiCurrentOdds':{fetchNbaTheOddsApiCurrentBoard:async()=>{throw Error('No artificial extra quote request');},nbaTheOddsApiSafeDiagnosticError:()=>null},
  '@/lib/services/labResponseSnapshots':{upsertLabResponseSnapshot:async()=>({ok:true})},
  '@/lib/services/labResponseSnapshotWriter':{refreshDailyEdgeResponseSnapshot:async()=>{assert(held);events.push('daily-edge-publish');return{ok:true};}},
 };
 class Clock extends Date{constructor(value?:string|number){super(value??now);}static now(){return now;}}
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync('app/api/cron/nba-daily-refresh/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:(name:string)=>{assert(Object.hasOwn(imports,name),`Unknown route dependency ${name}`);return imports[name];},Date:Clock,URL,Response,process:{env},console:{log(){},error(){}}});
 const run=()=> (exports.GET as (r:Request)=>Promise<Response>)(new Request('https://synthetic.invalid/api/cron/nba-daily-refresh'+(options.intraday?'?intraday=true':'')));
 return{run,events,finish:finishProps,state:()=>({now,held,closed,propsCalls,sourceCalls,scheduleReads})};
}
async function main(){
 for(const intraday of [false,true]){
  const f=fixture({intraday});const result=await f.run();assert.equal(result.status,200);assert.equal(f.state().propsCalls,1);assert.equal(f.state().sourceCalls,1);assert.equal(f.state().scheduleReads,intraday?2:1);assert(f.events.indexOf('props-start')<f.events.indexOf('seed'));assert(f.events.indexOf('schedule')<f.events.indexOf('seed'));assert(f.events.includes('daily-edge-publish'));assert(f.state().closed);assert(f.state().now-start<540000);if(!intraday){assert.equal(f.events.filter(e=>e==='ratings').length,2);assert(f.events.includes('professional-inputs'));}
 }
 const independent=fixture({manualProps:true});let independentClosed=false;const independentRun=independent.run().finally(()=>{independentClosed=true;});for(let i=0;i<40;i++)await Promise.resolve();assert(independent.events.includes("daily-edge-publish"));assert(!independent.events.includes("props-complete"));assert(!independentClosed);assert(independent.state().held);independent.finish();await independentRun;
 const late=fixture({due:false,propsFault:true});const response=await late.run();assert.equal(response.status,200);assert(late.events.indexOf('props-start')>late.events.indexOf('lines'));assert(late.events.includes('daily-edge-publish'));assert.equal(late.state().propsCalls,1);assert.equal((await response.json()).partial,true);
 // A hard Daily Edge failure must not release the sport lease while the one
 // started props invocation is publishing/closing its durable game queue.
 const fault=fixture({seedFault:true});let settled=false;const pending=fault.run().finally(()=>{settled=true;});await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();assert(fault.state().held);assert(!settled);fault.finish();await assert.rejects(pending,/injected Daily Edge seed fault/);assert.equal(fault.state().propsCalls,1);assert(fault.events.indexOf('props-complete')<fault.events.indexOf('lease-close'));
 const wait=fixture({leaseWait:120000});await wait.run();assert.equal(wait.state().propsCalls,1);assert.equal(wait.state().now-start,459000);assert(wait.state().now-start<540000);
 console.log('Actual NBA route two-phase priority passed: six-game due snapshot before 339s Daily Edge work, one exact full/intraday source invocation, unchanged Daily Edge stages, original absolute deadline after 120s lease wait, fault isolation and await-before-lease-close. Offline virtual time only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
