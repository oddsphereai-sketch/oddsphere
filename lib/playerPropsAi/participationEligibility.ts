/** Prospective actor action qualification, independent of a conditional stat law.
 * Pure: reads already captured exact-player facts; never fetches or infers health
 * from omission. Existing accepted reviews and locked payloads are not rewritten.
 */
import type {Evidence,GamePacket,Json,Player} from './evidenceContract';
import type {EspnNbaGameInjuries} from '../services/nba/espnNbaInjuries';
import {digest,instant,invariant} from './evidence';
import {propsTeam} from './teamIdentity';
import {sameNflPropActorName} from './nflPlayerIdentity';

export const PROPS_AI_PARTICIPATION_ELIGIBILITY_RELEASE='player_props_ai_participation_2026_11_10_r2_verified_nfl_actor_sources' as const;
export type ParticipationFact={evidenceId:string;source:string;availableAt:string;effectiveAt:string;rawStatus:string;status:'blocked'|'eligible'|'unknown';reason:string;ownIdentityBasis:'exact_team_and_name'|'exact_team_report_omission'|'attached_native_actor'|'attached_batter_lineup'|'exact_team_and_id_bound_alias'|'exact_team_and_provider_id';sourcePlayerName?:string;sourcePlayerId?:string;actorProviderId?:string;sourceTeam?:string;timeBasis:'source_response_availability'|'provider_reported'|'source_report_updated'|'source_capture_clock'|'evidence_availability'};
export type PlayerParticipationEligibility={release:typeof PROPS_AI_PARTICIPATION_ELIGIBILITY_RELEASE;status:'blocked'|'eligible'|'unknown';blocked:boolean;reason:string|null;availableAt:string|null;effectiveAt:string|null;facts:ParticipationFact[];conflict:boolean};
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const name=(s:unknown)=>typeof s==='string'?s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/[^a-z0-9]/g,''):'';
const time=(value:unknown)=>typeof value==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const normalize=(s:string)=>s.trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
function state(raw:string,basis:ParticipationFact['ownIdentityBasis']):Pick<ParticipationFact,'status'|'reason'>{
 const s=normalize(raw);
 if(s==='not in lineup'&&basis==='attached_batter_lineup')return{status:'blocked',reason:'not_in_posted_lineup'};
 if(s==='out'||s==='out for season'||s==='did not play'||s==='dnp')return{status:'blocked',reason:'explicit_out'};
 if(s==='inactive')return{status:'blocked',reason:'explicit_inactive'};
 if(s==='suspended'||s==='suspension')return{status:'blocked',reason:'explicit_suspension'};
 if(['injured reserve','reserve injured','ir','physically unable to perform','pup','reserve pup','reserve retired','retired'].includes(s))return{status:'blocked',reason:'explicit_unavailable_roster_status'};
 if(['available','active','cleared','explicit clearance'].includes(s)||basis==='attached_batter_lineup'&&['posted','confirmed'].includes(s))return{status:'eligible',reason:'explicit_participation_clearance'};
 return{status:'unknown',reason:'participation_not_confirmed'};
}
function exactFixture(value:Record<string,unknown>,packet:GamePacket){
 if(typeof value.canonicalGameId==='string'&&value.canonicalGameId!==packet.gameId)return false;
 if(typeof value.gameId==='string'&&value.gameId!==packet.gameId)return false;
 if(typeof value.scheduledStart==='string'&&time(value.scheduledStart)!==instant(packet.start))return false;
 if(typeof value.start==='string'&&time(value.start)!==instant(packet.start))return false;
 return true;
}
/** Explicit unknown/questionable/pending or unlisted facts never clear an older
 * explicit block. Equal-clock opposite facts remain blocked as a source conflict.
 */
