import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseOwlsPredictionMarkets, mergePredictionMarketFeeds, matchPredictionMarketGame,
  isPredictionMarketFeed, kalshiGameDate, type PredictionMarketFeed,
} from "../lib/providers/owls/owlsPredictionMarkets";
import { predictionMarketActivity, predictionMarketPinnacleComparison, predictionMarketBookTrail, predictionMarketChartSeries, predictionMarketChartDomain, predictionMarketCurve, predictionMarketObservationAt, formatPredictionMarketOdds } from "../app/lab/lib/predictionMarketDisplay";
import { parseKalshiDisplayCandles, backfillKalshiDisplayHistory } from "../lib/providers/owls/kalshiDisplayHistory";
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

const bookMarket={...ml,pick:"SA ML",movementReferenceSportsbook:"circa",oddsTrail:[
  {...stop(-200,"circa",now-60*60_000),label:"first" as const},stop(-220,"circa",now),stop(-230,"pinnacle",now),
],opposingOddsTrail:{side:"home" as const,label:"UTAH",stops:[{...stop(180,"circa",now-60*60_000),label:"first" as const},stop(190,"circa",now)]}} as MarketEdgeDto;
const bookTrail=predictionMarketBookTrail(bookMarket,"SA",now)!;
assert.equal(bookTrail.sportsbook,"circa");assert.equal(bookTrail.points.length,2,"one book only, no Pinnacle quote spliced in");
assert.equal(bookTrail.points[1][1],220/320,"book line is honestly labeled raw implied price including margin");
assert.equal(predictionMarketBookTrail(bookMarket,"UTAH",now)?.points[1][1],100/290,"opposite side uses its own quotes");
assert.equal(predictionMarketBookTrail(bookMarket,"LAL",now),null,"unproven outcome never borrows another team's line");
assert.equal(predictionMarketBookTrail(bookMarket,"SA",now+25*60*60_000),null,"observations over 24 hours old stay outside the chart window");
assert.equal(predictionMarketBookTrail({...bookMarket,oddsTrail:bookMarket.oddsTrail?.map(row=>({...row,label:"move"}))},"SA",now),null,"history without an actual current/locked endpoint is not promoted to a current trail");
const minnesota={...bookMarket,pick:"MIN ML",oddsTrail:[
  {...stop(-155,"circa",now-11*60*60_000),label:"first" as const},
  {...stop(-160,"circa",now-7*60*60_000),label:"move" as const},stop(-160,"circa",now),
]} as MarketEdgeDto;
const minnesotaBefore=JSON.stringify(minnesota);
const minnesotaTrail=predictionMarketBookTrail(minnesota,"MIN",now)!;
assert.deepEqual(minnesotaTrail.points.map(point=>point[2]),[-155,-160,-160],"Minnesota's real morning opener must not be clipped into a false flat -160 line");
assert.equal(minnesotaTrail.points[0][0],now-11*60*60_000,"the earlier quote retains its real timestamp, not the eight-hour boundary");
assert.ok(minnesotaTrail.points[0][1]<minnesotaTrail.points[1][1],"the -155 to -160 move changes the plotted ordinate");
assert.equal(JSON.stringify(minnesota),minnesotaBefore,"display derivation never modifies stored/locked odds");
assert.equal(formatPredictionMarketOdds(-155),"−155");assert.equal(formatPredictionMarketOdds(140),"+140");
assert.equal(predictionMarketObservationAt(minnesotaTrail.points,now-10*60*60_000)?.[2],-155,"cross-series inspection exposes the actual earlier quote");
assert.equal(predictionMarketObservationAt(minnesotaTrail.points,now-12*60*60_000),null,"inspection does not borrow a future quote");
const [chartLow,chartHigh]=predictionMarketChartDomain(minnesotaTrail.points);
assert.ok(chartLow<=155/255*100&&chartHigh>=160/260*100);
assert.ok(53*(160/260-155/255)*100/(chartHigh-chartLow)>10,"adaptive padding leaves this real movement visible");

const curveInput=structuredClone(minnesotaTrail.points),curveBefore=JSON.stringify(curveInput);
const smooth=predictionMarketCurve(curveInput,at=>(at-now)/60_000,p=>p*100,Infinity,100);
assert.match(smooth.line,/ C/,"both shared series use rounded curves, not stock-monitor steps");
assert.ok(!/[HV]/.test(smooth.line));
assert.ok(smooth.line.endsWith(`${(curveInput.at(-1)![0]-now)/60_000},${curveInput.at(-1)![1]*100}`),"exact last recorded endpoint is retained");
assert.equal(JSON.stringify(curveInput),curveBefore,"curve styling cannot mutate locked quotes");
const separated=predictionMarketCurve([[0,.5],[300_000,.6],[2_000_000,.7],[2_300_000,.65]],at=>at,p=>p,900_000,1);
assert.equal((separated.line.match(/M/g)??[]).length,2,"missing quote intervals cannot become a continuous curve");
assert.equal((separated.area.match(/Z/g)??[]).length,2,"area fill also preserves actual quote gaps");
assert.deepEqual(predictionMarketCurve([],Number,Number),{line:"",area:""});
assert.deepEqual(predictionMarketCurve([[1,.5]],Number,Number),{line:"M1,0.5",area:""},"one quote never becomes fabricated movement");
for(const pair of [[[0,.3],[100,.8]],[[0,.8],[100,.3]],[[0,.5],[100,.5]]] as const){
  const path=predictionMarketCurve(pair,Number,Number).line;
  const numbers=path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
  const [x0,y0,cx1,cy1,cx2,cy2,x1,y1]=numbers;
  assert.ok(cx1>=x0&&cx2>=cx1&&x1>=cx2);
  for(let i=0;i<=100;i++){
    const t=i/100,u=1-t;
    const ordinate=u*u*u*y0+3*u*u*t*cy1+3*u*t*t*cy2+t*t*t*y1;
    assert.ok(ordinate>=Math.min(y0,y1)-1e-12&&ordinate<=Math.max(y0,y1)+1e-12,"rounded connectors cannot invent a price above/below the recorded range");
  }
}

