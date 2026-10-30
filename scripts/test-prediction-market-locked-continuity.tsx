import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {capturePredictionMarketPrelock,readPredictionMarketPrelock} from "../lib/providers/owls/predictionMarketPrelock";
import {publicMarketDisplayBook,publicMarketPrelockHeldBook} from "../app/lab/lib/publicMarketDisplayTrail";
import {predictionMarketReaderBookTrail,predictionMarketArchivedBook,predictionMarketComparison,predictionMarketHasSharedHistory,predictionMarketGuidePoints} from "../app/lab/lib/predictionMarketDisplay";
import {PredictionMarketChart} from "../app/lab/components/daily-edge/PredictionMarketPanel";
import {captureOwlsBookDisplayHistory,type BookDisplayFeed} from "../lib/providers/owls/owlsBookDisplayHistory";
import {OwlsInsightClient} from "../lib/providers/owls/owlsInsightClient";
import type {DailyEdgeGameDto,MarketEdgeDto} from "../app/lab/lib/labTypes";
import {PREDICTION_MARKET_TARGETS,type PredictionMarketFeed} from "../lib/providers/owls/owlsPredictionMarkets";
import {contractSeries,type ContractFeed} from "../lib/providers/owls/predictionMarketContracts";

// Production JMU failure shape: last previous threshold quote is 24h46s
// before lock. Kalshi's eligible receipt ends before the only newer book
// endpoint. The 24-hour legacy crop therefore destroys the real overlap.
const lock=Date.parse("2026-10-29T22:30:49.465Z"),h=3_600_000,iso=(t:number)=>new Date(t).toISOString();
const at=Date.parse("2026-10-29T18:30:53.733Z");
const market={pick:"JMU -19.5",line:-19.5,priceAmerican:-110,currentPriceAmerican:-110,currentPriceSportsbook:"draftkings",movementReferenceSportsbook:"circa",held:false,
 oddsTrail:[
 {american:-112,line:-19.5,observedAt:"2026-10-28T19:15:03.149Z",sportsbook:"draftkings",label:"move",source:"line_history"},
 {american:-108,line:-19.5,observedAt:"2026-10-28T21:18:02.910Z",sportsbook:"draftkings",label:"move",source:"line_history"},
 {american:-110,line:-19.5,observedAt:"2026-10-28T22:30:03.750Z",sportsbook:"draftkings",label:"move",source:"line_history"},
 {american:-110,line:-19.5,observedAt:"2026-10-29T22:28:02.905Z",sportsbook:"draftkings",label:"locked",source:"locked_snapshot"}]} as MarketEdgeDto;
