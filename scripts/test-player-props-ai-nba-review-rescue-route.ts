/** Execute the actual route with isolated imports and clocks. No I/O or paid API. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {validateCronAuth} from '../lib/cron/auth';

async function main(){
  const original={...process.env};
  try{
    process.env.CRON_SECRET='synthetic-cron-secret';
    process.env.ODDSPHERE_CRONS_DISABLED='false';
    const source=readFileSync('app/api/cron/nba-daily-refresh/route.ts','utf8');
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const events:string[]=[],start=Date.parse('2026-11-10T17:51:00Z');let now=start,due=true,leaseWait=0;
    const env={NBA_CRON_ENABLED:'true',NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED:'true'};
    class Clock extends Date{constructor(value?:string|number){super(value??now);}static now(){return now;}}
    const client={synthetic:true},exports:Record<string,unknown>={};
    const forbidden=new Proxy({}, {get:(_target,key)=>()=>{throw Error(`Unrelated route work: ${String(key)}`);}});
    const imports:Record<string,unknown>={
      '@/lib/db/supabase':{supabase:client},
      '@/lib/cron/auth':{validateCronAuth},
      '@/lib/playerPropsAi/dueReview':{hasDuePropsAiReview:async(args:{client:unknown;now:string;sport:string})=>{events.push('hint');assert.equal(args.client,client);assert.equal(args.sport,'nba');assert.equal(args.now,new Date(start).toISOString());return due;}},
      '@/lib/cron/runCron':{cronHandler:async(request:Request,name:string,handler:(ctx:{runId:string})=>Promise<unknown>,opts:Record<string,unknown>)=>{
        events.push('lease');assert.equal(name,'nba_daily_refresh');assert.equal(validateCronAuth(request).ok,true);assert.equal(opts.sport,'nba');assert.equal(opts.leaseGroup,'prediction_pipeline');assert.equal(opts.requireLease,true);assert.equal(opts.lockMinutes,10);assert.equal(opts.leaseRetryMaxWaitMs,120000);assert.equal(opts.leaseRetryIntervalMs,1000);now+=leaseWait;await handler({runId:'existing-nba-lease-owner'});return Response.json({ok:true});}},
      '@/lib/playerPropsAi/nbaReviewRescue':{runNbaPropsReviewRescue:async(args:{client:unknown;writerRunId:string;requestStartedAt:number})=>{events.push('same-writer-rescue');assert.equal(args.client,client);assert.equal(args.writerRunId,'existing-nba-lease-owner');assert.equal(args.requestStartedAt,start);assert.equal(now-args.requestStartedAt,leaseWait);return {records_updated:0};}},
    };
    vm.runInNewContext(code,{exports,require:(name:string)=>imports[name]??forbidden,Date:Clock,URL,Response,console,process:{env}},{filename:'actual-nba-daily-refresh-route.cjs'});
    const get=exports.GET as (request:Request)=>Promise<Response>;
    const request=(authorized=true)=>new Request('https://synthetic.invalid/api/cron/nba-daily-refresh?propsReviewRescue=true',{headers:authorized?{Authorization:'Bearer synthetic-cron-secret'}:{}});
    assert.equal((await get(request(false))).status,401);assert.deepEqual(events,[],'auth precedes DB and lease');
    env.NBA_CRON_ENABLED='false';assert.equal((await get(request())).status,200);assert.deepEqual(events,[]);env.NBA_CRON_ENABLED='true';
    env.NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED='false';await get(request());assert.deepEqual(events,[]);env.NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED='true';
    due=false;await get(request());assert.deepEqual(events,['hint']);events.length=0;
    due=true;leaseWait=120000;await get(request());assert.deepEqual(events,['hint','lease','same-writer-rescue']);
    const config=JSON.parse(readFileSync('vercel.json','utf8')) as {crons:{path:string;schedule:string}[]};
    assert.deepEqual(config.crons.filter(row=>row.path==='/api/cron/nba-daily-refresh?propsReviewRescue=true'),[{path:'/api/cron/nba-daily-refresh?propsReviewRescue=true',schedule:'21,51 0-5,13-23 * * *'}]);
    assert.ok(config.crons.some(row=>row.path==='/api/cron/nba-daily-refresh?intraday=true'&&row.schedule==='12,42 0-5,13-23 * * *'));
    console.log('NBA pending-review route: authenticated due-only preflight, same lease/writer, original absolute clock and unchanged primary cadence passed');
  }finally{for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
