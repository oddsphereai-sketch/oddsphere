import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mock} from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {assertUclPublicationClock,writeUclPredictionRecords,UCL_PREDICTION_WRITER_RELEASE} from "../lib/services/ucl/uclProductionPipeline";
import {UCL_MODEL_RELEASE,UCL_CALIBRATION_RELEASE} from "../lib/services/ucl/uclModel";
import {publicMarketDisplayBook,publicMarketPrelockHeldBook} from "../app/lab/lib/publicMarketDisplayTrail";
import {predictionMarketArchivedBook,predictionMarketHasSharedHistory,predictionMarketComparison,selectedPredictionMarketOutcome} from "../app/lab/lib/predictionMarketDisplay";
import {PredictionMarketChart} from "../app/lab/components/daily-edge/PredictionMarketPanel";
import type {DailyEdgeGameDto,DailyEdgeResponse} from "../app/lab/lib/labTypes";
import type {UclSlate} from "../lib/services/ucl/buildUclSlate";
import type {PrelockReceipt} from "../lib/providers/owls/predictionMarketPrelock";

export async function runUclPublicationClockTests(){
 const fixture=JSON.parse(readFileSync("scripts/fixtures/ucl/late-lock-graph-20261104.json","utf8")) as {rows:Array<{game:DailyEdgeGameDto;archives:PrelockReceipt[]}>};
 let reproduced=0,repaired=0;
 for(const {game,archives} of fixture.rows){
  const original=JSON.stringify(game),oldClock=new Date(game.lockedAt!);
  const candidate={...structuredClone(game),lockState:"open" as const,lockedAt:null};
  const response={games:[candidate]} as DailyEdgeResponse;
  const slate={modelRelease:UCL_MODEL_RELEASE,calibrationRelease:UCL_CALIBRATION_RELEASE,
   matches:[{id:game.external_id,prediction:{release:UCL_MODEL_RELEASE,calibrationRelease:UCL_CALIBRATION_RELEASE}}],competitionContexts:{}} as unknown as UclSlate;
  await assert.rejects(async()=>writeUclPredictionRecords({slate,response,apply:false,now:oldClock}),/clock precedes captured quote evidence/);
  // Simulate a NEW publication at actual input completion, never change the
  // genuine stored Real Madrid/Liverpool lock used to reproduce the defect.
  const quoteTimes=Object.values(candidate.markets).flatMap(m=>[m.currentPriceObservedAt,...(m.oddsTrail??[]).map(s=>s.observedAt),...(m.lineTrail??[]).map(s=>s.observedAt)]).map(s=>Date.parse(s??"")).filter(Number.isFinite);
  const completed=new Date(Math.max(oldClock.getTime(),...quoteTimes)+1000);
  const write=await writeUclPredictionRecords({slate,response,apply:false,now:completed});
  assert.equal(write.proposed.length,4);
  for(const row of write.proposed){
   assert.equal(row.locked_at,completed.toISOString());assert.equal(row.snapshot_json!.captured_at,completed.toISOString());
   assert.equal(row.snapshot_json!.writer_release,UCL_PREDICTION_WRITER_RELEASE);
   const key=row.market==="match_result"?"moneyline":row.market==="total"?"total":"first_inning";
   const m=row.market==="double_chance"?candidate.soccerDoubleChanceMarket!:candidate.markets[key];
   assert.equal(row.model_probability,m.modelProb);assert.equal(row.odds_american,m.currentPriceAmerican);assert.equal(row.play_grade,m.verdict.label);
   assert.deepEqual(row.snapshot_json!.member_projection_at_capture,candidate.soccerProjection);
  }
  for(const key of ["moneyline","total","first_inning"] as const){
   const market=game.markets[key],archive=archives.find(a=>a.key===key&&a.pick===market.pick)!;
   assert(archive?.market&&archive.book);
   const stored=publicMarketDisplayBook(market)!;
   const oldHeld=publicMarketPrelockHeldBook(stored,archive.capturedAt,oldClock.getTime());
   if(!oldHeld)reproduced++;
   const held=publicMarketPrelockHeldBook(stored,archive.capturedAt,completed.getTime());assert(held);
   const book=predictionMarketArchivedBook(held,archive.book,archive.capturedAt,completed.getTime(),archive.line)!;
   assert.equal(book.sportsbook,stored.sportsbook);assert.deepEqual(book.points.at(-1),stored.points.at(-1));
   const outcome=selectedPredictionMarketOutcome(archive.market,market.pick);assert(outcome);
   assert(predictionMarketHasSharedHistory(predictionMarketComparison(outcome,book,completed.getTime())));
   for(const variant of ["desktop","mobile"]){
    const html=renderToStaticMarkup(createElement("section",{"data-layout":variant},createElement(PredictionMarketChart,{row:outcome,book,context:archive.market.context,bookLabel:market.pick!,lockedAt:completed.getTime()})));
    assert.match(html,/data-kalshi-line="true"/);assert(html.includes(`data-sportsbook-line="${book.sportsbook}"`));assert.doesNotMatch(html,/NaN|Infinity/);
   }
   repaired++;
   assert.deepEqual(publicMarketPrelockHeldBook(stored,archive.capturedAt,oldClock.getTime()),oldHeld,"the real old locked graph keeps its original semantics");
  }
  assert.doesNotThrow(()=>assertUclPublicationClock({games:[game]},oldClock),"an existing stored lock is never revalidated/mutated under new clock semantics");
  assert.equal(JSON.stringify(game),original);
 }
 assert.equal(reproduced,4,"reproduce Madrid MR and Liverpool MR/Total/BTTS missing curves");assert.equal(repaired,6,"future captures retain both traces in all three markets for both actual fixtures");
 await routeClock();
 console.log("PASS UCL completed-input publication clock: four actual missing-book cases, all six future market graphs/two layouts, exact numerical parity, legacy locked bytes, shared write/verification clock and unchanged lease/cadence");
}

