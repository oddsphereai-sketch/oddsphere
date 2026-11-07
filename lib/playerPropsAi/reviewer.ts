import { gzipSync } from "node:zlib";
import type { GamePacket } from "./evidenceContract";
import { digest, invariant, instant, etDate } from "./evidence";
import { usageMicroUsd, type PropsAiJob, type PropsAiReviewStore } from "./budget";
import { jointReviewRequest, parseJointReview } from "./request";
import { countAiInput, generateAiReview, structuredAiText, AiGenerationError } from "./openai";
import { prepareReviewParts } from "./partitions";
import { PROPS_AI_MAX_OUTPUT_PER_REQUEST, PROPS_AI_STRONG_MODEL, PROPS_AI_RELEASE, type PropsAiModel } from "./releases";

type PreparedPart = Awaited<ReturnType<typeof prepareReviewParts>>[number];
type PartProvenance = { part:number; phase:number; model:PropsAiModel; requestedTier:string; actualTier:string; responseId:string; playerIds:string[] };
export type AcceptedGameReview = { release: typeof PROPS_AI_RELEASE; gameId: string; start: string; lock: string; cutoff: string;
  model: string; partProvenance:PartProvenance[]; stage: "early" | "final"; issuedAt?: string; inputHash?: string; players: ReturnType<typeof parseJointReview>["players"];
  inputEvidence: { encoding: "gzip-base64"; digest: string; bytes: number; data: string } };
