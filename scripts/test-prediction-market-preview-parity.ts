import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {predictionMarketGuidePoints,predictionMarketComparison,predictionMarketCurve,predictionMarketLockBoundary,predictionMarketObservationAt,predictionMarketComparisonBook,type PredictionMarketBookTrail} from "../app/lab/lib/predictionMarketDisplay";
import {boundPredictionMarketHistory,mergePredictionMarketFeeds,type PredictionMarketFeed,type PredictionMarketPoint} from "../lib/providers/owls/owlsPredictionMarkets";
import {backfillKalshiDisplayHistory,parseKalshiDisplayCandles,KALSHI_DISPLAY_HISTORY_RELEASE} from "../lib/providers/owls/kalshiDisplayHistory";

const minute=60_000,now=Date.parse("2026-10-28T23:30:00Z"),lock=now-90*minute;
const row={asOf:new Date(now).toISOString(),history:[[now-240*minute,.5,100],[now-120*minute,.51,110],[now-95*minute,.505,120],[now,.9,150]] as Array<[number,number,number|null]>};
const book:PredictionMarketBookTrail={sportsbook:"circa",locked:true,points:[[now-250*minute,110/210,-110],[now-200*minute,105/205,-105],[now-100*minute,110/210,-110]]};
const before=JSON.stringify({row,book});
const game={lockState:"locked" as const,lockedAt:new Date(lock).toISOString(),gameStartAt:new Date(now-30*minute).toISOString()};
const boundary=predictionMarketLockBoundary(game,now);
assert.equal(boundary,lock);
const comparison=predictionMarketComparison(row,book,boundary);
assert.equal(comparison.start,now-240*minute);assert.equal(comparison.cutoff,now-100*minute);
const guides=[predictionMarketGuidePoints(comparison.points,comparison.start,comparison.cutoff!),predictionMarketGuidePoints(comparison.bookPoints,comparison.start,comparison.cutoff!)];
for(const guide of guides){
 assert.equal(guide[0][0],comparison.start,"identical start positions on one time axis");assert.equal(guide.at(-1)![0],comparison.cutoff,"identical end positions, not a faster-source tail");
 const curve=predictionMarketCurve(guide,Number,Number,Infinity,1);
 assert.equal((curve.line.match(/M/g)??[]).length,1,"one continuous path, not dotted fragments");assert.match(curve.line,/ C/);assert.doesNotMatch(curve.line,/[HV]/);
}
assert.equal(predictionMarketObservationAt(comparison.bookPoints,comparison.start)?.[0],now-250*minute,"boundary guide does not restamp the original book quote");
assert.deepEqual(predictionMarketGuidePoints([[now,.8]],now-minute,now),[[now,.8]],"no price exists before the first receipt");
assert.equal(JSON.stringify({row,book}),before,"display geometry is read-only");
const after={...row,asOf:new Date(now+minute).toISOString(),history:[...row.history,[now+minute,.1,200] as [number,number,number|null]]};
assert.deepEqual(predictionMarketComparison(after,book,boundary).points,comparison.points,"post-lock Kalshi quotes cannot advance the chart or headline");
assert.strictEqual(predictionMarketComparisonBook(true,book,{...book,locked:false,points:[[now,.9,-900]]}),book,"stored locked book always takes precedence over live context");
assert.equal(predictionMarketComparisonBook(true,null,book),null,"absent locked book evidence cannot be replaced with live context");
assert.equal(predictionMarketLockBoundary({...game,lockedAt:null},now),Date.parse(game.gameStartAt),"a started game is bounded even if the lock timestamp was never stored");
assert.ok(Number.isNaN(predictionMarketLockBoundary({...game,lockedAt:null,gameStartAt:null},now)),"unproven locked timestamp fails closed");
assert.equal(predictionMarketComparison(row,book,NaN).points.length,0);
assert.equal(predictionMarketLockBoundary({lockState:"open",lockedAt:null,gameStartAt:new Date(now+minute).toISOString()},now),undefined);

