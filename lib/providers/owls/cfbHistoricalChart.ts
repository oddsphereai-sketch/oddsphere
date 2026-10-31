/** Owner-approved auxiliary graph recovery only. No model or lock writer. */
import type {DailyEdgeGameDto} from "@/app/lab/lib/labTypes";
import {publicMarketDisplayBook} from "@/app/lab/lib/publicMarketDisplayTrail";
import {predictionMarketChartSeries,predictionMarketLockBoundary} from "@/app/lab/lib/predictionMarketDisplay";
import {marketDisplayGameIdentity} from "@/lib/cbb/marketDisplayIdentity";
import {matchPredictionMarketGame,type PredictionMarketFeed,type PredictionMarketRow} from "./owlsPredictionMarkets";
import {readerHistoryContractSelection,resolveReaderContract,type ContractFeed,type ReaderMarketMatch} from "./predictionMarketContracts";

export const CFB_CHART_CONTINUITY_RELEASE="cfb_chart_continuity_2026_10_31_r2_frozen_endpoint_history";

/** Historical values come from actual stored observations/candles, never
 * today's price carried backwards. The original feed remains unchanged.
 * Bid/ask and 24h volume are not known historically and are removed below. */
function through<T extends PredictionMarketRow>(row:T,boundary:number):T|null{
 const points=predictionMarketChartSeries(row).points.filter(p=>p[0]<=boundary);
 const last=points.at(-1);if(!last)return null;
 return {...row,asOf:new Date(last[0]).toISOString(),probability:last[1],
  history:row.history.filter(p=>p[0]<=boundary),historicalCandles:(row.historicalCandles??[]).filter(p=>p[0]<=boundary),
  openingQuote:row.openingQuote&&row.openingQuote.point[0]<=boundary?row.openingQuote:undefined};
}

/** Only the stored locked selection and authoritative lock timestamp may
 * request this view. It is NOT a retrospectively manufactured pre-lock
 * capture: historicalThrough/recoveredAt explicitly retain that distinction.
 * Historical event identity is evaluated at the real lock boundary, when
 * the fixture was still future. The existing exact-opponent/date/policy and
 * ambiguity gates apply; ordinary live/legacy matching is not widened. */
export function recoverCfbHistoricalChart(game:DailyEdgeGameDto,kind:string,side:string,line:number|null,
 winners:PredictionMarketFeed|null,contracts:ContractFeed|null,now=Date.now()){
 const boundary=predictionMarketLockBoundary(game,now),start=Date.parse(game.gameStartAt??"");
 if(game.sport!=="cfb"||game.lockState!=="locked"||!game.lockedAt||boundary===undefined||
  !Number.isFinite(boundary)||boundary>now||boundary>=start||Date.parse(game.lockedAt)!==boundary||!winners)return null;
 const key=kind==="moneyline"?"moneyline":kind==="total"?"total":kind==="spread"?"first_inning":null;
 if(!key)return null;
 const selection=readerHistoryContractSelection(game,key),pick=game.markets[key].pick?.replace(/\s+ML$/i,"").trim().toUpperCase();
 const expectedSide=selection?.side??(pick===game.awayTeam.toUpperCase()?"away":pick===game.homeTeam.toUpperCase()?"home":null);
 if(expectedSide!==side||(selection?.line??null)!==line||(kind!=="moneyline"&&selection?.kind!==kind))return null;
 const bounded={...winners,rows:winners.rows.flatMap(r=>{const value=through(r,boundary);return value?[value]:[];})};
 const identity=marketDisplayGameIdentity(game,"cfb");
 const match=matchPredictionMarketGame(bounded,{...identity,lockState:"open",lockedAt:null},boundary);
 let historicalContracts=contracts?{...contracts,rows:contracts.rows.flatMap(r=>{const value=through(r,boundary);return value?[value]:[];})}:null;
 // Integer lines need two half-point tails. Their latest pre-lock live
 // receipts may differ, while actual historical candles share timestamps.
 // Align ONLY the two independently identified bracket contracts at exact
 // common observations; never interpolate or carry either price backwards.
 const identityOnly=selection?resolveReaderContract(contracts,match,selection,now):null;
 if(historicalContracts&&contracts&&selection?.line!==null&&Number.isInteger(selection?.line)&&identityOnly?.context&&selection){
  const strike=selection.kind==="spread"?Math.abs(selection.line!):selection.line!;
  const anchor=contracts.rows.find(r=>r.ticker===identityOnly.context!.sources[0]?.ticker);
  const choices=contracts.rows.filter(r=>r.eventTicker===identityOnly.eventTicker&&(selection.kind!=="spread"||r.sideCode===anchor?.sideCode));
  const lower=choices.filter(r=>r.strike===strike-.5),upper=choices.filter(r=>r.strike===strike+.5);
  const ids=choices.some(r=>r.strike===strike)||lower.length!==1||upper.length!==1?[]:[lower[0].ticker,upper[0].ticker];
  const rows=ids.map(id=>historicalContracts!.rows.find(r=>r.ticker===id));
  if(rows.length===2&&rows.every(r=>r!==undefined)){
   const series=rows.map(r=>predictionMarketChartSeries(r!).points),right=new Set(series[1].map(p=>p[0]));
   const common=series[0].filter(p=>right.has(p[0])).map(p=>p[0]);
   const last=common.at(-1);
   if(last!==undefined)historicalContracts={...historicalContracts,rows:historicalContracts.rows.map(row=>{
    if(!ids.includes(row.ticker))return row;
    const observations=new Map(predictionMarketChartSeries(row).points.map(p=>[p[0],p]));
    const history=common.map(at=>[at,observations.get(at)![1],null]as typeof row.history[number]);
    return {...row,asOf:new Date(last).toISOString(),probability:history.at(-1)![1],history};
   })};
  }
 }
 const resolved=selection?resolveReaderContract(historicalContracts,match,selection,boundary):match;
 if(!resolved)return null;
 const market:ReaderMarketMatch={...resolved,outcomes:resolved.outcomes.map(r=>({...r,bid:null,ask:null,volume24h:null,totalVolume:null}))};
 const stored=publicMarketDisplayBook(game.markets[key]);
 // The locked public book/threshold/endpoint remains authoritative. No
 // independent source, newly downloaded book quote or missing pick is added.
 const book=stored?{...stored,locked:true,points:stored.points.filter(p=>p[0]<=boundary),
  marketHistory:stored.marketHistory?.filter(p=>p[0]<=boundary),
  opening:stored.opening&&stored.opening.point[0]<=boundary?stored.opening:undefined}:null;
 return {market,book:book?.points.length?book:null,historicalThrough:boundary,recoveredAt:now,release:CFB_CHART_CONTINUITY_RELEASE};
}

