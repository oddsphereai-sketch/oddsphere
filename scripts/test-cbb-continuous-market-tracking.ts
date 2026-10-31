import assert from "node:assert/strict";
import type { DailyEdgeGameDto } from "../app/lab/lib/labTypes";
import { marketDisplayGameIdentity, CBB_MARKET_TRACKING_RELEASE } from "../lib/cbb/marketDisplayIdentity";
import { accumulateCbbPublishedQuotes, captureOwlsBookDisplayHistory, bookDisplayTrail, isBookDisplayFeed, BOOK_DISPLAY_HISTORY_RELEASE, type BookDisplayFeed } from "../lib/providers/owls/owlsBookDisplayHistory";
import { matchPredictionMarketGame, PREDICTION_MARKET_RELEASE, type PredictionMarketFeed } from "../lib/providers/owls/owlsPredictionMarkets";
import { parseContractFeed, contractsForPublishedReaders, resolveReaderContract } from "../lib/providers/owls/predictionMarketContracts";
import { PREDICTION_MARKET_PRELOCK_RELEASE, capturePredictionMarketPrelock, type PrelockFeed } from "../lib/providers/owls/predictionMarketPrelock";
import { OwlsInsightClient } from "../lib/providers/owls/owlsInsightClient";
import { mergeCbbReaderEvidence } from "../lib/services/cbb/cbbReaderMarketEvidence";
import type { DailyEdgeResponse } from "../app/lab/lib/labTypes";

const now=Date.parse("2026-10-31T14:30:00Z"),iso=(t:number)=>new Date(t).toISOString();
const stop=(line:number|null,price:number,at=now-60_000)=>({line,american:price,observedAt:iso(at),sportsbook:"fanduel",label:"current" as const,source:"current_line" as const});
const game={id:"cbb-10882408",external_id:10882408,sport:"cbb",awayTeam:"LIB",homeTeam:"HPU",awayTeamDisplayName:"Liberty Flames",homeTeamDisplayName:"High Point Panthers",cbbAwayCollege:"Liberty",cbbHomeCollege:"High Point",gameStartAt:"2026-11-02T04:59:00Z",lockState:"open",lockedAt:null,markets:{
 moneyline:{pick:"HPU ML",line:null,currentPriceAmerican:-330,currentPriceSportsbook:"fanduel",oddsTrail:[stop(null,-330)],opposingOddsTrail:{side:"away",label:"LIB",stops:[stop(null,260)]}},
 total:{pick:"Under 155.5",line:155.5,currentPriceAmerican:-110,currentPriceSportsbook:"fanduel",oddsTrail:[stop(155.5,-110)],opposingOddsTrail:{side:"over",label:"Over",stops:[stop(155.5,-110)]}},
 first_inning:{pick:"HPU -7.5",line:-7.5,currentPriceAmerican:-115,currentPriceSportsbook:"fanduel",oddsTrail:[stop(-7.5,-115)],opposingOddsTrail:{side:"away",label:"LIB",stops:[stop(7.5,-105)]}},
}} as unknown as DailyEdgeGameDto;
const event={eventId:"ncaab:High Point@Liberty-20261102",home_team:"Liberty",away_team:"High Point",commence_time:"2026-11-02T05:00:00Z",bookmakers:[]};
const books:BookDisplayFeed={release:BOOK_DISPLAY_HISTORY_RELEASE,sport:"cbb",fetchedAt:iso(now),eventsAt:iso(now),events:[event],rows:[],budget:{day:"2026-10-31",discovery:12,history:48}};
const archive:PrelockFeed={release:PREDICTION_MARKET_PRELOCK_RELEASE,sport:"cbb",rows:[{event:game.external_id,start:game.gameStartAt!,away:"LIB",home:"HPU",key:"first_inning",pick:"HPU -8.5",kind:"spread",side:"home",line:-8.5,capturedAt:now-86_400_000,market:null,book:{sportsbook:"fanduel",locked:false,line:-8.5,points:[[now-86_460_000,102/202,-102]],marketHistory:[[now-86_460_000,-102,-8.5]]}}]};
const ticker="KXNCAAMBGAME-26NOV02LIBHP",winner=(sideCode:string,team:string,p:number)=>({ticker:`${ticker}-${sideCode}`,eventTicker:ticker,sideCode,team,gameDate:"2026-11-02",bid:p,ask:p,probability:p,asOf:iso(now),totalVolume:10,volume24h:10,history:[[now,p,10] as [number,number,number]]});
const winners:PredictionMarketFeed={release:PREDICTION_MARKET_RELEASE,sport:"cbb",fetchedAt:iso(now),rows:[winner("LIB","Liberty",.25),winner("HP","High Point",.75)]};

