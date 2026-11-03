import assert from "node:assert/strict";
import {readCbbMarketBehavior,gradeCbbMarketBehavior,CBB_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,type CbbMarketAnchors,type CbbBehaviorFlow} from "../lib/cbb/marketBehaviorCandidate";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {normalCdf,cbbThresholdProbabilities} from "../lib/cbb/model";
import {cbbExactMarketCenter} from "../lib/cbb/marketReaderResearch";
import {gradeCbbReceivedMarket} from "../lib/cbb/marketBehaviorGrade";
import {gradeCbbProvisional} from "../lib/cbb/provisionalGradePolicy";
import type {CbbForecast,CbbQuote,CbbMarket} from "../lib/cbb/types";
const at="2026-11-02T15:30:00.000Z",start="2026-11-02T19:00:00.000Z",anchorAt="2026-11-02T15:01:00.000Z";
function forecast(margin=7,total=150):CbbForecast{
 const sd=11,zero=normalCdf((.5-margin)/sd)-normalCdf((-.5-margin)/sd);
 return {release:CBB_CURRENT_SCORE_RELEASE,gameId:777,asOf:at,homeId:1,awayId:2,homeScore:(total+margin)/2,awayScore:(total-margin)/2,margin,total,
  possessions:70,homeWinProbability:(1-normalCdf((.5-margin)/sd))/(1-zero),inputStatus:"complete",issues:[],
  uncertainty:{marginSd:sd,totalSd:16,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:1000}};
}
function quote(market:CbbMarket,line:number|null,firstPrice=-110,secondPrice=-110,book="pinnacle",current=false){
 return {gameId:777,market,line,firstPrice,secondPrice,sportsbook:book,provider:"owls" as const,phase:"current" as const,orientationVerified:true,
  requestedAt:current&&book==="draftkings"?"2026-11-02T15:21:00.000Z":undefined,
  providerObservedAt:current?"2026-11-02T15:20:00.000Z":"2026-11-02T15:00:00.000Z",fetchedAt:current?"2026-11-02T15:21:00.000Z":anchorAt};
}
const targets=[quote("moneyline",null,-150,130,"draftkings",true),quote("spread",-3.5,-110,-110,"draftkings",true),quote("total",150.5,-110,-110,"draftkings",true)];
const original=[quote("moneyline",null,-150,130),quote("spread",-3.5),quote("total",150.5)];
const anchors=(quotes:CbbQuote[]=original,key="input-r3"):CbbMarketAnchors=>({release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:777,startsAt:start,
 independentRelease:CBB_CURRENT_SCORE_RELEASE,independentInputKey:key,capturedAt:anchorAt,quotes});
const run=(currentQuotes:CbbQuote[],extra:Partial<Parameters<typeof readCbbMarketBehavior>[0]>={})=>readCbbMarketBehavior({independent:forecast(),independentInputKey:"input-r3",startsAt:start,targets,currentQuotes,anchors:anchors(),...extra});
const current=[quote("moneyline",null,-170,145,"pinnacle",true),quote("spread",-4.5,-110,-110,"pinnacle",true),quote("total",151.5,-110,-110,"pinnacle",true)];
const input=JSON.stringify({current,original,targets}),result=run(current),f=result.forecast;
assert.equal(f.release,CBB_MARKET_BEHAVIOR_MODEL_RELEASE);assert.ok(f.margin>forecast().margin);assert.ok(f.total>forecast().total);
assert.equal(result.receipt.margin.sourceMarket,"spread","one explicit margin owner; ML is not added twice");
assert.ok(Math.abs(f.homeScore+f.awayScore-f.total)<1e-10&&Math.abs(f.homeScore-f.awayScore-f.margin)<1e-10);
assert.equal(cbbThresholdProbabilities(f,"spread",0).first,f.homeWinProbability,"winner/cover share the same no-tie law");
assert.deepEqual(run(current,{anchors:result.receipt.anchors}),result,"refresh from original baseline/anchors is idempotent");
assert.throws(()=>run(current,{independent:f}),/independent release/,"never recursively apply to the previous adjusted score");
assert.equal(JSON.stringify({current,original,targets}),input);
const statsRevision=run(current,{independent:forecast(8),independentInputKey:"revised-input",anchors:result.receipt.anchors});
assert.equal(statsRevision.receipt.inputRevisionSinceAnchor,"changed");assert.equal(statsRevision.receipt.anchors.capturedAt,anchorAt,"input hash is not proof of news consumption or permission to erase anchors");
const first=run([current[0]],{anchors:null});
assert.equal(first.receipt.episodes.length,0);assert.deepEqual({...first.forecast,release:CBB_CURRENT_SCORE_RELEASE},forecast(),"first receipt has zero invented movement");
const arriving=run(current,{anchors:first.receipt.anchors});
assert.equal(arriving.receipt.anchors.quotes.length,3,"a new source/market gets an original anchor when it first arrives");
const later=run(current.map(q=>({...q,providerObservedAt:"2026-11-02T15:25:00.000Z",fetchedAt:"2026-11-02T15:26:00.000Z"})),{anchors:arriving.receipt.anchors});
assert.equal(later.receipt.episodes.length,3,"new source anchors remain usable at their own true capture time");
const equalCutoff=run(current,{anchors:{...anchors(),capturedAt:at}});
assert.equal(equalCutoff.receipt.margin.status,"applied","ordered actual receipts can share a containing decision frame");
const unchanged=run(original.map(q=>({...q,providerObservedAt:current[0].providerObservedAt,fetchedAt:current[0].fetchedAt})));
assert.equal(unchanged.receipt.margin.status,"neutral");assert.deepEqual({...unchanged.forecast,release:CBB_CURRENT_SCORE_RELEASE},forecast(),"no net change preserves exact baseline fields");
const pureVig=run([quote("spread",-3.5,-120,-120,"pinnacle",true),quote("total",150.5,-120,-120,"pinnacle",true)]);
assert.deepEqual({...pureVig.forecast,release:CBB_CURRENT_SCORE_RELEASE},forecast(),"a vig-only change does not invent point movement");
const anchorSpread=original[1],center=cbbExactMarketCenter(forecast(),anchorSpread,.5);
const p=cbbThresholdProbabilities({...forecast(),margin:center},"spread",-4.5),fair=p.first/(p.first+p.second);
const american=(implied:number)=>implied>=.5?-100*implied/(1-implied):100*(1-implied)/implied;
const compensation=run([quote("spread",-4.5,american(fair*1.03),american((1-fair)*1.03),"pinnacle",true)]);
assert.equal(compensation.receipt.margin.status,"neutral","line and counter-juice compensation is read together");
const oppositeMl=quote("moneyline",null,-110,-110,"pinnacle",true);
const conflict=run([oppositeMl,current[1],current[2]]);
assert.equal(conflict.receipt.margin.status,"conflicting");assert.equal(conflict.forecast.margin,forecast().margin);assert.ok(conflict.forecast.total>forecast().total,"one conflicted axis cannot erase another valid axis");
const bookConflict=run([current[1],quote("spread",-2.5,-110,-110,"circa",true)],{anchors:anchors([...original,quote("spread",-3.5,-110,-110,"circa")])});
assert.equal(bookConflict.receipt.margin.status,"conflicting");assert.equal(bookConflict.forecast.margin,forecast().margin);
assert.equal(bookConflict.receipt.margin.directionalEvidence,"opposed");assert.equal(bookConflict.receipt.margin.sourceDirection,null);
assert.equal(unchanged.receipt.margin.directionalEvidence,"flat");assert.equal(unchanged.receipt.margin.sourceDirection,0);
const crossing=run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{independent:forecast(-.2),anchors:anchors([quote("spread",3.5)])});
assert.ok(crossing.forecast.margin>0&&crossing.forecast.homeWinProbability>.5,"qualified read can cross winner direction without an artificial cap");
const unionExcluded=run(current,{targets:[...targets.slice(0,2),quote("total",150.5,-110,-110,"ps3838",true)]});
assert.equal(unionExcluded.receipt.episodes.length,0,"all three targets exclude a family from ALL shared score dimensions");
for(const bad of [{gameId:999},{phase:"opening" as const},{orientationVerified:false},{providerObservedAt:"2026-11-02T15:31:00Z"},{fetchedAt:"2026-11-02T15:31:00Z"},{providerObservedAt:"2026-11-02T12:00:00Z"}]){
 const invalid=run(current.map(q=>({...q,...bad})));assert.equal(invalid.receipt.episodes.length,0,JSON.stringify(bad));
 assert.deepEqual({...invalid.forecast,release:CBB_CURRENT_SCORE_RELEASE},forecast());
}
const duplicate=run([current[1],{...current[1],firstPrice:-130}]);assert.equal(duplicate.receipt.episodes.length,0,"conflicting equal-time current pairs fail closed");
const corruptAnchor=run([{...original[1],firstPrice:-130,fetchedAt:current[1].fetchedAt}]);
assert.deepEqual(corruptAnchor.receipt.anchors.quarantinedKeys,["pinnacle:spread"]);
assert.equal(run([current[1]],{anchors:corruptAnchor.receipt.anchors}).receipt.episodes.length,0,"an ambiguous original source cannot qualify a later episode");
assert.throws(()=>run(current,{independent:{...forecast(),asOf:"2026-11-02T18:00:00Z"}}),/prelock/);
const flow=(firstMoney:number,firstTickets:number):CbbBehaviorFlow=>({provider:"owls",gameId:777,sourceBook:"pinnacle",market:"spread",line:-3.5,
 firstMoney,secondMoney:1-firstMoney,firstTickets,secondTickets:1-firstTickets,sourceEventId:"ncaab:Away@Home-20261102",sourceIdentity:"independent_named_fixture_join",observedAt:"2026-11-02T15:10:00.000Z",fetchedAt:"2026-11-02T15:11:00.000Z",orientationVerified:true});
