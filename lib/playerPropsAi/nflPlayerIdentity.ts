import type {NflPlayerPropsRuntimeDecision} from '../services/football/nflPlayerPropsRuntime';
import type {NflPlayerPropPriceObservation} from '../services/football/nflPlayerPropsContract';
import type {NflPlayerPropsInferenceContext} from '../services/football/nflPlayerPropsInferenceContext';
import type {LivePropsGame} from './liveSources';
import {propsTeam} from './teamIdentity';
import {invariant} from './evidence';
import {PROPS_AI_NFL_EVENT_SOURCE_RELEASE} from "./sourceEvents";
export const PROPS_AI_NFL_SOURCE_RELEASE=PROPS_AI_NFL_EVENT_SOURCE_RELEASE;
/** Separate from the unchanged event-source qualification contract. */
export const PROPS_AI_NFL_IDENTITY_RELEASE='player_props_ai_nfl_identity_2026_11_10_r1_cutoff_exact_id' as const;
const norm=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/[^a-z]/g,'');
// Name equivalence is explicit and must bind the independently captured native ID.
const aliases=[
 {id:'666',names:['Marquise Brown','Hollywood Brown']},
 {id:'12',names:['Kenneth Gainwell','Kenny Gainwell']},
 {id:'33934397',names:['KC Concepcion','Kevin Concepcion']},
 {id:'734',names:['Chig Okonkwo','Chigoziem Okonkwo']},
] as const;
export function sameNflPropActorName(a:string,b:string,id?:string|null):boolean{
 if(norm(a)===norm(b))return true;
 return aliases.some(group=>group.id===id&&group.names.some(n=>norm(n)===norm(a))&&group.names.some(n=>norm(n)===norm(b)));
}
type IdentityFact={id:string;name:string|null;team:string|null;position?:string|null};
const time=(s:string|null|undefined)=>s&&/(?:Z|[+-]\d\d:\d\d)$/.test(s)?Date.parse(s):NaN;
const present=(s:string|null|undefined):s is string=>Boolean(s?.trim());
type SourceIdentityArgs={row:NflPlayerPropPriceObservation;rows:readonly NflPlayerPropsRuntimeDecision[];observations:readonly NflPlayerPropPriceObservation[];context:NflPlayerPropsInferenceContext;game:LivePropsGame;cutoff:string;
 /** Actual completed collector snapshot, including later name/team enrichment. */
 observationsAvailableAt:string;
 /** Original native snapshot availability. Absence disables stored fallback. */
 storedAvailableAt?:string};
type ResolvedIdentity={id:string;providerId:string;name:string;team:string;opponent:string;rosterPosition:string|null};
/** One synchronous packet construction owns this scope. Inputs are its captured
 * immutable source arrays; never retain this resolver across packets/requests or
 * source/cutoff changes. All original row guards and conflicting facts remain.
 * Facts are prepared lazily, so an unavailable target row cannot cause an
 * unrelated roster validation that the original single-row call never reached.
 */
