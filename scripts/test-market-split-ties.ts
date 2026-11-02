import assert from "node:assert/strict";
import {splitLeader,splitSectionSignal,splitSourceComparison,splitSourcesConflict,splitDirectionalMeasure} from "../app/lab/lib/marketPulsePresentation";
import type {MarketSplitDisplaySection} from "../lib/types/domain/RecommendationDecision";

const section:MarketSplitDisplaySection={label:"Sharp Book Splits",lastUpdated:"2026-11-02T21:46:00Z",signal:"Stored source context",
 rows:[{side:"away",label:"WEB",moneyPct:50,betsPct:50,observedAt:"2026-11-02T21:46:00Z",isStale:false},
 {side:"home",label:"ORST",moneyPct:50,betsPct:50,observedAt:"2026-11-02T21:46:00Z",isStale:false}]};
const frozen=JSON.stringify(section);
Object.freeze(section);Object.freeze(section.rows);section.rows.forEach(Object.freeze);
for(const input of [section,{...section,rows:[...section.rows].reverse()}]){
 assert.equal(splitLeader(input,"moneyPct"),null);assert.equal(splitLeader(input,"betsPct"),null);
 assert.deepEqual(splitSectionSignal(input),{direction:null,moneyLeader:null,ticketLeader:null,internallySplit:false});
 assert.equal(splitSourceComparison("Money",null,splitLeader(input,"moneyPct")),null);
 assert.equal(splitSourceComparison("Tickets",null,splitLeader(input,"betsPct")),null);
}
assert.equal(JSON.stringify(section),frozen,"display derivation leaves every stored evidence field and source signal exact");
const mixed={...section,rows:section.rows.map((r,i)=>({...r,betsPct:i===0?60:40}))};
assert.equal(splitLeader(mixed,"moneyPct"),null);assert.equal(splitLeader(mixed,"betsPct"),"WEB");
assert.equal(splitSourceComparison("Money",null,splitLeader(mixed,"moneyPct")),null);
assert.equal(splitSourceComparison("Tickets",null,splitLeader(mixed,"betsPct")),"Tickets: Sharp WEB");
const unique={...section,rows:section.rows.map((r,i)=>({...r,moneyPct:i===0?49:51}))};
assert.equal(splitLeader(unique,"moneyPct"),"ORST");
assert.equal(splitSourceComparison("Money","WEB",splitLeader(section,"moneyPct")),"Money: Public WEB");
assert.equal(splitSourceComparison("Money","ORST","ORST"),"Money agrees on ORST");
assert.equal(splitLeader({...section,rows:section.rows.map(r=>({...r,moneyPct:0}))},"moneyPct"),null);
assert.equal(splitLeader({...section,rows:section.rows.map(r=>({...r,moneyPct:null}))},"moneyPct"),null);
const threeWay={...section,rows:[{...section.rows[0],moneyPct:40},{...section.rows[1],moneyPct:40},{...section.rows[0],side:"draw" as const,label:"Draw",moneyPct:20}]};
assert.equal(splitLeader(threeWay,"moneyPct"),null);
assert.equal(splitLeader({...threeWay,rows:threeWay.rows.map((r,i)=>({...r,moneyPct:i===0?41:i===1?39:20}))},"moneyPct"),"WEB");
const publicMoneyOnly={...section,rows:section.rows.map((r,i)=>({...r,moneyPct:i===0?60:40}))};
const sharpTicketsOnly={...section,rows:section.rows.map((r,i)=>({...r,betsPct:i===0?40:60}))};
assert.equal(splitSourcesConflict(publicMoneyOnly,sharpTicketsOnly),false,"different money/ticket axes cannot manufacture source disagreement");
assert.equal(splitSourcesConflict(sharpTicketsOnly,publicMoneyOnly),false);
const sharpOpposingMoney={...section,rows:section.rows.map((r,i)=>({...r,moneyPct:i===0?40:60}))};
assert.equal(splitSourcesConflict(publicMoneyOnly,sharpOpposingMoney),true,"real same-axis source disagreement remains visible");
assert.equal(splitSourcesConflict(publicMoneyOnly,section),false);
assert.equal(splitDirectionalMeasure(splitSectionSignal(section)),null);
assert.equal(splitDirectionalMeasure(splitSectionSignal(sharpTicketsOnly)),"Tickets","a ticket-only direction must never be called money");
assert.equal(splitDirectionalMeasure(splitSectionSignal(publicMoneyOnly)),"Money");
console.log("PASS split presentation: two/three-way ties, row order, independent money/ticket axes, single-source comparison and exact stored-evidence preservation.");