const game={id:"cfb-458441",external_id:458441,sport:"cfb",awayTeam:"TROY",homeTeam:"JMU",gameStartAt:"2026-10-29T23:30:00Z",lockedAt:iso(lock),lockState:"locked",markets:{first_inning:market,moneyline:{pick:"JMU",line:null},total:{pick:"Under 51.5",line:51.5}}} as DailyEdgeGameDto;
const row={ticker:"KXNCAAFSPREAD-26OCT29TROYJMU-JMU21",eventTicker:"KXNCAAFSPREAD-26OCT29TROYJMU",sideCode:"JMU",team:"James Madison wins by over 20.5 points",gameDate:"2026-10-29",bid:.46,ask:.47,probability:.465,volume24h:100,totalVolume:1000,asOf:iso(at),historyFrom:iso(lock-40*h),history:[[at-h,.48,900],[at,.465,1000]],historicalCandles:[[lock-40*h,.53,20]]} as PredictionMarketFeed["rows"][number];
const matched={eventTicker:row.eventTicker,source:"Kalshi via OWLS" as const,asOf:iso(at),status:"current" as const,outcomes:[{...row,label:"JMU −20.5"}],context:{kind:"spread" as const,requestedLabel:"JMU −19.5",displayLabel:"JMU −20.5",method:"nearby" as const,note:null,sources:[]}};
const old=predictionMarketReaderBookTrail(market,market.pick!,lock,-19.5)!;
assert.equal(old.points.length,1);
assert.equal(predictionMarketHasSharedHistory(predictionMarketComparison(matched.outcomes[0],old,lock)),false,"reproduce the live empty-graph bug");
const original=JSON.stringify(game),stored=publicMarketDisplayBook(market)!;
const full=publicMarketPrelockHeldBook(stored,at,lock)!;
assert.strictEqual(full.points,stored.points,"use exact persisted observations, not a reconstructed price path");
assert.deepEqual(full.points.map(p=>p[2]),[-112,-108,-110,-110]);
const circa={sportsbook:"circa",line:-19.5,locked:false,points:[[lock-48*h,.7,-233],[at,.6,-150]] as [number,number,number][]};
const book=predictionMarketArchivedBook(full,circa,at,lock,-19.5)!;
assert.strictEqual(book,full,"the old Circa archive can never replace a locked DraftKings trail");
const comparison=predictionMarketComparison(matched.outcomes[0],book,lock);
assert.equal(predictionMarketHasSharedHistory(comparison),true);
assert.equal(comparison.cutoff,at);assert.equal(comparison.start,stored.points[0][0]);
for(const points of[comparison.points,comparison.bookPoints]){
 const guide=predictionMarketGuidePoints(points,comparison.start,comparison.cutoff!);
 assert.equal(guide[0][0],comparison.start);assert.equal(guide.at(-1)![0],comparison.cutoff,"both real sources share exact chart boundaries");
}
for(const variant of["desktop","mobile"]){
 const html=renderToStaticMarkup(<section data-layout={variant}><PredictionMarketChart row={matched.outcomes[0]} book={book} context={matched.context} bookLabel="JMU −19.5" lockedAt={lock}/></section>);
 assert.match(html,/data-kalshi-line="true" d="M[^"]+ C/);assert.match(html,/data-sportsbook-line="draftkings" d="M[^"]+ C/);
 assert.doesNotMatch(html,/NaN|Infinity|strokeDasharray|data-sportsbook-line="circa"/);
}
assert.equal(publicMarketPrelockHeldBook(stored,undefined,lock),null,"legacy lock without actual receipt remains unchanged");
assert.equal(publicMarketPrelockHeldBook(stored,lock+1,lock),null);
assert.equal(publicMarketPrelockHeldBook(stored,at,NaN),null);
assert.equal(publicMarketPrelockHeldBook({...stored,points:[...stored.points,[lock+1,.8,-400]]},at,lock),null,"never admit post-lock observations");
assert.equal(JSON.stringify(game),original,"all locked prices/picks/grades/evidence remain unchanged");

