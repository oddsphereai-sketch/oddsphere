import assert from "node:assert/strict";
import {buildCbbInterpretedDecision,gradeCbbContextualForecastSide} from "../lib/cbb/contextualInterpretedDecision";
import {buildCbbContextualMarketInterpretation} from "../lib/cbb/contextualMarketInterpretation";
import {createCbbContextualScoreLaw} from "../lib/cbb/contextualScoreLawResearch";
import type {CbbContextualFeatureInput} from "../lib/cbb/contextualForecastFeatures";
import type {CbbMarket,CbbQuote} from "../lib/cbb/types";
import type {CbbDecisionSplitContext} from "../lib/cbb/decisionSplitContext";
const at="2026-11-05T18:00:00Z",native="2026-11-05T17:58:00Z",fetched="2026-11-05T17:59:00Z",request="2026-11-05T17:58:59Z";
const q=(market:CbbMarket,book="draftkings",prices:[number,number]=[-110,-110])=>({provider:"owls" as const,gameId:7,sportsbook:book,market,line:market==="moneyline"?null:market==="spread"?-2.5:146.5,
 firstPrice:prices[0],secondPrice:prices[1],providerObservedAt:native,fetchedAt:fetched,requestedAt:request,phase:"current" as const,orientationVerified:true,sourceEventId:"event7"});
