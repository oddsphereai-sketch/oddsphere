import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sport } from "../lib/types/domain/Sport";
import { readMarketCaptureActivity } from "../lib/services/dailyEdge/marketCaptureActivity";

function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Request, Response, console, process: { env: {
    OWLS_INSIGHT_API_KEY: "test", PUBLIC_SPLITS_OBSERVATIONS_ENABLED: "true",
  } }, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
    return dependencies[name];
  } }, { filename: file });
  return exports as { GET(request: Request): Promise<Response> };
}

async function main() {
  let rows: {id: number}[] = [];
  let error: object | null = null;
  let throws = false;
  const reads: unknown[][] = [];
  const client = { from(table: string) {
    const query: unknown[] = [table]; reads.push(query);
    const chain = {
      select(v: string) { query.push(["select",v]); return chain; },
      eq(k: string,v: string) { query.push([k,v]); return chain; },
      gte(k: string,v: string) { query.push(["gte",k,v]); return chain; },
      lte(k: string,v: string) { query.push(["lte",k,v]); return chain; },
      limit(v: number) { query.push(["limit",v]); return chain; },
      async abortSignal(signal: AbortSignal) { assert.ok(signal instanceof AbortSignal); if(throws)throw Error("unavailable"); return {data:rows,error}; },
    };return chain;
  } } as unknown as SupabaseClient;
  const now = new Date("2026-11-03T02:00:00Z"); // still November 2 ET after DST
  for(const sport of ["mlb","wnba"] as const) {
    const activity=await readMarketCaptureActivity({client,sport,now});
    assert.equal(activity.skip,true);
    assert.equal(activity.reason,"no_canonical_games_in_capture_window");
    assert.equal(activity.slate,"2026-11-02"); assert.equal(activity.through,"2026-11-08");
    assert.deepEqual(reads.at(-1),["games",["select","id"],["sport",sport],["gte","slate_date","2026-11-02"],["lte","slate_date","2026-11-08"],["limit",1]]);
    rows=[{id:1}];
    assert.equal((await readMarketCaptureActivity({client,sport,now})).skip,false,"a real late postseason/current/upcoming game resumes capture without a season whitelist");
    rows=[];error={message:"unavailable"};
    assert.equal((await readMarketCaptureActivity({client,sport,now})).skip,false,"database failure does not prove an empty slate");
    error=null;throws=true;
    assert.equal((await readMarketCaptureActivity({client,sport,now})).skip,false);
    throws=false;
  }
  const before=reads.length;
  for(const sport of ["nba","nhl","nfl","cfb","cbb","soccer","ucl"] as Sport[]) {
    assert.equal((await readMarketCaptureActivity({client,sport,now})).skip,false);
  }
  assert.equal(reads.length,before,"no additional DB/provider requests for active Daily Edge sports");

  let sports: Sport[]=["mlb","wnba"];
  const calls: string[]=[];
  const deps: Record<string,unknown>={
    "@/lib/db/supabase":{supabase:client},
    "@/lib/services/dailyEdge/marketCaptureActivity":{readMarketCaptureActivity},
    "@/lib/cron/runCron":{async cronHandlerPerSport(_r:Request,source:string,_sports:Sport[],fn:(x:{sport:Sport})=>Promise<unknown>,options:Record<string,unknown>){
      if(source==="public_splits_observations_refresh") { assert.equal(options.leaseGroup,"prediction_pipeline");assert.equal(options.requireLease,true); }
      else {assert.equal(options.minIntervalMinutes,4);assert.equal(options.lockMinutes,2);}
      const runs=[];for(const sport of sports)runs.push({sport,result:await fn({sport})});return Response.json({runs});
    }},
    "@/lib/providers/real_api/sharpApiCurrentSplits":{async refreshOwlsCurrentSplitFallback(sport:Sport){calls.push(`named:${sport}`);return 2;}},
    "@/lib/services/dailyEdge/predictionMarketDisplayFeed":{async refreshPredictionMarketDisplayFeed(sport:Sport){calls.push(`prediction:${sport}`);return {rows:3,warnings:[],owlsRequests:2};}},
    "@/lib/providers/owls/predictionMarketContracts":{contractKinds:()=>[]},
    "@/lib/cbb/exactSplitIdentity":{CBB_SHARP_SPLIT_MAPPING_RELEASE:"unchanged"},
    "@/lib/services/syncPublicSplitsObservations":{async syncPublicSplitsObservations({sport}:{sport:Sport}){calls.push(`public:${sport}`);return {upserted:2,errors:[],skippedTableMissing:false};}},
    "@/lib/dates/slateDate":{currentSlateDate:()=>"2026-11-02",addDaysToSlate:()=>"2026-11-08"},
    "@/lib/services/marketIntelligenceV2/scheduledCollection":{async runScheduledMarketIntelligenceV2Collection({sport}:{sport:Sport}){calls.push(`v2:${sport}`);return {recordsUpdated:3,apiCallsMade:2,errors:[]};}},
    "@/lib/services/labResponseSnapshotWriter":{async refreshDailyEdgeResponseSnapshot({sport}:{sport:Sport}){calls.push(`snapshot:${sport}`);return {ok:true};}},
  };
  const sharp=load("app/api/cron/sharp-book-splits-refresh/route.ts",deps);
  const pub=load("app/api/cron/public-splits-observations-refresh/route.ts",deps);
  const request=new Request("https://example.test/api/cron/capture");
  for(const route of [sharp,pub]) {
    const response=await (await route.GET(request)).json();
    assert.equal(response.runs.length,2);
    for(const run of response.runs){assert.equal(run.result.api_calls_made,0);assert.equal(run.result.records_updated,0);assert.equal(run.result.details.skipped,true);}
  }
  assert.equal(calls.length,0,"empty MLB/WNBA capture reaches no provider, historical backfill, observation write, or member/lock publisher");
  rows=[{id:1}];sports=["mlb","wnba","nba","nhl","nfl","cfb","cbb","soccer","ucl"];
  const sharpResult=await (await sharp.GET(request)).json();
  for(const run of sharpResult.runs){assert.equal(run.result.records_updated,run.sport==="soccer"||run.sport==="ucl"?3:5);assert.equal(run.result.partial,false);}
  assert.equal(calls.filter(c=>c.startsWith("prediction:")).length,9);
  assert.equal(calls.filter(c=>c.startsWith("named:")).length,7);
  calls.length=0;sports=["mlb","wnba","nba","nhl","nfl","cfb","cbb"];
  const pubResult=await (await pub.GET(request)).json();
  for(const run of pubResult.runs){assert.equal(run.result.records_updated,6);assert.equal(run.result.api_calls_made,3);assert.equal(run.result.partial,false);}
  assert.equal(calls.length,21,"scheduled games preserve each existing source and sole snapshot path");
  console.log("PASS empty MLB/WNBA slates spend zero capture calls/writes; real games resume all sources, other sports stay exact, read failures do not suppress capture, ET windows and existing lease/cadence preserved");
}
main().catch(e=>{console.error(e);process.exitCode=1});
