import assert from "node:assert/strict";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {readCbbMarketBehavior} from "../lib/cbb/marketBehaviorCandidate";
import {buildCbbProvisionalBoard} from "../lib/cbb/provisionalBoard";
import {reviewCbbQuote} from "../lib/cbb/marketEvidence";
import {decideCbbJointMargin} from "../lib/cbb/jointMarginDecision";
import {readCbbMarketBehaviorPath} from "../lib/cbb/marketBehaviorPath";
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
const read=readCbbMarketBehavior(args);
const board=buildCbbProvisionalBoard(read.forecast,[...targets,...args.currentQuotes],{marketBehavior:read.receipt});
assert.equal(read.receipt.pressureDecisions.find(p=>p.book==="circa"&&p.market==="moneyline")?.reaction,"against_money");
assert.equal(read.forecast.margin,independent.margin,"qualified current counterpressure must not be overwritten by the older away-favoring source level");
assert.deepEqual(read.forecast.uncertainty,independent.uncertainty,"confirmation preserves the whole original uncertainty law, not just its winner");
assert.equal(read.forecast.total,independent.total);
assert.equal(read.forecast.homeWinProbability,independent.homeWinProbability);
assert.equal(board.rows.find(r=>r.market==="spread")?.grade,"Lean","the genuine spread value promotion must reach the board");
assert.equal(board.rows.find(r=>r.market==="moneyline")?.grade,"Lean");
assert.equal(board.rows.find(r=>r.market==="moneyline")?.reason,"source_quote_moved_against_opposite_money");
for(const target of targets){
 const expected=reviewCbbQuote(independent,target),actual=board.rows.find(r=>r.market===target.market)!;
 assert.equal(actual.selection,expected.selection);assert.equal(actual.probability,expected.probability);
 assert.equal(actual.pushProbability,expected.pushProbability);
 assert.ok(Math.abs(actual.expectedValue!-expected.expectedValue)<1e-12);
}
assert.deepEqual(board.score,read.receipt.finalScore);

// The pressure remains the same economic state after repeated collection.
// A repeated split is not a new independent vote or permission to lose its
// already observed, still-current native response.
const repeated=readCbbMarketBehavior({...args,historyFlows:[flow],flows:[{...flow,observedAt:"2026-11-04T18:15:00Z",fetchedAt:"2026-11-04T18:16:00Z"}]});

const mirrorQ=(x:CbbQuote):CbbQuote=>x.market==="total"?{...x}:{...x,line:x.line===null?null:-x.line,firstPrice:x.secondPrice,secondPrice:x.firstPrice};
const mirroredArgs={...args,independent:{...independent,homeId:independent.awayId,awayId:independent.homeId,
 homeScore:independent.awayScore,awayScore:independent.homeScore,margin:-independent.margin,homeWinProbability:1-independent.homeWinProbability,
 uncertainty:{...independent.uncertainty,marginCorrection:-independent.uncertainty.marginCorrection,
  marginTotalCorrelation:-independent.uncertainty.marginTotalCorrelation}},
 targets:targets.map(mirrorQ),currentQuotes:args.currentQuotes.map(mirrorQ),historyQuotes:historyQuotes.map(mirrorQ),
 flows:[{...flow,firstMoney:flow.secondMoney,secondMoney:flow.firstMoney,firstTickets:flow.secondTickets,secondTickets:flow.firstTickets}]};
const mirrored=readCbbMarketBehavior(mirroredArgs);
assert.equal(mirrored.forecast.margin,-independent.margin);
assert.deepEqual(mirrored.forecast.uncertainty,mirroredArgs.independent.uncertainty);
const mirrorBoard=buildCbbProvisionalBoard(mirrored.forecast,[...mirroredArgs.targets,...mirroredArgs.currentQuotes],{marketBehavior:mirrored.receipt});
for(const row of board.rows){
 const other=mirrorBoard.rows.find(r=>r.market===row.market)!;
 assert.equal(other.grade,row.grade);assert.ok(Math.abs(other.probability!-row.probability!)<1e-12);
 assert.ok(Math.abs(other.expectedValue!-row.expectedValue!)<1e-12);
 assert.equal(other.selection,row.market==="total"?row.selection:row.selection==="first"?"second":"first");
}

