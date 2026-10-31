/** Owner-approved auxiliary graph recovery only. No model or lock writer. */
import type {DailyEdgeGameDto} from "@/app/lab/lib/labTypes";
import {publicMarketDisplayBook} from "@/app/lab/lib/publicMarketDisplayTrail";
import {predictionMarketChartSeries,predictionMarketLockBoundary} from "@/app/lab/lib/predictionMarketDisplay";
import {marketDisplayGameIdentity} from "@/lib/cbb/marketDisplayIdentity";
import {matchPredictionMarketGame,type PredictionMarketFeed,type PredictionMarketRow} from "./owlsPredictionMarkets";
import {readerHistoryContractSelection,resolveReaderContract,type ContractFeed,type ReaderMarketMatch} from "./predictionMarketContracts";

export const CFB_CHART_CONTINUITY_RELEASE="cfb_chart_continuity_2026_10_31_r1_verified_history";

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
 const historicalContracts=contracts?{...contracts,rows:contracts.rows.flatMap(r=>{const value=through(r,boundary);return value?[value]:[];})}:null;
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
