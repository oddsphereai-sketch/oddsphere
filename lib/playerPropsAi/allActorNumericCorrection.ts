import type {GamePacket} from './evidenceContract';
import {inspectGenerativeDraft} from './generativeAdmission';
import {COMPLETE_CORRECTION_MAX_BYTES} from './completeCorrectionFeedback';

export const ALL_ACTOR_NUMERIC_CORRECTION_RELEASE='player_props_all_actor_numeric_correction_2026_11_18_r1_every_failed_actor' as const;
type Feedback={status:string;text?:string;bytes:number;affectedActorIds:string[]};

/** Optional navigation only: all existing findings, decline instructions and
 * previously fitting original numeric references take precedence unchanged. */
export function withAllActorNumericCorrection<T extends Feedback>(packet:GamePacket,draft:unknown,feedback:T):T{
 if(packet.sport!=='nba'||feedback.status!=='ready'||typeof feedback.text!=='string')return feedback;
 let failed:number[];
 try{const source=inspectGenerativeDraft(packet,draft).source;failed=packet.players.flatMap((p,i)=>source.some(s=>s.playerId===p.id&&s.unhandled.length)?[i]:[]);}catch{return feedback;}
 if(failed.length<2)return feedback;
 const text=feedback.text+`\nEVERY failed P${failed.join(',')}: fix numeric checks or explicitly except affected scopes.`;
 const bytes=Buffer.byteLength(text,'utf8'),serialized=Buffer.byteLength(JSON.stringify(text).slice(1,-1),'utf8');
 if(!/^[\x00-\x7f]*$/.test(text)||bytes>COMPLETE_CORRECTION_MAX_BYTES||serialized>COMPLETE_CORRECTION_MAX_BYTES)return feedback;
 return{...feedback,text,bytes};
}