const points=Array.from({length:289},(_,i)=>[now-24*60*minute+i*5*minute,.5+i/1000,null] as PredictionMarketPoint);
const bounded=boundPredictionMarketHistory(points,96);
assert.ok(bounded.length<=96);assert.deepEqual(bounded[0],points[0]);assert.deepEqual(bounded.at(-1),points.at(-1));
assert.ok(bounded.every(p=>points.includes(p)),"bounded history selects actual observations only");
const adjacent=boundPredictionMarketHistory(points.slice(1),96),common=new Set(adjacent.map(p=>p[0]));
assert.ok(bounded.filter(p=>common.has(p[0])).length>=70,"adjacent contracts retain genuine simultaneous candles despite a different starting receipt");
// A synthetic transport fixture is sufficient: no provider/database writes.
const fixture={release:"owls_kalshi_display_2026_10_28_r1",sport:"nba",fetchedAt:new Date(now).toISOString(),rows:[{ticker:"KXNBAGAME-26OCT28MIAATL-ATL",eventTicker:"KXNBAGAME-26OCT28MIAATL",sideCode:"ATL",team:"Atlanta",gameDate:"2026-10-28",bid:.5,ask:.51,probability:.505,volume24h:100,totalVolume:1000,asOf:new Date(now).toISOString(),history:[[now,.505,1000]],historicalCandles:points,historicalCheckedAt:new Date(now-2*60*minute).toISOString()}]} as PredictionMarketFeed;
const merged=mergePredictionMarketFeeds(fixture,{...fixture,rows:fixture.rows.map(r=>({...r,history:[[now,.505,1000]],historicalCandles:undefined}))},now);
assert.equal(merged.rows[0].historicalCandles?.[0][0],points[0][0],"refresh retains genuine earlier history instead of rolling the chart's start forward at eight hours");
assert.ok(merged.rows[0].historicalCandles!.length<=96);

async function capture(){
 const candles={market_ticker:fixture.rows[0].ticker,candlesticks:[{end_period_ts:(now-12*60*minute)/1000,yes_bid:{close_dollars:"0.50"},yes_ask:{close_dollars:"0.52"},volume_fp:"1"}]};
 assert.equal(parseKalshiDisplayCandles(candles,fixture.rows[0].ticker,now)[0][0],now-12*60*minute,"the morning history is eligible even in the evening");
 let calls=0;
 const many={...fixture,rows:Array.from({length:60},(_,i)=>({...fixture.rows[0],ticker:fixture.rows[0].ticker+String(i)}))};
 const saved=await backfillKalshiDisplayHistory(many,now,async input=>{
  calls++;const url=new URL(String(input)),n=url.searchParams.get("market_tickers")!.split(",").length;
  assert.ok(n<=6);assert.equal(Number(url.searchParams.get("end_ts"))-Number(url.searchParams.get("start_ts")),86400);assert.ok(n*1440<10_000);
  return Response.json({markets:url.searchParams.get("market_tickers")!.split(",").map(ticker=>({market_ticker:ticker,candlesticks:[]}))});
 });
 assert.equal(calls,3,"no increase over the existing three-call public-history budget");
 assert.equal(saved.rows.filter(r=>r.historicalRelease===KALSHI_DISPLAY_HISTORY_RELEASE).length,18);
 let nextCalls=0;
 await backfillKalshiDisplayHistory(saved,now+5*minute,async input=>{nextCalls++;const tickers=new URL(String(input)).searchParams.get("market_tickers")!.split(",");assert.ok(!tickers.some(t=>saved.rows.slice(0,18).some(r=>r.ticker===t)),"the next cycle rotates to uncaptured contracts");return Response.json({markets:tickers.map(ticker=>({market_ticker:ticker,candlesticks:[]}))})});
 assert.equal(nextCalls,3);
}
const component=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8");
assert.doesNotMatch(component,/strokeDasharray|data-book-turning-price|data-quote-gap-key/);
assert.match(component,/data-chart-treatment="shared-continuous-guides"/);
assert.match(component,/predictionMarketComparison\(outcome,book,lockedAt\)/);
assert.match(component,/!frozen&&outcome.volume24h/ ,"post-lock current rolling volume cannot masquerade as locked context");
void capture().then(()=>console.log("PASS preview parity: aligned continuous guides, real-only quote inspection, 24h bounded history, unchanged three-call budget, immutable locked-book precedence and no post-lock chart advancement"));
