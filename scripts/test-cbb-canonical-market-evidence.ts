import assert from "node:assert/strict";
import { pairCbbCanonicalMarketEvidence, type CbbCanonicalPriceRow, type CbbCanonicalSplitRow } from "../lib/services/cbb/cbbCanonicalMarketEvidence";
import type { CbbGame } from "../lib/cbb/types";
const decisionAt="2026-11-02T16:00:00Z",start="2026-11-02T23:00:00Z",fetched="2026-11-02T15:30:00Z";
const run="cbb:2026-11-02:2026-11-02T15:30:00Z",source="2026-11-02T15:29:00Z",event="ncaab:Pepperdine@Cornell-20261102";
const team=(id:number,college:string)=>({id,college,name:college,full_name:college,abbreviation:college.slice(0,3),conference_id:1});
const game:CbbGame={id:777,date:start,season:2026,status:"pre",period:0,home_team:team(1,"Cornell"),visitor_team:team(2,"Pepperdine"),home_score:0,away_score:0};
function price(side:"home"|"away",id:number):CbbCanonicalPriceRow{
 return {id,provider:"owls",provider_event_id:event,ingestion_run_id:run,canonical_event_id:"777",canonical_market_id:"777:spread",league:"cbb",
  sportsbook:"circa",sharp_book:true,market_type:"spread",selection_key:`777:spread:${side}`,line:side==="home"?3:-3,american_price:-110,
  decimal_price:1+100/110,no_vig_probability:.5,provider_timestamp:source,fetched_at:fetched,inserted_at:side==="home"?"2026-11-02T15:30:03Z":"2026-11-02T15:30:04Z",
  raw_payload_hash:String(id).padStart(64,"a"),minutes_to_start:450};
}
function split(side:"home"|"away",id:number):CbbCanonicalSplitRow{
 return {id,provider:"owls",provider_event_id:event,ingestion_run_id:run,canonical_event_id:"777",canonical_market_id:"777:spread",league:"cbb",
  source_book:"circa",source_type:"sharp_adjacent_book",market_type:"spread",selection_key:`777:spread:${side}`,market_line:side==="home"?3:-3,market_price:null,
  money_pct:side==="home"?.1:.9,bets_pct:side==="home"?.6:.4,source_observed_at:source,fetched_at:fetched,
  inserted_at:side==="home"?"2026-11-02T15:30:01Z":"2026-11-02T15:30:02Z",source_timestamp_verified:true,split_line_basis:"provider_explicit",books_used:null,
  raw_payload_hash:String(id).padStart(64,"b"),minutes_to_start:450};
}
const prices=[price("home",1),price("away",2)],splits=[split("home",3),split("away",4)];
const read=(priceRows=prices,splitRows:CbbCanonicalSplitRow[]=splits,extra:Partial<Parameters<typeof pairCbbCanonicalMarketEvidence>[0]>={})=>
 pairCbbCanonicalMarketEvidence({game,decisionAt,priceRows,splitRows,...extra});
