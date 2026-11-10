import {PROPS_AI_WIRE_RELEASE} from './scenarioCoordinates';
/** Prospective NBA navigation of the exact same source. No law/grade repair. */
import {COMBOS, type GamePacket, type Json} from './evidenceContract';
import {evidenceAliases} from './input';
import {readerEvidence, READER_AREAS, type ReaderArea, type ReaderAreaEvidence} from './readerCoverage';
import {readerLogWindows} from './readerLogs';
import {independentPriorEvents} from './priorEvents';
import {inspectGenerativeDraft} from './generativeAdmission';
import {marketUsesStatistic,validateLaw,lawForecast,type AcceptedPlayerLaw} from './law';
import type {ForecastSanityIssue} from './forecastSanity';

const STATISTICS = ['points','rebounds','assists','threes'] as const;
type Statistic = typeof STATISTICS[number];
const MARKET_NAMES: Readonly<Record<string,string>> = {
  points:'points', rebounds:'rebounds', assists:'assists', threes:'threes',
  points_rebounds:'points+rebounds', points_assists:'points+assists',
  rebounds_assists:'rebounds+assists', points_rebounds_assists:'points+rebounds+assists',
};
const NUMBER_PATTERN = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const MEAN_EXAMPLE = new RegExp(`^(points|rebounds|assists|threes) mean=(${NUMBER_PATTERN}), support=(${NUMBER_PATTERN})\\.\\.(${NUMBER_PATTERN})$`,'i');
export const NAMED_SOURCE_CORRECTION_MAX_BYTES = 1984;
const object = (value:unknown):Record<string,unknown>|null => value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const jsonObject = (value:Json):Record<string,Json>|null => value!==null&&typeof value==='object'&&!Array.isArray(value)?value:null;
const statistic = (value:string):value is Statistic => (STATISTICS as readonly string[]).includes(value);
const unique = <T>(values:readonly T[]):T[] => [...new Set(values)];

// The complete fact records already appear in the authoritative readerAreas.
// Navigation repeats their IDs only, rather than duplicating provenance/payloads.
export type ContextConstraint = {status:ReaderAreaEvidence['status'];limitations:string[];factIds:string[];actualContextFactIds?:string[]};
export type StatisticConstraint = {
  playedGames:number;mean:number;minimum:number;maximum:number;sourceFact:string|null;
  meanAdmissionSupport:{active:boolean;minimum:number;maximum:number;meaning:string};
};
export type IndependentEventConstraint = {
  market:string|null;line:number|null;mean:number|null;sourceEvidence:string|null;sourceId:string;sourceFact:string|null;
  eventBinding:'explicit_stored_native_side'|'legacy_reference_event_not_verified';
  referenceSide:string|null;probabilityOfReferenceSide:number|null;preferred:string;
  originalReferenceSide:string|null;originalRawProbability:number|null;
};
export type SourceConstraintCard = {
  actor:string;actorId:string;name:string;cutoff:string;markets:string[];meaning:string;
  statistics:Partial<Record<Statistic,StatisticConstraint>>;
  generativeComponentSupport?:{statistic:'points_excluding_made_threes';playedGames:number;mean:number;minimum:number;maximum:number;sourceFact:string|null;meaning:string};
  marketsByStatistic:Record<Statistic,string[]>;generativeMeaning:string;
  jointPatterns:{first:string;second:string;playedGames:number;higherTogether:number;opposing:number;sourceFact:string|null;markets:string[]}[];
  independentEvents:IndependentEventConstraint[];context:Record<ReaderArea,ContextConstraint>;
};

