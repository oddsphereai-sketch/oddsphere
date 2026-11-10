/** Pure R28 receipt audit. No network, database, provider or model calls.
 * Import from the exact original generation; never use this to reinterpret an
 * older accepted law. Returned canonical players are private audit data.
 */
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import type {GamePacket} from "../../lib/playerPropsAi/evidenceContract";
import {digest,invariant,validatePacket} from "../../lib/playerPropsAi/evidence";
import {OriginalPartActorAdmission,ACTOR_ADMISSION_RELEASE,type ActorAdmissionProposal} from "../../lib/playerPropsAi/actorAdmission";
import {jointReviewRequest,parseJointReview} from "../../lib/playerPropsAi/request";
import {serializeAiRequest} from "../../lib/playerPropsAi/openai";
import {PROPS_AI_MAX_OUTPUT_PER_REQUEST,PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL,type PropsAiModel} from "../../lib/playerPropsAi/releases";
import {PROPS_AI_WIRE_RELEASE} from "../../lib/playerPropsAi/scenarioCoordinates";
import {usageMicroUsd} from "../../lib/playerPropsAi/budget";
import {failureEvidence,PROPS_AI_FAILURE_EVIDENCE_RELEASE} from "../../lib/playerPropsAi/failureEvidence";
import {physicalLawFindings} from "../../lib/playerPropsAi/physicalDiagnostics";
import {namedSourceCorrection} from "../../lib/playerPropsAi/sourceConstraintCards";

export type PersistedActorAttempt={id:string;part:number;phase:number;state:string;model:string;requested_tier:string;response_id:string|null;actual_micro:number|string|null;usage:unknown};
type RawObject=Record<string,unknown>;
const object=(value:unknown):RawObject|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as RawObject:null;
const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const same=(actual:unknown,expected:unknown,label:string)=>invariant(digest(actual)===digest(expected),label);
function knownMicro(value:number|string|null){
  if(value===null)return null;
  invariant(typeof value==="number"||typeof value==="string"&&/^(?:0|[1-9][0-9]*)$/.test(value),"Invalid persisted actor usage amount");
  const amount=Number(value);invariant(Number.isSafeInteger(amount)&&amount>=0,"Unsafe persisted actor usage amount");return amount;
}
function archive(value:unknown,label:string){
  const row=object(value);invariant(row?.encoding==="gzip-base64"&&typeof row.data==="string"&&typeof row.sha256==="string",`${label}: missing exact archive`);
  invariant(typeof row.bytes==="number"&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=16000000,`${label}: raw byte bound`);
  const compressed=Buffer.from(row.data,"base64");invariant(compressed.length<=2000000&&compressed.toString("base64")===row.data,`${label}: compressed byte/encoding bound`);
  const raw=gunzipSync(compressed,{maxOutputLength:16000000});invariant(raw.length===row.bytes&&sha(raw)===row.sha256,`${label}: exact byte SHA mismatch`);
  const text=raw.toString("utf8");invariant(Buffer.from(text).equals(raw),`${label}: invalid UTF-8`);return text;
}
function evidenceFor(proposal:ActorAdmissionProposal){
  return {release:proposal.release,archiveField:"failureEvidence",disposition:"eligible_after_known_receipt",lineage:proposal.lineage,
    sourceInputHash:proposal.sourceInputHash,aliasesHash:proposal.aliasesHash,factsHash:proposal.factsHash,marketScopes:proposal.marketScopes,
    draftSha256:proposal.draftSha256,draftBytes:proposal.draftBytes,globalEnvelopeValid:proposal.globalEnvelopeValid,
    requestedActorIds:proposal.requestedActorIds,consumedActorIds:proposal.consumedActorIds,ignoredActorIds:proposal.ignoredActorIds,
    eligibleActors:proposal.admittedActors.map(actor=>({playerId:actor.playerId,rawActorHash:actor.rawActorHash,canonicalHash:actor.canonicalHash,canonicalLawHash:actor.canonical.law?.hash??null,sourceDeclinedMarkets:actor.canonical.sourceDeclinedMarkets})),rejectedActors:proposal.rejectedActors};
}

/** Attempts must be for ONE original part, with exact source bytes available.
 * Optional provenance is that part's complete accepted provenance, not merely a
 * convenient subset. An incomplete part may never supply accepted provenance.
 */
