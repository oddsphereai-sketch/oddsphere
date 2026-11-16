import assert from "node:assert/strict";
import {selectCbbSameContractExecution} from "../lib/cbb/sameContractExecution";
import {buildCbbInterpretedDecision} from "../lib/cbb/contextualInterpretedDecision";
import {buildCbbContextualMarketInterpretation} from "../lib/cbb/contextualMarketInterpretation";
import {createCbbContextualScoreLaw} from "../lib/cbb/contextualScoreLawResearch";
import type {CbbContextualFeatureInput} from "../lib/cbb/contextualForecastFeatures";
import type {CbbMarket,CbbQuote} from "../lib/cbb/types";

const at="2026-11-16T17:00:00Z";
const quote=(market:CbbMarket,book="draftkings",firstPrice=-115,secondPrice=-105)=>({gameId:7,sportsbook:book,market,
 line:market==="moneyline"?null:market==="spread"?-2.5:145.5,firstPrice,secondPrice,provider:"owls" as const,
 phase:"current" as const,orientationVerified:true,sourceEventId:"fixture7",providerObservedAt:"2026-11-16T16:59:00Z",
 requestedAt:"2026-11-16T16:59:01Z",fetchedAt:"2026-11-16T16:59:02Z"});
type Quote=CbbQuote&{orientationVerified?:boolean};
const markets=["moneyline","spread","total"] as const;
for(const direction of [1,-1]){
 const targets=markets.map(m=>quote(m)),alternatives=markets.map(m=>quote(m,"fanduel",direction===1?-105:-120,direction===1?-120:100));
 const input:CbbContextualFeatureInput={independent:{gameId:7,asOf:at,release:"test",inputStatus:"complete",margin:0,total:145},asOf:at,
  startsAt:"2026-11-17T00:00:00Z",currentQuotes:[...targets,...alternatives]};
 const interpretation=buildCbbContextualMarketInterpretation(input),latent={marginMean:direction*7,totalMean:145+direction*10,marginSd:11,totalSd:15,correlation:0};
 const before=JSON.stringify({input,targets,alternatives}),law=createCbbContextualScoreLaw(latent);
 const selected=selectCbbSameContractExecution({input,interpretation,law,targets,candidates:alternatives});
 assert.equal(selected.changes.length,3);
 for(let i=0;i<3;i++){assert.equal(selected.targets[i],alternatives[i]);assert.equal(selected.targets[i].line,targets[i].line);}
 const context={marginLocationSd:.2,totalLocationSd:.2,calibrationGames:182};
 const base=buildCbbInterpretedDecision({input,interpretation,latent,targets,recommendationRisk:context});
 const changed=buildCbbInterpretedDecision({input,interpretation,latent,targets:selected.targets,recommendationRisk:context});
 assert.deepEqual(changed.finalScore,base.finalScore);assert.deepEqual(changed.finalUncertainty,base.finalUncertainty);
 for(let i=0;i<3;i++){const b=base.marketDecisions[i],n=changed.marketDecisions[i];for(const k of ["selection","probability","loseProbability","pushProbability"]as const)assert.equal(n[k],b[k]);assert(n.expectedValue!>b.expectedValue!);}
 assert.equal(JSON.stringify({input,targets,alternatives}),before);
 const run=(candidates:Quote[],ownInput=input,ts:Quote[]=targets)=>selectCbbSameContractExecution({input:ownInput,interpretation:buildCbbContextualMarketInterpretation(ownInput),law,targets:ts,candidates});
 for(const bad of [alternatives.map(q=>({...q,gameId:8})),alternatives.map(q=>({...q,line:q.market==="moneyline"?1:q.line!+1})),
  alternatives.map(q=>({...q,orientationVerified:false})),alternatives.map(q=>({...q,sportsbook:"untrusted"})),
  alternatives.map(q=>({...q,sourceEventId:"wrong"})),alternatives.map(q=>({...q,providerObservedAt:"2026-11-16T16:58:00Z"})),
  alternatives.map(q=>({...q,fetchedAt:"2026-11-16T17:01:00Z"})),alternatives.map(q=>({...q,firstPrice:2000,secondPrice:2000})),
  alternatives.map(q=>({...q,canonicalReceipt:{kind:"db_inserted_upper_bound" as const,availableBy:at,providerEventId:"fixture7",ingestionRunId:"old",observationIds:[1,2] as [number,number],rawPayloadHashes:["a".repeat(64),"b".repeat(64)] as [string,string]}}))]){
  assert.deepEqual(run(bad).targets,targets,"An invalid, different, historical or unattested offer cannot replace the original pair");
 }
 assert.equal(run(alternatives,{...input,asOf:"2026-11-16T16:00:00Z"}).changes.length,0,"Cannot revive an unavailable baseline");
 assert.equal(run(alternatives,input,[]).targets.length,0,"Missing/domain-held targets are never invented");
 const equal=targets.map(q=>({...q,sportsbook:"fanduel"})),equalInput={...input,currentQuotes:[...targets,...equal]};
 assert.deepEqual(run(equal,equalInput).targets,targets,"Equal prices retain the complete original observation");
}
// +100 and −100 are equal payouts, despite their numeric ordering.
const base=quote("moneyline","draftkings",-100,-100),even=quote("moneyline","fanduel",100,-100);
const input:CbbContextualFeatureInput={independent:{gameId:7,asOf:at,release:"test",inputStatus:"complete",margin:1,total:145},asOf:at,startsAt:"2026-11-17T00:00:00Z",currentQuotes:[base,even]};
assert.equal(selectCbbSameContractExecution({input,interpretation:buildCbbContextualMarketInterpretation(input),law:createCbbContextualScoreLaw({marginMean:1,totalMean:145,marginSd:11,totalSd:15,correlation:0}),targets:[base],candidates:[even]}).targets[0],base);
// A real cheaper whole offer can restore Best eligibility; the expensive
// favorite remains Lean at its original quote. This is never a price rewrite.
const expensive=quote("moneyline","draftkings",-235,195),affordable=quote("moneyline","fanduel",-195,165);
const pricedInput={...input,currentQuotes:[expensive,affordable]},receipt=buildCbbContextualMarketInterpretation(pricedInput),latent={marginMean:10,totalMean:145,marginSd:11,totalSd:15,correlation:0};
const execution=selectCbbSameContractExecution({input:pricedInput,interpretation:receipt,law:createCbbContextualScoreLaw(latent),targets:[expensive],candidates:[affordable]});
const grade=(targets:Quote[])=>buildCbbInterpretedDecision({input:pricedInput,interpretation:receipt,latent,targets,recommendationRisk:{marginLocationSd:.2,totalLocationSd:.2,calibrationGames:182}}).marketDecisions[0];
assert.equal(grade([expensive]).grade,"Lean");assert.equal(grade(execution.targets).grade,"Best Angle");
assert.equal(grade(execution.targets).price,-195);assert.equal(expensive.firstPrice,-235);assert.equal(grade(execution.targets).probability,grade([expensive]).probability);
console.log("PASS CBB same-contract execution: both sides/all markets, whole verified pair, strict payout improvement, unchanged forecast/probability/push, identity/clock/hold/orientation/domain controls and source immutability");
