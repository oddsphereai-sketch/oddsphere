import {createHash} from "node:crypto";
import {OriginalPartActorAdmission,type ActorAdmissionProposal} from "./actorAdmission";
import {namedSourceCorrection} from "./sourceConstraintCards";
import {acceptedResponseEvidence} from "./responseEvidence";
import {physicalLawFindings} from "./physicalDiagnostics";
import {failureEvidence} from "./failureEvidence";
import {isMissedPropsEarlyWindow} from "./schedule";
import {propsAiCompletionWindowMs,propsAiTwoPhaseCompletionWindowMs,propsAiGenerationPool} from "./completionWindow";
import type {PropsAiGameAdmission} from "./gameAdmission";
import { gzipSync } from "node:zlib";
import type { GamePacket } from "./evidenceContract";
import { digest, invariant, instant, etDate } from "./evidence";
import { usageMicroUsd, type PropsAiJob, type PropsAiReviewStore } from "./budget";
import { jointReviewRequest, parseJointReview } from "./request";
import { countAiInput, generateAiReview,serializeAiRequest, structuredAiText, AiGenerationError, AiRequestNotStartedError } from "./openai";
import { prepareReviewParts } from "./partitions";
import {criticalContextHashes} from "./criticalContext";
import {PROPS_AI_WIRE_RELEASE} from "./scenarioCoordinates";
import { PROPS_AI_MAX_OUTPUT_PER_REQUEST, PROPS_AI_PART_CONCURRENCY, PROPS_AI_STRONG_MODEL, PROPS_AI_RELEASE, PROPS_AI_ACCEPTED_RELEASES, type PropsAiModel } from "./releases";

type PreparedPart = Awaited<ReturnType<typeof prepareReviewParts>>[number];
type PartProvenance = { part:number; phase:number; model:PropsAiModel; requestedTier:string; actualTier:string; responseId:string; playerIds:string[]; correctionReason?:string;correctionText?:string;wireHash?:string;requestHash?:string;partInputHash?:string;wireRelease?:string;actorAdmissionRelease?:string;actorHashes?:Record<string,{rawActorHash:string;canonicalHash:string}> };
export type AcceptedGameReview = { release: (typeof PROPS_AI_ACCEPTED_RELEASES)[number]; gameId: string; start: string; lock: string; cutoff: string;
  criticalContextHashes:Record<string,string>;
  marketScopes:Record<string,string[]>;
  sourceGameId?:string;
  model: string; partProvenance:PartProvenance[]; stage: "early" | "final"; issuedAt?: string; inputHash?: string;
  players:Array<Omit<ReturnType<typeof parseJointReview>["players"][number],"sourceDeclinedMarkets">&{sourceDeclinedMarkets?:string[]}>;
  inputEvidence: { encoding: "gzip-base64"; digest: string; bytes: number; data: string } };
