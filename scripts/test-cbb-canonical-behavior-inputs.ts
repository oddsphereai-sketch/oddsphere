import assert from "node:assert/strict";
import {cbbCanonicalBehaviorInputs} from "../lib/services/cbb/cbbCanonicalBehaviorInputs";
import {cbbEvidenceReceiptBounds,cbbEvidenceProvablyBefore} from "../lib/cbb/marketReceiptTime";
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
const native=read(),bytes=JSON.stringify(native),adapted=cbbCanonicalBehaviorInputs(native);
assert.equal(adapted.historyQuotes.length,1);assert.equal(adapted.historyFlows.length,1);
const q=adapted.historyQuotes[0],f=adapted.historyFlows[0];
assert.equal(q.fetchedAt,fetched,"recorded native run-start remains untouched");assert.equal(f.fetchedAt,fetched);
assert.equal(q.canonicalReceipt.availableBy,prices[1].inserted_at);
assert.equal(f.canonicalReceipt?.availableBy,splits[1].inserted_at);
assert.equal(q.line,3);assert.equal(q.firstPrice,-110);assert.equal(q.secondPrice,-110);assert.equal(q.orientationVerified,true);
assert.equal(q.canonicalReceipt.providerEventId,event);assert.equal(q.canonicalReceipt.ingestionRunId,run);
assert.deepEqual(q.canonicalReceipt.observationIds,[1,2]);assert.deepEqual(q.canonicalReceipt.rawPayloadHashes,prices.map(p=>p.raw_payload_hash));
assert.equal(cbbEvidenceReceiptBounds(q).kind,"db_inserted_upper_bound");
assert.equal(cbbEvidenceProvablyBefore(f,q),false,"earlier split INSERT inside one run cannot prove source response ordering");
assert.equal(cbbEvidenceProvablyBefore(q,f),false);
assert.equal(JSON.stringify(native),bytes,"pure conversion preserves qualified native pair evidence");
assert.deepEqual(adapted.splitContext,native.splitPairs);
assert.equal(adapted.historyFlows[0].firstMoney,.1);assert.equal(adapted.historyFlows[0].firstTickets,.6);
const reversed=cbbCanonicalBehaviorInputs(read(prices.map(p=>({...p,provider_event_id:"ncaab:Cornell@Pepperdine-20261102"})),[]));
assert.equal(reversed.historyQuotes[0].line,3,"already mapped canonical home handicap is not negated");
for(const contextRows of [splits.map(p=>({...p,bets_pct:null})),splits.map(p=>({...p,money_pct:null})),
 splits.map(p=>({...p,source_book:"draftkings" as const,source_type:"retail_book" as const})),
 splits.map(p=>({...p,source_book:"betmgm" as const,source_type:"retail_ticket_share" as const,money_pct:null}))]){
 const context=cbbCanonicalBehaviorInputs(read([],contextRows));
 assert.equal(context.historyFlows.length,0);assert.equal(context.splitContext.length,1);
 assert.deepEqual(context.splitContext[0].first.money,contextRows[0].money_pct);
 assert.deepEqual(context.splitContext[0].first.tickets,contextRows[0].bets_pct);
}
const noFabrication=cbbCanonicalBehaviorInputs(read([],splits.map(p=>({...p,bets_pct:null}))));
assert.equal(noFabrication.splitContext[0].first.tickets,null);
const concentrated=cbbCanonicalBehaviorInputs(read([],splits.map((p,i)=>({...p,money_pct:i===0?.8:.2,bets_pct:i===0?.8:.2}))));
assert.equal(concentrated.historyFlows.length,1);assert.equal(concentrated.historyFlows[0].firstMoney,.8);
const rounded=cbbCanonicalBehaviorInputs(read([],splits.map((p,i)=>({...p,money_pct:i===0?.43:.58,bets_pct:i===0?.58:.43}))));
assert.equal(rounded.historyFlows.length,1);assert.equal(rounded.historyFlows[0].secondMoney,.58);
const invalidAuthority=cbbCanonicalBehaviorInputs(read([],splits.map((p,i)=>({...p,money_pct:i===0?.42:.6}))));
assert.equal(invalidAuthority.historyFlows.length,0,"legacy three-point context tolerance cannot confer published-pressure authority");
assert.equal(invalidAuthority.splitContext.length,1,"source values stay context rather than being rewritten");
const unsafeNative=read([{...prices[0],id:"9007199254740993"},prices[1]],[]);
assert.equal(unsafeNative.pricePairs.length,1,"native BIGINT identity is preserved before candidate narrowing");
const unsafe=cbbCanonicalBehaviorInputs(unsafeNative);
assert.equal(unsafe.historyQuotes.length,0);assert.equal(unsafe.quarantinedSources.length,1);
assert.equal(unsafe.sourceQuarantines[0].observationIds[0],"9007199254740993","unsafe identities are never rounded into another observation");
const conflict=read([...prices,{...prices[0],id:9,american_price:-130}],[]);
const quarantined=cbbCanonicalBehaviorInputs(conflict);
assert.equal(quarantined.historyQuotes.length,0);assert.equal(quarantined.quarantinedSources[0].book,"circa");
assert.equal(quarantined.quarantinedSources[0].sourceAt,source);
assert.equal(quarantined.sourceQuarantines[0].kind,"price");
assert.equal(quarantined.quarantinedSources[0].reason,"canonical_price:contradictory_same_source_time_native_frames");
console.log("PASS CBB canonical behavior inputs: source clocks/availability/lineage retained, only complete Circa flow authority, single-axis/retail context and unsafe-source quarantine.");