/** Cards repeat cited facts as navigation, never additional independent evidence. */
export function sourceConstraintCards(packet:GamePacket):SourceConstraintCard[]{
  if(packet.sport!=='nba')return [];
  const reader=readerEvidence(packet),aliases=new Map([...evidenceAliases(packet)].map(([alias,id])=>[id,alias]));
  return packet.players.map((player,index)=>{
    const evidence=reader[player.id],recent=readerLogWindows('nba',player.evidence.filter(e=>e.kind==='recent_games'),packet.cutoff);
    const fact=evidence.recent_form.facts.find(f=>f.label==='Reconciled recent recorded stat windows');
    const priors=independentPriorEvents(player);
    const statistics:Partial<Record<Statistic,StatisticConstraint>>={};
    for(const stat of STATISTICS){const support=recent.observedSupport[stat];if(!support)continue;
      const means=priors.filter(p=>p.market===stat&&p.independentMean!==null).map(p=>p.independentMean!);
      const active=support.n>=3&&(support.minimum!==0||support.maximum!==0);
      statistics[stat]={playedGames:support.n,mean:support.mean,minimum:support.minimum,maximum:support.maximum,sourceFact:fact?.id??null,
        meanAdmissionSupport:{active,minimum:Math.min(support.minimum,...means),maximum:Math.max(support.maximum,...means),meaning:active?'Existing source-mean review boundary; not a scenario-tail cap or a prescribed forecast.':'Insufficient or all-zero history does not establish a production ceiling.'}};
    }
    const context=Object.fromEntries(READER_AREAS.map(area=>{
      const source=evidence[area],actual=source.eligibleContextFactIds;
      return[area,{status:source.status,limitations:[...source.limitations],factIds:source.facts.map(f=>f.id),...(actual?{actualContextFactIds:[...actual]}:{})}];
    })) as Record<ReaderArea,ContextConstraint>;
    return {actor:`P${index}`,actorId:player.id,name:player.name,cutoff:packet.cutoff,markets:[...player.markets],
      meaning:'Conditional on qualifying participation. These copied source constraints are not extra votes, forecast means, scenario-tail caps, or proof of current health/role. All exact raw evidence remains authoritative.',statistics,
      ...(recent.observedSupport.points_excluding_made_threes?{generativeComponentSupport:{statistic:'points_excluding_made_threes' as const,playedGames:recent.observedSupport.points_excluding_made_threes.n,mean:recent.observedSupport.points_excluding_made_threes.mean,minimum:recent.observedSupport.points_excluding_made_threes.minimum,maximum:recent.observedSupport.points_excluding_made_threes.maximum,sourceFact:fact?.id??null,meaning:'Recorded total points minus three times made threes within each same reconciled played game. This is not a total-points forecast or an inferred independent component prior.'}}:{}),
      marketsByStatistic:Object.fromEntries(STATISTICS.map(stat=>[stat,player.markets.filter(m=>marketUsesStatistic(m,stat))])) as Record<Statistic,string[]>,
      generativeMeaning:'Total points = points_excluding_made_threes + 3*threes. Rebounds = offensive + defensive rebounds. Every named statistic shares the same scenario index.',
      jointPatterns:recent.observedPairOrderings.filter(pair=>player.markets.some(m=>COMBOS[m]?.includes(pair.first)&&COMBOS[m]?.includes(pair.second))).map(pair=>({first:pair.first,second:pair.second,playedGames:pair.records,higherTogether:pair.concordant,opposing:pair.discordant,sourceFact:fact?.id??null,markets:player.markets.filter(m=>COMBOS[m]?.includes(pair.first)&&COMBOS[m]?.includes(pair.second))})),
      independentEvents:priors.map(event=>{
        const head=player.evidence.find(e=>e.id===event.sourceId),value=head?jsonObject(head.value):null;
        const verified=value?.independentEventStatus==='stored_native_reference_side'&&(event.referenceContractSide==='over'||event.referenceContractSide==='under');
        const raw=value?.probabilityOfUnspecifiedIndependentSide;
        const originalRawProbability=typeof raw==='number'&&Number.isFinite(raw)&&raw>=0&&raw<=1?raw:event.probabilityOfReferenceSide;
        return {market:event.market,line:event.line,mean:event.independentMean,sourceEvidence:aliases.get(event.sourceId)??null,sourceId:event.sourceId,sourceFact:evidence.independent_model.facts.find(f=>f.sourceIds.includes(event.sourceId))?.id??null,
          eventBinding:verified?'explicit_stored_native_side' as const:'legacy_reference_event_not_verified' as const,
          referenceSide:verified?event.referenceContractSide:null,probabilityOfReferenceSide:verified?event.probabilityOfReferenceSide:null,preferred:verified?event.preferredOutcome:'unavailable',
          originalReferenceSide:verified?null:event.referenceContractSide,originalRawProbability:verified?null:originalRawProbability};
      }),context};
  });
}

