import assert from "node:assert/strict";
import {readCbbMarketBehavior,CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {buildCbbProvisionalBoard} from "../lib/cbb/provisionalBoard";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {normalCdf,cbbThresholdProbabilities} from "../lib/cbb/model";
import type {CbbDecisionSplitContext} from "../lib/cbb/decisionSplitContext";
import type {CbbForecast,CbbQuote} from "../lib/cbb/types";
import {normalizeCbbOwlsCurrent} from "../lib/cbb/owlsMarketEvidence";
import {cbbImpliedProbability} from "../lib/cbb/marketEvidence";
import {cbbExactMarketCenter} from "../lib/cbb/marketReaderResearch";
const at="2026-11-03T18:30:00Z",start="2026-11-03T22:00:00Z";
function independent(margin:number):CbbForecast{
 const zero=normalCdf((.5-margin)/11)-normalCdf((-.5-margin)/11);
 return {release:CBB_CURRENT_SCORE_RELEASE,gameId:1,asOf:at,homeId:1,awayId:2,margin,total:150,homeScore:(150+margin)/2,awayScore:(150-margin)/2,
 homeWinProbability:(1-normalCdf((.5-margin)/11))/(1-zero),possessions:70,inputStatus:"complete",issues:[],
 uncertainty:{marginSd:11,totalSd:16,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:1000}};
}
const quote=(center:number,book="circa",current=false):CbbQuote=>({gameId:1,market:"spread",line:-center,
 firstPrice:-110,secondPrice:-110,sportsbook:book,provider:"owls",phase:"current",orientationVerified:true,
 providerObservedAt:current?(book==="fanduel"?"2026-11-03T18:24:00Z":"2026-11-03T18:20:00Z"):"2026-11-03T18:00:00Z",
 fetchedAt:current?(book==="fanduel"?"2026-11-03T18:26:00Z":"2026-11-03T18:21:00Z"):"2026-11-03T18:01:00Z",
 requestedAt:current?(book==="fanduel"?"2026-11-03T18:25:00Z":"2026-11-03T18:20:30Z"):undefined} as CbbQuote);
const american=(probability:number)=>probability>=.5?-100*probability/(1-probability):100*(1-probability)/probability;
function supportedSource(center:number,margin:number){
 const source=quote(center,"circa",true),p=cbbThresholdProbabilities(independent(margin),"spread",source.line);
 const fair=p.first/(p.first+p.second);
 return {...source,firstPrice:american(fair*1.04),secondPrice:american((1-fair)*1.04)};
}
const context=(money:number):CbbDecisionSplitContext=>({gameId:1,market:"spread",sourceBook:"circa",physicalFamily:"circa",sourceClass:"professional_adjacent_named_book",provider:"owls",
 sourceEventId:"ncaab:A@B-20261103",line:0,firstMoney:money,secondMoney:1-money,firstTickets:.5,secondTickets:.5,
 observedAt:"2026-11-03T18:10:00Z",availableBy:"2026-11-03T18:11:00Z",clockBasis:"verified_provider_observation",observationIds:[]});
function run(i:number,a:number,c:number,targetCenter:number,pressure:CbbDecisionSplitContext[]=[],sourceMargin?:number){
 const base=independent(i),target=quote(targetCenter,"fanduel",true),before=quote(a),current=sourceMargin===undefined?quote(c,"circa",true):supportedSource(c,sourceMargin);
 const read=readCbbMarketBehavior({independent:base,independentInputKey:"unchanged-stats",startsAt:start,targets:[target],currentQuotes:[current,target],splitContext:pressure,
 anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:1,startsAt:start,independentRelease:base.release,independentInputKey:"unchanged-stats",capturedAt:before.fetchedAt,quotes:[before]}});
 const board=buildCbbProvisionalBoard(read.forecast,[target,current],{marketBehavior:read.receipt});
 return {read,board,row:board.rows.find(row=>row.market==="spread")!,base,target};
}
const before=buildCbbProvisionalBoard(independent(0),[quote(1.5,"fanduel",true),quote(0,"circa",true)]).rows.find(row=>row.market==="spread")!;
assert.notEqual(before.grade,"Best Angle");assert.notEqual(before.grade,"Lean");
const created=run(0,0,8.5,1.5);
assert.equal(created.row.selection,"first");assert.equal(created.row.grade,"Best Angle","the final market-informed forecast can create an actionable premium edge absent from the independent input");
assert.ok(created.row.probability!>.7);assert.ok(created.read.forecast.margin>8);
for(const i of [-3,3]){
 const r=run(i,i<0?-4.5:4.5,i<0?12.5:-12.5,0);
 assert.ok(r.read.forecast.margin*i<0,"large observed corrections can flip either independent winner");
 assert.equal(cbbThresholdProbabilities(r.read.forecast,"spread",0).first,r.read.forecast.homeWinProbability);
 assert.ok(Math.abs(r.board.score.home-r.board.score.away-r.board.score.margin)<1e-9);
 assert.ok(Math.abs(r.board.score.home+r.board.score.away-r.board.score.total)<1e-9);
}
const confirmed=run(7,0,3.5,3.5,[context(.8)],7);
assert.equal(confirmed.read.forecast.margin,7);assert.equal(confirmed.read.receipt.margin.status,"confirming");
assert.equal(confirmed.row.actualActionConfirmation,true,"verified native off-target money/reaction can confirm with zero score displacement");
assert.equal(confirmed.row.grade,"Best Angle");
const noFlow=run(7,0,3.5,6,[],7);
assert.equal(noFlow.read.forecast.margin,7);
assert.equal(noFlow.row.actualActionConfirmation,false);
assert.ok(noFlow.row.expectedValue!>=.03&&noFlow.row.expectedValue!<.08,"the executable contract has Lean value rather than premium value");
assert.equal(noFlow.row.grade,"Lean","a quantitatively supported price-only confirmation retains its Lean lane without invented action");
const alignedTarget={...quote(1.5,"fanduel",true),fetchedAt:"2026-11-03T18:26:00Z",providerObservedAt:"2026-11-03T18:24:00Z"};
const alignedRead=readCbbMarketBehavior({independent:independent(0),independentInputKey:"aligned",startsAt:start,targets:[alignedTarget],
 currentQuotes:[quote(8.5,"circa",true),{...quote(12.5,"pinnacle",true),providerObservedAt:"2026-11-03T18:23:00Z",fetchedAt:"2026-11-03T18:24:00Z"}],
 anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:1,startsAt:start,independentRelease:CBB_CURRENT_SCORE_RELEASE,independentInputKey:"aligned",capturedAt:"2026-11-03T18:01:00Z",quotes:[quote(0),quote(0,"pinnacle")]}});
