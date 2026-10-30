/** Display-only contract alignment. Never supplies a model, grade, or lock writer. */
import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import {kalshiRescheduleWindow,kalshiEventSuffixForDate} from "./predictionMarketEventDate";
import { matchPredictionMarketGame, PREDICTION_MARKET_TARGETS, PREDICTION_MARKET_RELEASE, kalshiGameDate,
  type PredictionMarketFeed, type PredictionMarketMatch, type PredictionMarketRow, type PredictionMarketPoint, type PredictionMarketSport } from "./owlsPredictionMarkets";

export const PREDICTION_MARKET_CONTRACT_RELEASE="kalshi_reader_contracts_2026_10_28_r1";
export type ContractKind="spread"|"total"|"btts";
export type ContractRow=PredictionMarketRow&{contractKind:ContractKind;strike:number|null};
export type ContractFeed=Omit<PredictionMarketFeed,"rows">&{kind:ContractKind;contractRelease:typeof PREDICTION_MARKET_CONTRACT_RELEASE;rows:ContractRow[]};
export type ReaderOutcome=Omit<PredictionMarketRow,"bid"|"ask">&{bid:number|null;ask:number|null;label:string};
export type ReaderMarketMatch=Omit<PredictionMarketMatch,"outcomes">&{
  outcomes:ReaderOutcome[];
  context?:{kind:ContractKind;requestedLabel:string;displayLabel:string;method:"exact"|"push_adjusted"|"nearby";note:string|null;
    sources:Array<{ticker:string;label:string;asOf:string;probability:number}>};
};
export type ContractSelection={kind:ContractKind;line:number|null;side:"over"|"under"|"yes"|"no"|"away"|"home";label:string};
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const numeric=(v:unknown):number|null=>v===null||v===undefined||v===""||typeof v==="boolean"||!Number.isFinite(Number(v))?null:Number(v);
const probability=(v:unknown):number|null=>{const n=numeric(v);return n!==null&&n>=0&&n<=1?n:null;};
const count=(v:unknown):number|null=>{const n=numeric(v);return n!==null&&n>=0?n:null;};
export const formatContractLine=(line:number)=>line>0?`+${line}`:line<0?`−${Math.abs(line)}`:"0";
export function contractKinds(sport:PredictionMarketSport):ContractKind[]{return sport==="soccer"||sport==="ucl"?["total","btts"]:sport==="mlb"?["total"]:["total","spread"];}
export function contractSeries(sport:PredictionMarketSport,kind:ContractKind):string{return PREDICTION_MARKET_TARGETS[sport].series.replace(/game$/,kind);}

/** The stored, selected reader tuple is authoritative; no prediction is recomputed. */
export function readerContractSelection(game:DailyEdgeGameDto,marketKey:keyof DailyEdgeGameDto["markets"]):ContractSelection|null {
  if(marketKey==="moneyline")return null;
  const market=game.markets[marketKey],pick=market.pick?.trim().replace(/[−–]/g,"-")??"";
  if(marketKey==="first_inning"&&(game.sport==="soccer"||game.sport==="ucl")){
    const side=/^yes$/i.test(pick)?"yes":/^no$/i.test(pick)?"no":null;
    return side?{kind:"btts",line:null,side,label:`BTTS ${side==="yes"?"Yes":"No"}`}:null;
  }
  const line=market.line;
  if(line===null||!Number.isFinite(line)||Math.abs(line)>500)return null;
  if(marketKey==="total"){
    const side=/^over\b/i.test(pick)?"over":/^under\b/i.test(pick)?"under":null;
    return side&&line>0?{kind:"total",line,side,label:`${side==="over"?"Over":"Under"} ${line}`}:null;
  }
  if(game.sport==="mlb")return null; // No first-inning series in the provider index.
  const side=pick.toUpperCase().startsWith(game.awayTeam.toUpperCase()+" ")?"away":pick.toUpperCase().startsWith(game.homeTeam.toUpperCase()+" ")?"home":null;
  return side?{kind:"spread",line,side,label:`${side==="away"?game.awayTeam:game.homeTeam} ${formatContractLine(line)}`}:null;
}

/** History is not a Bet grade. A published, explicitly named forecast can
 * supply direction when the actionable pick is empty. Use the real displayed
 * sportsbook threshold, never the forecast's probability at a different line.
 * Frozen callers may REQUEST an actual pre-lock receipt with this identity;
 * without one they must retain the legacy locked-reader selection above. */
