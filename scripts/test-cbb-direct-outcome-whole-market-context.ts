import assert from "node:assert/strict";
import {buildCbbOutcomeInputs,cbbOutcomeKernelParts,cbbOutcomeIsInnovation,cbbOutcomeKernelBlocks,cbbOutcomeNoiseBetaOffset,cbbOutcomeNoiseLogVarianceIndex,cbbOutcomeObjectiveForTest,cbbOutcomeNoiseNormalizer,CBB_OUTCOME_BLOCKS,type CbbOutcomeAxisInput} from "../lib/cbb/contextualDirectOutcomeForecast";
import type {CbbContextualFeatureInput,CbbContextualQuote} from "../lib/cbb/contextualForecastFeatures";
import {normalCdf} from "../lib/cbb/model";
import {cbbExactMarketCenter} from "../lib/cbb/marketReaderResearch";
import type {CbbForecast} from "../lib/cbb/types";

// Synthetic covariance parameters exercise the released feature construction;
// this test performs no fitting, provider retrieval or persistence.
const time=(minute:number)=>`2026-11-01T12:${String(minute).padStart(2,"0")}:00Z`;
const quote=(market:CbbContextualQuote["market"],line:number|null,minute=20,firstPrice=-110,secondPrice=-110,book="pinnacle",event="fixture:1"):CbbContextualQuote=>({gameId:1,sportsbook:book,market,line,firstPrice,secondPrice,providerObservedAt:time(minute),requestedAt:time(minute),fetchedAt:time(minute+1),phase:"current",orientationVerified:true,provider:"owls",sourceEventId:event});
const raw:CbbContextualFeatureInput={independent:{gameId:1,asOf:time(0),release:"synthetic_fallible_independent",inputStatus:"complete",margin:4,total:150,homeWinProbability:.64,uncertainty:{marginSd:10,totalSd:15,marginTotalCorrelation:.1}},asOf:time(30),startsAt:"2026-11-01T18:00:00Z",currentQuotes:[quote("spread",-4),quote("moneyline",null,20,-180,150),quote("total",150)]};
const build=(input:CbbContextualFeatureInput)=>buildCbbOutcomeInputs(input);
const coordinate=(axis:CbbOutcomeAxisInput,block:typeof CBB_OUTCOME_BLOCKS[number],name:string)=>{const vector=axis.blocks[block],j=vector.names.indexOf(name);assert(j>=0,name);return{value:vector.values[j],known:vector.known[j],parity:vector.parity[j]};};
const value=(axis:CbbOutcomeAxisInput,block:typeof CBB_OUTCOME_BLOCKS[number],name:string)=>{const c=coordinate(axis,block,name);return c.known?c.value:null;};
const near=(a:number,b:number,message:string)=>assert(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(a),Math.abs(b)),`${message}: ${a} vs ${b}`);
const thetaFor=(axis:"margin"|"total")=>[...cbbOutcomeKernelBlocks(axis).flatMap((_,j)=>[.1-j*.05,.2+j*.05]),.05,Math.log(1.3)];
const theta=thetaFor("total");
const term=(a:CbbOutcomeAxisInput,b:CbbOutcomeAxisInput,block:"path"|"pressure"|"cross_path"|"cross_pressure",axis:"margin"|"total"="total")=>cbbOutcomeKernelParts(a,b,axis,thetaFor(axis)).terms.find(t=>t.block===block)!;
const implied=(american:number)=>american>0?100/(american+100):-american/(100-american);
const balance=(a:number,b:number)=>implied(a)/(implied(a)+implied(b))-.5;

