/** Bounded reference to an UNACCEPTED draft, never evidence or a law repair. */
import type {GamePacket} from './evidenceContract';
import {generativeStatistics} from './generativeCoordinates';
import {PROPS_AI_SCENARIOS} from './releases';
import {COMPLETE_CORRECTION_MAX_BYTES} from './completeCorrectionFeedback';

type Feedback={status:string;text?:string;bytes:number;affectedActorIds:string[]};
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const vector=(v:unknown)=>Array.isArray(v)&&v.length===PROPS_AI_SCENARIOS&&v.every(n=>typeof n==='number'&&Number.isSafeInteger(n));

/** Include all affected actors or none. The existing complete diagnostic always
 * wins the fixed retry allowance; neither a finding nor a vector is truncated. */
export function withOriginalDraftCorrectionContext<T extends Feedback>(packet:GamePacket,draft:unknown,feedback:T):T{
 if(feedback.status!=='ready'||typeof feedback.text!=='string'||!feedback.affectedActorIds.length)return feedback;
 const rows=object(object(draft)?.players);if(!rows)return feedback;
 const references=[];
 for(const id of feedback.affectedActorIds){
  const index=packet.players.findIndex(p=>p.id===id);if(index<0)return feedback;
  const law=object(object(rows[id])?.law),outcomes=object(law?.outcomes),statistics=generativeStatistics(packet.sport,packet.players[index]);
  if(!law||!outcomes||!vector(law.weights)||!(law.weights as number[]).some(n=>n>0)||(law.weights as number[]).some(n=>n<0||n>10000))return feedback;
  if(Object.keys(outcomes).sort().join('|')!==[...statistics].sort().join('|')||statistics.some(stat=>!vector(outcomes[stat])))return feedback;
  // Only allowlisted coordinate names and integer arrays enter instructions.
  // Names, source prose, claim strings and arbitrary model fields never do.
  references.push({P:index,weights:law.weights,outcomes:Object.fromEntries(statistics.map(stat=>[stat,outcomes[stat]]))});
 }
 const text=feedback.text+'\nUNACCEPTED prior numeric draft, P=original actor index; NOT source evidence or an approved forecast: '+JSON.stringify(references)+
  '\nUse only as a repair reference. Recheck ALL source means, opposing tails, joint relationships and physical identities; fixing one must not break another. Return the complete revised actor. No number is automatically retained, repaired or trusted.';
 const bytes=Buffer.byteLength(text,'utf8');
 // JSON escaping must fit too: quotes in a numeric reference are not free
 // input bytes in the actual serialized request. Keep the old token cushion.
 const serializedBytes=Buffer.byteLength(JSON.stringify(text).slice(1,-1),'utf8');
 if(!/^[\x00-\x7f]*$/.test(text)||bytes>COMPLETE_CORRECTION_MAX_BYTES||serializedBytes>COMPLETE_CORRECTION_MAX_BYTES)return feedback;
 return{...feedback,text,bytes};
}