export function readerHistoryContractSelection(game:DailyEdgeGameDto,marketKey:keyof DailyEdgeGameDto["markets"]):ContractSelection|null {
  const selected=readerContractSelection(game,marketKey);if(selected)return selected;
  const market=game.markets[marketKey],forecast=market.marketPrediction;
  if(market.pick?.trim()||forecast?.status!=="available"||!forecast.label||marketKey==="moneyline"||game.sport==="mlb")return null;
  const label=forecast.label.trim().replace(/[−–]/g,"-"),line=market.line;
  if(line===null||!Number.isFinite(line)||Math.abs(line)>500)return null;
  if(marketKey==="total"){
    const side=/^over\s+\d+(?:\.\d+)?$/i.test(label)?"over":/^under\s+\d+(?:\.\d+)?$/i.test(label)?"under":null;
    return side&&line>0?{kind:"total",line,side,label:`${side==="over"?"Over":"Under"} ${line}`}:null;
  }
  if(game.sport==="soccer"||game.sport==="ucl")return null;
  const named=/^(.+?)\s+([+-]?\d+(?:\.\d+)?|PK)$/i.exec(label);
  const side=named?.[1].toUpperCase()===game.awayTeam.toUpperCase()?"away":named?.[1].toUpperCase()===game.homeTeam.toUpperCase()?"home":null;
  return side?{kind:"spread",line,side,label:`${side==="away"?game.awayTeam:game.homeTeam} ${formatContractLine(line)}`}:null;
}

/** Strictly whitelisted full-game series only; half/quarter/props never bleed in. */
export function parseContractFeed(value:unknown,sport:PredictionMarketSport,kind:ContractKind,now=Date.now()):ContractFeed|null {
  const body=object(value),meta=object(body?.meta),data=object(body?.data);
  if(!body||body.success!==true||!meta||!data)return null;
  const at=typeof meta.cacheTimestamp==="string"?Date.parse(meta.cacheTimestamp):typeof meta.timestamp==="string"?Date.parse(meta.timestamp)-(numeric(meta.ageSeconds)??0)*1000:NaN;
  if(!Number.isFinite(at)||at>now+60_000||now-at>10*60_000)return null;
  const asOf=new Date(at).toISOString(),series=contractSeries(sport,kind).toUpperCase(),rows:ContractRow[]=[];
  for(const rawValue of Object.values(data).slice(0,6000)){
    const raw=object(rawValue);if(!raw||raw.status!=="active"||raw.market_type!=="binary")continue;
    const ticker=String(raw.ticker??"").toUpperCase(),eventTicker=String(raw.event_ticker??"").toUpperCase();
    if(!eventTicker.startsWith(series+"-")||!ticker.startsWith(eventTicker+"-"))continue;
    const gameDate=kalshiGameDate(eventTicker),bid=probability(raw.yes_bid_dollars),ask=probability(raw.yes_ask_dollars);
    if(!gameDate||bid===null||ask===null||bid>ask||ask-bid>.2||(bid===0&&ask===0)||(bid===1&&ask===1))continue;
    const strike=kind==="btts"?null:numeric(raw.floor_strike);
    if(kind!=="btts"&&(raw.strike_type!=="greater"||strike===null||strike<0||strike%1!==.5))continue;
    const suffix=ticker.slice(eventTicker.length+1);
    const sideCode=kind==="spread"?/^([A-Z][A-Z0-9]*?)(\d+)$/.exec(suffix)?.[1]:kind==="btts"?"BTTS":"OVER";
    if(!sideCode)continue;
    if(kind==="spread"&&suffix!==sideCode+String(Math.ceil(strike!)))continue;
    const p=(bid+ask)/2,totalVolume=count(raw.volume_fp);
    rows.push({ticker,eventTicker,sideCode,team:String(raw.yes_sub_title??raw.title??kind).slice(0,100),gameDate,bid,ask,probability:p,
      volume24h:count(raw.volume_24h_fp),totalVolume,asOf,history:[[at,p,totalVolume]],contractKind:kind,strike,
      ...(typeof raw.open_time==="string"&&Number.isFinite(Date.parse(raw.open_time))?{marketOpenedAt:raw.open_time}:{}),
      ...(kalshiRescheduleWindow(raw,sport,gameDate)?{rescheduleWindowHours:48 as const}:{})});
  }
  if(new Set(rows.map(row=>row.ticker)).size!==rows.length)return null;
  return {release:PREDICTION_MARKET_RELEASE,sport,fetchedAt:new Date(now).toISOString(),kind,contractRelease:PREDICTION_MARKET_CONTRACT_RELEASE,rows};
}

