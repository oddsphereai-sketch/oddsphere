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
import {selectSiteReview,siteAiDecisions,type SiteAiDecision} from "./publication";
import {instant} from "./evidence";
import {PROPS_AI_RELEASE,PROPS_AI_SCHEDULE_RELEASE,PROPS_AI_MIN_REVIEW_WINDOW_MS} from "./releases";
export type SiteReviewResult={game:LivePropsGame;packet:GamePacket;decisions:SiteAiDecision[]};
export type SiteReviewOutcome={status:string;games:SiteReviewResult[];findings:string[]};
export async function reviewPropsForSite(args:{client:SupabaseClient;sport:Sport;games:LivePropsGame[];writerRunId?:string;load:(game:LivePropsGame,window:CapturedReviewWindow)=>Promise<GamePacket>|GamePacket;fetchImpl?:typeof fetch;clock?:()=>string;deadline?:number}):Promise<SiteReviewOutcome>{
  const config=propsAiSiteConfig();
  // Counterfactual gate: zero database, calendar, provider, token-count or generation I/O.
  if(!config.integrated)return {status:"disabled",games:[],findings:[]};
  const clock=args.clock??(()=>new Date().toISOString()),now=clock(),deadline=args.deadline??Date.now()+230000,findings:string[]=[],results:SiteReviewResult[]=[];
  const finish=(outcome:SiteReviewOutcome)=>{console.info(`PLAYER_PROPS_AI_SITE ${JSON.stringify({release:PROPS_AI_RELEASE,scheduleRelease:PROPS_AI_SCHEDULE_RELEASE,sport:args.sport,status:outcome.status,reviewedGames:outcome.games.length,findings:outcome.findings.slice(0,16)})}`);return outcome;};
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
    const active=args.games.filter(g=>instant(g.start)-3600000>instant(clock()));
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
            if(result.status!=="completed")findings.push(`review_unavailable:${native.id}:${"reason" in result?result.reason:result.status}`);
          }catch{findings.push(`source_or_review_unavailable:${native.id}`);}
        }));
      }
    }
    // Native source identity is stored in each accepted result; avoids fragile cross-provider IDs in readers.
    const rows=await args.client.from("player_props_ai_reviews").select("result").eq("sport",args.sport).eq("state","completed").gte("scheduled_start",now.slice(0,10)).order("completed_at",{ascending:false}).limit(256);
    if(rows.error)throw new Error("accepted_review_read_failed");
    const accepted=(rows.data??[]).map(r=>r.result as AcceptedGameReview).filter(r=>r?.release===PROPS_AI_RELEASE);
    for(const game of active){
      try{
        const packet=await args.load(game,{gameId:game.id,stage:"final",cutoff:clock(),lock:new Date(instant(game.start)-3600000).toISOString()});
        const review=selectSiteReview(packet,accepted,clock());
        if(review)results.push({game,packet,decisions:siteAiDecisions(packet,review,clock())});
      }catch{findings.push(`current_source_unavailable:${game.id}`);}
    }
    return finish({status:paid?"active":"paid_disabled",games:results,findings});
  }catch{return finish({status:"unavailable",games:[],findings:[...findings,"ai_operational_fallback_keep_independent"]});}
}
