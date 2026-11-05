import assert from "node:assert/strict";
import {createCbbContextualScoreLaw} from "../lib/cbb/contextualScoreLawResearch";
import {createCbbJointSourceReferencePricer} from "../lib/cbb/contextualSourceReferenceResearch";
import type {CbbQuote} from "../lib/cbb/types";

const near=(a:number,b:number,e=1e-8)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const latent={marginMean:1,totalMean:11,marginSd:2,totalSd:3,correlation:.2},asOf="2026-11-04T18:30:00Z";
const quote=(book:string,market:CbbQuote["market"],line:number|null,firstPrice:number,secondPrice:number):CbbQuote&{orientationVerified:true}=>({
 gameId:1,market,line,firstPrice,secondPrice,sportsbook:book,provider:"owls",phase:"current",orientationVerified:true,
 requestedAt:"2026-11-04T18:00:00Z",providerObservedAt:"2026-11-04T17:59:00Z",fetchedAt:"2026-11-04T18:00:30Z"});
const law=createCbbContextualScoreLaw(latent),before=law.probabilitiesFast("spread",-2.5),bytes=JSON.stringify(latent);
const pricer=createCbbJointSourceReferencePricer({gameId:1,asOf,finalLatent:latent,finalLaw:law});
const sourceMl=quote("circa","moneyline",null,-120,120),targetMl=quote("fanduel","moneyline",null,110,-130);
const direct=pricer.evaluate({source:sourceMl,target:targetMl,selection:"first"});
assert.equal(direct.status,"direct");assert.equal(direct.role,"reference_economics_only");assert.equal(direct.finalForecastInfluence,"none");
near(direct.sourceConditionalFairFirst!,6/11);near(direct.targetExpectedValue!,6/11*1.1-5/11);
assert.equal(direct.targetValueSign,"positive");assert.equal(direct.probabilities!.push,0);assert.deepEqual(direct.assumptions,[]);
const bad=pricer.evaluate({source:sourceMl,target:{...targetMl,firstPrice:-200,secondPrice:170},selection:"first"});
assert.equal(bad.status,"direct");assert.equal(bad.targetValueSign,"negative");assert.ok(bad.targetExpectedValue!<0);
assert.equal(pricer.evaluate({source:{...sourceMl,phase:"opening"},target:targetMl,selection:"first"}).status,"unidentifiable",
 "a previously cached current quote cannot admit an opening quote with the same prices/clocks");
assert.equal(pricer.evaluate({source:sourceMl,target:{...targetMl,canonicalReceipt:null} as unknown as typeof targetMl,selection:"first"}).status,"unidentifiable",
 "a cached executable quote cannot admit an explicitly null canonical-receipt field");
for(const canonicalReceipt of [null,undefined,false,{}, {kind:"db_inserted_upper_bound"}]){
 const rejected=pricer.evaluate({source:{...sourceMl,canonicalReceipt} as unknown as typeof sourceMl,target:targetMl,selection:"first"});
 assert.equal(rejected.status,"unidentifiable","an identifiable invalid canonical source cannot fall back to its HTTP clock");
 assert.equal(rejected.targetExpectedValue,null);
}
const canonicalSource={...sourceMl,canonicalReceipt:{kind:"db_inserted_upper_bound" as const,
 availableBy:"2026-11-04T18:00:31Z",ingestionRunId:"synthetic-reference-receipt",observationIds:[1,2] as [number,number],
 providerEventId:"synthetic-native-1",rawPayloadHashes:["a".repeat(64),"b".repeat(64)] as [string,string]}};
assert.equal(pricer.evaluate({source:canonicalSource,target:targetMl,selection:"first"}).status,"direct",
 "a complete, available canonical professional source remains usable");