/** P(win | no push). Requires coherent ordered tail probabilities, never an
 * arithmetic interpolation of two different handicap prices. */
export function pushAdjustedProbability(lowerTail:number,upperTail:number,invert=false):number|null {
  if(lowerTail<upperTail||lowerTail<0||lowerTail>1||upperTail<0||upperTail>1)return null;
  const win=invert?1-lowerTail:upperTail,lose=invert?upperTail:1-lowerTail;
  return win+lose>0?win/(win+lose):null;
}
function combinedPoints(a:PredictionMarketPoint[],b:PredictionMarketPoint[],invert:boolean):PredictionMarketPoint[]{
  const right=new Map(b.map(point=>[point[0],point]));
  return a.flatMap(point=>{
    const other=right.get(point[0]);if(!other)return [];
    const p=pushAdjustedProbability(point[1],other[1],invert);
    return p===null?[]:[[point[0],p,point[2]===null||other[2]===null?null:point[2]+other[2]] as PredictionMarketPoint];
  });
}
const sum=(a:number|null,b:number|null)=>a===null||b===null?null:a+b;
function adjustedRow(a:ContractRow,b:ContractRow,invert:boolean,label:string):ReaderOutcome|null {
  // Different source receipts cannot form a fabricated synchronized contract.
  if(a.asOf!==b.asOf)return null;
  const p=pushAdjustedProbability(a.probability,b.probability,invert);if(p===null)return null;
  const history=combinedPoints(a.history,b.history,invert);if(!history.length)return null;
  const opening=a.openingQuote&&b.openingQuote&&a.openingQuote.point[0]===b.openingQuote.point[0]?combinedPoints([a.openingQuote.point],[b.openingQuote.point],invert)[0]:undefined;
  return {...a,ticker:`derived:${a.ticker}|${b.ticker}`,team:label,label,bid:null,ask:null,probability:p,
    volume24h:sum(a.volume24h,b.volume24h),totalVolume:sum(a.totalVolume,b.totalVolume),history,
    historicalCandles:combinedPoints(a.historicalCandles??[],b.historicalCandles??[],invert),
    historyFrom:a.historyFrom&&b.historyFrom?new Date(Math.max(Date.parse(a.historyFrom),Date.parse(b.historyFrom))).toISOString():undefined,
    openingQuote:opening?{point:opening,kind:a.openingQuote!.kind==="opening_minute"&&b.openingQuote!.kind==="opening_minute"?"opening_minute":"first_available"}:undefined};
}
function selectedRow(row:ContractRow,invert:boolean,label:string):ReaderOutcome {
  const flip=(points:PredictionMarketPoint[])=>points.map(point=>[point[0],1-point[1],point[2]] as PredictionMarketPoint);
  return {...row,team:label,label,...(invert?{bid:1-row.ask,ask:1-row.bid,probability:1-row.probability,
    history:flip(row.history),historicalCandles:flip(row.historicalCandles??[]),
    openingQuote:row.openingQuote?{...row.openingQuote,point:flip([row.openingQuote.point])[0]}:undefined}:{})};
}

/** Same exact dated matchup, market, direction and threshold. If the exact
 * threshold is unavailable, retain a separately labeled nearby contract. */