assert.equal(alignedRead.receipt.margin.authority?.reason,"latest_observed_repricing");
assert.ok(alignedRead.forecast.margin>12,"unequal aligned signals now create the actual score consequence without leader evidence");
assert.equal(buildCbbProvisionalBoard(alignedRead.forecast,[alignedTarget,...alignedRead.receipt.currentProfessionalQuotes],{marketBehavior:alignedRead.receipt}).rows.find(r=>r.market==="spread")!.grade,"Best Angle");
const heldNative={...quote(31.5),providerObservedAt:"2026-11-03T18:05:00Z",fetchedAt:"2026-11-03T18:06:00Z"};
const holdRead=readCbbMarketBehavior({independent:independent(20),independentInputKey:"hold",startsAt:start,targets:[alignedTarget],
 currentQuotes:[quote(31.5,"circa",true),quote(32,"pinnacle",true)],historyQuotes:[heldNative],
 splitContext:[{...context(.24),line:-31.5}],
 anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:1,startsAt:start,independentRelease:CBB_CURRENT_SCORE_RELEASE,independentInputKey:"hold",capturedAt:"2026-11-03T18:01:00Z",quotes:[quote(28.5),quote(28,"pinnacle")]}});
assert.equal(holdRead.receipt.margin.authority?.reason,"qualified_contrarian_hold");
assert.equal(holdRead.receipt.margin.sourceBook,"circa");
assert.ok(Math.abs(holdRead.forecast.margin-cbbExactMarketCenter(independent(20),quote(31.5,"circa",true),.5))<1e-8,
 "held native authority applies its actual current source law once, without adding the historical three-point move again");
const duplicateClockRead=readCbbMarketBehavior({independent:independent(20),independentInputKey:"hold",startsAt:start,targets:[alignedTarget],
 currentQuotes:[quote(31.5,"circa",true),quote(32,"pinnacle",true)],historyQuotes:[heldNative,
 {...quote(31.5,"circa",true),providerObservedAt:"2026-11-03T18:20:00+00:00",fetchedAt:"2026-11-03T18:21:30Z"}],
 splitContext:[{...context(.24),line:-31.5}],anchors:holdRead.receipt.anchors});