const targets=[q("moneyline","draftkings",[100,-110]),q("spread"),q("total")];
type Target=CbbQuote&{orientationVerified?:boolean};
function input(quotes:readonly Target[]=targets):CbbContextualFeatureInput{return {independent:{gameId:7,asOf:at,release:"test",inputStatus:"complete",margin:0,total:146},asOf:at,startsAt:"2026-11-05T23:00:00Z",currentQuotes:quotes};}
const latent={marginMean:10,totalMean:159,marginSd:11,totalSd:15,correlation:.1};
const make=(i=input(),ts:readonly Target[]=targets,l=latent)=>buildCbbInterpretedDecision({input:i,interpretation:buildCbbContextualMarketInterpretation(i),targets:ts,latent:l});
const result=make(),law=createCbbContextualScoreLaw(latent);
const offsetInput=input(targets.map(t=>({...t,providerObservedAt:t.providerObservedAt.replace(/Z$/,"+00:00")})));
const offsetDecision=make(offsetInput);for(let j=0;j<3;j++){assert.equal(offsetDecision.marketDecisions[j].grade,result.marketDecisions[j].grade);assert.equal(offsetDecision.marketDecisions[j].probability,result.marketDecisions[j].probability);assert.equal(offsetDecision.marketDecisions[j].target!.providerObservedAt,targets[j].providerObservedAt,"Equivalent native instants qualify without rewriting original strings");}
const wrongNativeTarget={...targets[0],sourceEventId:"different_owls_event"};
assert.equal(make(input(),[wrongNativeTarget,...targets.slice(1)]).marketDecisions[0].reason,"execution_same_provider_native_identity_conflict","Matching economics cannot override a known same-provider event conflict");
const crossProviderTarget={...targets[0],provider:"balldontlie" as const,sourceEventId:"different_bdl_namespace"};assert.notEqual(make(input(),[crossProviderTarget,...targets.slice(1)]).marketDecisions[0].grade,"Held","Different-provider IDs remain fixture-bound rather than falsely comparable");
const microTarget={...targets[0],providerObservedAt:"2026-11-05T17:58:00.000100Z"};
assert.notEqual(make(input([{...microTarget,providerObservedAt:"2026-11-05T17:58:00.000100+00:00"},...targets.slice(1)]),[microTarget,...targets.slice(1)]).marketDecisions[0].grade,"Held");
assert.equal(make(input([{...microTarget,providerObservedAt:"2026-11-05T17:58:00.000200Z"},...targets.slice(1)]),[microTarget,...targets.slice(1)]).marketDecisions[0].grade,"Held","Different submillisecond native instants cannot borrow current-pair proof");
assert.ok(Math.abs(result.finalScore.home-result.finalScore.away-result.finalScore.margin)<1e-10);assert.ok(Math.abs(result.finalScore.home+result.finalScore.away-result.finalScore.total)<1e-10);
for(const row of result.marketDecisions){assert.notEqual(row.grade,"Held");const p=law.probabilitiesFast(row.market,row.target!.line),expected=row.selection==="first"?p.first:p.second,loss=row.selection==="first"?p.second:p.first;assert.ok(Math.abs(row.probability!-expected)<1e-12);assert.ok(Math.abs(row.expectedValue!-(expected*(row.price!>0?row.price!/100:100/-row.price!)-loss))<1e-12);assert.equal(row.grade,"Best Angle","strong final confidence and positive offered value need no invented professional confirmation");}
const reversed=make(input(),targets,{...latent,marginMean:-14,totalMean:130});assert.equal(reversed.marketDecisions[0].selection,"second");assert.equal(reversed.marketDecisions[1].selection,"second");assert.equal(reversed.marketDecisions[2].selection,"second");
const expTargets=[{...targets[0],firstPrice:-900,secondPrice:600},...targets.slice(1)],exp=make(input(expTargets),expTargets);assert.equal(exp.marketDecisions[0].grade,"Watchlist");assert.ok(exp.marketDecisions[0].expectedValue!<0);
const pro=[q("moneyline","circa",[-300,250]),q("moneyline","pinnacle",[200,-250])],supported=make(input([...targets,...pro]));assert.equal(supported.marketDecisions[0].grade,"Best Angle");assert.equal(supported.marketDecisions[0].counterevidence?.professionalNegativeReference.length,1,"opposition retained without all-book unanimity veto");assert.deepEqual(supported.finalScore,result.finalScore,"ancillary reference economics cannot numerically reforecast");
const bdl={...targets[0],provider:"balldontlie" as const};delete (bdl as Partial<typeof bdl>).orientationVerified;delete (bdl as Partial<typeof bdl>).requestedAt;
const bdlInput=input(targets.slice(1));bdlInput.consumerCurrentQuotes=[{gameId:7,sportsbook:bdl.sportsbook,market:bdl.market,line:bdl.line,firstPrice:bdl.firstPrice,secondPrice:bdl.secondPrice,providerObservedAt:bdl.providerObservedAt,fetchedAt:bdl.fetchedAt,availableBy:bdl.fetchedAt,availabilityKind:"http_response",orientationProof:"native_home_away_fields",provider:"balldontlie"}];
const bdlResult=buildCbbInterpretedDecision({input:bdlInput,interpretation:buildCbbContextualMarketInterpretation(bdlInput),targets:[bdl,...targets.slice(1)],latent});assert.notEqual(bdlResult.marketDecisions[0].grade,"Held","genuine completed BDL column proof needs no invented request clock");
const offsetBdl={...bdl,providerObservedAt:bdl.providerObservedAt.replace(/Z$/,"+00:00"),fetchedAt:bdl.fetchedAt.replace(/Z$/,"+00:00")};
assert.notEqual(buildCbbInterpretedDecision({input:bdlInput,interpretation:buildCbbContextualMarketInterpretation(bdlInput),targets:[offsetBdl,...targets.slice(1)],latent}).marketDecisions[0].grade,"Held","Equivalent completed BDL native and HTTP instants retain their own proof");
const retainedProof=structuredClone(bdlInput),actualColumn=retainedProof.consumerCurrentQuotes![0];
retainedProof.consumerHistoryQuotes=[actualColumn];
retainedProof.consumerCurrentQuotes=[{...actualColumn,provider:"owls",orientationProof:"canonical_named_fixture_join",availabilityKind:"db_inserted_upper_bound",fetchedAt:"2026-11-05T17:57:00Z",availableBy:"2026-11-05T17:59:01Z",
 canonicalReceipt:{kind:"db_inserted_upper_bound",availableBy:"2026-11-05T17:59:01Z",providerEventId:"event7",ingestionRunId:"stored:pair",observationIds:[10,11],rawPayloadHashes:["a".repeat(64),"b".repeat(64)]}}];