const risk=run([quote("spread",-3.5,-115,-105,"pinnacle",true)],{independent:forecast(12),anchors:anchors([quote("spread",-3.5,-150,130)]),flows:[flow(.1,.6)]});
const riskInput={forecast:risk.forecast,target:targets[1],references:[quote("spread",-3.5,-115,-105,"pinnacle",true)],asOf:at};
assert.equal(gradeCbbProvisional(riskInput).grade,"Best Angle");assert.equal(gradeCbbMarketBehavior(riskInput,risk.receipt).grade,"Lean","one bound resisting source tempers Best without fabricating corroboration");
const support=run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{anchors:anchors([quote("spread",-3.5,120,-140)]),flows:[flow(.8,.4)]});
const supportInput={forecast:support.forecast,target:targets[1],references:[quote("spread",-3.5,-110,-110,"pinnacle",true)],asOf:at};
assert.equal(gradeCbbProvisional(supportInput).grade,"Watchlist");assert.equal(gradeCbbMarketBehavior(supportInput,support.receipt).grade,"Lean","paired confirming path promotes eligible positive-value neutral-reference Watchlist");
for(const badFlow of [{...flow(.8,.4),line:-4.5},{...flow(.8,.4),orientationVerified:false},{...flow(.8,.4),observedAt:"2026-11-02T15:25:00Z"},{...flow(.8,.4),fetchedAt:"2026-11-02T15:25:00Z"}]){
 const unbound=run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{anchors:anchors([quote("spread",-3.5,120,-140)]),flows:[badFlow]});
 assert.equal(gradeCbbMarketBehavior({...supportInput,forecast:unbound.forecast},unbound.receipt).actualActionConfirmation,false,"unbound flow cannot claim sharp action");
}
const opposedSupport=run([quote("spread",-3.5,-110,-110,"pinnacle",true),oppositeMl],{anchors:anchors([quote("spread",-3.5,120,-140),quote("moneyline",null,-200,170)]),flows:[flow(.8,.4)]});
assert.equal(opposedSupport.receipt.margin.status,"conflicting");
assert.equal(gradeCbbMarketBehavior({...supportInput,forecast:opposedSupport.forecast},opposedSupport.receipt).grade,"Watchlist","rejected opposing ML/Spread cannot be promoted through a flow side door");
for(const mutation of [{target:{...supportInput.target,sportsbook:"pinnacle"}},{target:{...supportInput.target,line:-2.5}},{asOf:"2026-11-02T15:31:00Z"}])
 assert.throws(()=>gradeCbbMarketBehavior({...supportInput,...mutation},support.receipt),/receipt mismatch/);
