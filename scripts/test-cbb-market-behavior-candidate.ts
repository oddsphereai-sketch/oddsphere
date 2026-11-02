import assert from "node:assert/strict";
import {readCbbMarketBehavior,gradeCbbMarketBehavior,CBB_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,type CbbMarketAnchors,type CbbBehaviorFlow} from "../lib/cbb/marketBehaviorCandidate";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {normalCdf,cbbThresholdProbabilities} from "../lib/cbb/model";
import {cbbExactMarketCenter} from "../lib/cbb/marketReaderResearch";
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
assert.equal(gradeCbbProvisional(riskInput).grade,"Best Angle");assert.equal(gradeCbbMarketBehavior(riskInput,risk.receipt).grade,"Watchlist","bound opposing price+handle can demote actionable value");
const support=run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{anchors:anchors([quote("spread",-3.5,120,-140)]),flows:[flow(.8,.4)]});
const supportInput={forecast:support.forecast,target:targets[1],references:[quote("spread",-3.5,-110,-110,"pinnacle",true)],asOf:at};
assert.equal(gradeCbbProvisional(supportInput).grade,"Watchlist");assert.equal(gradeCbbMarketBehavior(supportInput,support.receipt).grade,"Lean","paired confirming path promotes eligible positive-value neutral-reference Watchlist");
for(const badFlow of [{...flow(.8,.4),line:-4.5},{...flow(.8,.4),orientationVerified:false},{...flow(.8,.4),observedAt:"2026-11-02T15:25:00Z"},{...flow(.8,.4),fetchedAt:"2026-11-02T15:25:00Z"}]){
 const unbound=run([quote("spread",-3.5,-110,-110,"pinnacle",true)],{anchors:anchors([quote("spread",-3.5,120,-140)]),flows:[badFlow]});
 assert.equal(gradeCbbMarketBehavior({...supportInput,forecast:unbound.forecast},unbound.receipt).grade,"Watchlist","unbound flow cannot promote");
}
const opposedSupport=run([quote("spread",-3.5,-110,-110,"pinnacle",true),oppositeMl],{anchors:anchors([quote("spread",-3.5,120,-140),quote("moneyline",null,-200,170)]),flows:[flow(.8,.4)]});
assert.equal(opposedSupport.receipt.margin.status,"conflicting");
assert.equal(gradeCbbMarketBehavior({...supportInput,forecast:opposedSupport.forecast},opposedSupport.receipt).grade,"Watchlist","rejected opposing ML/Spread cannot be promoted through a flow side door");
for(const mutation of [{target:{...supportInput.target,sportsbook:"pinnacle"}},{target:{...supportInput.target,line:-2.5}},{asOf:"2026-11-02T15:31:00Z"}])
 assert.throws(()=>gradeCbbMarketBehavior({...supportInput,...mutation},support.receipt),/receipt mismatch/);
