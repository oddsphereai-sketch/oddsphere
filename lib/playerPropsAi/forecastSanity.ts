import {qualifiedForecastMarkets,unresolvedForecastMarkets,sourceEventUsable} from "./sourceEvents";
/** Admission checks, not a fitted model or a correction of historical forecasts. */
import type {GamePacket,Player} from "./evidenceContract";
import {COMBOS,CATALOG} from "./evidenceContract";
import type {AcceptedPlayerLaw} from "./law";
import {lawForecast,scenarioStat,marketUsesStatistic} from "./law";
import {readerLogWindows} from "./readerLogs";
import {independentPriorEvents} from "./priorEvents";
import {invariant} from "./evidence";
export type SourceEventScope={market:string;line:number;contract:"two_way"|"milestone"};
export type ForecastSanityIssue={code:string;markets:string[];detail:string;example?:string;events?:SourceEventScope[]};
export function unqualifiedEventTail(f:{over:number;under:number;push:number},oneWay=false){
  const win=oneWay?f.over:Math.max(f.over,f.under);
  // Zero support is exact; a floating-point weight sum is not a certainty test.
  // An integer-line push is a real opposing outcome, not a losing Under.
  return win<=0||f.push===0&&(f.over===0||f.under===0);
}
/** A numerical identity cannot be waived by a prose market exception. Legacy accepted laws are not reparsed. */
export function validateScenarioOpportunities(sport:GamePacket["sport"],law:AcceptedPlayerLaw){
  if(sport!=="nfl"||!law.outcomes.passing_yards)return;
  invariant(law.outcomes.passing_yards.every((yards,i)=>law.outcomes.passing_completions[i]!==0||yards===0),"NFL passing yards require a completed pass in the same scenario; correct the named passing opportunity statistics.");
}
export function sourceForecastIssues(packet:GamePacket,player:Player,law:AcceptedPlayerLaw):ForecastSanityIssue[]{
  const issues:ForecastSanityIssue[]=[],priors=independentPriorEvents(player),qualified=qualifiedForecastMarkets(player);
  const logs=player.evidence.filter(e=>e.kind==="recent_games"&&e.value&&typeof e.value==="object"&&!Array.isArray(e.value)&&e.value.box);
  const history=readerLogWindows(packet.sport,logs,packet.cutoff),support=history.observedSupport;
  if(packet.sport==="mlb"){
    const byMarket=new Map<string,Map<string,Set<number>>>();
    for(const e of player.evidence.filter(e=>e.kind==="recent_games")){
      const market=CATALOG.mlb.required.find(m=>e.id.endsWith(`:${m}:recentForm`));
      if(!market||!e.value||typeof e.value!=="object"||Array.isArray(e.value)||!Array.isArray(e.value.logs))continue;
      const games=byMarket.get(market)??new Map<string,Set<number>>();
      for(const [i,raw]of e.value.logs.entries()){
        if(!raw||typeof raw!=="object"||Array.isArray(raw)||typeof raw.value!=="number"||!Number.isFinite(raw.value))continue;
        if(market.startsWith("batter_")&&raw.plateAppearances===0)continue;
        const id=raw.gameId===null||raw.gameId===undefined?`source:${e.id}:${i}`:String(raw.gameId),values=games.get(id)??new Set<number>();values.add(raw.value);games.set(id,values);
      }
      byMarket.set(market,games);
    }
    for(const [market,games]of byMarket){const values=[...games.values()].flatMap(v=>v.size===1?[...v]:[]);if(values.length)support[market]={n:values.length,minimum:Math.min(...values),maximum:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length};}
  }
  const affected=(primitive:string)=>qualified.filter(m=>marketUsesStatistic(m,primitive));
  const statistics=[...new Set([...Object.keys(law.outcomes),...(packet.sport==="mlb"?qualified:[])])];
  for(const primitive of statistics){
    const values=law.outcomes[primitive]??law.weights.map((_,i)=>scenarioStat(law,primitive,i));
    const markets=affected(primitive);if(!markets.length)continue;
    const mean=values.reduce((n,v,i)=>n+v*law.weights[i],0),historical=support[primitive];
    const priorMeans=priors.filter(p=>p.market===primitive&&p.independentMean!==null).map(p=>p.independentMean!);
    // This is a review boundary on an unexplained *mean*, never a clamp on tails.
    // Outside-source role changes need a supported input, not an invented adjustment.
    // Repeated zero rare-event samples cannot establish a zero production ceiling.
    if(historical?.n>=3&&(historical.minimum!==0||historical.maximum!==0)){
      const minimum=Math.min(historical.minimum,...priorMeans),maximum=Math.max(historical.maximum,...priorMeans);
      if(mean<minimum-1e-9||mean>maximum+1e-9)issues.push({code:"forecast_mean_outside_supplied_support",markets,example:`${primitive} mean=${Number(mean.toFixed(4))}, support=${minimum}..${maximum}`,
        detail:`${player.id} ${primitive} mean ${mean.toFixed(4)} is outside supplied played-game/prior support [${minimum},${maximum}]. Recheck named units and actual role evidence; correct the law or explicitly except the affected markets.`});
    }
    // A sole positive historical game does not define a narrow forecasting range,
    // but cannot support an entirely nonpositive yardage law on its own.
    if(primitive.endsWith("yards")&&historical&&historical.mean>0&&values.every((v,i)=>law.weights[i]===0||v<=0)
      &&priorMeans.every(n=>n>=0))issues.push({code:"nonpositive_yardage_contradicts_source",markets,example:`${primitive}: source mean=${historical.mean}, no positive forecast outcome`,
        detail:`${player.id} ${primitive} has no positive outcome despite positive supplied production. Verify canonical net-yard units; do not turn missing data into zero/negative certainty.`});
  }
  for(const pair of history.observedPairOrderings){
    const markets=qualified.filter(m=>COMBOS[m]?.includes(pair.first)&&COMBOS[m]?.includes(pair.second));
    if(!markets.length)continue;
    let concordant=false,discordant=false;
    for(let i=0;i<law.weights.length;i++)for(let j=i+1;j<law.weights.length;j++){
      if(!law.weights[i]||!law.weights[j])continue;
      const product=(law.outcomes[pair.first][i]-law.outcomes[pair.first][j])*(law.outcomes[pair.second][i]-law.outcomes[pair.second][j]);
      if(product>0)concordant=true;if(product<0)discordant=true;
    }
    if(!concordant||!discordant)issues.push({code:"combo_dependence_erases_source_variation",markets,example:`${pair.first}/${pair.second}: retain higher-together AND opposing variation`,
      detail:`${player.id} ${pair.first}/${pair.second} combinations erase observed joint variation. Source games contain both higher-together and opposing outcomes; include that dependence or explicitly except the affected combinations.`});
  }
  for(const prior of priors){
    if(!prior.market||prior.line===null||!qualified.includes(prior.market))continue;
    const uncertain=prior.market==="anytime_td"?prior.yesProbability!==null&&prior.yesProbability>0&&prior.yesProbability<1
      :prior.overProbability!==null&&prior.overProbability>0&&prior.underProbability!==null&&prior.underProbability>0;
    if(!uncertain)continue;
    const f=lawForecast(law,prior.market,prior.line);
    if(f.over===0||f.under===0)issues.push({code:"unsupported_zero_probability_tail",markets:[prior.market],example:`${prior.market}@${prior.line}: missing opposing prior tail`,events:[{market:prior.market,line:prior.line,contract:prior.market==="anytime_td"?"milestone":"two_way"}],
      detail:`${player.id} ${prior.market} at ${prior.line} has zero opposite-event mass although the independent source assigns both outcomes positive probability. Include realistic opposing tails or explicitly except this market; never clip the displayed probability.`});
  }
  const seen=new Set<string>();
  for(const q of packet.quotes){
    if(!qualified.includes(q.market)||!sourceEventUsable(q)||q.playerId!==player.id||q.opening||q.live||q.receivedAtProvenance!=="provider_response"||Date.parse(q.receivedAt)>Date.parse(packet.cutoff)||Date.parse(packet.cutoff)-Date.parse(q.receivedAt)>15*60000)continue;
    const key=`${q.market}|${q.line}|${q.offerContract??"two_way"}`;if(seen.has(key))continue;seen.add(key);
    const f=lawForecast(law,q.market,q.line,q.offerContract==="milestone"||q.side==="yes");
    if(unqualifiedEventTail(f,q.side==="yes"))issues.push({code:"unsupported_priced_event_certainty",markets:[q.market],example:`${q.market}@${q.line}: missing opposing priced tail`,events:[{market:q.market,line:q.line,contract:q.side==="yes"||q.offerContract==="milestone"?"milestone":"two_way"}],
      detail:`${player.id} ${q.market} at offered line ${q.line} has no opposing tail. A finite scenario sample does not establish certainty for an executable event; re-evaluate tails or explicitly except this scope.`});
  }
  return issues;
}
export function validateSourceForecast(packet:GamePacket,player:Player,law:AcceptedPlayerLaw,exceptions:(string|null)[]){
  const issues=sourceForecastIssues(packet,player,law);
  const unhandled=issues.filter(issue=>issue.markets.some(m=>!exceptions[player.markets.indexOf(m)]));
  invariant(!unhandled.length,unhandled.map(i=>`${i.code}: ${i.detail}`).join(" ").slice(0,900));
  return [...new Set([...unresolvedForecastMarkets(player),...issues.flatMap(issue=>issue.markets)])];
}