const marketOpposition=[quote("moneyline",null,130,-152,"pinnacle",true),quote("spread",3,-109,-107,"pinnacle",true)];
const arbitrated=run(marketOpposition,{independent:forecast(14),anchors:null});
assert.equal(arbitrated.receipt.winnerArbitration.status,"context_only");
assert.equal(arbitrated.forecast.margin,14,"static opposition invents no points and cannot copy a professional winner");
assert.equal(arbitrated.forecast.homeWinProbability,forecast(14).homeWinProbability);
const mirror=run([quote("moneyline",null,-152,130,"pinnacle",true),quote("spread",-3,-107,-109,"pinnacle",true)],{independent:forecast(-14),anchors:null});
assert.equal(mirror.receipt.winnerArbitration.status,"context_only");assert.equal(mirror.forecast.margin,-14);
const disputed=run([...marketOpposition,quote("moneyline",null,-150,130,"circa",true)],{independent:forecast(14),anchors:null});
assert.equal(disputed.receipt.winnerArbitration.status,"conflicting");assert.equal(disputed.forecast.margin,14);
const quarantinedWinner=run(marketOpposition,{independent:forecast(14),anchors:{...anchors([{...marketOpposition[1],firstPrice:-130,secondPrice:110}]),capturedAt:at}});
assert.deepEqual(quarantinedWinner.receipt.anchors.quarantinedKeys,["pinnacle:spread"]);
assert.equal(quarantinedWinner.forecast.margin,14);
assert.deepEqual(run(marketOpposition,{independent:forecast(14),anchors:{...anchors([{...marketOpposition[1],providerObservedAt:"2026-11-02T15:20:00+00:00",firstPrice:-130,secondPrice:110}]),capturedAt:at}}).receipt.anchors.quarantinedKeys,["pinnacle:spread"]);
const ambiguousRef={...quote("spread",-3.5,-130,110),fetchedAt:current[1].fetchedAt};
const quarantineGradeRead=run([ambiguousRef],{independent:forecast(12),anchors:anchors([original[1]])});
const quarantineGradeInput={forecast:quarantineGradeRead.forecast,target:targets[1],references:[ambiguousRef],asOf:at};
assert.equal(gradeCbbProvisional(quarantineGradeInput).grade,"Best Angle");
const quarantineGrade=gradeCbbMarketBehavior(quarantineGradeInput,quarantineGradeRead.receipt);
assert.equal(quarantineGrade.referenceState,"unavailable");assert.equal(quarantineGrade.professionalReferences,0);
assert.equal(quarantineGrade.price,quarantineGradeInput.target.firstPrice,"quarantine cannot replace the actual executable target");
const goodRef=quote("spread",-3.5,-115,-105,"circa",true);
const preservedRefRead=run([ambiguousRef,goodRef],{independent:forecast(12),anchors:anchors([original[1]])});
const preservedRefGrade=gradeCbbMarketBehavior({...quarantineGradeInput,forecast:preservedRefRead.forecast,references:[ambiguousRef,goodRef]},preservedRefRead.receipt);
assert.deepEqual(preservedRefGrade.professionalReferenceQuotes,[goodRef],"unrelated verified reference remains exact");
const justAbove=run(marketOpposition,{independent:forecast(.0001),anchors:null}),justBelow=run(marketOpposition,{independent:forecast(-.0001),anchors:null});
assert.ok(Math.abs(justAbove.forecast.margin-justBelow.forecast.margin-.0002)<1e-10,"no sign-triggered market-copy discontinuity");
const unequal=run([current[1],quote("spread",-5.5,-110,-110,"circa",true)],{anchors:anchors([...original,quote("spread",-3.5,-110,-110,"circa")])});
assert.equal(unequal.receipt.margin.status,"unresolved","agreeing unequal magnitudes retain their direction without inventing a scalar response");
assert.equal(unequal.receipt.margin.directionalEvidence,"aligned");
assert.equal(unequal.receipt.margin.sourceDirection,1);
assert.equal(unequal.forecast.margin,forecast().margin);
assert.equal(unequal.receipt.pathPosture.filter(s=>s.market==="spread"&&s.recentDirection===1).length,2,"all source posture survives numeric deferral");
for(const market of ["spread","total"] as const)for(const sign of [1,-1] as const){
 const line=market==="spread"?0:150.5,step=market==="spread"?-sign:sign;
 const baseline=[quote(market,line,-110,-110,"pinnacle"),quote(market,line,-110,-110,"circa")];
 const agreeing=run([quote(market,line+step,-110,-110,"pinnacle",true),quote(market,line+2*step,-110,-110,"circa",true)],{anchors:anchors(baseline)});
 const axis=market==="spread"?agreeing.receipt.margin:agreeing.receipt.total;
 assert.equal(axis.status,"unresolved");assert.equal(axis.directionalEvidence,"aligned");assert.equal(axis.sourceDirection,sign);
 assert.equal(axis.delta,0,"directional agreement alone does not invent a scalar magnitude");
 const opposed=run([quote(market,line+step,-110,-110,"pinnacle",true),quote(market,line-step,-110,-110,"circa",true)],{anchors:anchors(baseline)});
 const adverse=market==="spread"?opposed.receipt.margin:opposed.receipt.total;
 assert.equal(adverse.status,"conflicting");assert.equal(adverse.directionalEvidence,"opposed");assert.equal(adverse.sourceDirection,null);
 const sole=run([quote(market,line+step,-110,-110,"pinnacle",true),quote(market,line,-110,-110,"circa",true)],{anchors:anchors(baseline)});
 const moving=market==="spread"?sole.receipt.margin:sole.receipt.total;
 assert.equal(moving.status,"applied");assert.equal(moving.directionalEvidence,"single_source");assert.equal(moving.sourceDirection,sign);
}
// A durable JSONB round trip reorders keys without changing evidence. Bind
// identical values while continuing to reject actual score/target tampering.
const jsonbOrder=(value:unknown):unknown=>Array.isArray(value)?value.map(jsonbOrder):value&&typeof value==="object"
 ?Object.fromEntries(Object.keys(value).sort().reverse().map(key=>[key,jsonbOrder((value as Record<string,unknown>)[key])])):value;
