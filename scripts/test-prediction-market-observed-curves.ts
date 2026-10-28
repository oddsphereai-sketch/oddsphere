import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  predictionMarketObservedCurve,predictionMarketCurve,predictionMarketComparison,
  predictionMarketWindowPoints,predictionMarketAnchorIndices,predictionMarketBookPricePath,
  predictionMarketObservationAt,predictionMarketReaderBookTrail,predictionMarketComparisonBook,
} from "../app/lab/lib/predictionMarketDisplay";
import type {MarketEdgeDto} from "../app/lab/lib/labTypes";

// Exact stored ATL -2 reference observations from the owner's reported game.
const stops=[
  {at:"2026-10-28T14:45:38.340Z",price:-110},
  {at:"2026-10-28T15:30:21.226Z",price:-105},
  {at:"2026-10-28T20:30:24.548Z",price:-110},
  {at:"2026-10-28T21:45:09.420Z",price:-110},
];
const market={pick:"ATL -2",line:-2,priceAmerican:-107,oddsTrail:stops.map((s,i)=>({american:s.price,line:-2,sportsbook:"circa",observedAt:s.at,label:i===3?"locked":"move",source:i===3?"locked_snapshot":"line_history"}))} as MarketEdgeDto;
const checksum=JSON.stringify(market),now=Date.parse("2026-10-28T23:00:00Z");
const stored=predictionMarketReaderBookTrail(market,"ATL -2",now,-2)!;
const kalshi={asOf:"2026-10-28T22:00:00Z",history:[
  [Date.parse("2026-10-28T16:15:00Z"),.5,100],
  [Date.parse("2026-10-28T21:40:00Z"),.505,110],
  [Date.parse("2026-10-28T22:00:00Z"),.51,120],
] as Array<[number,number,number|null]>};
const before=JSON.stringify({stored,kalshi}),comparison=predictionMarketComparison(kalshi,stored);
assert.equal(comparison.start,Date.parse(stops[0].at),"10:45 ET opening anchor stays visible even though Kalshi starts at 12:15 ET");
assert.equal(comparison.cutoff,Date.parse(stops.at(-1)!.at),"faster Kalshi still waits at the exact last sportsbook observation");
assert.equal(predictionMarketBookPricePath(comparison.bookPoints),"−110 → −105 → −110","a round trip must not collapse to a misleading -110 to -110 summary");
const plotted=predictionMarketWindowPoints(comparison.bookPoints,comparison.start);
assert.deepEqual(plotted.map(p=>p[2]),[-110,-105,-110,-110]);
const left=36,right=340,x=(at:number)=>left+(at-comparison.start)/(comparison.cutoff!-comparison.start)*(right-left),y=(p:number)=>100-p*100;
assert.ok(plotted.every(p=>x(p[0])>=left&&x(p[0])<=right),"none of Atlanta's quoted turning points is clipped offscreen");
assert.equal(plotted[0][1],110/210);assert.equal(plotted[1][1],105/205);assert.equal(plotted[2][1],110/210);
assert.ok(y(plotted[1][1])>y(plotted[0][1]),"-110 to -105 is a downward implied-probability move");
assert.equal(y(plotted[0][1]),y(plotted[2][1]),"return to -110 returns to exactly the opening height");
const anchors=predictionMarketAnchorIndices(plotted);
assert.ok(anchors.has(0)&&anchors.has(1)&&anchors.has(2)&&anchors.has(3),"the actual low point and the first return to -110 are visible dots, not only the endpoints");
const bookCurve=predictionMarketObservedCurve(plotted,x,y,120);
assert.equal(bookCurve.line,"","45-minute, five-hour and 75-minute gaps must not become solid gradual trends");
assert.equal((bookCurve.gapLine.match(/M/g)??[]).length,3);
assert.equal(bookCurve.area,"","no gradient area may imply a sampled path through those gaps");
assert.equal(bookCurve.hasGaps,true);
assert.ok(bookCurve.gapLine.startsWith(`M${left},${y(110/210)}`));
assert.ok(bookCurve.gapLine.includes(`${x(plotted[1][0])},${y(105/205)}`),"gap connector still terminates at the exact recorded low point");
assert.equal(predictionMarketObservationAt(comparison.points,comparison.start),null,"missing earlier Kalshi history stays blank; no fabricated opening");
assert.equal(predictionMarketObservationAt(comparison.bookPoints,Date.parse("2026-10-28T18:00:00Z"))?.[2],-105,"inspection reports the last actual quote and its original timestamp, not an interpolated 2 PM price");
assert.equal(JSON.stringify({stored,kalshi}),before);
assert.strictEqual(predictionMarketComparisonBook(true,stored,{...stored,locked:false,points:[[now,.9,-900]]}),stored,"stored locked evidence retains exact precedence");
assert.equal(JSON.stringify(market),checksum,"all stored locked field values remain unchanged");

const dense=[[0,.5],[300_000,.505],[600_000,.51],[900_000,.504]] as const;
const observed=predictionMarketObservedCurve(dense,Number,Number,1);
assert.equal(observed.gapLine,"");assert.equal(observed.hasGaps,false);
assert.equal(observed.line,predictionMarketCurve(dense,Number,Number).line,"dense history retains the same bounded smooth geometry");
assert.ok(observed.area);
const mixed=predictionMarketObservedCurve([[0,.5],[300_000,.51],[3_000_000,.52],[3_300_000,.515]],Number,Number,1);
assert.equal((mixed.line.match(/M/g)??[]).length,2,"only actual sampled runs are solid");
assert.equal((mixed.gapLine.match(/M/g)??[]).length,1);
assert.equal((mixed.area.match(/Z/g)??[]).length,2,"area stops on both sides of a sparse gap");
assert.equal(predictionMarketBookPricePath([[0,.5,-110],[1,.5,-110]]),"−110");
assert.deepEqual([...predictionMarketAnchorIndices([])],[]);
assert.deepEqual(predictionMarketObservedCurve([],Number,Number),{line:"",gapLine:"",area:"",hasGaps:false});
assert.deepEqual(predictionMarketObservedCurve([[0,.5]],Number,Number),{line:"M0,0.5",gapLine:"",area:"",hasGaps:false});

const component=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8");
assert.match(component,/predictionMarketObservedCurve\(plotPoints,x,y,bottom\)/);
assert.match(component,/predictionMarketObservedCurve\(plotBook,x,y\)/);
assert.match(component,/data-book-turning-price/);assert.match(component,/data-kalshi-gaps/);assert.match(component,/data-sportsbook-gaps/);
assert.match(component,/Dots: recorded quotes · dashed: gaps between observations/);
console.log("PASS ATL -2: exact -110/-105/-110 anchors visible; correct dip/return; sparse gaps explicitly dashed; dense rounded geometry shared by both sources; original locked values untouched");
