/** Free public schedule only. Never queries a paid odds/stat provider. */
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Sport} from "./evidenceContract";
import type {ScheduledPropsGame} from "./schedule";
import {makePropsWalletPlan,type RequestBound,type CalendarSources} from "./walletPlan";
import {instant,invariant,etDate} from "./evidence";
import {propsTeam,type LivePropsGame} from "./liveSources";
import {NBA_PLAYER_PROPS_LOCK_LEAD_MINUTES} from "../services/nba/nbaPlayerPropsLifecycle";
import {MLB_PROPS_GAME_LOCK_MINUTES} from "../mlb/props/lockPolicy";

export const PROPS_AI_CALENDAR_RELEASE="player_props_ai_calendar_2026_11_07_r1_complete_month";
export type CalendarGame=ScheduledPropsGame & {away:string;home:string;confirmed:boolean};
export type PropsCalendar={release:string;month:string;capturedAt:string;games:CalendarGame[];sources:CalendarSources};
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
export async function capturePropsCalendar(month:string,now:string,fetchImpl:typeof fetch=fetch,deadline=Date.now()+180000):Promise<PropsCalendar>{
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
  return {release:PROPS_AI_CALENDAR_RELEASE,month,capturedAt:now,games:[...games.values()],sources:Object.fromEntries((["nba","nfl","mlb"] as const).map(sport=>[sport,{complete:true,source:`ESPN ${sport} complete daily scoreboards including adjacent ET dates; captured ${now}`}])) as CalendarSources};
}
export async function loadPropsCalendar(client:SupabaseClient,month:string,now:string,fetchImpl?:typeof fetch,deadline?:number){
  const cached=await client.from("player_props_ai_calendars").select("payload,captured_at,release").eq("month_key",month).maybeSingle();
  if(cached.error)throw new Error(`Props calendar cache:${cached.error.code}`);
  if(cached.data?.release===PROPS_AI_CALENDAR_RELEASE&&instant(now)-instant(cached.data.captured_at)<24*3600000&&instant(cached.data.captured_at)<=instant(now))return cached.data.payload as PropsCalendar;
  const calendar=await capturePropsCalendar(month,now,fetchImpl,deadline);
  const saved=await client.from("player_props_ai_calendars").upsert({month_key:month,release:calendar.release,captured_at:now,payload:calendar});
  if(saved.error)throw new Error(`Props calendar save:${saved.error.code}`);return calendar;
}
export function matchPropsCalendarGame(calendar:PropsCalendar,sport:Sport,native:LivePropsGame){
  const matches=calendar.games.filter(g=>g.confirmed&&g.sport===sport&&instant(g.start)===instant(native.start)&&g.away===propsTeam(native.away)&&g.home===propsTeam(native.home));
  invariant(matches.length===1,"Native game must match exactly one funded monthly fixture");return matches[0];
}
export function calendarWalletPlan(calendar:PropsCalendar,now:string){
  return makePropsWalletPlan({month:calendar.month,now,games:calendar.games,bounds:Object.fromEntries(calendar.games.map(g=>[`${g.sport}|${g.id}`,DEFAULT_PROPS_SOURCE_BOUNDS[g.sport]])),sources:calendar.sources});
}