const durableReceipt=jsonbOrder(result.receipt) as typeof result.receipt;
const durableForecast=jsonbOrder(result.forecast) as typeof result.forecast;
const durableTarget=targets[1],expectedDurableGrade=gradeCbbMarketBehavior({forecast:result.forecast,target:durableTarget,references:[],asOf:at},result.receipt);
assert.deepEqual(gradeCbbMarketBehavior({forecast:durableForecast,target:jsonbOrder(durableTarget) as typeof durableTarget,references:[],asOf:at},durableReceipt),expectedDurableGrade);
const changedDurable=structuredClone(durableReceipt);changedDurable.finalScore.margin+=.01;
assert.throws(()=>gradeCbbMarketBehavior({forecast:durableForecast,target:durableTarget,references:[],asOf:at},changedDurable),/receipt mismatch/);
assert.throws(()=>gradeCbbMarketBehavior({forecast:durableForecast,target:{...durableTarget,firstPrice:112},references:[],asOf:at},durableReceipt),/receipt mismatch/);
const noFlow=run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{anchors:anchors([quote("spread",-3.5,120,-140)])});
const pricePromoted=gradeCbbMarketBehavior({...supportInput,forecast:noFlow.forecast},noFlow.receipt);
assert.equal(pricePromoted.grade,"Lean","qualified economic price path promotes without split availability");
assert.equal(pricePromoted.economicPathConfirmation,true);assert.equal(pricePromoted.actualActionConfirmation,false,"price action cannot invent identified native flow");
const sourceVigRead=run([quote("spread",-3.5,-115,-105,"pinnacle",true)],{anchors:anchors([quote("spread",-3.5,-115,-105)])});
const sourceVig=gradeCbbMarketBehavior({forecast:sourceVigRead.forecast,target:targets[1],references:[quote("spread",-3.5,-115,-105,"pinnacle",true)],asOf:at},sourceVigRead.receipt);
assert.equal(sourceVig.grade,"Lean","source-implied ordinary vig loss does not veto eligible independent model value");
assert.ok(sourceVig.professionalTargetEconomics[0].expectedValue<0);assert.equal(sourceVig.economicCorroboration,false);
const valueTarget=quote("spread",-3.5,110,-130,"draftkings",true),valueRead=run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{targets:[valueTarget],anchors:null});
const valueGrade=gradeCbbMarketBehavior({forecast:valueRead.forecast,target:valueTarget,references:[quote("spread",-3.5,-110,-110,"pinnacle",true)],asOf:at},valueRead.receipt);
assert.equal(valueGrade.grade,"Best Angle");assert.equal(valueGrade.economicCorroboration,true);assert.equal(valueGrade.actualActionConfirmation,false);
// Identical final law/current economics must not receive a second pure-price
// penalty solely because its genuine adverse response was fully transported.
for(const market of ["spread","total"] as const)for(const pickSign of [1,-1] as const)for(const books of [["pinnacle"],["circa","pinnacle"]]){
 const line=market==="spread"?-3.5*pickSign:150.5;
 const independent=market==="spread"?forecast(12*pickSign):forecast(0,pickSign===1?166:134);
 const target=quote(market,line,pickSign===1?110:-130,pickSign===1?-130:110,"draftkings",true);
 const sources=books.map(book=>quote(market,line,-110,-110,book,true));
 const old=books.map(book=>quote(market,line-pickSign,-110,-110,book));
 // Total center follows its line; spread center has the opposite sign.
 if(market==="total")for(const q of old)q.line=line+pickSign;
 const applied=run(sources,{independent,targets:[target],anchors:anchors(old)});
 const axis=market==="total"?applied.receipt.total:applied.receipt.margin;
 assert.equal(axis.status,"applied");assert.ok(axis.delta*pickSign<0);
 const grade=gradeCbbMarketBehavior({forecast:applied.forecast,target,references:[],asOf:at},applied.receipt);
 const sameLaw=run(sources,{independent:{...applied.forecast,release:CBB_CURRENT_SCORE_RELEASE},targets:[target],anchors:null});
 const staticGrade=gradeCbbMarketBehavior({forecast:sameLaw.forecast,target,references:[],asOf:at},sameLaw.receipt);
 assert.equal(grade.grade,"Best Angle");assert.equal(grade.grade,staticGrade.grade);
 assert.equal(grade.pathResistance,false);assert.equal(grade.economicCorroboration,true);
 assert.equal(grade.economicPathConfirmation,false,"already applied adverse price is not invented positive confirmation");
 assert.equal(grade.actualActionConfirmation,false);assert.equal(grade.modelExpectedValue,staticGrade.modelExpectedValue);
 for(const neutral of [flow(.5,.5),{...flow(.5,.49),secondMoney:.49}]){
  const neutralRead=run(sources,{independent,targets:[target],anchors:anchors(old),flows:[{...neutral,sourceBook:books[0],market,line:old[0].line}]});
  assert.equal(neutralRead.receipt.pathPosture.find(s=>s.book===books[0])?.boundFlowDirection,0);
  const neutralGrade=gradeCbbMarketBehavior({forecast:neutralRead.forecast,target,references:[],asOf:at},neutralRead.receipt);
  assert.equal(neutralGrade.grade,"Best Angle","neutral or rounding-uncertain native flow cannot recreate a duplicate adverse-price penalty");
  assert.equal(neutralGrade.pathResistance,false);assert.equal(neutralGrade.actualActionConfirmation,false);
 }
 const opposingNative=run(sources,{independent,targets:[target],anchors:anchors(old),
  flows:[{...flow(pickSign===1?.2:.8,pickSign===1?.6:.4),sourceBook:books[0],market,line:old[0].line}]});
 const nativeGrade=gradeCbbMarketBehavior({forecast:opposingNative.forecast,target,references:[],asOf:at},opposingNative.receipt);
 assert.equal(nativeGrade.pathResistance,true);assert.equal(nativeGrade.grade,"Lean","genuine directional native pressure remains independent information, not transported price twice");
 const truncatedReceipt=structuredClone(applied.receipt);truncatedReceipt.pathPosture.forEach(s=>{s.coverage="truncated_window";});
 const truncatedGrade=gradeCbbMarketBehavior({forecast:applied.forecast,target,references:[],asOf:at},truncatedReceipt);
 assert.equal(truncatedGrade.pathResistance,true);assert.notEqual(truncatedGrade.grade,"Best Angle","a truncated tape cannot prove full response resolution");
 const partial=run(sources,{independent,targets:[target],anchors:anchors(old),historyCompleteness:{price:false,split:true}});
 const partialGrade=gradeCbbMarketBehavior({forecast:partial.forecast,target,references:[],asOf:at},partial.receipt);
 assert.equal(partialGrade.pathResistance,true);assert.notEqual(partialGrade.grade,"Best Angle");
}
const badTargetClock={...targets[1],fetchedAt:"2026-11-02T15:19:00Z",providerObservedAt:"2026-11-02T15:18:00Z"};
const earlyTarget=run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{targets:[badTargetClock],anchors:anchors([quote("spread",-3.5,120,-140)])});
assert.equal(gradeCbbMarketBehavior({...supportInput,forecast:earlyTarget.forecast,target:badTargetClock},earlyTarget.receipt).economicPathConfirmation,false,"target must be received after source economics became available");
const offTarget=run([quote("spread",-3.5,-115,-105,"circa",true)],{anchors:anchors([quote("spread",-3.5,-150,130,"circa")]),flows:[{...flow(.2,.2),sourceBook:"circa",line:-4.5}]});
const offTargetGrade=gradeCbbMarketBehavior({forecast:offTarget.forecast,target:targets[1],references:[quote("spread",-3.5,-115,-105,"circa",true)],asOf:at},offTarget.receipt);
assert.equal(offTargetGrade.pathResistance,true,"native80/80 opposite concentration matters even at another source threshold");assert.equal(offTargetGrade.actualActionConfirmation,false);
const priceBest=run([quote("spread",-3.5,-115,-105,"pinnacle",true)],{anchors:anchors([quote("spread",-3.5,-110,-110)])});
const priceBestGrade=gradeCbbMarketBehavior({forecast:priceBest.forecast,target:targets[1],references:[quote("spread",-3.5,-115,-105,"pinnacle",true)],asOf:at},priceBest.receipt);
assert.equal(priceBestGrade.grade,"Lean","a clean price tick without target value or exact native action cannot certify Best");
assert.equal(priceBestGrade.economicCorroboration,false);assert.equal(priceBestGrade.economicPathConfirmation,true);assert.equal(priceBestGrade.actualActionConfirmation,false);
const twoOpposed=run([quote("spread",-3.5,-115,-105,"pinnacle",true),quote("spread",-3.5,-115,-105,"circa",true)],{
 independent:forecast(12),anchors:anchors([quote("spread",-3.5,-150,130),quote("spread",-3.5,-150,130,"circa")]),
 flows:[flow(.1,.6),{...flow(.1,.6),sourceBook:"circa"}]});