const missing=build({...raw,currentQuotes:[quote("total",150)]});
assert.equal(value(missing.total,"level","professional.ML_fair_balance"),null,"Missing ML remains unknown, never balanced evidence");
const mlOnly=build({...raw,currentQuotes:[quote("moneyline",null,20,-200,170)]});
near(value(mlOnly.total,"level","professional.ML_fair_balance")!,Math.abs(balance(-200,170)),"An ML-only physical book contributes even without its own Total");
const opposedBooks=build({...raw,currentQuotes:[quote("moneyline",null,20,-200,170),quote("moneyline",null,20,170,-200,"circa")]});
near(value(opposedBooks.total,"level","professional.ML_fair_balance")!,Math.abs(balance(-200,170)),"Absolute each physical-book balance before averaging prevents opposite labels cancelling strength");
near(value(opposedBooks.margin,"level","professional.ML_fair_balance")!,0,"Margin keeps signed role balance");

const badMl={...quote("moneyline",null,20,-180,150),sourceEventId:"different:fixture"};
const crossConflict=build({...raw,currentQuotes:[quote("total",150),badMl]});
assert.equal(value(crossConflict.total,"level","professional.ML_fair_balance"),null,"Known same-provider Total/ML identity conflict cannot supply Total context");
assert.deepEqual(crossConflict.total,missing.total,"The rejected cross relation cannot leak back through an old margin reference or path");
assert(crossConflict.measurementInputs.margin.measurements.some(m=>m.book==="pinnacle"),"The independently valid actual Margin measurement is preserved");
assert(crossConflict.measurementInputs.total.measurements.some(m=>m.book==="pinnacle"),"The valid own Total measurement is preserved");
assert(crossConflict.measurementInputs.receipt.streams.some(s=>s.market==="moneyline"&&s.currentQuote?.eventId==="different:fixture"),"Full raw receipt remains available for audit");
assert(JSON.stringify(crossConflict.contextTraces).includes("same_provider_known_current_total_margin_native_identity_conflict"));
const sameSpreadConflict=build({...raw,currentQuotes:[quote("total",150),quote("spread",-4),badMl]});
const goodSpreadOnly=build({...raw,currentQuotes:[quote("total",150),quote("spread",-4)]});
assert.deepEqual(sameSpreadConflict.total,goodSpreadOnly.total,"Matching Spread survives while only conflicting ML relation is withheld");
assert.equal(value(sameSpreadConflict.total,"level","professional.ML_fair_balance"),null,"Existing ML/SP known-ID rejection also applies to Total ML magnitude");
const badSpread={...quote("spread",-4),sourceEventId:"different:fixture"};
const matchingMl=build({...raw,currentQuotes:[quote("total",150),badSpread,quote("moneyline",null,20,-180,150)]});
const goodMlOnly=build({...raw,currentQuotes:[quote("total",150),quote("moneyline",null,20,-180,150)]});
assert.deepEqual(matchingMl.total,goodMlOnly.total,"A valid ML survives rejection of only the conflicting Spread relation; the cross view rebuilds its center");
const otherBook=build({...raw,currentQuotes:[quote("total",150),badMl,quote("moneyline",null,20,-200,170,"circa")]});
near(value(otherBook.total,"level","professional.ML_fair_balance")!,Math.abs(balance(-200,170)),"Unrelated physical books are not suppressed by one conflict");
const namespace=build({...raw,currentQuotes:[quote("total",150),{...badMl,provider:"the_odds_api"}]});
assert.notEqual(value(namespace.total,"level","professional.ML_fair_balance"),null,"Opaque IDs in different provider namespaces are not compared");
const unknownId:CbbContextualQuote={...badMl};delete unknownId.sourceEventId;
assert.notEqual(value(build({...raw,currentQuotes:[quote("total",150),unknownId]}).total,"level","professional.ML_fair_balance"),null,"Unknown ID is not a fabricated conflict");
const dkTotal=quote("total",150,20,-110,-110,"draftkings_network"),dkBadMl=quote("moneyline",null,20,-180,150,"draftkings_network","different:fixture");
assert.deepEqual(build({...raw,currentQuotes:[dkTotal,dkBadMl]}).total,build({...raw,currentQuotes:[dkTotal]}).total,"DraftKings network alias follows the exact interpreter family during known Total/ML conflict quarantine");

