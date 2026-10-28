"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import type { PredictionMarketMatch, PredictionMarketRow } from "@/lib/providers/owls/owlsPredictionMarkets";
import { predictionMarketActivity, predictionMarketPinnacleComparison, selectedPredictionMarketOutcome } from "@/app/lab/lib/predictionMarketDisplay";

const cache = new Map<string, { at:number; value:PredictionMarketMatch | null; pending?:Promise<PredictionMarketMatch | null> }>();
function load(key: string): Promise<PredictionMarketMatch | null> {
  const stored = cache.get(key);
  if (stored?.pending) return stored.pending;
  if (stored && Date.now()-stored.at < 30_000) return Promise.resolve(stored.value);
  const pending = fetch(key, {signal:AbortSignal.timeout(8000)})
    .then(async response => {
      if (!response.ok) throw new Error("Prediction market read unavailable");
      return (await response.json() as {market:PredictionMarketMatch | null}).market;
    })
    .then(value => { cache.set(key,{at:Date.now(),value}); return value; })
    .catch(error => { if (stored) cache.set(key,{...stored,pending:undefined}); else cache.delete(key); throw error; });
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  cache.set(key,{at:stored?.at ?? 0,value:stored?.value ?? null,pending});
  return pending;
}
function time(at: number): string { return new Date(at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}); }
function compact(value: number): string { return new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(value); }

export default function PredictionMarketPanel({game, variant, illustrativeSample = false}: {
  game:DailyEdgeGameDto; variant:"mobile" | "desktop"; illustrativeSample?:boolean;
}) {
  const [receipt,setReceipt] = useState<{key:string;market:PredictionMarketMatch | null;checkedAt:number} | null>(null);
  const sport = game.sport === "soccer" && (game.id.startsWith("soccer-ucl-") || game.soccerCompetitionContext?.competition === "uefa_champions_league") ? "ucl" : game.sport;
  const query = new URLSearchParams({sport,away:game.awayTeam,home:game.homeTeam,start:game.gameStartAt ?? ""});
  if (game.awayTeamDisplayName) query.set("awayName",game.awayTeamDisplayName);
  if (game.homeTeamDisplayName) query.set("homeName",game.homeTeamDisplayName);
  const key = `/api/lab/prediction-market?${query}`;
  const coveredCompetition = game.sport !== "soccer" || game.id.startsWith("soccer-epl-") || game.id.startsWith("soccer-ucl-") || ["english_premier_league","uefa_champions_league"].includes(game.soccerCompetitionContext?.competition ?? "");
  const enabled = !illustrativeSample && !!game.gameStartAt && game.sport !== "cbb" && coveredCompetition;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const update = () => {
      if (document.hidden) return;
      void load(key).then(market => {if(active)setReceipt({key,market,checkedAt:Date.now()});}).catch(() => {
        if(active)setReceipt(previous => previous?.key === key ? {...previous,checkedAt:Date.now()} : previous);
      });
    };
    update();
    const interval = window.setInterval(update,60_000);
    document.addEventListener("visibilitychange",update);
    return () => {active=false;window.clearInterval(interval);document.removeEventListener("visibilitychange",update);};
  },[key,enabled]);
  if (!enabled || !receipt || receipt.key !== key || !receipt.market) return null;
  const market = receipt.market;
  const outcome = selectedPredictionMarketOutcome(market,game.markets.moneyline.pick);
  if (!outcome || receipt.checkedAt-Date.parse(market.asOf) > 24*60*60_000) return null;
  const retained = receipt.checkedAt-Date.parse(market.asOf) > 10*60_000;
  const comparison = predictionMarketPinnacleComparison(game.markets.moneyline,outcome.side,receipt.checkedAt,game.sport === "soccer");
  const history = outcome.history.filter(point => point[0] <= Date.parse(outcome.asOf));
  const delta = history.length >= 2 ? 100*(history.at(-1)![1]-history[0][1]) : null;
  const footer = <><span className="block">{comparison === null ? `${(outcome.bid*100).toFixed(0)}–${(outcome.ask*100).toFixed(0)}¢ bid / ask` : `${Math.abs(100*(outcome.probability-comparison)).toFixed(1)}-point gap · Pinnacle ML ${(comparison*100).toFixed(1)}%`}</span>{outcome.volume24h !== null ? <span className="block">{compact(outcome.volume24h)} contracts traded · 24h</span> : null}</>;
  return <section aria-label="Prediction market · game winner" data-prediction-market={variant}
    className={variant === "mobile" ? "sm:hidden rounded-lg border border-white/[0.08] bg-black/20 p-3" : "hidden sm:grid grid-cols-[minmax(150px,.9fr)_minmax(0,1.6fr)_minmax(150px,.9fr)] items-center gap-x-5 border-t border-white/[0.07] bg-black/10 px-5 py-3"}>
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded bg-emerald-300/15 text-[11px] font-bold text-emerald-200">K</span><h4 className="text-[11px] font-bold text-gray-200">Prediction market</h4><span className="ml-auto text-[10px] text-gray-500 sm:ml-0 sm:w-full sm:pl-[26px]">Game winner{game.sport === "soccer" ? " · 90 minutes" : ""}</span></div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1 sm:block sm:pl-[26px]"><strong className="text-[17px] font-bold tracking-tight text-white">{outcome.label} {(outcome.probability*100).toFixed(1)}%</strong><span className="block text-[10px] text-gray-400">{delta === null ? "History building" : `${delta>0?"↑":delta<0?"↓":"↔"} ${Math.abs(delta).toFixed(1)} percentage points · tracked`}</span></div>
    </div>
    <div className="min-w-0"><div className="mb-1 mt-2 flex flex-wrap items-center gap-3 text-[10px] text-gray-400 sm:mt-0"><span className="inline-flex items-center gap-1"><i className="h-0.5 w-2.5 bg-emerald-200"/>Kalshi price</span><span>Bars: contracts traded</span></div><PredictionMarketChart row={outcome} /></div>
    <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[10px] text-gray-400 sm:mt-0 sm:block sm:space-y-1.5"><div className="contents sm:block sm:space-y-1.5">{footer}</div><p className="w-full text-[10px] text-gray-500">{retained ? "Last available" : "Updated"} {time(Date.parse(market.asOf))} · Kalshi via OWLS</p><p className="w-full text-[10px] text-gray-500">{history.length >= 2 ? `Tracking since ${time(history[0][0])}` : "Chart fills as new observations arrive"}</p></div>
  </section>;
}