async function routeClock(){
 const requestStart=Date.parse("2026-11-04T16:44:59.500Z"),deadline=Date.parse("2026-11-04T16:45:00Z");
 mock.timers.enable({apis:["Date"],now:requestStart});
 let quoteAt=0,writeAt=0;const response={games:[]} as unknown as DailyEdgeResponse;
 const advance=(ms:number)=>mock.timers.tick(ms);
 const mocks:Record<string,unknown>={
  "@/lib/cron/runCron":{cronHandler:async(_request:Request,source:string,body:()=>Promise<unknown>,options:Record<string,unknown>)=>{
   assert.equal(source,"ucl_daily_refresh");assert.equal(options.leaseGroup,"prediction_pipeline");assert.equal(options.requireLease,true);assert.equal(options.minIntervalMinutes,15);return Response.json(await body());}},
  "@/lib/services/ucl/uclFeatureFlags":{resolveUclFeatureFlags:()=>({refresh:true,writes:true,publication:true})},
  "@/lib/services/ucl/buildUclSlate":{buildUclSlate:async()=>{advance(4000);return {matches:[],round:4,boardDate:"2026-11-04",modelRelease:UCL_MODEL_RELEASE,calibrationRelease:UCL_CALIBRATION_RELEASE,providerHealth:{uclHistory:{status:"ready"}}};}},
  "@/lib/services/ucl/uclMemberSnapshotStore":{readCurrentUclMemberSnapshot:async()=>null,writeCurrentUclMemberSnapshot:async()=>({ok:true})},
  "@/lib/services/ucl/uclLineHistoryStore":{readUclStoredPriceHistory:async()=>{advance(3000);return [];},persistUclLineHistory:async()=>{advance(1000);return {proposed:0,written:0,errors:[]};}},
  "@/lib/services/ucl/buildUclDailyEdgePreview":{hydrateUclPriceHistory:()=>{},hydrateUclStoredPriceHistory:()=>{},buildUclDailyEdgePreview:async()=>{advance(4000);quoteAt=Date.now();return response;}},
  "@/lib/services/ucl/uclPublicSplitSource":{captureStoredUclPublicSplits:async()=>{advance(2000);return {};}},
  "@/lib/services/ucl/uclCompetitionContext":{UCL_COMPETITION:"uefa_champions_league"},
  "@/lib/services/ucl/uclPublicationReadiness":{evaluateUclPublicationCoverage:()=>({hardErrors:[],errors:[],priceCollapse:false}),uclPriceCollapseIsRecovered:()=>false},
  "@/lib/services/ucl/uclProductionPipeline":{seedUclSlate:async()=>{advance(3000);return {teamsWritten:0,gamesWritten:0,errors:[]};},
   writeUclPredictionRecords:async(args:{now:Date})=>{writeAt=args.now.getTime();assert(writeAt>=quoteAt);assert.equal(writeAt,Date.now());return {mode:"write",proposed:[],written:0,lockedPreserved:0,lockedRecordIds:[],errors:[]};},
   verifyUclRefreshAllMarketLocks:async(args:{now:Date})=>{assert.equal(args.now.getTime(),writeAt);assert(writeAt>=deadline,"a request crossing T-60 is classified at completed-input time");return {dueProviderIds:[],completeProviderIds:[],incompleteProviderIds:[],lockedResponse:response};}},
 };
 try{
  const compiled=ts.transpileModule(readFileSync("app/api/cron/ucl-daily-refresh/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const route={exports:{} as {GET:(r:Request)=>Promise<Response>}};
  new Function("require","exports",compiled)((name:string)=>{if(!(name in mocks))throw Error("Unmocked route dependency "+name);return mocks[name];},route.exports);
  const result=await route.exports.GET(new Request("https://example.test/api/cron/ucl-daily-refresh"));assert.equal(result.status,200);assert(writeAt>requestStart);
 }finally{mock.timers.reset();}
}
if(process.argv[1]?.endsWith("test-ucl-publication-clock.tsx"))runUclPublicationClockTests().catch(e=>{console.error(e);process.exitCode=1;});
