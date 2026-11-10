/** Prospective actor retention within one ORIGINAL request/alias/fact universe.
 * This module performs no I/O and never authorizes another paid request.
 */
import {createHash} from "node:crypto";
import type {GamePacket} from "./evidenceContract";
import {digest,invariant} from "./evidence";
import {evidenceAliases} from "./input";
import {readerEvidence} from "./readerCoverage";
import {jointReviewSchema,parseJointPlayerReview,parseJointReview} from "./request";
import {PROPS_AI_WIRE_RELEASE} from "./scenarioCoordinates";
import {PROPS_AI_PRIMARY_MODEL,type PropsAiModel} from "./releases";

export const ACTOR_ADMISSION_RELEASE="player_props_ai_actor_admission_2026_11_10_r2_verified_reader_claims" as const;
type RawObject=Record<string,unknown>;
type AdmittedPlayer=ReturnType<typeof parseJointPlayerReview>;
export type ActorAdmissionLineage={part:number;phase:1|2;model:PropsAiModel;requestedTier:string;actualTier:string;responseId:string;requestHash:string};
export type AdmittedActor={playerId:string;raw:unknown;canonical:AdmittedPlayer;rawActorHash:string;canonicalHash:string};
export type ActorAdmissionProposal={
  release:typeof ACTOR_ADMISSION_RELEASE;lineage:ActorAdmissionLineage;
  requestedActorIds:string[];consumedActorIds:string[];ignoredActorIds:string[];
  sourceInputHash:string;aliasesHash:string;factsHash:string;marketScopes:Record<string,string[]>;
  draftSha256:string;draftBytes:number;globalEnvelopeValid:boolean;
  admittedActors:AdmittedActor[];rejectedActors:{playerId:string;reason:string}[];
};
export type ActorAdmissionReceiptProof={
  receiptRecorded:boolean;receiptId:string;actualMicro:number|null;
  archivedInputDigest:string;archivedRequestSha256:string;archivedDraftSha256:string;
};
export type RetainedActorProvenance=ActorAdmissionLineage&{
  playerId:string;receiptId:string;sourceInputHash:string;aliasesHash:string;factsHash:string;
  draftSha256:string;rawActorHash:string;canonicalHash:string;marketScope:string[];
};
const object=(value:unknown):RawObject|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as RawObject:null;
const clone=<T>(value:T):T=>structuredClone(value);
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
const validHash=(value:string)=>/^[a-f0-9]{64}$/.test(value);
function freeze<T>(value:T):T{
  if(value!==null&&typeof value==="object"){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}

/** Exact supported subset emitted by jointReviewSchema; unknown constraints fail.
 * The whole response must have the original structured-output shape even when
 * previously admitted actors' resampled numerical/prose interpretations are ignored.
 */
function schemaValid(value:unknown,unknownSchema:unknown):boolean{
  const schema=object(unknownSchema);if(!schema)return false;
  const supported=new Set(["type","enum","anyOf","properties","additionalProperties","required","items","minItems","maxItems","minLength","maxLength","pattern","minimum","maximum","description"]);
  if(Object.keys(schema).some(key=>!supported.has(key)))return false;
  if(Array.isArray(schema.anyOf))return schema.anyOf.some(option=>schemaValid(value,option));
  if(Array.isArray(schema.enum)&&!schema.enum.some(option=>digest(option)===digest(value)))return false;
  if(schema.type==="null")return value===null;
  if(schema.type==="object"){
    const row=object(value),properties=object(schema.properties);
    if(!row||!properties||schema.additionalProperties!==false||!Array.isArray(schema.required)||!schema.required.every(key=>typeof key==="string"&&Object.hasOwn(row,key)))return false;
    return Object.keys(row).every(key=>Object.hasOwn(properties,key)&&schemaValid(row[key],properties[key]));
  }
  if(schema.type==="array")return Array.isArray(value)&&value.length>=(typeof schema.minItems==="number"?schema.minItems:0)&&value.length<=(typeof schema.maxItems==="number"?schema.maxItems:Infinity)&&value.every(item=>schemaValid(item,schema.items));
  if(schema.type==="string")return typeof value==="string"&&Array.from(value).length>=(typeof schema.minLength==="number"?schema.minLength:0)&&Array.from(value).length<=(typeof schema.maxLength==="number"?schema.maxLength:Infinity)&&(typeof schema.pattern!=="string"||new RegExp(schema.pattern).test(value));
  if(schema.type==="integer")return typeof value==="number"&&Number.isSafeInteger(value)&&value>=(typeof schema.minimum==="number"?schema.minimum:-Infinity)&&value<=(typeof schema.maximum==="number"?schema.maximum:Infinity);
  return false;
}

export class OriginalPartActorAdmission{
  readonly packet:GamePacket;
  readonly sourceInputHash:string;
  readonly aliasesHash:string;
  readonly factsHash:string;
  readonly marketScopes:Record<string,string[]>;
  private readonly schema:ReturnType<typeof jointReviewSchema>;
  private readonly proposals=new Map<number,ActorAdmissionProposal>();
  private readonly committed=new Set<number>();
  private readonly retained=new Map<string,{actor:AdmittedActor;provenance:RetainedActorProvenance}>();
  private unsafeReceipt=false;
  constructor(packet:GamePacket){
    this.packet=freeze(clone(packet));this.sourceInputHash=digest(this.packet);
    this.aliasesHash=digest([...evidenceAliases(this.packet)]);this.factsHash=digest(readerEvidence(this.packet));
    this.marketScopes=freeze(Object.fromEntries(this.packet.players.map(player=>[player.id,[...player.markets]])));
    this.schema=freeze(jointReviewSchema(this.packet));
    invariant(new Set(this.packet.players.map(player=>player.id)).size===this.packet.players.length,"Actor admission requires unique original actors");
  }
  pendingActorIds(){return this.packet.players.filter(player=>!this.retained.has(player.id)).map(player=>player.id);}
  retainedCanonicalHash(playerId:string){return this.retained.get(playerId)?.actor.canonicalHash??null;}
  propose(draftText:string,lineage:ActorAdmissionLineage):ActorAdmissionProposal{
    invariant(!this.unsafeReceipt,"Unsafe actor receipt cannot authorize correction or admission");
    invariant((lineage.phase===1&&this.proposals.size===0)||(lineage.phase===2&&this.proposals.size===1&&this.committed.has(1)),"Actor admission phase must be sequential and cannot be repeated");
    invariant(Number.isSafeInteger(lineage.part)&&lineage.part>0&&validHash(lineage.requestHash)&&lineage.responseId.trim().length>0,"Invalid actor admission lineage");
    invariant(this.pendingActorIds().length>0,"No unadmitted actors remain");
    const first=this.proposals.get(1);if(first)invariant(first.lineage.part===lineage.part,"Actor admission cannot change original part");
    if(lineage.phase===2)invariant(lineage.model===PROPS_AI_PRIMARY_MODEL,"Actor correction retains the existing primary model");
    let draft:unknown;try{draft=JSON.parse(draftText);}catch{draft=undefined;}
    const globalEnvelopeValid=schemaValid(draft,this.schema),requestedActorIds=this.packet.players.map(player=>player.id),consumedActorIds=this.pendingActorIds();
    const rows=object(object(draft)?.players),admittedActors:AdmittedActor[]=[],rejectedActors:{playerId:string;reason:string}[]=[];
    for(const playerId of consumedActorIds){
      if(!globalEnvelopeValid){rejectedActors.push({playerId,reason:"malformed_original_full_response_envelope"});continue;}
      try{
        const raw=clone(rows![playerId]),canonical=parseJointPlayerReview(this.packet,playerId,raw);
        admittedActors.push({playerId,raw,canonical,rawActorHash:digest(raw),canonicalHash:digest(canonical)});
      }catch(error){rejectedActors.push({playerId,reason:(error instanceof Error?error.message:"actor_admission_failed").slice(0,900)});}
    }
    const proposal=freeze({release:ACTOR_ADMISSION_RELEASE,lineage:clone(lineage),requestedActorIds,consumedActorIds,
      ignoredActorIds:requestedActorIds.filter(id=>!consumedActorIds.includes(id)),sourceInputHash:this.sourceInputHash,
      aliasesHash:this.aliasesHash,factsHash:this.factsHash,marketScopes:clone(this.marketScopes),draftSha256:sha(draftText),draftBytes:Buffer.byteLength(draftText),globalEnvelopeValid,admittedActors,rejectedActors});
    this.proposals.set(lineage.phase,proposal);return proposal;
  }
  /** Call only AFTER the exact source/request/draft receipt has been persisted.
   * Booleans do not attest SQL durability; the caller's awaited receipt is that
   * boundary. Every content hash is bound here, with no caller-supplied actor hash.
   */
  retain(proposal:ActorAdmissionProposal,proof:ActorAdmissionReceiptProof){
    invariant(!this.unsafeReceipt,"Unsafe actor receipt cannot authorize admission");
    const phase=proposal.lineage.phase;
    invariant(this.proposals.get(phase)===proposal&&!this.committed.has(phase),"Actor admission proposal is foreign or already committed");
    const known=proof.receiptRecorded&&proof.receiptId.trim().length>0&&proof.actualMicro!==null&&Number.isSafeInteger(proof.actualMicro)&&proof.actualMicro>=0;
    const bound=proof.archivedInputDigest===this.sourceInputHash&&proof.archivedRequestSha256===proposal.lineage.requestHash&&proof.archivedDraftSha256===proposal.draftSha256;
    if(!known||!bound)this.unsafeReceipt=true;
    invariant(known,"Actor admission requires a recorded known-usage receipt");
    invariant(bound,"Actor admission exact archive binding failed");
    invariant(digest(this.packet)===this.sourceInputHash&&digest([...evidenceAliases(this.packet)])===this.aliasesHash&&digest(readerEvidence(this.packet))===this.factsHash,"Actor admission original context changed");
    for(const actor of proposal.admittedActors){
      invariant(!this.retained.has(actor.playerId)&&proposal.consumedActorIds.includes(actor.playerId),"An admitted actor cannot be replaced");
      invariant(digest(actor.raw)===actor.rawActorHash&&digest(actor.canonical)===actor.canonicalHash,"Actor admission snapshot changed");
      this.retained.set(actor.playerId,freeze({actor:clone(actor),provenance:{...clone(proposal.lineage),playerId:actor.playerId,receiptId:proof.receiptId,
        sourceInputHash:this.sourceInputHash,aliasesHash:this.aliasesHash,factsHash:this.factsHash,draftSha256:proposal.draftSha256,
        rawActorHash:actor.rawActorHash,canonicalHash:actor.canonicalHash,marketScope:[...this.marketScopes[actor.playerId]]}}));
    }
    this.committed.add(phase);
  }
  finish(){
    invariant(!this.unsafeReceipt,"Unsafe actor receipt cannot complete the whole part");
    invariant(this.pendingActorIds().length===0,"Incomplete actor admission cannot complete the whole part");
    const raw={wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(this.packet.players.map(player=>[player.id,this.retained.get(player.id)!.actor.raw]))};
    invariant(schemaValid(raw,this.schema),"Retained actor union no longer has the original full schema");
    const review=parseJointReview(this.packet,raw);
    invariant(review.players.length===this.packet.players.length,"Retained actor union omitted original actors");
    for(const player of review.players)invariant(digest(player)===this.retained.get(player.playerId)!.actor.canonicalHash,"Original full parser disagrees with retained actor");
    return freeze({review,raw:clone(raw),actorProvenance:this.packet.players.map(player=>clone(this.retained.get(player.id)!.provenance))});
  }
}