export function playerParticipationEligibility(packet:GamePacket,player:Player):PlayerParticipationEligibility{
 const cutoff=instant(packet.cutoff),facts:ParticipationFact[]=[];
 const providerId=packet.sport==='nfl'?player.id.match(/^nfl-bdl-player:(\d+)$/)?.[1]:undefined;
 const ownName=(raw:unknown)=>typeof raw==='string'&&Boolean(name(player.name))&&(name(raw)===name(player.name)||Boolean(providerId&&sameNflPropActorName(raw,player.name,providerId)));
 const reportBasis=(raw:unknown):ParticipationFact['ownIdentityBasis']=>typeof raw==='string'&&name(raw)!==name(player.name)?'exact_team_and_id_bound_alias':'exact_team_and_name';
 const push=(e:Evidence,raw:unknown,basis:ParticipationFact['ownIdentityBasis'],clocks:{statusResponseAvailableAt?:unknown;reportedAt?:unknown;reportUpdatedAt?:unknown;capturedAt?:unknown}={},identity:Pick<ParticipationFact,'sourcePlayerName'|'sourcePlayerId'|'actorProviderId'|'sourceTeam'>={})=>{
  if(typeof raw!=='string'||!raw.trim())return;
  const available=time(e.availableAt);if(!Number.isFinite(available)||available>cutoff)return;
  const candidates=[['provider_reported',clocks.reportedAt],['source_report_updated',clocks.reportUpdatedAt],['source_response_availability',clocks.statusResponseAvailableAt],['source_capture_clock',clocks.capturedAt]] as const;
  const supplied=candidates.find(([,value])=>value!==undefined&&value!==null&&value!=='');
  const effective=supplied?time(supplied[1]):available;
  if(!Number.isFinite(effective)||effective>available||effective>cutoff)return;
  facts.push({evidenceId:e.id,source:e.source,availableAt:e.availableAt,effectiveAt:new Date(effective).toISOString(),rawStatus:raw,...identity,...state(raw,basis),ownIdentityBasis:basis,timeBasis:supplied?.[0]??'evidence_availability'});
  return true;
 };
 for(const e of player.evidence){
  if(e.kind!=='availability'&&e.kind!=='independent_model'&&!(packet.sport==='nfl'&&providerId&&e.kind==='matchup'&&/exact-game depth/.test(e.source)))continue;
  const value=obj(e.value);if(!exactFixture(value,packet))continue;
  if(e.kind==='matchup'){
   // The existing depth producer preserves BDL identity and a collector capture
   // clock, not a provider report/update or a response-completion timestamp.
   const sides=[obj(value.away),obj(value.home)];
   if(new Set(sides.map(side=>typeof side.team==='string'?propsTeam(side.team):null)).size!==2||![player.team,player.opponent].every(team=>sides.some(side=>typeof side.team==='string'&&propsTeam(side.team)===propsTeam(team))))continue;
   const own=sides.find(side=>typeof side.team==='string'&&propsTeam(side.team)===propsTeam(player.team))!;
   const captured=time(own.capturedAt);
   if(own.provider!=='balldontlie'||!Number.isFinite(captured)||captured>time(e.availableAt)||captured>cutoff)continue;
   for(const row of (Array.isArray(own.roster)?own.roster:[]).map(obj)){
    if(row.playerId!==providerId||!ownName(row.name))continue;
    // Roster membership/"active" and projected starter flags are not a medical
    // clearance. Explicit injury uncertainty is retained without clearing Out.
    const raw=row.injuryStatus;
    if(typeof raw!=='string'||state(raw,'exact_team_and_provider_id').status!=='blocked'&&!['questionable','doubtful','probable','day to day','game time decision','gtd','unknown'].includes(normalize(raw)))continue;
    push(e,raw,'exact_team_and_provider_id',{capturedAt:own.capturedAt},{sourcePlayerName:String(row.name),sourcePlayerId:providerId,sourceTeam:String(own.team)});
   }
   continue;
  }
  if(e.kind==='independent_model'){
   const a=obj(obj(value.context).availability);
   if(a.listed===true)push(e,a.status,'attached_native_actor',{reportedAt:a.reportedAt,reportUpdatedAt:a.reportUpdatedAt});
   continue;
  }
  const report=obj(value.originalReport);
  const reportTeams=[report.awayTeam,report.homeTeam].filter((v):v is string=>typeof v==='string').map(propsTeam);
  const reportMatchup=reportTeams.length===0||reportTeams.length===2&&new Set(reportTeams).size===2&&[player.team,player.opponent].every(team=>reportTeams.includes(propsTeam(team)));
  let ownClearance=false;
  if(exactFixture(report,packet)&&reportMatchup&&Array.isArray(report.playerClearances))for(const clearance of report.playerClearances.map(obj)){
   if(typeof clearance.teamAbbreviation==='string'&&propsTeam(clearance.teamAbbreviation)===propsTeam(player.team)&&ownName(clearance.name)){
    const admitted=push(e,'explicit clearance',reportBasis(clearance.name),{reportedAt:clearance.reportedAt},{sourcePlayerName:String(clearance.name),...(providerId?{actorProviderId:providerId}:{}),sourceTeam:clearance.teamAbbreviation});
    ownClearance=Boolean(admitted)||ownClearance;
   }
  }
  const context=obj(value.context),sides=[obj(context.away),obj(context.home)];
  const teams=sides.map(side=>typeof side.team==='string'?propsTeam(side.team):null);
  if(teams.includes(propsTeam(player.team))&&teams.includes(propsTeam(player.opponent))){
   const own=sides.find(side=>typeof side.team==='string'&&propsTeam(side.team)===propsTeam(player.team));
   const rows=Array.isArray(own?.players)?own.players:[];
   const ownRows=rows.map(obj).filter(row=>ownName(row.name));
   for(const row of ownRows)push(e,row.status,reportBasis(row.name),{statusResponseAvailableAt:row.availableAt,reportedAt:row.reportedAt??row.reported_at,reportUpdatedAt:context.reportUpdatedAt??report.reportUpdatedAt},{sourcePlayerName:String(row.name),...(providerId?{actorProviderId:providerId}:{}),sourceTeam:String(own!.team)});
   // Healthy actors are deliberately omitted from the reportable injury rows.
   // A valid own-player clearance in THIS report owns that omission; it cannot
   // be turned into a newer synthetic uncertain status at fetch time.
   if(!ownRows.length&&!ownClearance)push(e,'not_listed','exact_team_report_omission');
  }
  // MLB lineup records are constructed per exact actor by the existing native
  // adapter. A posted batting position is opportunity, not a medical clearance.
  if(packet.sport==='mlb'&&player.markets.some(m=>m.startsWith('batter_'))&&Object.hasOwn(value,'battingOrder')){
   const s=typeof value.status==='string'?normalize(value.status):'';
   if(s==='not in lineup'||['posted','confirmed'].includes(s)&&Number.isInteger(value.battingOrder)&&Number(value.battingOrder)>=1&&Number(value.battingOrder)<=9)push(e,value.status,'attached_batter_lineup',{reportedAt:value.asOfTimestamp});
  }
 }
 const unique=[...new Map(facts.map(f=>[digest(f),f])).values()].sort((a,b)=>time(a.effectiveAt)-time(b.effectiveAt)||a.evidenceId.localeCompare(b.evidenceId));
 const explicit=unique.filter(f=>f.status!=='unknown'),latest=explicit.at(-1);
 const selected=latest?explicit.filter(f=>time(f.effectiveAt)===time(latest.effectiveAt)):[];
 const conflict=selected.some(f=>f.status==='blocked')&&selected.some(f=>f.status==='eligible');
 const blocked=selected.some(f=>f.status==='blocked'),newest=unique.at(-1),laterUnknown=Boolean(latest&&newest&&newest.status==='unknown'&&time(newest.effectiveAt)>time(latest.effectiveAt)),status=blocked?'blocked':selected.length&&!laterUnknown?'eligible':'unknown';
 const relevant=status==='unknown'?newest?[newest]:[]:selected;
 return{release:PROPS_AI_PARTICIPATION_ELIGIBILITY_RELEASE,status,blocked,reason:conflict?'conflicting_explicit_participation_status':blocked?selected.find(f=>f.status==='blocked')!.reason:null,availableAt:relevant.length?new Date(Math.max(...relevant.map(f=>time(f.availableAt)))).toISOString():null,effectiveAt:(status==='unknown'?newest:latest)?.effectiveAt??null,facts:unique,conflict};
}