// New/untrained physical identities still reach shared primitive context;
// known ML/SP relation conflicts cannot re-enter via named primitive channels.
const novelA=build({...raw,currentQuotes:[quote("total",150,20,-110,-110,"unlisted_valid_retail")]}),novelB=build({...raw,currentQuotes:[quote("total",157,20,-105,-115,"unlisted_valid_retail")]});
assert.equal(novelA.measurementInputs.receipt.streams.find(s=>s.book==="unlisted_valid_retail")?.currentQuote?.line,150);
assert.notDeepEqual(novelA.total.blocks.level,novelB.total.blocks.level,"Every admitted current physical source changes primitive context even without a named trained coefficient, split or path");
assert.equal(value(novelA.total,"level","consumer.total.primitive.line.midrange"),150);assert.equal(value(novelB.total,"level","consumer.total.primitive.line.midrange"),157);
const mlSpConflict=build({...raw,currentQuotes:[quote("spread",-4),badMl]});
assert.equal(value(mlSpConflict.margin,"level","book.pinnacle.moneyline.line"),null);assert.equal(value(mlSpConflict.margin,"level","book.pinnacle.moneyline.fair_logodds"),null);assert.equal(value(mlSpConflict.margin,"path","book.pinnacle.moneyline.net_logodds_move"),null,"Rejected ML relation is absent from primitive native path as well");
assert.notEqual(value(mlSpConflict.margin,"level","book.pinnacle.spread.line"),null,"Independently valid Spread remains admitted");
const inversionFailure=build({...raw,independent:{...raw.independent,uncertainty:{...raw.independent.uncertainty,totalSd:1e-20}},currentQuotes:[quote("total",150)]});
assert(inversionFailure.measurementInputs.rejected.some(r=>r.reason.startsWith("exact_contract_center_unavailable")),"Synthetic center mapping genuinely fails");assert.equal(value(inversionFailure.total,"level","book.pinnacle.total.center"),null);assert.equal(value(inversionFailure.total,"level","book.pinnacle.total.line"),150,"Qualified native line survives supplemental center-mapping failure");assert.equal(value(inversionFailure.total,"level","book.pinnacle.total.fair_logodds"),0,"Qualified paired price survives center-mapping failure");
const unmappedNovelPath=build({...raw,independent:{...raw.independent,uncertainty:{...raw.independent.uncertainty,totalSd:1e-20}},currentQuotes:[quote("total",150,20,-110,-110,"unlisted_valid_retail")],historyQuotes:[quote("total",149,5,-110,-110,"unlisted_valid_retail")]});
assert.equal(value(unmappedNovelPath.total,"path","consumer.total.primitive.net_line_move.midrange"),1);assert(cbbOutcomeIsInnovation("path","consumer.total.primitive.net_line_move.midrange"));assert(cbbOutcomeIsInnovation("path","consumer.total.primitive.net_line_move.range"));assert(term(unmappedNovelPath.total,unmappedNovelPath.total,"path").value>0,"Valid unmapped unknown-book native movement supplies own economic covariance, not merely context or a forced posterior effect");
assert.notEqual(value(unmappedNovelPath.total,"path","consumer.total.primitive.native_age_log1p_hours.midrange"),null,"Unknown identity and failed center inversion do not erase native freshness context");
const early=build(raw),late=build({...raw,startsAt:"2026-11-01T14:00:00Z"});
for(const axis of ["margin","total"] as const)for(const block of CBB_OUTCOME_BLOCKS){
 const present=block==="level"||axis==="total"&&block.startsWith("cross_");if(!present){assert(!early[axis].blocks[block].names.includes("fixture.hours_to_start_log1p"),"Fixture horizon never enters own PATH/PRESSURE or inactive Margin cross blocks");continue;}
 const a=coordinate(early[axis],block,"fixture.hours_to_start_log1p"),b=coordinate(late[axis],block,"fixture.hours_to_start_log1p");
 assert(a.known&&b.known);assert.notEqual(a.value,b.value);assert.equal(a.parity,1);assert.equal(cbbOutcomeIsInnovation(block,"fixture.hours_to_start_log1p"),false);
 assert.equal(early[axis].blocks[block].names.filter(n=>n==="fixture.hours_to_start_log1p").length,1,"One shared fixture clock per block");
}
assert(early.contextTraces.some(t=>(t as {source?:string}).source==="fixture_clock"));

