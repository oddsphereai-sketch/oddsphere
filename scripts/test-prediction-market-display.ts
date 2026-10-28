import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseOwlsPredictionMarkets, mergePredictionMarketFeeds, matchPredictionMarketGame,
  isPredictionMarketFeed, kalshiGameDate, type PredictionMarketFeed,
} from "../lib/providers/owls/owlsPredictionMarkets";
import { predictionMarketActivity, predictionMarketPinnacleComparison } from "../app/lab/lib/predictionMarketDisplay";
import type { MarketEdgeDto } from "../app/lab/lib/labTypes";

const now = Date.parse("2026-10-28T19:20:00Z");
function envelope(series="KXNBAGAME", date="26OCT28", away="SAS",home="UTA", awayName="San Antonio",homeName="Utah") {
  const event = `${series}-${date}${away}${home}`;
  const market=(code:string,name:string,bid:string,ask:string)=>({status:"active",market_type:"binary",ticker:`${event}-${code}`,event_ticker:event,yes_sub_title:name,yes_bid_dollars:bid,yes_ask_dollars:ask,volume_24h_fp:"0.00",volume_fp:"1000.50",updated_time:"2026-10-20T00:00:00Z"});
  return {success:true,meta:{cacheTimestamp:new Date(now-30_000).toISOString(),timestamp:new Date(now).toISOString(),ageSeconds:30,status:"stale"},data:{a:market(away,awayName,"0.84","0.85"),b:market(home,homeName,"0.15","0.16")}};
}
const raw=envelope();
const feed=parseOwlsPredictionMarkets(raw,"nba",now)!;
assert.equal(feed.rows.length,2);
assert.equal(feed.rows[0].asOf,"2026-10-28T19:19:30.000Z","quote uses receipt, not old market metadata date");
assert.equal(feed.rows[0].volume24h,0,"true zero volume survives");
assert.ok(isPredictionMarketFeed(feed,"nba"));
const game={sport:"nba" as const,awayTeam:"SA",homeTeam:"UTAH",gameStartAt:"2026-10-29T01:00:00Z"};
assert.equal(matchPredictionMarketGame(feed,game,now)?.outcomes[0].label,"SA");
assert.equal(matchPredictionMarketGame(feed,{...game,gameStartAt:"2026-10-30T01:00:00Z"},now),null,"wrong Eastern game date rejected");
assert.equal(matchPredictionMarketGame(feed,{...game,homeTeam:"LAL"},now),null,"wrong opponent rejected");
assert.equal(matchPredictionMarketGame({...feed,sport:"wnba"},game,now),null,"league cannot bleed across sport");
assert.equal(matchPredictionMarketGame(feed,game,now+11*60_000)?.status,"retained");
assert.equal(matchPredictionMarketGame(feed,game,now+25*60*60_000),null);
assert.equal(kalshiGameDate("KXMLBGAME-26OCT282000MILTB"),"2026-10-28");
assert.equal(kalshiGameDate("KXNBAGAME-26FEB31SAUTA"),null);
assert.equal(parseOwlsPredictionMarkets({...raw,meta:{...raw.meta,cacheTimestamp:"2026-10-27T19:20:00Z"}},"nba",now),null);
assert.equal(parseOwlsPredictionMarkets({...raw,meta:{}},"nba",now),null,"unknown quote freshness rejected");
assert.equal(parseOwlsPredictionMarkets({...raw,meta:{timestamp:new Date(now).toISOString(),ageSeconds:30}},"nba",now)?.rows[0].asOf,feed.rows[0].asOf);
assert.equal(parseOwlsPredictionMarkets({...raw,data:{a:raw.data.a}},"nba",now)?.rows.length,0,"partial refresh cannot replace a complete pair");
assert.equal(parseOwlsPredictionMarkets({...raw,data:{...raw.data,b:{...raw.data.b,yes_bid_dollars:null}}},"nba",now)?.rows.length,0);
const empty=parseOwlsPredictionMarkets({...raw,data:{}},"nba",now)!;
const retained=mergePredictionMarketFeeds(feed,empty,now+5*60_000);
assert.deepEqual(retained.rows,feed.rows,"empty feed holds exact receipt and history");
assert.equal(retained.rows[0].asOf,feed.rows[0].asOf,"never re-stamp retention as fresh");
const newer=structuredClone(feed);newer.rows.forEach(row=>{row.asOf=new Date(now+5*60_000).toISOString();row.history=[[now+5*60_000,row.probability,1200.5]];});
const merged=mergePredictionMarketFeeds(feed,newer,now+5*60_000);
assert.equal(merged.rows[0].history.length,2);
assert.deepEqual(predictionMarketActivity(merged.rows[0].history),[null,200]);
assert.deepEqual(predictionMarketActivity([[now,.5,100],[now+20*60_000,.6,200]]),[null,null],"missing interval is not a zero or invented activity bar");
assert.deepEqual(predictionMarketActivity([[now,.5,100],[now+5*60_000,.6,90]]),[null,null],"volume reset does not become negative activity");
const ambiguous={...feed,rows:[...feed.rows,...feed.rows.map(row=>({...row,eventTicker:row.eventTicker+"2",ticker:row.ticker+"2"}))]};
assert.equal(matchPredictionMarketGame(ambiguous,game,now),null,"ambiguous same-day matchup/doubleheader rejected");
for(const [sport,series,away,home,awayName,homeName] of [
  ["nhl","KXNHLGAME","PHI","WSH","Philadelphia","Washington"],
  ["nfl","KXNFLGAME","CAR","GB","Carolina","Green Bay"],
  ["cfb","KXNCAAFGAME","KENN","MTSU","Kennesaw State","Middle Tennessee"],
  ["mlb","KXMLBGAME","MIL","TB","Milwaukee","Tampa Bay"],
  ["wnba","KXWNBAGAME","GS","ATL","Golden State","Atlanta"],
] as const){
  const parsed=parseOwlsPredictionMarkets(envelope(series,"26OCT28",away,home,awayName,homeName),sport,now)!;
  assert.equal(matchPredictionMarketGame(parsed,{sport,awayTeam:away,homeTeam:home,gameStartAt:"2026-10-29T01:00:00Z"},now)?.outcomes.length,2,`${sport} exact matchup`);
}
const soccerRaw=envelope("KXEPLGAME","26OCT28","LFC","ARS","Liverpool","Arsenal");
soccerRaw.data.a.yes_bid_dollars="0.30";soccerRaw.data.a.yes_ask_dollars="0.31";
soccerRaw.data.b.yes_bid_dollars="0.40";soccerRaw.data.b.yes_ask_dollars="0.41";
const tie={...soccerRaw.data.a,ticker:soccerRaw.data.a.event_ticker+"-TIE",yes_sub_title:"Tie",yes_bid_dollars:"0.28",yes_ask_dollars:"0.29"};
const soccerFeed=parseOwlsPredictionMarkets({...soccerRaw,data:{...soccerRaw.data,tie}},"soccer",now)!;
assert.equal(matchPredictionMarketGame(soccerFeed,{sport:"soccer",awayTeam:"LIV",homeTeam:"ARS",gameStartAt:"2026-10-28T17:00:00Z"},now)?.outcomes.length,3,"soccer keeps draw and regulation-only market separate");
assert.equal(parseOwlsPredictionMarkets(soccerRaw,"soccer",now)?.rows.length,0,"soccer cannot become a false two-way board");
const laFeed=parseOwlsPredictionMarkets(envelope("KXNBAGAME","26OCT28","LAL","LAC","Los Angeles L","Los Angeles C"),"nba",now)!;
assert.equal(matchPredictionMarketGame(laFeed,{...game,awayTeam:"LAL",homeTeam:"LAC"},now)?.outcomes.length,2,"Los Angeles C is Clippers, not Lakers");
const uclRaw=envelope("KXUCLGAME","26OCT28","MUN","ROM","Manchester United","Roma");
uclRaw.data.a.yes_bid_dollars="0.30";uclRaw.data.a.yes_ask_dollars="0.31";uclRaw.data.b.yes_bid_dollars="0.40";uclRaw.data.b.yes_ask_dollars="0.41";
const uclTie={...uclRaw.data.a,ticker:uclRaw.data.a.event_ticker+"-TIE",yes_sub_title:"Tie",yes_bid_dollars:"0.28",yes_ask_dollars:"0.29"};
const uclFeed=parseOwlsPredictionMarkets({...uclRaw,data:{...uclRaw.data,tie:uclTie}},"ucl",now)!;
assert.equal(matchPredictionMarketGame(uclFeed,{sport:"ucl",awayTeam:"MAN",homeTeam:"ROMA",gameStartAt:game.gameStartAt},now)?.outcomes.length,3);
assert.equal(matchPredictionMarketGame(uclFeed,{sport:"ucl",awayTeam:"MUN",awayName:"Bayern Munich",homeTeam:"ROMA",gameStartAt:game.gameStartAt},now),null,"member Bayern MUN cannot match provider Manchester MUN");
assert.equal(isPredictionMarketFeed({...feed,release:"old"},"nba"),false);
const many:PredictionMarketFeed=structuredClone(feed);many.rows[0].history=Array.from({length:100},(_,i)=>[now-(100-i)*5*60_000,.5,1000+i]);
assert.ok(mergePredictionMarketFeeds(many,newer,now+5*60_000).rows[0].history.length<=100);