// Same-book cross-market disagreement cannot borrow a favorable ML response
// to override a relative Spread decision in the opposite direction. Both
// current contracts remain valid and jointly identified throughout this test.
for(const [flatSpread,mirroredCase] of [[false,false],[false,true],[true,false],[true,true]] as const){
 const oldSpread=-8.5,newSpread=flatSpread?oldSpread:-7.5;
 const native=[q("moneyline",null,-150,130,"18:00"),q("spread",oldSpread,-110,-110,"18:00"),
  q("moneyline",null,-160,140,"18:10"),q("spread",newSpread,-110,-110,"18:10"),
  q("moneyline",null,-160,140,"18:20"),q("spread",newSpread,-110,-110,"18:20")];
 const caseArgs={...args,independent:mirroredCase?mirroredArgs.independent:independent,
  targets:mirroredCase?mirroredArgs.targets:targets,
  historyQuotes:mirroredCase?native.map(mirrorQ):native,
  currentQuotes:mirroredCase?native.slice(-2).map(mirrorQ):native.slice(-2),
  flows:mirroredCase?mirroredArgs.flows:[flow]};
 const result=readCbbMarketBehavior(caseArgs),joint=result.receipt.jointMarginDecision!;
 assert.ok(joint.candidates.some(p=>p.book==="circa"&&p.status==="identified"&&p.margin!==null&&p.marginSd!==null),
  "both current physical contracts must survive into a genuine joint profile");
 assert.equal(result.receipt.currentProfessionalQuotes.filter(p=>p.sportsbook==="circa").length,2);
 assert.equal(result.receipt.pressureDecisions.find(p=>p.book==="circa")?.reaction,"against_money");
 if(flatSpread){
  assert.equal(joint.relativeInterpretation?.read.sourceDirection,mirroredCase?-1:1);
  assert.equal(joint.relativeInterpretation?.disposition,"native_counterpressure_retained",
   "a genuinely aligned ML-only repricing must not require a moving Spread too");
  assert.equal(result.forecast.margin,caseArgs.independent.margin);
 }else{
  assert.equal(joint.relativeInterpretation?.read.sourceDirection,mirroredCase?1:-1);
  assert.equal(joint.relativeInterpretation?.read.crossMarketDisagreement,true);
  assert.notEqual(joint.relativeInterpretation?.disposition,"native_counterpressure_retained",
   "opposite Spread interpretation cannot piggyback on a same-book ML response");
  assert.notEqual(result.forecast.margin,caseArgs.independent.margin);
 }
}

// Full-path context: NKU first strengthens from -1 to -2.5, then gives back
// half a point to -2 after observed NKU money. The latest homeward tick does
// not erase the retained net move toward NKU or certify the prior home law.
const buybackHistory=[q("moneyline",null,-105,-115,"18:00"),q("spread",1,-110,-110,"18:00"),
 q("moneyline",null,120,-140,"18:05"),q("spread",2.5,-110,-110,"18:05"),
 q("moneyline",null,110,-130,"18:10"),q("spread",2,-115,-105,"18:10"),
 q("moneyline",null,110,-130,"18:20"),q("spread",2,-115,-105,"18:20")];
const buyback=readCbbMarketBehavior({...args,historyQuotes:buybackHistory,currentQuotes:buybackHistory.slice(-2),
 flows:[{...flow,observedAt:"2026-11-04T18:07:00Z",fetchedAt:"2026-11-04T18:08:00Z"}]});
assert.equal(buyback.receipt.pressureDecisions.find(p=>p.book==="circa")?.reaction,"against_money");
assert.ok(buyback.receipt.episodes.some(e=>e.book==="circa"&&e.market==="spread"&&e.direction===-1),
 "the original-to-current spread consequence remains toward NKU");
