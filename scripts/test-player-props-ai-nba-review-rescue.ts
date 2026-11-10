/** Synthetic due-slot execution controls. No HTTP, model, provider or DB calls.
 * This tests routing/gates, not canonical writer last-known-good atomicity.
 */
import assert from "node:assert/strict";
import type {SupabaseClient} from "@supabase/supabase-js";
import {runNbaPropsReviewRescue,NBA_PROPS_REVIEW_RESCUE_REQUEST_BUDGET_MS,NBA_PROPS_REVIEW_RESCUE_MIN_REMAINING_MS,type NbaPropsReviewRescueArgs,type NbaPropsReviewRescueDependencies,type NbaPropsReviewRescueWriterArgs} from "../lib/playerPropsAi/nbaReviewRescue";
import type {NbaPlayerPropsPrivateWriterResult} from "../lib/services/nba/nbaPlayerPropsPrivateWriter";
import type {NbaRollingSchedule} from "../lib/services/nba/nbaRollingSchedule";

globalThis.fetch=async()=>{throw Error("Rescue proof forbids HTTP/model/provider calls");};
const start=Date.parse("2026-11-10T18:00:00Z"),client={}as SupabaseClient;
const enabledEnv=()=>({NBA_CRON_ENABLED:"true",NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED:"true",PLAYER_PROPS_AI_SITE_ENABLED:"true",PLAYER_PROPS_AI_PAID_RUNS_ENABLED:"true",PLAYER_PROPS_AI_OPENAI_API_KEY:"synthetic-ai-only",BALLDONTLIE_API_KEY:"synthetic-bdl-only",THE_ODDS_API_KEY:"synthetic-odds-only",OWLS_INSIGHT_API_KEY:"synthetic-owls-only"}as Record<string,string|undefined>);
const writerResult=(status:NbaPlayerPropsPrivateWriterResult["status"]="published_private"):NbaPlayerPropsPrivateWriterResult=>({release:"synthetic-writer-release" as NbaPlayerPropsPrivateWriterResult["release"],publicEnabled:false,status,providerRequests:3,theOddsApiCreditsUsed:1,observationsAdded:6,observationsRefreshed:4,observationConflictsPreserved:0,featureRows:5,decisions:4,locked:0,findings:[]});
const schedule:NbaRollingSchedule={release:"synthetic-schedule" as NbaRollingSchedule["release"],anchorDate:"2026-11-10",throughDate:"2026-11-16",games:[{id:"synthetic-game",externalId:1,slateDate:"2026-11-10",gameStartAt:"2026-11-10T23:00:00Z",status:"STATUS_SCHEDULED",awayTeam:"BOS",awayTeamDisplayName:"Synthetic away",awayTeamLogo:"",homeTeam:"NYK",homeTeamDisplayName:"Synthetic home",homeTeamLogo:"",venue:null}]};
function fixture(){
  let now=start+120000;
  const calls={due:[]as {sport:string;now:string}[],schedules:[]as string[],writers:[]as NbaPropsReviewRescueWriterArgs[],slates:[]as string[],seasons:[]as string[]};
  const env=enabledEnv(),args:NbaPropsReviewRescueArgs={client,writerRunId:"synthetic-shared-nba-lease-owner",requestStartedAt:start,clock:()=>now,env};
  const deps:NbaPropsReviewRescueDependencies={hasDue:async value=>{assert.equal(value.client,client);calls.due.push({sport:value.sport,now:value.now});return true;},loadSchedule:async slate=>{calls.schedules.push(slate);return schedule;},writeCandidate:async value=>{calls.writers.push(value);return writerResult();},slateDate:date=>{calls.slates.push(date.toISOString());return "2026-11-10";},providerSeason:date=>{calls.seasons.push(date.toISOString());return 2026;}};
  return{env,args,deps,calls,time:()=>now,setTime:(value:number)=>{now=value;}};
}
async function main(){
  assert.equal(NBA_PROPS_REVIEW_RESCUE_REQUEST_BUDGET_MS,480000);assert.equal(NBA_PROPS_REVIEW_RESCUE_MIN_REMAINING_MS,120000);
  for(const flag of ["NBA_CRON_ENABLED","NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED","PLAYER_PROPS_AI_SITE_ENABLED","PLAYER_PROPS_AI_PAID_RUNS_ENABLED"]){
    const f=fixture();f.env[flag]="false";const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.records_updated,0);assert.equal(result.api_calls_made,0);assert.equal(f.calls.due.length,0);assert.equal(f.calls.schedules.length,0);assert.equal(f.calls.writers.length,0);
  }
  for(const key of ["PLAYER_PROPS_AI_OPENAI_API_KEY","both-ai-key-options"]){const f=fixture();delete f.env.PLAYER_PROPS_AI_OPENAI_API_KEY;delete f.env.OPENAI_API_KEY;if(key==="both-ai-key-options")f.env.OPENAI_API_KEY=" ";const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.records_updated,0);assert.equal(f.calls.due.length,0);assert.equal(f.calls.schedules.length,0);assert.equal(f.calls.writers.length,0);}
  {
    // The route may have found work before lease wait; this post-lease read
    // observes that the ordinary writer has already consumed it.
    const f=fixture();let providerKeyReads=0;for(const key of ["BALLDONTLIE_API_KEY","THE_ODDS_API_KEY","OWLS_INSIGHT_API_KEY"])Object.defineProperty(f.env,key,{get:()=>{providerKeyReads++;return "must-not-read";}});
    f.deps.hasDue=async value=>{f.calls.due.push(value);return false;};const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.details?.reason,"no_due_pending_props_review");assert.equal(providerKeyReads,0);assert.equal(f.calls.schedules.length,0);assert.equal(f.calls.writers.length,0);assert.equal(f.calls.slates.length,0);
  }
  for(const now of [start+480000,start+360001,start-1]){const f=fixture();f.setTime(now);const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.details?.reason,"insufficient_absolute_request_window");assert.equal(f.calls.due.length,0);assert.equal(f.calls.schedules.length,0);assert.equal(f.calls.writers.length,0);}
  {
    const f=fixture();f.args.requestStartedAt=Number.NaN;const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.records_updated,0);assert.equal(f.calls.due.length,0);assert.equal(f.calls.writers.length,0);
  }
  {
    const f=fixture();f.args.writerRunId=" ";const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.details?.reason,"shared_nba_writer_run_required");assert.equal(f.calls.due.length,0);assert.equal(f.calls.writers.length,0);
  }
  {
    const f=fixture();delete f.env.BALLDONTLIE_API_KEY;const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.partial,true);assert.equal(result.details?.reason,"required_props_provider_key_missing");assert.equal(f.calls.due.length,1);assert.equal(f.calls.schedules.length,0);assert.equal(f.calls.writers.length,0);
  }
  {
    const f=fixture();f.deps.hasDue=async value=>{f.calls.due.push(value);f.setTime(start+360001);return true;};const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.details?.reason,"insufficient_absolute_request_window");assert.equal(f.calls.schedules.length,0);assert.equal(f.calls.writers.length,0);
  }
  {
    const f=fixture();f.deps.loadSchedule=async slate=>{f.calls.schedules.push(slate);f.setTime(start+360001);return schedule;};const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.details?.reason,"insufficient_absolute_request_window");assert.equal(f.calls.writers.length,0,"The helper must not reset the deadline after a slow cache read");
  }
  for(const phase of ["due","schedule","last-slate"]){
    const f=fixture();if(phase==="due")f.deps.hasDue=async value=>{f.calls.due.push(value);f.env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED="false";return true;};
    else if(phase==="schedule")f.deps.loadSchedule=async slate=>{f.calls.schedules.push(slate);f.env.NBA_PLAYER_PROPS_PRIVATE_WRITER_ENABLED="false";return schedule;};
    else f.deps.slateDate=date=>{f.calls.slates.push(date.toISOString());if(f.calls.slates.length===2)f.env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED="false";return "2026-11-10";};
    const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.records_updated,0);assert.equal(result.details?.status,"disabled");assert.equal(f.calls.writers.length,0);
  }
  {
    const f=fixture();f.deps.slateDate=date=>{f.calls.slates.push(date.toISOString());return f.calls.slates.length===1?"2026-11-10":"2026-11-11";};const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.details?.reason,"slate_changed_during_cached_read");assert.equal(f.calls.writers.length,0);
  }
  {
    const f=fixture();f.deps.hasDue=async value=>{f.calls.due.push(value);f.setTime(f.time()+1000);return true;};f.deps.loadSchedule=async slate=>{f.calls.schedules.push(slate);f.setTime(f.time()+2000);return schedule;};f.deps.slateDate=async date=>{f.calls.slates.push(date.toISOString());f.setTime(f.time()+1000);return "2026-11-10";};
    const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.records_updated,1);assert.equal(result.api_calls_made,3);assert.equal(f.calls.writers.length,1);assert.equal(f.calls.due.length,1);assert.equal(f.calls.schedules.length,1);
    const sent=f.calls.writers[0];assert.equal(sent.client,client);assert.equal(sent.writerRunId,f.args.writerRunId);assert.equal(sent.fullRefresh,false);assert.equal(sent.aiDeadline,start+480000);assert.equal(sent.now,new Date(f.time()).toISOString(),"Writer gets actual current clock after lease/cache work, not request start");assert.notEqual(sent.now,new Date(start).toISOString());assert.equal(sent.slateDate,"2026-11-10");assert.equal(sent.season,2026);assert.equal(sent.schedule,schedule.games);assert.equal(sent.ballDontLieApiKey,"synthetic-bdl-only");assert.equal(sent.owlsInsightApiKey,"synthetic-owls-only");assert.equal(sent.theOddsApiKey,"synthetic-odds-only");assert.equal(result.details?.review_completion,"verify_normal_slot_ledger_separately");assert(!JSON.stringify(result).includes("synthetic-ai-only"));assert(!JSON.stringify(result).includes("synthetic-bdl-only"));
  }
  {
    const f=fixture();delete f.env.OWLS_INSIGHT_API_KEY;delete f.env.THE_ODDS_API_KEY;await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(f.calls.writers.length,1);assert.equal(f.calls.writers[0].owlsInsightApiKey,null);assert.equal(f.calls.writers[0].theOddsApiKey,null,"Optional props sources retain the canonical writer contract");
  }
  {
    const f=fixture();f.setTime(start+360000);await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(f.calls.writers.length,1,"Exactly the declared minimum window is admitted");assert.equal(f.calls.writers[0].aiDeadline,start+480000);
  }
  for(const phase of ["due","schedule","writer"]){
    const f=fixture(),secret="sk-synthetic-do-not-log/private-player-export";if(phase==="due")f.deps.hasDue=async()=>{throw Error(secret);};else if(phase==="schedule")f.deps.loadSchedule=async()=>{throw Error(secret);};else f.deps.writeCandidate=async value=>{f.calls.writers.push(value);throw Error(secret);};
    const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.partial,true);assert.equal(result.records_updated,0);assert(!JSON.stringify(result).includes(secret));assert(!JSON.stringify(result).includes("last-known-good preserved"));assert.equal(f.calls.writers.length,phase==="writer"?1:0,"No alternate writer, retry or fake recovery is invoked after failure");
  }
  for(const status of ["bootstrap_required","last_known_good_preserved","no_games"]as const){const f=fixture();f.deps.writeCandidate=async value=>{f.calls.writers.push(value);return writerResult(status);};const result=await runNbaPropsReviewRescue(f.args,f.deps);assert.equal(result.partial,true);assert.equal(result.records_updated,0);assert.equal(result.details?.writer_status,status);assert.equal(f.calls.writers.length,1);}
  // Exercise the actual existing slate helper and shared provider-season helper,
  // with only due/schedule/writer services mocked. Keep the original UTC October
  // provider-year convention even while the Eastern slate is still September.
  for(const[iso,slate,season]of [["2026-09-30T23:58:00Z","2026-09-30",2025],["2026-10-01T00:02:00Z","2026-09-30",2026],["2027-01-01T03:58:00Z","2026-12-31",2026]]as const){
    const f=fixture(),at=Date.parse(iso);f.setTime(at);f.args.requestStartedAt=at-120000;
    const result=await runNbaPropsReviewRescue(f.args,{hasDue:f.deps.hasDue,loadSchedule:async day=>({...schedule,anchorDate:day,games:schedule.games.map(game=>({...game,slateDate:day}))}),writeCandidate:f.deps.writeCandidate});
    assert.equal(result.records_updated,1);assert.equal(f.calls.writers[0].slateDate,slate);assert.equal(f.calls.writers[0].season,season);assert.equal(f.calls.writers[0].aiDeadline,at+360000);
  }
  console.log("NBA due-review rescue controls passed: disabled/no-key/no-due/expired gates, post-lease due recheck, unchanged absolute request deadline, exact canonical writer/run ID/fullRefresh=false, fresh writer clock, optional provider contracts, switch/slate changes and sanitized failure/no alternate recovery. All dependencies mocked; actual writer preservation/admission remain separately verified. No HTTP or paid calls.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
