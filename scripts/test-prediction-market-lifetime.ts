import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {bookDisplayTrail,captureOwlsBookDisplayHistory,parseOwlsBookDisplayHistory,matchOwlsDisplayEvent,owlsDisplayProviderSide} from "../lib/providers/owls/owlsBookDisplayHistory";
import {OwlsInsightClient} from "../lib/providers/owls/owlsInsightClient";
import {backfillKalshiDisplayHistory} from "../lib/providers/owls/kalshiDisplayHistory";
import {isPredictionMarketFeed,mergePredictionMarketFeeds,type PredictionMarketFeed} from "../lib/providers/owls/owlsPredictionMarkets";
import {predictionMarketComparison,predictionMarketBookStart,predictionMarketGuidePoints,predictionMarketComparisonBook} from "../app/lab/lib/predictionMarketDisplay";
import type {DailyEdgeGameDto} from "../app/lab/lib/labTypes";

const now=Date.parse("2026-10-29T12:00:00Z"),hour=3600_000,iso=(at:number)=>new Date(at).toISOString();
const game={id:"nba-401909893",external_id:401909893,sport:"nba",awayTeam:"CLE",homeTeam:"ATL",gameStartAt:iso(now+12*hour),lockState:"open",markets:{moneyline:{pick:"ATL ML",line:null},total:{pick:"Over 238",line:238},first_inning:{pick:"ATL -1",line:-1}}} as DailyEdgeGameDto;
const target={event:game.external_id,start:game.gameStartAt!,away:"CLE",home:"ATL",providerEventId:"nba:Cleveland Cavaliers@Atlanta Hawks-20261030",kind:"total",side:"over",book:"circa"};
const body={success:true,data:{eventId:target.providerEventId,book:"circa",market:"totals",side:"over",timeRange:{mode:"opening"},openingLine:{timestampUtc:iso(now-40*hour),price:-110,point:"239.50"},history:[{timestampUtc:iso(now-40*hour),price:-110,point:"239.50"},{timestampUtc:iso(now-hour),price:-105,point:"238.00"},{timestampUtc:iso(now),price:-110,point:"238.00"}]}};
const entry=parseOwlsBookDisplayHistory(body,target,now)!;
assert.equal(entry.opening?.[0],now-40*hour);assert.equal(entry.opening?.[2],239.5);
const trail=bookDisplayTrail(entry,238,now)!;
assert.deepEqual(trail.points.map(p=>p[2]),[-105,-110],"another threshold's opener cannot enter this line's probability curve");
assert.equal(trail.opening?.line,239.5,"original point opener is still available as separately labeled context");
assert.equal(predictionMarketBookStart(game.markets.total,"Over 238",trail,238,now)?.kind,"first_recorded");
const exact=bookDisplayTrail({...entry,opening:[now-40*hour,-110,238],quotes:[[now-40*hour,-110,238],...entry.quotes]},238,now)!;
assert.equal(predictionMarketBookStart(game.markets.total,"Over 238",exact,238,now)?.kind,"provider_opening");
assert.equal(bookDisplayTrail(entry,237.5),null);
for(const change of [{book:"pinnacle"},{market:"h2h"},{side:"under"},{eventId:"another-game"},{timeRange:{mode:"recent"}}])assert.equal(parseOwlsBookDisplayHistory({...body,data:{...body.data,...change}},target,now),null);
assert.equal(parseOwlsBookDisplayHistory({...body,data:{...body.data,openingLine:{price:-110,timestampUtc:iso(now+hour),point:238}}},target,now)?.opening,null,"future open rejected");
assert.equal(parseOwlsBookDisplayHistory({...body,data:{...body.data,openingLine:{price:-110,timestamp:iso(now-hour),point:238}}},target,now)?.opening,null,"unknown UTC clock cannot be called a verified opener");

