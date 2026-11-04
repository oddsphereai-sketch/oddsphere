import assert from "node:assert/strict";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {readCbbMarketBehavior} from "../lib/cbb/marketBehaviorCandidate";
import {buildCbbProvisionalBoard} from "../lib/cbb/provisionalBoard";
import {reviewCbbQuote} from "../lib/cbb/marketEvidence";
import {invertCbbJointMarginLaw} from "../lib/cbb/jointMarketLaw";
import type {CbbForecast,CbbQuote} from "../lib/cbb/types";

const asOf="2026-11-04T18:30:00Z",startsAt="2026-11-05T01:00:00Z";
// Actual NKU/SDAK independent mean/shape, with a controlled native chronology
// analogous to the saved 21:47 receipt. Source levels are not final forecasts.
const independent:CbbForecast={release:CBB_CURRENT_SCORE_RELEASE,gameId:10882621,homeId:330,awayId:172,asOf,
 homeScore:83.40597451310117,awayScore:79.6979848450105,total:163.10395935811167,margin:3.707989668090686,
 homeWinProbability:.6264344542949807,possessions:74.94636275658827,inputStatus:"complete",issues:[],
 uncertainty:{games:11383,totalSd:16.993742849108834,marginSd:11.882808501656784,totalCorrection:.822132324525501,
  fitThroughSeason:2024,marginCorrection:-.13713535132332144,marginTotalCorrelation:.025514787619637783}};
const q=(market:CbbQuote["market"],line:number|null,a:number,b:number,time:string,book="circa"):CbbQuote&{orientationVerified:true}=>({
 gameId:independent.gameId,market,line,firstPrice:a,secondPrice:b,sportsbook:book,provider:"owls",phase:"current",
 orientationVerified:true,providerObservedAt:`2026-11-04T${time}:00Z`,fetchedAt:`2026-11-04T${time}:30Z`});
const historyQuotes=[q("moneyline",null,120,-140,"18:00"),q("spread",2.5,-110,-110,"18:00"),
 q("moneyline",null,110,-130,"18:10"),q("spread",2,-115,-105,"18:10"),
 q("moneyline",null,110,-130,"18:20"),q("spread",2,-115,-105,"18:20")];
const targets=[q("moneyline",null,118,-142,"18:25","fanduel"),q("spread",2.5,-110,-110,"18:25","fanduel"),
 q("total",162.5,-108,-112,"18:25","fanduel")].map(x=>({...x,requestedAt:"2026-11-04T18:24:00Z"}));
const flow={provider:"owls" as const,gameId:independent.gameId,sourceBook:"circa",market:"moneyline" as const,line:null,
 firstMoney:.01,secondMoney:.99,firstTickets:.67,secondTickets:.33,sourceEventId:"native:nku-sdak",
 sourceIdentity:"independent_named_fixture_join" as const,orientationVerified:true,
 observedAt:"2026-11-04T18:05:00Z",fetchedAt:"2026-11-04T18:06:00Z"};
const args={independent,independentInputKey:"native-counterpressure-nku-sdak",startsAt,targets,
 currentQuotes:historyQuotes.slice(-2),historyQuotes,flows:[flow],anchors:null};
const read=readCbbMarketBehavior(args),withoutPressure=readCbbMarketBehavior({...args,flows:[]});
const native=invertCbbJointMarginLaw(independent,args.currentQuotes[0],args.currentQuotes[1]);
assert.equal(native.status,"identified");
assert.ok(Math.abs(read.forecast.margin-native.margin!)<1e-12);
assert.equal(read.forecast.uncertainty.marginSd,native.marginSd);
assert.notEqual(read.forecast.margin,independent.margin,"directional evidence cannot install the entire independent score law");
assert.notEqual(read.forecast.homeWinProbability,independent.homeWinProbability);
assert.deepEqual(read.receipt.finalScore,withoutPressure.receipt.finalScore);
assert.deepEqual(read.forecast.uncertainty,withoutPressure.forecast.uncertainty);
assert.equal(read.receipt.jointMarginDecision?.relativeInterpretation?.disposition,"source_level_selected");
const response=read.receipt.pressureDecisions.find(p=>p.book==="circa"&&p.market==="moneyline")!;
assert.equal(response.reaction,"against_money");assert.equal(response.reactionDirection,1);
assert.equal(response.moneyDirection,-1);assert.equal(response.resolution,"ongoing");