const stop=(american:number,sportsbook="pinnacle",at=now)=>({american,sportsbook,observedAt:new Date(at).toISOString(),line:null,source:"line_history" as const,label:"current" as const});
const ml={oddsTrail:[stop(-200)],opposingOddsTrail:{side:"home",label:"UTAH",stops:[stop(180)]}} as MarketEdgeDto;
assert.ok(predictionMarketPinnacleComparison(ml,"away",now)!>.6);
assert.equal(predictionMarketPinnacleComparison({...ml,oddsTrail:[stop(-200,"circa")]},"away",now),null,"Circa cannot be labeled Pinnacle");
assert.equal(predictionMarketPinnacleComparison(ml,"away",now+11*60_000),null,"old sportsbook comparison rejected");
assert.equal(predictionMarketPinnacleComparison({...ml,oddsTrail:[stop(-200,"pinnacle",now-3*60_000)]},"away",now),null,"asynchronous sides rejected");
assert.equal(predictionMarketPinnacleComparison(ml,"away",now,true),null,"soccer cannot normalize two sides while omitting the draw");

const reader=readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx","utf8");
assert.ok(reader.includes('variant="desktop"')&&reader.includes('variant="mobile"'));
const component=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8");
assert.ok(component.includes("illustrativeSample")&&component.includes('game.sport !== "cbb"'));
assert.ok(component.includes('game.markets.moneyline'),"total/spread/FI never become game-winner comparisons");
assert.ok(component.includes("soccer-ucl-"),"UCL does not read EPL feed");
const frozen=structuredClone(game);const checksum=JSON.stringify(frozen);matchPredictionMarketGame(feed,frozen,now);assert.equal(JSON.stringify(frozen),checksum,"reader identity and locked inputs are not mutated");
const service=readFileSync("lib/services/dailyEdge/predictionMarketDisplayFeed.ts","utf8");
assert.ok(!/game_predictions|prediction_records|locked_at|prediction_pipeline/.test(service),"display collector cannot write model/lock tables");
console.log("Prediction market display: all source, date, side, retention, history, comparison, and reader-boundary tests passed.");
