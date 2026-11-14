/** Execute the actual route with isolated imports and clocks. No I/O or paid API. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {validateCronAuth} from '../lib/cron/auth';
import {NBA_ROLLING_SCHEDULE_RELEASE} from '../lib/services/nba/nbaRollingSchedule';
import {runNbaPropsReviewRescue} from '../lib/playerPropsAi/nbaReviewRescue';
import {summarizePropsAiRuntimeHealth} from '../lib/playerPropsAi/runtimeHealth';
import type {CronHandlerResult} from '../lib/cron/runCron';
import type {NbaPlayerPropsPrivateWriterResult} from '../lib/services/nba/nbaPlayerPropsPrivateWriter';

globalThis.fetch=async()=>{throw Error('Rescue route proof forbids HTTP/model/provider calls');};

async function main(){
  const original={...process.env};
  try{
    process.env.CRON_SECRET='synthetic-cron-secret';
    process.env.ODDSPHERE_CRONS_DISABLED='false';
    const source=readFileSync('app/api/cron/nba-daily-refresh/route.ts','utf8');
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const events:string[]=[],start=Date.parse('2026-11-10T17:51:00Z');let now=start,due=true,leaseWait=0;
    const env={NBA_CRON_ENABLED:'true',NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED:'true',PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'true',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-ai-only',BALLDONTLIE_API_KEY:'synthetic-bdl-only'};
    let runtime=summarizePropsAiRuntimeHealth({status:'active',games:[],findings:[],newlyCompletedReviews:1},new Date(start).toISOString());
    const writerResult=():NbaPlayerPropsPrivateWriterResult=>({release:'synthetic-release' as NbaPlayerPropsPrivateWriterResult['release'],publicEnabled:false,status:'published_private',providerRequests:3,theOddsApiCreditsUsed:0,observationsAdded:6,observationsRefreshed:4,observationConflictsPreserved:0,featureRows:5,decisions:4,locked:1,findings:[],aiReviewRuntime:runtime});
    class Clock extends Date{constructor(value?:string|number){super(value??now);}static now(){return now;}}
    const client={synthetic:true},exports:Record<string,unknown>={};
    const forbidden=new Proxy({}, {get:(_target,key)=>()=>{throw Error(`Unrelated route work: ${String(key)}`);}});
    const imports:Record<string,unknown>={
      '@/lib/db/supabase':{supabase:client},
      '@/lib/cron/auth':{validateCronAuth},
      '@/lib/playerPropsAi/dueReview':{hasDuePropsAiReview:async(args:{client:unknown;now:string;sport:string})=>{events.push('hint');assert.equal(args.client,client);assert.equal(args.sport,'nba');assert.equal(args.now,new Date(start).toISOString());return due;}},
      '@/lib/cron/runCron':{cronHandler:async(request:Request,name:string,handler:(ctx:{runId:string})=>Promise<CronHandlerResult>,opts:Record<string,unknown>)=>{
        events.push('lease');assert.equal(name,'nba_daily_refresh');assert.equal(validateCronAuth(request).ok,true);assert.equal(opts.sport,'nba');assert.equal(opts.leaseGroup,'prediction_pipeline');assert.equal(opts.requireLease,true);assert.equal(opts.lockMinutes,10);assert.equal(opts.leaseRetryMaxWaitMs,120000);assert.equal(opts.leaseRetryIntervalMs,1000);now+=leaseWait;const result=await handler({runId:'existing-nba-lease-owner'});return Response.json({...result,status:result.partial?'partial':'ok'});}},
      '@/lib/playerPropsAi/nbaReviewRescue':{runNbaPropsReviewRescue:async(args:Parameters<typeof runNbaPropsReviewRescue>[0])=>{
        events.push('same-writer-rescue');assert.equal(args.client,client);assert.equal(args.writerRunId,'existing-nba-lease-owner');assert.equal(args.requestStartedAt,start);assert.equal(now-args.requestStartedAt,leaseWait);
        return runNbaPropsReviewRescue({...args,clock:()=>now,env},{
          hasDue:async()=>{events.push('inside-due');return true;},slateDate:()=> '2026-11-10',providerSeason:()=>2026,
          loadSchedule:async()=>{events.push('cached-schedule');return {release:NBA_ROLLING_SCHEDULE_RELEASE,anchorDate:'2026-11-10',throughDate:'2026-11-16',games:[]};},
          writeCandidate:async value=>{events.push('canonical-writer');assert.equal(value.writerRunId,args.writerRunId);assert.equal(value.aiDeadline,start+480000);assert.equal(value.fullRefresh,false);assert.equal(value.reserveReviewWindow,true);return writerResult();},
        });
      }},
    };
    vm.runInNewContext(code,{exports,require:(name:string)=>imports[name]??forbidden,Date:Clock,URL,Response,console,process:{env}},{filename:'actual-nba-daily-refresh-route.cjs'});
    const get=exports.GET as (request:Request)=>Promise<Response>;
    const request=(authorized=true)=>new Request('https://synthetic.invalid/api/cron/nba-daily-refresh?propsReviewRescue=true',{headers:authorized?{Authorization:'Bearer synthetic-cron-secret'}:{}});
    assert.equal((await get(request(false))).status,401);assert.deepEqual(events,[],'auth precedes DB and lease');
    env.NBA_CRON_ENABLED='false';assert.equal((await get(request())).status,200);assert.deepEqual(events,[]);env.NBA_CRON_ENABLED='true';
    env.NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED='false';await get(request());assert.deepEqual(events,[]);env.NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED='true';
    due=false;await get(request());assert.deepEqual(events,['hint']);events.length=0;
    due=true;leaseWait=120000;const healthy=await (await get(request())).json();assert.equal(healthy.status,'ok');assert.equal(healthy.records_updated,1);assert.deepEqual(events,['hint','lease','same-writer-rescue','inside-due','cached-schedule','canonical-writer']);
    for(const[status,findings,count,partial]of[
      ['unavailable',['ai_operational_fallback_keep_independent'],0,true],
      ['active',['current_source_unavailable:synthetic-game:unclassified'],0,true],
      ['active',['review_deferred_writer_inventory_deadline'],0,true],
      ['active',[],2,false],['active',[],0,false],['paid_disabled',[],0,false],
    ]as const){
      now=start;events.length=0;runtime=summarizePropsAiRuntimeHealth({status,games:[],findings:[...findings],newlyCompletedReviews:count},new Date(start).toISOString());
      const before=JSON.stringify(runtime),result=await(await get(request())).json();
      assert.equal(result.status,partial?'partial':'ok');assert.equal(result.partial,partial?true:undefined);assert.equal(result.records_updated,1);assert.equal(result.api_calls_made,3);
      if(partial)assert.match(result.error_message,/scheduled.*coverage unverified/);else assert.equal(result.error_message,undefined);
      assert.equal(result.details.aiReviewRuntime.newlyCompletedReviews,count);assert.equal(result.details.review_completion,'verify_normal_slot_ledger_separately');assert.equal(JSON.stringify(runtime),before);
      assert.deepEqual(events,['hint','lease','same-writer-rescue','inside-due','cached-schedule','canonical-writer'],'Actual route dispatch invokes the same helper and one canonical writer; no unrelated work or retry');
    }
    for(const[path,forbiddenImport]of[['lib/cron/playerPropsRefreshTelemetry.ts','nbaPlayerPropsPrivateWriter'],['lib/cron/playerPropsRefreshTelemetry.ts','mlb/props/liveBoard'],['lib/playerPropsAi/runtimeHealth.ts','siteRuntime']]){
      const emitted=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      assert(!emitted.includes(`require("${forbiddenImport}")`));assert(!new RegExp(`require\\([^)]*${forbiddenImport.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`).test(emitted),'Health dependencies on writers/runtime remain type-only');
    }
    const config=JSON.parse(readFileSync('vercel.json','utf8')) as {crons:{path:string;schedule:string}[]};
    assert.deepEqual(config.crons.filter(row=>row.path==='/api/cron/nba-daily-refresh?propsReviewRescue=true'),[{path:'/api/cron/nba-daily-refresh?propsReviewRescue=true',schedule:'21,51 0-5,13-23 * * *'}]);
    assert.ok(config.crons.some(row=>row.path==='/api/cron/nba-daily-refresh?intraday=true'&&row.schedule==='12,42 0-5,13-23 * * *'));
    console.log('NBA pending-review actual route/helper: authenticated due-only preflight, same lease/one writer, original absolute clock/cadence; native publication plus private partial for unavailable/current-source/inventory failures, healthy new/retained/paid-disabled controls and erased type-only writer/runtime dependencies passed. No HTTP or paid calls.');
  }finally{for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
