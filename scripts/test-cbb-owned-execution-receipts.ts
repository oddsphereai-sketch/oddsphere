import assert from "node:assert/strict";
import {cbbContextualExecutionProof,buildCbbInterpretedDecision} from "../lib/cbb/contextualInterpretedDecision";
import {buildCbbContextualMarketInterpretation} from "../lib/cbb/contextualMarketInterpretation";
import {recoverCbbVerifiedExecutionTargets} from "../lib/cbb/sameContractExecution";
import type {CbbContextualFeatureInput,CbbContextualConsumerQuote} from "../lib/cbb/contextualForecastFeatures";
import type {CbbMarket,CbbQuote} from "../lib/cbb/types";

const at="2026-11-16T18:00:00Z",native="2026-11-16T17:55:00Z",fetched="2026-11-16T17:59:00Z";
const markets=["moneyline","spread","total"] as const;
const quote=(market:CbbMarket):CbbQuote=>({provider:"balldontlie",gameId:7,sportsbook:"betmgm",market,
 line:market==="moneyline"?null:market==="spread"?3.5:135.5,firstPrice:market==="moneyline"?135:-110,
 secondPrice:market==="moneyline"?-165:-110,providerObservedAt:native,fetchedAt:fetched,phase:"current",providerEventId:"7"});
const targets=markets.map(quote);
const own=targets.map(q=>({...q,availableBy:q.fetchedAt,availabilityKind:"http_response",orientationProof:"native_home_away_fields"} as CbbContextualConsumerQuote));
const canonical=own.map(q=>({...q,provider:"owls" as const,providerEventId:"fixture7",providerObservedAt:"2026-11-16T17:55:37Z",
 fetchedAt:"2026-11-16T17:57:00Z",availableBy:"2026-11-16T17:59:01Z",availabilityKind:"db_inserted_upper_bound" as const,
 orientationProof:"canonical_named_fixture_join" as const,canonicalReceipt:{kind:"db_inserted_upper_bound" as const,
 availableBy:"2026-11-16T17:59:01Z",providerEventId:"fixture7",ingestionRunId:"stored:pair",observationIds:[10,11] as [number,number],rawPayloadHashes:["a".repeat(64),"b".repeat(64)] as [string,string]}}));
const input:CbbContextualFeatureInput={independent:{gameId:7,asOf:at,release:"test",inputStatus:"complete",margin:0,total:135},asOf:at,
 startsAt:"2026-11-16T23:00:00Z",currentQuotes:[],consumerHistoryQuotes:own,consumerCurrentQuotes:canonical};
const proof=(q=targets[0],i=input)=>cbbContextualExecutionProof(q,i,buildCbbContextualMarketInterpretation(i));
const before=JSON.stringify({input,targets});
for(const q of targets){const result=proof(q);assert.equal(result.problem,null);assert.equal(result.columnProof?.provider,"balldontlie");assert.equal(result.columnProof?.providerObservedAt,native);assert.equal(result.columnProof?.fetchedAt,fetched);}
// The agreeing feed supplies current economic state, never the target's owned
// HTTP/native clocks, event namespace or home/away attestation.
for(const bad of [
 {...input,consumerHistoryQuotes:[]},
 {...input,consumerHistoryQuotes:own.map(q=>({...q,fetchedAt:"2026-11-16T17:58:59Z",availableBy:"2026-11-16T17:58:59Z"}))},
 {...input,consumerHistoryQuotes:own.map(q=>({...q,providerObservedAt:"2026-11-16T17:55:00.000100Z"}))},
 {...input,consumerHistoryQuotes:own.map(q=>({...q,providerEventId:"wrong"}))},
 {...input,consumerHistoryQuotes:own.map(q=>({...q,orientationProof:"canonical_named_fixture_join" as const}))},
 {...input,consumerCurrentQuotes:canonical.map(q=>({...q,firstPrice:q.firstPrice-10}))},
 {...input,consumerCurrentQuotes:canonical.map(q=>({...q,line:q.market==="moneyline"?1:q.line!+1}))},
 {...input,asOf:"2026-11-16T17:58:00Z"},
 {...input,asOf:"2026-11-16T19:01:00Z"},
])assert.notEqual(proof(targets[0],bad).problem,null);
for(const bad of [
 {...targets[0],providerEventId:"wrong"}, {...targets[0],providerObservedAt:"2026-11-16T17:55:00.000100Z"},
 {...targets[0],fetchedAt:"2026-11-16T18:01:00Z"}, {...targets[0],firstPrice:2000},
 {...targets[0],gameId:8}, {...targets[0],phase:"opening" as const},
])assert.notEqual(proof(bad).problem,null);
const sameProvider={...input,consumerCurrentQuotes:canonical.map(q=>({...q,provider:"balldontlie" as const,providerEventId:"7"}))};
assert.notEqual(proof(targets[0],sameProvider).problem,null,"Same-provider changed native observation retains strict matching");
const latent={marginMean:7,totalMean:145,marginSd:11,totalSd:15,correlation:0};
const decision=(i:CbbContextualFeatureInput,ts:readonly CbbQuote[])=>buildCbbInterpretedDecision({input:i,interpretation:buildCbbContextualMarketInterpretation(i),targets:ts,latent});
const direct={...input,consumerCurrentQuotes:own,consumerHistoryQuotes:[]};
const restored=decision(input,targets),original=decision(direct,targets);
assert.deepEqual(restored.finalScore,original.finalScore);
for(let j=0;j<3;j++)for(const field of ["selection","probability","loseProbability","pushProbability","expectedValue","price","grade"] as const)assert.equal(restored.marketDecisions[j][field],original.marketDecisions[j][field]);
const fallback=targets.map(q=>({...q,sportsbook:"caesars",orientationVerified:true}));
const available={...input,currentQuotes:fallback},interpretation=buildCbbContextualMarketInterpretation(available);
const run=(ts:readonly CbbQuote[],candidates:readonly CbbQuote[]=fallback)=>recoverCbbVerifiedExecutionTargets({input:available,interpretation,targets:ts,candidates});
assert.deepEqual(run(targets).targets,targets,"Valid original contracts retain exact object identity");
const invalid=targets.map(q=>({...q,providerEventId:"bad"}));
assert.deepEqual(run(invalid).targets,fallback,"Invalid preferred book cannot hide another fully verified pair");
assert.deepEqual(run([]).targets,fallback,"Genuinely absent targets can use complete qualified current pairs");
assert.deepEqual(run(invalid,[]).targets,invalid,"No receipt means no invented quote");
assert.equal(run([],fallback.filter(q=>q.market==="spread")).targets.length,1,"One market's availability cannot fabricate siblings");
assert.deepEqual(run([],fallback.map(q=>({...q,orientationVerified:false}))).targets,[]);
assert.deepEqual(run([],fallback.map(q=>({...q,secondPrice:2000}))).targets,[],"No cross-book or one-sided price splicing");
assert.equal(JSON.stringify({input,targets}),before,"Source evidence is immutable");
console.log("PASS owned execution receipts: three markets, distinct provider clocks, exact owned HTTP/native/identity/orientation, unchanged forecast and grades; valid fallback and unavailable/contradictory/stale refusals");
