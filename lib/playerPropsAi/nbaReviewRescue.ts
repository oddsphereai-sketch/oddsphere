/** Extra invocation opportunity for the SAME pending early/final SQL slots.
 * Authentication and prediction_pipeline:nba ownership belong to cronHandler.
 * This helper creates no lease, timer, writer, review key, reset or third phase.
 */
import type {SupabaseClient} from "@supabase/supabase-js";
import type {CronHandlerResult} from "../cron/runCron";
import type {NbaRollingSchedule} from "../services/nba/nbaRollingSchedule";
import type {refreshNbaPlayerPropsPrivateCandidate,NbaPlayerPropsPrivateWriterResult} from "../services/nba/nbaPlayerPropsPrivateWriter";
import {propsAiSiteConfig} from "./siteConfig";

export const NBA_PROPS_REVIEW_RESCUE_RELEASE="nba_props_review_rescue_2026_11_10_r1_due_pending_only" as const;
export const NBA_PROPS_REVIEW_RESCUE_REQUEST_BUDGET_MS=480_000;
export const NBA_PROPS_REVIEW_RESCUE_MIN_REMAINING_MS=120_000;
export type NbaPropsReviewRescueWriterArgs=Parameters<typeof refreshNbaPlayerPropsPrivateCandidate>[0]&{aiDeadline:number};
export type NbaPropsReviewRescueArgs={client:SupabaseClient;writerRunId:string;requestStartedAt:number;clock?:()=>number;env?:Record<string,string|undefined>};
export type NbaPropsReviewRescueDependencies={
  hasDue:(args:{client:SupabaseClient;sport:"nba";now:string})=>Promise<boolean>;
  loadSchedule:(slateDate:string)=>Promise<NbaRollingSchedule>;
  writeCandidate:(args:NbaPropsReviewRescueWriterArgs)=>Promise<NbaPlayerPropsPrivateWriterResult>;
  slateDate:(now:Date)=>string|Promise<string>;
  providerSeason:(now:Date)=>number|Promise<number>;
};
const defaults:NbaPropsReviewRescueDependencies={
  hasDue:async args=>(await import("./dueReview")).hasDuePropsAiReview(args),
  loadSchedule:async slateDate=>(await import("../services/nba/nbaRollingSchedule")).loadNbaRollingSchedule(slateDate),
  writeCandidate:async args=>(await import("../services/nba/nbaPlayerPropsPrivateWriter")).refreshNbaPlayerPropsPrivateCandidate(args),
  slateDate:async now=>(await import("../services/nba/nbaPlayerPropsLifecycle")).nbaPlayerPropsSlateDate(now),
  providerSeason:async now=>(await import("../services/nba/nbaProviderSeason")).currentNbaProviderSeason(now),
};
const safeCount=(value:number)=>{if(!Number.isSafeInteger(value)||value<0)throw Error("invalid_writer_aggregate");return value;};

