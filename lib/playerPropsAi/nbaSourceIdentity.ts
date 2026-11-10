/** Exact-game source identity only. Missing provider team values cannot hide a
 * separately supplied team, and conflicting supplied teams are never guessed.
 * No roster inference, provider request, omitted actor or historical backfill. */
import {instant,invariant} from './evidence';
import {propsTeam} from './teamIdentity';
export const PROPS_AI_NBA_SOURCE_RELEASE='player_props_ai_nba_source_2026_11_09_r1_exact_source_evidence' as const;
export const PROPS_AI_NBA_CURRENT_SOURCE_RELEASE='player_props_ai_nba_source_2026_11_10_r2_current_actor_authority' as const;
type Native={team:string;opponent:string;evaluatedAt:string};
type Offer={playerTeam:string|null;observedAt:string;fetchedAt:string;receivedAt?:string|null;isLive?:boolean};
export type NbaCurrentActorAuthority={id:string;name:string;team:string;opponent:string;markets:string[]};
type NamedNative=Native&{playerId:string;playerName:string;market:string;scheduledStart?:string};
type NamedOffer=Offer&{canonicalPlayerId:string|null;playerName:string|null;market:string;provider:string};
type ActorSources={native:readonly NamedNative[];offers:readonly NamedOffer[];teamNames:ReadonlyMap<string,string>;home:string;away:string;start?:string;snapshotAt:string;archiveAt:string;cutoff:string};
const actorName=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const sameNbaSourceActorName=(first:string,second:string)=>Boolean(actorName(first))&&actorName(first)===actorName(second);
/** Live-only identity authority. Retained price history is deliberately absent:
 * it can describe chronology, never the current actor, label, team or scope. */
export function resolveNbaCurrentActors(args:ActorSources):NbaCurrentActorAuthority[]{
 const currentIds=[...new Set(args.offers.flatMap(q=>q.canonicalPlayerId?[q.canonicalPlayerId]:[]))];
 return currentIds.map(id=>{
  const offers=args.offers.filter(q=>q.canonicalPlayerId===id),markets=new Set(offers.map(q=>q.market)),native=instant(args.snapshotAt)<=instant(args.cutoff)?args.native.filter(row=>row.playerId===id&&markets.has(row.market)&&instant(row.evaluatedAt)<=instant(args.cutoff)):[];
  invariant(native.every(row=>row.scheduledStart===undefined||args.start===undefined||instant(row.scheduledStart)===instant(args.start)),'NBA native prior fixture identity incomplete');
  const {team,opponent}=resolveNbaOfferedPlayerTeam({...args,native,offers});
  invariant([propsTeam(args.home),propsTeam(args.away)].includes(team)&&[propsTeam(args.home),propsTeam(args.away)].includes(opponent)&&team!==opponent,'NBA player/team matchup identity incomplete');
  const namedOffers=offers.filter(q=>typeof q.playerName==='string'&&q.playerName.trim()).sort((a,b)=>Number(b.provider==='balldontlie')-Number(a.provider==='balldontlie')||a.playerName!.localeCompare(b.playerName!));
  // The exact canonical ID binds native model rows. When current authoritative
  // names are supplied they own the label; a native display alias is not another
  // identity vote and cannot replace that label. Native fallback names are used
  // only when all current names are genuinely absent.
  const names=namedOffers.length?namedOffers.map(q=>q.playerName!):native.map(row=>row.playerName).filter(name=>typeof name==='string'&&name.trim());
  invariant(names.length>0&&names.every(name=>sameNbaSourceActorName(name,names[0])),'NBA current player-name identity incomplete or conflicting');
  return{id,name:names[0],team,opponent,markets:[...new Set(offers.map(q=>q.market))].sort()};
 });
}
/** Empty successful collections have no evaluable offered actors. Known old
 * identities are useful only to observe withdrawal of previously public scopes;
 * ambiguous history cannot block another known withdrawal identity. */
export function resolveNbaWithdrawalActors(args:ActorSources):NbaCurrentActorAuthority[]{
 const native=instant(args.snapshotAt)<=instant(args.cutoff)?args.native.filter(row=>instant(row.evaluatedAt)<=instant(args.cutoff)):[];
 const ids=[...new Set([...native.map(row=>row.playerId),...args.offers.flatMap(q=>q.canonicalPlayerId?[q.canonicalPlayerId]:[])])];
 return ids.flatMap(id=>{
  const own=native.filter(row=>row.playerId===id),offers=args.offers.filter(q=>q.canonicalPlayerId===id);
  try{
   if(!own.length)return resolveNbaCurrentActors({...args,native:[],offers});
   invariant(own.every(row=>row.scheduledStart===undefined||args.start===undefined||instant(row.scheduledStart)===instant(args.start)),'NBA withdrawal fixture identity unavailable');
   const {team,opponent}=resolveNbaOfferedPlayerTeam({...args,native:own,offers:[]}),names=own.map(row=>row.playerName).filter(name=>typeof name==='string'&&name.trim());
   invariant([propsTeam(args.home),propsTeam(args.away)].includes(team)&&[propsTeam(args.home),propsTeam(args.away)].includes(opponent)&&team!==opponent&&names.length&&names.every(name=>sameNbaSourceActorName(name,names[0])),'NBA withdrawal identity unavailable');
   return[{id,name:names[0],team,opponent,markets:[...new Set(own.map(row=>row.market))].sort()}];
  }catch{return[];}
 });
}
export function resolveNbaOfferedPlayerTeam(args:{native:readonly Native[];offers:readonly Offer[];teamNames:ReadonlyMap<string,string>;home:string;away:string;snapshotAt:string;archiveAt:string;cutoff:string}){
 const cutoff=instant(args.cutoff),known=new Set([...args.teamNames.values(),args.home,args.away].map(propsTeam)),teams=new Set<string>();
 if(instant(args.snapshotAt)<=cutoff)for(const row of args.native)if(instant(row.evaluatedAt)<=cutoff){
  const team=propsTeam(row.team),opponent=propsTeam(row.opponent),home=propsTeam(args.home),away=propsTeam(args.away);
  if(!((team===home&&opponent===away)||(team===away&&opponent===home)))return{team:'unknown',opponent:'unknown'};
  teams.add(team);
 }
 for(const q of args.offers){
  const available=q.receivedAt??args.archiveAt;
  if(q.isLive||!q.playerTeam||instant(available)>cutoff||instant(q.observedAt)>instant(available)||instant(q.fetchedAt)>instant(available))continue;
  const team=propsTeam(args.teamNames.get(q.playerTeam)??q.playerTeam);
  if(known.has(team))teams.add(team);
 }
 const team=teams.size===1?[...teams][0]:'unknown',home=propsTeam(args.home),away=propsTeam(args.away);
 return{team,opponent:team===home?away:team===away?home:'unknown'};
}

/** The final arbitrated pick is not the independent probability's event. Never
 * infer an unstored legacy reference side or complement its unknown probability. */
export function nbaIndependentProbabilityEvent(row:{independentSide?:'over'|'under';independentProbability?:number|null}){
 const side=row.independentSide==='over'||row.independentSide==='under'?row.independentSide:null;
 return{selectedSide:side,independentSelectedSideProbability:side?row.independentProbability??null:null,
  probabilityOfUnspecifiedIndependentSide:side?null:row.independentProbability??null,
  independentEventStatus:side?'stored_native_reference_side':'original_native_reference_side_not_stored'};
}
