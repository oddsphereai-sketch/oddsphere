import assert from "node:assert/strict";
import {buildCbbInterpretedDecision} from "../lib/cbb/contextualInterpretedDecision";
import {buildCbbContextualMarketInterpretation} from "../lib/cbb/contextualMarketInterpretation";
import type {CbbContextualFeatureInput,CbbContextualQuote} from "../lib/cbb/contextualForecastFeatures";
import type {CbbDecisionSplitContext} from "../lib/cbb/decisionSplitContext";
import type {CbbMarket} from "../lib/cbb/types";

const time=(minute:number)=>`2026-11-06T17:${String(minute).padStart(2,"0")}:00Z`;
function fixture(market:CbbMarket,second=false,confidenceOnly=false){
 const target:CbbContextualQuote={gameId:7,sportsbook:"draftkings",market,line:market==="moneyline"?null:market==="spread"?-3.5:146.5,
  firstPrice:confidenceOnly?(second?130:-150):-110,secondPrice:confidenceOnly?(second?-150:130):-110,
  provider:"owls",sourceEventId:"event7",orientationVerified:true,phase:"current",providerObservedAt:time(50),fetchedAt:time(51),requestedAt:time(51)};
 const response={...target,sportsbook:"circa",firstPrice:-110,secondPrice:-110};
 const baseline={...response,providerObservedAt:time(10),fetchedAt:time(11),requestedAt:time(11),
  ...(market==="moneyline"?{firstPrice:second?110:-130,secondPrice:second?-130:110}:{line:response.line!+(market==="total"?(second?-1:1):(second?1:-1))})};
 const pressure:CbbDecisionSplitContext={gameId:7,market,sourceBook:"circa",physicalFamily:"circa",sourceClass:"professional_adjacent_named_book",provider:"owls",sourceEventId:"event7",line:baseline.line,
  firstMoney:second?.8:.2,secondMoney:second?.2:.8,firstTickets:.5,secondTickets:.5,observedAt:time(20),availableBy:time(21),receiptEarliest:time(21),clockBasis:"verified_provider_observation",observationIds:[]};
 const input:CbbContextualFeatureInput={independent:{gameId:7,asOf:time(0),release:"test",inputStatus:"complete",margin:0,total:146},
  asOf:time(59),startsAt:"2026-11-06T23:00:00Z",currentQuotes:[target,response],historyQuotes:[baseline],splitContext:[pressure]};
 const latent={marginMean:confidenceOnly?(second?-2.5:2.5):market==="spread"?(second?-5:12):(second?-8:8),
  totalMean:second?130:160,marginSd:12,totalSd:15,correlation:0};
 const run=(i=input,offer=target)=>{
  const receipt=buildCbbContextualMarketInterpretation(i),bytes=JSON.stringify(i);
  const result=buildCbbInterpretedDecision({input:i,interpretation:JSON.parse(JSON.stringify(receipt)),latent,targets:[offer],
   recommendationRisk:{marginLocationSd:.01,totalLocationSd:.01,calibrationGames:182}});
  assert.equal(JSON.stringify(i),bytes,"grading preserves every input");
  return {result,row:result.marketDecisions.find(r=>r.market===market)!};
 };
 return {target,response,baseline,pressure,input,run};
}
for(const market of ["moneyline","spread","total"] as const)for(const second of [false,true]){
 const {target,response,baseline,pressure,input,run}=fixture(market,second),opposed=run();
 assert.equal(opposed.row.selection,second?"second":"first");
 assert.equal(opposed.row.marketResistanceAssessment?.baseGrade,"Best Angle");
 assert.equal(opposed.row.grade,"Watchlist",`${market}/${second}: current direct own-book opposition tempers Best`);
 assert.equal(opposed.row.marketResistanceAssessment?.evidence[0].book,"circa");
 const recovered=run({...input,splitContext:[]});
 assert.equal(recovered.row.grade,"Best Angle","missing composition alone cannot establish the qualifying resistance");
 assert.deepEqual(recovered.result.finalScore,opposed.result.finalScore);
 for(const key of ["target","selection","probability","loseProbability","pushProbability","price","expectedValue"] as const)
  assert.deepEqual(recovered.row[key],opposed.row[key],`${key}: no side flip, forecast or price change`);
 const better={...target,firstPrice:second?-130:110,secondPrice:second?110:-130};
 assert.equal(run({...input,currentQuotes:[better,response]},better).row.grade,"Best Angle","a favorable exact-contract offer remains eligible despite the opposing path");
 const staticOnly=run({...input,historyQuotes:[]});
 assert.equal(staticOnly.row.grade,"Best Angle","current negative source reference plus static shares cannot veto a pick");
 assert.equal(run({...input,splitContext:[{...pressure,sourceEventId:"wrong_event"}]}).row.grade,"Best Angle","wrong native identity cannot establish pressure response");
 assert.equal(run({...input,splitContext:[{...pressure,availableBy:"2026-11-06T18:01:00Z",receiptEarliest:"2026-11-06T18:01:00Z"}]}).row.grade,"Best Angle","future knowledge cannot demote");
 assert.equal(run({...input,splitContext:[{...pressure,observedAt:null,clockBasis:"capture_upper_bound"}]}).row.grade,"Best Angle","unknown clock cannot prove an ordered reaction");
 assert.equal(run({...input,splitContext:[{...pressure,firstMoney:pressure.secondMoney,secondMoney:pressure.firstMoney}]}).row.grade,"Best Angle","price move against its composition is a different context");
 // A newer own-book return/buyback releases the former opposing episode.
 const buyback={...baseline,providerObservedAt:time(55),fetchedAt:time(56),requestedAt:time(56)};
 assert.equal(run({...input,currentQuotes:[target,buyback],historyQuotes:[baseline,response]}).row.grade,"Best Angle","later buyback restores eligibility without requiring a side flip");
 if(market!=="moneyline")assert.equal(run({...input,currentQuotes:[target,{...response,line:response.line!+.5}]}).row.grade,"Best Angle","assumed cross-line reference alone cannot supply the exact-contract caution");
}
for(const second of [false,true]){
 const {input,run}=fixture("moneyline",second,true),opposed=run(),recovered=run({...input,splitContext:[]});
 assert.equal(opposed.row.marketResistanceAssessment?.baseGrade,"Lean");
 assert.equal(opposed.row.grade,"Watchlist","opposition also tempers a confidence-only Lean");
 assert.equal(recovered.row.grade,"Lean","cleared resistance re-promotes the same confident negative-EV pick");
 assert(opposed.row.expectedValue!<0);
 assert.equal(opposed.row.probability,recovered.row.probability);
 assert.equal(opposed.row.expectedValue,recovered.row.expectedValue);
}
console.log("PASS CBB current-contract resistance: both sides/all markets, unchanged law/price, Best/Lean demotion and recovery, static/clock/identity/buyback/cross-line controls");