export async function runNbaPropsReviewRescue(args:NbaPropsReviewRescueArgs,deps:Partial<NbaPropsReviewRescueDependencies>={}):Promise<CronHandlerResult>{
  const env=args.env??process.env,clock=args.clock??Date.now,services={...defaults,...deps};
  const start=args.requestStartedAt,deadline=start+NBA_PROPS_REVIEW_RESCUE_REQUEST_BUDGET_MS;
  const response=(status:string,reason:string,partial=false):CronHandlerResult=>({records_updated:0,api_calls_made:0,...(partial?{partial:true,error_message:"NBA props rescue unavailable; fresh publication unverified"}:{}),details:{rescue_release:NBA_PROPS_REVIEW_RESCUE_RELEASE,status,reason,normal_pending_slots_only:true}});
  const enabled=()=>env.NBA_CRON_ENABLED==="true"&&env.NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED==="true";
  const paid=()=>{const config=propsAiSiteConfig(env);return config.paid&&Boolean(config.key);};
  const windowOpen=()=>{const now=clock();return Number.isSafeInteger(start)&&start>=0&&Number.isSafeInteger(now)&&now>=start&&Number.isSafeInteger(deadline)&&deadline-now>=NBA_PROPS_REVIEW_RESCUE_MIN_REMAINING_MS;};
  if(!enabled())return response("disabled","nba_or_props_writer_disabled");
  if(!paid())return response("disabled","paid_props_or_api_key_unavailable");
  if(!windowOpen())return response("skipped","insufficient_absolute_request_window");
  if(typeof args.writerRunId!=="string"||!args.writerRunId.trim()||args.writerRunId.length>128)return response("skipped","shared_nba_writer_run_required");
  let phase="due_check";
  try{
    // The route may have found due work before waiting for the sport lease.
    // Check again INSIDE that same lease before provider keys or source work.
    if(!await services.hasDue({client:args.client,sport:"nba",now:new Date(clock()).toISOString()}))return response("skipped","no_due_pending_props_review");
    if(!enabled()||!paid())return response("disabled","props_switch_changed_after_due_check");
    if(!windowOpen())return response("skipped","insufficient_absolute_request_window");
    const ballDontLieApiKey=env.BALLDONTLIE_API_KEY?.trim();
    if(!ballDontLieApiKey)return response("unavailable","required_props_provider_key_missing",true);
    const theOddsApiKey=env.THE_ODDS_API_KEY?.trim()||null,owlsInsightApiKey=env.OWLS_INSIGHT_API_KEY?.trim()||null;
    phase="slate_identity";const identityAt=new Date(clock()),slateDate=await services.slateDate(identityAt),season=await services.providerSeason(identityAt);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(slateDate)||!Number.isSafeInteger(season)||season<2000||season>2200)return response("unavailable","invalid_existing_slate_identity",true);
    if(!windowOpen())return response("skipped","insufficient_absolute_request_window");
    phase="cached_schedule";const schedule=await services.loadSchedule(slateDate);
    if(!enabled()||!paid())return response("disabled","props_switch_changed_after_schedule");
    if(!windowOpen())return response("skipped","insufficient_absolute_request_window");
    if(await services.slateDate(new Date(clock()))!==slateDate)return response("skipped","slate_changed_during_cached_read");
    if(!enabled()||!paid())return response("disabled","props_switch_changed_before_writer");
    if(!windowOpen())return response("skipped","insufficient_absolute_request_window");
    const writerNow=new Date(clock());
    phase="canonical_props_writer";
    const result=await services.writeCandidate({client:args.client,writerRunId:args.writerRunId,slateDate,season,schedule:schedule.games,
      ballDontLieApiKey,theOddsApiKey,owlsInsightApiKey,fullRefresh:false,now:writerNow.toISOString(),aiDeadline:deadline});
    const published=result.status==="published_private",providerRequests=safeCount(result.providerRequests);
    return {records_updated:published?1:0,api_calls_made:providerRequests,...(!published?{partial:true,error_message:"NBA props rescue did not publish a fresh candidate"}:{}),details:{rescue_release:NBA_PROPS_REVIEW_RESCUE_RELEASE,status:"canonical_writer_returned",normal_pending_slots_only:true,slate_date:slateDate,provider_season:season,writer_release:result.release,writer_status:result.status,
      provider_requests:providerRequests,decisions:safeCount(result.decisions),locked:safeCount(result.locked),observations_added:safeCount(result.observationsAdded),observations_refreshed:safeCount(result.observationsRefreshed),finding_count:safeCount(result.findings.length),absolute_ai_deadline:deadline,
      review_completion:"verify_normal_slot_ledger_separately"}};
  }catch{
    // A thrown writer might have failed before OR after publication. Do not
    // invent last-known-good proof, expose raw errors/keys, or run a second path.
    return response("unavailable",`${phase}_failed`,true);
  }
}