for(const [sourceBook,targetBook] of [["hardrock","hard_rock_bet"],["draftkings","fanduel"],["unknown_sharp","fanduel"]]){
 const rejected=pricer.evaluate({source:{...sourceMl,sportsbook:sourceBook},target:{...targetMl,sportsbook:targetBook},selection:"first"});
 assert.equal(rejected.status,"unidentifiable");assert.equal(rejected.reason,"unsupported_nonprofessional_reference_source");
}
for(const [sourceBook,targetBook] of [["PS3838","Pinnacle"],["pinnacle_mqtt","Pinnacle Sports"],["Circa Sports","Circa"],
 ["Bookmaker","bookmaker_us"]]){
 assert.equal(pricer.evaluate({source:{...sourceMl,sportsbook:sourceBook},target:{...targetMl,sportsbook:targetBook},selection:"first"}).reason,
  "source_and_target_are_same_physical_book");
}
assert.equal(pricer.evaluate({source:{...sourceMl,sportsbook:"PS3838"},target:targetMl,selection:"first"}).status,"direct",
 "a verified professional alias is accepted when execution is at a genuinely different physical book");
assert.equal(direct.deVigMethod,"proportional_two_way_implied_odds");
assert.ok(direct.probabilityInterpretation.includes("not_uniquely_identified"));

const sourceInt=quote("circa","spread",-1,-110,-110),targetInt=quote("fanduel","spread",-1,120,-140);
const unresolvedPush=pricer.evaluate({source:sourceInt,target:targetInt,selection:"first"});
assert.equal(unresolvedPush.status,"direct_conditional_only");assert.equal(unresolvedPush.reason,"integer_push_mass_not_identified_by_native_odds");
near(unresolvedPush.directTargetResolvedBetExpectedValue!,.1);assert.equal(unresolvedPush.targetValueSign,"positive");
assert.equal(unresolvedPush.targetExpectedValue,null);assert.equal(unresolvedPush.probabilities,null);
const borrowed=pricer.evaluate({source:sourceInt,target:targetInt,selection:"first",integerPushAssumption:"borrow_final_joint_push"});
assert.equal(borrowed.status,"assumption_based");assert.ok(borrowed.assumptions[0].includes("not_identified"));
assert.ok(borrowed.probabilities!.push>0);assert.ok(borrowed.targetExpectedValue!>0&&borrowed.targetExpectedValue!<.1);
near(borrowed.targetExpectedValue!,.1*(1-borrowed.probabilities!.push));
assert.ok(!("first" in borrowed.numerical!),"numerical bounds must not expose a competing final-law probability beside source-reference values");

const native=quote("circa","spread",-1.5,-110,-110),target=quote("fanduel","spread",-2.5,120,-140);
const start=Date.now(),transport=pricer.evaluate({source:native,target,selection:"first"}),elapsedMs=Date.now()-start;
assert.equal(transport.status,"assumption_based");assert.equal(transport.directTargetResolvedBetExpectedValue,null);
assert.ok(transport.assumptions[0].includes("not_identified_by_source_odds"));
assert.ok(Math.abs(transport.root!.fairResidual)<=transport.root!.fairTolerance);
assert.ok(transport.root!.interval[1]-transport.root!.interval[0]<=transport.root!.locationTolerance);
assert.ok(transport.root!.location>=transport.root!.interval[0]&&transport.root!.location<=transport.root!.interval[1]);
assert.ok(transport.targetExpectedValue!<0);assert.equal(transport.targetValueSign,"negative");
const calls=pricer.diagnostics().lawEvaluations;
assert.equal(pricer.evaluate({source:native,target,selection:"first"}),transport);
assert.equal(pricer.diagnostics().lawEvaluations,calls,"an identical reference does not rerun inversion");
const newPayout=pricer.evaluate({source:native,target:{...target,firstPrice:130,secondPrice:-150},selection:"first"});
assert.equal(newPayout.status,"assumption_based");assert.equal(pricer.diagnostics().lawEvaluations,calls,"native inversion is cached independently of executable payout");
assert.deepEqual(newPayout.probabilities,transport.probabilities);assert.notEqual(newPayout.targetExpectedValue,transport.targetExpectedValue);
assert.deepEqual(law.probabilitiesFast("spread",-2.5),before);assert.equal(JSON.stringify(latent),bytes);
assert.equal(pricer.diagnostics().anyReferencePmfBuilt,false);