assert.ok(buyback.receipt.pathPosture.some(p=>p.book==="circa"&&p.market==="spread"&&p.recentDirection===1),
 "the latest spread interval is separately retained as a SDAK buyback");
assert.ok(buyback.receipt.jointMarginDecision?.candidates.some(p=>p.book==="circa"&&p.status==="identified"));
assert.notEqual(buyback.receipt.jointMarginDecision?.relativeInterpretation?.disposition,"native_counterpressure_retained");
assert.notEqual(buyback.forecast.margin,independent.margin,"latest tick alone cannot confirm the original independent law");

for(const [name,control] of [
 ["no native pressure",{...args,flows:[]}],
 ["pressure at unavailable native contract",{...args,flows:[{...flow,market:"spread" as const,line:99.5}]}],
 ["pressure after latest quote",{...args,flows:[{...flow,observedAt:"2026-11-04T18:29:00Z",fetchedAt:"2026-11-04T18:29:30Z"}]}],
 ["money moves with reaction",{...args,flows:[{...flow,firstMoney:.99,secondMoney:.01}]}],
 ["wrong physical source",{...args,flows:[{...flow,sourceBook:"pinnacle"}]}],
 ["changed pressure after the original response",{...args,historyFlows:[flow],flows:[{...flow,firstMoney:.02,secondMoney:.98,
  observedAt:"2026-11-04T18:15:00Z",fetchedAt:"2026-11-04T18:16:00Z"}]}],
 ["changed event identity after the original response",{...args,historyFlows:[flow],flows:[{...flow,sourceEventId:"different-native-event",
  observedAt:"2026-11-04T18:15:00Z",fetchedAt:"2026-11-04T18:16:00Z"}]}],
] as const){
 const controlRead=readCbbMarketBehavior({...control,flows:[...control.flows],
  historyFlows:"historyFlows" in control?[...control.historyFlows]:undefined});
 assert.notEqual(controlRead.forecast.margin,independent.margin,`${name}: no earned contextual confirmation`);
 assert.equal(controlRead.receipt.jointMarginDecision?.relativeInterpretation?.disposition,"source_level_selected",name);
}

const invalidQuote=(x:CbbQuote)=>x.market==="moneyline"&&x.providerObservedAt>="2026-11-04T18:10:00Z"?
 {...x,firstPrice:-200,secondPrice:170}:x;
const invalidJoint=readCbbMarketBehavior({...args,currentQuotes:args.currentQuotes.map(invalidQuote),historyQuotes:historyQuotes.map(invalidQuote)});
assert.equal(invalidJoint.receipt.jointMarginDecision?.status,"unresolved","native joint contradiction takes precedence over contextual retention");
assert.notEqual(invalidJoint.receipt.jointMarginDecision?.reason,"qualified_native_counterpressure_precedes_current_level");

for(const [name,newMl,newSpread] of [
 ["cancelled native response",[120,-140],[2,-115,-105]],
 ["reversed native response",[130,-150],[3,-110,-110]],
] as const){
 const replacement=historyQuotes.map(x=>x.providerObservedAt!=="2026-11-04T18:20:00Z"?x:
  x.market==="moneyline"?{...x,firstPrice:newMl[0],secondPrice:newMl[1]}:
   {...x,line:newSpread[0],firstPrice:newSpread[1],secondPrice:newSpread[2]});
 const cancelled=readCbbMarketBehavior({...args,historyQuotes:replacement,currentQuotes:replacement.slice(-2),
  historyFlows:[flow],flows:[{...flow,observedAt:"2026-11-04T18:15:00Z",fetchedAt:"2026-11-04T18:16:00Z"}]});
 assert.notEqual(cancelled.forecast.margin,independent.margin,`${name} cannot inherit the earlier counterpressure authority`);
 assert.notEqual(cancelled.receipt.jointMarginDecision?.reason,"qualified_native_counterpressure_precedes_current_level",name);
}

