/** Bounded continuation of valid abstentions; never edits a returned draft. */
import type {GamePacket} from './evidenceContract';
import {completeDiagnosticCorrection,COMPLETE_CORRECTION_MAX_BYTES} from './completeCorrectionFeedback';
import {inspectGenerativeDraft} from './generativeAdmission';

export const SOURCE_AWARE_CORRECTION_RELEASE='player_props_correction_feedback_2026_11_16_r2_supported_scope_continuation' as const;
export function sourceAwareDiagnosticCorrection(packet:GamePacket,draft:unknown){
 const base=completeDiagnosticCorrection(packet,draft);
 if(base.status!=='ready')return base;
 let inspection:ReturnType<typeof inspectGenerativeDraft>;
 try{inspection=inspectGenerativeDraft(packet,draft);}catch{return{status:'unavailable' as const,reason:'diagnostic_unavailable' as const,bytes:0,affectedActorIds:base.affectedActorIds};}
 const retained:string[]=[];
 for(const row of inspection.source){
  // Only already source-validated, explicit exceptions for a numerically
  // unavailable scope qualify. Unhandled or invalid claim selections do not.
  if(inspection.coordinates.some(c=>c.playerId===row.playerId&&c.code==='source_claims'))continue;
  const player=packet.players[row.playerIndex],unhandled=new Set(row.unhandled.flatMap(i=>i.markets));
  const markets=[...new Set(row.issues.filter(i=>i.code==='forecast_numeric_support_unavailable').flatMap(i=>i.markets))].filter(m=>!unhandled.has(m));
  if(markets.length)retained.push(`P${row.playerIndex} M${markets.map(m=>player.markets.indexOf(m)).join(',')}`);
 }
 if(!retained.length)return base;
 const text=base.text+'\nPreviously valid explicit declines for numerically unavailable scopes: '+retained.join('; ')+'. Keep these exceptions (forecast_declined is permitted); the unchanged source still cannot support their numbers. Repair supported scopes without reopening these declined markets.';
 const bytes=Buffer.byteLength(text,'utf8');
 if(!/^[\x00-\x7f]*$/.test(text)||bytes>COMPLETE_CORRECTION_MAX_BYTES)return{status:'unavailable' as const,reason:'feedback_exceeds_cushion' as const,bytes,affectedActorIds:base.affectedActorIds};
 return{...base,text,bytes};
}