const mirrorQuote=(q:typeof native)=>({...q,line:q.market==="spread"&&q.line!==null?-q.line:q.line,
 firstPrice:q.market==="total"?q.firstPrice:q.secondPrice,secondPrice:q.market==="total"?q.secondPrice:q.firstPrice});
const mirror=createCbbJointSourceReferencePricer({gameId:1,asOf,finalLatent:{...latent,marginMean:-latent.marginMean,correlation:-latent.correlation}});
const mirrored=mirror.evaluate({source:mirrorQuote(native),target:mirrorQuote(target),selection:"second"});
assert.equal(mirrored.status,"assumption_based");near(mirrored.targetExpectedValue!,transport.targetExpectedValue!,1e-7);
near(mirrored.probabilities!.first,transport.probabilities!.second,1e-7);
near(mirrored.root!.location,-transport.root!.location,1e-6);

const total=pricer.evaluate({source:quote("circa","total",11.5,-110,-110),target:quote("fanduel","total",12.5,120,-140),selection:"first"});
assert.equal(total.status,"assumption_based");assert.equal(total.root!.axis,"totalMean");
assert.equal(pricer.diagnostics().anyReferencePmfBuilt,false);
const impossible=pricer.evaluate({source:quote("circa","total",.5,-110,-110),target:quote("fanduel","total",1.5,-110,-110),selection:"first"});
assert.equal(impossible.status,"unidentifiable");assert.ok(impossible.reason.includes("impossible"));
const impossibleAtOne=pricer.evaluate({source:quote("circa","total",1,-110,-110),target:quote("fanduel","total",1,-110,-110),selection:"first"});
assert.equal(impossibleAtOne.status,"unidentifiable");assert.ok(impossibleAtOne.reason.includes("impossible"),
 "at minimum legal score total1, all non-push outcomes are Over; finite two-way conditional odds cannot fit");
for(const source of [{...native,providerObservedAt:"2026-11-04T18:31:00Z",fetchedAt:"2026-11-04T18:31:30Z"},
 {...native,gameId:2},{...native,orientationVerified:false},{...native,firstPrice:NaN}]){
 assert.equal(pricer.evaluate({source,target,selection:"first"}).status,"unidentifiable");
}
assert.equal(pricer.evaluate({source:native,target:{...target,fetchedAt:"2026-11-04T18:31:30Z"},selection:"first"}).status,"unidentifiable");
assert.equal(pricer.evaluate({source:native,target:{...target,requestedAt:"2026-11-04T18:31:00Z"},selection:"first"}).status,"unidentifiable");
assert.equal(pricer.evaluate({source:native,target:{...target,sportsbook:"circa"},selection:"first"}).reason,"source_and_target_are_same_physical_book");
assert.equal(pricer.evaluate({source:native,target:targetMl,selection:"first"}).reason,"cross_market_reference_not_identified");
const limited=createCbbJointSourceReferencePricer({gameId:1,asOf,finalLatent:latent,rootNumerics:{maxLawEvaluations:2}});
const unavailable=limited.evaluate({source:native,target,selection:"first"});
assert.equal(unavailable.status,"unidentifiable");assert.ok(unavailable.reason.includes("budget"));
assert.equal(unavailable.targetExpectedValue,null);assert.equal(unavailable.probabilities,null);
console.log(JSON.stringify({result:"PASS ancillary source-reference economics: native conditional facts, honest integer push, explicit shape transfer, mirrors/cache/future/infeasible/budgets; no final forecast mutation",
 syntheticInversion:{elapsedMs,iterations:transport.root!.iterations,lawEvaluations:pricer.diagnostics().lawEvaluations,anyReferencePmfBuilt:pricer.diagnostics().anyReferencePmfBuilt}}));