export function resolveReaderContract(feed:ContractFeed|null,gameMatch:PredictionMarketMatch|null,selection:ContractSelection,now=Date.now()):ReaderMarketMatch|null {
  if(!feed||!gameMatch||feed.kind!==selection.kind||!gameMatch.eventTicker.startsWith(PREDICTION_MARKET_TARGETS[feed.sport].series.toUpperCase()+"-"))return null;
  if(gameMatch.rescheduledGameDate&&feed.sport!=="cfb")return null;
  const originalSuffix=gameMatch.eventTicker.slice(gameMatch.eventTicker.indexOf("-")+1);
  // A postponed winner can keep its original ticker while separately issued
  // spread/total events use the current date. Never blindly copy that date.
  const suffix=gameMatch.rescheduledGameDate?kalshiEventSuffixForDate(originalSuffix,gameMatch.rescheduledGameDate):originalSuffix;
  const currentEvent=contractSeries(feed.sport,feed.kind).toUpperCase()+"-"+suffix;
  const originalEvent=contractSeries(feed.sport,feed.kind).toUpperCase()+"-"+originalSuffix;
  const event=feed.rows.some(row=>row.eventTicker===currentEvent)?currentEvent:originalEvent;
  if(gameMatch.rescheduledGameDate&&event===originalEvent&&feed.rows.some(row=>row.eventTicker===event&&row.rescheduleWindowHours!==48))return null;
  const rows=feed.rows.filter(row=>row.eventTicker===event&&Date.parse(row.asOf)<=now+60_000&&now-Date.parse(row.asOf)<=24*60*60_000);
  if(!rows.length)return null;
  const own=gameMatch.outcomes.find(row=>row.side===selection.side),opponent=gameMatch.outcomes.find(row=>row.side===(selection.side==="away"?"home":"away"));
  const target=selection.line;
  let choices=rows,invert=selection.side==="under"||selection.side==="no";
  if(selection.kind==="spread"){
    if(!own||!opponent||target===null)return null;
    invert=target>0;
    choices=rows.filter(row=>row.sideCode===(invert?opponent:own).sideCode);
  }
  const requestedStrike=selection.kind==="spread"?Math.abs(target!):target;
  const exact=choices.filter(row=>row.strike===requestedStrike);
  let method:"exact"|"push_adjusted"|"nearby"="exact",outcome:ReaderOutcome|null=null,sources:ContractRow[]=[],displayLabel=selection.label,note:string|null=null;
  if(exact.length===1){outcome=selectedRow(exact[0],invert,displayLabel);sources=exact;}
  else if(target!==null&&Number.isInteger(target)&&requestedStrike!>0){
    const lower=choices.filter(row=>row.strike===requestedStrike!-.5),upper=choices.filter(row=>row.strike===requestedStrike!+.5);
    if(lower.length===1&&upper.length===1){
      outcome=adjustedRow(lower[0],upper[0],invert,displayLabel);
      if(outcome){method="push_adjusted";sources=[lower[0],upper[0]];note="Push-adjusted · from surrounding half-point contracts";}
    }
  }
  if(!outcome&&selection.kind!=="btts"){
    const nearest=[...choices].sort((a,b)=>Math.abs(a.strike!-requestedStrike!)-Math.abs(b.strike!-requestedStrike!)||Date.parse(b.asOf)-Date.parse(a.asOf)||Math.abs(a.probability-.5)-Math.abs(b.probability-.5))[0];
    if(!nearest)return null;
    method="nearby";
    displayLabel=selection.kind==="total"?`${selection.side==="under"?"Under":"Over"} ${nearest.strike}`:`${own!.label} ${formatContractLine(invert?nearest.strike!:-nearest.strike!)}`;
    outcome=selectedRow(nearest,invert,displayLabel);sources=[nearest];note=`Nearby contract · sportsbook ${selection.label}`;
  }
  if(!outcome)return null;
  const asOf=new Date(Math.min(...sources.map(row=>Date.parse(row.asOf)))).toISOString();
  return {eventTicker:event,source:gameMatch.source,asOf,status:now-Date.parse(asOf)<=10*60_000?"current":"retained",outcomes:[outcome],
    context:{kind:selection.kind,requestedLabel:selection.label,displayLabel,method,note,sources:sources.map(row=>({ticker:row.ticker,label:row.team,asOf:row.asOf,probability:row.probability}))}};
}

/** Persist every source contract needed by the published board (including
 * push brackets), instead of thousands of unrelated alternate lines. */
export function contractsForPublishedReaders(feed:ContractFeed,winners:PredictionMarketFeed,games:DailyEdgeGameDto[],now=Date.now()):ContractFeed {
  const wanted=new Set<string>();
  for(const game of games){
    const selection=readerHistoryContractSelection(game,feed.kind==="total"?"total":"first_inning");if(!selection||selection.kind!==feed.kind)continue;
    const match=matchPredictionMarketGame(winners,{sport:feed.sport,awayTeam:game.awayTeam,homeTeam:game.homeTeam,gameStartAt:game.gameStartAt??"",awayName:game.awayTeamDisplayName,homeName:game.homeTeamDisplayName,awayCollege:game.cbbAwayCollege,homeCollege:game.cbbHomeCollege,lockState:game.lockState,lockedAt:game.lockedAt},now);
    const resolved=resolveReaderContract(feed,match,selection,now);
    resolved?.context?.sources.forEach(row=>wanted.add(row.ticker));
  }
  return {...feed,rows:feed.rows.filter(row=>wanted.has(row.ticker))};
}
