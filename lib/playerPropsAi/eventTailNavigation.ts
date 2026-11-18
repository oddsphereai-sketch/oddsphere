/** Navigation from a rejected law, never a new law or source observation. */
import {CATALOG} from './evidenceContract';
import type {ForecastSanityIssue} from './forecastSanity';
import {lawForecast,scenarioStat,type AcceptedPlayerLaw} from './law';

const markets=new Set<string>(Object.values(CATALOG).flatMap(c=>[...c.required,...c.expansion,...c.researchOnly]));
/** Keep both boundaries explicit: an integer-line push is neither an Over nor
 * an Under, and a milestone uses >= rather than >. Zero-weight scenarios do
 * not supply support. All values come from the actual rejected candidate. */
export function eventTailNavigation(issue:ForecastSanityIssue,law:AcceptedPlayerLaw|null):string|null{
 if(!law||!['unsupported_zero_probability_tail','unsupported_priced_event_certainty'].includes(issue.code)||!issue.events?.length)return null;
 const rows:string[]=[];
 for(const event of issue.events){
  if(!markets.has(event.market)||!Number.isFinite(event.line)||!['two_way','milestone'].includes(event.contract))return null;
  try{
   const inclusive=event.contract==='milestone'||event.market==='anytime_td',f=lawForecast(law,event.market,event.line,inclusive);
   const values=law.weights.flatMap((w,i)=>w>0?[scenarioStat(law,event.market,i)]:[]);
   if(!values.length||!values.every(Number.isSafeInteger))return null;
   const missing=[...(f.over===0?[`Over${inclusive?'>=':'>'}${event.line}`]:[]),...(f.under===0?[`Under<${event.line}`]:[])];
   if(!missing.length)return null;
   rows.push(`${event.market}@${event.line}${inclusive?'(at-least)':''} missing ${missing.join(' and ')}; positive-weight range [${Math.min(...values)},${Math.max(...values)}]`);
  }catch{return null;}
 }
 return [...new Set(rows)].join(', ');
}
