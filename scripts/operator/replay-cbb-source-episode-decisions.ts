/** File-only functional comparison. No provider, DB, writer or live forecast. */
import fs from "node:fs";
import {createHash} from "node:crypto";
import {readCbbMarketBehavior,CBB_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_MARKET_BEHAVIOR_GRADE_RELEASE} from "../../lib/cbb/marketBehaviorCandidate";
import {expandCbbMarketBehaviorPathStream} from "../../lib/cbb/marketBehaviorPath";
import {CBB_CURRENT_SCORE_RELEASE} from "../../lib/cbb/currentScoreRuntime";
import {buildCbbProvisionalBoard} from "../../lib/cbb/provisionalBoard";
import type {CbbForecast,CbbQuote} from "../../lib/cbb/types";
const path=process.argv[2];if(!path)throw new Error("Provide a preserved original board JSON; this operator never fetches inputs");
const bytes=fs.readFileSync(path),input=JSON.parse(bytes.toString()),rows=input.rows;
if(!Array.isArray(rows)||rows.length>500)throw new Error("Invalid bounded board artifact");
const tally=(items:string[])=>items.reduce((out,key)=>(out[key]=(out[key]??0)+1,out),{} as Record<string,number>);
const actionable=(grade:string)=>grade==="Lean"||grade==="Best Angle";
const cases=[],refused=[];
for(const stored of rows){
 const payload=stored.payload??stored,snapshot=payload.snapshot,board=snapshot?.board,old=board?.marketContext?.verifiedMarketRead;
 if(!snapshot||!board||!old||snapshot.lockedAt){refused.push({gameId:snapshot?.gameId??null,reason:snapshot?.lockedAt?"immutable_locked_payload":"missing_original_receipt"});continue;}
 const retained=board.marketContext.retainedLevelInput;
 if(!retained?.independent||old.independentRelease!==CBB_CURRENT_SCORE_RELEASE){refused.push({gameId:board.gameId,reason:"missing_exact_independent_input"});continue;}
 const independent:CbbForecast={...retained.independent,...old.forecastIdentity,release:old.independentRelease,asOf:old.evaluatedAt,
  margin:old.independentScore.margin,total:old.independentScore.total,homeScore:old.independentScore.home,awayScore:old.independentScore.away,
  homeWinProbability:old.independentScore.homeWinProbability,uncertainty:old.frozenUncertainty};
 const expanded=old.pathTape.streams.map((stream:Parameters<typeof expandCbbMarketBehaviorPathStream>[1])=>expandCbbMarketBehaviorPathStream(old.pathTape,stream));
 const historyQuotes:CbbQuote[]=expanded.flatMap((s:ReturnType<typeof expandCbbMarketBehaviorPathStream>)=>s.quotes);
 const historyFlows=expanded.flatMap((s:ReturnType<typeof expandCbbMarketBehaviorPathStream>)=>s.flows);
 const currentQuotes=[...old.currentProfessionalQuotes,...old.evaluatedTargets];
 const context=input.contextByGame?.[String(board.gameId)];
 if(context&&context.decisionAt!==old.evaluatedAt)throw new Error("Stored context decision cutoff mismatch");
 const read=readCbbMarketBehavior({independent,independentInputKey:old.independentInputKey,startsAt:snapshot.startsAt,
  targets:old.evaluatedTargets,currentQuotes,anchors:old.anchors,historyQuotes:[...historyQuotes,...(context?.historyQuotes??[])],
  historyFlows:[...historyFlows,...(context?.historyFlows??[])],previousPath:old.pathTape,
  splitContext:context?.decisionSplits??old.splitContext??[],contextQuotes:context?.contextQuotes??[],
  quarantinedSources:context?.quarantinedSources??[],historyCompleteness:context?.completeness??old.historyCompleteness});
 const next=buildCbbProvisionalBoard(read.forecast,currentQuotes,{marketBehavior:read.receipt});
 const markets=next.rows.map(market=>{
  const prior=board.rows.find((row:{market:string})=>row.market===market.market);
  return {market:market.market,line:market.line,price:market.price,beforeGrade:prior.grade,afterGrade:market.grade,
   beforeSelection:prior.selection,afterSelection:market.selection,beforeProbability:prior.probability,afterProbability:market.probability,
   beforeEV:prior.expectedValue,afterEV:market.expectedValue,reason:market.reason,
   economicPathConfirmation:market.economicPathConfirmation,actualActionConfirmation:market.actualActionConfirmation,
   pathResistance:market.pathResistance};
 });
 cases.push({gameId:board.gameId,asOf:board.asOf,home:payload.memberGame?.homeTeamDisplayName,away:payload.memberGame?.awayTeamDisplayName,
  independent:old.independentScore,beforeScore:board.score,afterScore:next.score,axes:{margin:read.receipt.margin,total:read.receipt.total},
  splitContexts:read.receipt.splitContext.length,pressureDecisions:read.receipt.pressureDecisions.length,markets});
}
const markets=cases.flatMap(row=>row.markets),promoted=markets.filter(row=>!actionable(row.beforeGrade)&&actionable(row.afterGrade)).length,
 demoted=markets.filter(row=>actionable(row.beforeGrade)&&!actionable(row.afterGrade)).length;
if(!fs.readFileSync(path).equals(bytes))throw new Error("Input changed during replay");
console.log(JSON.stringify({scope:"file_only_functional_replay_no_historical_publication_or_accuracy_claim",source:path,
 sourceSha256:createHash("sha256").update(bytes).digest("hex"),release:{model:CBB_MARKET_BEHAVIOR_MODEL_RELEASE,grade:CBB_MARKET_BEHAVIOR_GRADE_RELEASE},
 inputCapturedAt:input.capturedAt??null,games:cases.length,refused,beforeGrades:tally(markets.map(row=>row.beforeGrade)),afterGrades:tally(markets.map(row=>row.afterGrade)),
 actionableBefore:markets.filter(row=>actionable(row.beforeGrade)).length,actionableAfter:markets.filter(row=>actionable(row.afterGrade)).length,
 actionablePromotions:promoted,actionableDemotions:demoted,tierPromotions:markets.filter(row=>row.beforeGrade==="Lean"&&row.afterGrade==="Best Angle").length,
 tierDemotions:markets.filter(row=>row.beforeGrade==="Best Angle"&&row.afterGrade==="Lean").length,
 sideChanges:markets.filter(row=>row.beforeSelection!==row.afterSelection).length,
 axisChanges:cases.reduce((count,row)=>count+Number(Math.abs(row.beforeScore.margin-row.afterScore.margin)>1e-8)+Number(Math.abs(row.beforeScore.total-row.afterScore.total)>1e-8),0),
 sourceLimit:"Only original stored receipt inputs replayed; absent retail/public inputs are not reconstructed or fabricated",
 providerRequests:0,databaseQueries:0,productionWrites:0,cases},null,2));