/** The caller supplies the actual completion clock after its existing fetch;
 * availableAt is not fabricated as a provider-declared reportUpdatedAt. */
export type CapturedNbaParticipationReport={gameId:string;start:string;awayTeam:string;homeTeam:string;expectedEventId:string;availableAt:string;report:EspnNbaGameInjuries};
export function attachCapturedNbaParticipationReports(packet:GamePacket,captures:readonly CapturedNbaParticipationReport[]):GamePacket{
 if(packet.sport!=='nba')return packet;
 const matches=captures.filter(c=>c.gameId===packet.gameId&&time(c.start)===instant(packet.start)&&time(c.availableAt)<=instant(packet.cutoff));
 return{...packet,players:packet.players.map(player=>{
  const evidence=[...player.evidence];
  for(const capture of matches){
   if(String(capture.report.eventId)!==String(capture.expectedEventId))continue;
   const away=propsTeam(capture.awayTeam),home=propsTeam(capture.homeTeam);
   if(![away,home].includes(propsTeam(player.team))||![away,home].includes(propsTeam(player.opponent))||away===home)continue;
   const entries=[...capture.report.teams.entries()];
   if(entries.length!==2||new Set(entries.map(([team])=>propsTeam(team))).size!==2||![away,home].every(team=>entries.some(([key])=>propsTeam(key)===team)))continue;
   const side=(team:string)=>({team,known:true,players:entries.find(([key])=>propsTeam(key)===team)![1].map(row=>({...structuredClone(row),sourcePlayerId:row.source_player_id??null,reportedAt:row.reported_at??null,availableAt:capture.availableAt}))});
   const raw={eventId:capture.report.eventId,teams:entries.map(([team,players])=>({team,players:structuredClone(players)}))};
   const value={canonicalGameId:packet.gameId,scheduledStart:packet.start,context:{source:'ESPN',away:side(away),home:side(home)},originalReport:raw,sourceAvailability:{availableAt:capture.availableAt,meaning:'Actual completion of the existing normalized ESPN report fetch; not provider report time.'},meaning:'Same underlying ESPN injury evidence as cached context; correlated repeated observations are not independent votes. Unlisted players are not confirmed healthy or starters.'};
   const id=`${player.id}:same-cycle-nba-availability:${capture.report.eventId}:${digest(value).slice(0,16)}`;
   invariant(!evidence.some(e=>e.id===id),'Duplicate captured NBA participation source');
   evidence.push({id,kind:'availability',source:'same-cycle existing ESPN exact-game normalized injury report',availableAt:capture.availableAt,value:JSON.parse(JSON.stringify(value)) as Json});
  }
  return{...player,evidence};
 })};
}
