/** Admission checks, not a fitted model or a correction of historical forecasts. */
import type {GamePacket,Player} from "./evidenceContract";
import {COMBOS} from "./evidenceContract";
import type {AcceptedPlayerLaw} from "./law";
import {lawForecast} from "./law";
import {readerLogWindows} from "./readerLogs";
import {independentPriorEvents} from "./priorEvents";
import {invariant} from "./evidence";
export type ForecastSanityIssue={code:string;markets:string[];detail:string};
export function sourceForecastIssues(packet:GamePacket,player:Player,law:AcceptedPlayerLaw):ForecastSanityIssue[]{
  const issues:ForecastSanityIssue[]=[],priors=independentPriorEvents(player);
  const logs=player.evidence.filter(e=>e.kind==="recent_games"&&e.value&&typeof e.value==="object"&&!Array.isArray(e.value)&&e.value.box);
  const support=readerLogWindows(packet.sport,logs,packet.cutoff).observedSupport;
  const affected=(primitive:string)=>player.markets.filter(m=>m===primitive||m==="anytime_td"&&primitive==="touchdowns"||COMBOS[m]?.includes(primitive));
  for(const [primitive,values]of Object.entries(law.outcomes)){
    const markets=affected(primitive);if(!markets.length)continue;
    const mean=values.reduce((n,v,i)=>n+v*law.weights[i],0),historical=support[primitive];
    const priorMeans=priors.filter(p=>p.market===primitive&&p.independentMean!==null).map(p=>p.independentMean!);
    // This is a review boundary on an unexplained *mean*, never a clamp on tails.
    // Outside-source role changes need a supported input, not an invented adjustment.
    if(historical?.n>=3){
      const minimum=Math.min(historical.minimum,...priorMeans),maximum=Math.max(historical.maximum,...priorMeans);
      if(mean<minimum-1e-9||mean>maximum+1e-9)issues.push({code:"forecast_mean_outside_supplied_support",markets,
        detail:`${player.id} ${primitive} mean ${mean.toFixed(4)} is outside supplied played-game/prior support [${minimum},${maximum}]. Recheck named units and actual role evidence; correct the law or explicitly except the affected markets.`});
    }
    // A sole positive historical game does not define a narrow forecasting range,
    // but cannot support an entirely nonpositive yardage law on its own.
    if(primitive.endsWith("yards")&&historical&&historical.mean>0&&values.every((v,i)=>law.weights[i]===0||v<=0)
      &&priorMeans.every(n=>n>=0))issues.push({code:"nonpositive_yardage_contradicts_source",markets,
        detail:`${player.id} ${primitive} has no positive outcome despite positive supplied production. Verify canonical net-yard units; do not turn missing data into zero/negative certainty.`});
  }
  for(const prior of priors){
    if(!prior.market||prior.line===null||!player.markets.includes(prior.market))continue;
    const p=prior.market==="anytime_td"?prior.yesProbability:prior.overProbability;
    if(p===null||p<=0||p>=1)continue;
    const f=lawForecast(law,prior.market,prior.line);
    if(f.over===0||f.under===0)issues.push({code:"unsupported_zero_probability_tail",markets:[prior.market],
      detail:`${player.id} ${prior.market} at ${prior.line} has zero opposite-event mass although the independent source assigns both outcomes positive probability. Include realistic opposing tails or explicitly except this market; never clip the displayed probability.`});
  }
  const seen=new Set<string>();
  for(const q of packet.quotes){
    if(q.playerId!==player.id||q.opening||q.live||q.receivedAtProvenance!=="provider_response"||Date.parse(q.receivedAt)>Date.parse(packet.cutoff)||Date.parse(packet.cutoff)-Date.parse(q.receivedAt)>15*60000)continue;
    const key=`${q.market}|${q.line}|${q.offerContract??"two_way"}`;if(seen.has(key))continue;seen.add(key);
    const f=lawForecast(law,q.market,q.line,q.offerContract==="milestone"||q.side==="yes");
    if(f.over===0||f.under===0)issues.push({code:"unsupported_priced_event_certainty",markets:[q.market],
      detail:`${player.id} ${q.market} at offered line ${q.line} has no opposing tail. A finite scenario sample does not establish certainty for an executable event; re-evaluate tails or explicitly except this scope.`});
  }
  return issues;
}
export function validateSourceForecast(packet:GamePacket,player:Player,law:AcceptedPlayerLaw,exceptions:(string|null)[]){
  const issues=sourceForecastIssues(packet,player,law);
  const unhandled=issues.filter(issue=>issue.markets.some(m=>!exceptions[player.markets.indexOf(m)]));
  invariant(!unhandled.length,unhandled.map(i=>`${i.code}: ${i.detail}`).join(" ").slice(0,900));
  return [...new Set(issues.flatMap(issue=>issue.markets))];
}