const event={eventId:target.providerEventId,away_team:"Cleveland Cavaliers",home_team:"Atlanta Hawks",commence_time:iso(now+12*hour+10*60_000),bookmakers:[{key:"circa",last_update:iso(now),markets:[{key:"h2h"},{key:"spreads"},{key:"totals"}]}]};
assert.equal(matchOwlsDisplayEvent([event],game,"nba"),event);
assert.equal(matchOwlsDisplayEvent([event,event],game,"nba"),null,"ambiguous event identity rejected");
assert.equal(matchOwlsDisplayEvent([{...event,commence_time:iso(now+36*hour)}],game,"nba"),null,"wrong date rejected");
assert.equal(matchOwlsDisplayEvent([{...event,home_team:"Cleveland Cavaliers",away_team:"Atlanta Hawks"}],game,"nba"),null,"orientation cannot flip");
const nfl={...game,sport:"nfl",awayTeam:"BUF",homeTeam:"KC"} as DailyEdgeGameDto;
assert.ok(matchOwlsDisplayEvent([{...event,eventId:"nfl:Buffalo Bills@Kansas City Chiefs-20261030",away_team:"Buffalo Bills",home_team:"Kansas City Chiefs"}],nfl,"nfl"),"full NFL names map to the existing authoritative team aliases");
const cbb={...game,id:"cbb-10882407",external_id:10882407,sport:"cbb",awayTeam:"ND",homeTeam:"VILL",awayTeamDisplayName:"Notre Dame Fighting Irish",homeTeamDisplayName:"Villanova Wildcats",cbbAwayCollege:"Notre Dame",cbbHomeCollege:"Villanova"} as DailyEdgeGameDto;
const reversedCbb={...event,eventId:"ncaab:Villanova@Notre Dame-20261029",away_team:"Villanova",home_team:"Notre Dame"};
assert.equal(matchOwlsDisplayEvent([reversedCbb],cbb,"cbb"),reversedCbb,"neutral-site CBB source orientation must not drop verified market history");
assert.equal(owlsDisplayProviderSide(reversedCbb,cbb,"home","cbb"),"away","canonical home maps to provider away");
assert.equal(owlsDisplayProviderSide(reversedCbb,cbb,"away","cbb"),"home","canonical away maps to provider home");
assert.equal(owlsDisplayProviderSide(reversedCbb,cbb,"over","cbb"),"over","totals retain their side");

