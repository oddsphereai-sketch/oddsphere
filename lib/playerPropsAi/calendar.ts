/** Free public schedule only. Never queries a paid odds/stat provider. */
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Sport} from "./evidenceContract";
import type {ScheduledPropsGame} from "./schedule";
import {makePropsWalletPlan,type RequestBound,type CalendarSources} from "./walletPlan";
import {instant,invariant,etDate,digest} from "./evidence";
import {propsTeam,type LivePropsGame} from "./liveSources";
import {NBA_PLAYER_PROPS_LOCK_LEAD_MINUTES} from "../services/nba/nbaPlayerPropsLifecycle";
import {MLB_PROPS_GAME_LOCK_MINUTES} from "../mlb/props/lockPolicy";
import {randomUUID} from "node:crypto";

// Outer R1 remains compatible with in-flight previous readers. New chronology
// is explicit sub-release metadata; no old capture clock is reinterpreted.
export const PROPS_AI_CALENDAR_RELEASE="player_props_ai_calendar_2026_11_07_r1_complete_month";
export const PROPS_AI_CALENDAR_CAPTURE_RELEASE="player_props_ai_calendar_capture_2026_11_10_r2_response_completion";
export const PROPS_AI_CALENDAR_DAY_RELEASE="player_props_ai_calendar_day_2026_11_10_r1_bounded_official_reconciliation";
export const PROPS_AI_CALENDAR_DAY_REQUEST_MAXIMUM=1;
export type CalendarGame=ScheduledPropsGame & {away:string;home:string;confirmed:boolean};
export type PropsCalendar={release:string;month:string;capturedAt:string;games:CalendarGame[];sources:CalendarSources;
  revision?:string;captureRelease?:typeof PROPS_AI_CALENDAR_CAPTURE_RELEASE;
  captureClockMeaning?:"response_completion"|"legacy_recorded_clock";
  dayUpdates?:Record<string,{release:typeof PROPS_AI_CALENDAR_DAY_RELEASE;requestedAt:string;availableAt:string;source:string;fixtureHash:string;fixtureIds:string[]}>};
