import { readPredictionMarketDisplayFeed, readPredictionMarketContractFeed, readPublishedPredictionMarketGames,readPredictionMarketPrelockFeed,readPredictionMarketBookHistory } from "@/lib/services/dailyEdge/predictionMarketDisplayFeed";
import {readPredictionMarketPrelock} from "@/lib/providers/owls/predictionMarketPrelock";
import {predictionMarketLockBoundary} from "@/app/lab/lib/predictionMarketDisplay";
import {readPredictionMarketBook,readPublicTrackerBook} from "@/lib/services/dailyEdge/predictionMarketBookRead";
import { matchPredictionMarketGame, PREDICTION_MARKET_TARGETS, type PredictionMarketSport } from "@/lib/providers/owls/owlsPredictionMarkets";
import { resolveReaderContract, formatContractLine, type ContractKind, type ContractSelection } from "@/lib/providers/owls/predictionMarketContracts";
import {KALSHI_EVENT_DATE_MATCH_RELEASE} from "@/lib/providers/owls/predictionMarketEventDate";
import {marketDisplayGameIdentity,CBB_MARKET_TRACKING_RELEASE} from "@/lib/cbb/marketDisplayIdentity";
import {recoverCfbHistoricalChart,supplementCfbPrelockMarket,CFB_CHART_CONTINUITY_RELEASE} from "@/lib/providers/owls/cfbHistoricalChart";

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const kind=query.get("market")??"moneyline";
  if(!["moneyline","spread","total","btts"].includes(kind))return Response.json({market:null},{status:400});
  const sport = query.get("sport") ?? "";
  if (!Object.hasOwn(PREDICTION_MARKET_TARGETS, sport)) return Response.json({market:null}, {status:200});
  const awayTeam = query.get("away") ?? "";
  const homeTeam = query.get("home") ?? "";
  const gameStartAt = query.get("start") ?? "";
  if (!/^[A-Z0-9& -]{1,12}$/.test(awayTeam) || !/^[A-Z0-9& -]{1,12}$/.test(homeTeam) || awayTeam === homeTeam || !Number.isFinite(Date.parse(gameStartAt))) {
    return Response.json({market:null}, {status:400});
  }
  let selection:ContractSelection|null=null;
  if(kind!=="moneyline"){
    const side=query.get("side"),rawLine=query.get("line"),line=rawLine===null?null:Number(rawLine);
    const valid=kind==="btts"?(side==="yes"||side==="no"):
      rawLine!==null&&rawLine.trim()!==""&&line!==null&&Number.isFinite(line)&&Math.abs(line)<=500&&(kind==="total"?line>0&&(side==="over"||side==="under"):side==="away"||side==="home");
    if(!valid)return Response.json({market:null},{status:400});
    selection={kind:kind as ContractKind,line:kind==="btts"?null:line,side:side as ContractSelection["side"],
      label:kind==="btts"?`BTTS ${side==="yes"?"Yes":"No"}`:kind==="total"?`${side==="over"?"Over":"Under"} ${line}`:`${side==="away"?awayTeam:homeTeam} ${formatContractLine(line!)}`};
  }
  const event=Number(query.get("event")),requestedSide=query.get("side");
  const published=Number.isSafeInteger(event)&&event>0?await readPublishedPredictionMarketGames(sport as PredictionMarketSport).catch(()=>[]):[];
  const game=published.find(g=>g.external_id===event&&g.awayTeam===awayTeam&&g.homeTeam===homeTeam&&Date.parse(g.gameStartAt??"")===Date.parse(gameStartAt));
  // A college abbreviation or caller-supplied name cannot establish identity.
  // The published institution pair is the only authority for a CBB join.
  if(sport==="cbb"&&!game)return Response.json({market:null,book:null,availability:"event_unavailable"},{headers:{"Cache-Control":"private, max-age=30"}});
  const [feed,contracts,books]=await Promise.all([
    readPredictionMarketDisplayFeed(sport as PredictionMarketSport).catch(()=>null),
    selection?readPredictionMarketContractFeed(sport as PredictionMarketSport,selection.kind).catch(()=>null):Promise.resolve(null),
    sport==="cbb"?readPredictionMarketBookHistory("cbb").catch(()=>null):Promise.resolve(null),
  ]);
  const gameMatch = matchPredictionMarketGame(feed, game?marketDisplayGameIdentity(game,sport as PredictionMarketSport,books?.events):{sport:sport as PredictionMarketSport,awayTeam,homeTeam,gameStartAt,
    awayName:query.get("awayName")?.slice(0,100),homeName:query.get("homeName")?.slice(0,100)});
  const market=selection?resolveReaderContract(contracts,gameMatch,selection):gameMatch;
  const side=selection?.side??(["away","home","draw"].includes(requestedSide??"")?requestedSide:gameMatch?.outcomes.slice().sort((a,b)=>b.probability-a.probability)[0]?.side);
  if(game&&side&&predictionMarketLockBoundary(game,Date.now())!==undefined){
    const archive=readPredictionMarketPrelock(await readPredictionMarketPrelockFeed(sport as PredictionMarketSport).catch(()=>null),game,kind,side,selection?.line??null);
    const recovered=recoverCfbHistoricalChart(game,kind,side,selection?.line??null,feed,contracts);
    if(archive?.market){
      const market=supplementCfbPrelockMarket(game,archive.market,recovered?.market??null);
      return Response.json({market,book:archive.book,prelockCapturedAt:archive.capturedAt,...(market!==archive.market?{recoveredAt:Date.now()}:{}),availability:"available"},{headers:{"Cache-Control":"private, max-age=30","X-CFB-Chart-Continuity":CFB_CHART_CONTINUITY_RELEASE}});
    }
    if(recovered)return Response.json({...recovered,availability:"available"},{headers:{"Cache-Control":"private, max-age=30","X-CFB-Chart-Continuity":CFB_CHART_CONTINUITY_RELEASE}});
    if(archive)return Response.json({market:archive.market,book:archive.book,prelockCapturedAt:archive.capturedAt,availability:"contract_unavailable"},{headers:{"Cache-Control":"private, max-age=30"}});
  }
  const preferredBook=query.get("book");
  const publicTracker=query.get("display")==="public-tracker-v1";
  const book=game&&side?await (publicTracker?readPublicTrackerBook(game,kind,side,selection?.line??null,sport as PredictionMarketSport):readPredictionMarketBook(game,kind,side,selection?.line??null,sport as PredictionMarketSport,preferredBook)).catch(()=>null):null;
  const availability=market?"available":!feed?"feed_unavailable":!gameMatch?"event_unavailable":selection&&!contracts?"market_feed_unavailable":"contract_unavailable";
  return Response.json({market,book,availability}, {headers:{"Cache-Control":"private, max-age=30, stale-while-revalidate=30","X-Prediction-Market-Date-Match":KALSHI_EVENT_DATE_MATCH_RELEASE,...(sport==="cbb"?{"X-CBB-Market-Tracking":CBB_MARKET_TRACKING_RELEASE}:{})}});
}
