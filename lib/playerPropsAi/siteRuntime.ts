import {propsAiGameAdmission} from "./gameAdmission";
import {prepareReviewParts} from "./partitions";
import {jointReviewRequest} from "./request";
import {countAiInput} from "./openai";
import {propsAiFailureCode,PROPS_AI_DIAGNOSTIC_RELEASE} from "./failureCode";
import {isMissedPropsEarlyWindow} from "./schedule";
import {propsAiGenerationPool,propsAiTwoPhaseCompletionWindowMs} from "./completionWindow";
/** Invoked only by the existing sport-scoped prediction writer. Never owns a timer or member write. */
import type {SupabaseClient} from "@supabase/supabase-js";
import type {GamePacket,Sport} from "./evidenceContract";
import type {LivePropsGame} from "./liveSources";
import type {CapturedReviewWindow} from "./liveWindow";
import {propsAiSiteConfig,PROPS_AI_CONTROL_RELEASE} from "./siteConfig";
import {PropsAiStore,type PropsAiJob} from "./budget";
import {loadPropsCalendar,calendarWalletPlan,matchPropsCalendarGame,reconcilePropsCalendarDay} from "./calendar";
import {runPropsReview,type AcceptedGameReview} from "./reviewer";
import {selectSiteReview,siteAiDecisions,siteReviewCoverage,siteReviewQualification,type SiteAiDecision} from "./publication";
import {instant,etDate} from "./evidence";
import {PROPS_AI_RELEASE,PROPS_AI_ACCEPTED_RELEASES,PROPS_AI_SELECTION_RELEASE,PROPS_AI_SCHEDULE_RELEASE,PROPS_AI_MIN_REVIEW_WINDOW_MS,PROPS_AI_MAX_OUTPUT_PER_REQUEST} from "./releases";
import {NFL_PLAYER_PROPS_EMPTY_CURRENT_RELEASE} from '../services/football/nflPlayerPropsContract';
import {buildPropsSourceContextAudit,buildPropsSourceContextAuditSlate,type PropsSourceContextAudit} from './sourceContextAudit';
/** Purpose is diagnostic context only; it never creates a review or source read. */
export type PropsAiSourceLoadContext={purpose:"scheduled_review";job:PropsAiJob}|{purpose:"lock_authority"|"member_publication"};
export type SiteReviewResult={game:LivePropsGame;packet:GamePacket;decisions:SiteAiDecision[];authorityReview:AcceptedGameReview|null;observedAt:string};
type SiteCoverage={participationBlockedScopes:number;unresolvedSourceScopes:number;unresolvedExecutionContracts:number;gameId:string;players:number;withdrawalContextPlayers:number;reviewedPlayers:number;contextChangedPlayers:number;unreviewedScopes:number;eligiblePlayers:number;pricedPlayers:number;qualifiedLawPlayers:number;sourceDeclinedScopes:number;unqualifiedTailScopes:number;currentExecutionContracts:number;pricedExecutionContracts:number;unpricedExecutionContracts:number};
export type SiteReviewOutcome={status:string;games:SiteReviewResult[];findings:string[];coverage?:SiteCoverage[];newlyCompletedReviews?:number;sourceContextAudits?:ReturnType<typeof buildPropsSourceContextAuditSlate>};
export async function reviewPropsForSite(args:{client:SupabaseClient;sport:Sport;games:LivePropsGame[];writerRunId?:string;load:(game:LivePropsGame,window:CapturedReviewWindow,context?:PropsAiSourceLoadContext)=>Promise<GamePacket>|GamePacket;fetchImpl?:typeof fetch;clock?:()=>string;deadline?:number;onSourceAudit?:(audit:PropsSourceContextAudit)=>void|Promise<void>;onSourceReady?:(packet:GamePacket,review:AcceptedGameReview|null,observedAt:string,lookupAvailable:boolean)=>void|Promise<void>;onReviewObserved?:(packet:GamePacket,review:AcceptedGameReview|null,lookupAvailable:boolean)=>void|Promise<void>;onReviewReady?:(packet:GamePacket,review:AcceptedGameReview)=>void|Promise<void>}):Promise<SiteReviewOutcome>{
  const config=propsAiSiteConfig();
  // Counterfactual gate: zero database, calendar, provider, token-count or generation I/O.
  if(!config.integrated)return {status:"disabled",games:[],findings:[]};
  const clock=args.clock??(()=>new Date().toISOString()),now=clock(),deadline=args.deadline??Date.now()+250000,findings:string[]=[],results:SiteReviewResult[]=[];
  const coverage:SiteCoverage[]=[];
  let newlyCompletedReviews=0;
  // Private process classification only. A completed SQL job/count is not a
  // successful source handoff. Record only a callback actually awaited wholly
  // before its exact lock; this is not independent transaction-commit proof.
  const readyHandoffBeforeLock=new Map<string,number>();
  const sourceAudits=new Map<string,PropsSourceContextAudit>();
  const auditSource=async(packet:GamePacket,review:AcceptedGameReview|null,observedAt:string,lookupAvailable:boolean)=>{
    if(!args.onSourceAudit)return;
    const audit=buildPropsSourceContextAudit({packet,review,observedAt,lookupAvailable});
    sourceAudits.set(audit.gameId,audit);await args.onSourceAudit(audit);
  };
  const finish=(outcome:SiteReviewOutcome)=>{console.info(`PLAYER_PROPS_AI_SITE ${JSON.stringify({release:PROPS_AI_RELEASE,selectionRelease:PROPS_AI_SELECTION_RELEASE,scheduleRelease:PROPS_AI_SCHEDULE_RELEASE,diagnosticsRelease:PROPS_AI_DIAGNOSTIC_RELEASE,sport:args.sport,status:outcome.status,newlyCompletedReviews,reviewedGames:outcome.games.filter(g=>g.authorityReview&&g.packet.sourceOfferSetStatus!=='empty').length,sourceGames:outcome.games.length,coverage:outcome.coverage,findings:outcome.findings.slice(0,16)})}`);return args.onSourceAudit?{...outcome,newlyCompletedReviews,sourceContextAudits:buildPropsSourceContextAuditSlate([...sourceAudits.values()])}:{...outcome,newlyCompletedReviews};};
  const store=new PropsAiStore(args.client);
  try{
    const control=await args.client.from("player_props_ai_control").select("release,paid_enabled").eq("singleton",true).single();
    if(control.error)throw new Error("database_installation_required");
    const paid=config.paid&&Boolean(config.key)&&control.data?.paid_enabled===true&&control.data?.release===PROPS_AI_CONTROL_RELEASE&&Boolean(args.writerRunId);
    // Retained results can render with paid runs off. No calendar HTTP/funding is needed to do so.
    let calendar:Awaited<ReturnType<typeof loadPropsCalendar>>|null=null;
    if(paid&&deadline-Date.now()>40000){
      calendar=await loadPropsCalendar(args.client,now.slice(0,7),now,args.fetchImpl,deadline,clock);
      const currentGames=args.games.filter(g=>etDate(g.start)===etDate(clock())&&instant(g.start)-3600000>instant(clock()));
      const refreshed=await reconcilePropsCalendarDay({client:args.client,calendar,sport:args.sport,games:currentGames,writerRunId:args.writerRunId!,now:clock(),clock,fetchImpl:args.fetchImpl,deadline});
      calendar=refreshed.calendar;findings.push(...refreshed.findings);
      const plan=await store.plan(calendarWalletPlan(calendar,clock()),calendar);
      if(!plan.funded){findings.push(`ai_unavailable:${plan.reason??"month_not_funded"}`);calendar=null;}
      await store.reap();
    }else if(paid){
      const checkedAt=clock();
      if(args.games.some(g=>etDate(g.start)===etDate(checkedAt)&&instant(g.start)-3600000>instant(checkedAt))){
        // Inventory was not read. Do not infer no due slots from native/source
        // success, or invent a known failed review. This adds no request.
        findings.push("review_deferred_writer_inventory_deadline");
      }
    }
    const generationSlot=propsAiGenerationPool(16),gameAdmission=propsAiGameAdmission(16);
    const active=args.games.filter(g=>etDate(g.start)===etDate(now)&&instant(g.start)-3600000>instant(clock()));
    const latestForPacket=(packet:GamePacket,reviews:AcceptedGameReview[],at:string)=>reviews.filter(r=>(r.sourceGameId??r.gameId)===packet.gameId&&instant(r.start)===instant(packet.start)&&instant(r.lock)===instant(packet.lock)&&r.issuedAt&&instant(r.issuedAt)<=instant(at)&&instant(r.issuedAt)<instant(packet.lock)).sort((a,b)=>Number(b.stage==="final")-Number(a.stage==="final")||instant(b.issuedAt!)-instant(a.issuedAt!))[0]??null;
    // The NFL writer can bind its actual fresh native construction to the exact
    // pre-generation source packet. This adds no provider/model/count request.
    const capturedPackets=new Map<string,GamePacket>();
    const localCompleted=new Map<string,{packet:GamePacket;review:AcceptedGameReview}>();
    let priorAccepted:AcceptedGameReview[]=[],initialLookupSucceeded=false;
    if(args.onSourceReady){
      const initial=await args.client.from("player_props_ai_reviews").select("result").eq("sport",args.sport).eq("state","completed").gte("scheduled_start",now.slice(0,10)).order("completed_at",{ascending:false}).limit(256);
      if(initial.error)findings.push("lock_prior_authority_unavailable");
      priorAccepted=(initial.error?[]:initial.data??[]).map(r=>r.result as AcceptedGameReview).filter(r=>r&&PROPS_AI_ACCEPTED_RELEASES.includes(r.release));initialLookupSucceeded=!initial.error;
    }
    const nativeByFundedId=new Map<string,LivePropsGame>();
    if(calendar)for(const g of active){try{nativeByFundedId.set(matchPropsCalendarGame(calendar,args.sport,g).id,g);}catch{findings.push(`calendar_identity_unavailable:${g.id}`);}}
    let pendingJobs:PropsAiJob[]=[],pendingInventoryAvailable=true;
    if(paid&&calendar&&nativeByFundedId.size){
      // Read the bounded existing logical slots, including a final that can
      // become due while an earlier source cohort is running. Actual-clock
      // admission below and the claim RPC still refuse any not-yet-due job.
      const pendingBound=nativeByFundedId.size*2;
      const due=await args.client.from("player_props_ai_reviews").select("*").eq("sport",args.sport).eq("state","pending").in("game_id",[...nativeByFundedId.keys()]).order("due_at",{ascending:true}).limit(pendingBound+1);
      if(due.error||!Array.isArray(due.data)||due.data.length>pendingBound){
        pendingInventoryAvailable=false;findings.push(due.error?"due_review_read_failed":"pending_review_inventory_exceeds_two_slots_per_game","ai_operational_fallback_keep_independent");
      }else pendingJobs=due.data.sort((a,b)=>instant(a.lock_at)-instant(b.lock_at)||instant(a.due_at)-instant(b.due_at));
    }
    const lockOf=(game:LivePropsGame)=>instant(game.start)-3600000;
    const cohorts=[...new Set(active.map(lockOf))].sort((a,b)=>a-b).map(lock=>active.filter(game=>lockOf(game)===lock));
    const dueNow=(job:PropsAiJob)=>job.state==='pending'&&instant(job.due_at)<=instant(clock())&&instant(job.lock_at)>instant(clock())&&!isMissedPropsEarlyWindow(job.stage,job.lock_at,clock());
    const preparationReserve=propsAiTwoPhaseCompletionWindowMs(1)+10000;
    const sourceWindow=(job:PropsAiJob)=>dueNow(job)&&instant(job.lock_at)-instant(clock())>preparationReserve&&deadline-Date.now()>preparationReserve;
    const sourcePackets=new Map<string,GamePacket>(),sourceFailed=new Set<string>();
    let selectedJobs=0;
    for(const cohort of cohorts){
      const cohortIds=new Set(cohort.map(g=>g.id)),cohortJobs=pendingJobs.filter(job=>cohortIds.has(nativeByFundedId.get(job.game_id)?.id??''));
      const capture=async(game:LivePropsGame,job?:PropsAiJob)=>{
        // Future scheduled inputs and their current authority use the same UTC
        // spelling. Keep the persisted job and all historical input bytes exact.
        const packet=await args.load(game,{gameId:game.id,stage:job?.stage??"final",cutoff:clock(),lock:new Date(job?instant(job.lock_at):lockOf(game)).toISOString()},job?{purpose:"scheduled_review",job}:{purpose:"lock_authority"});
        const observedAt=clock(),latest=latestForPacket(packet,priorAccepted,observedAt);capturedPackets.set(game.id,packet);
        await auditSource(packet,latest,observedAt,initialLookupSucceeded);await args.onSourceReady?.(packet,latest,observedAt,initialLookupSucceeded);
        if(job)sourcePackets.set(job.job_key,packet);
      };
      // Attempt every same/earlier-lock game's actual source/withdrawal handoff
      // before this cohort can claim money. Later-lock native refreshes cannot
      // consume an urgent final's preparation window. A failed unrelated game
      // preserves its own LKG and cannot cascade into healthy game demotions.
      for(const game of cohort){
        const job=cohortJobs.find(j=>nativeByFundedId.get(j.game_id)?.id===game.id&&sourceWindow(j));
        if(!args.onSourceReady&&!job)continue;
        try{
          if(lockOf(game)<=instant(clock()))throw new Error("source_window_closed");
          await capture(game,job);
        }catch(error){sourceFailed.add(game.id);findings.push(`lock_source_unavailable:${game.id}:${propsAiFailureCode(error)}`);}
      }
      if(!paid||!calendar||!cohortJobs.length)continue;
      if(cohortJobs.some(job=>instant(job.due_at)<=instant(clock())&&isMissedPropsEarlyWindow(job.stage,job.lock_at,clock()))&&!findings.includes("early_window_missed_final_only"))findings.push("early_window_missed_final_only");
      const runnable=cohortJobs.filter(dueNow),batch=runnable.slice(0,Math.max(0,16-selectedJobs));
      if(runnable.length>batch.length)findings.push("review_deferred_writer_game_bound");
      selectedJobs+=batch.length;
      if(!batch.length)continue;
      if(deadline-Date.now()<PROPS_AI_MIN_REVIEW_WINDOW_MS){findings.push("review_deferred_writer_deadline");continue;}
      // A final may have become due during these awaited source callbacks.
      // Capture that exact scheduled packet and complete its own source handoff
      // before any count can start; never relabel an earlier packet's cutoff.
      for(const job of batch){
        const native=nativeByFundedId.get(job.game_id)!;
        if(sourcePackets.has(job.job_key)||sourceFailed.has(native.id)||!sourceWindow(job))continue;
        try{await capture(native,job);}catch(error){sourceFailed.add(native.id);findings.push(`source_or_review_unavailable:${native.id}:${propsAiFailureCode(error)}`);}
      }
      const preparable=batch.filter(job=>sourceWindow(job)&&sourcePackets.has(job.job_key)&&!sourceFailed.has(nativeByFundedId.get(job.game_id)!.id));
      for(const job of batch.filter(job=>!preparable.includes(job)))findings.push(`review_preparation_deferred_lock:${job.game_id}`);
      if(!preparable.length){findings.push("review_preparation_deferred_deadline");continue;}
        let countDeadline=Math.min(deadline,Date.now()+Math.min(...preparable.map(job=>instant(job.lock_at)-instant(clock()))))-preparationReserve;
        if(countDeadline<=Date.now()){findings.push("review_preparation_deferred_deadline");continue;}
        const countAbort=new AbortController();
        let detachTimeout=()=>{};
        const armCountDeadline=()=>{
          detachTimeout();
          const remaining=Math.ceil(countDeadline-Date.now());
          if(remaining<=0){countAbort.abort(new Error("input_count_deadline_exhausted"));return;}
          const timeout=AbortSignal.timeout(remaining);
          const abort=()=>countAbort.abort(timeout.reason);
          timeout.addEventListener("abort",abort,{once:true});
          detachTimeout=()=>timeout.removeEventListener("abort",abort);
        };
        armCountDeadline();
        const pendingCounts=new Set<Promise<number>>();
        const prepared=await Promise.all(preparable.map(async job=>{
          const native=nativeByFundedId.get(job.game_id)!;
          try{
            // Recheck the actual boundary after all cohort source hooks. The
            // archived scheduled input is the exact source already observed.
            if(!dueNow(job))throw new Error("actual_review_window_closed");
            const packet=sourcePackets.get(job.job_key)!;
            if(packet.sourceOfferSetStatus==='empty'&&(packet.sport==='nba'||packet.sport==='nfl'&&packet.sourceInputRelease===NFL_PLAYER_PROPS_EMPTY_CURRENT_RELEASE)){findings.push(`review_deferred_empty_current_offers:${native.id}`);return null;}
            const fundedPacket={...packet,sourceGameId:native.id,gameId:job.game_id};
            const parts=await prepareReviewParts(fundedPacket,{key:config.key,fetchImpl:args.fetchImpl,onCountStage:parts=>{
              const stageDeadline=Math.min(deadline,Date.now()+instant(job.lock_at)-instant(clock()))-propsAiTwoPhaseCompletionWindowMs(parts)-10000;
              // An already infeasible larger game stays pending; it must not
              // cancel a sibling whose smaller complete window still fits.
              if(stageDeadline<=Date.now())throw new Error("input_count_deadline_exhausted");
              if(stageDeadline<countDeadline){countDeadline=stageDeadline;armCountDeadline();}
              if(countAbort.signal.aborted||countDeadline<=Date.now())throw new Error("input_count_deadline_exhausted");
            },count:(part,model)=>{
              // The API checks remaining time after this callback leaves the
              // shared pool, so waiting cannot start a late count request.
              const pending=generationSlot(()=>countAiInput(jointReviewRequest(part,model,PROPS_AI_MAX_OUTPUT_PER_REQUEST),{key:config.key,fetchImpl:args.fetchImpl,deadline:()=>countDeadline,signal:countAbort.signal}));
              pendingCounts.add(pending);void pending.then(()=>pendingCounts.delete(pending),()=>pendingCounts.delete(pending));return pending;
            }});
            return {job,native,packet,fundedPacket,parts};
          }catch(error){findings.push(`source_or_review_unavailable:${native.id}:${propsAiFailureCode(error)}`);return null;}
        })).finally(async()=>{
          // A failed Promise.all inside partition preparation can leave sibling
          // counts in flight. Await every started/queued count before generation;
          // their real abort signals share the same bounded preparation cutoff.
          try{while(pendingCounts.size)await Promise.allSettled([...pendingCounts]);}
          finally{detachTimeout();countAbort.abort(new Error("input_count_preparation_closed"));}
        });
        await Promise.all(prepared.map(async preparedGame=>{
          if(!preparedGame)return;
          const {job,native,packet,fundedPacket,parts}=preparedGame;
          try{
            const result=await runPropsReview({packet:fundedPacket,job,store,key:config.key,writerRunId:args.writerRunId!,generationSlot,gameAdmission,prepare:async()=>parts,preferStronger:job.stage==="final"&&packet.players.some(p=>p.missing.length>0),fetchImpl:args.fetchImpl,clock,deadline});
            if(result.status==="completed"&&"review" in result&&result.review){newlyCompletedReviews++;localCompleted.set(native.id,{packet,review:result.review});await auditSource(packet,result.review,clock(),true);await args.onReviewObserved?.(packet,result.review,true);if(args.onReviewReady){const before=instant(clock());await args.onReviewReady(packet,result.review);const acknowledged=instant(clock()),lockAt=instant(packet.lock);if(before<lockAt&&acknowledged<lockAt)readyHandoffBeforeLock.set(native.id,lockAt);}}
            if(result.status!=="completed")findings.push(`review_unavailable:${native.id}:${"reason" in result?result.reason:result.status}`);
          }catch(error){findings.push(`source_or_review_unavailable:${native.id}:${propsAiFailureCode(error)}`);}
        }));
    }
    // Native source identity is stored in each accepted result; avoids fragile cross-provider IDs in readers.
    const rows=await args.client.from("player_props_ai_reviews").select("result").eq("sport",args.sport).eq("state","completed").gte("scheduled_start",now.slice(0,10)).order("completed_at",{ascending:false}).limit(256);
    if(rows.error)findings.push("accepted_review_read_failed_use_trusted_local");
    const loaded=rows.error?priorAccepted:(rows.data??[]).map(r=>r.result as AcceptedGameReview).filter(r=>r&&PROPS_AI_ACCEPTED_RELEASES.includes(r.release));
    const accepted=[...new Map([...loaded,...[...localCompleted.values()].map(v=>v.review)].map(r=>[`${r.sourceGameId??r.gameId}|${r.stage}|${r.inputHash??r.inputEvidence.digest}`,r])).values()];
    const lookupAvailable=(gameId:string)=>!rows.error||initialLookupSucceeded||localCompleted.has(gameId);
    for(const game of active){
      try{
        const packet=await args.load(game,{gameId:game.id,stage:"final",cutoff:clock(),lock:new Date(instant(game.start)-3600000).toISOString()},{purpose:"member_publication"});
        const observedAt=clock();
        const latest=latestForPacket(packet,accepted,observedAt);
        await auditSource(packet,latest,observedAt,lookupAvailable(game.id));
        await args.onReviewObserved?.(packet,latest,lookupAvailable(game.id));
        const review=selectSiteReview(packet,accepted,observedAt);
        const players=packet.sourceOfferSetStatus==='empty'?[]:siteReviewCoverage(packet,latest,clock()),decisions=review?siteAiDecisions(packet,review,clock()):[];
        coverage.push({gameId:game.id,players:players.length,withdrawalContextPlayers:packet.sourceOfferSetStatus==='empty'?packet.players.length:0,reviewedPlayers:players.filter(p=>p.reviewed).length,
          contextChangedPlayers:players.filter(p=>p.reviewed&&!p.contextCurrent).length,
          unreviewedScopes:players.reduce((n,p)=>n+p.unreviewedMarkets.length,0),
          eligiblePlayers:packet.sourceOfferSetStatus==='empty'?0:players.filter(p=>p.markets.length>0).length,pricedPlayers:new Set(decisions.map(c=>c.playerId)).size,
          ...siteReviewQualification(packet,latest,clock(),15*60000,decisions)});
        results.push({game,packet,decisions,authorityReview:latest,observedAt});
      }catch(error){const lockAt=instant(game.start)-3600000;
        const postlockReady=instant(clock())>=lockAt&&readyHandoffBeforeLock.get(game.id)===lockAt;
        findings.push(`${postlockReady?'current_source_reload_unavailable_after_ready_lock':'current_source_unavailable'}:${game.id}:${propsAiFailureCode(error)}`);const packet=localCompleted.get(game.id)?.packet??capturedPackets.get(game.id);if(packet){const observedAt=clock(),latest=latestForPacket(packet,accepted,observedAt);await auditSource(packet,latest,observedAt,lookupAvailable(game.id));await args.onReviewObserved?.(packet,latest,lookupAvailable(game.id));results.push({game,packet,decisions:[],authorityReview:latest,observedAt});}}

    }
    return finish({status:paid?(pendingInventoryAvailable?"active":"unavailable"):"paid_disabled",games:results,findings,coverage});
  }catch{return finish({status:"unavailable",games:[],findings:[...findings,"ai_operational_fallback_keep_independent"]});}
}
