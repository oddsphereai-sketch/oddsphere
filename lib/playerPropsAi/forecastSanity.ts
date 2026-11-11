import {qualifiedForecastMarkets,unresolvedForecastMarkets,sourceEventUsable} from "./sourceEvents";
/** Admission checks, not a fitted model or a correction of historical forecasts. */
import type {GamePacket,Player,Json} from "./evidenceContract";
import {COMBOS,CATALOG} from "./evidenceContract";
import type {AcceptedPlayerLaw} from "./law";
import {lawForecast,scenarioStat,marketUsesStatistic} from "./law";
import {readerLogWindows} from "./readerLogs";
import {independentPriorEvents} from "./priorEvents";
import {invariant} from "./evidence";
export type SourceEventScope={market:string;line:number;contract:"two_way"|"milestone"};
export type ForecastSanityIssue={code:string;markets:string[];detail:string;example?:string;events?:SourceEventScope[]};
type ObservedSupport={n:number;minimum:number;maximum:number;mean:number};
export type SourceMeanAdmissionSupport={state:'played_range'|'played_prior_range'|'source_opportunity'|'binary_event'|'unavailable';active:boolean;minimum:number|null;maximum:number|null;playedGames:number;playedSupport:ObservedSupport|null;distinctPlayedValuesAtLeast:number;priorMeans:number[];meaning:string};
const object=(v:Json|undefined):Record<string,Json>=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);

/** One source-unit policy for admission and named navigation. A lone scalar is
 * not a range; missing samples are not zero and a combo prior is never allocated
 * to its components. These are mean review boundaries, never tail caps. */