async function main(){
 const original=JSON.stringify({game,books,archive,winners});
 assert.equal(matchPredictionMarketGame(winners,marketDisplayGameIdentity(game,"cbb"),now),null,"different calendar dates require independent source proof");
 const identity=marketDisplayGameIdentity(game,"cbb",books.events,now),matched=matchPredictionMarketGame(winners,identity,now)!;
 assert.equal(matched.eventTicker,ticker);assert.equal(identity.gameStartAt,game.gameStartAt,"display matching never moves the canonical fixture");
 for(const badEvents of [[{...event,commence_time:"2026-11-02T05:01:00Z"}],[{...event,home_team:"North Dakota"}],[event,{...event,eventId:"duplicate"}]])
  assert.equal(matchPredictionMarketGame(winners,marketDisplayGameIdentity(game,"cbb",badEvents,now),now),null,"time/name/ambiguity failures retain strict date identity");
 const locked={...game,lockState:"locked" as const,lockedAt:iso(now-1000)};
 assert.equal(matchPredictionMarketGame(winners,marketDisplayGameIdentity(locked,"cbb",books.events,now),now),null,"legacy locked display cannot acquire the new date semantic");
 const spreadEvent="KXNCAAMBSPREAD-26NOV02LIBHP";
 const contracts=parseContractFeed({success:true,meta:{cacheTimestamp:iso(now)},data:{one:{ticker:spreadEvent+"-HP8",event_ticker:spreadEvent,status:"active",market_type:"binary",yes_sub_title:"High Point wins by over 7.5 points",yes_bid_dollars:"0.5",yes_ask_dollars:"0.52",floor_strike:7.5,strike_type:"greater"}}},"cbb","spread",now)!;
 assert.equal(contractsForPublishedReaders(contracts,winners,[game],now,books.events).rows.length,1,"the collector must retain the same exact contract the reader can match");
 assert.equal(resolveReaderContract(contracts,matched,{kind:"spread",line:-7.5,side:"home",label:"HPU -7.5"},now)?.context?.method,"exact");
 const feed=accumulateCbbPublishedQuotes(books,[game],archive,now);
 assert.equal(feed.cbbTrackingRelease,CBB_MARKET_TRACKING_RELEASE);assert.equal(feed.rows.length,6,"both sides of all three markets are retained without optional backfill");
 const home=feed.rows.find(r=>r.kind==="spread"&&r.side==="home")!,away=feed.rows.find(r=>r.kind==="spread"&&r.side==="away")!;
 assert.deepEqual(home.quotes.map(q=>q[2]),[-8.5,-7.5]);assert.equal(home.opening,null,"first observed is never fabricated into a provider opener");
 assert.equal(bookDisplayTrail(home,-7.5,now)?.points.length,1,"another threshold cannot be spliced onto the current-line price curve");
 assert.equal(bookDisplayTrail(home,-7.5,now)?.marketHistory?.length,2,"the real earlier threshold remains on line history");
 assert.equal(away.quotes[0][2],7.5,"opposing spread point remains in its own orientation");
 const rendered=mergeCbbReaderEvidence({sport:"cbb",games:[game]} as DailyEdgeResponse,feed,[],now).games[0];
 assert.equal(rendered.markets.first_inning.lineTrail!.length,2,"reader retains both real thresholds and deduplicates the published terminal");
 assert.equal(rendered.markets.first_inning.oddsTrail!.length,1,"a repeated terminal cannot manufacture an earlier price observation");
 assert.equal(rendered.markets.first_inning.opposingOddsTrail!.stops.length,1);
 assert.equal(rendered.markets.first_inning.priceAmerican,game.markets.first_inning.priceAmerican);
 const next=structuredClone(game);next.markets.first_inning.oddsTrail=[stop(-7.5,-110,now+60_000)];
 const advanced=accumulateCbbPublishedQuotes(feed,[next],archive,now+120_000);
 assert.deepEqual(advanced.rows.find(r=>r.kind==="spread"&&r.side==="home")!.quotes.map(q=>q[1]),[-102,-115,-110]);
 assert.deepEqual(accumulateCbbPublishedQuotes(feed,[locked],archive,now).rows,feed.rows,"locked writer/reader inputs retain exact stored evidence");
 const noFuture=structuredClone(game);noFuture.markets.first_inning.oddsTrail=[stop(-7.5,-130,now+60_000)];
 assert.equal(accumulateCbbPublishedQuotes(books,[noFuture],null,now).rows.some(r=>r.quotes.some(q=>q[1]===-130)),false);
 const corrupt={...archive,rows:archive.rows.map(r=>({...r,event:999}))};
 assert.equal(accumulateCbbPublishedQuotes(books,[game],corrupt,now).rows.find(r=>r.kind==="spread"&&r.side==="home")!.quotes.length,1,"cross-game archive cannot enter the tape");
 let calls=0;const client=new OwlsInsightClient("fixture-only",{fetchImpl:async()=>{calls++;throw Error("no upstream allowed");}});
 const captured=await captureOwlsBookDisplayHistory(books,[game],"cbb",client,now,null,archive);
 assert.equal(calls,0);assert.equal(captured.requests,0);assert.equal(captured.feed.rows.length,6,"exhausted history budget cannot stop ordinary observed tracking");
 const archived=capturePredictionMarketPrelock(null,[game],"cbb",winners,[contracts],captured.feed,now);
 assert.equal(archived.rows.find(r=>r.kind==="spread")?.market?.eventTicker,spreadEvent,"future pre-lock capture shares verified matching");
 const busy=Array.from({length:119},(_,i)=>({...game,id:`cbb-${i}`,external_id:i+1}));
 const expanded=accumulateCbbPublishedQuotes(books,busy,null,now);assert.equal(expanded.rows.length,714);assert.ok(isBookDisplayFeed(expanded,"cbb"),"a normal opening-day slate exceeds the old 450-row cap without losing games");
 assert.strictEqual(accumulateCbbPublishedQuotes({...books,sport:"nba"},[game],archive,now).rows,books.rows,"other sports retain their exact path");
 assert.equal(JSON.stringify({game,books,archive,winners}),original,"all source and prediction inputs are immutable");
 console.log("CBB tracking: independently verified midnight identity, exact contracts, both-side observed tape, unchanged budgets, archive provenance, busy slate, immutable inputs/locks and other-sport neutrality passed.");
}
void main();