const before=JSON.stringify({prices,splits}),normal=read();
assert.equal(normal.pricePairs.length,1);assert.equal(normal.splitPairs.length,1);assert.equal(normal.rejected.length,0);
const pair=normal.pricePairs[0];
assert.equal(pair.first.ownLine,3,"integer HOME handicap is preserved exactly");assert.equal(pair.second.ownLine,-3);
assert.equal(pair.first.priceAmerican,-110);assert.equal(pair.first.observationId,1);assert.equal(pair.second.observationId,2);
assert.notEqual(pair.first.rawPayloadHash,pair.second.rawPayloadHash,"native hashes describe each side and must not be equated");
assert.equal(pair.recordedFetchedAt,fetched);assert.equal(pair.ingestionRunId,run);
assert.equal(pair.availability.kind,"db_inserted_upper_bound");assert.equal(pair.availability.runStartedAt,fetched);
assert.equal(pair.availability.availableBy,prices[1].inserted_at);assert.equal(pair.availability.responseArrival,"not_attested");
assert.equal(pair.availability.sameRunResponseOrdering,"unknown");assert.equal(normal.completeness,"not_asserted");
assert.equal(normal.splitPairs[0].first.money,.1);assert.equal(normal.splitPairs[0].first.tickets,.6);
assert.equal(normal.splitPairs[0].sourceClass,"professional_adjacent_named_book");
assert.equal(JSON.stringify({prices,splits}),before,"source rows remain byte-for-byte untouched");
const reverse=read(prices.map(p=>({...p,provider_event_id:"ncaab:Cornell@Pepperdine-20261102"})),[]);
assert.equal(reverse.pricePairs[0].sourceIdentity.orientation,"reversed");
assert.equal(reverse.pricePairs[0].first.ownLine,3,"mapped canonical HOME's own signed line must not be reversed a second time");
assert.equal(reverse.pricePairs[0].second.ownLine,-3);
const aliasGame={...game,home_team:team(1,"Michigan State"),visitor_team:team(2,"BYU")};
const alias=read(prices.map(p=>({...p,provider_event_id:"ncaab:BYU@Michigan St-20261102"})),[],{game:aliasGame});
assert.equal(alias.pricePairs.length,1,"existing exact institution aliases are reused");
const rejectedPrice=(mutate:Partial<CbbCanonicalPriceRow>,reason?:string)=>{
 const result=read([{...prices[0],...mutate},prices[1]],[]);
 assert.equal(result.pricePairs.length,0,JSON.stringify(mutate));
 if(reason)assert.ok(result.rejected.some(r=>r.reason.includes(reason)),JSON.stringify(result.rejected));
};
rejectedPrice({provider_event_id:"ncaab:Pepperdine@Cornell-20261103"},"identity");
rejectedPrice({provider_event_id:"ncaab:Different@Cornell-20261102"},"identity");
rejectedPrice({provider_event_id:"ncaab:Waves@Big Red-20261102"},"identity");
rejectedPrice({provider_event_id:"123456"},"identity");
rejectedPrice({provider:"canonical_lines"},"provider");
rejectedPrice({provider:"legacy_unattributed"},"provider");
rejectedPrice({league:"nba"},"league");
rejectedPrice({canonical_event_id:"778"},"fixture");
rejectedPrice({canonical_market_id:"778:spread"},"market");
rejectedPrice({selection_key:"777:spread:away"});
rejectedPrice({ingestion_run_id:null},"run");
rejectedPrice({raw_payload_hash:null},"hash");
rejectedPrice({inserted_at:"2026-11-02T16:00:00.001Z"},"clock");
rejectedPrice({inserted_at:"2026-11-02T15:29:59Z"},"clock");
rejectedPrice({provider_timestamp:"2026-11-02T15:30:05Z"},"clock");
rejectedPrice({fetched_at:"2026-11-02T15:30:00.001Z"},"clock");
rejectedPrice({line:3.25},"line");rejectedPrice({line:-3},"line");rejectedPrice({american_price:-99},"price");
assert.equal(read([{...prices[0],provider_timestamp:"2026-11-02T15:30:01Z"},{...prices[1],provider_timestamp:"2026-11-02T15:30:01Z"}],[]).pricePairs.length,1,
 "source update during the request is allowed before actual DB availability, not rejected against the earlier run clock");
const laterRun="cbb:2026-11-02:2026-11-02T15:45:00Z",laterFetch="2026-11-02T15:45:00Z",laterInsert="2026-11-02T15:45:05Z";
const later=(p:CbbCanonicalPriceRow)=>({...p,id:Number(p.id)+10,ingestion_run_id:laterRun,fetched_at:laterFetch,inserted_at:laterInsert});
assert.equal(read([prices[0],later(prices[1])],[]).pricePairs.length,0,"two sides from different native runs are never spliced");
assert.equal(read([prices[0]],[]).pricePairs.length,0);
assert.equal(read([...prices,prices[0]],[]).pricePairs.length,1,"an exact repeated transport row is harmless");
assert.equal(read([...prices,{...prices[0],id:10}],[]).pricePairs.length,0,"ambiguous duplicate side observation IDs fail closed");
const duplicateIdConflict=read([...prices,{...prices[0],provider_timestamp:"2026-11-02T15:30:01Z"}],[]);
assert.equal(duplicateIdConflict.pricePairs.length,0,"one native observation ID cannot represent different source states");
const contradictory=read([...prices,...prices.map(p=>({...later(p),american_price:p.selection_key.endsWith(":home")?-130:-110}))],[]);
assert.equal(contradictory.pricePairs.length,0,"equal source-time contradictory prices quarantine complete frames across runs");
const oneSidedContradiction=read([...prices,{...later(prices[0]),american_price:-130}],[]);
assert.equal(oneSidedContradiction.pricePairs.length,0,"an incomplete conflicting later frame cannot leave the earlier contradictory frame authoritative");
const nativeIdPrices=prices.map(p=>({...p,provider_event_id:"123456"}));
const attested=read(nativeIdPrices,[],{eventAttestations:[{provider:"owls",providerEventId:"123456",gameId:777,
 homeTeam:"Cornell",awayTeam:"Pepperdine",startsAt:start,identity:"independent_named_fixture_join"}]});