export function sourceMeanAdmissionSupport(packet:GamePacket,player:Player):Record<string,SourceMeanAdmissionSupport>{
 const available=player.evidence.filter(e=>Number.isFinite(Date.parse(e.availableAt))&&Date.parse(e.availableAt)<=Date.parse(packet.cutoff));
 const priorEvents=independentPriorEvents({...player,evidence:available}),logs=available.filter(e=>e.kind==='recent_games');
 const observed:Record<string,ObservedSupport>={},played=new Map<string,Map<string,Set<number>>>(),opportunities=new Map<string,Set<number>>();
 const put=(game:string,stat:string,value:number)=>{const row=played.get(game)??new Map<string,Set<number>>(),values=row.get(stat)??new Set<number>();values.add(value);row.set(stat,values);played.set(game,row);};
 for(const e of logs){
  const v=object(e.value),box=object(v.box),game=object(v.game);
  if(packet.sport==='mlb'&&Array.isArray(v.logs)){
   const market=CATALOG.mlb.required.find(m=>e.id.endsWith(`:${m}:recentForm`));if(!market)continue;
   for(const [i,raw]of v.logs.entries()){
    const row=object(raw);
    const date=row.startTime??row.scheduledStart??row.date;if(typeof date==='string'&&Number.isFinite(Date.parse(date))&&Date.parse(date)>Date.parse(packet.cutoff))continue;
    const id=row.gameId===null||row.gameId===undefined?`source:${e.id}:${i}`:`game:${String(row.gameId)}`;
    if(market.startsWith('batter_')&&Number.isSafeInteger(row.plateAppearances)&&Number(row.plateAppearances)>=0){const values=opportunities.get(id)??new Set<number>();values.add(Number(row.plateAppearances));opportunities.set(id,values);}
    if(market.startsWith('batter_')&&row.plateAppearances===0)continue;
    if(finite(row.value))put(id,market,row.value);
   }
  }else if(packet.sport!=='mlb'&&v.box){
   const at=game.startTime??game.start??game.scheduledStart,home=game.homeTeam??game.home,away=game.awayTeam??game.away;
   // Anonymous/missing-clock rows stay in the raw reader evidence; they cannot
   // establish independent played outcomes or a guessed join in this envelope.
   if(typeof at!=='string'||!Number.isFinite(Date.parse(at))||Date.parse(at)>Date.parse(packet.cutoff)||typeof home!=='string'||typeof away!=='string')continue;
   if(packet.sport==='nba'&&!(finite(box.minutes)&&box.minutes>0)&&!['points','fgm','fg3m','ftm','oreb','dreb','ast'].some(k=>finite(box[k])&&box[k]>0))continue;
   const aliases:Record<string,string[]>=packet.sport==='nba'?{points:['points'],rebounds:['rebounds','reb'],assists:['ast'],threes:['fg3m']}:{passing_attempts:['passing_attempts','attempts'],passing_completions:['passing_completions','completions'],passing_yards:['passing_yards'],passing_tds:['passing_tds','passing_touchdowns'],interceptions:['passing_interceptions'],rushing_attempts:['rushing_attempts','carries'],rushing_yards:['rushing_yards'],receptions:['receptions'],receiving_yards:['receiving_yards']};
   const aliasesByTeam:Record<string,string>={JAC:'JAX',WSH:'WAS',LA:'LAR'},normalized=(t:string)=>aliasesByTeam[t.toUpperCase()]??t.toUpperCase(),id=JSON.stringify([Date.parse(at),normalized(home),normalized(away)]);
   for(const [stat,keys]of Object.entries(aliases))for(const key of keys)if(finite(box[key]))put(id,stat,box[key]);
   if(packet.sport==='nba'&&Number.isSafeInteger(box.oreb)&&Number.isSafeInteger(box.dreb)&&Number(box.oreb)>=0&&Number(box.dreb)>=0)put(id,'rebounds',Number(box.oreb)+Number(box.dreb));
  }
 }
 const derived:Record<string,readonly string[]>={batter_hits:['batter_singles','batter_doubles','batter_triples','batter_home_runs'],batter_total_bases:['batter_singles','batter_doubles','batter_triples','batter_home_runs'],...COMBOS};
 // Components must exist in this same reconciled game. A missing/conflicting
 // component never becomes zero or an independently averaged synthetic game.
 for(const row of played.values())for(const [market,components]of Object.entries(derived)){
  if(!components.every(c=>row.get(c)?.size===1&&Number.isSafeInteger([...row.get(c)!][0])&&(c.endsWith('yards')||[...row.get(c)!][0]>=0)))continue;
  const total=components.reduce((n,c,i)=>n+[...row.get(c)!][0]*(market==='batter_total_bases'?i+1:1),0),values=row.get(market)??new Set<number>();values.add(total);row.set(market,values);
 }
 for(const stat of new Set([...played.values()].flatMap(row=>[...row.keys()]))){const values=[...played.values()].flatMap(row=>row.get(stat)?.size===1&&Number.isSafeInteger([...row.get(stat)!][0])&&(stat.endsWith('yards')||[...row.get(stat)!][0]>=0)?[...row.get(stat)!]:[]);if(values.length)observed[stat]={n:values.length,minimum:Math.min(...values),maximum:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length};}
 const statistics=new Set([...Object.keys(observed),...priorEvents.flatMap(p=>p.market?[p.market]:[]),...qualifiedForecastMarkets(player)]),result:Record<string,SourceMeanAdmissionSupport>={};
 for(const stat of statistics){
  const h=observed[stat],priors=[...new Set(priorEvents.filter(p=>p.market===stat&&p.independentMean!==null&&(stat.endsWith('yards')||p.independentMean>=0)).map(p=>p.independentMean!))];
  const distinct=h?h.minimum===h.maximum?1:2:0,anchors=[...(h?[h.minimum,h.maximum]:[]),...priors],minimum=anchors.length?Math.min(...anchors):null,maximum=anchors.length?Math.max(...anchors):null;
  let state:SourceMeanAdmissionSupport['state']='unavailable',lo=minimum,hi=maximum;
  if(h&&h.n>=3&&(h.minimum!==0||h.maximum!==0))state=priors.length?'played_prior_range':'played_range';
  else if(h&&minimum!==null&&maximum!==null&&minimum<maximum&&(distinct>=2||priors.length>0))state=priors.length?'played_prior_range':'played_range';
  // A count cannot exceed supplied plate appearances. This canonical-unit
  // opportunity scale permits rare positive counts after observed zeros; it is
  // neither an inferred zero ceiling nor a rule about the next game's tails.
  const pa=[...opportunities.values()].flatMap(values=>values.size===1&&[...values][0]>0?[...values]:[]),paBound=pa.length&&['batter_singles','batter_doubles','batter_triples','batter_home_runs','batter_walks','batter_strikeouts','batter_hits','batter_total_bases'].includes(stat)?Math.max(...pa)*(stat==='batter_total_bases'?4:1):null;
  if(state==='unavailable'&&paBound!==null&&paBound>0){state='source_opportunity';lo=0;hi=Math.max(paBound,...priors);}
  // scenarioStat defines anytime_td as an indicator, so its mean is already a
  // probability in [0,1]. This is its exact unit identity, not a count prior,
  // bound on latent touchdown counts, clipped probability or fitted forecast.
  if(stat==='anytime_td'){state='binary_event';lo=0;hi=1;}
  result[stat]={state,active:state!=='unavailable',minimum:state==='unavailable'?null:lo,maximum:state==='unavailable'?null:hi,playedGames:h?.n??0,playedSupport:h?{...h}:null,distinctPlayedValuesAtLeast:distinct,priorMeans:priors,
   meaning:state==='unavailable'?'No source-grounded mean range: one scalar, missing/conflicting samples, or all-zero counts without a positive source scale cannot qualify this numerical scope. Explicitly decline rather than copy the prior or invent a range.':state==='binary_event'?'Exact canonical 0/1 event units; this is not a count prior, latent-count limit or probability calibration. Opposing-tail admission remains separate.':'Source-grounded mean review boundary in canonical units; no scenario-tail cap, fitted confidence or prescribed forecast. Quantitative source-head changes may expand this range.'};
 }
 return result;
}
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
  const history=readerLogWindows(packet.sport,logs,packet.cutoff),envelopes=sourceMeanAdmissionSupport(packet,player);
  const affected=(primitive:string)=>qualified.filter(m=>marketUsesStatistic(m,primitive));
  const statistics=[...new Set([...Object.keys(law.outcomes),...qualified])];
  for(const primitive of statistics){
    const values=law.outcomes[primitive]??law.weights.map((_,i)=>scenarioStat(law,primitive,i));
    const markets=affected(primitive);if(!markets.length)continue;
    const mean=values.reduce((n,v,i)=>n+v*law.weights[i],0),historical=envelopes[primitive]?.playedSupport;
    const priorMeans=envelopes[primitive]?.priorMeans??[];
    // This is a review boundary on an unexplained *mean*, never a clamp on tails.
    // Outside-source role changes need a supported input, not an invented adjustment.
    // Repeated zero rare-event samples cannot establish a zero production ceiling.
    const envelope=envelopes[primitive];
    if(envelope?.active){
      const minimum=envelope.minimum!,maximum=envelope.maximum!;
      if(mean<minimum-1e-9||mean>maximum+1e-9)issues.push({code:"forecast_mean_outside_supplied_support",markets,example:`${primitive} mean=${Number(mean.toFixed(4))}, support=${minimum}..${maximum}`,
        detail:`${player.id} ${primitive} mean ${mean.toFixed(4)} is outside supplied played-game/prior support [${minimum},${maximum}]. Recheck named units and actual role evidence; correct the law or explicitly except the affected markets.`});
    }else if(qualified.includes(primitive)||primitive.endsWith('yards')&&markets.some(m=>COMBOS[m]?.includes(primitive))){
      // Signed components can cancel to a plausible total while each carries
      // an unsupported magnitude. A combo prior cannot supply their allocation.
      const unsupported=primitive.endsWith('yards')?markets:[primitive];
      issues.push({code:'forecast_numeric_support_unavailable',markets:unsupported,example:`${primitive}: numeric_support_unavailable (no source-grounded mean range)`,detail:`${player.id} ${primitive} lacks a source-grounded numerical range. Recheck supplied canonical-unit history, prior and opportunity context; explicitly decline the affected scopes rather than invent a magnitude, cancel unsupported signed components, or copy one scalar.`});
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
    const milestone=prior.offerContract==="milestone",inclusive=milestone||prior.market==="anytime_td";
    const uncertain=milestone?prior.yesProbability!==null&&prior.yesProbability>0&&prior.noProbability!==null&&prior.noProbability!==undefined&&prior.noProbability>0
      :prior.market==="anytime_td"?prior.yesProbability!==null&&prior.yesProbability>0&&prior.yesProbability<1
      :prior.overProbability!==null&&prior.overProbability>0&&prior.underProbability!==null&&prior.underProbability>0;
    if(!uncertain)continue;
    const f=lawForecast(law,prior.market,prior.line,inclusive);
    if(f.over===0||f.under===0)issues.push({code:"unsupported_zero_probability_tail",markets:[prior.market],example:`${prior.market}@${prior.line}: missing opposing prior tail`,events:[{market:prior.market,line:prior.line,contract:inclusive?"milestone":"two_way"}],
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