const retainedDecision=(i:CbbContextualFeatureInput)=>buildCbbInterpretedDecision({input:i,interpretation:buildCbbContextualMarketInterpretation(i),targets:[bdl,...targets.slice(1)],latent}).marketDecisions[0];
assert.notEqual(retainedDecision(retainedProof).grade,"Held","whole original BDL execution proof survives selection of another same-pair source state");
assert.equal(retainedDecision({...retainedProof,consumerHistoryQuotes:[]}).grade,"Held","canonical fixture proof cannot manufacture a BDL execution column attestation");
assert.equal(retainedDecision({...retainedProof,consumerHistoryQuotes:[{...actualColumn,fetchedAt:"2026-11-05T17:59:02Z",availableBy:"2026-11-05T17:59:02Z"}]}).grade,"Held","different receipt cannot lend its clock to the target");
assert.equal(retainedDecision({...retainedProof,consumerHistoryQuotes:[{...actualColumn,provider:"owls"}]}).grade,"Held","another provider cannot claim BDL native-column proof");
assert.equal(retainedDecision({...retainedProof,consumerHistoryQuotes:[{...actualColumn,availableBy:"2026-11-05T17:59:03Z"}]}).grade,"Held","HTTP proof cannot carry a different availability completion");
assert.notEqual(retainedDecision({...retainedProof,consumerHistoryQuotes:[{...actualColumn,requestedAt:"2026-11-05T17:59:03Z"}]}).grade,"Held","Malformed request removes causal ordering rather than erasing actual completed BDL column evidence");
const inFlightTarget={...targets[0],requestedAt:"2026-11-05T17:57:00Z",providerObservedAt:"2026-11-05T17:58:30Z"};assert.notEqual(make(input([inFlightTarget,...targets.slice(1)]),[inFlightTarget,...targets.slice(1)]).marketDecisions[0].grade,"Held","A native update during a request remains an actual available offer");
const badRequestTarget={...targets[0],requestedAt:"2026-11-05T18:01:00Z"};assert.notEqual(make(input([badRequestTarget,...targets.slice(1)]),[badRequestTarget,...targets.slice(1)]).marketDecisions[0].grade,"Held","Unknown observation start cannot erase independently completed current price");
const directProviderMismatch={...targets[0],sourceEventId:undefined,providerEventId:"different_owls_native"};assert.equal(make(input(),[directProviderMismatch,...targets.slice(1)]).marketDecisions[0].grade,"Held","Direct providerEventId is an owning native-ID channel too");
const missing=make(input(targets.slice(1)),targets.slice(1));assert.equal(missing.marketDecisions[0].grade,"Held");
const integer=[targets[0],{...targets[1],line:-3},{...targets[2],line:146}],pushed=make(input(integer),integer);assert.ok(pushed.marketDecisions[1].pushProbability!>0);assert.ok(pushed.marketDecisions[2].pushProbability!>0);
const invalid=input();invalid.asOf="2026-11-05T17:58:30Z";invalid.independent.asOf=invalid.asOf;assert.equal(make(invalid).marketDecisions[0].grade,"Held");
assert.throws(()=>buildCbbInterpretedDecision({input:input(),interpretation:{...buildCbbContextualMarketInterpretation(input()),gameId:8},targets,latent}),/identity mismatch/);
// Continued below with observed book-price response controls.
console.log("PASS interpreted decision: one score law → three predictions/pushes/exact EV/grades; same receipt professional support and retained opposition, no grade reforecast, negative-price Watch, actual BDL proof and missing/future Held");