export function auditPropsActorAdmissionPart(args:{packet:GamePacket;attempts:readonly PersistedActorAttempt[];provenance?:readonly unknown[]}){
  invariant(args.packet.sport==="nba","Actor retention audit is NBA-only for R28");validatePacket(args.packet);
  invariant(args.attempts.length>=1&&args.attempts.length<=2,"Actor audit requires one or two bounded attempts");
  const attempts=[...args.attempts].sort((a,b)=>a.phase-b.phase),part=attempts[0].part;
  invariant(Number.isSafeInteger(part)&&part>0&&attempts.every(a=>a.part===part),"Actor audit mixed original parts");
  invariant(attempts.every((a,index)=>a.phase===index+1)&&new Set(attempts.map(a=>a.id)).size===attempts.length,"Actor audit duplicate/missing/reordered phases");
  const session=new OriginalPartActorAdmission(args.packet),proposals:ActorAdmissionProposal[]=[],expectedProvenance:unknown[]=[];
  let knownUsageMicro=0,verifiedAttempts=0,blockedReason:string|null=null,firstReason:string|undefined,firstCorrectionText:string|undefined;
  for(const attempt of attempts){
    invariant(blockedReason===null,"A blocked/unknown actor receipt cannot authorize a later attempt");
    invariant(attempt.model===PROPS_AI_PRIMARY_MODEL||attempt.model===PROPS_AI_STRONG_MODEL,"Actor audit unknown requested model");
    invariant(attempt.requested_tier==="default"||attempt.requested_tier==="flex","Actor audit unknown requested tier");
    const usage=object(attempt.usage);invariant(usage,"Actor audit missing immutable usage receipt");
    invariant(Buffer.byteLength(JSON.stringify(usage),"utf8")<=768000,"Actor audit combined immutable receipt exceeds byte bound");
    const metadata=object(usage.actorAdmissionEvidence),actual=knownMicro(attempt.actual_micro);
    if(actual===null){
      invariant(attempt.state==="unknown"||attempt.state==="sending"||attempt.state==="reserved","Actor audit unknown charge mislabeled completed");
      invariant(!metadata||metadata.disposition==="unavailable","Actor audit unknown charge claims actor admission eligibility");
      blockedReason="unknown_billed_usage";continue;
    }
    invariant(attempt.state==="completed","Actor audit known charge lacks completed immutable receipt");
    knownUsageMicro+=actual;
    if(!metadata){blockedReason="no_actor_admission_receipt";continue;}
    invariant(metadata.release===ACTOR_ADMISSION_RELEASE,"Actor audit unsupported original admission release");
    invariant(usage.responseEvidence===undefined,"Partially consumed raw actor response cannot claim whole-response acceptance");
    invariant((usage.actorAdmissionUnavailable===true)===(metadata.disposition==="unavailable"),"Actor audit conflicting archive/admission availability flags");
    invariant(usage.response_status==="completed"&&typeof attempt.response_id==="string"&&attempt.response_id.length>0,"Actor audit response did not complete");
    invariant(typeof usage.service_tier==="string","Actor audit missing actual service tier");
    invariant(usageMicroUsd(attempt.model as PropsAiModel,usage as unknown as Parameters<typeof usageMicroUsd>[1],usage.service_tier)===actual,"Actor audit actual usage charge mismatch");
    if(usage.actorAdmissionUnavailable===true||metadata.disposition==="unavailable"){
      blockedReason="exact_actor_archive_unavailable";continue;
    }
    invariant(metadata.disposition==="eligible_after_known_receipt"&&metadata.archiveField==="failureEvidence","Actor audit invalid admission disposition/archive link");
    const failure=object(usage.failureEvidence);invariant(failure?.release===PROPS_AI_FAILURE_EVIDENCE_RELEASE&&!failure.archiveUnavailable,"Actor audit lacks exact original failure archives");
    const input=archive(failure.input,"actor source"),request=archive(failure.request,"actor request"),draftText=archive(failure.draft,"actor draft");
    invariant(input===JSON.stringify(args.packet),"Actor audit original source bytes differ");same(JSON.parse(input),args.packet,"Actor audit original source digest differs");
    const correctionReason=attempt.phase===2?firstReason:undefined,correctionText=attempt.phase===2?firstCorrectionText:undefined;
    if(attempt.phase===2)invariant(typeof correctionReason==="string"&&correctionReason.length>0,"Actor audit correction reason unavailable");
    const expectedRequest=serializeAiRequest(jointReviewRequest(args.packet,attempt.model as PropsAiModel,PROPS_AI_MAX_OUTPUT_PER_REQUEST,correctionReason,correctionText),{serviceTier:attempt.requested_tier});
    invariant(request===expectedRequest,"Actor audit exact versioned request differs");
    let draft:unknown;try{draft=JSON.parse(draftText);}catch{draft=undefined;}
    let originalFailure:string|null=null;
    try{parseJointReview(args.packet,draft);}catch(error){originalFailure=error instanceof Error?error.message:"unparsed_draft";}
    if(attempt.phase===1)invariant(originalFailure!==null,"Actor retention must start with a rejected original full part");
    const recomputedFailure=failureEvidence({packet:args.packet,requestBody:request,draftText,reason:originalFailure??"actor_correction_wire_partially_consumed",physical:physicalLawFindings(args.packet,draft)});
    same(failure.reason,recomputedFailure.reason,"Actor audit original rejection reason differs");
    same(failure.physical,recomputedFailure.physical,"Actor audit physical diagnostics differ");
    same(failure.generativeDiagnostics,recomputedFailure.generativeDiagnostics,"Actor audit source diagnostics differ");
    if(attempt.phase===1){
      let expectedText:string|null=null,expectedUnavailable=false;
      try{const next=namedSourceCorrection(args.packet,draft);if(next.status==="ready"&&next.affectedActorIds.length)expectedText=next.text;
        else if(next.status==="unavailable"&&["feedback_exceeds_cushion","diagnostic_unavailable"].includes(next.reason))expectedUnavailable=true;
      }catch{expectedUnavailable=true;}
      same(usage.nextCorrectionText??null,expectedText,"Actor audit named correction differs from original diagnostics");
      invariant((usage.correctionFeedbackUnavailable===true)===expectedUnavailable,"Actor audit correction availability flag differs");
    }else invariant(usage.nextCorrectionText===undefined&&usage.correctionFeedbackUnavailable!==true,"Actor audit unexpected second correction instruction");
    const proposal=session.propose(draftText,{part,phase:attempt.phase as 1|2,model:attempt.model as PropsAiModel,requestedTier:attempt.requested_tier,actualTier:usage.service_tier,responseId:attempt.response_id,requestHash:sha(request)});
    same(metadata,evidenceFor(proposal),"Actor audit persisted admission metadata differs from exact raw proposal");
    session.retain(proposal,{receiptRecorded:true,receiptId:attempt.id,actualMicro:actual,archivedInputDigest:digest(JSON.parse(input)),archivedRequestSha256:sha(request),archivedDraftSha256:sha(draftText)});
    proposals.push(proposal);verifiedAttempts++;
    if(proposal.admittedActors.length)expectedProvenance.push({part,phase:attempt.phase,model:attempt.model,requestedTier:attempt.requested_tier,actualTier:usage.service_tier,responseId:attempt.response_id,
      playerIds:proposal.admittedActors.map(actor=>actor.playerId),wireHash:proposal.draftSha256,requestHash:sha(request),partInputHash:proposal.sourceInputHash,wireRelease:PROPS_AI_WIRE_RELEASE,actorAdmissionRelease:proposal.release,
      actorHashes:Object.fromEntries(proposal.admittedActors.map(actor=>[actor.playerId,{rawActorHash:actor.rawActorHash,canonicalHash:actor.canonicalHash}])),
      ...(attempt.phase===2?{correctionReason,...(correctionText?{correctionText}:{})}:{})});
    if(attempt.phase===1){
      firstReason=String(failure.reason);if(usage.nextCorrectionText!==undefined){invariant(typeof usage.nextCorrectionText==="string","Actor audit malformed named correction text");firstCorrectionText=usage.nextCorrectionText;}
    }
    if(usage.correctionFeedbackUnavailable===true)blockedReason="correction_feedback_unavailable";
  }
  const pendingActorIds=session.pendingActorIds(),complete=blockedReason===null&&pendingActorIds.length===0;
  if(!complete){
    invariant(!args.provenance?.length,"Incomplete actor part cannot claim accepted provenance");
    return {complete:false as const,blockedReason,pendingActorIds,verifiedAttempts,knownUsageMicro,admittedActors:proposals.flatMap(p=>p.admittedActors.map(actor=>({playerId:actor.playerId,canonicalHash:actor.canonicalHash,canonicalLawHash:actor.canonical.law?.hash??null,sourceDeclinedMarkets:actor.canonical.sourceDeclinedMarkets})))};
  }
  const result=session.finish();
  const ids=expectedProvenance.flatMap(value=>(value as {playerIds:string[]}).playerIds);
  invariant(new Set(ids).size===ids.length,"Actor audit repeated admitted identity across phase provenance");same(ids.slice().sort(),args.packet.players.map(p=>p.id).sort(),"Actor audit missing accepted actor provenance");
  if(args.provenance)same(args.provenance,expectedProvenance,"Actor audit accepted provenance differs from exact disjoint raw receipts");
  return {complete:true as const,blockedReason:null,pendingActorIds,verifiedAttempts,knownUsageMicro,review:result.review,actorProvenance:result.actorProvenance,partProvenance:expectedProvenance};
}