// Negative-value repricing is paired with the positive-value promotion, using
// the same evidence and mean. This is not permission to flatten the board.
const badTargets=targets.map(t=>t.market==="spread"?{...t,line:-5.5,firstPrice:170,secondPrice:-200}:t);
const before=readCbbMarketBehavior({...args,targets:badTargets,flows:[]});
const beforeBoard=buildCbbProvisionalBoard(before.forecast,[...badTargets,...args.currentQuotes],{marketBehavior:before.receipt});
const after=readCbbMarketBehavior({...args,targets:badTargets});
const afterBoard=buildCbbProvisionalBoard(after.forecast,[...badTargets,...args.currentQuotes],{marketBehavior:after.receipt});
assert.ok(["Lean","Best Angle"].includes(beforeBoard.rows.find(r=>r.market==="spread")!.grade));
assert.equal(afterBoard.rows.find(r=>r.market==="spread")?.grade,"Watchlist");
assert.ok(afterBoard.rows.find(r=>r.market==="spread")!.expectedValue!<0);

// A fabricated response label is insufficient even when the upstream relative
// reader correctly observed a directional confirmation. The numerical handoff
// must bind actual professional authority, current quote tuple and direction.
const path=readCbbMarketBehaviorPath({independent,startsAt,currentQuotes:args.currentQuotes,
 seedQuotes:historyQuotes,flows:[flow],excludedFamilies:["fanduel"]});
const jointArgs={base:independent,current:args.currentQuotes,episodes:read.receipt.episodes,path,
 relative:read.receipt.jointMarginDecision!.relativeInterpretation!.read};
for(const pressure of [
 [],read.receipt.pressureDecisions.map(p=>({...p,reaction:"unbound" as const,resolution:"unavailable" as const})),
 read.receipt.pressureDecisions.map(p=>({...p,latestDirection:-1 as const})),
 read.receipt.pressureDecisions.map(p=>({...p,book:"pinnacle"})),
 read.receipt.pressureDecisions.map(p=>({...p,current:p.current?{...p.current,firstPrice:105}:null})),
 read.receipt.pressureDecisions.map(p=>({...p,current:p.current?{...p.current,providerObservedAt:"2026-11-04T18:19:00Z"}:null})),
]){
 const result=decideCbbJointMargin({...jointArgs,pressure});
 assert.notEqual(result.margin.delta,0,"fabricated, changed or unbound pressure cannot retain the original law");
}

// Butler's large independent favorite cannot recover its whole 35-point law
// from a bare two-cent source change crossing 50% with no native response.
const butler:CbbForecast={...independent,gameId:10882636,homeId:83,awayId:245,homeScore:96.90225774192967,
 awayScore:61.483622219343154,total:158.38587996127282,margin:35.41863552258651,homeWinProbability:.9987469459108473,
 possessions:74.00243158159525};
const butlerBefore={...q("spread",-27.5,-107,-109,"18:00","pinnacle"),gameId:butler.gameId};
const butlerCurrent={...q("spread",-27.5,-109,-107,"18:20","pinnacle"),gameId:butler.gameId};
const butlerTarget={...q("spread",-27.5,-110,-110,"18:25","fanduel"),gameId:butler.gameId};
const bare=readCbbMarketBehavior({...args,independent:butler,targets:[butlerTarget],currentQuotes:[butlerCurrent],
 historyQuotes:[butlerBefore,butlerCurrent],flows:[]});
assert.notEqual(bare.forecast.margin,butler.margin);
assert.equal(bare.receipt.jointMarginDecision?.relativeInterpretation?.disposition,"source_level_selected");
assert.equal(repeated.forecast.margin,independent.margin,"identical later pressure must not erase an ongoing earlier qualified counterpressure response");
assert.deepEqual(repeated.forecast.uncertainty,independent.uncertainty);
console.log("CBB native counterpressure handoff: full law, mirrored grades, repeated response, adverse-price demotion and negative proof controls passed");
