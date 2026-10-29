import type {MarketEdgeDto,OddsTrailStopDto} from "./labTypes";
import type {PredictionMarketBookTrail} from "./predictionMarketDisplay";
import {resolveDailyEdgeCurrentOnlyMovement} from "./dailyEdgeCurrentOnlyMovement";

/** The same source selection used by the public Opening/Prior/Current map.
 * This is presentation evidence only; no professional-reader or model input. */
export function publicMarketDisplayStops(market:MarketEdgeDto,displayedPrice:number|null,displayedBook:string|null){
 const trail=(market.oddsTrail??[]).filter(stop=>Number.isFinite(stop.american)).map(stop=>
  stop.label==="current"&&(stop.sportsbook==="recommendation_snapshot"||!stop.sportsbook)&&displayedBook!==null&&displayedPrice===stop.american?{...stop,sportsbook:displayedBook}:stop);
 const groups=new Map<string,OddsTrailStopDto[]>();
 for(const stop of trail){
  if(!stop.sportsbook||stop.sportsbook==="recommendation_snapshot"||stop.sportsbook==="locked_snapshot")continue;
  const group=groups.get(stop.sportsbook)??[];group.push(stop);groups.set(stop.sportsbook,group);
 }
 const coherent=Array.from(groups.values()).filter(group=>group.length>=2&&group.some(stop=>stop.label==="current"||stop.label==="locked")).sort((a,b)=>b.length-a.length)[0];
 return {trail,coherent};
}

export function publicMarketDisplayedPrice(market:MarketEdgeDto):number|null {
 if(market.currentPriceAmerican!==null&&market.currentPriceAmerican!==undefined)return market.currentPriceAmerican;
 if(market.bestAvailablePriceAmerican!==null&&market.bestAvailablePriceAmerican!==undefined)return market.bestAvailablePriceAmerican;
 if(/NRFI|under/i.test(market.pick??"")&&market.fiMarketBoard?.nrfiAmerican!=null)return market.fiMarketBoard.nrfiAmerican;
 if(/YRFI|over/i.test(market.pick??"")&&market.fiMarketBoard?.yrfiAmerican!=null)return market.fiMarketBoard.yrfiAmerican;
 return market.priceAmerican;
}
export function publicMarketDisplayedSportsbook(market:MarketEdgeDto):string|null {
 if(market.currentPriceSportsbook)return market.currentPriceSportsbook;
 if(market.bestAvailableSportsbook)return market.bestAvailableSportsbook;
 const source=market.fiMarketBoard?.source?.match(/^fi_market_ok_(.+)$/i)?.[1];
 return source?.replaceAll(" ","_").toLowerCase()??null;
}
const implied=(a:number)=>a>0?100/(100+a):-a/(100-a);

/** Exact public tracker source, selected side, terminal threshold and boundary.
 * Earlier other-threshold prices remain in line history, NOT on this curve. */
export function publicMarketDisplayBook(market:MarketEdgeDto):PredictionMarketBookTrail|null {
 const price=publicMarketDisplayedPrice(market),source=publicMarketDisplayedSportsbook(market),{trail,coherent}=publicMarketDisplayStops(market,price,source);
 const currentOnly=resolveDailyEdgeCurrentOnlyMovement({trail,displayedPrice:price,displayedBook:source,fallbackLine:market.line});
 const book=coherent?.at(-1)?.sportsbook??currentOnly.sportsbook;
 if(!book)return null;
 const stops=coherent??trail.filter(s=>s.sportsbook===book);
 const terminal=coherent?.at(-1)??[...stops].reverse().find(s=>s.label==="current"||s.label==="locked");
 const end=Date.parse(terminal?.observedAt??""),line=terminal?.line??currentOnly.currentLine;
 if(!terminal||!Number.isFinite(end))return null;
 const valid=stops.filter(s=>{const t=Date.parse(s.observedAt??"");return Number.isFinite(t)&&t<=end&&Number.isFinite(s.american)&&Math.abs(s.american)>=100;});
 const points=[...new Map(valid.filter(s=>s.line===line).map(s=>{const t=Date.parse(s.observedAt!);return [t,[t,implied(s.american),s.american] as [number,number,number]];})).values()].sort((a,b)=>a[0]-b[0]);
 if(!points.length)return null;
 const lineStops=(market.lineTrail??[]).filter(s=>s.sportsbook===book&&Number.isFinite(Date.parse(s.observedAt??""))&&Date.parse(s.observedAt!)<=end&&Number.isFinite(s.american)&&Math.abs(s.american)>=100);
 const all=[...valid,...lineStops],opening=all.find(s=>s.source==="provider_opening");
 return {sportsbook:book,line,points,locked:terminal.label==="locked",marketHistory:[...new Map(all.map(s=>{const at=Date.parse(s.observedAt!);return [at+"|"+s.line,[at,s.american,s.line] as [number,number,number|null]];})).values()].sort((a,b)=>a[0]-b[0]),...(opening?{opening:{line:opening.line,point:[Date.parse(opening.observedAt!),implied(opening.american),opening.american]}}:{})};
}

/** An auxiliary download can recover EARLIER real same-book observations.
 * It cannot replace the public terminal quote/time or add another threshold's
 * prices to this curve. Stored observations always win timestamp ties. */
export function publicMarketDisplayHistory(stored:PredictionMarketBookTrail|null,history:PredictionMarketBookTrail|null):PredictionMarketBookTrail|null {
 if(!stored||stored.locked||!history||history.sportsbook!==stored.sportsbook||history.line!==stored.line)return stored;
 const last=stored.points.at(-1)?.[0];if(last===undefined)return stored;
 const allowed=(at:number)=>Number.isFinite(at)&&at<=last;
 return {...stored,
  historyScope:history.historyScope??stored.historyScope,
  ...(stored.opening?{}:history.opening&&allowed(history.opening.point[0])?{opening:history.opening}:{}),
  points:[...new Map([...history.points.filter(p=>allowed(p[0])),...stored.points].map(p=>[p[0],p])).values()].sort((a,b)=>a[0]-b[0]),
  marketHistory:[...new Map([...(history.marketHistory??[]).filter(p=>allowed(p[0])),...(stored.marketHistory??[])].map(p=>[p[0]+"|"+p[2],p])).values()].sort((a,b)=>a[0]-b[0])};
}