const twoOpposedGrade=gradeCbbMarketBehavior({forecast:twoOpposed.forecast,target:targets[1],references:[quote("spread",-3.5,-115,-105,"pinnacle",true),quote("spread",-3.5,-115,-105,"circa",true)],asOf:at},twoOpposed.receipt);
assert.equal(twoOpposedGrade.grade,"Lean","equal adverse transport already in final law cannot impose another Lean penalty");
const twoPriceOnly=run([quote("spread",-3.5,-115,-105,"pinnacle",true),quote("spread",-3.5,-115,-105,"circa",true)],{
 independent:forecast(12),anchors:anchors([quote("spread",-3.5,-150,130),quote("spread",-3.5,-150,130,"circa")])});
assert.equal(gradeCbbMarketBehavior({forecast:twoPriceOnly.forecast,target:targets[1],references:[quote("spread",-3.5,-115,-105,"pinnacle",true),quote("spread",-3.5,-115,-105,"circa",true)],asOf:at},twoPriceOnly.receipt).grade,"Lean","equal price-only adverse transport is not counted twice");
const midway={...quote("spread",-3.5,-140,120,"pinnacle",true),providerObservedAt:"2026-11-02T15:10:00Z",fetchedAt:"2026-11-02T15:11:00Z"};
const boughtBack=run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{historyQuotes:[midway],anchors:anchors([quote("spread",-3.5,-110,-110)])});
assert.equal(boughtBack.receipt.margin.status,"neutral");
assert.equal(boughtBack.receipt.pathPosture[0].pattern,"buyback");assert.equal(boughtBack.receipt.pathPosture[0].recentDirection,-1,"zero original-to-current net does not erase adverse buyback");
const buybackGrade=gradeCbbMarketBehavior({forecast:boughtBack.forecast,target:valueTarget,references:[quote("spread",-3.5,-110,-110,"pinnacle",true)],asOf:at},run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{targets:[valueTarget],historyQuotes:[midway],anchors:anchors([quote("spread",-3.5,-110,-110)])}).receipt);
assert.notEqual(buybackGrade.grade,"Best Angle");assert.equal(buybackGrade.pathResistance,true);
const snapshotBefore=JSON.stringify(result.receipt.anchors);
const carried=run(current,{anchors:result.receipt.anchors,previousPath:result.receipt.pathTape});
assert.equal(JSON.stringify(carried.receipt.anchors),snapshotBefore);assert.deepEqual(carried.receipt.pathTape,result.receipt.pathTape,"repeat receipt keeps compact original tape exact");
const temporarilyExcluded=run(current,{anchors:result.receipt.anchors,targets:[...targets.slice(0,2),quote("total",150.5,-110,-110,"ps3838",true)]});
assert.deepEqual(temporarilyExcluded.receipt.anchors.quotes,result.receipt.anchors.quotes,"temporary target union exclusion cannot erase original anchors");
assert.equal(temporarilyExcluded.receipt.episodes.length,0);
const historicalSeed=run(current,{anchors:null,historyQuotes:original});
assert.deepEqual(historicalSeed.receipt.anchors.quotes.map(q=>q.firstPrice),original.map(q=>q.firstPrice),"earliest genuinely available source pairs seed a new reader");
const mlOnly=run([current[0]],{anchors:anchors([original[0]])});
const implied=(price:number)=>price>0?100/(price+100):-price/(-price+100),fairPair=(q:CbbQuote)=>implied(q.firstPrice)/(implied(q.firstPrice)+implied(q.secondPrice));
const logit=(p:number)=>Math.log(p/(1-p));
const expectedMlP=1/(1+Math.exp(-(logit(forecast().homeWinProbability)+logit(fairPair(current[0]))-logit(fairPair(original[0])))));
assert.ok(Math.abs(mlOnly.forecast.homeWinProbability-expectedMlP)<1e-9,"ML keeps declared log-odds response through original CBB law");
assert.ok(Math.abs(result.forecast.total-forecast().total-(cbbExactMarketCenter(forecast(),current[2],fairPair(current[2]))-cbbExactMarketCenter(forecast(),original[2],fairPair(original[2]))))<1e-9,"Total uses full exact-center difference");
const nativeAnchor={...original[1],providerObservedAt:"2026-11-02T15:05:00Z",fetchedAt:"2026-11-02T15:00:00Z",
 canonicalReceipt:{kind:"db_inserted_upper_bound" as const,availableBy:"2026-11-02T15:10:00Z",providerEventId:"native-event",ingestionRunId:"native-run",observationIds:[1,2] as [number,number],rawPayloadHashes:["a".repeat(64),"b".repeat(64)] as [string,string]}};
