/** Bounded continuation of valid abstentions; never edits a returned draft. */
import type {GamePacket} from './evidenceContract';
import {completeDiagnosticCorrection,COMPLETE_CORRECTION_MAX_BYTES} from './completeCorrectionFeedback';
import {inspectGenerativeDraft} from './generativeAdmission';
import {numericSourceConstraints} from './numericSourceNavigation';
import {parseJointPlayerReview} from './request';

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
 // A valid null-law sibling has no numerical law and therefore no entry in
 // inspection.source. Its explicit unsupported-scope disposition still matters
 // when the same original full part is regenerated to repair another actor.
 const rows=(draft as {players?:Record<string,unknown>})?.players;
 for(const [index,player]of packet.players.entries()){
  const row=rows?.[player.id] as {law?:unknown}|undefined;if(row?.law!==null)continue;
  try{parseJointPlayerReview(packet,player.id,row);}catch{continue;}
  const indices=[...new Set(numericSourceConstraints(packet,player).filter(c=>c.meanRule==='explicit_decline_affected').flatMap(c=>c.affectedMarketIndices))];
  if(indices.length)retained.push(`P${index} M${indices.join(',')}`);
 }
 if(!retained.length)return base;
 const text=base.text+'\nPreviously valid explicit declines for numerically unavailable scopes: '+retained.join('; ')+'. Keep these exceptions (forecast_declined is permitted); the unchanged source still cannot support their numbers. Repair supported scopes without reopening these declined markets.';
 const bytes=Buffer.byteLength(text,'utf8');
 if(!/^[\x00-\x7f]*$/.test(text)||bytes>COMPLETE_CORRECTION_MAX_BYTES)return{status:'unavailable' as const,reason:'feedback_exceeds_cushion' as const,bytes,affectedActorIds:base.affectedActorIds};
 return{...base,text,bytes};
}
