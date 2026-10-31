import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import type {DailyEdgeGameDto} from "../app/lab/lib/labTypes";
import {recoverCfbHistoricalChart} from "../lib/providers/owls/cfbHistoricalChart";
import {retainPrelockRows,readPredictionMarketPrelock,type PrelockReceipt,type PrelockFeed,PREDICTION_MARKET_PRELOCK_RELEASE} from "../lib/providers/owls/predictionMarketPrelock";
import {PredictionMarketChart} from "../app/lab/components/daily-edge/PredictionMarketPanel";
import {predictionMarketComparison,predictionMarketVisibleComparison,selectedPredictionMarketOutcome} from "../app/lab/lib/predictionMarketDisplay";
import {predictionMarketTeamMatches,type PredictionMarketFeed} from "../lib/providers/owls/owlsPredictionMarkets";
import type {ContractFeed} from "../lib/providers/owls/predictionMarketContracts";

const hour=3600_000,lock=Date.parse("2026-10-31T15:00:00Z"),now=lock+hour,iso=(at:number)=>new Date(at).toISOString();
const stops=[lock-48*hour,lock-hour,lock].map((at,i)=>({label:i===2?"locked":"move",line:-2.5,american:[-105,-115,-110][i],sportsbook:"draftkings",observedAt:iso(at)}));
const game={id:"cfb-457751",external_id:457751,sport:"cfb",awayTeam:"ILL",homeTeam:"MD",awayTeamDisplayName:"Illinois Fighting Illini",homeTeamDisplayName:"Maryland Terrapins",gameStartAt:iso(lock+hour),lockState:"locked",lockedAt:iso(lock),markets:{moneyline:{pick:"ILL",line:null,oddsTrail:stops.map(s=>({...s,line:null}))},total:{pick:"Over 53.5",line:53.5,oddsTrail:stops.map(s=>({...s,line:53.5}))},first_inning:{pick:"ILL -2.5",line:-2.5,oddsTrail:stops}}}as DailyEdgeGameDto;
const row={ticker:"KXNCAAFGAME-26OCT30ILLMD-ILL",eventTicker:"KXNCAAFGAME-26OCT30ILLMD",sideCode:"ILL",team:"Illinois",gameDate:"2026-10-30",bid:.8,ask:.81,probability:.805,volume24h:10,totalVolume:100,asOf:iso(now),rescheduleWindowHours:48,historyFrom:iso(lock-72*hour),history:[[lock-hour,.55,10],[lock-300_000,.57,12],[now,.805,100]],historicalCandles:[[lock-72*hour,.52,1]]}as PredictionMarketFeed["rows"][number];
const winner:PredictionMarketFeed={release:"owls_kalshi_display_2026_10_28_r1",sport:"cfb",fetchedAt:iso(now),rows:[row,{...row,ticker:row.ticker.replace(/ILL$/,"MD"),sideCode:"MD",team:"Maryland",probability:.195,history:row.history.map(p=>[p[0],1-p[1],p[2]]),historicalCandles:row.historicalCandles!.map(p=>[p[0],1-p[1],p[2]])}]};
const contracts=(kind:"spread"|"total"):ContractFeed=>({release:winner.release,kind,contractRelease:"kalshi_reader_contracts_2026_10_28_r1",sport:"cfb",fetchedAt:iso(now),rows:[{...row,ticker:`KXNCAAF${kind.toUpperCase()}-26OCT31ILLMD-${kind==="spread"?"ILL3":"54"}`,eventTicker:`KXNCAAF${kind.toUpperCase()}-26OCT31ILLMD`,contractKind:kind,strike:kind==="spread"?2.5:53.5}]});
const input=JSON.stringify({game,winner});
for(const [kind,side,line]of[["moneyline","away",null],["spread","away",-2.5],["total","over",53.5]]as const){
 const r=recoverCfbHistoricalChart(game,kind,side,line,winner,kind==="moneyline"?null:contracts(kind),now)!;
 assert.ok(r,`${kind}: exact locked tuple recovered from actual pre-lock quotes`);
 assert.equal(r.historicalThrough,lock);assert.equal(r.recoveredAt,now);assert.equal("prelockCapturedAt"in r,false,"never claim retrospective capture occurred before lock");
 for(const outcome of r.market.outcomes){assert.equal(outcome.bid,null);assert.equal(outcome.ask,null);assert.equal(outcome.volume24h,null);assert.ok(Date.parse(outcome.asOf)<=lock);assert.ok(outcome.history.every(p=>p[0]<=lock));assert.ok(outcome.historicalCandles!.every(p=>p[0]<=lock));assert.ok(outcome.probability<.8,"post-lock quote cannot become historical endpoint");}
 assert.equal(r.book?.sportsbook,"draftkings");assert.deepEqual(r.book?.points.map(p=>p[2]),[-105,-115,-110],"exact locked public book and prices retain precedence");
 const outcome=selectedPredictionMarketOutcome(r.market,game.markets[kind==="spread"?"first_inning":kind].pick)!;
 const c=predictionMarketComparison(outcome,r.book,lock);assert.ok(c.points.length>=2);assert.ok(c.cutoff!<=lock);
 const html=renderToStaticMarkup(<PredictionMarketChart row={outcome} book={r.book} context={r.market.context} bookLabel={outcome.label} lockedAt={lock}/>);
 assert.match(html,/data-kalshi-line=/);assert.match(html,/data-sportsbook-line=/);assert.doesNotMatch(html,/NaN|Infinity/);
 const solo=renderToStaticMarkup(<PredictionMarketChart row={outcome} book={null} context={r.market.context} bookLabel={outcome.label} lockedAt={lock}/>);
 assert.match(solo,/data-kalshi-line=/);assert.doesNotMatch(solo,/data-sportsbook-line=/,"no fabricated sportsbook overlap");
}
for(const patch of[{sport:"nba"},{lockState:"open"},{lockedAt:null},{lockedAt:"bad"},{lockedAt:iso(now+hour)},{awayTeam:"IOWA"},{external_id:0}]){
 if("external_id"in patch)continue; // Event authority is established by the route's exact published lookup.
 assert.equal(recoverCfbHistoricalChart({...game,...patch}as DailyEdgeGameDto,"spread","away",-2.5,winner,contracts("spread"),now),null,JSON.stringify(patch));
}
assert.equal(recoverCfbHistoricalChart(game,"spread","away",-3.5,winner,contracts("spread"),now),null,"cannot override locked line");
assert.equal(recoverCfbHistoricalChart(game,"spread","home",-2.5,winner,contracts("spread"),now),null,"cannot override locked side");
assert.equal(recoverCfbHistoricalChart(game,"spread","away",-2.5,{...winner,rows:winner.rows.map(r=>({...r,rescheduleWindowHours:undefined}))},contracts("spread"),now),null,"next-day identity still needs actual policy");
assert.equal(recoverCfbHistoricalChart(game,"spread","away",-2.5,{...winner,rows:[...winner.rows,...winner.rows.map(r=>({...r,ticker:r.ticker.replace("ILLMD","ILLMD2"),eventTicker:r.eventTicker+"2"}))]},contracts("spread"),now),null,"ambiguity fails closed");
assert.equal(recoverCfbHistoricalChart(game,"moneyline","away",null,{...winner,rows:winner.rows.map(r=>({...r,history:[[now,.5,1]],historicalCandles:[]}))},null,now),null,"post-lock-only sources cannot create a graph");
assert.equal(JSON.stringify({game,winner}),input,"recovery never changes locked payloads or stored feeds");
const oneOverlap={sportsbook:"draftkings",locked:false,points:[[lock-hour,.5,-100]]as[number,number,number][]};
const visible=predictionMarketVisibleComparison(row,oneOverlap,undefined,true);
assert.equal(visible.standalone,true);assert.equal(visible.book,null);assert.ok(visible.comparison.points.length>=2,"one shared instant cannot truncate a real full Kalshi history to one point");
assert.equal(predictionMarketVisibleComparison(row,oneOverlap,undefined,false).standalone,false,"other sports retain legacy overlap policy");
assert.equal(predictionMarketTeamMatches({sideCode:"MIZZ",team:"Missouri"},"MIZ","Missouri Tigers","cfb"),true);
assert.equal(predictionMarketTeamMatches({sideCode:"ALBY",team:"University at Albany"},"UALB","Albany Great Danes","cfb"),true);
assert.equal(predictionMarketTeamMatches({sideCode:"MIZZ",team:"Missouri St."},"MIZ","Missouri Tigers","cfb"),false);
assert.equal(predictionMarketTeamMatches({sideCode:"MIZZ",team:"Missouri"},"MIZ","Missouri State Bears","cfb"),false);
assert.equal(predictionMarketTeamMatches({sideCode:"ALBY",team:"University at Albany"},"UALB","Albany State Golden Rams","cfb"),false);

