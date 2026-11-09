/** Exact-game source identity only. Missing provider team values cannot hide a
 * separately supplied team, and conflicting supplied teams are never guessed.
 * No roster inference, provider request, omitted actor or historical backfill. */
import {instant} from './evidence';
import {propsTeam} from './teamIdentity';
export const PROPS_AI_NBA_SOURCE_RELEASE='player_props_ai_nba_source_2026_11_09_r1_exact_source_evidence' as const;
type Native={team:string;opponent:string;evaluatedAt:string};
type Offer={playerTeam:string|null;observedAt:string;fetchedAt:string;receivedAt?:string|null;isLive?:boolean};
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