export function createNflPacketActorResolver(args:Omit<SourceIdentityArgs,'row'>){
 const {game}=args,cutoff=time(args.cutoff),start=time(game.start),sourceAt=time(args.observationsAvailableAt);
 const exact=(q:NflPlayerPropPriceObservation)=>q.canonicalGameId===game.id&&time(q.scheduledStart)===start;
 const available=(q:NflPlayerPropPriceObservation)=>!q.isLive&&Number.isFinite(time(q.receivedAt))&&time(q.receivedAt)<=sourceAt&&Number.isFinite(time(q.observedAt))&&time(q.observedAt)<=time(q.receivedAt)&&Number.isFinite(time(q.fetchedAt))&&time(q.fetchedAt)<=time(q.receivedAt);
 type Prepared={facts:IdentityFact[];byId:Map<string,IdentityFact[]>;byName:Map<string,IdentityFact[]>;rosterById:Map<string,IdentityFact[]>;positions:Map<string,string[]>};
 let prepared:Prepared|null|undefined;
 const prepare=():Prepared|null=>{
  if(prepared!==undefined)return prepared;
  const contexts=args.context.games.filter(g=>g.canonicalGameId===game.id);
  if(contexts.length!==1||!Number.isFinite(time(args.context.capturedAt))||time(args.context.capturedAt)>cutoff)return prepared=null;
  const g=contexts[0];
  invariant(time(g.scheduledStart)===start&&propsTeam(g.homeTeam)===propsTeam(game.home)&&propsTeam(g.awayTeam)===propsTeam(game.away),'NFL roster game identity mismatch');
  const native:IdentityFact[]=args.observations.filter(q=>q.provider==='balldontlie'&&!q.isOpening&&exact(q)&&available(q)&&present(q.providerPlayerId)).map(q=>({id:q.providerPlayerId!,name:q.playerName,team:q.playerTeam}));
  const roster:IdentityFact[]=[];
  for(const [depth,team]of [[g.awayDepth,g.awayTeam],[g.homeDepth,g.homeTeam]] as const){
   if(!Number.isFinite(time(depth.capturedAt))||time(depth.capturedAt)>time(args.context.capturedAt)||time(depth.capturedAt)>cutoff)continue;
   invariant(propsTeam(depth.team)===propsTeam(team),'NFL roster team identity mismatch');
   for(const p of depth.roster)if(present(p.playerId))roster.push({id:p.playerId,name:p.name,team,position:p.position});
  }
  const storedAt=time(args.storedAvailableAt);
  const stored:IdentityFact[]=Number.isFinite(storedAt)&&storedAt<=cutoff?args.rows.filter(p=>p.gameId===game.id&&time(p.scheduledStart)===start&&present(p.providerPlayerId)&&Number.isFinite(time(p.observedAt))&&time(p.observedAt)<=storedAt&&Number.isFinite(time(p.forecastContext?.featureAsOf))&&time(p.forecastContext.featureAsOf)<=storedAt).map(p=>({id:p.providerPlayerId!,name:p.playerName,team:p.team})):[];
  const facts=[...native,...roster,...stored],byId=new Map<string,IdentityFact[]>(),positions=new Map<string,string[]>();
  // Preserve every fact and its original order, including conflicting duplicates.
  for(const fact of facts){const own=byId.get(fact.id)??[];own.push(fact);byId.set(fact.id,own);}
  const rosterById=new Map<string,IdentityFact[]>();
  for(const fact of roster){const own=rosterById.get(fact.id)??[];own.push(fact);rosterById.set(fact.id,own);}
  return prepared={facts,byId,byName:new Map(),rosterById,positions};
 };
 return(row:NflPlayerPropPriceObservation):ResolvedIdentity|null=>{
  if(!Number.isFinite(cutoff)||!Number.isFinite(start)||cutoff>=start||!Number.isFinite(sourceAt)||sourceAt>cutoff)return null;
  if(!exact(row)||!available(row))return null;
  // Owls has no BDL namespace; do not infer an independent ID mapping.
  if(row.provider!=='balldontlie'&&present(row.providerPlayerId))return null;
  const scope=prepare();if(!scope)return null;
  let byName:IdentityFact[]=[];
  if(present(row.playerName)){
   // Name equality and explicit ID-bound aliases depend on this same norm.
   // Equivalent spellings share fact references; the original target label is
   // still returned verbatim. This avoids retaining duplicate match arrays.
   const nameKey=norm(row.playerName),prior=scope.byName.get(nameKey);
   if(prior)byName=prior;
   else{byName=scope.facts.filter(p=>present(p.name)&&sameNflPropActorName(p.name,row.playerName!,p.id));scope.byName.set(nameKey,byName);}
  }
  const ids=new Set([...(row.provider==='balldontlie'&&present(row.providerPlayerId)?[row.providerPlayerId]:[]),...byName.map(p=>p.id)]);
  invariant(ids.size<=1,'Conflicting NFL provider player identity');const id=[...ids][0];if(!id)return null;
  const selected=scope.byId.get(id)??[],names=[...new Set([row.playerName,...selected.map(p=>p.name)].filter(present))];
  if(!names.length)return null;
  invariant(names.every(a=>names.every(b=>sameNflPropActorName(a,b,id))),'Conflicting NFL player-name identity');
  const teams=new Set([row.playerTeam,...selected.map(p=>p.team)].filter(present).map(propsTeam));
  invariant(teams.size<=1,'Conflicting NFL player-team identity');const team=[...teams][0];
  if(!team||![propsTeam(game.home),propsTeam(game.away)].includes(team))return null;
  const playerName=present(row.playerName)?row.playerName:[...names].sort()[0];
  let positions=scope.positions.get(id);
  if(!positions){positions=[...new Set((scope.rosterById.get(id)??[]).flatMap(p=>present(p.position)?[p.position]:[]))].sort();scope.positions.set(id,positions);}
  return{id:`nfl-bdl-player:${id}`,providerId:id,name:playerName,team,opponent:team===propsTeam(game.home)?propsTeam(game.away):propsTeam(game.home),rosterPosition:positions.length?positions.join(' | '):null};
 };
}
/** Compatibility entry point: each independent call owns a fresh captured scope. */
export function resolveNflPropSourcePlayer(args:SourceIdentityArgs):ResolvedIdentity|null{
 const{row,...source}=args;return createNflPacketActorResolver(source)(row);
}