const split=(market:"moneyline"|"spread",money=.8,tickets=.6,book="pinnacle"):NonNullable<CbbContextualFeatureInput["splitContext"]>[number]=>({gameId:1,market,sourceBook:book,physicalFamily:book,sourceClass:"professional_adjacent_named_book",provider:"owls",sourceEventId:"fixture:1",line:market==="spread"?-3:null,firstMoney:money,secondMoney:1-money,firstTickets:tickets,secondTickets:1-tickets,observedAt:time(10),availableBy:time(11),receiptEarliest:time(11),clockBasis:"verified_provider_observation",observationIds:[]});
const badPressure={...split("moneyline"),sourceEventId:"different:fixture"};
const pressureOnlyConflict=build({...raw,currentQuotes:[quote("total",150)],splitContext:[badPressure]});
assert.deepEqual(pressureOnlyConflict.total,missing.total,"A wrong-event ML split cannot enter Total through a quote-free pressure stream");
assert(pressureOnlyConflict.measurementInputs.receipt.streams.some(s=>s.market==="moneyline"&&s.pressures.some(p=>p.eventId==="different:fixture")),"The original conflicting split stays in the full receipt");
assert(JSON.stringify(pressureOnlyConflict.contextTraces).includes('"kind":"pressure"'),"The withheld relation identifies pressure versus quote mismatch");
assert.notEqual(value(build({...raw,currentQuotes:[quote("total",150)],splitContext:[{...badPressure,sourceEventId:null}]}).total,"cross_pressure","cross_margin.professional.moneyline.latest_money_composition"),null,"Unknown split identity does not become a hard missing-price gate");
assert.notEqual(value(build({...raw,currentQuotes:[quote("total",150)],splitContext:[{...badPressure,provider:"playbook"}]}).total,"cross_pressure","cross_margin.professional.moneyline.latest_money_composition"),null,"Different-provider split identity is not compared with the Total native ID");
const wrongPressureValidQuote=build({...raw,currentQuotes:[quote("total",150),quote("moneyline",null,20,-180,150)],splitContext:[badPressure]});
assert.deepEqual(wrongPressureValidQuote.total,goodMlOnly.total,"Reject only the bad split relation while retaining a compatible current ML quote");
const oldGoodMl=quote("moneyline",null,5,-150,125);
assert.deepEqual(build({...raw,currentQuotes:[quote("total",150),badMl],historyQuotes:[oldGoodMl],sourceBaselineQuotes:[{...oldGoodMl,knownBy:time(6)}]}).total,missing.total,"A rejected current quote stream cannot silently reactivate an older quote or baseline in the relation view");
const publicPressure=build({...raw,currentQuotes:[quote("total",150)],splitContext:[{...badPressure,sourceClass:"multi_book_consensus",sourceEventId:null,observedAt:null,clockBasis:"capture_upper_bound"}]});
assert.notEqual(value(publicPressure.total,"cross_pressure","cross_margin.public_context.moneyline.latest_money_composition"),null,"Public composition with unknown native identity remains context; it does not borrow a named-book identity");
const movingRaw={...raw,historyQuotes:[quote("spread",-3,5),quote("moneyline",null,5,-150,125),quote("total",150,5)],splitContext:[split("moneyline"),split("spread",.2,.4)]};
const moving=build(movingRaw),flat=build({...raw,historyQuotes:raw.currentQuotes.map(q=>({...q,providerObservedAt:time(5),requestedAt:time(5),fetchedAt:time(6)}))});
assert.deepEqual(moving.measurementInputs.total.measurements.map(m=>m.center),flat.measurementInputs.total.measurements.map(m=>m.center),"Total observations/measurement centers are fixed in the cross-market test");
assert.equal(term(flat.total,flat.total,"path").value,0,"A held whole market has zero economic path innovation");
assert(term(moving.total,moving.total,"cross_path").value>0,"Actual ML/SP movement supplies Total optional covariance even at fixed Total quotes");
assert(term(moving.total,moving.total,"cross_pressure").value>0,"Qualified ML/SP composition and response supply Total optional covariance");
near(value(moving.total,"cross_pressure","cross_margin.professional.moneyline.latest_money_composition")!,.6,"ML composition retained separately");
near(value(moving.total,"cross_pressure","cross_margin.professional.spread.latest_money_composition")!,-.6,"Opposite Spread composition retained separately");
assert.equal(coordinate(moving.total,"cross_path","cross_margin.current.independent.point").parity,-1,"Signed Margin level is retained until even Total kernel projection");
assert.equal(cbbOutcomeIsInnovation("cross_path","cross_margin.current.professional.ML_fair_balance"),false);
assert.equal(cbbOutcomeIsInnovation("cross_path","cross_margin.professional.net_center_move"),true);
assert.equal(cbbOutcomeIsInnovation("cross_pressure","cross_margin.professional.spread.circa.latest_money_composition"),true);
assert.equal(cbbOutcomeIsInnovation("cross_pressure","cross_margin.professional.spread.circa.nativeAge_log1p_hours"),false);
assert(moving.total.blocks.cross_path.names.includes("cross_margin.professional.nativeAgeHours.mean_log1p"),"Distinct ML/SP quote clocks are retained beside Total clocks");
assert(!moving.total.blocks.cross_path.names.includes("cross_margin.fixture.hours_to_start_log1p"),"Shared fixture clock is not duplicated under cross prefix");
assert(!moving.total.blocks.cross_path.names.some(n=>n.startsWith("cross_margin.current.other_axis")),"Total-as-other-axis is not copied back as Margin context");
assert(!moving.total.blocks.cross_pressure.names.includes("cross_margin.source_independent_gap"),"Current independent gap is represented only once in the same optional block");
const fairAmerican=(p:number)=>p>=.5?-100*p/(1-p):100*(1-p)/p;
const mlAtCenter=(center:number,minute:number)=>{
 const sd=raw.independent.uncertainty!.marginSd!,zero=normalCdf((.5-center)/sd)-normalCdf((-.5-center)/sd),p=(1-normalCdf((.5-center)/sd))/(1-zero);
 return quote("moneyline",null,minute,fairAmerican(p),fairAmerican(1-p));
};
const shape={...raw.independent,uncertainty:raw.independent.uncertainty} as CbbForecast,spreadChange=cbbExactMarketCenter(shape,quote("spread",-4),.5)-cbbExactMarketCenter(shape,quote("spread",-2),.5);
const opposedPathCurrent=[quote("total",150),quote("spread",-4),mlAtCenter(4,20)],opposedPath=build({...raw,currentQuotes:opposedPathCurrent,historyQuotes:[quote("total",150,5),quote("spread",-2,5),mlAtCenter(4+spreadChange,5)]}),flatPath=build({...raw,currentQuotes:opposedPathCurrent,historyQuotes:[quote("total",150,5),quote("spread",-4,5),mlAtCenter(4,5)]});
for(const block of ["net_center_move","latest_center_move"] as const){
 const ml=value(opposedPath.margin,"path",`professional.moneyline.${block}`)!,sp=value(opposedPath.margin,"path",`professional.spread.${block}`)!;
 near(ml+sp,0,"Equal opposite ML/SP moves would cancel under the former role average");assert(ml<0&&sp>0,"Both opposing contract movements remain explicit");
 assert.notEqual(value(opposedPath.total,"cross_path",`cross_margin.professional.moneyline.${block}`),value(flatPath.total,"cross_path",`cross_margin.professional.moneyline.${block}`));
 assert.notEqual(value(opposedPath.total,"cross_path",`cross_margin.professional.spread.${block}`),value(flatPath.total,"cross_path",`cross_margin.professional.spread.${block}`));
}
assert(!opposedPath.margin.blocks.path.names.includes("professional.net_center_move"),"Former cancelling role average is not duplicated in numeric geometry");
assert.notDeepEqual(opposedPath.margin.blocks.path.values,flatPath.margin.blocks.path.values);
assert.notDeepEqual(opposedPath.total.blocks.cross_path.values,flatPath.total.blocks.cross_path.values);
assert(term(opposedPath.margin,opposedPath.margin,"path","margin").value>0,"Margin retains economic covariance for opposed ML/SP moves");
assert(term(opposedPath.total,opposedPath.total,"cross_path").value>0,"Total retains cross-market economic covariance for opposed ML/SP moves");
assert.equal(term(flatPath.margin,flatPath.margin,"path","margin").value,0);assert.equal(term(flatPath.total,flatPath.total,"path").value,0);
const opposedPressure=build({...raw,splitContext:[split("spread",.9,.5,"circa"),split("spread",.1,.5,"pinnacle")]}),balancedPressure=build({...raw,splitContext:[split("spread",.5,.5,"circa"),split("spread",.5,.5,"pinnacle")]});
assert.equal(value(opposedPressure.total,"cross_pressure","cross_margin.professional.spread.latest_money_composition"),0);
near(value(opposedPressure.total,"cross_pressure","cross_margin.professional.spread.circa.latest_money_composition")!,.8,"Named Circa pressure survives aggregate cancellation");
near(value(opposedPressure.total,"cross_pressure","cross_margin.professional.spread.pinnacle.latest_money_composition")!,-.8,"Named Pinnacle counterpressure survives aggregate cancellation");
assert.notDeepEqual(opposedPressure.total.blocks.cross_pressure.values,balancedPressure.total.blocks.cross_pressure.values);