const native=run([current[1]],{anchors:null,historyQuotes:[nativeAnchor]});
assert.equal(native.receipt.margin.status,"applied");assert.equal(native.receipt.anchors.quotes[0].fetchedAt,nativeAnchor.fetchedAt,"DB availability bound does not overwrite original collector clock");
assert.deepEqual(native.receipt.anchors.quotes[0].canonicalReceipt,nativeAnchor.canonicalReceipt);
const uncertainArrival=run([current[1]],{anchors:null,historyQuotes:[{...nativeAnchor,canonicalReceipt:{...nativeAnchor.canonicalReceipt,availableBy:"2026-11-02T15:25:00Z"}}]});
assert.equal(uncertainArrival.forecast.margin,forecast().margin,"overlapping native receipt windows cannot invent chronological response");
const economicInput={forecast:valueRead.forecast,target:valueTarget,references:[quote("spread",-3.5,-110,-110,"pinnacle",true)],asOf:at};
for(const reference of [
 {...economicInput.references[0],canonicalReceipt:{...nativeAnchor.canonicalReceipt,availableBy:"2026-11-02T15:31:00Z"}},
 {...economicInput.references[0],canonicalReceipt:{...nativeAnchor.canonicalReceipt,rawPayloadHashes:["invalid","invalid"] as [string,string]}},
 {...economicInput.references[0],canonicalReceipt:{...nativeAnchor.canonicalReceipt,observationIds:[1,1] as [number,number]}},
]){
 const badReferenceRead=run([reference],{targets:[valueTarget],anchors:null});
 const futureOrMalformed=gradeCbbMarketBehavior({...economicInput,forecast:badReferenceRead.forecast,references:[reference]},badReferenceRead.receipt);
 assert.equal(futureOrMalformed.professionalReferences,0);assert.equal(futureOrMalformed.economicCorroboration,false);
 assert.notEqual(futureOrMalformed.grade,"Best Angle","future/malformed native reference cannot authorize economic Best");
 assert.equal(reference.fetchedAt,economicInput.references[0].fetchedAt,"no clock retiming to satisfy legacy triage");
}
const validNativeRef={...economicInput.references[0],canonicalReceipt:{...nativeAnchor.canonicalReceipt,availableBy:"2026-11-02T15:25:00Z"}};
const validNativeRead=run([validNativeRef],{targets:[valueTarget],anchors:null});
assert.equal(gradeCbbMarketBehavior({...economicInput,forecast:validNativeRead.forecast,references:[validNativeRef]},validNativeRead.receipt).economicCorroboration,true,"native reference availability bound must genuinely precede decision");
for(const target of [
 {...valueTarget,fetchedAt:"2026-11-02T15:31:00Z"},
 {...valueTarget,fetchedAt:"invalid"},
 {...valueTarget,canonicalReceipt:{...nativeAnchor.canonicalReceipt,availableBy:"2026-11-02T15:31:00Z"}},
 {...valueTarget,canonicalReceipt:{...nativeAnchor.canonicalReceipt,rawPayloadHashes:["invalid","invalid"] as [string,string]}},
 {...valueTarget,canonicalReceipt:{...nativeAnchor.canonicalReceipt,availableBy:"2026-11-02T15:25:00Z"}},
]){
 const targetRead=run(economicInput.references,{targets:[target],anchors:null});
 const held=gradeCbbMarketBehavior({...economicInput,forecast:targetRead.forecast,target},targetRead.receipt);
 assert.equal(held.grade,"Held","future/malformed receipt or canonical history cannot be execution authority");
 assert.equal(held.price,null);assert.equal(held.professionalTargetEconomics.length,0);assert.equal(held.actualActionConfirmation,false);
}
for(const mutated of [
 {...support.forecast,uncertainty:{...support.forecast.uncertainty,marginSd:12}},
 {...support.forecast,uncertainty:{...support.forecast.uncertainty,totalSd:17}},
 {...support.forecast,uncertainty:{...support.forecast.uncertainty,marginTotalCorrelation:.1}},
 {...support.forecast,homeId:999},{...support.forecast,awayId:999},
 {...support.forecast,possessions:71},{...support.forecast,issues:["changed"]},
 {...support.forecast,inputStatus:"incomplete" as const},
]){
 assert.throws(()=>gradeCbbMarketBehavior({...supportInput,forecast:mutated},support.receipt),/receipt mismatch/);
 assert.throws(()=>gradeCbbReceivedMarket({...supportInput,forecast:mutated},support.receipt),/receipt mismatch/,"direct helper cannot bypass full-law binding");
}
assert.notStrictEqual(support.receipt.frozenUncertainty,support.forecast.uncertainty,"receipt owns a deep clone of the uncertainty law");
const quarantineDescriptor={book:"pinnacle",market:"spread" as const,sourceAt:"2026-11-02T15:10:00Z",reason:"native_pair_conflict"};
const forcedQuarantine=run([current[1]],{quarantinedSources:[quarantineDescriptor]});
assert.equal(forcedQuarantine.forecast.margin,forecast().margin);
assert.ok(forcedQuarantine.receipt.anchors.quarantinedKeys?.includes("pinnacle:spread"));
assert.equal(forcedQuarantine.receipt.pathPosture.find(p=>p.book==="pinnacle"&&p.market==="spread")?.status,"conflicting");
const forcedGrade=gradeCbbMarketBehavior({forecast:forcedQuarantine.forecast,target:targets[1],references:[current[1]],asOf:at},forcedQuarantine.receipt);
assert.equal(forcedGrade.professionalReferences,0);assert.equal(forcedGrade.economicCorroboration,false);assert.equal(forcedGrade.actualActionConfirmation,false);
const gapDominates=run([quote("spread",-3.5,-110,-110,"circa",true)],{anchors:null,flows:[{...flow(.8,.9),sourceBook:"circa"}]});
assert.equal(gapDominates.receipt.pathPosture.find(s=>s.book==="circa")?.flowConcentrationDirection,-1,"candidate uses shared gap-first source pressure contract even with majority concentration");
const uncertainRounding=run([quote("spread",-3.5,-110,-110,"circa",true)],{anchors:null,flows:[{...flow(.43,.44),secondMoney:.58,sourceBook:"circa"}]});
assert.equal(uncertainRounding.receipt.pathPosture.find(s=>s.book==="circa")?.flowConcentrationDirection,0,"published101% rounding cannot invent a one-point pressure direction");
const incompleteHistory=run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{
 anchors:anchors([quote("spread",-3.5,120,-140)]),historyCompleteness:{price:false,split:true}});
const incompleteGrade=gradeCbbMarketBehavior({...supportInput,forecast:incompleteHistory.forecast},incompleteHistory.receipt);
assert.equal(incompleteGrade.grade,"Watchlist","supportive endpoints cannot bridge an unknown canonical middle into a clean promotion");
assert.equal(incompleteGrade.economicPathConfirmation,false);assert.equal(incompleteGrade.pathResistance,true);
assert.equal(incompleteHistory.receipt.numericPathAssumption,"original_anchor_to_current_endpoint_response");
assert.equal(incompleteHistory.receipt.historyMode,"canonical_history");
const incompleteSplits=run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{
 anchors:anchors([quote("spread",-3.5,120,-140)]),flows:[flow(.8,.4)],historyCompleteness:{price:true,split:false}});