export async function runPropsReview(args: { packet: GamePacket; job: PropsAiJob; store: PropsAiReviewStore; key: string;
  preferStronger: boolean; writerRunId:string; fetchImpl?: typeof fetch; clock?: () => string; deadline?: number;
  gameAdmission?:PropsAiGameAdmission;generationSlot?:<T>(run:()=>Promise<T>)=>Promise<T>; prepare?:()=>Promise<PreparedPart[]>; countStrong?:(part:PreparedPart)=>Promise<number> }) {
  const clock = args.clock ?? (() => new Date().toISOString()), deadline = args.deadline ?? Date.now() + 250000;
  const earlyWindowClosed=()=>isMissedPropsEarlyWindow(args.job.stage,args.packet.lock,clock());
  if(args.job.state!=="pending")return {status:"skipped",reason:"not_pending"};
  invariant(args.job.game_id === args.packet.gameId && args.job.sport===args.packet.sport && instant(args.job.scheduled_start) === instant(args.packet.start) && instant(args.job.lock_at)===instant(args.packet.lock) && args.job.stage === args.packet.stage && args.job.game_day===etDate(args.packet.start), "job_input_identity_mismatch");
  invariant(instant(clock()) < instant(args.packet.lock) && instant(args.packet.cutoff) <= instant(clock()), "input_outside_actual_review_window");
  if(isMissedPropsEarlyWindow(args.job.stage,args.packet.lock,clock()))return {status:"skipped",reason:"early_window_closed_final_only"};
  const globalSlot=args.generationSlot??(async <T>(run:()=>Promise<T>)=>run()),localSlot=propsAiGenerationPool(PROPS_AI_PART_CONCURRENCY);
  const slot=<T>(run:()=>Promise<T>)=>localSlot(()=>globalSlot(run));
  const parts = await (args.prepare?.() ?? prepareReviewParts(args.packet, { key: args.key, fetchImpl: args.fetchImpl, count:(packet,model)=>slot(()=>countAiInput(jointReviewRequest(packet,model,PROPS_AI_MAX_OUTPUT_PER_REQUEST),args)) }));
  invariant(digest(parts.flatMap(p=>p.packet.players.map(p=>p.id)).sort())===digest(args.packet.players.map(p=>p.id).sort()),"partition_player_coverage_mismatch");
  const releaseGame=await (args.gameAdmission?.(parts.length)??Promise.resolve(()=>{}));
  try{
  const preferStronger=args.preferStronger&&args.job.stage==="final";
  // Optional stronger-model counting must not consume the primary review's
  // complete generation/publication window while holding whole-game admission.
  const strongCountDeadline=Date.now()+Math.min(deadline-Date.now(),instant(args.packet.lock)-instant(clock()))-propsAiTwoPhaseCompletionWindowMs(parts.length)-10000;
  const requests = await Promise.all(parts.map(async part=>({input_tokens:part.inputTokens,max_output_tokens:PROPS_AI_MAX_OUTPUT_PER_REQUEST,
    strong_input_tokens:preferStronger ? await slot(async()=>{invariant(Date.now()<strongCountDeadline,"optional_strong_count_window_closed");const count=await(args.countStrong?.(part)??countAiInput(jointReviewRequest(part.packet,PROPS_AI_STRONG_MODEL,PROPS_AI_MAX_OUTPUT_PER_REQUEST),{key:args.key,fetchImpl:args.fetchImpl,deadline:strongCountDeadline}));invariant(Date.now()<=strongCountDeadline,"optional_strong_count_window_closed");return count;}).catch(()=>null) : null})));
  if(Math.min(deadline-Date.now(),instant(args.packet.lock)-instant(clock()))<propsAiTwoPhaseCompletionWindowMs(parts.length)) return {status:"skipped",reason:"insufficient_completion_window"};
  if(isMissedPropsEarlyWindow(args.job.stage,args.packet.lock,clock()))return {status:"skipped",reason:"early_window_closed_final_only"};
  const sourcePacketJson=JSON.stringify(args.packet);
  const inputHash = digest(args.packet);
  // Large exact source serialization/hash work is part of preparation too.
  // A deferred job stays pending and may use its same ordinary slot later.
  if(Math.min(deadline-Date.now(),instant(args.packet.lock)-instant(clock()))<propsAiTwoPhaseCompletionWindowMs(parts.length)) return {status:"skipped",reason:"insufficient_completion_window"};
  if(earlyWindowClosed())return {status:"skipped",reason:"early_window_closed_final_only"};
  const claimed = await args.store.claim(args.job.job_key, inputHash, requests, preferStronger,args.writerRunId);
  if (!claimed.claimed) return { status: "skipped", reason: claimed.reason };
  const job = claimed.job!, token = claimed.token!;
  const accepted=new Map<number,ReturnType<typeof parseJointReview>>(),provenance=new Map<number,PartProvenance>();
  let phase=1, pending=parts.map((_,i)=>i), failure="unknown_review_failure";
  const feedback=new Map<number,string>(),feedbackTexts=new Map<number,string>();
  const actorAdmissions=new Map<number,OriginalPartActorAdmission>(),actorProvenance=new Map<number,PartProvenance[]>();
  const sha=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
  try {
    // A claim acknowledgement can arrive after the final-only boundary. Close
    // its unused escrow rather than purchasing a late early request.
    invariant(!earlyWindowClosed(),"early_window_closed_final_only");
    while(phase<=2){
      const failures:{index:number;reason:string;known:boolean}[]=[];
      // Whole-player parts retain every market. Successful parts are never regenerated.
      for(let offset=0;offset<pending.length;offset+=PROPS_AI_PART_CONCURRENCY){
        const results=await Promise.allSettled(pending.slice(offset,offset+PROPS_AI_PART_CONCURRENCY).map(index=>slot(async()=>{
          // Sample inside the acquired slot: another game/wave may have kept
          // this part queued until the early window closed.
          invariant(!earlyWindowClosed(),"early_window_closed_final_only");
          const part=parts[index];
          // One request may use spare time, but cannot consume another wave or
          // the already funded correction. Sample again after send/serialization
          // so delayed acknowledgements never dispatch a doomed paid primary.
          const futureWaves=Math.ceil(Math.max(0,pending.length-offset-PROPS_AI_PART_CONCURRENCY)/PROPS_AI_PART_CONCURRENCY);
          const remainingWindow=()=>{
            const correctionParts=parts.length-accepted.size;
            const reserved=30_000+futureWaves*90_000+(phase===1?propsAiCompletionWindowMs(correctionParts):0);
            return Math.min(deadline-Date.now(),instant(args.packet.lock)-instant(clock()))-reserved;
          };
          const timeoutMs=Math.floor(Math.min(180000,remainingWindow()));
          invariant(timeoutMs>=90000,"review_completion_window_exhausted");
          const attempt=await args.store.send(job.job_key,token,phase,index+1);
          const request=jointReviewRequest(part.packet,attempt.model,PROPS_AI_MAX_OUTPUT_PER_REQUEST,phase===2?feedback.get(index):undefined,phase===2?feedbackTexts.get(index):undefined),requestBody=serializeAiRequest(request,{serviceTier:attempt.requested_tier});
          let response;
          try{response=await generateAiReview(request,{key:args.key,timeoutMs,remainingWindowMs:remainingWindow,minimumTimeoutMs:90000,canStart:()=>!earlyWindowClosed(),fetchImpl:args.fetchImpl,serviceTier:attempt.requested_tier});}
          catch(error){
            const notStarted=error instanceof AiRequestNotStartedError,unbilled=notStarted||error instanceof AiGenerationError&&error.knownUnbilled;
            await args.store.receipt(attempt.id,token,unbilled?0:null,null,{kind:notStarted?"known_unbilled_before_http":unbilled?"known_unbilled":"unknown_transport_outcome",...(error instanceof AiGenerationError?{http_status:error.status,code:error.code,transport:error.diagnostics??null}:{}),requested_tier:attempt.requested_tier,failureEvidence:failureEvidence({packet:part.packet,requestBody,draftText:null,reason:(error as Error).message,physical:[]})});
            // A closed pre-HTTP window is genuinely zero-billed, but buying
            // phase two as its first paid request would again omit correction.
            // An actually dispatched known-unbilled capacity rejection retains
            // its existing bounded Standard recovery semantics.
            return {index,reason:(error as Error).message,known:unbilled&&!notStarted};
          }
          const texts=response.output?.flatMap(o=>o.content??[]).filter(c=>c.type==="output_text").map(c=>c.text??"")??[];
          if(!response.usage){await args.store.receipt(attempt.id,token,null,response.id,{kind:"missing_usage",transport:response.transportDiagnostics??null,failureEvidence:failureEvidence({packet:part.packet,requestBody,draftText:texts.length===1?texts[0]:null,reason:"missing_billed_usage",physical:[]})});return {index,reason:"missing_billed_usage",known:false};}
          let actual:number;
          try{actual=usageMicroUsd(attempt.model,response.usage,response.service_tier);}
          catch{await args.store.receipt(attempt.id,token,null,response.id,{...response.usage,transport:response.transportDiagnostics??null,failureEvidence:failureEvidence({packet:part.packet,requestBody,draftText:texts.length===1?texts[0]:null,reason:"invalid_billed_usage",physical:[]})});return {index,reason:"invalid_billed_usage",known:false};}
          let parsed:ReturnType<typeof parseJointReview>|null=null,reason:string|null=null,draft:unknown;
          try{draft=structuredAiText(response);parsed=parseJointReview(part.packet,draft);}
          catch(error){reason=(error as Error).message;}
          let correctionUnavailable=false;
          if(phase===1&&!parsed&&draft!==undefined&&part.packet.sport==="nba"){
            try{const next=namedSourceCorrection(part.packet,draft);
              if(next.status==="ready"&&next.affectedActorIds.length)feedbackTexts.set(index,next.text);
              else if(next.status==="unavailable"&&["feedback_exceeds_cushion","diagnostic_unavailable"].includes(next.reason))correctionUnavailable=true;
            }catch{correctionUnavailable=true;}
          }
          // A failed NBA part can retain independently admitted actors only after
          // its exact raw request/input/draft and known charge are recorded.
          // Full responses are still requested in phase two; old outputs are ignored.
          let actorProposal:ActorAdmissionProposal|undefined,actorUnavailable=false;
          if(part.packet.sport==="nba"&&texts.length===1&&draft!==undefined&&(!parsed||actorAdmissions.has(index))){
            try{
              let admission=actorAdmissions.get(index);
              if(!admission){admission=new OriginalPartActorAdmission(part.packet);actorAdmissions.set(index,admission);}
              actorProposal=admission.propose(texts[0],{part:index+1,phase:phase as 1|2,model:attempt.model,requestedTier:attempt.requested_tier,actualTier:response.service_tier??"unknown",responseId:response.id,requestHash:sha(requestBody)});
              parsed=null;
            }catch{actorUnavailable=true;parsed=null;reason="actor_admission_diagnostic_unavailable";}
          }
          // Settle billing once. Successful raw wire and failed diagnostics are
          // bound before the first immutable receipt, including parts of failed games.
          const wire=parsed?acceptedResponseEvidence({packet:part.packet,sourcePacket:args.packet,sourcePacketJson,requestBody,draftText:texts[0],players:parsed.players,correctionText:phase===2?feedbackTexts.get(index):undefined}):null;
          if(parsed&&wire&&"archiveUnavailable" in wire){parsed=null;reason="accepted_wire_archive_unavailable";}
          const archivedFailure=reason||actorProposal?failureEvidence({packet:part.packet,requestBody,draftText:texts.length===1?texts[0]:null,reason:reason??"actor_correction_wire_partially_consumed",physical:physicalLawFindings(part.packet,draft)}):null;
          if(actorProposal&&(!archivedFailure||!("input" in archivedFailure)||archivedFailure.input.sha256!==sha(JSON.stringify(part.packet))||archivedFailure.request.sha256!==sha(requestBody)||archivedFailure.draft?.sha256!==actorProposal.draftSha256))actorUnavailable=true;
          const actorEvidence=actorProposal?{
            release:actorProposal.release,archiveField:"failureEvidence",disposition:actorUnavailable?"unavailable":"eligible_after_known_receipt",
            lineage:actorProposal.lineage,sourceInputHash:actorProposal.sourceInputHash,aliasesHash:actorProposal.aliasesHash,factsHash:actorProposal.factsHash,marketScopes:actorProposal.marketScopes,
            draftSha256:actorProposal.draftSha256,draftBytes:actorProposal.draftBytes,globalEnvelopeValid:actorProposal.globalEnvelopeValid,
            requestedActorIds:actorProposal.requestedActorIds,consumedActorIds:actorProposal.consumedActorIds,ignoredActorIds:actorProposal.ignoredActorIds,
            eligibleActors:actorProposal.admittedActors.map(actor=>({playerId:actor.playerId,rawActorHash:actor.rawActorHash,canonicalHash:actor.canonicalHash,canonicalLawHash:actor.canonical.law?.hash??null,sourceDeclinedMarkets:actor.canonical.sourceDeclinedMarkets})),rejectedActors:actorProposal.rejectedActors,
          }:null;
          const usage:Record<string,unknown>={...response.usage,service_tier:response.service_tier??"unknown",response_status:response.status,response_model:response.model,transport:response.transportDiagnostics??null,
            ...(phase===1&&feedbackTexts.has(index)?{nextCorrectionText:feedbackTexts.get(index)}:{}),...(correctionUnavailable?{correctionFeedbackUnavailable:true}:{}),
            ...(wire?{responseEvidence:wire}:{}),
            ...(archivedFailure?{failureEvidence:archivedFailure}:{}),...(actorEvidence?{actorAdmissionEvidence:actorEvidence}:{}),...(actorUnavailable?{actorAdmissionUnavailable:true}:{})};
          // The combined immutable receipt, not each archive separately, must fit.
          // Keep the charge recordable; missing evidence never permits retention.
          if(actorProposal&&Buffer.byteLength(JSON.stringify(usage),"utf8")>768000){
            actorUnavailable=true;
            usage.actorAdmissionUnavailable=true;
            usage.actorAdmissionEvidence={release:actorProposal.release,disposition:"unavailable",reason:"combined_receipt_evidence_bound"};
            usage.failureEvidence={release:archivedFailure?.release,archiveUnavailable:"combined_actor_receipt_evidence_bound",reason};
          }
          await args.store.receipt(attempt.id,token,actual,response.id,usage);
          if(actorProposal&&!actorUnavailable){
            const admission=actorAdmissions.get(index)!;
            admission.retain(actorProposal,{receiptRecorded:true,receiptId:attempt.id,actualMicro:actual,archivedInputDigest:digest(part.packet),archivedRequestSha256:sha(requestBody),archivedDraftSha256:sha(texts[0])});
            const entries=actorProvenance.get(index)??[];
            if(actorProposal.admittedActors.length)entries.push({part:index+1,phase,model:attempt.model,requestedTier:attempt.requested_tier,actualTier:response.service_tier??"unknown",responseId:response.id,playerIds:actorProposal.admittedActors.map(a=>a.playerId),wireHash:actorProposal.draftSha256,requestHash:sha(requestBody),partInputHash:digest(part.packet),wireRelease:PROPS_AI_WIRE_RELEASE,actorAdmissionRelease:actorProposal.release,actorHashes:Object.fromEntries(actorProposal.admittedActors.map(a=>[a.playerId,{rawActorHash:a.rawActorHash,canonicalHash:a.canonicalHash}])),...(phase===2?{correctionReason:feedback.get(index),...(feedbackTexts.has(index)?{correctionText:feedbackTexts.get(index)}:{})}:{})});
            actorProvenance.set(index,entries);
            if(!admission.pendingActorIds().length){parsed=admission.finish().review;accepted.set(index,parsed);return null;}
          }
          if(!parsed)return {index,reason:reason??"unparsed_draft",known:reason!=="accepted_wire_archive_unavailable"&&!correctionUnavailable&&!actorUnavailable};
          accepted.set(index,parsed);
          provenance.set(index,{part:index+1,phase,model:attempt.model,requestedTier:attempt.requested_tier,actualTier:response.service_tier??"unknown",responseId:response.id,playerIds:part.packet.players.map(p=>p.id),...(wire&&"draft" in wire?{wireHash:wire.draft.sha256,requestHash:wire.requestSha256,partInputHash:wire.partInputDigest,wireRelease:wire.wireRelease}:{}),...(phase===2?{correctionReason:feedback.get(index),...(feedbackTexts.has(index)?{correctionText:feedbackTexts.get(index)}:{})}:{})});
          return null;
        })));
        for(let i=0;i<results.length;i++){
          const result=results[i];
          if(result.status==="fulfilled"){if(result.value)failures.push(result.value);}
          else failures.push({index:pending[offset+i],reason:(result.reason as Error).message,known:false});
        }
      }
      if(!failures.length){
        const parsed=[...accepted].sort(([a],[b])=>a-b).flatMap(([,r])=>r.players);
        invariant(digest(parsed.map(p=>p.playerId).sort())===digest(args.packet.players.map(p=>p.id).sort()),"accepted_review_coverage_mismatch");
        invariant(instant(clock())<instant(args.packet.lock),"review_completed_after_lock");
        const input=Buffer.from(sourcePacketJson),compressed=gzipSync(input),partProvenance=[...provenance.values(),...[...actorProvenance.values()].flat()].sort((a,b)=>a.part-b.part||a.phase-b.phase);
        invariant(input.byteLength<=16_000_000&&compressed.byteLength<=2_000_000,"oversize_immutable_input_evidence");
        const models=[...new Set(partProvenance.map(p=>p.model))];
        const review:AcceptedGameReview={release:PROPS_AI_RELEASE,gameId:args.packet.gameId,sourceGameId:args.packet.sourceGameId??args.packet.gameId,start:args.packet.start,lock:args.packet.lock,cutoff:args.packet.cutoff,criticalContextHashes:criticalContextHashes(args.packet),marketScopes:Object.fromEntries(args.packet.players.map(p=>[p.id,[...p.markets]])),model:models.length===1?models[0]:"mixed_recorded_per_part",partProvenance,stage:args.packet.stage,players:parsed,inputEvidence:{encoding:"gzip-base64",digest:inputHash,bytes:input.byteLength,data:compressed.toString("base64")}};
        const completed=await args.store.finish(job.job_key,token,review,null);
        return {status:completed.state,review:completed.state==="completed"?completed.result as AcceptedGameReview:null};
      }
      failure=failures[0].reason;
      if(phase===1&&failures.every(f=>f.known)&&!earlyWindowClosed()&&deadline-Date.now()>propsAiCompletionWindowMs(failures.length)&&instant(args.packet.lock)-instant(clock())>propsAiCompletionWindowMs(failures.length)&&await args.store.fallback(job.job_key,token,failures.map(f=>f.index+1),failure)){
        for(const f of failures)feedback.set(f.index,f.reason);
        pending=failures.map(f=>f.index);phase=2;continue;
      }
      break;
    }
  }catch(error){failure=(error as Error).message;}
  const failed=await args.store.finish(job.job_key,token,null,failure.replace(/sk-[\w-]+/g,"redacted").slice(0,200));
  return {status:failed.state,reason:failed.error_code};
  }finally{releaseGame();}
}