assert.equal(duplicateClockRead.receipt.margin.authority?.reason,"qualified_contrarian_hold","equal native instants retain the hold selector across original timestamp formats");
const oppositeHeld=run(7,0,0,-2,[context(.2)]);
assert.equal(oppositeHeld.row.grade,"Lean","book holding against opposite money can promote a positive-value Watchlist");
assert.equal(oppositeHeld.row.pathResistance,false);
const towardHeld=run(7,0,0,-2,[context(.8)]);
assert.equal(towardHeld.row.pathResistance,true);assert.notEqual(towardHeld.row.grade,"Best Angle");
const aggregate=run(7,0,3.5,6,[{...context(.2),sourceClass:"multi_book_consensus",sourceBook:"consensus",physicalFamily:"playbook_consensus",line:null}],7);
assert.equal(aggregate.row.actualActionConfirmation,false);assert.equal(aggregate.row.pathResistance,false,"public majority without an own-book response cannot veto a qualified price interpretation");
assert.equal(aggregate.read.forecast.margin,noFlow.read.forecast.margin);
const changedPrice=run(7,0,3.5,7.5,[context(.8)],7);
assert.ok(changedPrice.row.expectedValue!<0,"moving the executable threshold to the model center removes the prior price advantage");
assert.equal(changedPrice.row.grade,"No Play","the same signal cannot retain a premium after losing value at a different executable contract");
const stillOpposite=run(7,-4.5,-1.5,0);
assert.equal(stillOpposite.read.receipt.margin.status,"applied","movement toward the independent score is not confirmation while the actual current winner remains opposite");
assert.ok(stillOpposite.read.forecast.margin<0&&stillOpposite.read.forecast.homeWinProbability<.5);
assert.equal(stillOpposite.row.selection,"second");
const original=quote(0),current=quote(8.5,"circa",true),target=quote(1.5,"fanduel",true);
const common={independent:independent(0),independentInputKey:"same",startsAt:start,targets:[target],currentQuotes:[current],
 anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:1,startsAt:start,independentRelease:CBB_CURRENT_SCORE_RELEASE,
 independentInputKey:"same",capturedAt:original.fetchedAt,quotes:[original]}};
const badMl=readCbbMarketBehavior({...common,currentSourceProblems:[{book:"circa",market:"moneyline",reason:"incoherent_quote"}]});
assert.equal(badMl.receipt.margin.status,"applied","invalid current ML does not erase valid native Spread evidence");
const badSpread=readCbbMarketBehavior({...common,currentSourceProblems:[{book:"circa",market:"spread",reason:"incoherent_quote"}]});
assert.equal(badSpread.receipt.margin.status,"unavailable");assert.equal(badSpread.forecast.margin,0);
assert.equal(badSpread.receipt.anchors.quarantinedKeys?.includes("circa:spread"),false,"transient current failure is not permanent original-source corruption");
const recovered=readCbbMarketBehavior({...common,anchors:badSpread.receipt.anchors,previousPath:badSpread.receipt.pathTape});
assert.equal(recovered.receipt.margin.status,"applied","a later valid response recovers without deleting immutable anchors");
const converging=readCbbMarketBehavior({...common,independent:independent(7),currentQuotes:[supportedSource(5,7),quote(9,"pinnacle",true)],
 anchors:{...common.anchors,quotes:[quote(3),quote(10,"pinnacle")]}});
assert.equal(converging.receipt.margin.status,"confirming");
assert.equal(converging.forecast.margin,7,"opposite raw moves can confirm the independent law when the explicitly selected current source agrees on winner and cover");
assert.equal(converging.receipt.jointMarginDecision?.status,"confirmed");
assert.equal(converging.receipt.jointMarginDecision?.authority?.reason,"current_native_source_preference");
const ml=(current:boolean):CbbQuote=>({...quote(0,"circa",current),market:"moneyline",line:null,
 firstPrice:current?-170:-150,secondPrice:current?145:130});
const flatSpread=readCbbMarketBehavior({...common,independent:independent(1),currentQuotes:[ml(true),quote(3.5,"circa",true)],
 anchors:{...common.anchors,quotes:[ml(false),quote(3.5)]}});
assert.equal(flatSpread.receipt.margin.status,"applied");
assert.equal(flatSpread.receipt.jointMarginDecision?.status,"applied");
assert.notEqual(flatSpread.forecast.margin,1,"a flat spread no longer vetoes the coherent native moneyline update");
assert.notEqual(flatSpread.forecast.uncertainty.marginSd,11,"the two native contracts identify a new dispersion rather than contradicting one another under a fixed law");
const fairMl=cbbImpliedProbability(ml(true).firstPrice)/(cbbImpliedProbability(ml(true).firstPrice)+cbbImpliedProbability(ml(true).secondPrice));
assert.ok(Math.abs(flatSpread.forecast.homeWinProbability-fairMl)<1e-8);
const exactCover=cbbThresholdProbabilities(flatSpread.forecast,"spread",-3.5);
assert.ok(Math.abs(exactCover.first/(exactCover.first+exactCover.second)-.5)<1e-8);
assert.deepEqual(flatSpread.receipt.originalIndependentUncertainty,independent(1).uncertainty);
assert.deepEqual(flatSpread.receipt.frozenUncertainty,flatSpread.forecast.uncertainty);
const badFinalLaw={...flatSpread.forecast,uncertainty:{...flatSpread.forecast.uncertainty,marginSd:11}};
assert.throws(()=>buildCbbProvisionalBoard(badFinalLaw,[target,...flatSpread.receipt.currentProfessionalQuotes],{marketBehavior:flatSpread.receipt}),/receipt mismatch/);
const redundantConflict=readCbbMarketBehavior({...common,currentQuotes:[ml(true),quote(0,"circa",true)],
 anchors:{...common.anchors,quotes:[ml(false),quote(0)]}});