assert.equal(attested.pricePairs.length,1);assert.equal(attested.pricePairs[0].sourceIdentity.kind,"independent_named_fixture_join");
const invalidSplits=[{source_timestamp_verified:false},{split_line_basis:"unknown" as const},{money_pct:null},{bets_pct:60},{market_line:3.25},
 {source_type:"multi_book_consensus" as const},{provider_event_id:null},{ingestion_run_id:null},{inserted_at:"2026-11-02T16:01:00Z"}];
for(const mutate of invalidSplits)assert.equal(read([], [{...splits[0],...mutate},splits[1]]).splitPairs.length,0,JSON.stringify(mutate));
const retail=read([],splits.map(p=>({...p,source_book:"draftkings" as const,source_type:"retail_book" as const})));
assert.equal(retail.splitPairs[0].sourceClass,"retail_named_book");assert.equal(retail.splitPairs[0].book,"draftkings");
const concentrated=read([],splits.map((p,i)=>({...p,money_pct:i===0?.8:.2,bets_pct:i===0?.8:.2})));
assert.equal(concentrated.splitPairs[0].first.money,.8);assert.equal(concentrated.splitPairs[0].first.tickets,.8);
assert.equal(concentrated.splitPairs[0].directFlowEligible,true,"80/80 native concentration is complete evidence without requiring a money-ticket gap");
const moneyOnly=read([],splits.map(p=>({...p,bets_pct:null})));
assert.equal(moneyOnly.splitPairs.length,1);assert.equal(moneyOnly.splitPairs[0].evidenceClass,"money_only_context");
assert.equal(moneyOnly.splitPairs[0].first.money,.1);assert.equal(moneyOnly.splitPairs[0].first.tickets,null);assert.equal(moneyOnly.splitPairs[0].directFlowEligible,false);
const ticketsOnly=read([],splits.map(p=>({...p,money_pct:null})));
assert.equal(ticketsOnly.splitPairs[0].evidenceClass,"tickets_only_context");assert.equal(ticketsOnly.splitPairs[0].directFlowEligible,false);
const retailTickets=read([],splits.map(p=>({...p,source_book:"betmgm" as const,source_type:"retail_ticket_share" as const,money_pct:null})));
assert.equal(retailTickets.splitPairs[0].sourceClass,"retail_ticket_share");assert.equal(retailTickets.splitPairs[0].directFlowEligible,false);
assert.equal(read([],splits.map(p=>({...p,money_pct:null,bets_pct:null}))).splitPairs.length,0);
const rounded=read([], [{...splits[0],bets_pct:.59},{...splits[1],bets_pct:.4}]);
assert.equal(rounded.splitPairs.length,1,"published whole-percent99/101 source pairs retain original values under existing tolerance");
assert.equal(rounded.splitPairs[0].first.tickets,.59);
const material=read([], [{...splits[0],bets_pct:.5},splits[1]]);assert.equal(material.splitPairs.length,0);
const splitReverse=read([],splits.map(s=>({...s,provider_event_id:"ncaab:Cornell@Pepperdine-20261102"})));
assert.equal(splitReverse.splitPairs[0].first.ownLine,3);
const mixedRunSplits=read([], [splits[0],{...splits[1],ingestion_run_id:laterRun,fetched_at:laterFetch,inserted_at:laterInsert}]);
assert.equal(mixedRunSplits.splitPairs.length,0);
const totalPrices=prices.map((p,i)=>({...p,market_type:"total" as const,canonical_market_id:"777:total",selection_key:`777:total:${i===0?"over":"under"}`,line:150}));
assert.equal(read(totalPrices,[]).pricePairs[0].first.ownLine,150);
const mlPrices=prices.map((p,i)=>({...p,market_type:"moneyline" as const,canonical_market_id:"777:moneyline",selection_key:`777:moneyline:${i===0?"home":"away"}`,line:null}));
assert.equal(read(mlPrices,[]).pricePairs[0].first.ownLine,null);
// Removing an unsafe middle frame must leave an explicit source gap. A
// downstream path must never infer a direct before/after transition from it.
const atMinute=(minute:number)=>`2026-11-02T15:${String(minute).padStart(2,"0")}:00Z`;
const priceFrame=(minute:number,offset:number,book="ps3838")=>prices.map((p,i)=>({...p,id:offset+i,sportsbook:book,
 provider_timestamp:atMinute(minute),fetched_at:atMinute(minute+1),ingestion_run_id:`cbb:2026-11-02:${atMinute(minute+1)}`,
 inserted_at:`2026-11-02T15:${String(minute+1).padStart(2,"0")}:05Z`,raw_payload_hash:String(offset+i).padStart(64,"c")}));
const splitFrame=(minute:number,offset:number)=>splits.map((p,i)=>({...p,id:offset+i,
 source_observed_at:atMinute(minute),fetched_at:atMinute(minute+1),ingestion_run_id:`cbb:2026-11-02:${atMinute(minute+1)}`,
 inserted_at:`2026-11-02T15:${String(minute+1).padStart(2,"0")}:04Z`,raw_payload_hash:String(offset+i).padStart(64,"d")}));
