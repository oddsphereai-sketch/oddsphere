/** Prospective R31 context comparison. Raw sources and legacy hashes remain exact.
 * Only identified medical report sets are unordered; logs, depth/role, lineup
 * and every other source retain the established content contract. */
import type {Evidence,GamePacket,Json,Player} from './evidenceContract';
import {criticalContextHashes} from './criticalContext';
import {digest,instant,stable} from './evidence';
import {propsTeam} from './teamIdentity';

export const PROPS_AI_READER_CONTEXT_RELEASE='player_props_ai_reader_context_2026_11_10_r1_medical_sets' as const;
const object=(v:unknown):Record<string,Json>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,Json>:null;
const clockKeys=new Set(['reportedAt','reported_at','reportUpdatedAt','availableAt','capturedAt','asOfTimestamp']);
const time=(v:unknown)=>typeof v==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
const name=(v:string)=>v.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const state=(v:Json|undefined)=>typeof v==='string'?v.trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' '):'';
const explicit=new Set(['out','out for season','did not play','dnp','inactive','suspended','suspension','injured reserve','reserve injured','ir','physically unable to perform','pup','reserve pup','reserve retired','retired','available','active','cleared','explicit clearance']);
const noClocks=(row:Record<string,Json>)=>Object.fromEntries(Object.entries(row).filter(([key])=>!clockKeys.has(key)));
const set=(rows:Json[])=>[...new Map(rows.map(row=>[stable(row),row])).values()].sort((a,b)=>stable(a).localeCompare(stable(b)));
type Medical={identity:string;nameScope:string;hasProviderId:boolean;content:Json;explicit:boolean;effective:number;valid:boolean;invalidClocks?:Json};

function medicalSource(packet:GamePacket,player:Player,e:Evidence):{evidence:Evidence;records:Medical[]}{
 const value=object(e.value),context=object(value?.context),away=object(context?.away),home=object(context?.home),report=object(value?.originalReport),records:Medical[]=[];
 const record=(row:Record<string,Json>,team:string,parents:Record<string,Json>={},clearance=false)=>{
  const supplied=[row.reportedAt??row.reported_at,row.reportUpdatedAt??parents.reportUpdatedAt,row.availableAt,row.capturedAt??parents.capturedAt,row.asOfTimestamp].filter(v=>v!==undefined&&v!==null&&v!=='');
  const all=[...supplied,e.availableAt],available=time(e.availableAt),effective=supplied.length?time(supplied[0]):available;
  const valid=all.every(v=>Number.isFinite(time(v))&&time(v)<=available&&time(v)<=instant(packet.cutoff));
  const suppliedId=row.sourcePlayerId??row.source_player_id??row.playerId??row.player_id;
  const hasProviderId=Boolean(typeof suppliedId==='string'&&suppliedId.trim()||typeof suppliedId==='number'&&Number.isFinite(suppliedId));
  // These two typed NBA forms carry the same ESPN source IDs despite
  // different evidence display labels. Only explicit known provider metadata
  // can share a namespace; an unknown/conflicting source keeps its own scope.
  const declaredProviders=[context?.source,report?.source,parents.provider].filter((v):v is string=>typeof v==='string'&&v.length>0);
  const knownProvider=(v:string)=>v==='ESPN'?'espn':v==='BALLDONTLIE'||v==='balldontlie'?'balldontlie':null;
  const providers=declaredProviders.map(knownProvider);
  const providerNamespace=providers.length&&providers.every(p=>p!==null&&p===providers[0])?providers[0]:stable(['unverified_source',e.source,declaredProviders]);
  const identity=hasProviderId
   ?[propsTeam(team),'provider_actor',providerNamespace,String(suppliedId)]:[propsTeam(team),'reported_name',name(String(row.name))];
  records.push({identity:stable(identity),nameScope:stable([propsTeam(team),name(String(row.name))]),hasProviderId,content:noClocks(row),explicit:clearance||explicit.has(state(row.status)),effective,valid,
   ...(!valid?{invalidClocks:all as Json}:{} )});
 };
 // Native actor and roster records keep their original ordering/content. Their
 // clocks can nevertheless change medical authority, so bind the winning facts.
 const native=object(context?.availability);
 if(e.kind==='independent_model'&&native?.listed===true&&typeof native.status==='string')record({...native,name:player.name,playerId:player.id},player.team);
 if(e.kind==='matchup'&&/exact-game depth/.test(e.source)&&value){
  for(const side of [object(value.away),object(value.home)])if(side&&typeof side.team==='string'&&[player.team,player.opponent].some(team=>propsTeam(team)===propsTeam(side.team as string))&&Array.isArray(side.roster))for(const raw of side.roster){
   const row=object(raw);if(row&&typeof row.name==='string'&&typeof row.injuryStatus==='string'&&row.injuryStatus.trim())record({...row,status:row.injuryStatus},side.team,side);
  }
 }
 if(e.kind!=='availability'||!value||!context||!away||!home)return{evidence:e,records};
 const sides=[away,home];
 if(!sides.every(s=>typeof s.team==='string'&&Array.isArray(s.players)&&s.players.every(row=>{const r=object(row);return r&&typeof r.name==='string'&&r.name.trim()&&typeof r.status==='string';}))
  ||new Set(sides.map(s=>propsTeam(String(s.team)))).size!==2||![player.team,player.opponent].every(team=>sides.some(s=>propsTeam(String(s.team))===propsTeam(team))))return{evidence:e,records};
 const reportClocks={reportUpdatedAt:context.reportUpdatedAt??report?.reportUpdatedAt??null};
 const playerRows=(rows:Json[],team:string)=>set(rows.map(raw=>{
  const row=object(raw)!;record(row,team,reportClocks);
  // Only known medical clocks are removed here, before sorting the set.
  // Authority below retains the winning full facts and rejects invalid clocks.
  return noClocks(row);
 }));
 const canonicalContext={...context,away:{...away,players:playerRows(away.players as Json[],String(away.team))},home:{...home,players:playerRows(home.players as Json[],String(home.team))}};
 let canonicalReport:Json|undefined=value.originalReport;
 if(report){
  const transformed:Record<string,Json>={...report};
  if(Array.isArray(report.teams)&&report.teams.length===2&&report.teams.every(raw=>{const r=object(raw),team=r?.team??r?.abbreviation;return typeof team==='string'&&sides.some(s=>propsTeam(String(s.team))===propsTeam(team))&&Array.isArray(r?.players)&&r.players.every(v=>object(v)!==null);})
   &&new Set(report.teams.map(raw=>{const r=object(raw)!;return propsTeam(String(r.team??r.abbreviation));})).size===2){
   transformed.teams=set(report.teams.map(raw=>{const group=object(raw)!;return{...group,players:set((group.players as Json[]).map(raw=>{const row=object(raw)!;return noClocks(row);}))};}));
  }
  if(Array.isArray(report.playerClearances)&&report.playerClearances.every(raw=>{const r=object(raw);return r&&typeof r.name==='string'&&typeof r.teamAbbreviation==='string'&&sides.some(s=>propsTeam(String(s.team))===propsTeam(r.teamAbbreviation as string));})){
   transformed.playerClearances=set(report.playerClearances.map(raw=>{const row=object(raw)!;record({...row,status:'explicit clearance'},String(row.teamAbbreviation),reportClocks,true);return noClocks(row);}));
  }
  canonicalReport=transformed;
 }
 return{evidence:{...e,value:{...value,context:canonicalContext,...(canonicalReport===undefined?{}:{originalReport:canonicalReport})}},records};
}

