"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import { readerContractSelection, type ReaderMarketMatch, type ReaderOutcome } from "@/lib/providers/owls/predictionMarketContracts";
import { predictionMarketBookTrail, predictionMarketChartSeries, predictionMarketChartDomain, predictionMarketCurve, predictionMarketObservationAt, formatPredictionMarketOdds, selectedPredictionMarketOutcome, type PredictionMarketBookTrail } from "@/app/lab/lib/predictionMarketDisplay";

const cache = new Map<string, { at:number; value:ReaderMarketMatch | null; pending?:Promise<ReaderMarketMatch | null> }>();
function load(key: string): Promise<ReaderMarketMatch | null> {
  const stored = cache.get(key);
  if (stored?.pending) return stored.pending;
  if (stored && Date.now()-stored.at < 30_000) return Promise.resolve(stored.value);
  const pending = fetch(key, {signal:AbortSignal.timeout(8000)})
    .then(async response => {
      if (!response.ok) throw new Error("Prediction market read unavailable");
      return (await response.json() as {market:ReaderMarketMatch | null}).market;
    })
    .then(value => { cache.set(key,{at:Date.now(),value}); return value; })
    .catch(error => { if (stored) cache.set(key,{...stored,pending:undefined}); else cache.delete(key); throw error; });
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  cache.set(key,{at:stored?.at ?? 0,value:stored?.value ?? null,pending});
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
  const [receipt,setReceipt]=useState<{key:string;market:ReaderMarketMatch|null;checkedAt:number}|null>(null);
  const sport=game.sport==="soccer"&&(game.id.startsWith("soccer-ucl-")||game.soccerCompetitionContext?.competition==="uefa_champions_league")?"ucl":game.sport;
  const selection=readerContractSelection(game,marketKey),kind=marketKey==="moneyline"?"moneyline":selection?.kind??null;
  const query=new URLSearchParams({sport,away:game.awayTeam,home:game.homeTeam,start:game.gameStartAt??"",market:kind??"unsupported",display:"market-contracts-v1"});
  if(selection){query.set("side",selection.side);if(selection.line!==null)query.set("line",String(selection.line));}
  if(game.awayTeamDisplayName)query.set("awayName",game.awayTeamDisplayName);
  if(game.homeTeamDisplayName)query.set("homeName",game.homeTeamDisplayName);
  const key="/api/lab/prediction-market?"+query;
  const coveredCompetition=game.sport!=="soccer"||game.id.startsWith("soccer-epl-")||game.id.startsWith("soccer-ucl-")||["english_premier_league","uefa_champions_league"].includes(game.soccerCompetitionContext?.competition??"");
  const enabled=kind!==null&&!illustrativeSample&&!!game.gameStartAt&&game.sport!=="cbb"&&coveredCompetition;
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    const update=()=>{
      if(document.hidden)return;
      void load(key).then(market=>{if(active)setReceipt({key,market,checkedAt:Date.now()});}).catch(()=>{
        if(active)setReceipt(previous=>previous?.key===key?{...previous,checkedAt:Date.now()}:previous);
      });
    };
    update();
    const interval=window.setInterval(update,60_000);
    document.addEventListener("visibilitychange",update);
    return()=>{active=false;window.clearInterval(interval);document.removeEventListener("visibilitychange",update);};
  },[key,enabled]);
  if(!enabled||!receipt||receipt.key!==key||!receipt.market)return null;
  const market=receipt.market;
  const selectedMarket=game.markets[marketKey];
  const outcome=selectedPredictionMarketOutcome(market,selectedMarket.pick);
  if(!outcome||receipt.checkedAt-Date.parse(market.asOf)>24*60*60_000)return null;
  const retained=receipt.checkedAt-Date.parse(market.asOf)>10*60_000;
  const book=predictionMarketBookTrail(selectedMarket,marketKey==="moneyline"?outcome.label:selectedMarket.pick??"",receipt.checkedAt,selection?.line??null);
  const context=market.context,bookLabel=context?.requestedLabel??"moneyline";
  const history=predictionMarketChartSeries(outcome).points;
  const delta=history.length>=2?100*(history.at(-1)![1]-history[0][1]):null;
  const bookName=book?bookTitle(book.sportsbook):null;
  const firstBook=book?.points[0],lastBook=book?.points.at(-1);
  const changes=book?.points.reduce((count,point,index)=>count+Number(index>0&&point[2]!==book.points[index-1][2]),0)??0;
  const legend=<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#b9acc7] sm:pl-[26px]">
    <span className="inline-flex items-center gap-1"><i className="h-0.5 w-2.5 bg-[#7de3c1]"/>Kalshi{context?.method==="push_adjusted"?" · push-adjusted":context?.method==="nearby"?" · nearby line":""}</span>
    {book?<span className="inline-flex items-center gap-1"><i className="h-0.5 w-2.5 bg-[#b7a0f4]"/>{bookName} {bookLabel}</span>:<span>Book history unavailable</span>}
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
        <strong className="text-[17px] font-bold tracking-tight text-[#e9e2f3]">{outcome.label} {(outcome.probability*100).toFixed(1)}%</strong>
        <span className="block text-[10px] text-[#b2cbbc]">{delta===null?"History building":(delta>0?"↑ ":delta<0?"↓ ":"↔ ")+Math.abs(delta).toFixed(1)+" percentage points · Kalshi"}</span>
      </div>
      {legend}
      {context?.note?<p className="mt-1 text-[9px] leading-relaxed text-[#ac9bbd] sm:pl-[26px]">{context.note}</p>:null}
    </div>
    <div className="mt-1 min-w-0 sm:mt-0"><PredictionMarketChart row={outcome} book={book} context={context}/></div>
    <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-white/[0.04] pt-2 text-[10px] text-[#b1a1bf] sm:mt-0 sm:block sm:space-y-1.5 sm:border-0 sm:pt-0">
      {book&&firstBook&&lastBook?<p className="min-w-0" data-book-movement={book.sportsbook}><span className="font-semibold text-[#d9d1e4]">{bookName} {formatPredictionMarketOdds(firstBook[2])}{changes>0?" → "+formatPredictionMarketOdds(lastBook[2]):" · unchanged"}</span><span className="block text-[#9d92ae]">{changes>0?changes+" recorded "+(changes===1?"move":"moves"):"No price change in shown window"} · same book</span></p>:null}
      {outcome.volume24h!==null?<p><span className="font-semibold text-[#d9d1e4]">{compact(outcome.volume24h)}</span> {context?.method==="push_adjusted"?"source contracts":"contracts"} · 24h</p>:null}
      <p className="w-full text-[#9d92ae]">{retained?"Last available":"Quotes"} · Kalshi {time(Date.parse(market.asOf))}{lastBook?" · "+bookName+" "+time(lastBook[0])+(book?.locked?" locked":""):""}</p>
    </div>
  </section>;
}

