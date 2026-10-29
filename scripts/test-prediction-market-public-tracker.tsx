import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {publicMarketDisplayBook,publicMarketDisplayHistory,publicMarketDisplayStops} from "../app/lab/lib/publicMarketDisplayTrail";
import {PredictionMarketSourcePins} from "../app/lab/lib/predictionMarketSourcePins";
import {predictionMarketComparison,predictionMarketBookOnlyComparison,type PredictionMarketBookTrail} from "../app/lab/lib/predictionMarketDisplay";
import {PredictionMarketChart} from "../app/lab/components/daily-edge/PredictionMarketPanel";
import type {MarketEdgeDto,OddsTrailStopDto} from "../app/lab/lib/labTypes";

const now=Date.parse("2026-10-29T15:00:00Z"),m=60_000;
const stop=(price:number,line:number|null,minutes:number,label:OddsTrailStopDto["label"],book="betmgm"):OddsTrailStopDto=>({american:price,line,observedAt:new Date(now-minutes*m).toISOString(),label,sportsbook:book,source:"line_history"});
const market={pick:"ATL -1.5",line:-1.5,priceAmerican:-102,currentPriceAmerican:-102,currentPriceSportsbook:"betmgm",oddsTrail:[stop(-105,-1.5,195,"first"),stop(-102,-1.5,110,"move"),stop(-102,-1.5,20,"current")]} as MarketEdgeDto;
const original=JSON.stringify(market),book=publicMarketDisplayBook(market)!;
assert.equal(book.sportsbook,"betmgm");assert.equal(book.line,-1.5);assert.deepEqual(book.points.map(p=>p[2]),[-105,-102,-102]);
assert.equal(book.points[0][0],now-195*m);assert.equal(book.points.at(-1)![0],now-20*m);
const circa:PredictionMarketBookTrail={sportsbook:"circa",line:0,locked:false,points:[[now-200*m,110/210,-110],[now,110/210,-110]]};
assert.strictEqual(publicMarketDisplayHistory(book,circa),book,"a fresh Circa PK cannot replace the public BetMGM -1.5 tracker");
assert.strictEqual(publicMarketDisplayHistory(book,{...circa,sportsbook:"betmgm"}),book,"same-book other-handicap history also cannot be mixed in");
const live:PredictionMarketBookTrail={sportsbook:"betmgm",line:-1.5,locked:false,points:[[now-300*m,120/220,-120],[now-190*m,104/204,-104],[now-20*m,200/300,-200],[now,110/210,-110]]};
const enriched=publicMarketDisplayHistory(book,live)!;
assert.equal(enriched.points[0][0],now-300*m,"verified earlier same-book/current-threshold observations are recovered rather than clipped to our first local poll");
assert.deepEqual(enriched.points.at(-1),book.points.at(-1),"stored public terminal time/price wins over newer or conflicting external quotes");
assert.deepEqual(enriched.points.map(p=>p[2]),[-120,-105,-104,-102,-102]);
const kalshi={asOf:new Date(now).toISOString(),history:[[now-68*m,.485,1],[now,.48,2]] as Array<[number,number,number|null]>};
const shared=predictionMarketComparison(kalshi,book);
assert.equal(shared.start,now-68*m);assert.ok(shared.bookPoints.filter(p=>p[0]>=shared.start).every(p=>p[2]===-102),"the recent shared window really is flat: matching books alone cannot show a move before Kalshi opened");
const full=predictionMarketBookOnlyComparison(book);
assert.equal(full.start,now-195*m);assert.deepEqual(full.bookPoints.map(p=>p[2]),[-105,-102,-102]);
const html=renderToStaticMarkup(<PredictionMarketChart row={null} book={book} context={undefined} bookLabel="ATL -1.5"/>);
assert.match(html,/data-sportsbook-line="betmgm"/);assert.doesNotMatch(html,/data-sportsbook-line="circa"|NaN|Infinity/);
const path=html.match(/data-sportsbook-line="betmgm" d="([^"]+)"/)![1];
assert.ok(new Set(path.match(/[-\d.]+/g)).size>3,"the actual full sportsbook graph contains the recorded price change");
const total={...market,pick:"Over 237.5",line:237.5,currentPriceSportsbook:"fanatics",oddsTrail:[stop(-110,237.5,195,"first","fanatics"),stop(-110,238,100,"move","fanatics"),stop(-110,237.5,20,"current","fanatics")]};
const t=publicMarketDisplayBook(total)!;assert.deepEqual(t.points.map(p=>p[2]),[-110,-110]);assert.deepEqual(t.marketHistory?.map(p=>p[2]),[237.5,238,237.5],"a round-trip line move is preserved separately from unchanged American price");
const separateLine={...total,oddsTrail:[total.oddsTrail[0],total.oddsTrail[2]],lineTrail:total.oddsTrail};
assert.deepEqual(publicMarketDisplayBook(separateLine)?.marketHistory?.map(p=>p[2]),[237.5,238,237.5],"the complete same-book public number tracker is preserved even when its price trail is intentionally current-threshold only");
const other={...market,oddsTrail:[stop(-120,0,200,"first","circa"),stop(-110,0,90,"move","circa"),...market.oddsTrail!]};
assert.equal(publicMarketDisplayBook(other)?.sportsbook,"betmgm","a historical-only sharp-book group cannot masquerade as the public current source");
const tied={...market,oddsTrail:[...market.oddsTrail!,...market.oddsTrail!.map(s=>({...s,sportsbook:"draftkings"}))]};
assert.equal(publicMarketDisplayBook(tied)?.sportsbook,"betmgm","equal-depth groups preserve the incumbent tracker tie-break");
const currentOnly={...market,oddsTrail:[stop(-102,-1.5,20,"current")]};
const roundTrip={...market,pick:"NO ML",line:null,oddsTrail:[stop(-220,null,195,"first"),stop(-205,null,110,"move"),stop(-220,null,20,"current")]};
const roundTripBook=publicMarketDisplayBook(roundTrip)!;
assert.equal(roundTripBook.points[0][2],roundTripBook.points.at(-1)![2]);
assert.deepEqual(roundTripBook.points.map(p=>p[2]),[-220,-205,-220],"flat opening-to-current summary must not erase a real intermediate bump");
assert.equal(publicMarketDisplayBook(currentOnly)?.points.length,1,"no manufactured opener for a current-only tracker");
const locked={...book,locked:true};assert.strictEqual(publicMarketDisplayHistory(locked,live),locked);
assert.equal(publicMarketDisplayHistory(null,live),null,"missing stored evidence is not reconstructed");
const pins=new PredictionMarketSourcePins();pins.accept("/api/lab/prediction-market?sport=nba&market=spread",circa,now);
const request="/api/lab/prediction-market?sport=nba&market=spread&book=betmgm&display=public-tracker-v1";
assert.equal(pins.request(request),request,"an old session's Circa preference cannot override the public tracker binding");
assert.equal(JSON.stringify(market),original);
const ui=readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx","utf8"),panel=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8"),route=readFileSync("app/api/lab/prediction-market/route.ts","utf8");
assert.match(ui,/publicMarketDisplayStops\(market,displayedPrice,displayedBook\)/);assert.match(panel,/book=frozen\?legacyBook/);
assert.match(panel,/useState<"movement"\|"comparison">\("comparison"\)/,"owner-selected default keeps both source curves on the common overlap");
assert.match(panel,/Full movement/ ,"the actual earlier sportsbook move remains reachable without inventing earlier Kalshi quotes");
assert.ok(route.indexOf("if(game&&side&&predictionMarketLockBoundary")<route.indexOf('query.get("display")'),"legacy pre-lock archive precedence is evaluated before the new display binding");
// Selection is the exact pre-extraction algorithm, including legacy locked
// labels, ties, unknown-book groups and current-only fallback semantics.
for(const sample of[market,total,other,tied,currentOnly,{...market,oddsTrail:market.oddsTrail!.map(s=>({...s,label:s.label==="current"?"locked" as const:s.label}))}]){
 const raw=(sample.oddsTrail??[]).filter(s=>Number.isFinite(s.american));const groups=new Map<string,OddsTrailStopDto[]>();
 for(const s of raw){if(!s.sportsbook||["recommendation_snapshot","locked_snapshot"].includes(s.sportsbook))continue;const g=groups.get(s.sportsbook)??[];g.push(s);groups.set(s.sportsbook,g);}
 const legacy=[...groups.values()].filter(g=>g.length>=2&&g.some(s=>s.label==="current"||s.label==="locked")).sort((a,b)=>b.length-a.length)[0];
 assert.deepEqual(publicMarketDisplayStops(sample,sample.currentPriceAmerican??null,sample.currentPriceSportsbook??null).coherent,legacy);
}
console.log("PASS public tracker binding: exact shared source/side/handicap/observation bounds; Hawks pre-Kalshi move preserved; no Circa PK substitution; same-book enrichment only; source-pin migration; line/price isolation; locked precedence and unchanged tracker-selection semantics.");