const ticker=feed.rows[0].ticker;
const candleEnd=Math.floor((now-5*60_000)/300_000)*300;
const candle=(end:number)=>({end_period_ts:end,yes_bid:{close_dollars:"0.83"},yes_ask:{close_dollars:"0.85"},volume_fp:"2.50"});
const realCandles={market_ticker:ticker,candlesticks:Array.from({length:5},(_,i)=>candle(candleEnd-(4-i)*60))};
const parsedCandles=parseKalshiDisplayCandles(realCandles,ticker,now);
assert.deepEqual(parsedCandles,[[candleEnd*1000,.84,12.5]],"real minute candles aggregate interval volume, not cumulative totals");
assert.deepEqual(parseKalshiDisplayCandles(realCandles,ticker+"WRONG",now),[],"historical ticker must match exactly");
assert.deepEqual(parseKalshiDisplayCandles({...realCandles,candlesticks:realCandles.candlesticks.slice(1)},ticker,now),[],"incomplete volume interval is not filled in");
assert.deepEqual(parseKalshiDisplayCandles({...realCandles,candlesticks:realCandles.candlesticks.map(c=>({...c,yes_bid:{close_dollars:null},yes_ask:{close_dollars:null}}))},ticker,now),[],"synthetic/carry-forward price candles are never invented");
const chart=predictionMarketChartSeries({...merged.rows[0],historicalCandles:parsedCandles});
assert.equal(chart.points.length,3);assert.deepEqual(chart.activity,[12.5,null,200],"historical per-interval volume never gets subtracted from live cumulative volume");
assert.ok(isPredictionMarketFeed({...feed,rows:feed.rows.map(row=>({...row,historicalCandles:parsedCandles}))},"nba"));
assert.equal(isPredictionMarketFeed({...feed,rows:feed.rows.map(row=>({...row,historicalCandles:[[now,NaN,2]]}))},"nba"),false);

async function testHistoricalCapture(){
  let requests=0;
  const historicalFeed=await backfillKalshiDisplayHistory(feed,now,async input=>{
    requests++;const url=new URL(String(input));assert.equal(url.origin,"https://external-api.kalshi.com");assert.equal(url.searchParams.get("period_interval"),"1");assert.equal(url.searchParams.get("include_latest_before_start"),"false");
    return Response.json({markets:[realCandles]});
  });
  assert.equal(requests,1);assert.equal(historicalFeed.rows[0].historicalCandles?.length,1);
  assert.equal(historicalFeed.rows[0].asOf,feed.rows[0].asOf,"backfill never restamps current quotes");
  const kept=mergePredictionMarketFeeds(historicalFeed,newer,now+5*60_000);
  assert.equal(kept.rows[0].historicalCandles?.length,1,"normal live refresh preserves historical observations");
  await backfillKalshiDisplayHistory(historicalFeed,now+5*60_000,async()=>{throw new Error("must not refetch each member/cycle");});
  assert.equal(requests,1);
  const failed=await backfillKalshiDisplayHistory(feed,now,async()=>{throw new Error("outage");});
  assert.deepEqual(failed.rows,feed.rows,"history outage does not remove current quote data");
}
void testHistoricalCapture().then(()=>console.log("Historical backfill: exact candles, bounded capture, honest intervals, continuity and outage isolation passed."));

const reader=readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx","utf8");
assert.ok(reader.includes('variant="desktop"')&&reader.includes('variant="mobile"'));
const component=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8");
assert.ok(component.includes("illustrativeSample"));assert.match(component,/game\.sport\s*!==\s*"cbb"/);
assert.ok(component.includes("#7de3c1")&&component.includes("#b7a0f4"),"approved mint and violet chart colors are preserved");
assert.ok(component.includes("data-book-odds")&&component.includes("activeBook[2]"),"plotted prices and cross-series readouts retain actual American odds");
assert.ok(component.includes('game.markets.moneyline'),"total/spread/FI never become game-winner comparisons");
assert.ok(component.includes("soccer-ucl-"),"UCL does not read EPL feed");
const frozen=structuredClone(game);const checksum=JSON.stringify(frozen);matchPredictionMarketGame(feed,frozen,now);assert.equal(JSON.stringify(frozen),checksum,"reader identity and locked inputs are not mutated");
const service=readFileSync("lib/services/dailyEdge/predictionMarketDisplayFeed.ts","utf8");
assert.ok(!/game_predictions|prediction_records|locked_at|prediction_pipeline/.test(service),"display collector cannot write model/lock tables");
console.log("Prediction market display: all source, date, side, retention, history, comparison, and reader-boundary tests passed.");