const receipt=(g:DailyEdgeGameDto,key:"moneyline"|"total"|"first_inning",line:number|null,pick=g.markets[key].pick!):PrelockReceipt=>({event:g.external_id,start:g.gameStartAt!,away:g.awayTeam,home:g.homeTeam,key,pick,kind:key==="first_inning"?"spread":key,side:key==="total"?"over":"away",line,capturedAt:lock-hour,market:null,book:null});
const published=Array.from({length:120},(_,i)=>({...game,external_id:1000+i,gameStartAt:iso(lock+hour+i*60_000)}));
const current=published.flatMap(g=>[receipt(g,"moneyline",null),receipt(g,"total",53.5),receipt(g,"first_inning",-2.5)]);
const obsolete=Array.from({length:900},(_,i)=>({...receipt(published[i%120],"first_inning",-3.5,`ILL -${3.5+i}`),start:iso(lock+10*hour+i*60_000)}));
const previous=JSON.stringify(current),kept=retainPrelockRows([...obsolete,...current],published,"cfb",now);
assert.ok(kept.length>450,"large CFB archive no longer truncates all early games at 450 entries");
for(const r of current)assert.ok(kept.includes(r),"each of 360 currently published tuples survives regardless of kickoff ordering");
assert.equal(JSON.stringify(current),previous,"frozen receipt objects and checkpoints are untouched");
const feed:PrelockFeed={release:PREDICTION_MARKET_PRELOCK_RELEASE,sport:"cfb",rows:kept};
assert.strictEqual(readPredictionMarketPrelock(feed,published[0],"spread","away",-2.5,now),current[2],"earliest game's exact pre-lock receipt is readable");
assert.ok(retainPrelockRows([...obsolete,...current],published,"nba",now).length<=450,"other sports' legacy capacity policy unchanged");
const huge={...obsolete[0],pick:"x".repeat(49_000_000)};
assert.ok(!retainPrelockRows([huge,...current],published,"cfb",now).includes(huge),"obsolete alternates cannot exceed decoded byte budget");
assert.throws(()=>retainPrelockRows([{...current[0],market:{padding:"x".repeat(49_000_000)}as never}],published,"cfb",now),/protected published tuple/,"oversized protected data fails the capture instead of evicting the published game");
const component=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8");assert.match(component,/historicalCfb/);assert.match(component,/standaloneHistory/);
console.log("PASS CFB graph coverage: all-market verified historical recovery, exact frozen values, no post-lock quotes, both/solo rendered curves, current-tuple retention under large slates and byte bounds.");