const incompleteSplitGrade=gradeCbbMarketBehavior({...supportInput,forecast:incompleteSplits.forecast},incompleteSplits.receipt);
assert.equal(incompleteSplitGrade.economicPathConfirmation,true);assert.equal(incompleteSplitGrade.actualActionConfirmation,false,"incomplete native split history cannot claim clean sharp action");
for(const requestedAt of [undefined,"invalid","2026-11-02T15:20:59Z","2026-11-02T15:22:00Z"]){
 const target={...targets[1],requestedAt};
 const requestRead=run([quote("spread",-3.5,-115,-105,"pinnacle",true)],{targets:[target],anchors:anchors([quote("spread",-3.5,-110,-110)])});
 const grade=gradeCbbMarketBehavior({forecast:requestRead.forecast,target,references:[],asOf:at},requestRead.receipt);
 assert.equal(grade.grade,"Lean","missing/invalid/prior request start withholds only causal promotion");assert.equal(grade.economicPathConfirmation,false);
}
assert.throws(()=>gradeCbbMarketBehavior({...supportInput,target:{...targets[1],requestedAt:"2026-11-02T15:21:01Z"}},support.receipt),/receipt mismatch/);
// Native and direct source quotes compete at the same latest source frontier.
const latestNative={...quote("spread",-4.5,-110,-110,"pinnacle",true),providerObservedAt:"2026-11-02T15:25:00Z",fetchedAt:"2026-11-02T15:24:00Z",
 canonicalReceipt:{...nativeAnchor.canonicalReceipt,availableBy:"2026-11-02T15:26:00Z"}};
const olderHttp=quote("spread",-3.5,-105,-115,"pinnacle",true);
const frontier=run([olderHttp],{historyQuotes:[latestNative],anchors:anchors([quote("spread",-3.5)]),historyCompleteness:{price:true,split:true}});
assert.equal(frontier.receipt.episodes[0].current.providerObservedAt,latestNative.providerObservedAt);
assert.deepEqual(frontier.receipt.currentProfessionalQuotes,[latestNative]);
assert.ok(Math.abs(frontier.forecast.margin-forecast().margin-(cbbExactMarketCenter(forecast(),latestNative,.5)-cbbExactMarketCenter(forecast(),original[1],.5)))<1e-9);
const frontierGrade=gradeCbbMarketBehavior({forecast:frontier.forecast,target:targets[1],references:[olderHttp],asOf:at},frontier.receipt);
assert.deepEqual(frontierGrade.professionalReferenceQuotes,[latestNative],"grade uses receipt frontier, not stale caller references");
assert.equal(frontierGrade.professionalReferenceQuotes[0].fetchedAt,"2026-11-02T15:24:00Z","native run-start clock stays exact");
assert.ok(frontierGrade.professionalTargetEconomics[0].expectedValue>0);
// Money-relative response labels are not automatically resistance to the pick.
for(const market of ["spread","total"] as const)for(const pickSign of [1,-1] as const){
 const line=market==="spread"?0:150.5,independent=market==="spread"?forecast(7*pickSign):forecast(0,pickSign===1?166:134);
 const target=quote(market,line,pickSign===1?110:-130,pickSign===1?-130:110,"draftkings",true);
 const scenario=(moneySign:number,priceSign:number,matched=true)=>{
  const source=quote(market,line,priceSign===0?-110:priceSign>0?-130:110,priceSign===0?-110:priceSign>0?110:-130,"circa",true);
  const nativeFlow={...flow(moneySign>0?.8:.2,moneySign>0?.8:.2),market,line,sourceBook:"circa"};
  const read=run([source],{independent,targets:[target],anchors:matched?anchors([quote(market,line,-110,-110,"circa")]):null,flows:[nativeFlow]});
  return {read,grade:gradeCbbMarketBehavior({forecast:read.forecast,target,references:[source],asOf:at},read.receipt)};
 };
 const aligned=scenario(pickSign,pickSign);assert.equal(aligned.grade.pathResistance,false);assert.equal(aligned.grade.actualActionConfirmation,true);
 assert.equal(aligned.grade.grade,"Best Angle","verified exact-contract action remains a symmetric Best promotion path");
 const againstMoney=scenario(-pickSign,pickSign);assert.equal(againstMoney.read.receipt.pathPosture[0].flowResponse,"opposed");
 assert.equal(againstMoney.grade.pathResistance,false,"price resisting opposite-side money supports the final pick");assert.equal(againstMoney.grade.grade,"Best Angle");
 const withMoneyResisted=scenario(pickSign,-pickSign);assert.equal(withMoneyResisted.grade.pathResistance,true);
 const heldOpposite=scenario(-pickSign,0);assert.equal(heldOpposite.read.receipt.pathPosture[0].latestFlowMatched,true);
 assert.equal(heldOpposite.grade.pathResistance,false,"held opposite-side money is not unmatched opposition to the pick");assert.equal(heldOpposite.grade.grade,"Best Angle");
 const heldToward=scenario(pickSign,0);assert.equal(heldToward.grade.pathResistance,true,"source holding pressure toward the pick remains concern");assert.equal(heldToward.grade.grade,"Lean");
 const unmatched=scenario(-pickSign,0,false);assert.equal(unmatched.read.receipt.pathPosture[0].latestFlowMatched,false);
 assert.equal(unmatched.grade.pathResistance,true);assert.equal(unmatched.grade.grade,"Lean");
}
for(const pickSign of [1,-1] as const){
 const target=quote("spread",0,-110,-110,"draftkings",true),independent=forecast(12*pickSign);
 const before=pickSign===1?[-150,130]:[130,-150],after=pickSign===1?[-115,-105]:[-105,-115];
 const a=quote("spread",0,after[0],after[1],"pinnacle",true),b=quote("spread",0,-110,-110,"circa",true);
 const unresolved=run([a,b],{independent,targets:[target],anchors:anchors([quote("spread",0,before[0],before[1],"pinnacle"),quote("spread",0,before[0],before[1],"circa")])});
 assert.equal(unresolved.receipt.margin.status,"unresolved");
 assert.equal(unresolved.receipt.margin.directionalEvidence,"aligned");
 assert.equal(gradeCbbMarketBehavior({forecast:unresolved.forecast,target,references:[],asOf:at},unresolved.receipt).grade,"Watchlist","two physical unresolved adverse source paths can constrain Lean symmetrically");
 const equal=run([a,{...a,sportsbook:"circa"}],{independent,targets:[target],anchors:anchors([quote("spread",0,before[0],before[1],"pinnacle"),quote("spread",0,before[0],before[1],"circa")])});
 assert.equal(equal.receipt.margin.status,"applied");
 assert.equal(gradeCbbMarketBehavior({forecast:equal.forecast,target,references:[],asOf:at},equal.receipt).grade,"Lean","two equal resolved moves retain eligible Lean after exact law transport");
}
for(const market of ["spread","total"] as const)for(const pickSign of [1,-1] as const){
 const line=market==="spread"?0:150.5,independent=market==="spread"?forecast(7*pickSign):forecast(0,pickSign===1?166:134);
 const target=quote(market,line,-110,-110,"draftkings",true);
 const old=quote(market,line,-110,-110,"circa");
 const moved={...quote(market,line,pickSign===1?-140:120,pickSign===1?120:-140,"circa",true),providerObservedAt:"2026-11-02T15:05:00Z",fetchedAt:"2026-11-02T15:06:00Z"};
 const cancelled={...quote(market,line,-110,-110,"circa",true),providerObservedAt:"2026-11-02T15:10:00Z",fetchedAt:"2026-11-02T15:11:00Z"};
 const sourceFlow={...flow(pickSign===1?.8:.2,pickSign===1?.4:.6),market,line,sourceBook:"circa",observedAt:"2026-11-02T15:03:00Z",fetchedAt:"2026-11-02T15:04:00Z"};
 const check=(firstPrice:number,secondPrice:number)=>{
  const final=quote(market,line,firstPrice,secondPrice,"circa",true);
  const read=run([final],{independent,targets:[target],anchors:anchors([old]),historyQuotes:[moved,cancelled],flows:[sourceFlow]});
  return {read,grade:gradeCbbMarketBehavior({forecast:read.forecast,target,references:[],asOf:at},read.receipt)};
 };
 const full=check(pickSign===1?-140:120,pickSign===1?120:-140);
 assert.equal(full.read.receipt.pathPosture[0].flowReversed,true);assert.equal(full.read.receipt.pathPosture[0].flowCurrentResolution,"resumed");
 assert.equal(full.grade.pathResistance,false);assert.equal(full.grade.economicPathConfirmation,true,"full current resumption recovers price confirmation without new split");
 const partial=check(pickSign===1?-120:100,pickSign===1?100:-120);
 assert.equal(partial.read.receipt.pathPosture[0].flowCurrentResolution,"contested");assert.equal(partial.grade.pathResistance,true);assert.equal(partial.grade.economicPathConfirmation,false);
 const fullCancel=check(-110,-110);
 assert.equal(fullCancel.read.receipt.pathPosture[0].flowCurrentResolution,"cancelled");assert.equal(fullCancel.read.receipt.pathPosture[0].flowReactionDirection,0);
 assert.equal(fullCancel.grade.actualActionConfirmation,false,"full cancellation cannot retain earlier native action support");
}
// A later refresh must not regress a known native frontier when its native
// reread fails and HTTP merely repeats an older provider source timestamp.
const nativeMl={...quote("moneyline",null,-170,145,"pinnacle",true),providerObservedAt:latestNative.providerObservedAt,fetchedAt:latestNative.fetchedAt,
 canonicalReceipt:{...latestNative.canonicalReceipt,observationIds:[3,4] as [number,number],rawPayloadHashes:["c".repeat(64),"d".repeat(64)] as [string,string]}};