/** A frozen auxiliary receipt can contain only the first quote of a newly
 * selected integer line's push bracket. Owner-approved earlier history may
 * fill that graph, but every stored field/quote and endpoint wins unchanged.
 * A different event, contract, bracket or method cannot supplement it. */
export function supplementCfbPrelockMarket(game:DailyEdgeGameDto,stored:ReaderMarketMatch,recovered:ReaderMarketMatch|null,now=Date.now()):ReaderMarketMatch{
 const boundary=predictionMarketLockBoundary(game,now),ceiling=Math.min(boundary??NaN,Date.parse(stored.asOf));
 if(game.sport!=="cfb"||game.lockState!=="locked"||!Number.isFinite(ceiling)||!recovered||stored.eventTicker!==recovered.eventTicker||
  stored.context?.kind!==recovered.context?.kind||stored.context?.method!==recovered.context?.method||
  stored.context?.requestedLabel!==recovered.context?.requestedLabel||
  JSON.stringify(stored.context?.sources.map(r=>r.ticker).sort())!==JSON.stringify(recovered.context?.sources.map(r=>r.ticker).sort()))return stored;
 const counts=stored.outcomes.map(row=>predictionMarketChartSeries(row).points.filter(p=>p[0]<=ceiling).length);
 if(counts.every(n=>n>=2))return stored;
 const outcomes=stored.outcomes.map((row,index)=>{
  if(counts[index]>=2)return row;
  const earlier=recovered.outcomes.find(r=>r.ticker===row.ticker&&r.label===row.label);if(!earlier)return row;
  const merge=(a:typeof row.history,b:typeof row.history)=>[...new Map([...a.filter(p=>p[0]<=ceiling),...b].map(p=>[p[0],p])).values()].sort((a,b)=>a[0]-b[0]);
  const next={...row,history:merge(earlier.history,row.history),historicalCandles:merge(earlier.historicalCandles??[],row.historicalCandles??[]),
   historyFrom:row.historyFrom??earlier.historyFrom,openingQuote:row.openingQuote??(earlier.openingQuote&&earlier.openingQuote.point[0]<=ceiling?earlier.openingQuote:undefined)};
  return predictionMarketChartSeries(next).points.filter(p=>p[0]<=ceiling).length>counts[index]?next:row;
 });
 return outcomes.some((row,i)=>row!==stored.outcomes[i])?{...stored,outcomes}:stored;
}
