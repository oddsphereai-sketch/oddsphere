import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {PredictionMarketUnavailable,PredictionMarketChart} from "../app/lab/components/daily-edge/PredictionMarketPanel";
import {predictionMarketBookOnlyComparison,predictionMarketComparison,predictionMarketHasSharedHistory,type PredictionMarketBookTrail} from "../app/lab/lib/predictionMarketDisplay";
import type {ReaderOutcome} from "../lib/providers/owls/predictionMarketContracts";

const now=Date.parse("2026-10-29T14:00:00Z"),m=60_000;
const book:PredictionMarketBookTrail={sportsbook:"pinnacle",line:237.5,locked:false,points:[[now-600*m,110/210,-110],[now-200*m,105/205,-105],[now-60*m,110/210,-110]],historyScope:"provider_history",opening:{point:[now-600*m,110/210,-110],line:237.5}};
const cold:ReaderOutcome={ticker:"KXNBATOTAL-26OCT29CLEATL-238",eventTicker:"KXNBATOTAL-26OCT29CLEATL",sideCode:"YES",gameDate:"2026-10-29",team:"Under 237.5",label:"Under 237.5",bid:.50,ask:.51,volume24h:null,totalVolume:null,asOf:new Date(now).toISOString(),probability:.505,history:[[now-10*m,.505,0]],historicalCandles:[],historyFrom:new Date(now-11*m).toISOString()};
const before=JSON.stringify({book,cold});
assert.equal(predictionMarketHasSharedHistory(predictionMarketComparison(cold,book)),false,"new Kalshi quote later than the last book quote cannot form a comparison");
const standalone=predictionMarketBookOnlyComparison(book);
assert.equal(standalone.bookPoints.length,3);assert.equal(standalone.start,now-600*m);assert.equal(standalone.cutoff,now-60*m);assert.deepEqual(standalone.points,[],"no invented Kalshi history");
for(const kind of["total","spread","moneyline","btts"]){
 const html=renderToStaticMarkup(<PredictionMarketUnavailable variant="desktop" label={kind==="total"?"Under 238":kind==="spread"?"ATL -1.5":kind==="btts"?"BTTS Yes":"ATL ML"} kind={kind} status="history_building" book={book} quote={{label:cold.label,probability:.505,at:now-10*m}}/>);
 assert.match(html,/data-chart-mode="sportsbook-only"/);assert.match(html,/data-sportsbook-line="pinnacle" d="M[^\"]+ C/);
 assert.doesNotMatch(html,/data-kalshi-line|data-kalshi-end/);assert.match(html,/Current quote/);assert.match(html,/history is building/);
 assert.match(html,/Sportsbook history/);assert.doesNotMatch(html,/NaN|Infinity/);
 if(kind==="total")assert.match(html,/Pinnacle Under 237.5/ ,"actual book threshold remains distinct from the selected 238 line");
}
const absent=renderToStaticMarkup(<PredictionMarketUnavailable variant="mobile" label="ATL -1.5" kind="spread" status="contract_unavailable" book={book}/>);
const derived=renderToStaticMarkup(<PredictionMarketUnavailable variant="desktop" label="Under 238" status="history_building" book={book} quote={{label:"Under 238",probability:.5,at:now,method:"push_adjusted"}}/>);
assert.match(derived,/Current derived estimate/);assert.doesNotMatch(derived,/Current quote/ ,"push-adjusted estimates are never relabeled as directly traded quotes");
assert.match(absent,/No matching Kalshi contract/);assert.match(absent,/data-sportsbook-line/);assert.doesNotMatch(absent,/data-kalshi-current-quote|data-kalshi-line/);
const one=renderToStaticMarkup(<PredictionMarketUnavailable variant="desktop" label="Under 237.5" status="history_building" book={{...book,points:[book.points[0]]}}/>);
assert.match(one,/one quote recorded/);assert.match(one,/data-sportsbook-end/);assert.doesNotMatch(one,/data-kalshi-line|NaN|Infinity/);
const missing=renderToStaticMarkup(<PredictionMarketUnavailable variant="desktop" label="Under 237.5" status="history_building" book={null}/>);
assert.doesNotMatch(missing,/<svg/ ,"no fake graph if neither source has history");
assert.equal(predictionMarketBookOnlyComparison(book,now-300*m).bookPoints.length,1);
assert.deepEqual(predictionMarketBookOnlyComparison(book,NaN).bookPoints,[]);
const frozen=renderToStaticMarkup(<PredictionMarketUnavailable variant="desktop" label="Under 237.5" status="history_building" book={book} lockedAt={now-300*m} quote={{label:"POST LOCK QUOTE",probability:.9,at:now}}/>);
assert.doesNotMatch(frozen,/POST LOCK QUOTE/);assert.match(frozen,/data-book-odds="-110"/);assert.doesNotMatch(frozen,/data-book-odds="-105"/);
// A normal subsequent scheduled refresh automatically restores the existing
// aligned two-source component as soon as its real window has enough history.
const warm={...cold,history:[[now-10*m,.505,0],[now-5*m,.495,0],[now,.5,0]] as ReaderOutcome["history"]};
const warmBook={...book,points:[...book.points,[now-8*m,109/209,-109],[now,110/210,-110]] as PredictionMarketBookTrail["points"]};
assert.equal(predictionMarketHasSharedHistory(predictionMarketComparison(warm,warmBook)),true);
const both=renderToStaticMarkup(<PredictionMarketChart row={warm} book={warmBook} context={undefined} bookLabel="Under 237.5"/>);
assert.match(both,/data-chart-mode="comparison"/);assert.match(both,/data-kalshi-line/);assert.match(both,/data-sportsbook-line/);
assert.equal(JSON.stringify({book,cold}),before,"source/locked evidence is never mutated by the fallback");
const component=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8");
assert.match(component,/fallbackBook&&!sharedHistory&&!standaloneHistory/,
  "cold-market fallback remains outside the explicitly eligible CBB/CFB real-history scope");
assert.match(component,/frozen&&!current\?\.prelockCapturedAt&&!historicalCfb\?null:book/ ,"legacy lock unavailable semantics remain unchanged outside owner-approved CFB historical recovery");
assert.match(component,/predictionMarketArchivedBook\(storedBook,current.book/ ,"future archive cannot bypass stored book/line/quote precedence");
console.log("PASS cold-market charts: real sportsbook trace for new/missing Kalshi markets, no fabricated second source, exact market/side/line labels, genuine single-quote state, automatic return to aligned comparison, and immutable pre-lock boundaries.");
