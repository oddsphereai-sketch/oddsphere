import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {predictionMarketBookStart,predictionMarketComparison,predictionMarketBookPricePath,predictionMarketGuidePoints,predictionMarketWindowDuration,type PredictionMarketBookTrail} from "../app/lab/lib/predictionMarketDisplay";
import type {MarketEdgeDto,OddsTrailStopDto} from "../app/lab/lib/labTypes";

const now=Date.parse("2026-10-29T00:00:00Z"),hour=3600_000;
const stop=(american:number,at:number,source:OddsTrailStopDto["source"]="line_history",sportsbook="circa",line:number|null=-2):OddsTrailStopDto=>({american,observedAt:new Date(at).toISOString(),source,sportsbook,line,label:source==="provider_opening"?"open":"first"});
const book:PredictionMarketBookTrail={sportsbook:"circa",locked:true,points:[[now-8*hour,110/210,-110],[now-hour,105/205,-105]]};
const market={pick:"ATL -2",line:-2,priceAmerican:-107,oddsTrail:[
 stop(-110,now-40*hour,"provider_opening"),
 stop(-200,now-45*hour,"provider_opening","pinnacle"),
 stop(-300,now-46*hour,"provider_opening","circa",-3.5),
 stop(-105,now-hour,"locked_snapshot"),
]} as MarketEdgeDto;
const before=JSON.stringify({market,book});
const opening=predictionMarketBookStart(market,"ATL -2",book,-2,now)!;
assert.equal(opening.kind,"provider_opening");assert.equal(opening.point[0],now-40*hour);assert.equal(opening.point[2],-110,"actual matching provider opening survives separately from the rolling plot");
assert.equal(predictionMarketBookPricePath(book.points),"−110 → −105","adding opening context cannot change the original plotted price summary");
assert.equal(JSON.stringify({market,book}),before,"all stored locked fields and original quote arrays are immutable");
const noOpen={...market,oddsTrail:[stop(-115,now-20*hour),...market.oddsTrail!.filter(s=>s.sportsbook!=="circa"||s.line!==-2)]};
const recorded=predictionMarketBookStart(noOpen,"ATL -2",book,-2,now)!;
assert.equal(recorded.kind,"first_recorded");assert.equal(recorded.point[2],-115,"first tracked quote is not called a provider opener");
const misleading={...market,oddsTrail:[{...stop(-110,now-12*hour),label:"open" as const}]};
assert.equal(predictionMarketBookStart(misleading,"ATL -2",book,-2,now)?.kind,"first_recorded","label alone is not proof of provider-opening provenance");
const late={...market,oddsTrail:[stop(-140,now+hour,"provider_opening")]};
assert.equal(predictionMarketBookStart(late,"ATL -2",book,-2,now)?.kind,"first_recorded","future/post-lock open cannot replace pre-lock context");
const unknown={...market,oddsTrail:[{...stop(-140,now-40*hour,"provider_opening"),observedAt:null}]};
assert.equal(predictionMarketBookStart(unknown,"ATL -2",book,-2,now)?.kind,"first_recorded","an unprovable opening time is not promoted");
const opposing={...market,opposingOddsTrail:{label:"MIA +2",side:"away",stops:[stop(-120,now-30*hour,"provider_opening","circa",2)]}} as MarketEdgeDto;
assert.equal(predictionMarketBookStart(opposing,"MIA +2",{...book,line:2},-2,now)?.point[2],-120,"opposing side uses only its own exact book/line opening");
assert.equal(predictionMarketBookStart({...market,oddsTrail:[]},"ATL -2",{...book,points:[]},-2,now),null);
const row={asOf:new Date(now).toISOString(),history:[[now-6*hour,.51,100],[now,.5,110]] as Array<[number,number,number|null]>};
const compared=predictionMarketComparison(row,book,now);
assert.equal(compared.start,now-6*hour,"opening metadata does not stretch/compress the polished shared chart");
const guides=[predictionMarketGuidePoints(compared.points,compared.start,compared.cutoff!),predictionMarketGuidePoints(compared.bookPoints,compared.start,compared.cutoff!)];
assert.equal(guides[0][0][0],guides[1][0][0]);assert.equal(guides[0].at(-1)![0],guides[1].at(-1)![0]);
assert.equal(predictionMarketWindowDuration(now-400*60_000,now),"6h 40m");
assert.equal(predictionMarketWindowDuration(now-26*hour,now),"1d 2h");assert.equal(predictionMarketWindowDuration(now,now),"single quote");
const component=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8");
assert.match(component,/Kalshi /);assert.match(component,/opening quote unavailable/);
assert.match(component,/Provider open/);assert.match(component,/First recorded/);assert.match(component,/time\(bookStart.point\[0\],true\)/);
assert.match(component,/Shared chart window/);assert.match(component,/pp · chart window/);
assert.doesNotMatch(component,/strokeDasharray|data-kalshi-gaps/);
console.log("PASS: provider opening vs first-recorded provenance; exact same book/side/line; dated source starts; explicit shared window; no future/post-lock leakage or locked-field mutation");