function coherent(result:ReturnType<typeof readCbbMarketBehavior>,priced:CbbQuote[],sources:CbbQuote[]){
 const board=buildCbbProvisionalBoard(result.forecast,[...priced,...sources],{marketBehavior:result.receipt});
 assert.deepEqual(board.score,result.receipt.finalScore);
 assert.ok(Math.abs(board.score.home-board.score.away-board.score.margin)<1e-12);
 assert.ok(Math.abs(board.score.home+board.score.away-board.score.total)<1e-12);
 for(const target of priced){
  const expected=reviewCbbQuote(result.forecast,target),row=board.rows.find(r=>r.market===target.market)!;
  assert.equal(row.selection,expected.selection);assert.equal(row.probability,expected.probability);
  assert.equal(row.pushProbability,expected.pushProbability);
  assert.ok(Math.abs(row.expectedValue!-expected.expectedValue)<1e-12);
  if(row.expectedValue!<0)assert.equal(row.grade,"Watchlist","pressure cannot create an actionable negative-value prediction");
 }
 return board;
}
const board=coherent(read,targets,args.currentQuotes);
assert.equal(board.rows.find(r=>r.market==="moneyline")?.grade,"Watchlist");
assert.equal(board.rows.find(r=>r.market==="spread")?.grade,"Watchlist");
assert.ok(Math.abs(board.rows.find(r=>r.market==="moneyline")!.probability!-.5427435387673958)<1e-12);

// Paired R17 golden behaviors were exercised by the removed handoff suite:
// its whole-prior takeover made SDAK+2.5 Lean and NKU+5.5 Watch. Restoring
// current-source economics must permit both directions of the correction.
// These are controlled regression cases, not a board-count compensation quota.
const oldSdaK=reviewCbbQuote(independent,targets.find(t=>t.market==="spread")!);
assert.equal(oldSdaK.selection,"first");assert.ok(oldSdaK.expectedValue>=.03);
assert.equal(board.rows.find(r=>r.market==="spread")?.grade,"Watchlist","R17 golden SDAK+2.5 Lean is demoted by the restored coherent source law");
const valueTargets=targets.map(t=>t.market==="spread"?{...t,line:-5.5,firstPrice:170,secondPrice:-200}:t);
const oldNku=reviewCbbQuote(independent,valueTargets.find(t=>t.market==="spread")!);
assert.equal(oldNku.selection,"second");assert.ok(oldNku.expectedValue<0,"R17 golden NKU+5.5 Watch had no prior-law executable value");
const valueRead=readCbbMarketBehavior({...args,targets:valueTargets});
const valueBoard=coherent(valueRead,valueTargets,args.currentQuotes),promoted=valueBoard.rows.find(r=>r.market==="spread")!;
assert.equal(promoted.selection,"second");assert.ok(promoted.expectedValue!>=.03);
assert.equal(promoted.grade,"Lean","restored source-supported NKU+5.5 value must remain eligible for promotion");
assert.deepEqual(valueRead.receipt.finalScore,read.receipt.finalScore,"only execution economics change between paired grade fixtures");

// Identical pressure keeps its actual earlier response clocks and receipt;
// continuity of evidence is not a numerical takeover switch.
const repeated=readCbbMarketBehavior({...args,historyFlows:[flow],flows:[{...flow,
 observedAt:"2026-11-04T18:15:00Z",fetchedAt:"2026-11-04T18:16:00Z"}]});
const repeatedResponse=repeated.receipt.pressureDecisions.find(p=>p.book==="circa")!;
assert.equal(repeatedResponse.reaction,"against_money");
assert.equal(repeatedResponse.sourceAt,response.sourceAt);assert.equal(repeatedResponse.availableBy,response.availableBy);
assert.equal(repeatedResponse.latestObservation?.sourceAt,"2026-11-04T18:15:00Z");
assert.deepEqual(repeated.receipt.finalScore,read.receipt.finalScore);
coherent(repeated,targets,args.currentQuotes);

const mirrorQ=(x:CbbQuote):CbbQuote=>x.market==="total"?{...x}:{...x,line:x.line===null?null:-x.line,firstPrice:x.secondPrice,secondPrice:x.firstPrice};
const mirroredIndependent:CbbForecast={...independent,homeId:independent.awayId,awayId:independent.homeId,
 homeScore:independent.awayScore,awayScore:independent.homeScore,margin:-independent.margin,homeWinProbability:1-independent.homeWinProbability,
 uncertainty:{...independent.uncertainty,marginCorrection:-independent.uncertainty.marginCorrection,
  marginTotalCorrelation:-independent.uncertainty.marginTotalCorrelation}};
const mirroredFlow={...flow,firstMoney:flow.secondMoney,secondMoney:flow.firstMoney,firstTickets:flow.secondTickets,secondTickets:flow.firstTickets};
const mirroredArgs={...args,independent:mirroredIndependent,targets:targets.map(mirrorQ),currentQuotes:args.currentQuotes.map(mirrorQ),
 historyQuotes:historyQuotes.map(mirrorQ),flows:[mirroredFlow]};
const mirrored=readCbbMarketBehavior(mirroredArgs),mirrorBoard=coherent(mirrored,mirroredArgs.targets,mirroredArgs.currentQuotes);
assert.ok(Math.abs(mirrored.forecast.margin+read.forecast.margin)<1e-12);
assert.ok(Math.abs(mirrored.forecast.homeWinProbability+read.forecast.homeWinProbability-1)<1e-12);
for(const row of board.rows){
 const other=mirrorBoard.rows.find(r=>r.market===row.market)!;
 assert.equal(other.grade,row.grade);assert.ok(Math.abs(other.probability!-row.probability!)<1e-12);
 assert.ok(Math.abs(other.expectedValue!-row.expectedValue!)<1e-12);
}