const cachedMl=quote("moneyline",null,-150,130,"pinnacle",true);
const firstRefresh=run([olderHttp,cachedMl],{historyQuotes:[latestNative,nativeMl],anchors:anchors([original[1],original[0]]),historyCompleteness:{price:true,split:true}});
const nextAt="2026-11-02T15:35:00Z",nextTarget={...targets[1],requestedAt:"2026-11-02T15:33:00Z",fetchedAt:"2026-11-02T15:34:00Z"};
const secondRefresh=run([{...olderHttp,fetchedAt:"2026-11-02T15:34:00Z"},{...cachedMl,fetchedAt:"2026-11-02T15:34:00Z"}],{
 independent:{...forecast(),asOf:nextAt},targets:[nextTarget],anchors:firstRefresh.receipt.anchors,previousPath:firstRefresh.receipt.pathTape,
 historyQuotes:[],historyFlows:[],historyCompleteness:{price:false,split:false}});
assert.equal(secondRefresh.forecast.margin,firstRefresh.forecast.margin,"failed native reread cannot regress the source endpoint");
assert.equal(secondRefresh.receipt.episodes.find(e=>e.market==="spread")?.current.providerObservedAt,latestNative.providerObservedAt);
assert.deepEqual(JSON.parse(JSON.stringify(secondRefresh.receipt.winnerArbitration.spread)),JSON.parse(JSON.stringify(firstRefresh.receipt.winnerArbitration.spread)),"static context retains the exact latest known source pair");
assert.deepEqual(JSON.parse(JSON.stringify([...secondRefresh.receipt.currentProfessionalQuotes].sort((a,b)=>a.market.localeCompare(b.market)))),JSON.parse(JSON.stringify([...firstRefresh.receipt.currentProfessionalQuotes].sort((a,b)=>a.market.localeCompare(b.market)))));
const secondGrade=gradeCbbMarketBehavior({forecast:secondRefresh.forecast,target:nextTarget,references:[olderHttp],asOf:nextAt},secondRefresh.receipt);
assert.deepEqual(JSON.parse(JSON.stringify(secondGrade.professionalReferenceQuotes)),JSON.parse(JSON.stringify([latestNative])),"grade frontier remains the retained native pair");
assert.equal(secondGrade.economicPathConfirmation,false);assert.equal(secondGrade.actualActionConfirmation,false);
assert.equal(secondGrade.pathResistance,true);assert.notEqual(secondGrade.grade,"Best Angle","incomplete-history gates survive retained endpoint reuse");
for(const invalidPath of [
 {...firstRefresh.receipt.pathTape,gameId:999},
 {...firstRefresh.receipt.pathTape,startsAt:"2026-11-03T19:00:00Z"},
 {...firstRefresh.receipt.pathTape,capturedAt:"2026-11-02T15:36:00Z"},
 {...firstRefresh.receipt.pathTape,release:"invalid" as typeof firstRefresh.receipt.pathTape.release},
])assert.throws(()=>run([olderHttp],{independent:{...forecast(),asOf:nextAt},previousPath:invalidPath}),/prior identity\/cutoff mismatch/);
const quarantinedPrior=structuredClone(firstRefresh.receipt.pathTape);quarantinedPrior.streams.forEach(stream=>{stream.quarantined=true;});
const blockedRetained=run([olderHttp],{independent:{...forecast(),asOf:nextAt},previousPath:quarantinedPrior,anchors:firstRefresh.receipt.anchors});
assert.equal(blockedRetained.forecast.margin,forecast().margin);assert.equal(blockedRetained.receipt.currentProfessionalQuotes.length,0,"quarantined retained source cannot regain current reference authority");
const staleRetained=run([{...olderHttp,fetchedAt:"2026-11-02T16:34:00Z"}],{
 independent:{...forecast(),asOf:"2026-11-02T16:35:00Z"},anchors:firstRefresh.receipt.anchors,previousPath:firstRefresh.receipt.pathTape,
 historyCompleteness:{price:false,split:false}});
assert.equal(staleRetained.receipt.currentProfessionalQuotes.length,0,"retaining a known source pair does not refresh its native observation clock");
assert.equal(staleRetained.forecast.margin,forecast().margin);
console.log("PASS CBB received-market candidate: immutable anchors, exact response operators, path context, unresolved competition, static zero-point disagreement and economic/action grade separation.");