assert.equal(redundantConflict.receipt.jointMarginDecision?.status,"unresolved","spread zero and ML are the same event; incompatible source prices cannot invent a shape");
assert.equal(redundantConflict.forecast.margin,0);
const withheldMlCurrent={...ml(true),providerObservedAt:"2026-11-03T18:23:00Z",fetchedAt:"2026-11-03T18:24:00Z"};
const withheldJointSource=readCbbMarketBehavior({...common,currentQuotes:[current,quote(12.5,"pinnacle",true),withheldMlCurrent],
 currentSourceProblems:[{book:"circa",market:"moneyline",reason:"incoherent_current_frame"}],
 anchors:{...common.anchors,quotes:[original,quote(0,"pinnacle"),ml(false)]}});
assert.equal(withheldJointSource.receipt.currentProfessionalQuotes.some(q=>q.sportsbook==="circa"&&q.market==="moneyline"),false,
 "a withheld current ML must not be resurrected by source selection from its older path stream");
const absentSpread=readCbbMarketBehavior({...common,currentQuotes:[ml(true)],anchors:{...common.anchors,quotes:[ml(false)]}});
assert.notEqual(absentSpread.forecast.margin,0,"genuinely absent Spread retains the priced moneyline fallback");
const impossibleFinal=readCbbMarketBehavior({...common,currentQuotes:[quote(140.5,"circa",true),{...quote(0,"circa",true),market:"total",line:100.5}],
 anchors:{...common.anchors,quotes:[original,{...quote(0),market:"total",line:150.5}]}});
assert.equal(impossibleFinal.receipt.margin.reason,"incoherent_score_consequence");
assert.equal(impossibleFinal.forecast.margin,0);assert.equal(impossibleFinal.forecast.total,150);
assert.equal(impossibleFinal.receipt.jointMarginDecision?.status,"unresolved");
assert.notEqual(impossibleFinal.receipt.winnerArbitration.status,"applied","a failed final score law must not retain a receipt claiming the source winner was applied");
const moneylineTarget={...target,market:"moneyline" as const,line:null,fetchedAt:"2026-11-03T18:26:00Z",providerObservedAt:"2026-11-03T18:24:00Z"};
const jointRead=readCbbMarketBehavior({...common,independent:independent(-3),targets:[moneylineTarget,target],
 currentQuotes:[quote(12.5,"circa",true)],anchors:{...common.anchors,quotes:[quote(-4.5)]},splitContext:[{...context(.8),line:4.5}]});
const jointBoard=buildCbbProvisionalBoard(jointRead.forecast,[moneylineTarget,target,quote(12.5,"circa",true)],{marketBehavior:jointRead.receipt});
const mlDecision=jointBoard.rows.find(row=>row.market==="moneyline")!;
assert.equal(mlDecision.selection,"first");assert.equal(mlDecision.grade,"Best Angle","qualified margin-axis evidence can create a moneyline play from the same final law");
assert.equal(mlDecision.probability,jointRead.forecast.homeWinProbability);assert.equal(mlDecision.reason,"verified_margin_axis_action_with_material_model_value");
const actualGame={id:1,date:start,season:2026,status:"pre",period:0,home_score:0,away_score:0,
 home_team:{id:1,college:"Cornell",name:"Cornell",full_name:"Cornell",abbreviation:"COR",conference_id:null},
 visitor_team:{id:2,college:"Pepperdine",name:"Pepperdine",full_name:"Pepperdine",abbreviation:"PEPP",conference_id:null}};
const normalized=normalizeCbbOwlsCurrent(actualGame,{success:true,data:[{sport:"ncaab",home_team:"Cornell",away_team:"Pepperdine",commence_time:start,
 bookmakers:[{key:"circa",last_update:"2026-11-03T18:20:00Z",markets:[{key:"h2h",outcomes:[{name:"Cornell",price:-150}]},
 {key:"spreads",outcomes:[{name:"Cornell",price:-110,point:-3.5},{name:"Pepperdine",price:-110,point:3.5}]}]}]}]},"2026-11-03T18:21:00Z",at);
assert.equal(normalized.quotes.length,1);assert.equal(normalized.rejected[0].market,"moneyline");assert.equal(normalized.rejected[0].sourceAt,"2026-11-03T18:20:00Z");
console.log("PASS CBB full decision chain: market-created edge, symmetric large flips, zero-score confirmation, native off-target action, opposite-money hold and exact target grading");
