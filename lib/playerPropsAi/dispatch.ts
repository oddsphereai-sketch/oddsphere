/** Called by the existing sport writer after collection, while its lease is held. No timer or member writes. */
import type { GamePacket } from "./evidenceContract";
import type { PropsAiJob, PropsAiStore } from "./budget";
import { runPropsReview, type AcceptedGameReview } from "./reviewer";
import { invariant } from "./evidence";
export type PropsAiDispatchResult={jobKey:string;status:string;review:AcceptedGameReview|null;operationalFallback:string|null};
export async function dispatchFundedPropsReviews(args:{sport:PropsAiJob["sport"];writerRunId:string;store:Pick<PropsAiStore,"due"|"reap"|"claim"|"send"|"receipt"|"fallback"|"finish">;key:string;
  loadFrozenPacket:(job:PropsAiJob)=>Promise<GamePacket>;preferStronger?:(job:PropsAiJob)=>boolean;fetchImpl?:typeof fetch;clock?:()=>string;deadline?:number}){
  invariant(args.writerRunId&&args.key,"Configured server-side key and existing sport writer run required");
  const clock=args.clock??(()=>new Date().toISOString()),deadline=args.deadline??Date.now()+250000;
  await args.store.reap();
  const jobs=await args.store.due(args.sport,clock(),2),results:PropsAiDispatchResult[]=[];
  for(const job of jobs){
    if(deadline-Date.now()<30000){results.push({jobKey:job.job_key,status:"deferred",review:null,operationalFallback:"ai_pending_keep_independent"});continue;}
    try{
      // The caller supplies the complete current collector snapshot; no per-player fetch or model-input substitution here.
      const packet=await args.loadFrozenPacket(job);
      const result=await runPropsReview({packet,job,store:args.store,key:args.key,writerRunId:args.writerRunId,preferStronger:args.preferStronger?.(job)??false,fetchImpl:args.fetchImpl,clock,deadline});
      const review="review" in result?result.review??null:null;
      results.push({jobKey:job.job_key,status:result.status,review,operationalFallback:review?null:`ai_${"reason" in result?result.reason??"unavailable":"unavailable"}_keep_independent`});
    }catch{
      // No board/grade/lock mutation on an operational exception. The existing writer remains authoritative.
      results.push({jobKey:job.job_key,status:"failed",review:null,operationalFallback:"ai_operational_exception_keep_independent"});
    }
  }
  return results;
}
