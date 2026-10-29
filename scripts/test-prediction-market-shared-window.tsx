import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {PredictionMarketChart,BookLineHistory} from "../app/lab/components/daily-edge/PredictionMarketPanel";
import {predictionMarketComparison,predictionMarketGuidePoints,predictionMarketWindowPoints,predictionMarketBookPricePath,predictionMarketBookStart,predictionMarketObservationAt,type PredictionMarketBookTrail} from "../app/lab/lib/predictionMarketDisplay";
import type {ReaderOutcome} from "../lib/providers/owls/predictionMarketContracts";
import type {MarketEdgeDto} from "../app/lab/lib/labTypes";

const now=Date.parse("2026-10-29T14:00:00Z"),h=3600_000;
const row={ticker:"fixture",team:"ATL",label:"ATL",asOf:new Date(now).toISOString(),probability:.5,bid:.49,ask:.51,volume24h:1,totalVolume:1,historyFrom:new Date(now-72*h).toISOString(),openingQuote:{kind:"first_available",point:[now-72*h,.55,1]},historicalCandles:[[now-72*h,.55,1],[now-24*h,.49,1]],history:[[now-12*h,.5,1],[now-3*h,.51,1],[now,.5,1]]} as ReaderOutcome;
const book:PredictionMarketBookTrail={sportsbook:"circa",line:null,locked:false,historyScope:"provider_history",opening:{point:[now-10*h,110/210,-110],line:null},points:[[now-10*h,110/210,-110],[now-8*h,105/205,-105],[now-4*h,110/210,-110],[now-h,115/215,-115]]};
const original=JSON.stringify({row,book});

function check(r:ReaderOutcome,b:PredictionMarketBookTrail,lock?:number){
 const c=predictionMarketComparison(r,b,lock);assert.ok(c.cutoff!==null);
 const first=c.start,last=c.cutoff!;
 for(const start of[first,Math.max(first,last-24*h)]){
  const guides=[predictionMarketGuidePoints(c.points,start,last),predictionMarketGuidePoints(c.bookPoints,start,last)];
  for(const guide of guides){assert.equal(guide[0][0],start);assert.equal(guide.at(-1)![0],last);}
 }
 const html=renderToStaticMarkup(<PredictionMarketChart row={r} book={b} context={undefined} bookLabel="moneyline" lockedAt={lock}/>);
 const mint=html.match(/data-kalshi-line="[^"]*" d="([^"]+)"/)?.[1],violet=html.match(/data-sportsbook-line="circa" d="([^"]+)"/)?.[1];
 assert.ok(mint&&violet,"both actual rendered SVG paths exist");
 const coordinates=(path:string)=>path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
 for(const path of[mint,violet]){const n=coordinates(path);assert.equal(n[0],36,"both SVG traces begin at exactly the same left pixel");assert.equal(n.at(-2),260,"both SVG traces end at exactly the same right pixel");assert.ok(n.every(Number.isFinite));}
 assert.match(html,/Shared chart window/);assert.doesNotMatch(html,/Source history/);
 return c;
}
const c=check(row,book);
assert.equal(c.start,now-10*h);assert.equal(c.cutoff,now-h);
assert.equal(predictionMarketObservationAt(c.points,c.start)?.[0],now-12*h,"left guide holds a real earlier quote; it does not restamp the receipt");
assert.equal(row.openingQuote?.point[0],now-72*h,"earlier Kalshi opening retained outside comparison window");
assert.equal(predictionMarketBookStart({pick:"ATL ML"} as MarketEdgeDto,"ATL",book,null,now)?.point[0],now-10*h);
check({...row,openingQuote:undefined,historicalCandles:[],history:[[now-6*h,.51,1],[now-2*h,.5,2]]},book);
check(row,{...book,points:[...book.points,[now,120/220,-120]]});
check(row,{...book,locked:true,historyScope:"prelock_archive"},now-2*h);

// The price summary must use exactly the same chosen window as the graph,
// not an older provider move that is now outside the shared comparison.
const longBook={...book,opening:{point:[now-80*h,160/260,-160] as [number,number,number],line:null},points:[[now-80*h,160/260,-160] as [number,number,number],...book.points]};
const shortRow={...row,openingQuote:undefined,historicalCandles:[],history:[[now-6*h,.5,1],[now,.51,2]] as ReaderOutcome["history"]};
const short=predictionMarketComparison(shortRow,longBook),visible=predictionMarketWindowPoints(short.bookPoints,short.start);
assert.equal(short.start,now-6*h);assert.equal(visible[0][0],now-8*h);
assert.equal(predictionMarketBookPricePath(visible),"−105 → −110 → −115");
const actualBook:[[number,number,number],[number,number,number],[number,number,number],[number,number,number]]=[[0,110/210,-110],[1,113/213,-113],[2,110/210,-110],[3,109/209,-109]];
assert.equal(predictionMarketBookPricePath(actualBook,4),"−110 → −113 → −110 → −109","the real four-price round trip remains visible instead of hiding the middle moves");
assert.equal(predictionMarketBookPricePath(actualBook),"−110 → −109","legacy locked summary keeps its existing compact behavior");
assert.equal(predictionMarketBookPricePath([...actualBook,[4,108/208,-108]],4),"−110 → … → −108","long in-view summaries explicitly mark omitted intermediate moves");
assert.equal(longBook.opening.point[2],-160,"actual older opener still shown separately, never relabeled as chart start");
const pointBook={...book,line:47,marketHistory:[[now-40*h,-110,48],[now-12*h,-110,47],[now-4*h,-110,46.5],[now-h,-110,47],[now,-110,49]] as [number,number,number|null][]};
const small=renderToStaticMarkup(<BookLineHistory book={pointBook} kind="total" start={now-10*h} end={now-h}/>);
assert.match(small,/47 → 47/);assert.doesNotMatch(small,/>Total line (?:48|49)/);
assert.equal(JSON.stringify({row,book}),original,"alignment never mutates source values or timestamps");
const component=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8");
assert.match(component,/predictionMarketBookPricePath\(windowBook.points,/);
assert.match(component,/start=\{chartStart\} end=\{comparison.cutoff\?\?undefined\}/);
assert.match(component,/Full window/);assert.match(component,/Original source openings are listed separately/);
console.log("PASS shared window: both rendered SVG paths have identical time/pixel starts and ends, symmetric current/lock cutoff, exact quotes and openings retained, matching in-view sportsbook summary and point-line sparkline.");