const beforePrice=priceFrame(0,101),middlePrice=priceFrame(10,201),afterPrice=priceFrame(20,301);
const middlePriceConflict={...middlePrice[0],id:203,american_price:-130,raw_payload_hash:"e".repeat(64)};
const priceGap=read([...beforePrice,...middlePrice,middlePriceConflict,...afterPrice],[]);
assert.equal(priceGap.pricePairs.length,2,"valid price frames before/after the conflict remain available as context");
assert.equal(priceGap.quarantinedSources.length,1);
assert.deepEqual(priceGap.quarantinedSources[0],{gameId:777,book:"ps3838",family:"pinnacle",market:"spread",sourceAt:atMinute(10),kind:"price",
 reason:"contradictory_same_source_time_native_frames",observationIds:[201,202,203]});
assert.deepEqual(priceGap.pricePairs.map(p=>p.sourceAt),[atMinute(0),atMinute(20)]);
const beforeSplit=splitFrame(0,401),middleSplit=splitFrame(10,501),afterSplit=splitFrame(20,601);
const middleSplitConflict={...middleSplit[0],id:503,money_pct:.8,raw_payload_hash:"f".repeat(64)};
const splitGap=read([], [...beforeSplit,...middleSplit,middleSplitConflict,...afterSplit]);
assert.equal(splitGap.splitPairs.length,2,"valid split frames before/after the conflict remain context");
assert.deepEqual(splitGap.quarantinedSources[0],{gameId:777,book:"circa",family:"circa",market:"spread",sourceAt:atMinute(10),kind:"split",
 reason:"contradictory_same_source_time_native_frames",observationIds:[501,502,503]});
const ambiguousPriceGap=read([...beforePrice,middlePrice[0],...afterPrice],[]);
assert.equal(ambiguousPriceGap.pricePairs.length,2);
assert.equal(ambiguousPriceGap.quarantinedSources[0].sourceAt,atMinute(10));
assert.equal(ambiguousPriceGap.quarantinedSources[0].reason,"missing_or_ambiguous_opposing_side_same_native_frame");
const ambiguousSplitGap=read([], [...beforeSplit,middleSplit[0],...afterSplit]);
assert.equal(ambiguousSplitGap.splitPairs.length,2);
assert.equal(ambiguousSplitGap.quarantinedSources[0].kind,"split");
assert.equal(ambiguousSplitGap.quarantinedSources[0].sourceAt,atMinute(10));
const nativeIdGap=read([...beforePrice,...middlePrice,{...middlePrice[0],american_price:-130},...afterPrice],[]);
assert.equal(nativeIdGap.pricePairs.length,2);
assert.ok(nativeIdGap.quarantinedSources.some(q=>q.reason==="conflicting_native_observation_id"&&q.sourceAt===atMinute(10)&&q.family==="pinnacle"));
const invalidIdentityRows=[{...middlePrice[0],provider_event_id:"ncaab:WrongInstitution@Cornell-20261102"},
 {...middlePrice[1],canonical_event_id:"778"}];
const untrusted=read(invalidIdentityRows,[]);
assert.equal(untrusted.quarantinedSources.length,0,"unmatched foreign fixture/institution rows cannot invent source quarantine attestation");
const invalidIdCollision=read([...beforePrice,{...beforePrice[0],provider_event_id:"ncaab:WrongInstitution@Cornell-20261102"}],[]);
assert.equal(invalidIdCollision.pricePairs.length,1);
assert.equal(invalidIdCollision.quarantinedSources.length,0,"an untrusted row reusing an ID cannot poison a qualified native source");
const subMillisecondLate=read([{...prices[0],inserted_at:"2026-11-02T16:00:00.000001+00:00"},prices[1]],[]);
assert.equal(subMillisecondLate.pricePairs.length,0,"DB insertion after the decision cannot floor backward into eligibility");
const exactLatest=read([{...prices[0],inserted_at:"2026-11-02T15:30:04.630193+00:00"},
 {...prices[1],inserted_at:"2026-11-02T15:30:04.630999+00:00"}],[]);
assert.equal(exactLatest.pricePairs[0].availability.availableBy,"2026-11-02T15:30:04.630999+00:00","the actual latest native insertion string survives a same-millisecond tie");
assert.throws(()=>read(prices,[],{decisionAt:start}),/pregame/);
console.log("PASS CBB native canonical pairs: exact fixture/orientation, own contracts, complete native provenance, run-start/DB availability bounds, no cross-run splices and source-time quarantine.");