// The book's observed price response can support HOME while its cumulative
// money composition favors AWAY. This identifies neither sharp bettors nor
// newly arrived money. Keep composition as counterevidence rather than turning
// professional-book confirmation into a follow-the-money rule.
const sourceBaseline={...q("moneyline","circa"),providerObservedAt:"2026-11-05T17:20:00Z",fetchedAt:"2026-11-05T17:21:00Z",requestedAt:"2026-11-05T17:20:59Z"};
const sourceResponse=q("moneyline","circa",[-120,100]);
const awayComposition:CbbDecisionSplitContext={gameId:7,market:"moneyline",sourceBook:"circa",physicalFamily:"circa",sourceClass:"professional_adjacent_named_book",provider:"owls",sourceEventId:"event7",line:null,
 firstMoney:.2,secondMoney:.8,firstTickets:.4,secondTickets:.6,observedAt:"2026-11-05T17:30:00Z",availableBy:"2026-11-05T17:31:00Z",receiptEarliest:"2026-11-05T17:31:00Z",clockBasis:"verified_provider_observation",observationIds:[]};
const actionInput:CbbContextualFeatureInput={...input([...targets,sourceResponse]),historyQuotes:[sourceBaseline],splitContext:[awayComposition]};
const againstComposition=make(actionInput).marketDecisions[0];
assert.equal(againstComposition.selection,"first");

assert.equal(againstComposition.observedProfessionalBookPriceConfirmation,true);
assert.equal(againstComposition.grade,"Best Angle");
assert.equal(againstComposition.bookPriceActions?.[0].relation,"against_composition");
assert.equal(againstComposition.bookPriceActions?.[0].pressure.composition,"cumulative_share_not_money_flow");
assert.equal(againstComposition.counterevidence?.opposingCompositions[0].book,"circa");
assert.deepEqual(make(actionInput).finalScore,result.finalScore,"categorical book-price support cannot replace or shift the final score law");
// The source and target were completed in the same batch after the target's
// request began. Their offers are available together at decision time. This is
// price context, not a claim that a wager executed after the source moved.
assert.equal(sourceResponse.fetchedAt,targets[0].fetchedAt);
assert.ok(Date.parse(sourceResponse.fetchedAt)>Date.parse(targets[0].requestedAt));
assert.equal(againstComposition.observedProfessionalBookPriceConfirmation,true);
const completedBdlActionInput:CbbContextualFeatureInput={...bdlInput,currentQuotes:[...targets.slice(1),sourceResponse],historyQuotes:[sourceBaseline],splitContext:[awayComposition]};
const completedBdlAction=buildCbbInterpretedDecision({input:completedBdlActionInput,interpretation:buildCbbContextualMarketInterpretation(completedBdlActionInput),targets:[bdl,...targets.slice(1)],latent}).marketDecisions[0];
assert.equal(completedBdlAction.observedProfessionalBookPriceConfirmation,true,"genuine BDL completed columns can share current context without an invented request timestamp");
assert.equal(completedBdlAction.grade,"Best Angle");
// Owning a shared completed response does not establish causal response order
// within overlapping collection windows. The quote's native clock alone cannot
// override the fact that pressure was unavailable before quote collection began.
const overlapResponse={...sourceResponse,fetchedAt:"2026-11-05T17:30:30Z",requestedAt:"2026-11-05T17:30:29Z",canonicalReceipt:{kind:"db_inserted_upper_bound" as const,availableBy:fetched,providerEventId:"event7",ingestionRunId:"same:batch",observationIds:[1,2] as [number,number],rawPayloadHashes:["a".repeat(64),"b".repeat(64)] as [string,string]}};
const overlappingInput:CbbContextualFeatureInput={...actionInput,currentQuotes:[...targets,overlapResponse]};
const overlapping=make(overlappingInput).marketDecisions[0];
assert.equal(overlapping.observedProfessionalBookPriceConfirmation,false,"unknown observation-window order cannot corroborate a book response");
assert.equal(overlapping.grade,"Best Angle","unknown causal action cannot veto an otherwise qualified final forecast and price");
// An unchanged receipt re-fetch and future arrivals cannot create support.
const rereadInput:CbbContextualFeatureInput={...actionInput,currentQuotes:[...targets,{...sourceBaseline,fetchedAt:fetched,requestedAt:request}]};
assert.equal(make(rereadInput).marketDecisions[0].observedProfessionalBookPriceConfirmation,false);
const futureActionInput:CbbContextualFeatureInput={...actionInput,currentQuotes:[...targets,{...sourceResponse,fetchedAt:"2026-11-05T18:01:00Z"}]};
assert.equal(make(futureActionInput).marketDecisions[0].observedProfessionalBookPriceConfirmation,false);
const futureTarget={...targets[0],fetchedAt:"2026-11-05T18:01:00Z"};
assert.equal(make({...actionInput,currentQuotes:[futureTarget,...targets.slice(1),sourceResponse]},[futureTarget,...targets.slice(1)]).marketDecisions[0].grade,"Held","context availability never relaxes actual executable-quote completion");
console.log("PASS interpreted book-price context: against-composition retained, simultaneous completed offers and genuine BDL clocks accepted; overlapping source windows, rereads and future evidence cannot invent confirmation");

