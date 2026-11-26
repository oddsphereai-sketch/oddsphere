/** Scope only the existing correction output. Original sources/aliases stay whole. */
import type {GamePacket} from './evidenceContract';
import {invariant} from './evidence';
import {COMPLETE_CORRECTION_MAX_BYTES} from './completeCorrectionFeedback';

const MARKER='\nRETRY_ACTOR_SCOPE_V1=';
export const CORRECTION_ACTOR_SCOPE_RELEASE='player_props_correction_2026_11_26_r2_compact_scope_fallback' as const;

export function correctionActorIds(packet:GamePacket,text?:string):string[]{
 const all=packet.players.map(p=>p.id);
 if(!text?.includes(MARKER))return all;
 invariant(text.indexOf(MARKER)===text.lastIndexOf(MARKER),'Duplicate correction scope');
 const suffix=text.slice(text.indexOf(MARKER)+MARKER.length);
 invariant(/^\[(?:0|[1-9][0-9]*)(?:,(?:0|[1-9][0-9]*))*\]$/.test(suffix),'Malformed correction scope');
 const indices=JSON.parse(suffix) as number[];
 invariant(indices.length>0&&indices.length<all.length&&indices.every((n,i)=>Number.isSafeInteger(n)&&n>=0&&n<all.length&&(i===0||n>indices[i-1])),'Correction scope must be a proper ordered original actor subset');
 return indices.map(i=>all[i]);
}

/** Existing complete diagnostics/references win. No truncation, new phase or slot. */
export function withPendingActorScope(packet:GamePacket,pending:readonly string[],text:string):string{
 invariant(!text.includes(MARKER),'Correction scope already supplied');
 const ids=packet.players.map(p=>p.id);
 invariant(pending.length>0&&new Set(pending).size===pending.length&&pending.every(id=>ids.includes(id)),'Invalid pending correction actors');
 if(pending.length===ids.length)return text;
 const selected=new Set(pending),indices=ids.flatMap((id,i)=>selected.has(id)?[i]:[]),suffix=MARKER+JSON.stringify(indices);
 // The request already says Return ONLY schema player keys when this marker
 // is present. Its redundant prose must not turn a fitting exact scope into
 // a full-part regeneration. Keep every original diagnostic/reference byte.
 for(const next of [text+'\nKeep saved actors; return schema actor keys only.'+suffix,text+suffix]){
  if(Buffer.byteLength(next,'utf8')<=COMPLETE_CORRECTION_MAX_BYTES&&Buffer.byteLength(JSON.stringify(next).slice(1,-1),'utf8')<=COMPLETE_CORRECTION_MAX_BYTES)return next;
 }
 return text;
}

/** Optional targeting must not displace the original combined known receipt. */
export function correctionScopeFittingReceipt(usage:Record<string,unknown>,originalText:string,scopedText:string):string{
 return Buffer.byteLength(JSON.stringify({...usage,nextCorrectionText:scopedText}),'utf8')<=768000?scopedText:originalText;
}

/** Keep original actor-local claim definitions and every requested market entry. */
export function scopedReviewSchema<T>(schema:T,packet:GamePacket,text?:string):T{
 const ids=correctionActorIds(packet,text);
 if(ids.length===packet.players.length)return schema;
 const copy=structuredClone(schema) as T&{properties:{players:{properties:Record<string,unknown>;required:string[]}}};
 const players=copy.properties.players;
 invariant(ids.every(id=>Object.hasOwn(players.properties,id)),'Scoped actor missing original schema');
 players.properties=Object.fromEntries(ids.map(id=>[id,players.properties[id]]));players.required=ids;
 return copy;
}
