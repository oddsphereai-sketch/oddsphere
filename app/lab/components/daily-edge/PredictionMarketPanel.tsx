"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import { readerContractSelection, type ReaderMarketMatch, type ReaderOutcome } from "@/lib/providers/owls/predictionMarketContracts";
import { predictionMarketReaderBookTrail, predictionMarketComparisonBook, predictionMarketComparison, predictionMarketLockBoundary, predictionMarketGuidePoints, predictionMarketWindowPoints, predictionMarketChartDomain, predictionMarketCurve, predictionMarketBookStart, predictionMarketWindowDuration, predictionMarketBookPricePath, predictionMarketObservationAt, formatPredictionMarketOdds, selectedPredictionMarketOutcome, type PredictionMarketBookTrail } from "@/app/lab/lib/predictionMarketDisplay";
import {formatContractLine} from "@/lib/providers/owls/predictionMarketContracts";

type Receipt={market:ReaderMarketMatch|null;book:PredictionMarketBookTrail|null;availability?:string};
const cache = new Map<string, { at:number; value:Receipt; pending?:Promise<Receipt> }>();
function load(key: string): Promise<Receipt> {
  const stored = cache.get(key);
  if (stored?.pending) return stored.pending;
  if (stored && Date.now()-stored.at < 30_000) return Promise.resolve(stored.value);
  const pending = fetch(key, {signal:AbortSignal.timeout(8000)})
    .then(async response => {
      if (!response.ok) throw new Error("Prediction market read unavailable");
      return await response.json() as Receipt;
    })
    .then(value => { cache.set(key,{at:Date.now(),value}); return value; })
    .catch(error => { if (stored) cache.set(key,{...stored,pending:undefined}); else cache.delete(key); throw error; });
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  cache.set(key,{at:stored?.at ?? 0,value:stored?.value ?? {market:null,book:null},pending});
  return pending;
}
function time(at:number,includeDate=false):string {
  return new Date(at).toLocaleString([],includeDate?{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}:{hour:"numeric",minute:"2-digit"});
}
function compact(value:number):string {return new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(value);}
function bookTitle(value:string):string {
  return ({circa:"Circa",pinnacle:"Pinnacle",betmgm:"BetMGM",betrivers:"BetRivers",draftkings:"DraftKings",fanduel:"FanDuel"} as Record<string,string>)[value] ?? value.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

export default function PredictionMarketPanel({game,marketKey,variant,illustrativeSample=false}:{
  game:DailyEdgeGameDto;marketKey:keyof DailyEdgeGameDto["markets"];variant:"mobile"|"desktop";illustrativeSample?:boolean;
}) {
  const [receipt,setReceipt]=useState<Receipt&{key:string;checkedAt:number}|null>(null);
  const [range,setRange]=useState<"all"|"24h">("all");
  const sport=game.sport==="soccer"&&(game.id.startsWith("soccer-ucl-")||game.soccerCompetitionContext?.competition==="uefa_champions_league")?"ucl":game.sport;
  const selection=readerContractSelection(game,marketKey),kind=marketKey==="moneyline"?"moneyline":selection?.kind??null;
  const query=new URLSearchParams({sport,away:game.awayTeam,home:game.homeTeam,start:game.gameStartAt??"",market:kind??"unsupported",event:String(game.external_id),display:"opening-history-v2"});
  if(selection){query.set("side",selection.side);if(selection.line!==null)query.set("line",String(selection.line));}
  else if(kind==="moneyline"){
    const pick=game.markets.moneyline.pick?.replace(/\s+ML$/i,"").trim().toUpperCase();
    if(pick===game.awayTeam.toUpperCase())query.set("side","away");
    else if(pick===game.homeTeam.toUpperCase())query.set("side","home");
    else if(pick==="DRAW"||pick==="TIE")query.set("side","draw");
  }
  if(game.awayTeamDisplayName)query.set("awayName",game.awayTeamDisplayName);
  if(game.homeTeamDisplayName)query.set("homeName",game.homeTeamDisplayName);
  const key="/api/lab/prediction-market?"+query;
  const coveredCompetition=game.sport!=="soccer"||game.id.startsWith("soccer-epl-")||game.id.startsWith("soccer-ucl-")||["english_premier_league","uefa_champions_league"].includes(game.soccerCompetitionContext?.competition??"");
  const enabled=!illustrativeSample&&!!game.gameStartAt&&game.sport!=="cbb"&&coveredCompetition;
  useEffect(()=>{
    if(!enabled||kind===null)return;
    let active=true;
    const update=()=>{
      if(document.hidden)return;
      void load(key).then(value=>{if(active)setReceipt(previous=>!value.market&&previous?.key===key&&previous.market?{...previous,availability:"refresh_failed",checkedAt:Date.now()}:{...value,key,checkedAt:Date.now()});}).catch(()=>{
        if(active)setReceipt(previous=>previous?.key===key?{...previous,availability:"refresh_failed",checkedAt:Date.now()}:{market:null,book:null,key,availability:"refresh_failed",checkedAt:Date.now()});
      });
    };
    update();
    const interval=window.setInterval(update,60_000);
    document.addEventListener("visibilitychange",update);
    return()=>{active=false;window.clearInterval(interval);document.removeEventListener("visibilitychange",update);};
  },[key,enabled,kind]);
  if(!enabled)return null;
  const current=receipt?.key===key?receipt:null;
  const marketLabel=kind==="total"?"Total":kind==="spread"?(game.sport==="nhl"?"Puck line":"Spread"):kind==="btts"?"Both teams to score":marketKey==="first_inning"?"First inning":"Game winner";
  if(kind===null||!current?.market)return <PredictionMarketUnavailable variant={variant} label={selection?.label??marketLabel} status={kind===null?(game.sport==="mlb"&&marketKey==="first_inning"?"unsupported":"selection_pending"):current?.availability??(current?"contract_unavailable":"loading")} book={current?.book??null}/>;
  const market=current.market;
  const selectedMarket=game.markets[marketKey];
  const outcome=selectedPredictionMarketOutcome(market,selectedMarket.pick);
  if(!outcome||current.checkedAt-Date.parse(market.asOf)>24*60*60_000)return <PredictionMarketUnavailable variant={variant} label={selection?.label??marketLabel} status="feed_unavailable" book={current.book}/>;
  const retained=current.checkedAt-Date.parse(market.asOf)>10*60_000;
  const lockedAt=predictionMarketLockBoundary(game,current.checkedAt),frozen=lockedAt!==undefined;
  const storedBook=predictionMarketReaderBookTrail(selectedMarket,marketKey==="moneyline"?outcome.label:selectedMarket.pick??"",frozen?lockedAt:current.checkedAt,selection?.line??null);
  const book=predictionMarketComparisonBook(game.lockState==="locked"||frozen,storedBook,current.book??null);
  const context=market.context;
  const differentBookLine=!!book&&book.line!==undefined&&book.line!==(selection?.line??null);
  const bookLabel=differentBookLine?(kind==="total"?`${selection?.side==="under"?"Under":"Over"} ${book!.line}`:`${selection?.side==="away"?game.awayTeam:game.homeTeam} ${formatContractLine(book!.line!)}`):context?.requestedLabel??"moneyline";
  const comparison=predictionMarketComparison(outcome,book,lockedAt);
  if(!comparison.points.length)return <PredictionMarketUnavailable variant={variant} label={selection?.label??marketLabel} status={frozen?"prelock_unavailable":"history_unavailable"} book={null}/>;
  const chartStart=range==="24h"&&comparison.cutoff!==null?Math.max(comparison.start,comparison.cutoff-24*60*60_000):comparison.start;
  const history=chartStart===comparison.cutoff?comparison.points.slice(-1):predictionMarketWindowPoints(comparison.points,chartStart);
  const comparisonOutcome={...outcome,probability:history.at(-1)?.[1]??outcome.probability};
  const delta=history.length>=2?100*(history.at(-1)![1]-history[0][1]):null;
  const bookName=book?bookTitle(book.sportsbook):null;
  const comparedBook=book&&comparison.bookPoints.length?{...book,points:comparison.bookPoints}:null;
  const firstBook=comparedBook?.points[0],lastBook=comparedBook?.points.at(-1);
  const kalshiOpening=outcome.openingQuote&&outcome.openingQuote.point[0]<=(comparison.cutoff??lockedAt??current.checkedAt)?outcome.openingQuote:null;
  const kalshiStart=kalshiOpening?.point??comparison.points[0];
  const bookStart=comparedBook?predictionMarketBookStart(selectedMarket,marketKey==="moneyline"?outcome.label:selectedMarket.pick??"",comparedBook,selection?.line??null,comparison.cutoff??lockedAt??current.checkedAt):null;
  const changes=comparedBook?.points.reduce((count,point,index)=>count+Number(index>0&&point[2]!==comparedBook.points[index-1][2]),0)??0;
  const legend=<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#b9acc7] sm:pl-[26px]">
    <span className="inline-flex items-center gap-1"><i className="h-0.5 w-2.5 bg-[#7de3c1]"/>Kalshi{context?.method==="push_adjusted"?" · push-adjusted":context?.method==="nearby"?" · nearby line":""}</span>
    {book?<span className="inline-flex items-center gap-1"><i className="h-0.5 w-2.5 bg-[#b7a0f4]"/>{bookName} {bookLabel}</span>:<span>Sportsbook quote unavailable</span>}
  </div>;
  return <section aria-label={`Prediction market · ${context?.kind??"game winner"}`} data-prediction-market={variant} data-prediction-market-kind={context?.kind??"moneyline"} data-contract-method={context?.method??"exact"}
    className={variant==="mobile"?"sm:hidden rounded-lg border border-white/[0.07] bg-[#0d0b13] p-3":"hidden sm:grid grid-cols-[minmax(170px,.9fr)_minmax(0,1.7fr)_minmax(150px,.85fr)] items-center gap-x-5 border-y border-white/[0.07] bg-[#0d0b13] px-5 py-3"}>
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span aria-hidden="true" className="inline-flex h-[19px] w-[19px] items-center justify-center rounded bg-[#7de3c1]/15 text-[11px] font-bold text-[#a8e7d3]">K</span>
        <h4 className="text-[11px] font-bold text-[#d9d1e4]">Prediction market</h4>
        <span className="ml-auto text-[10px] text-[#ac9bbd] sm:ml-0 sm:w-full sm:pl-[26px]">{context?.kind==="spread"?(game.sport==="nhl"?"Puck line":"Spread"):context?.kind==="total"?"Total":context?.kind==="btts"?"Both teams to score":"Game winner"}{game.sport==="soccer"?" · 90 minutes":""}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1 sm:block sm:pl-[26px]">
        <strong className="text-[17px] font-bold tracking-tight text-[#e9e2f3]">{outcome.label} {(comparisonOutcome.probability*100).toFixed(1)}%</strong>
        <span className="block text-[10px] text-[#b2cbbc]">{delta===null?"History building":(delta>0?"↑ ":delta<0?"↓ ":"↔ ")+Math.abs(delta).toFixed(1)+" pp · chart window"}</span>
      </div>
      {legend}
      {context?.note?<p className="mt-1 text-[9px] leading-relaxed text-[#ac9bbd] sm:pl-[26px]">{context.note}</p>:null}
      {differentBookLine?<p className="mt-1 text-[9px] text-[#ac9bbd] sm:pl-[26px]">{game.lockState==="locked"?"Stored book line":"Book line moved"} · {bookLabel}, not {context?.requestedLabel}</p>:null}
    </div>
    <div className="mt-1 min-w-0 sm:mt-0"><PredictionMarketChart row={outcome} book={book} context={context} bookLabel={bookLabel} lockedAt={lockedAt} range={range} onRangeChange={setRange}/></div>
    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-white/[0.04] pt-2 text-[10px] text-[#b1a1bf] sm:mt-0 sm:block sm:space-y-2 sm:border-0 sm:pt-0">
      <p data-kalshi-start data-start-kind={kalshiOpening?.kind??"first_available"} data-start-at={kalshiStart[0]} className="min-w-0"><span className="font-semibold text-[#d9d1e4]">Kalshi {kalshiOpening?.kind==="opening_minute"?"opening minute":"first quoted"} · {(kalshiStart[1]*100).toFixed(1)}%</span><span className="block text-[#ac9bbd]">{time(kalshiStart[0],true)}</span><span className="block text-[#9d92ae]">{outcome.historyFrom?"History checked from market open":"Opening history pending"}{kalshiOpening?.kind==="first_available"?" · opening quote unavailable":""}</span></p>
      {comparedBook&&firstBook&&lastBook?<p className="min-w-0" data-book-movement={comparedBook.sportsbook} data-book-start data-start-kind={bookStart?.kind} data-start-at={bookStart?.point[0]}><span className="font-semibold text-[#d9d1e4]">{bookName} {predictionMarketBookPricePath(comparedBook.points)}{changes>0?"":comparedBook.points.length===1?" · one quote":" · unchanged"}</span>{bookStart?<><span className="block text-[#ac9bbd]">{bookStart.kind==="provider_opening"?"Provider open":"First recorded"} {formatPredictionMarketOdds(bookStart.point[2])}</span><span className="block text-[#ac9bbd]">{time(bookStart.point[0],true)}</span></>:null}{!frozen&&book?.opening&&book.opening.line!==(book.line??selection?.line??null)?<span className="block text-[#ac9bbd]">Market opened {kind==="total"?book.opening.line:formatContractLine(book.opening.line!)} · {formatPredictionMarketOdds(book.opening.point[2])} · {time(book.opening.point[0],true)}; chart is {bookLabel}</span>:null}<span className="block text-[#9d92ae]">{comparedBook.points.length===1?"History building":changes>0?changes+" recorded "+(changes===1?"move":"moves"):"No recorded price change"} · same book</span></p>:null}
      {!frozen&&book?<BookLineHistory book={book} kind={kind}/>:null}
      {!frozen&&outcome.volume24h!==null?<p className="col-span-2"><span className="font-semibold text-[#d9d1e4]">{compact(outcome.volume24h)}</span> {context?.method==="push_adjusted"?"source contracts":"contracts"} · 24h</p>:null}
      <p className="col-span-2 text-[#9d92ae]">{current.availability==="refresh_failed"?"Refresh unavailable · retained quotes · ":""}{frozen?"Pre-lock history · through "+time(comparison.cutoff??comparison.points.at(-1)![0]):comparison.cutoff!==null?"Compared through "+time(comparison.cutoff)+(book?.locked?" · frozen reference":""):comparison.pending?"Waiting for overlapping quotes":retained?"Last available Kalshi · "+time(Date.parse(market.asOf)):"Kalshi · "+time(Date.parse(market.asOf))}</p>
    </div>
  </section>;
}

export function PredictionMarketUnavailable({variant,label,status,book}:{variant:"mobile"|"desktop";label:string;status:string;book:PredictionMarketBookTrail|null}){
  const message=status==="loading"?"Loading this market…":status==="selection_pending"?"Waiting for this selection’s sportsbook line before matching a Kalshi contract.":status==="unsupported"?"No matching Kalshi market supported for this selection.":status==="prelock_unavailable"?"No eligible pre-lock prediction-market quotes were recorded.":["refresh_failed","feed_unavailable","market_feed_unavailable"].includes(status)?"Prediction-market feed temporarily unavailable. Retrying automatically.":status==="history_unavailable"?"Matching contract found; quote history is building.":"No matching Kalshi contract is currently available. Updates automatically when one arrives.";
  const bookLabel=book?.line===null||book?.line===undefined?label:/^(Over|Under) /.test(label)?label.replace(/\d+(?:\.\d+)?$/,String(book.line)):label.replace(/(?:[+−-]?\d+(?:\.\d+)?|PK)$/i,formatContractLine(book.line));
  return <section aria-label={`Prediction market · ${label}`} data-prediction-market={variant} data-prediction-market-availability={status} className={variant==="mobile"?"sm:hidden rounded-lg border border-white/[0.07] bg-[#0d0b13] p-3":"hidden sm:flex items-center gap-4 border-y border-white/[0.07] bg-[#0d0b13] px-5 py-3"}>
    <div className="min-w-0"><h4 className="text-[11px] font-bold text-[#d9d1e4]">Prediction market <span className="ml-2 font-normal text-[#ac9bbd]">{label}</span></h4><p className="mt-1 text-[10px] text-[#ac9bbd]">{message}</p></div>
    {book?<div className="mt-2 text-[10px] text-[#b7a0f4] sm:ml-auto sm:mt-0"><p>{bookTitle(book.sportsbook)} {bookLabel} · {predictionMarketBookPricePath(book.points)} · same book</p>{book.opening?<p className="mt-1 text-[#ac9bbd]">Provider open {book.opening.line===null?"":book.opening.line+" · "}{formatPredictionMarketOdds(book.opening.point[2])} · {time(book.opening.point[0],true)}</p>:null}<BookLineHistory book={book} kind={/^(Over|Under) /.test(label)?"total":"spread"}/></div>:null}
  </section>;
}

/** Point movement has its OWN numeric axis. It never becomes a probability
 * quote for a different threshold in the two-source comparison above. */
export function BookLineHistory({book,kind}:{book:PredictionMarketBookTrail;kind:string|null}){
  if(kind!=="spread"&&kind!=="total")return null;
  const quotes=[...new Map((book.marketHistory??[]).map(p=>[p[0],p])).values()].filter((p):p is [number,number,number]=>p[2]!==null).sort((a,b)=>a[0]-b[0]),lines=quotes.map(p=>p[2]);
  if(new Set(lines).size<2)return null;
  const first=quotes[0],last=quotes.at(-1)!,low=Math.min(...lines),high=Math.max(...lines);
  const points=quotes.map(p=>[p[0],p[2]] as [number,number]),x=(at:number)=>4+(at-first[0])/Math.max(1,last[0]-first[0])*172,y=(line:number)=>24-(line-low)/Math.max(.01,high-low)*20;
  const lineText=(line:number)=>kind==="total"?String(line):formatContractLine(line);
  const title=quotes.filter((p,i)=>i===0||i===quotes.length-1||p[2]!==quotes[i-1][2]).map(p=>`${time(p[0],true)}: ${lineText(p[2])} at ${formatPredictionMarketOdds(p[1])}`).join("; ");
  return <div className="col-span-2 min-w-0" data-book-line-history={book.sportsbook}><p className="text-[10px] text-[#ac9bbd]">{kind==="total"?"Total":"Spread"} line {lineText(first[2])} → {lineText(last[2])}</p><svg role="img" aria-label={`${bookTitle(book.sportsbook)} same-book ${kind} line movement`} width="100%" height="24" viewBox="0 0 180 28" preserveAspectRatio="none"><title>{title}</title><path d={predictionMarketCurve(points,x,y).line} fill="none" stroke="#b7a0f4" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></div>;
}

export function PredictionMarketChart({row,book,context,bookLabel,lockedAt,range="all",onRangeChange}:{row:ReaderOutcome;book:PredictionMarketBookTrail|null;context:ReaderMarketMatch["context"];bookLabel:string;lockedAt?:number;range?:"all"|"24h";onRangeChange?:(range:"all"|"24h")=>void}) {
  const ref=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(300);
  const [focus,setFocus]=useState<{at:number;pinned:boolean}|null>(null);
  const id=useId();
  useEffect(()=>{
    const element=ref.current;if(!element)return;
    const observer=new ResizeObserver(entries=>setWidth(Math.max(120,entries[0].contentRect.width)));
    observer.observe(element);return()=>observer.disconnect();
  },[]);
  const {points,activity,bookPoints,cutoff,start}=predictionMarketComparison(row,book,lockedAt);
  const allPoints=[...points,...bookPoints];
  const last=cutoff??Math.max(...allPoints.map(point=>point[0]));
  const first=range==="24h"?Math.max(start,last-24*60*60_000):start;
  const plotPoints=predictionMarketGuidePoints(points,first,last);
  const plotBook=predictionMarketGuidePoints(bookPoints,first,last);
  const [low,high]=predictionMarketChartDomain([...plotPoints,...plotBook]);
  const left=36,right=Math.max(left+10,width-40),top=10,bottom=96;
  const x=(at:number)=>first===last?right:left+(at-first)/(last-first)*(right-left);
  const y=(p:number)=>bottom-(p*100-low)/Math.max(.5,high-low)*(bottom-top);
  // Both sources share one continuous bounded guide treatment. Guide edges
  // are display-only; inspection below always uses the original observations.
  const curve=predictionMarketCurve(plotPoints,x,y,Infinity,bottom);
  const bookCurve=predictionMarketCurve(plotBook,x,y,Infinity,bottom);
  const fillId=`${id}-fill`,bookFillId=`${id}-book-fill`,clipId=`${id}-clip`;
  const at=focus?Math.max(first,Math.min(last,focus.at)):null;
  const active=at===null?null:predictionMarketObservationAt(points,at);
  const activeBook=at===null?null:predictionMarketObservationAt(bookPoints,at);
  const activeIndex=active?points.indexOf(active):-1;
  const cursorAt=(event:ReactPointerEvent<SVGRectElement>)=>{
    const rect=event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const svgX=(event.clientX-rect.left)*width/rect.width;
    return first+Math.max(0,Math.min(1,(svgX-left)/(right-left)))*(last-first);
  };
  const earlierDay=new Date(first).toLocaleDateString()!==new Date(last).toLocaleDateString();
  return <div ref={ref} className="relative min-w-0">
    <svg width="100%" height="128" viewBox={"0 0 "+width+" 128"} role="img" aria-labelledby={id} data-comparison-start={first} data-comparison-cutoff={cutoff} data-lock-boundary={lockedAt} data-chart-treatment="shared-continuous-guides">
      <title id={id}>{row.team} {context?.method==="push_adjusted"?"push-adjusted from surrounding Kalshi contracts":"recorded quotes"}. Mint: Kalshi. {book?bookTitle(book.sportsbook)+" "+bookLabel+" in violet, with sportsbook margin. ":""}{context?.method==="nearby"?"Nearby line: not the identical sportsbook wager. ":""}Both sources share the same covered time window. Curves are bounded guides between recorded quotes, not additional observations. Boundary edges hold an already recorded value without changing its timestamp. Inspect for exact original prices and times.</title>
      <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7de3c1" stopOpacity=".12"/><stop offset="1" stopColor="#7de3c1" stopOpacity="0"/></linearGradient><linearGradient id={bookFillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b7a0f4" stopOpacity=".1"/><stop offset="1" stopColor="#b7a0f4" stopOpacity="0"/></linearGradient><clipPath id={clipId}><rect x={left-3} y={top-4} width={right-left+6} height={bottom-top+8}/></clipPath></defs>
      {[low,(low+high)/2,high].map(tick=><g key={tick}><line x1={left} x2={right} y1={y(tick/100)} y2={y(tick/100)} stroke="rgba(255,255,255,.05)"/><text x="0" y={y(tick/100)+4} fill="#ac9dbd" fontSize="11">{tick.toFixed(tick%1?1:0)}%</text></g>)}
      <g clipPath={`url(#${clipId})`}>
      <path data-sportsbook-area d={bookCurve.area} fill={`url(#${bookFillId})`}/>
      <path data-kalshi-area d={curve.area} fill={`url(#${fillId})`}/>
      <path data-kalshi-line d={curve.line} fill="none" stroke="#7de3c1" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"/>
      {bookPoints.length?<path data-sportsbook-line={book!.sportsbook} d={bookCurve.line} fill="none" stroke="#b7a0f4" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"/>:null}
      {/* Original receipts remain inspectable, distinct from the boundary guides. */}
      {bookPoints.filter(point=>point[0]>=first).map(point=><circle key={point[0]} data-book-odds={point[2]} data-observed-at={point[0]} cx={x(point[0])} cy={y(point[1])} r="0" fill="#b7a0f4"/>)}
      {plotPoints.at(-1)?<circle data-kalshi-end cx={right} cy={y(plotPoints.at(-1)![1])} r="2.8" fill="#7de3c1"/>:null}
      {plotBook.at(-1)?<circle data-sportsbook-end cx={right} cy={y(plotBook.at(-1)![1])} r="2.8" fill="#b7a0f4"/>:null}
      </g>
      {plotBook.at(-1)?<text x={right+7} y={y(plotBook.at(-1)![1])+4} fill="#d8ccec" fontSize="10">{(plotBook.at(-1)![1]*100).toFixed(1)}%</text>:null}
      {plotPoints.at(-1)&&(!plotBook.length||Math.abs(y(plotPoints.at(-1)![1])-y(plotBook.at(-1)![1]))>=13)?<text x={right+7} y={y(plotPoints.at(-1)![1])+4} fill="#d8e9e3" fontSize="10">{(plotPoints.at(-1)![1]*100).toFixed(1)}%</text>:null}
      <text x={left} y="120" fill="#ac9dbd" fontSize="10">{time(first,earlierDay)}</text><text x={right} y="120" textAnchor="end" fill="#ac9dbd" fontSize="10">{time(last)}</text>
      {at!==null?<g clipPath={`url(#${clipId})`}><line x1={x(at)} x2={x(at)} y1={top} y2={bottom} stroke="#ffffff35"/>{active?<circle cx={x(active[0])} cy={y(active[1])} r="3" fill="#7de3c1"/>:null}{activeBook?<circle cx={x(activeBook[0])} cy={y(activeBook[1])} r="3" fill="#b7a0f4"/>:null}</g>:null}
      <rect x={left} y={top} width={right-left} height={bottom-top} fill="transparent" tabIndex={0} role="button" aria-label="Inspect recorded Kalshi and sportsbook quotes. Tap to pin; arrow keys inspect observations."
        onPointerMove={event=>{if(!focus?.pinned)setFocus({at:cursorAt(event),pinned:false});}}
        onPointerDown={event=>setFocus({at:cursorAt(event),pinned:!focus?.pinned})}
        onPointerLeave={()=>{if(!focus?.pinned)setFocus(null);}}
        onBlur={()=>setFocus(null)}
        onKeyDown={event=>{
          if(event.key==="Escape"){setFocus(null);return;}
          if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
          event.preventDefault();
          const times=[...new Set(allPoints.map(point=>point[0]).filter(t=>t>=first&&t<=last))].sort((a,b)=>a-b);
          const next=event.key==="Home"?first:event.key==="End"?last:event.key==="ArrowLeft"?[...times].reverse().find(t=>t<(at??last))??first:times.find(t=>t>(at??first))??last;
          setFocus({at:next,pinned:true});
        }}/>
    </svg>
    <div className="flex flex-wrap items-center justify-between gap-1"><p data-quote-guide-key data-chart-window className="text-[10px] leading-tight text-[#9d92ae]">{range==="24h"?"24h view":lockedAt===undefined&&(row.historyFrom||book?.historyScope)?"Source history":"Shared chart window"} · {predictionMarketWindowDuration(first,last)}<span className="sr-only">. Each source begins at its own first quote; no earlier value is invented. Curves connect recorded quotes.</span></p>{onRangeChange&&last-start>24*60*60_000?<div role="group" aria-label="Prediction market history range" className="flex gap-1 text-[10px]"><button type="button" aria-pressed={range==="all"} onClick={()=>onRangeChange("all")} className={range==="all"?"rounded bg-white/10 px-2 py-1 text-[#e0d7ed]":"rounded px-2 py-1 text-[#9d92ae]"}>Full history</button><button type="button" aria-pressed={range==="24h"} onClick={()=>onRangeChange("24h")} className={range==="24h"?"rounded bg-white/10 px-2 py-1 text-[#e0d7ed]":"rounded px-2 py-1 text-[#9d92ae]"}>24h</button></div>:null}</div>
    {focus?<div className="pointer-events-none absolute left-8 right-0 top-0 z-10 rounded border border-white/10 bg-[#211b2c] px-2 py-1 text-[10px] text-[#e5dced]">
      <p>{active?"Kalshi "+(context?.method==="push_adjusted"?"push-adjusted ":"")+(active[1]*100).toFixed(1)+"% · "+time(active[0]):"Kalshi · no earlier quote recorded"}</p>
      {book?<p>{activeBook?bookTitle(book.sportsbook)+" "+formatPredictionMarketOdds(activeBook[2])+" · "+(activeBook[1]*100).toFixed(1)+"% implied · "+time(activeBook[0]):bookTitle(book.sportsbook)+" · no earlier quote recorded"}</p>:null}
      {activeIndex>=0&&activity[activeIndex]!==null?<p>{compact(activity[activeIndex]!)} contracts · recorded interval</p>:null}
      {context?.method==="push_adjusted"?<p>Push excluded using the surrounding half-point contracts; not a directly traded quote.</p>:context?.method==="nearby"?<p>Kalshi {context.displayLabel} · sportsbook {context.requestedLabel}</p>:null}
      <p>Recorded values and original times. Curves are visual guides between quotes.</p>
      {lockedAt!==undefined?<p>Pre-lock history · no quotes after {time(lockedAt)}.</p>:null}
    </div>:null}
  </div>;
}