export async function runPropsReview(args: { packet: GamePacket; job: PropsAiJob; store: PropsAiReviewStore; key: string;
  preferStronger: boolean; writerRunId:string; fetchImpl?: typeof fetch; clock?: () => string; deadline?: number;
  prepare?:()=>Promise<PreparedPart[]>; countStrong?:(part:PreparedPart)=>Promise<number> }) {
  const clock = args.clock ?? (() => new Date().toISOString()), deadline = args.deadline ?? Date.now() + 250000;
  if(args.job.state!=="pending")return {status:"skipped",reason:"not_pending"};
  invariant(args.job.game_id === args.packet.gameId && args.job.sport===args.packet.sport && instant(args.job.scheduled_start) === instant(args.packet.start) && instant(args.job.lock_at)===instant(args.packet.lock) && args.job.stage === args.packet.stage && args.job.game_day===etDate(args.packet.start), "job_input_identity_mismatch");
  invariant(instant(clock()) < instant(args.packet.lock) && instant(args.packet.cutoff) <= instant(clock()), "input_outside_actual_review_window");
  const parts = await (args.prepare?.() ?? prepareReviewParts(args.packet, { key: args.key, fetchImpl: args.fetchImpl }));
  invariant(digest(parts.flatMap(p=>p.packet.players.map(p=>p.id)).sort())===digest(args.packet.players.map(p=>p.id).sort()),"partition_player_coverage_mismatch");
  const preferStronger=args.preferStronger&&args.job.stage==="final";
  const requests = await Promise.all(parts.map(async part=>({input_tokens:part.inputTokens,max_output_tokens:PROPS_AI_MAX_OUTPUT_PER_REQUEST,
    strong_input_tokens:preferStronger ? await (args.countStrong?.(part) ?? countAiInput(jointReviewRequest(part.packet,PROPS_AI_STRONG_MODEL,PROPS_AI_MAX_OUTPUT_PER_REQUEST),{key:args.key,fetchImpl:args.fetchImpl})).catch(()=>null) : null})));
  const inputHash = digest(args.packet), claimed = await args.store.claim(args.job.job_key, inputHash, requests, preferStronger,args.writerRunId);
  if (!claimed.claimed) return { status: "skipped", reason: claimed.reason };
  const job = claimed.job!, token = claimed.token!;
  const accepted=new Map<number,ReturnType<typeof parseJointReview>>(),provenance=new Map<number,PartProvenance>();
  let phase=1, pending=parts.map((_,i)=>i), failure="unknown_review_failure";
  try {
    while(phase<=2){
      const failures:{index:number;reason:string;known:boolean}[]=[];
      // Whole-player parts retain every market. Successful parts are never regenerated.
      for(let offset=0;offset<pending.length;offset+=4){
        const results=await Promise.allSettled(pending.slice(offset,offset+4).map(async index=>{
          const part=parts[index], timeoutMs=Math.floor(Math.min(180000,deadline-Date.now()-10000,instant(args.packet.lock)-instant(clock())-10000));
          invariant(timeoutMs>1000,"review_completion_window_exhausted");
          const attempt=await args.store.send(job.job_key,token,phase,index+1);
          let response;
          try{response=await generateAiReview(jointReviewRequest(part.packet,attempt.model,PROPS_AI_MAX_OUTPUT_PER_REQUEST),{key:args.key,timeoutMs,fetchImpl:args.fetchImpl,serviceTier:attempt.requested_tier});}
          catch(error){
            const unbilled=error instanceof AiGenerationError&&error.knownUnbilled;
            await args.store.receipt(attempt.id,token,unbilled?0:null,null,unbilled?{kind:"known_unbilled",http_status:429,code:error.code,requested_tier:attempt.requested_tier}:null);
            return {index,reason:(error as Error).message,known:unbilled};
          }
          if(!response.usage){await args.store.receipt(attempt.id,token,null,response.id,null);return {index,reason:"missing_billed_usage",known:false};}
          let actual:number;
          try{actual=usageMicroUsd(attempt.model,response.usage,response.service_tier);}
          catch{await args.store.receipt(attempt.id,token,null,response.id,response.usage);return {index,reason:"invalid_billed_usage",known:false};}
          await args.store.receipt(attempt.id,token,actual,response.id,{...response.usage,service_tier:response.service_tier??"unknown",response_status:response.status,response_model:response.model});
          try{
            accepted.set(index,parseJointReview(part.packet,structuredAiText(response)));
            provenance.set(index,{part:index+1,phase,model:attempt.model,requestedTier:attempt.requested_tier,actualTier:response.service_tier??"unknown",responseId:response.id,playerIds:part.packet.players.map(p=>p.id)});
            return null;
          }catch(error){return {index,reason:(error as Error).message,known:true};}
        }));
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
        const input=Buffer.from(JSON.stringify(args.packet)),compressed=gzipSync(input),partProvenance=[...provenance.values()].sort((a,b)=>a.part-b.part);
        invariant(input.byteLength<=16_000_000&&compressed.byteLength<=2_000_000,"oversize_immutable_input_evidence");
        const models=[...new Set(partProvenance.map(p=>p.model))];
        const review:AcceptedGameReview={release:PROPS_AI_RELEASE,gameId:args.packet.gameId,start:args.packet.start,lock:args.packet.lock,cutoff:args.packet.cutoff,model:models.length===1?models[0]:"mixed_recorded_per_part",partProvenance,stage:args.packet.stage,players:parsed,inputEvidence:{encoding:"gzip-base64",digest:inputHash,bytes:input.byteLength,data:compressed.toString("base64")}};
        const completed=await args.store.finish(job.job_key,token,review,null);
        return {status:completed.state,review:completed.state==="completed"?completed.result as AcceptedGameReview:null};
      }
      failure=failures[0].reason;
      if(phase===1&&failures.every(f=>f.known)&&deadline-Date.now()>20000&&instant(args.packet.lock)-instant(clock())>20000&&await args.store.fallback(job.job_key,token,failures.map(f=>f.index+1),failure)){
        pending=failures.map(f=>f.index);phase=2;continue;
      }
      break;
    }
  }catch(error){failure=(error as Error).message;}
  const failed=await args.store.finish(job.job_key,token,null,failure.replace(/sk-[\w-]+/g,"redacted").slice(0,200));
  return {status:failed.state,reason:failed.error_code};
}
