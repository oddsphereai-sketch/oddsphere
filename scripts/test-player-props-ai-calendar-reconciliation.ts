/** Source chronology and bounded official reconciliation. All HTTP/DB is mocked. */
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {capturePropsCalendar,loadPropsCalendar,reconcilePropsCalendarDay,PROPS_AI_CALENDAR_RELEASE,PROPS_AI_CALENDAR_CAPTURE_RELEASE,PROPS_AI_CALENDAR_DAY_RELEASE,PROPS_AI_CALENDAR_DAY_REQUEST_MAXIMUM,type PropsCalendar} from '../lib/playerPropsAi/calendar';
globalThis.fetch=async()=>{throw Error('Real networking forbidden');};
const initial='2030-11-17T17:00:00Z',baseAt='2030-11-17T10:00:00Z',start='2030-11-17T21:00:00Z';
const native={id:'native',start,away:'BUF',home:'MIN'};
const fixture=(at:string,confirmed=true)=>({sport:'nfl' as const,id:'espn:nfl:1',start:at,lock:new Date(Date.parse(at)-3600000).toISOString(),away:'BUF',home:'MIN',confirmed});
const base=():PropsCalendar=>({release:PROPS_AI_CALENDAR_RELEASE,month:'2030-11',capturedAt:baseAt,games:[fixture('2030-11-17T20:00:00Z')],sources:{nba:{complete:true,source:'synthetic complete'},nfl:{complete:true,source:'synthetic complete'},mlb:{complete:true,source:'synthetic none'}}});
function official(at=start,home='MIN',timeValid=true){return{events:[{id:'1',date:at,competitions:[{timeValid,competitors:[{homeAway:'away',team:{abbreviation:'BUF'}},{homeAway:'home',team:{abbreviation:home}}]}]}]};}
async function exercise(mode:'shift'|'tbd'|'matching'|'wrong_team'|'duplicate'|'failed'|'deadline'|'future_clock'){
 let now=Date.parse(initial),requests=0,rpcs=0;const calendar=base();if(mode==='matching')calendar.games=[fixture(start)];if(mode==='tbd')calendar.games=[fixture('2030-11-17T20:00:00Z',false)];const protectedBase=JSON.stringify(calendar);
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{rpcs++;assert.equal(name,'player_props_ai_merge_calendar_day_v1');assert.equal(args.p_writer_run,'same-owner');assert.equal(args.p_full_capture_at,baseAt);const update=args.p_update as {fixtures:PropsCalendar['games'];availableAt:string;release:string;source:string;requestedAt:string};assert.equal(update.release,PROPS_AI_CALENDAR_DAY_RELEASE);assert.equal(Date.parse(update.requestedAt),Date.parse(initial));assert.equal(update.availableAt,new Date(now).toISOString());const merged={...calendar,revision:'synthetic-current',games:update.fixtures,dayUpdates:{'nfl|2030-11-17':update}};return{data:{status:'merged',calendar:merged},error:null};}} as unknown as SupabaseClient;
 const fetchImpl:typeof fetch=async url=>{requests++;assert.equal(String(url),'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20301117&limit=100');if(mode==='failed')throw Error('Synthetic unavailable');now+=mode==='future_clock'?-1000:2000;const body=official(start,mode==='wrong_team'?'NYJ':'MIN');if(mode==='duplicate')body.events.push(body.events[0]);return Response.json(body);};
 const result=await reconcilePropsCalendarDay({client,calendar,sport:'nfl',games:[native],writerRunId:'same-owner',now:initial,clock:()=>new Date(now).toISOString(),fetchImpl,deadline:Date.now()+(mode==='deadline'?100000:480000)});
 assert.equal(JSON.stringify(calendar),protectedBase,'Do not mutate the original cached source');assert(requests<=PROPS_AI_CALENDAR_DAY_REQUEST_MAXIMUM);
 if(mode==='matching'||mode==='deadline'){assert.equal(requests,0);assert.equal(rpcs,0);assert.strictEqual(result.calendar,calendar);}
 else if(mode==='shift'||mode==='tbd'){assert.equal(requests,1);assert.equal(rpcs,1);assert.equal(Date.parse(result.calendar.games[0].start),Date.parse(start));assert.equal(result.calendar.capturedAt,baseAt,'The full monthly TTL is unchanged');assert.equal(result.calendar.dayUpdates!['nfl|2030-11-17'].availableAt,'2030-11-17T17:00:02.000Z');assert.deepEqual(result.findings,[]);}
 else{assert.equal(requests,1);assert.equal(rpcs,0);assert.strictEqual(result.calendar,calendar);assert(result.findings.includes('calendar_official_day_reconciliation_unavailable'));}
}
async function main(){
 for(const mode of ['shift','tbd','matching','wrong_team','duplicate','failed','deadline','future_clock'] as const)await exercise(mode);
 let now=Date.parse(initial),calls=0;const clock=()=>new Date(now).toISOString(),free:typeof fetch=async url=>{assert(String(url).startsWith('https://site.api.espn.com/'));calls++;now+=1000;return Response.json({events:[]});};
 const captured=await capturePropsCalendar('2030-11',initial,free,Date.now()+480000,clock);assert(calls>=90&&calls<=102);assert.equal(captured.capturedAt,clock());assert(Date.parse(captured.capturedAt)>Date.parse(initial));assert.equal(captured.captureRelease,PROPS_AI_CALENDAR_CAPTURE_RELEASE);assert.equal(captured.captureClockMeaning,'response_completion');
 const legacy=base();let reads=0,writes=0;
 const cachedClient={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>{reads++;return{data:{release:legacy.release,captured_at:legacy.capturedAt,payload:legacy},error:null};}}),rpc:async()=>{writes++;throw Error('Fresh legacy cache must not be rewritten');}} as unknown as SupabaseClient;
 const before=calls;assert.strictEqual(await loadPropsCalendar(cachedClient,'2030-11',initial,free,Date.now()+480000,clock),legacy);assert.equal(reads,1);assert.equal(writes,0);assert.equal(calls,before,'A compatible R1 cache must not trigger a whole-month deploy refetch');
 console.log('Calendar reconciliation passed: one official mismatch-only request, exact team/clock/TBD checks, honest completion receipts, unchanged month TTL, failed-source isolation and R1 compatibility. Mocked HTTP/DB only; no paid calls.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