function PredictionMarketChart({row}: {row:PredictionMarketRow}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width,setWidth] = useState(300);
  const [focus,setFocus] = useState<number | null>(null);
  const id = useId();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(120,entries[0].contentRect.width)));
    observer.observe(element);return () => observer.disconnect();
  },[]);
  const points = row.history;
  const activity = predictionMarketActivity(points);
  const first = points[0]?.[0] ?? Date.parse(row.asOf), last = points.at(-1)?.[0] ?? first;
  const low = Math.max(0,Math.floor(Math.min(...points.map(point=>point[1]*100))-2));
  const high = Math.min(100,Math.ceil(Math.max(...points.map(point=>point[1]*100))+2));
  const left=35,right=width-7,top=8,bottom=61;
  const x=(at:number)=>first===last?right:left+(at-first)/(last-first)*(right-left);
  const y=(p:number)=>bottom-(p*100-low)/Math.max(1,high-low)*(bottom-top);
  const maxActivity = Math.max(1,...activity.map(v=>v??0));
  const path=points.map((point,index)=>`${index===0||point[0]-points[index-1][0]>15*60_000?"M":"L"}${x(point[0])},${y(point[1])}`).join(" ");
  const active=focus===null?null:points[focus];
  return <div ref={ref} className="relative min-w-0"><svg width="100%" height="108" viewBox={`0 0 ${width} 108`} role="img" aria-labelledby={id}>
    <title id={id}>{row.team} Kalshi game-winner quote history. Bars show contracts traded between recorded observations.</title>
    {[low,(low+high)/2,high].map(tick=><g key={tick}><line x1={left} x2={right} y1={y(tick/100)} y2={y(tick/100)} stroke="rgba(255,255,255,.06)"/><text x="0" y={y(tick/100)+4} fill="#9ca3af" fontSize="11">{tick.toFixed(tick%1?1:0)}%</text></g>)}
    <path d={path} fill="none" stroke="#a7f3d0" strokeWidth="1.8"/>
    {points.map((point,index)=><g key={point[0]}>{activity[index]!==null ? <rect x={x(point[0])-3} y={87-activity[index]!/maxActivity*13} width="6" height={activity[index]!/maxActivity*13} rx="1" fill="#a7f3d0" opacity=".3"/> : null}<circle cx={x(point[0])} cy={y(point[1])} r={index===points.length-1?2.5:1.5} fill="#a7f3d0"/></g>)}
    <text x={left} y="104" fill="#9ca3af" fontSize="11">{time(first)}</text><text x={right} y="104" textAnchor="end" fill="#9ca3af" fontSize="11">Latest</text>
    <rect x={left} y={top} width={right-left} height="82" fill="transparent" onPointerMove={event=>{const rect=event.currentTarget.ownerSVGElement!.getBoundingClientRect();const at=first+Math.max(0,Math.min(1,(event.clientX-rect.left-left)/(right-left)))*(last-first);setFocus(points.reduce((best,point,index)=>Math.abs(point[0]-at)<Math.abs(points[best][0]-at)?index:best,0));}} onPointerDown={()=>setFocus(points.length-1)} onPointerLeave={()=>setFocus(null)}/>
  </svg>{active ? <div role="status" className="pointer-events-none absolute left-8 right-0 top-0 rounded border border-white/10 bg-[#211b2c] px-2 py-1 text-[10px] text-gray-200">{time(active[0])} · {(active[1]*100).toFixed(1)}%{activity[focus!]!==null?` · ${compact(activity[focus!]!)} contracts since prior`:""}</div>:null}</div>;
}