function PredictionMarketChart({row,book,context}:{row:ReaderOutcome;book:PredictionMarketBookTrail|null;context:ReaderMarketMatch["context"]}) {
  const ref=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(300);
  const [focus,setFocus]=useState<{at:number;pinned:boolean}|null>(null);
  const id=useId();
  useEffect(()=>{
    const element=ref.current;if(!element)return;
    const observer=new ResizeObserver(entries=>setWidth(Math.max(120,entries[0].contentRect.width)));
    observer.observe(element);return()=>observer.disconnect();
  },[]);
  const {points,activity}=predictionMarketChartSeries(row);
  const bookPoints=book?.points??[];
  const allPoints=[...points,...bookPoints];
  const first=Math.min(...allPoints.map(point=>point[0])),last=Math.max(...allPoints.map(point=>point[0]));
  const [low,high]=predictionMarketChartDomain(allPoints);
  const left=36,right=width-8,top=8,bottom=61;
  const x=(at:number)=>first===last?right:left+(at-first)/(last-first)*(right-left);
  const y=(p:number)=>bottom-(p*100-low)/Math.max(.5,high-low)*(bottom-top);
  const maxActivity=Math.max(1,...activity.map(value=>value??0));
  // Like the sportsbook curve, connect the recorded anchors without creating
  // intermediate quotes. Inspection always returns the original observation.
  const curve=predictionMarketCurve(points,x,y,Infinity,bottom);
  const bookCurve=predictionMarketCurve(bookPoints,x,y);
  const fillId=`${id}-fill`;
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
    <svg width="100%" height="108" viewBox={"0 0 "+width+" 108"} role="img" aria-labelledby={id}>
      <title id={id}>{row.team} {context?.method==="push_adjusted"?"push-adjusted from surrounding Kalshi contracts":"recorded quotes"}. Mint: Kalshi. {book?bookTitle(book.sportsbook)+" "+(context?.requestedLabel??"moneyline")+" in violet, with sportsbook margin. ":""}{context?.method==="nearby"?"Nearby line: not the identical sportsbook wager. ":""}Curves connect recorded observations, including unsampled intervals; they are not continuous price updates. Inspect for exact recorded prices and timestamps. Bars show actual trading activity only where recorded.</title>
      <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7de3c1" stopOpacity=".14"/><stop offset="1" stopColor="#7de3c1" stopOpacity="0"/></linearGradient></defs>
      {[low,(low+high)/2,high].map(tick=><g key={tick}><line x1={left} x2={right} y1={y(tick/100)} y2={y(tick/100)} stroke="rgba(255,255,255,.05)"/><text x="0" y={y(tick/100)+4} fill="#ac9dbd" fontSize="11">{tick.toFixed(tick%1?1:0)}%</text></g>)}
      <path data-kalshi-area d={curve.area} fill={`url(#${fillId})`}/>
      <path data-kalshi-line d={curve.line} fill="none" stroke="#7de3c1" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"/>
      {book?<path data-sportsbook-line={book.sportsbook} d={bookCurve.line} fill="none" stroke="#b7a0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>:null}
      {bookPoints.map((point,index)=><circle key={point[0]} data-book-odds={point[2]} data-observed-at={point[0]} cx={x(point[0])} cy={y(point[1])} r={index===bookPoints.length-1?2.5:index===0?1.5:0} fill="#b7a0f4"/>)}
      {points.map((point,index)=><g key={point[0]}>{activity[index]!==null?<rect x={Math.max(left,x(point[0])-2.5)} y={87-activity[index]!/maxActivity*13} width={Math.min(5,right-Math.max(left,x(point[0])-2.5))} height={activity[index]!/maxActivity*13} rx="1" fill="#7de3c1" opacity=".3"/>:null}{(index===0||index===points.length-1)?<circle cx={x(point[0])} cy={y(point[1])} r={index===points.length-1?2.5:1.5} fill="#7de3c1"/>:null}</g>)}
      <text x={left} y="103" fill="#ac9dbd" fontSize="11">{time(first,earlierDay)}</text><text x={right} y="103" textAnchor="end" fill="#ac9dbd" fontSize="11">Latest</text>
      {at!==null?<g><line x1={x(at)} x2={x(at)} y1={top} y2="89" stroke="#ffffff35"/>{active?<circle cx={x(active[0])} cy={y(active[1])} r="3" fill="#7de3c1"/>:null}{activeBook?<circle cx={x(activeBook[0])} cy={y(activeBook[1])} r="3" fill="#b7a0f4"/>:null}</g>:null}
      <rect x={left} y={top} width={right-left} height="82" fill="transparent" tabIndex={0} role="button" aria-label="Inspect recorded Kalshi and sportsbook quotes. Tap to pin; arrow keys inspect observations."
        onPointerMove={event=>{if(!focus?.pinned)setFocus({at:cursorAt(event),pinned:false});}}
        onPointerDown={event=>setFocus({at:cursorAt(event),pinned:!focus?.pinned})}
        onPointerLeave={()=>{if(!focus?.pinned)setFocus(null);}}
        onBlur={()=>setFocus(null)}
        onKeyDown={event=>{
          if(event.key==="Escape"){setFocus(null);return;}
          if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
          event.preventDefault();
          const times=[...new Set(allPoints.map(point=>point[0]))].sort((a,b)=>a-b);
          const next=event.key==="Home"?first:event.key==="End"?last:event.key==="ArrowLeft"?[...times].reverse().find(t=>t<(at??last))??first:times.find(t=>t>(at??first))??last;
          setFocus({at:next,pinned:true});
        }}/>
    </svg>
    {focus?<div className="pointer-events-none absolute left-8 right-0 top-0 z-10 rounded border border-white/10 bg-[#211b2c] px-2 py-1 text-[10px] text-[#e5dced]">
      <p>{active?"Kalshi "+(context?.method==="push_adjusted"?"push-adjusted ":"")+(active[1]*100).toFixed(1)+"% · "+time(active[0]):"Kalshi · no earlier quote recorded"}</p>
      {book?<p>{activeBook?bookTitle(book.sportsbook)+" "+formatPredictionMarketOdds(activeBook[2])+" · "+(activeBook[1]*100).toFixed(1)+"% implied · "+time(activeBook[0]):bookTitle(book.sportsbook)+" · no earlier quote recorded"}</p>:null}
      {activeIndex>=0&&activity[activeIndex]!==null?<p>{compact(activity[activeIndex]!)} contracts · recorded interval</p>:null}
      {context?.method==="push_adjusted"?<p>Push excluded using the surrounding half-point contracts; not a directly traded quote.</p>:context?.method==="nearby"?<p>Kalshi {context.displayLabel} · sportsbook {context.requestedLabel}</p>:null}
    </div>:null}
  </div>;
}