const marketOpposition=[quote("moneyline",null,130,-152,"pinnacle",true),quote("spread",3,-109,-107,"pinnacle",true)];
const arbitrated=run(marketOpposition,{independent:forecast(14),anchors:null});
assert.equal(arbitrated.receipt.winnerArbitration.status,"applied");assert.ok(arbitrated.forecast.margin<0&&arbitrated.forecast.homeWinProbability<.5,"consistent professional ML andSpread disagreement can correct either projected winner");
assert.equal(arbitrated.forecast.total,forecast(14).total,"a margin arbitration cannot invent a Total change");
assert.ok(Math.abs(arbitrated.forecast.margin-cbbExactMarketCenter(forecast(14),marketOpposition[1],(109/209)/(109/209+107/207)))<1e-9);
const mirror=run([quote("moneyline",null,-152,130,"pinnacle",true),quote("spread",-3,-107,-109,"pinnacle",true)],{independent:forecast(-14),anchors:null});
assert.equal(mirror.receipt.winnerArbitration.status,"applied");assert.ok(mirror.forecast.margin>0,"winner arbitration is symmetric, never team/favorite-specific");
const disputed=run([...marketOpposition,quote("moneyline",null,-150,130,"circa",true)],{independent:forecast(14),anchors:null});
assert.equal(disputed.receipt.winnerArbitration.status,"conflicting");assert.equal(disputed.forecast.margin,14,"a conflicting source cannot be silently averaged away");
assert.equal(arbitrated.receipt.margin.delta,arbitrated.forecast.margin-14,"current-level arbitration replaces, never doubles, the relative displacement");
const quarantinedWinner=run(marketOpposition,{independent:forecast(14),anchors:{...anchors([{...marketOpposition[1],firstPrice:-130,secondPrice:110}]),capturedAt:at}});
assert.deepEqual(quarantinedWinner.receipt.anchors.quarantinedKeys,["pinnacle:spread"]);
assert.notEqual(quarantinedWinner.receipt.winnerArbitration.status,"applied","quarantined source cannot regain forecast authority through static arbitration");
const ambiguousRef={...quote("spread",-3.5,-130,110),fetchedAt:current[1].fetchedAt};
const quarantineGradeRead=run([ambiguousRef],{independent:forecast(12),anchors:anchors([original[1]])});
const quarantineGradeInput={forecast:quarantineGradeRead.forecast,target:targets[1],references:[ambiguousRef],asOf:at};
assert.equal(gradeCbbProvisional(quarantineGradeInput).grade,"Best Angle");
const quarantineGrade=gradeCbbMarketBehavior(quarantineGradeInput,quarantineGradeRead.receipt);
assert.equal(quarantineGrade.referenceState,"unavailable");assert.equal(quarantineGrade.professionalReferences,0);
assert.equal(quarantineGrade.price,quarantineGradeInput.target.firstPrice,"quarantine cannot replace the actual executable target");
const goodRef=quote("spread",-3.5,-115,-105,"circa",true);
const preservedRefGrade=gradeCbbMarketBehavior({...quarantineGradeInput,references:[ambiguousRef,goodRef]},quarantineGradeRead.receipt);
assert.deepEqual(preservedRefGrade.professionalReferenceQuotes,[goodRef],"unrelated verified reference remains exact");
const incoherent=run([marketOpposition[0],quote("spread",100.5,-110,-110,"pinnacle",true)],{independent:forecast(7,10),anchors:null});
assert.equal(incoherent.receipt.winnerArbitration.status,"unavailable");assert.equal(incoherent.receipt.winnerArbitration.reason,"incoherent_score_consequence");
assert.deepEqual({...incoherent.forecast,release:CBB_CURRENT_SCORE_RELEASE},forecast(7,10),"fallback receipt cannot claim an arbitration that was not applied");
const justAbove=run(marketOpposition,{independent:forecast(.0001),anchors:null}),justBelow=run(marketOpposition,{independent:forecast(-.0001),anchors:null});
assert.equal(justAbove.receipt.winnerArbitration.status,"applied");assert.equal(justBelow.receipt.winnerArbitration.status,"not_needed");
assert.ok(Math.abs(justAbove.forecast.margin-justBelow.forecast.margin)>2,"explicitly expose the unqualified sign-switch discontinuity for review");
const valueTarget=quote("spread",2.5,-130,110,"draftkings",true),neutralCurrent=quote("spread",2.5,-110,-110,"pinnacle",true);
const overridden=run([marketOpposition[0],neutralCurrent],{independent:forecast(14),targets:[valueTarget],
 anchors:anchors([quote("moneyline",null,200,-250),quote("spread",2.5,-150,130)]),flows:[{...flow(.1,.6),line:2.5}]});
assert.equal(overridden.receipt.winnerArbitration.status,"applied");
assert.equal(new Set(overridden.receipt.episodes.map(e=>e.direction)).size,2,"relative ML and Spread paths are opposed");
const overriddenGrade={forecast:overridden.forecast,target:valueTarget,references:[neutralCurrent],asOf:at};
assert.equal(gradeCbbProvisional(overriddenGrade).grade,"Watchlist");
assert.equal(gradeCbbMarketBehavior(overriddenGrade,overridden.receipt).grade,"Watchlist","static winner arbitration cannot rehabilitate conflicting relative evidence into a flow promotion");
console.log("PASS private CBB market behavior: paired clocks, target exclusion, original anchors, arrivals, compensation, coherent law, quarantine, static-policy sensitivity, conflict rejection and bound grade consequences.");