/** All identities matter: a teammate/opponent authority change can alter role or
 * matchup even when the reviewed actor's own eligibility is unchanged. Clocks
 * select winning facts; their absolute values are not additional evidence. */
export function readerCanonicalContextHash(packet:GamePacket,playerId:string){
 const player=packet.players.find(p=>p.id===playerId);if(!player)return null;
 const sources=player.evidence.map(e=>medicalSource(packet,player,e)),records=sources.flatMap(s=>s.records),identities=[...new Set(records.map(r=>r.identity))].sort();
 const authority=identities.map(identity=>{
  const own=records.filter(r=>r.identity===identity),valid=own.filter(r=>r.valid);
  const winners=(rows:Medical[])=>{const latest=Math.max(-Infinity,...rows.map(r=>r.effective));return set(rows.filter(r=>r.effective===latest).map(r=>r.content));};
  return{identity,latestReported:winners(valid),latestExplicit:winners(valid.filter(r=>r.explicit)),invalid:set(own.filter(r=>!r.valid).map(r=>({content:r.content,clocks:r.invalidClocks!})))};
 });
 const canonical={...packet,players:[{...player,evidence:sources.map(s=>s.evidence)}]};
 // A typed injury clearance may identify a player only by team/name while
 // the roster supplies an ID. Keep both identities exact; this separate guard
 // records temporal competition under that exact reported name, not a guessed
 // alias join or a synthetic clearance. Two distinct known IDs alone never
 // collapse into one actor merely because their display names match.
 const nameChronology=[...new Set(records.map(r=>r.nameScope))].sort().flatMap(nameScope=>{
  const related=records.filter(r=>r.nameScope===nameScope);
  if(!related.some(r=>r.hasProviderId)||!related.some(r=>!r.hasProviderId))return[];
  const winners=(rows:Medical[])=>{const valid=rows.filter(r=>r.valid),latest=Math.max(-Infinity,...valid.map(r=>r.effective));return set(valid.filter(r=>r.effective===latest).map(r=>({identity:r.identity,content:r.content})));};
  return[{nameScope,latestReported:winners(related),latestExplicit:winners(related.filter(r=>r.explicit))}];
 });
 return digest({release:PROPS_AI_READER_CONTEXT_RELEASE,context:criticalContextHashes(canonical)[playerId],medicalAuthority:authority,nameChronology});
}