// Opposed moving contracts and ML movement beside a flat Spread both remain
// genuine native joint constraints; neither directional arrangement installs
// the old independent probability. Their source profiles must stay visible.
for(const [flat,mirror] of [[false,false],[false,true],[true,false],[true,true]] as const){
 const latest=flat?-8.5:-7.5;
 const history=[q("moneyline",null,-150,130,"18:00"),q("spread",-8.5,-110,-110,"18:00"),
  q("moneyline",null,-160,140,"18:10"),q("spread",latest,-110,-110,"18:10"),
  q("moneyline",null,-160,140,"18:20"),q("spread",latest,-110,-110,"18:20")];
 const physical=mirror?history.map(mirrorQ):history;
 const input={...args,independent:mirror?mirroredIndependent:independent,targets:mirror?mirroredArgs.targets:targets,
  historyQuotes:physical,currentQuotes:physical.slice(-2),flows:[mirror?mirroredFlow:flow]};
 const result=readCbbMarketBehavior(input),joint=result.receipt.jointMarginDecision!;
 assert.ok(joint.candidates.some(c=>c.book==="circa"&&c.status==="identified"&&c.margin!==null&&c.marginSd!==null));
 assert.equal(result.receipt.currentProfessionalQuotes.length,2);
 assert.equal(joint.relativeInterpretation?.disposition,"source_level_selected");
 assert.notEqual(result.forecast.margin,input.independent.margin);
 coherent(result,input.targets,input.currentQuotes);
}

// Retain original net NKU strengthening and the later SDAK buyback separately;
// a favorable latest tick is not a certificate for the whole prior forecast.
const buybackHistory=[q("moneyline",null,-105,-115,"18:00"),q("spread",1,-110,-110,"18:00"),
 q("moneyline",null,120,-140,"18:05"),q("spread",2.5,-110,-110,"18:05"),
 ...historyQuotes.slice(2)];
const buyback=readCbbMarketBehavior({...args,historyQuotes:buybackHistory,
 flows:[{...flow,observedAt:"2026-11-04T18:07:00Z",fetchedAt:"2026-11-04T18:08:00Z"}]});
assert.ok(buyback.receipt.episodes.some(e=>e.market==="spread"&&e.direction===-1));
assert.ok(buyback.receipt.pathPosture.some(p=>p.market==="spread"&&p.recentDirection===1));
assert.equal(buyback.receipt.pressureDecisions.find(p=>p.book==="circa")?.reaction,"against_money");
assert.deepEqual(buyback.receipt.finalScore,read.receipt.finalScore);
coherent(buyback,targets,args.currentQuotes);

// Butler's actual large independent margin cannot jump into the forecast
// because two cents cross 50%, even with a real against-money response.
const butler:CbbForecast={...independent,gameId:10882636,homeId:83,awayId:245,homeScore:96.90225774192967,
 awayScore:61.483622219343154,total:158.38587996127282,margin:35.41863552258651,homeWinProbability:.9987469459108473,
 possessions:74.00243158159525};
const old={...q("spread",-27.5,-107,-109,"18:00","pinnacle"),gameId:butler.gameId};
const current={...q("spread",-27.5,-109,-107,"18:20","pinnacle"),gameId:butler.gameId};
const target={...q("spread",-27.5,-110,-110,"18:25","fanduel"),gameId:butler.gameId};
const butlerArgs={...args,independent:butler,targets:[target],currentQuotes:[current],historyQuotes:[old,current],flows:[]};
const bare=readCbbMarketBehavior(butlerArgs);
const pressured=readCbbMarketBehavior({...butlerArgs,flows:[{...flow,gameId:butler.gameId,sourceBook:"pinnacle",market:"spread" as const,line:-27.5}]});
assert.equal(pressured.receipt.pressureDecisions.find(p=>p.book==="pinnacle")?.reaction,"against_money");
assert.deepEqual(pressured.receipt.finalScore,bare.receipt.finalScore);
assert.notEqual(pressured.forecast.margin,butler.margin);
assert.equal(pressured.receipt.jointMarginDecision?.relativeInterpretation?.disposition,"source_level_selected");
const centered={...current,firstPrice:-108,secondPrice:-108};
const nearby=readCbbMarketBehavior({...butlerArgs,currentQuotes:[centered],historyQuotes:[old,centered]});
assert.ok(Math.abs(nearby.forecast.margin-bare.forecast.margin)<1,"a two-cent change cannot induce the former eight-point prior takeover");
assert.ok(Math.abs(nearby.forecast.homeWinProbability-bare.forecast.homeWinProbability)<.01);
coherent(pressured,[target],[current]);
console.log("PASS CBB counterpressure: evidence and original clocks retained, no full-prior takeover; coherent native law, mirrors, full paths and tiny-price continuity");