// Product tiers change neither the final selected side nor its forecast. Exact
// offered economics distinguish a likely winner from a worthwhile priced play.
const grade=(p:number,price:number,loss=1-p)=>gradeCbbContextualForecastSide({winProbability:p,loseProbability:loss,price});
assert.equal(grade(.53,-110).grade,"Lean","thin positive value is not blocked by a fixed 3% EV reserve");
assert.equal(grade(.63,-110).grade,"Best Angle");
for(const price of [-250,-300,-400])assert.equal(grade(.9,price).grade,"Lean","confident positive-value expensive favorites remain Lean, never Best");
assert.equal(grade(.8,-200).grade,"Best Angle","the explicit straight-bet price boundary is inclusive");
assert.equal(grade(.8,-201).grade,"Lean");
assert.equal(grade(.619,-110).grade,"Lean");
assert.equal(grade(.62,-110).grade,"Best Angle","declared confidence boundary is inclusive");
assert.equal(grade(.5,100).grade,"Watchlist","break-even is not positive estimated value");
assert.equal(grade(.9,-1000).grade,"Watchlist","a likely winner with a poor price is not promoted as a recommended parlay leg");
assert.equal(grade(.61,-110,.34).grade,"Lean","push probability cannot be counted as a win toward the 62% confidence policy");
const expensiveSupported=[{...targets[0],firstPrice:-300,secondPrice:250},...targets.slice(1)];
const steepAction=make({...actionInput,currentQuotes:[...expensiveSupported,sourceResponse]},expensiveSupported,{...latent,marginMean:19});
assert.equal(steepAction.marketDecisions[0].grade,"Lean","professional action cannot bypass the Best Angle price policy");
assert.equal(steepAction.marketDecisions[0].observedProfessionalBookPriceConfirmation,true);
const symmetricTargets=[{...targets[0],firstPrice:-120,secondPrice:110},...targets.slice(1)],symmetric=make(input(symmetricTargets),symmetricTargets,{...latent,marginMean:0,correlation:0});
const symmetricReprice=[{...symmetricTargets[0],firstPrice:110,secondPrice:-120},...targets.slice(1)],repriced=make(input(symmetricReprice),symmetricReprice,{...latent,marginMean:0,correlation:0});
assert.equal(symmetric.marketDecisions[0].selection,repriced.marketDecisions[0].selection,"a price-only change cannot choose the winner, including at a model tie");
assert.deepEqual(symmetric.finalScore,repriced.finalScore);
console.log("PASS contextual confidence/price tiers: thin positive Lean, strong reasonably priced Best, steep-favorite Lean, zero/negative Watch, refunded pushes and price-independent winner");

assert.equal(grade(.9,-900).grade,"Watchlist","floating-point positive dust cannot promote a mathematically break-even price");
assert.equal(gradeCbbContextualForecastSide({winProbability:.62000000001,loseProbability:.37999999999,price:-110,probabilityErrorEstimate:1e-8}).grade,"Lean","unresolved numerical confidence cannot claim the Best boundary");
assert.equal(gradeCbbContextualForecastSide({winProbability:.50000000001,loseProbability:.49999999999,price:100,probabilityErrorEstimate:1e-8}).grade,"Watchlist","numerical integration uncertainty is not evidence of positive value");
