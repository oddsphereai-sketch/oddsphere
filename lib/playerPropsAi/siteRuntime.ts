import {propsAiFailureCode,PROPS_AI_DIAGNOSTIC_RELEASE} from "./failureCode";
import {isMissedPropsEarlyWindow} from "./schedule";
import {propsAiGenerationPool} from "./completionWindow";
/** Invoked only by the existing sport-scoped prediction writer. Never owns a timer or member write. */
import type {SupabaseClient} from "@supabase/supabase-js";
import type {GamePacket,Sport} from "./evidenceContract";
import type {LivePropsGame} from "./liveSources";
import type {CapturedReviewWindow} from "./liveWindow";
import {propsAiSiteConfig,PROPS_AI_CONTROL_RELEASE} from "./siteConfig";
import {PropsAiStore} from "./budget";
import {loadPropsCalendar,calendarWalletPlan,matchPropsCalendarGame} from "./calendar";
import {runPropsReview,type AcceptedGameReview} from "./reviewer";
import {selectSiteReview,siteAiDecisions,siteReviewCoverage,siteReviewQualification,type SiteAiDecision} from "./publication";
import {instant,etDate} from "./evidence";
import {PROPS_AI_RELEASE,PROPS_AI_ACCEPTED_RELEASES,PROPS_AI_SELECTION_RELEASE,PROPS_AI_SCHEDULE_RELEASE,PROPS_AI_MIN_REVIEW_WINDOW_MS} from "./releases";
export type SiteReviewResult={game:LivePropsGame;packet:GamePacket;decisions:SiteAiDecision[];authorityReview:AcceptedGameReview|null;observedAt:string};
type SiteCoverage={unresolvedSourceScopes:number;unresolvedExecutionContracts:number;gameId:string;players:number;reviewedPlayers:number;contextChangedPlayers:number;unreviewedScopes:number;eligiblePlayers:number;pricedPlayers:number;qualifiedLawPlayers:number;sourceDeclinedScopes:number;unqualifiedTailScopes:number;currentExecutionContracts:number;pricedExecutionContracts:number;unpricedExecutionContracts:number};
export type SiteReviewOutcome={status:string;games:SiteReviewResult[];findings:string[];coverage?:SiteCoverage[]};
export async function reviewPropsForSite(args:{client:SupabaseClient;sport:Sport;games:LivePropsGame[];writerRunId?:string;load:(game:LivePropsGame,window:CapturedReviewWindow)=>Promise<GamePacket>|GamePacket;fetchImpl?:typeof fetch;clock?:()=>string;deadline?:number;onSourceReady?:(packet:GamePacket,review:AcceptedGameReview|null,observedAt:string,lookupAvailable:boolean)=>void;onReviewObserved?:(packet:GamePacket,review:AcceptedGameReview|null,lookupAvailable:boolean)=>void;onReviewReady?:(packet:GamePacket,review:AcceptedGameReview)=>void}):Promise<SiteReviewOutcome>{
  const config=propsAiSiteConfig();
  // Counterfactual gate: zero database, calendar, provider, token-count or generation I/O.
  if(!config.integrated)return {status:"disabled",games:[],findings:[]};
  const clock=args.clock??(()=>new Date().toISOString()),now=clock(),deadline=args.deadline??Date.now()+230000,findings:string[]=[],results:SiteReviewResult[]=[];
  const coverage:SiteCoverage[]=[];
  const finish=(outcome:SiteReviewOutcome)=>{console.info(`PLAYER_PROPS_AI_SITE ${JSON.stringify({release:PROPS_AI_RELEASE,selectionRelease:PROPS_AI_SELECTION_RELEASE,scheduleRelease:PROPS_AI_SCHEDULE_RELEASE,diagnosticsRelease:PROPS_AI_DIAGNOSTIC_RELEASE,sport:args.sport,status:outcome.status,reviewedGames:outcome.games.filter(g=>g.authorityReview).length,sourceGames:outcome.games.length,coverage:outcome.coverage,findings:outcome.findings.slice(0,16)})}`);return outcome;};
  const store=new PropsAiStore(args.client);
  try{
    const control=await args.client.from("player_props_ai_control").select("release,paid_enabled").eq("singleton",true).single();
    if(control.error)throw new Error("database_installation_required");
    const paid=config.paid&&Boolean(config.key)&&control.data?.paid_enabled===true&&control.data?.release===PROPS_AI_CONTROL_RELEASE&&Boolean(args.writerRunId);
    // Retained results can render with paid runs off. No calendar HTTP/funding is needed to do so.
    let calendar:Awaited<ReturnType<typeof loadPropsCalendar>>|null=null;
    if(paid&&deadline-Date.now()>40000){
      calendar=await loadPropsCalendar(args.client,now.slice(0,7),now,args.fetchImpl,deadline);
      const plan=await store.plan(calendarWalletPlan(calendar,now));
      if(!plan.funded){findings.push(`ai_unavailable:${plan.reason??"month_not_funded"}`);calendar=null;}
      await store.reap();
    }
    const generationSlot=propsAiGenerationPool(16);
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
      const prior=(initial.error?[]:initial.data??[]).map(r=>r.result as AcceptedGameReview).filter(r=>r&&PROPS_AI_ACCEPTED_RELEASES.includes(r.release));priorAccepted=prior;initialLookupSucceeded=!initial.error;
      for(const game of active){try{const packet=await args.load(game,{gameId:game.id,stage:"final",cutoff:clock(),lock:new Date(instant(game.start)-3600000).toISOString()});const observedAt=clock();capturedPackets.set(game.id,packet);args.onSourceReady(packet,latestForPacket(packet,prior,observedAt),observedAt,!initial.error);}catch(error){findings.push(`lock_source_unavailable:${game.id}:${propsAiFailureCode(error)}`);}}
    }
    const nativeByFundedId=new Map<string,LivePropsGame>();
    if(calendar)for(const g of active){try{nativeByFundedId.set(matchPropsCalendarGame(calendar,args.sport,g).id,g);}catch{findings.push(`calendar_identity_unavailable:${g.id}`);}}
    if(paid&&calendar&&nativeByFundedId.size){
      const due=await args.client.from("player_props_ai_reviews").select("*").eq("sport",args.sport).eq("state","pending").in("game_id",[...nativeByFundedId.keys()]).lte("due_at",clock()).gt("lock_at",clock()).order("due_at",{ascending:true});
      if(due.error)throw new Error("due_review_read_failed");
      // Use the actual window, even when final has completed or failed.
      const runnable=(due.data??[]).filter(j=>!isMissedPropsEarlyWindow(j.stage,j.lock_at,clock()));
      if(runnable.length!==(due.data??[]).length)findings.push("early_window_missed_final_only");
      // v66 bounds claims to sixteen whole games; one sport-wide pool bounds generation to sixteen requests.
      for(let i=0;i<runnable.length;i+=16){
        if(i>0||deadline-Date.now()<PROPS_AI_MIN_REVIEW_WINDOW_MS){findings.push("review_deferred_writer_deadline");break;}
        await Promise.all(runnable.slice(i,i+16).map(async job=>{
          const native=nativeByFundedId.get(job.game_id)!;
          try{
            const packet=await args.load(native,{gameId:native.id,stage:job.stage,cutoff:clock(),lock:job.lock_at});
            // Funding identity is separate from the collector's exact native identity.
            const result=await runPropsReview({packet:{...packet,sourceGameId:native.id,gameId:job.game_id},job,store,key:config.key,writerRunId:args.writerRunId!,generationSlot,preferStronger:job.stage==="final"&&packet.players.some(p=>p.missing.length>0),fetchImpl:args.fetchImpl,clock,deadline});
            if(result.status==="completed"&&"review" in result&&result.review){localCompleted.set(native.id,{packet,review:result.review});args.onReviewObserved?.(packet,result.review,true);args.onReviewReady?.(packet,result.review);}
            if(result.status!=="completed")findings.push(`review_unavailable:${native.id}:${"reason" in result?result.reason:result.status}`);
          }catch(error){findings.push(`source_or_review_unavailable:${native.id}:${propsAiFailureCode(error)}`);}
        }));
      }
    }
    // Native source identity is stored in each accepted result; avoids fragile cross-provider IDs in readers.
    const rows=await args.client.from("player_props_ai_reviews").select("result").eq("sport",args.sport).eq("state","completed").gte("scheduled_start",now.slice(0,10)).order("completed_at",{ascending:false}).limit(256);
    if(rows.error)findings.push("accepted_review_read_failed_use_trusted_local");
    const loaded=rows.error?priorAccepted:(rows.data??[]).map(r=>r.result as AcceptedGameReview).filter(r=>r&&PROPS_AI_ACCEPTED_RELEASES.includes(r.release));
    const accepted=[...new Map([...loaded,...[...localCompleted.values()].map(v=>v.review)].map(r=>[`${r.sourceGameId??r.gameId}|${r.stage}|${r.inputHash??r.inputEvidence.digest}`,r])).values()];
    const lookupAvailable=(gameId:string)=>!rows.error||initialLookupSucceeded||localCompleted.has(gameId);
    for(const game of active){
      try{
        const packet=await args.load(game,{gameId:game.id,stage:"final",cutoff:clock(),lock:new Date(instant(game.start)-3600000).toISOString()});
        const observedAt=clock();
        const latest=latestForPacket(packet,accepted,observedAt);
        args.onReviewObserved?.(packet,latest,lookupAvailable(game.id));
        const review=selectSiteReview(packet,accepted,observedAt);
        const players=siteReviewCoverage(packet,latest,clock()),decisions=review?siteAiDecisions(packet,review,clock()):[];
        coverage.push({gameId:game.id,players:players.length,reviewedPlayers:players.filter(p=>p.reviewed).length,
          contextChangedPlayers:players.filter(p=>p.reviewed&&!p.contextCurrent).length,
          unreviewedScopes:players.reduce((n,p)=>n+p.unreviewedMarkets.length,0),
          eligiblePlayers:players.filter(p=>p.markets.length>0).length,pricedPlayers:new Set(decisions.map(c=>c.playerId)).size,
          ...siteReviewQualification(packet,latest,clock(),15*60000,decisions)});
        results.push({game,packet,decisions,authorityReview:latest,observedAt});
      }catch(error){findings.push(`current_source_unavailable:${game.id}:${propsAiFailureCode(error)}`);const packet=localCompleted.get(game.id)?.packet??capturedPackets.get(game.id);if(packet){const observedAt=clock(),latest=latestForPacket(packet,accepted,observedAt);args.onReviewObserved?.(packet,latest,lookupAvailable(game.id));results.push({game,packet,decisions:[],authorityReview:latest,observedAt});}}

    }
    return finish({status:paid?"active":"paid_disabled",games:results,findings,coverage});
  }catch{return finish({status:"unavailable",games:[],findings:[...findings,"ai_operational_fallback_keep_independent"]});}
}
