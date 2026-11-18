import assert from "node:assert/strict";
import {coordinates} from "./coordinates";
import type {CbbContextualFeatureInput,CbbContextualQuote} from "../../../lib/cbb/contextualForecastFeatures";
const time=(m:number) => `2026-11-06T12:${String(m).padStart(2,"0")}:00Z`;
const quote=(market:CbbContextualQuote["market"],line:number|null,minute=20,firstPrice=-110,secondPrice=-110):CbbContextualQuote => ({
  gameId:1,sportsbook:"pinnacle",market,line,firstPrice,secondPrice,providerObservedAt:time(minute),requestedAt:time(minute),
  fetchedAt:time(minute+1),phase:"current",orientationVerified:true,provider:"owls",sourceEventId:"fixture:1"});
const raw:CbbContextualFeatureInput={independent:{gameId:1,asOf:time(0),release:"synthetic",inputStatus:"complete",margin:4,total:150,
  homeWinProbability:.65,uncertainty:{marginSd:10,totalSd:15}},asOf:time(30),startsAt:"2026-11-06T18:00:00Z",
  currentQuotes:[quote("spread",-4),quote("moneyline",null,20,-180,150),quote("total",150)],
  historyQuotes:[quote("total",149,5),quote("spread",-3,5)],
  splitContext:[{gameId:1,market:"total",sourceBook:"pinnacle",physicalFamily:"pinnacle",sourceClass:"professional_adjacent_named_book",
    provider:"owls",sourceEventId:"fixture:1",line:149,firstMoney:.8,secondMoney:.2,firstTickets:.6,secondTickets:.4,
    observedAt:time(10),availableBy:time(11),receiptEarliest:time(11),clockBasis:"verified_provider_observation",observationIds:[]}]};
const saved=structuredClone(raw), base=coordinates(raw), changed=structuredClone(raw);
changed.independent.total+=20;
for (const rows of [changed.currentQuotes,changed.historyQuotes]) for (const q of rows??[]) if(q.market==="total") q.line!+=20;
for (const s of changed.splitContext??[]) if(s.market==="total") s.line!+=20;
const translated=coordinates(changed);
assert.ok(Math.abs(translated.total.origin-base.total.origin-20)<1e-8);
assert.deepEqual(translated.total.known,base.total.known);
base.total.values.forEach((v,j) => assert.ok(Math.abs(v-translated.total.values[j])<1e-7,"Total economic-coordinate translation"));
const reflected=structuredClone(raw);
reflected.independent.margin*=-1; reflected.independent.homeWinProbability=1-reflected.independent.homeWinProbability!;
for(const rows of [reflected.currentQuotes,reflected.historyQuotes]) for(const q of rows??[]) if(q.market!=="total") {
  if(q.line!==null) q.line*=-1; [q.firstPrice,q.secondPrice]=[q.secondPrice,q.firstPrice];
}
const mirror=coordinates(reflected);
for(const axis of ["margin","total"] as const) {
  assert.deepEqual(base[axis].names,mirror[axis].names); assert.deepEqual(base[axis].known,mirror[axis].known);
  const sign=axis==="margin"?-1:1;
  assert.ok(Math.abs(mirror[axis].origin-sign*base[axis].origin)<1e-7);
  base[axis].values.forEach((v,j) => assert.ok(Math.abs(mirror[axis].values[j]-sign*v)<1e-7,`${axis} fixture reflection`));
}
const noTotal=coordinates({...raw,currentQuotes:raw.currentQuotes.filter(q=>q.market!=="total"),
  historyQuotes:raw.historyQuotes?.filter(q=>q.market!=="total"),splitContext:[]});
assert.deepEqual(noTotal.margin,base.margin,"Optional Total evidence cannot disconnect own Margin evidence");
assert.equal(noTotal.total.origin,150,"Explicit independent-only fallback without native Total");
const duplicated=coordinates({...raw,currentQuotes:[...raw.currentQuotes,...raw.currentQuotes]});
assert.deepEqual(duplicated,base,"Duplicate transport rows do not duplicate physical source effects");
const past=coordinates({...raw,currentQuotes:[...raw.currentQuotes,{...quote("total",240,45),sportsbook:"circa"}]});
assert.deepEqual(past,base,"Unavailable future quote cannot enter a forecast");
const flat=coordinates({...raw,historyQuotes:[]});
assert.ok(base.margin.values.some((v,j)=>base.margin.groups[j]==="path"&&v!==flat.margin.values[j]),"Native Margin path is connected");
assert.ok(base.total.values.some((v,j)=>base.total.groups[j]==="path"&&v!==flat.total.values[j]),"Native Total path is connected");
assert.deepEqual(raw,saved,"Feature extraction preserves original evidence");
console.log(JSON.stringify({status:"PASS",checks:12}));