async function run(){
 let calls=0;
 const client=new OwlsInsightClient("fixture-only",{fetchImpl:async(input)=>{calls++;const url=new URL(String(input));
  if(url.pathname.endsWith("/odds"))return Response.json({success:true,data:{circa:[event]}});
  assert.equal(url.pathname,"/api/odds/history");assert.equal(url.searchParams.has("hours"),false);assert.equal(url.searchParams.has("startTime"),false);
  return Response.json(body);
 }});
 const before=JSON.stringify(game),captured=await captureOwlsBookDisplayHistory(null,[game],"nba",client,now);
 assert.equal(calls,4,"one discovery plus at most three history requests");assert.equal(captured.requests,4);assert.equal(captured.feed.rows.length,1,"wrong returned market/side cannot be stored under another key");
 assert.equal(JSON.stringify(game),before,"the scheduled display writer cannot mutate the member DTO");
 const noGames=await captureOwlsBookDisplayHistory(captured.feed,[{...game,lockState:"locked"}],"nba",client,now+60_000);
 assert.equal(noGames.requests,0,"locked boards cannot cause new opening fetches or reconstruction");
 const reserved=await captureOwlsBookDisplayHistory(null,[game],"nba",client,now,50_000);
 assert.equal(reserved.requests,0,"optional backfill cannot consume the essential provider reserve");
 const capped=await captureOwlsBookDisplayHistory({...captured.feed,budget:{day:iso(now).slice(0,10),history:48,discovery:12}},[game],"nba",client,now+3*hour);
 assert.equal(capped.requests,0,"persisted daily budgets bound both discovery and backfill even across cron invocations");
 const outage=new OwlsInsightClient("fixture-only",{fetchImpl:async()=>{throw new Error("offline");}});
 const retained=await captureOwlsBookDisplayHistory(captured.feed,[game],"nba",outage,now+2*hour);
 assert.deepEqual(retained.feed.rows[0].opening,captured.feed.rows[0].opening,"outage never deletes retained opener");

 const cbbBoard={...cbb,markets:{moneyline:{pick:"VILL ML",line:null,currentPriceSportsbook:"circa"},
  total:{pick:"Under 148.5",line:148.5,currentPriceSportsbook:"circa"},
  first_inning:{pick:"VILL -7.5",line:-7.5,currentPriceSportsbook:"circa"}}} as DailyEdgeGameDto;
 const cbbRequestedSides:string[]=[];
 const cbbClient=new OwlsInsightClient("fixture-only",{fetchImpl:async(input)=>{const url=new URL(String(input));
  if(url.pathname.endsWith("/odds"))return Response.json({success:true,data:{circa:[reversedCbb]}});
  const market=url.searchParams.get("market")!,side=url.searchParams.get("side")!;cbbRequestedSides.push(`${market}:${side}`);
  return Response.json({success:true,data:{eventId:reversedCbb.eventId,book:"circa",market,side,timeRange:{mode:"opening"},
    openingLine:null,history:[{timestampUtc:iso(now-hour),price:-110,point:market==="h2h"?null:market==="totals"?148.5:-7.5}]}});
 }});
 const cbbCaptured=await captureOwlsBookDisplayHistory(null,[cbbBoard],"cbb",cbbClient,now);
 assert.equal(cbbCaptured.feed.rows.length,3,"CBB requests both sides under the existing three-per-cycle budget");
 assert.ok(cbbRequestedSides.includes("h2h:away")&&cbbRequestedSides.includes("h2h:home"),
  "reversed provider moneyline sides are queried and retained as canonical home/away");
 assert.deepEqual(cbbCaptured.feed.rows.filter(row=>row.kind==="moneyline").map(row=>row.side).sort(),["away","home"]);

 const opened=now-3*24*hour+12_000;
 const row={ticker:"KXNBAGAME-26OCT31CLEATL-ATL",eventTicker:"KXNBAGAME-26OCT31CLEATL",sideCode:"ATL",team:"Atlanta",gameDate:"2026-10-31",bid:.5,ask:.51,probability:.505,volume24h:1,totalVolume:1,asOf:iso(now),marketOpenedAt:iso(opened),history:[[now,.505,1]] as [number,number,number|null][]};
 const feed:PredictionMarketFeed={release:"owls_kalshi_display_2026_10_28_r1",sport:"nba",fetchedAt:iso(now),rows:[row]};
 let publicCalls=0;
 const candle=(at:number,bid:string,ask:string)=>({end_period_ts:at/1000,yes_bid:{close_dollars:bid},yes_ask:{close_dollars:ask},volume_fp:"1"});
 const firstMinute=Math.floor(opened/60_000)*60_000+60_000;
 const full=await backfillKalshiDisplayHistory(feed,now,async input=>{
  publicCalls++;const u=new URL(String(input));assert.equal(Number(u.searchParams.get("start_ts")),Math.floor(opened/1000),"query starts at actual source open, not the last 24h");
  return Response.json({markets:[{market_ticker:row.ticker,candlesticks:[candle(firstMinute,"0.02","1.00"),candle(firstMinute+60_000,"0.48","0.50"),candle(now-hour,"0.50","0.51")]}]});
 });
 assert.equal(publicCalls,1);assert.equal(full.rows[0].historyFrom,row.marketOpenedAt);assert.equal(full.rows[0].openingQuote?.kind,"first_available","a near-empty opening book does not invent a 51% opener");
 assert.equal(full.rows[0].openingQuote?.point[0],firstMinute+60_000);
 assert.ok(isPredictionMarketFeed(full,"nba"));
 const merged=mergePredictionMarketFeeds(full,{...feed,rows:[{...row,asOf:iso(now+25*hour),history:[[now+25*hour,.5,5]]}]},now+25*hour);
 assert.equal(merged.rows[0].openingQuote?.point[0],firstMinute+60_000,"opening survives rolling-window rollover");
 const unchanged=await backfillKalshiDisplayHistory(full,now+2*hour,async()=>{throw new Error("offline");});
 assert.deepEqual(unchanged.rows[0].openingQuote,full.rows[0].openingQuote);
 const cmp=predictionMarketComparison(full.rows[0],exact);
 assert.equal(cmp.start,exact.points[0][0],"comparison starts when both sources have an observed quote; earlier opening remains in source metadata");
 assert.equal(full.rows[0].openingQuote?.point[0],firstMinute+60_000,"aligning the chart never discards the actual earlier source opener");
 assert.equal(predictionMarketGuidePoints(cmp.bookPoints,cmp.start,cmp.cutoff!)[0][0],cmp.start,"book trace shares the same real covered boundary");
 const stored={sportsbook:"circa",locked:true,points:[[now-hour,.5,-100]] as [number,number,number][]};
 assert.strictEqual(predictionMarketComparisonBook(true,stored,exact),stored);
 assert.equal(predictionMarketComparisonBook(true,null,exact),null);
 assert.equal(predictionMarketComparison(full.rows[0],exact,now-2*hour).bookPoints.every(p=>p[0]<=now-2*hour),true);
 assert.equal(JSON.stringify(game),before);
 const panel=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8"),route=readFileSync("app/api/lab/prediction-market/route.ts","utf8");
 assert.match(panel,/PredictionMarketUnavailable/);assert.match(panel,/Updates automatically when one arrives/);assert.match(panel,/\[key,enabled,kind\]/);
 assert.match(panel,/Full window/);assert.match(panel,/aria-pressed=\{range===\"24h\"\}/);
 assert.match(panel,/predictionMarketVisibleComparison\(outcome,book,lockedAt,predictionMarketAllowsStandaloneHistory\(game\.sport,frozen,!!current\.prelockCapturedAt,historicalCfb\)\)/,
   "unlocked CBB Kalshi history stays visible before sportsbook overlap");
 assert.match(panel,/if\(fallbackBook&&!sharedHistory&&!standaloneHistory\)/,"only an ineligible standalone history takes the sportsbook-only fallback");
 assert.match(route,/availability/);assert.doesNotMatch(route,/client\.(get|odds)|fetch\(/,"member reads cannot call upstream");
 console.log("PASS lifetime history: provider openings, exact line/side/book/event identity, market-specific availability/retry, retained opens, real timestamps, bounded request budgets and immutable locks.");
}
void run();