export type NamedSourceCorrection =
  |{status:'ready';text:string;bytes:number;affectedActorIds:string[]}
  |{status:'unavailable';reason:string;bytes:number;affectedActorIds:string[]};
const unavailable=(reason:string,affectedActorIds:string[],bytes=0):NamedSourceCorrection=>({status:'unavailable',reason,bytes,affectedActorIds});

function issueCategory(issue:ForecastSanityIssue,means:Partial<Record<Statistic,number>>,law:AcceptedPlayerLaw|null):string|null{
  if(issue.markets.some(m=>!Object.hasOwn(MARKET_NAMES,m)))return null;
  if(issue.code==='forecast_mean_outside_supplied_support'){
    const match=issue.example?.match(MEAN_EXAMPLE);if(!match)return null;
    const values=match.slice(2).map(Number);if(values.some(n=>!Number.isFinite(n)))return null;
    const stat=match[1];if(!statistic(stat)||means[stat]===undefined)return null;
    return `mean ${stat}=${means[stat]} outside [${values[1]},${values[2]}]`;
  }
  if(issue.code==='combo_dependence_erases_source_variation'){
    const pair=issue.example?.split(':')[0].split('/');if(!pair||pair.length!==2||!pair.every(statistic))return null;
    const first=law?.outcomes[pair[0]],second=law?.outcomes[pair[1]];
    if(!law||!first||!second)return null;
    let concordant=false,opposing=false;
    for(let i=0;i<law.weights.length;i++)for(let j=i+1;j<law.weights.length;j++){
      if(!law.weights[i]||!law.weights[j])continue;
      const product=(first[i]-first[j])*(second[i]-second[j]);
      if(product>0)concordant=true;if(product<0)opposing=true;
    }
    const missing=[...(!concordant?['concordant']:[]),...(!opposing?['opposing']:[])];
    return missing.length?`joint ${pair.join('/')} missing ${missing.join(' and ')}`:null;
  }
  if(issue.code==='unsupported_zero_probability_tail'||issue.code==='unsupported_priced_event_certainty'){
    const kind=issue.code==='unsupported_zero_probability_tail'?'prior':'priced';
    const events=issue.events;if(!events?.length||events.some(e=>!Object.hasOwn(MARKET_NAMES,e.market)||!Number.isFinite(e.line)||!['two_way','milestone'].includes(e.contract)))return null;
    return `${kind} tails ${unique(events.map(e=>`${MARKET_NAMES[e.market]}@${e.line}${e.contract==='milestone'?'(at-least)':''}`)).join(',')}`;
  }
  return null;
}
function coordinateCategory(code:string):string|null{
  const known:Readonly<Record<string,string>>={source_claims:'verified source reading selections',weights:'relative weights',named_keys:'named statistic keys',fields_or_identity:'coordinate shape/identity',
    'units:points_excluding_made_threes':'non-three points integer units','units:rebounds':'rebounds integer units','units:assists':'assists integer units','units:threes':'threes integer units',
    'bound:points':'total points bounds','bound:rebounds':'rebounds bounds','bound:assists':'assists bounds','bound:threes':'threes bounds'};
  // Existing generative diagnostics bound code strings to 32 characters.
  return known[code]??Object.entries(known).find(([full])=>full.slice(0,32)===code)?.[1]??null;
}

/** Complete ASCII feedback. No source/player/provider prose enters instructions.
 * This byte bound applies to the WHOLE returned text, not merely its examples. */
