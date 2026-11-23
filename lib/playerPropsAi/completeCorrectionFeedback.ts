import {eventTailNavigation} from './eventTailNavigation';
import {validateLaw} from './law';
/** Future correction navigation only. Never changes a law, source or admission. */
import type {GamePacket} from './evidenceContract';
import {PROPS_AI_WIRE_RELEASE} from './scenarioCoordinates';
import {generativeStatistics} from './generativeCoordinates';
import {inspectGenerativeDraft} from './generativeAdmission';

export const COMPLETE_CORRECTION_FEEDBACK_RELEASE='player_props_correction_feedback_2026_11_15_r1_complete_actor_constraints' as const;
export const COMPLETE_CORRECTION_MAX_BYTES=1984;
type Result={status:'ready';text:string;bytes:number;affectedActorIds:string[]}|{status:'unavailable';reason:'not_applicable'|'diagnostic_unavailable'|'feedback_exceeds_cushion';bytes:number;affectedActorIds:string[]};
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const codes=new Set(['forecast_mean_outside_supplied_support','forecast_numeric_support_unavailable','nonpositive_yardage_contradicts_source','combo_dependence_erases_source_variation','unsupported_zero_probability_tail','unsupported_priced_event_certainty']);
const unavailable=(reason:Extract<Result,{status:'unavailable'}>['reason'],affectedActorIds:string[]=[],bytes=0):Result=>({status:'unavailable',reason,bytes,affectedActorIds});
/** Match the legacy bounded code to exactly one supported full coordinate. */
export function completeCorrectionCoordinate(code:string,statistics:readonly string[]):string|null{
 const kind=code.split(':')[0];if(kind!=='units'&&kind!=='bound')return null;
 const matches=statistics.filter(stat=>`${kind}:${stat}`===code||`${kind}:${stat}`.slice(0,32)===code);
 return matches.length===1?`${kind}:${matches[0]}`:null;
}
/** Every known actor/stat example is retained or the whole correction is refused.
 * Only validator-generated ASCII examples and fixed categories enter instructions;
 * player names, IDs, provider prose and raw exception details remain input data. */
function buildCompleteDiagnosticCorrection(packet:GamePacket,draft:unknown,enrich:boolean):Result{
 if(packet.sport==='nba')return unavailable('not_applicable');
 const raw=object(draft),players=object(raw?.players);
 if(!raw||raw.wireRelease!==PROPS_AI_WIRE_RELEASE||Object.keys(raw).sort().join('|')!=='players|wireRelease'||!players||Object.keys(players).sort().join('|')!==packet.players.map(p=>p.id).sort().join('|')||packet.players.some(p=>!object(players[p.id])))return unavailable('not_applicable');
 let inspection:ReturnType<typeof inspectGenerativeDraft>;
 try{inspection=inspectGenerativeDraft(packet,draft);}catch{return unavailable('diagnostic_unavailable',packet.players.map(p=>p.id));}
 const affectedActorIds:string[]=[],lines:string[]=[];
 for(const [index,player]of packet.players.entries()){
  const source=inspection.source.find(s=>s.playerId===player.id)?.unhandled??[],coordinates=inspection.coordinates.filter(c=>c.playerId===player.id),format=inspection.format.filter(f=>f.playerIndex===index);
  if(!source.length&&!coordinates.length&&!format.length)continue;
  affectedActorIds.push(player.id);
  const entries:string[]=[];
  for(const finding of source){
   if(!codes.has(finding.code)||!finding.markets.length||finding.markets.some(m=>!player.markets.includes(m))||typeof finding.example!=='string'||!finding.example.length||!/^[\x20-\x7e]+$/.test(finding.example))return unavailable('diagnostic_unavailable',packet.players.map(p=>p.id));
   let detail=finding.example;
   if(enrich&&['unsupported_zero_probability_tail','unsupported_priced_event_certainty'].includes(finding.code)){
    const rawLaw=inspection.canonical.players[player.id]?.law;
    let law=null;try{law=rawLaw?validateLaw(packet.sport,player,rawLaw):null;}catch{return unavailable('diagnostic_unavailable',packet.players.map(p=>p.id));}
    const navigation=eventTailNavigation(finding,law);if(navigation)detail=finding.example+' ('+navigation+')';
   }
   entries.push(`M${finding.markets.map(m=>player.markets.indexOf(m)).join(',')}: ${detail}`);
  }
  for(const finding of coordinates){
   if(finding.code==='source_claims')entries.push('verified source reading selections: reselect required actor-local claim IDs');
   else if(finding.code==='unsupported_disposition')entries.push('law=null requires a source-bound gap AND explicit exceptions for EVERY market; retain a valid law for supported scopes');
   else if(['weights','named_keys','fields_or_identity'].includes(finding.code))entries.push(`coordinates ${finding.code}`);
   else{const coordinate=completeCorrectionCoordinate(finding.code,generativeStatistics(packet.sport,player));if(!coordinate)return unavailable('diagnostic_unavailable',packet.players.map(p=>p.id));entries.push(`coordinates ${coordinate}`);}
  }
  for(const finding of format){if(finding.field!=='assessment'&&!/^reader[0-7]$/.test(finding.field))return unavailable('diagnostic_unavailable',packet.players.map(p=>p.id));entries.push(`verified ${finding.field} claim rendering`);}
  lines.push(`P${index}: ${[...new Set(entries)].join('; ')}.`);
 }
 if(!affectedActorIds.length)return unavailable('not_applicable');
 const prefix='\nP/M are zero-based original player/market order. Every listed finding must be resolved against the original supplied sources. Keep every player and market. Correct all listed statistics and event tails, not just the first issue for a player. If a scope cannot be responsibly supported, explicitly select its permitted source-bound exception or forecast_declined; confidence zero alone is not an exception. Never invent facts, clamp numbers, waive a check or claim new evidence. Backend findings:\n';
 const text=prefix+lines.join('\n'),bytes=Buffer.byteLength(text,'utf8');
 if(!/^[\x00-\x7f]*$/.test(text)||bytes>COMPLETE_CORRECTION_MAX_BYTES)return unavailable('feedback_exceeds_cushion',affectedActorIds,bytes);
 return{status:'ready',text,bytes,affectedActorIds};
}

/** Preserve the original complete finding set when optional detail cannot fit. */
export function completeDiagnosticCorrection(packet:GamePacket,draft:unknown,enrich=true):Result{
 if(!enrich)return buildCompleteDiagnosticCorrection(packet,draft,false);
 const rich=buildCompleteDiagnosticCorrection(packet,draft,true);
 return rich.status==='unavailable'&&rich.reason==='feedback_exceeds_cushion'?buildCompleteDiagnosticCorrection(packet,draft,false):rich;
}