const paths={nba:"basketball/nba",nfl:"football/nfl",mlb:"baseball/mlb"};
/** Cost envelopes are configurable ceilings, not truncated evidence. Actual larger packets need new full-month funding. */
export const DEFAULT_PROPS_SOURCE_BOUNDS:Record<Sport,RequestBound[]>={
  nba:Array.from({length:3},()=>({input_tokens:70000,max_output_tokens:7000})),
  nfl:Array.from({length:8},()=>({input_tokens:60000,max_output_tokens:7000})),
  mlb:Array.from({length:3},()=>({input_tokens:75000,max_output_tokens:7000})),
};
function record(v:unknown):Record<string,unknown>{return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};}
export function parseCalendarDay(sport:Sport,body:unknown):CalendarGame[]{
  const b=record(body);invariant(Array.isArray(b.events),"Calendar source omitted events array");
  invariant(b.events.length<100,"Calendar source may be truncated");
  return b.events.flatMap(event=>{
    const e=record(event),competitions=e.competitions;invariant(Array.isArray(competitions)&&competitions.length===1,"Ambiguous calendar competition");
    const c=record(competitions[0]),competitors=c.competitors;
    const status=String(record(record(e.status).type).name??record(record(c.status).type).name??"");
    if(["STATUS_CANCELED","STATUS_POSTPONED"].includes(status))return [];invariant(Array.isArray(competitors)&&competitors.length===2,"Incomplete monthly fixture teams");
    const team=(side:string)=>record(record(competitors.find(p=>record(p).homeAway===side)).team).abbreviation;
    const away=team("away"),home=team("home"),start=e.date,id=e.id;
    invariant(typeof id==="string"&&typeof start==="string"&&Number.isFinite(Date.parse(start))&&typeof away==="string"&&typeof home==="string","Incomplete calendar fixture identity");
    // A TBD clock is not a scheduled review. Refuse full-calendar funding until it is resolved.
    const confirmed=c.timeValid!==false&&e.timeValid!==false;
    // A clearly marked, non-executable accounting placeholder reserves both reviews for TBD fixtures.
    // It is never fed to the reader, matched to a native game, or treated as an actual start.
    const fundedStart=confirmed?new Date(start).toISOString():`${etDate(start)}T20:00:00.000Z`;
    const lead=sport==="nba"?NBA_PLAYER_PROPS_LOCK_LEAD_MINUTES:sport==="mlb"?MLB_PROPS_GAME_LOCK_MINUTES:60;
    return [{sport,id:`espn:${sport}:${id}`,confirmed,start:fundedStart,lock:new Date(instant(fundedStart)-lead*60000).toISOString(),away:propsTeam(away),home:propsTeam(home)}];
  });
}
export async function capturePropsCalendar(month:string,now:string,fetchImpl:typeof fetch=fetch,deadline=Date.now()+180000,clock:()=>string=()=>new Date().toISOString()):Promise<PropsCalendar>{
  invariant(/^\d{4}-(0[1-9]|1[0-2])$/.test(month),"Invalid calendar month");
  // Include adjacent ET dates because wallet billing is UTC; late games may straddle months.
  const from=Date.parse(`${month}-01T00:00:00Z`)-86400000,to=Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),2);
  const tasks=(["nba","nfl","mlb"] as const).flatMap(sport=>Array.from({length:Math.ceil((to-from)/86400000)},(_,i)=>({sport,date:new Date(from+i*86400000).toISOString().slice(0,10).replace(/-/g,"")})));
  const games=new Map<string,CalendarGame>();
  for(let i=0;i<tasks.length;i+=6)await Promise.all(tasks.slice(i,i+6).map(async({sport,date})=>{
    const timeout=Math.min(12000,deadline-Date.now()-15000);invariant(timeout>1000,"Calendar capture deferred for writer deadline");
    const response=await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/${paths[sport]}/scoreboard?dates=${date}&limit=100`,{signal:AbortSignal.timeout(timeout),cache:"no-store"});
    invariant(response.ok,"Complete free monthly calendar unavailable");
    for(const game of parseCalendarDay(sport,await response.json())){const old=games.get(game.id);invariant(!old||old.start===game.start&&old.home===game.home&&old.away===game.away,"Conflicting monthly fixture");games.set(game.id,game);}
  }));
  const completedAt=clock();invariant(instant(completedAt)>=instant(now),"Calendar completion clock precedes request");
  const revision=randomUUID(),sources=Object.fromEntries((["nba","nfl","mlb"] as const).map(sport=>[sport,{complete:true,source:`ESPN ${sport} complete daily scoreboards including adjacent ET dates; completed ${completedAt}`}])) as CalendarSources;
  Object.assign(sources,{_calendar_revision:{revision,fullCapturedAt:completedAt}});
  return {release:PROPS_AI_CALENDAR_RELEASE,revision,captureRelease:PROPS_AI_CALENDAR_CAPTURE_RELEASE,month,capturedAt:completedAt,captureClockMeaning:"response_completion",games:[...games.values()],sources};
}
export async function loadPropsCalendar(client:SupabaseClient,month:string,now:string,fetchImpl?:typeof fetch,deadline?:number,clock?:()=>string){
  const cached=await client.from("player_props_ai_calendars").select("payload,captured_at,release").eq("month_key",month).maybeSingle();
  if(cached.error)throw new Error(`Props calendar cache:${cached.error.code}`);
  if(cached.data?.release===PROPS_AI_CALENDAR_RELEASE&&instant(now)-instant(cached.data.captured_at)<24*3600000&&instant(cached.data.captured_at)<=instant(now)){
    const payload=cached.data.payload as PropsCalendar;
    invariant(payload.month===month&&payload.release===cached.data.release&&instant(payload.capturedAt)===instant(cached.data.captured_at),"Calendar cache header mismatch");return payload;
  }
  const calendar=await capturePropsCalendar(month,now,fetchImpl,deadline,clock);
  const saved=await client.rpc("player_props_ai_store_calendar_v1",{p_month:month,p_expected_capture_at:cached.data?.captured_at??null,p_expected_revision:(cached.data?.payload as PropsCalendar|null)?.revision??null,p_calendar:calendar});
  if(saved.error)throw new Error(`Props calendar save:${saved.error.code}`);
  const result=saved.data as {status:string;calendar:PropsCalendar};
  invariant(result?.calendar?.month===month&&instant(result.calendar.capturedAt)<=instant((clock??(()=>new Date().toISOString()))()),"Calendar saved header unavailable");
  invariant(instant((clock??(()=>new Date().toISOString()))())-instant(result.calendar.capturedAt)<24*3600000,"Concurrent calendar change requires a fresh monthly capture");return result.calendar;
}
/** One free official day request only when current native fixtures cannot match.
 * A partial day response never deletes another fixture or renews the month TTL.
 * Native clocks select candidates; only exact official identity authorizes them.
 */
export async function reconcilePropsCalendarDay(args:{client:SupabaseClient;calendar:PropsCalendar;sport:Sport;games:readonly LivePropsGame[];writerRunId:string;now:string;clock?:()=>string;fetchImpl?:typeof fetch;deadline:number}):Promise<{calendar:PropsCalendar;findings:string[];requests:number}>{
  const findings:string[]=[],clock=args.clock??(()=>new Date().toISOString());
  const unmatched=args.games.filter(game=>{try{matchPropsCalendarGame(args.calendar,args.sport,game);return false;}catch{return true;}});
  if(!unmatched.length)return{calendar:args.calendar,findings,requests:0};
  const day=etDate(args.now);
  if(unmatched.some(game=>etDate(game.start)!==day))return{calendar:args.calendar,findings:["calendar_reconciliation_requires_current_day"],requests:0};
  const timeout=Math.min(12000,args.deadline-Date.now()-220000);
  if(timeout<=1000)return{calendar:args.calendar,findings:["calendar_reconciliation_deferred_deadline"],requests:0};
  const requestedAt=clock(),source=`https://site.api.espn.com/apis/site/v2/sports/${paths[args.sport]}/scoreboard?dates=${day.replace(/-/g,"")}&limit=100`;
  try{
    const response=await(args.fetchImpl??fetch)(source,{signal:AbortSignal.timeout(timeout),cache:"no-store"});
    invariant(response.ok,"Official current-day calendar unavailable");
    const fresh=parseCalendarDay(args.sport,await response.json()),availableAt=clock();
    invariant(instant(availableAt)>=instant(requestedAt)&&instant(requestedAt)>=instant(args.now),"Invalid calendar day receipt chronology");
    const identifiers=new Set<string>();for(const game of fresh){invariant(!identifiers.has(game.id),"Duplicate official day fixture");identifiers.add(game.id);}
    const prior=new Map(args.calendar.games.map(game=>[`${game.sport}|${game.id}`,game]));
    for(const game of fresh){const old=prior.get(`${game.sport}|${game.id}`);invariant(!old||old.home===game.home&&old.away===game.away,"Official calendar fixture changed teams");}
    // Existing same-ID fixtures can safely move dates. New fixtures require the
    // complete exact native matchup/start; absence or a fuzzy matchup is no proof.
    const admissible=fresh.filter(game=>prior.has(`${game.sport}|${game.id}`)||unmatched.some(native=>game.confirmed&&instant(game.start)===instant(native.start)&&game.home===propsTeam(native.home)&&game.away===propsTeam(native.away)));
    const update={release:PROPS_AI_CALENDAR_DAY_RELEASE,requestedAt,availableAt,source,fixtureHash:digest(fresh),fixtureIds:fresh.map(game=>game.id).sort(),fixtures:admissible};
    const saved=await args.client.rpc("player_props_ai_merge_calendar_day_v1",{p_month:args.calendar.month,p_writer_run:args.writerRunId,p_sport:args.sport,p_day:day,p_full_capture_at:args.calendar.capturedAt,p_update:update});
    invariant(!saved.error,"Official day calendar save unavailable");const result=saved.data as {status:string;calendar?:PropsCalendar};
    invariant(["merged","superseded"].includes(result?.status)&&result.calendar,"Official day calendar merge unavailable");const calendar=result.calendar;
    invariant(calendar.month===args.calendar.month&&instant(calendar.capturedAt)>=instant(args.calendar.capturedAt),"Calendar merge changed original full capture chronology");
    return{calendar,findings:unmatched.flatMap(native=>{try{matchPropsCalendarGame(calendar,args.sport,native);return[];}catch{return[`calendar_identity_unavailable_after_official_refresh:${native.id}`];}}),requests:1};
  }catch{return{calendar:args.calendar,findings:["calendar_official_day_reconciliation_unavailable"],requests:1};}
}
export function matchPropsCalendarGame(calendar:PropsCalendar,sport:Sport,native:LivePropsGame){
  const matches=calendar.games.filter(g=>g.confirmed&&g.sport===sport&&instant(g.start)===instant(native.start)&&g.away===propsTeam(native.away)&&g.home===propsTeam(native.home));
  invariant(matches.length===1,"Native game must match exactly one funded monthly fixture");return matches[0];
}
export function calendarWalletPlan(calendar:PropsCalendar,now:string){
  return makePropsWalletPlan({month:calendar.month,now,games:calendar.games,bounds:Object.fromEntries(calendar.games.map(g=>[`${g.sport}|${g.id}`,DEFAULT_PROPS_SOURCE_BOUNDS[g.sport]])),sources:calendar.sources});
}