async function run(){
 for(const sport of["cfb","nfl","nba","nhl","wnba"]as const){
  const [awayTeam,homeTeam]=({cfb:["TROY","JMU"],nfl:["CLE","BAL"],nba:["CLE","ATL"],nhl:["TOR","BOS"],wnba:["ATL","MIN"]}as const)[sport];
  const suffix="-26OCT29"+awayTeam+homeTeam,eventTicker=PREDICTION_MARKET_TARGETS[sport].series.toUpperCase()+suffix;
  const winner={...row,ticker:eventTicker+"-"+homeTeam,eventTicker,sideCode:homeTeam,team:homeTeam,bid:.8,ask:.82,probability:.81,history:[[at-h,.8,1],[at,.81,2]]} as typeof row;
  const winners={release:"owls_kalshi_display_2026_10_28_r1",sport,fetchedAt:iso(at),rows:[winner,{...winner,ticker:eventTicker+"-"+awayTeam,sideCode:awayTeam,team:awayTeam,bid:.18,ask:.20,probability:.19}]} as PredictionMarketFeed;
  const spreadEvent=contractSeries(sport,"spread").toUpperCase()+suffix;
  const contracts={...winners,kind:"spread",contractRelease:"kalshi_reader_contracts_2026_10_28_r1",rows:[{...row,sideCode:homeTeam,eventTicker:spreadEvent,ticker:spreadEvent+"-"+homeTeam+"21",contractKind:"spread",strike:20.5}]}as ContractFeed;
  const unlocked={...game,sport,awayTeam,homeTeam,lockState:"open",lockedAt:null,markets:{...game.markets,moneyline:{...game.markets.moneyline,pick:homeTeam},first_inning:{...market,pick:homeTeam+" -19.5",oddsTrail:market.oddsTrail!.slice(0,-1).concat({...market.oddsTrail!.at(-1)!,label:"current",observedAt:iso(at)})}}} as DailyEdgeGameDto;
  const before=JSON.stringify(unlocked);
  const archive=capturePredictionMarketPrelock(null,[unlocked],sport,winners,[contracts],{release:"owls_book_display_history_2026_10_29_r1",sport,fetchedAt:iso(at),eventsAt:iso(at),events:[],rows:[{event:game.external_id,start:game.gameStartAt!,away:awayTeam,home:homeTeam,kind:"spread",side:"home",book:"circa",providerEventId:"x",checkedAt:iso(at),opening:null,quotes:[[at-h,-110,-19.5]]}]}as BookDisplayFeed,at);
  const receipt=archive.rows.find(r=>r.kind==="spread")!;
  assert.equal(receipt.book?.sportsbook,"draftkings",sport+": internal Circa preference cannot override the public tracker");
  assert.equal(receipt.market?.context?.kind,"spread",sport+": exact dated spread market is captured, not the winner market");
  assert.equal(receipt.book?.points.length,4,sport+": persisted older history survives without provider backfill");
  const locked={...unlocked,lockState:"locked",lockedAt:iso(lock)}as DailyEdgeGameDto;
  const frozen=capturePredictionMarketPrelock(archive,[locked],sport,{...winners,rows:[]},[],null,lock+h);
  assert.strictEqual(frozen.rows.find(r=>r.kind==="spread"),receipt,"sole capture never rewrites an existing lock");
  assert.strictEqual(readPredictionMarketPrelock(frozen,locked,"spread","home",-19.5,lock+h),receipt);
  assert.equal(JSON.stringify(unlocked),before);
 }
 const requests:Array<{book:string|null;market:string|null}>=[];
 const unlocked={...game,lockState:"open",lockedAt:null,markets:{...game.markets,first_inning:{...market,oddsTrail:market.oddsTrail!.map(s=>({...s,label:s.label==="locked"?"current":s.label}))}}}as DailyEdgeGameDto;
 const client=new OwlsInsightClient("fixture-only",{fetchImpl:async input=>{const u=new URL(String(input));
  if(u.pathname.endsWith("/odds"))return Response.json({success:true,data:[{eventId:"fixture",commence_time:game.gameStartAt,away_team:"Troy",home_team:"James Madison",bookmakers:["circa","draftkings"].map(key=>({key,last_update:iso(at),markets:[{key:"spreads"}]}))}]});
  requests.push({book:u.searchParams.get("book"),market:u.searchParams.get("market")});return Response.json({success:false});
 }});
 await captureOwlsBookDisplayHistory(null,[unlocked],"cfb",client,at);
 assert.equal(requests[0]?.book,"draftkings","optional backfill prioritizes the actual public book despite an internal Circa preference");
 assert.ok(requests.length<=3,"same history request ceiling");
 const panel=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8");
 assert.match(panel,/storedBook=frozen&&current\?\.prelockCapturedAt\?publicMarketPrelockHeldBook/);
 console.log("PASS locked prediction-market continuity: exact JMU reproduction, >24h stored history, aligned two-source curves, same-book future captures, immutable locks and legacy precedence, no post-lock data or increased request ceiling.");
}
void run();