export function namedSourceCorrection(packet:GamePacket,draft:unknown):NamedSourceCorrection{
  if(packet.sport!=='nba')return unavailable('not_applicable',[]);
  const raw=object(draft),players=object(raw?.players);
  if(!raw||raw.wireRelease!==PROPS_AI_WIRE_RELEASE||Object.keys(raw).sort().join('|')!=='players|wireRelease'||!players||Object.keys(players).sort().join('|')!==packet.players.map(p=>p.id).sort().join('|')||packet.players.some(p=>!object(players[p.id])))return unavailable('not_applicable',packet.players.map(p=>p.id));
  let inspection:ReturnType<typeof inspectGenerativeDraft>;
  try{inspection=inspectGenerativeDraft(packet,draft);}catch{return unavailable('diagnostic_unavailable',packet.players.map(p=>p.id));}
  const affectedActorIds:string[]=[],rows:string[]=[];
  for(const [index,player]of packet.players.entries()){
    const source=inspection.source.find(s=>s.playerId===player.id)?.unhandled??[],coords=inspection.coordinates.filter(c=>c.playerId===player.id),format=inspection.format.filter(f=>f.playerIndex===index);
    if(!source.length&&!coords.length&&!format.length)continue;
    affectedActorIds.push(player.id);
    const rawLaw=inspection.canonical.players[player.id]?.law,accepted=rawLaw?validateLaw('nba',player,rawLaw):null;
    const means:Partial<Record<Statistic,number>>=accepted?Object.fromEntries(STATISTICS.filter(stat=>accepted.outcomes[stat]).map(stat=>[stat,lawForecast(accepted,stat,0).mean])):{};
    const categories=source.map(issue=>issueCategory(issue,means,accepted)),coordinate=coords.filter(c=>c.code!=='source_claims').map(c=>coordinateCategory(c.code));
    const fields=format.map(f=>f.field==='assessment'?'assessment':/^reader[0-7]$/.test(f.field)?READER_AREAS[Number(f.field.slice(6))].replaceAll('_',' '):null);
    if(categories.some(c=>c===null)||coordinate.some(c=>c===null)||fields.some(f=>f===null))return unavailable('not_applicable',packet.players.filter((p,i)=>inspection.source.some(s=>s.playerId===p.id&&s.unhandled.length)||inspection.coordinates.some(c=>c.playerId===p.id)||inspection.format.some(f=>f.playerIndex===i)).map(p=>p.id));
    const clauses=[...unique(categories as string[]),...(coordinate.length?[`coordinates ${unique(coordinate as string[]).join(',')}`]:[]),
      ...(fields.length?[`verified claim selections ${unique(fields as string[]).join(',')}`]:coords.some(c=>c.code==='source_claims')?['verified source reading selections']:[])];
    rows.push(`P${index}: ${clauses.join('; ')}.`);
  }
  if(!affectedActorIds.length)return unavailable('not_applicable',[]);
  const prefix='\nP labels are zero-based player order in the named cards. Recheck listed categories against exact sources. Reader errors require verified claim IDs and bounded judgments, never factual prose. Joint x/y pairs need indices i!=j with both weights>0: (x[i]-x[j])*(y[i]-y[j])>0 is concordant (higher-together), <0 is opposing; ties/zero weights do not count. Keep same-index joint scenarios. Tails need opposing event mass. Correct the law or select a supported exception reason; never invent, clip, or waive a check.\n';
  const text=prefix+rows.join('\n'),bytes=Buffer.byteLength(text,'utf8');
  if(!/^[\x00-\x7f]*$/.test(text))return unavailable('feedback_exceeds_cushion',affectedActorIds,bytes);
  if(bytes>NAMED_SOURCE_CORRECTION_MAX_BYTES)return unavailable('feedback_exceeds_cushion',affectedActorIds,bytes);
  return{status:'ready',text,bytes,affectedActorIds};
}