function mirror(source:CbbContextualFeatureInput):CbbContextualFeatureInput{
 const swap=<T extends {market:string;line:number|null;firstPrice:number;secondPrice:number}>(q:T):T=>q.market==="total"?{...q}:{...q,line:q.line===null?null:-q.line,firstPrice:q.secondPrice,secondPrice:q.firstPrice};
 return{...source,independent:{...source.independent,margin:-source.independent.margin,homeWinProbability:1-source.independent.homeWinProbability!,uncertainty:{...source.independent.uncertainty,marginTotalCorrelation:-source.independent.uncertainty!.marginTotalCorrelation!}},currentQuotes:source.currentQuotes.map(swap),historyQuotes:source.historyQuotes?.map(swap),splitContext:source.splitContext?.map(p=>p.market==="total"?{...p}:{...p,line:p.line===null?null:-p.line,firstMoney:p.secondMoney,secondMoney:p.firstMoney,firstTickets:p.secondTickets,secondTickets:p.firstTickets})};
}
const reflected=build(mirror(movingRaw));
for(const axis of ["margin","total"] as const){
 for(const block of CBB_OUTCOME_BLOCKS){const a=moving[axis].blocks[block],b=reflected[axis].blocks[block];assert.deepEqual(a.names,b.names);assert.deepEqual(a.known,b.known);assert.deepEqual(a.parity,b.parity);a.values.forEach((v,j)=>near(b.values[j],v*a.parity[j],`${axis}.${block}.${a.names[j]} reflection`));}
}
near(cbbOutcomeKernelParts(reflected.total,moving.total,"total",theta).value,cbbOutcomeKernelParts(moving.total,moving.total,"total",theta).value,"Total kernel is invariant under full fixture reflection");
near(cbbOutcomeKernelParts(reflected.margin,moving.margin,"margin",theta).value,-cbbOutcomeKernelParts(moving.margin,moving.margin,"margin",theta).value,"Margin kernel is odd under full fixture reflection");
const reflectedOpposed=build(mirror({...raw,currentQuotes:opposedPathCurrent,historyQuotes:[quote("total",150,5),quote("spread",-2,5),mlAtCenter(4+spreadChange,5)]}));
near(cbbOutcomeKernelParts(reflectedOpposed.total,opposedPath.total,"total",theta).value,cbbOutcomeKernelParts(opposedPath.total,opposedPath.total,"total",theta).value,"Opposed ML/SP cross-path Total kernel remains even");
near(cbbOutcomeKernelParts(reflectedOpposed.margin,opposedPath.margin,"margin",theta).value,-cbbOutcomeKernelParts(opposedPath.margin,opposedPath.margin,"margin",theta).value,"Opposed ML/SP Margin kernel remains odd");
for(const [axis,original] of [["total",moving.total],["total",late.total],["margin",moving.margin],["margin",late.margin],["total",opposedPath.total],["margin",opposedPath.margin]] as const){
 const optional=cbbOutcomeKernelBlocks(axis).filter(b=>b!=="level"),zero=structuredClone(original);for(const block of optional)zero.blocks[block].values=zero.blocks[block].values.map((v,j)=>cbbOutcomeIsInnovation(block,zero.blocks[block].names[j])?0:v);
 for(const block of optional){const part=term(zero,original,block,axis);assert.equal(part.value,0,"Levels, clocks and kickoff horizon cannot manufacture optional innovation");assert.equal(part.lengthDerivative,0);}
}
// A foreign modality or pregame position must not be an AND-gate on an
// already qualified own-market price/pressure component.
const ownTotalRaw:CbbContextualFeatureInput={...movingRaw,historyQuotes:[quote("spread",-3,5),quote("moneyline",null,5,-150,125),quote("total",149,5)],splitContext:[...movingRaw.splitContext,{...split("spread"),market:"total",line:149}]};
const ownTotal=build(ownTotalRaw),changedForeign=build({...ownTotalRaw,startsAt:"2026-11-01T14:00:00Z",independent:{...ownTotalRaw.independent,margin:12},currentQuotes:ownTotalRaw.currentQuotes.map(q=>q.market==="spread"?{...q,line:-6}:q.market==="moneyline"?{...q,firstPrice:-250,secondPrice:200}:q)}),missingForeign=build({...ownTotalRaw,startsAt:"2026-11-01T14:00:00Z",currentQuotes:ownTotalRaw.currentQuotes.filter(q=>q.market==="total"),historyQuotes:ownTotalRaw.historyQuotes?.filter(q=>q.market==="total"),splitContext:ownTotalRaw.splitContext?.filter(p=>p.market==="total")});
for(const block of ["path","pressure"] as const){
 assert.deepEqual(early.margin.blocks[block],late.margin.blocks[block],"Kickoff horizon does not change own Margin component geometry");
 for(const changed of [changedForeign,missingForeign]){
  assert.deepEqual(ownTotal.total.blocks[block],changed.total.blocks[block],"Foreign ML/SP/horizon changes or missingness do not alter own Total component coordinates");
  const expected=term(ownTotal.total,ownTotal.total,block),actual=term(changed.total,ownTotal.total,block);
  assert.deepEqual(actual,expected,"Own Total covariance and analytic derivatives remain exact at fixed own evidence/parameters");
 }
 assert(term(ownTotal.total,ownTotal.total,block).value>0,"The preserved own component has genuine economic innovation");
}
assert.notDeepEqual(ownTotal.total.blocks.cross_path,changedForeign.total.blocks.cross_path,"Foreign context and horizon remain numerically interpretable in their own component");
for(const block of ["cross_path","cross_pressure"] as const){
 assert.equal(term(missingForeign.total,ownTotal.total,block).value,0,"Missing cross innovation suppresses only its cross component");
 assert.equal(term(missingForeign.total,ownTotal.total,block).lengthDerivative,0);
 assert(!cbbOutcomeKernelBlocks("margin").includes(block),"Margin cross components have no optimizer hyperparameters or claimed effect");
 assert.deepEqual(ownTotal.margin.blocks[block],{names:[],values:[],known:[],parity:[]});
}
assert.deepEqual(cbbOutcomeKernelBlocks("margin"),["level","path","pressure"]);
assert.deepEqual(cbbOutcomeKernelBlocks("total"),["level","path","pressure","cross_path","cross_pressure"]);
assert.equal(cbbOutcomeNoiseLogVarianceIndex("margin"),7);assert.equal(cbbOutcomeNoiseBetaOffset("margin"),8);
assert.equal(cbbOutcomeNoiseLogVarianceIndex("total"),11);assert.equal(cbbOutcomeNoiseBetaOffset("total"),12);
const badMargin=structuredClone(ownTotal.margin);badMargin.blocks.cross_path=structuredClone(ownTotal.total.blocks.cross_path);
assert.throws(()=>cbbOutcomeKernelParts(badMargin,ownTotal.margin,"margin",thetaFor("margin")),/no parameterized cross/);
// All active amplitudes/lengths and axis-specific remaining-variance/noise
// slopes have independently checked derivatives; inactive Margin slots are
// rejected rather than passed to an optimizer with unidentified parameters.
for(const axis of ["margin","total"] as const){
 const points=[ownTotal[axis],changedForeign[axis],moving[axis]],normal=cbbOutcomeNoiseNormalizer(points),parameters=[...thetaFor(axis),...normal.active.map((_,j)=>.03*(j+1))],residuals=[-.3,.7,1.2],objective=cbbOutcomeObjectiveForTest(points,residuals,axis,parameters);
 assert(Number.isFinite(objective.value));assert.equal(parameters.length,cbbOutcomeNoiseBetaOffset(axis)+normal.active.length);
 for(let j=0;j<parameters.length;j++){const lower=[...parameters],upper=[...parameters];lower[j]-=1e-5;upper[j]+=1e-5;const difference=(cbbOutcomeObjectiveForTest(points,residuals,axis,upper).value-cbbOutcomeObjectiveForTest(points,residuals,axis,lower).value)/2e-5;near(difference,objective.gradient[j],`${axis} active parameter ${j} gradient`);}
 assert.equal(cbbOutcomeObjectiveForTest(points,residuals,axis,[...parameters,0,0,0,0]).value,Infinity,"An obsolete/global offset cannot silently fit unused cross parameters");
}
// Total even reflection preserves the signed level-by-movement relationship;
// an isolated move reversal at fixed signed current context is not a full
// fixture reflection and must remain distinguishable.
const reversedMove=structuredClone(moving.total);reversedMove.blocks.cross_path.values=reversedMove.blocks.cross_path.values.map((v,j)=>cbbOutcomeIsInnovation("cross_path",reversedMove.blocks.cross_path.names[j])?-v:v);
assert.notEqual(term(moving.total,reversedMove,"cross_path").value,term(moving.total,moving.total,"cross_path").value);
const samples=[flat.total,moving.total,reflected.total,opposedPressure.total,opposedPath.total],matrix=samples.map(a=>samples.map(b=>cbbOutcomeKernelParts(a,b,"total",theta).value));
for(const weights of [[1,-2,3,-1,2],[-3,1,-2,4,-1],[1,1,1,1,1]])assert(weights.reduce((s,w,i)=>s+w*matrix[i].reduce((t,v,j)=>t+v*weights[j],0),0)>=-1e-10,"Cross-context even projection remains positive semidefinite");
console.log("PASS independent market evidence components: native-ID/ML-strength/ML-SP separation, own-kernel horizon/foreign noninterference, independent cross covariance, dynamic3/5 parameter gradients, parity/PSD/zero innovation; zero fit/provider/write");
