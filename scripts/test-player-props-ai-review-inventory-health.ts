/** Actual shared runtime/classifiers; all storage is in memory and every HTTP
 * boundary is blocked. Inventory skipped for time is unknown, never a known
 * failed review or proof that no slot was due. No collector integration claim. */
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {reviewPropsForSite} from '../lib/playerPropsAi/siteRuntime';
import {PROPS_AI_CONTROL_RELEASE} from '../lib/playerPropsAi/siteConfig';
import {PROPS_AI_CALENDAR_RELEASE,type PropsCalendar} from '../lib/playerPropsAi/calendar';
import {PRODUCT_RELEASE,type GamePacket,type Sport} from '../lib/playerPropsAi/evidenceContract';
import {summarizePropsAiRuntimeHealth,propsAiRuntimeFailure} from '../lib/playerPropsAi/runtimeHealth';
import {nbaPlayerPropsRefreshFailure,nflPlayerPropsRefreshFailure,mlbPlayerPropsRefreshFailure} from '../lib/cron/playerPropsRefreshTelemetry';

const at='2030-11-17T17:36:00.000Z',epoch=Date.parse(at);
const deferred='review_deferred_writer_inventory_deadline';
type Mode='deferred'|'known-empty'|'no-games'|'all-locked'|'next-day'|'paid-disabled'|'feature-disabled';
type QueryResult={data:unknown[];error:null};

async function exercise(sport:Sport,mode:Mode,remainingMs:number){
 process.env.PLAYER_PROPS_AI_SITE_ENABLED=mode==='feature-disabled'?'false':'true';
 process.env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED=mode==='paid-disabled'?'false':'true';
 const game={id:`synthetic-${sport}`,start:mode==='all-locked'?'2030-11-17T17:00:00.000Z':mode==='next-day'?'2030-11-18T19:00:00.000Z':'2030-11-17T19:00:00.000Z',away:'A',home:'B'};
 const lock=new Date(Date.parse(game.start)-3600000).toISOString();
 // Exact ordinary final lead: due17:35, lock18:00, now17:36. The deferred
 // runtime cannot know this fixture exists because it never reads inventory.
 const pending={job_key:`due-${sport}`,sport,game_id:`espn:${sport}:1`,state:'pending',stage:'final',due_at:new Date(Date.parse(lock)-25*60000).toISOString(),lock_at:lock,scheduled_start:game.start};
 const market=sport==='nba'?'points':sport==='nfl'?'receptions':'batter_hits';
 const packet:GamePacket={release:PRODUCT_RELEASE,sport,gameId:game.id,start:game.start,lock,cutoff:at,stage:'final',sourceOfferSetStatus:'nonempty',
  players:[{id:'synthetic-player',name:'Synthetic Actor',team:'A',opponent:'B',markets:[market],missing:[],evidence:[4,6,8].map((value,i)=>{
   const box:Record<string,number>=sport==='nba'?{points:value,minutes:30}:sport==='nfl'?{receptions:value,receiving_yards:value*10}:{batter_hits:value/2};
   return{id:`log-${i}`,kind:'recent_games' as const,source:'synthetic played log',availableAt:at,value:{game:{startTime:'2030-11-10T20:00:00Z',awayTeam:'A',homeTeam:'B'},box}};
  })}],
  quotes:(['over','under'] as const).map(side=>({id:`q-${side}`,playerId:'synthetic-player',market,provider:'synthetic',book:'book',line:3.5,side,american:-110,observedAt:at,receivedAt:at,live:false})),sourceLimitations:[]};
 const native={projection:6.123456789,probability:.61723891,grade:'Lean',price:-117,stake:0,evidence:{original:'native source evidence'}};
 const locked={...native,lockedAt:'2030-11-17T16:00:00Z',evidence:{original:'opaque immutable legacy lock'}};
 const before=JSON.stringify({packet,native,locked,pending});
 const calendar:PropsCalendar={release:PROPS_AI_CALENDAR_RELEASE,month:'2030-11',capturedAt:at,
  games:[{sport,id:pending.game_id,start:game.start,lock,away:game.away,home:game.home,confirmed:true}],
  sources:{nba:{complete:true,source:'synthetic complete NBA calendar'},nfl:{complete:true,source:'synthetic complete NFL calendar'},mlb:{complete:true,source:'synthetic complete MLB calendar'}}};
 let controlReads=0,acceptedReads=0,calendarReads=0,pendingReads=0,sourceLoads=0,sourceReady=0,observed=0,ready=0,http=0;
 const rpcs:string[]=[];
 const client={from(table:string){
  assert(['player_props_ai_control','player_props_ai_reviews','player_props_ai_calendars'].includes(table),`Unexpected storage read ${table}`);
  let isPending=false,selection='',bound=0;
  const query={select(value:string){selection=value;return this;},eq(key:string,value:unknown){if(key==='state'&&value==='pending')isPending=true;return this;},gte(){return this;},order(){return this;},limit(value:number){bound=value;return this;},in(){return this;},
   single:async()=>{assert.equal(table,'player_props_ai_control');controlReads++;return{data:{paid_enabled:true,release:PROPS_AI_CONTROL_RELEASE},error:null};},
   maybeSingle:async()=>{assert.equal(mode,'known-empty');assert.equal(table,'player_props_ai_calendars');calendarReads++;return{data:{payload:calendar,captured_at:at,release:PROPS_AI_CALENDAR_RELEASE},error:null};},
   then<TResult1=QueryResult,TResult2=never>(resolve?:((value:QueryResult)=>TResult1|PromiseLike<TResult1>)|null,reject?:((reason:unknown)=>TResult2|PromiseLike<TResult2>)|null){
    assert.equal(table,'player_props_ai_reviews');
    if(isPending){pendingReads++;assert.equal(selection,'*');assert.equal(bound,3,'Two logical slots plus one overflow sentinel');}
    else{acceptedReads++;assert.equal(selection,'result');}
    return Promise.resolve({data:isPending&&mode!=='known-empty'?[pending]:[],error:null} as QueryResult).then(resolve,reject);
   }};return query;
 },async rpc(name:string){
  assert.equal(mode,'known-empty','Skipped inventory cannot plan, reap, claim, send or finish');rpcs.push(name);
  if(name==='player_props_ai_plan_v4')return{data:{funded:true,budget:{}},error:null};
  if(name==='player_props_ai_reap')return{data:0,error:null};
  throw Error(`Forbidden RPC ${name}`);
 }} as unknown as SupabaseClient;
 const outcome=await reviewPropsForSite({client,sport,writerRunId:'synthetic-only',deadline:epoch+remainingMs,games:mode==='no-games'?[]:[game],clock:()=>at,
  fetchImpl:async()=>{http++;throw Error('Inventory health controls forbid all calendar/provider/count/model HTTP');},
  load:(_game,window)=>{sourceLoads++;assert.equal(window.lock,lock);assert.equal(window.cutoff,at);return packet;},
  onSourceReady:()=>{sourceReady++;assert.equal(JSON.stringify({packet,native,locked,pending}),before);},
  onReviewObserved:()=>{observed++;},onReviewReady:()=>{ready++;throw Error('No accepted/generated review can invoke ready');}});
 assert.equal(JSON.stringify({packet,native,locked,pending}),before,'Source, native forecast, original lock and slot bytes stay unchanged');
 assert.equal(http,0);assert.equal(ready,0);assert.equal(outcome.newlyCompletedReviews??0,0);
 const eligible=mode==='deferred'||mode==='known-empty'||mode==='paid-disabled';
 assert.equal(sourceLoads,eligible?2:0,'Existing lock-source/member-source reads only');assert.equal(sourceReady,eligible?1:0);assert.equal(observed,eligible?1:0);
 assert.equal(controlReads,mode==='feature-disabled'?0:1);assert.equal(acceptedReads,mode==='feature-disabled'?0:2);
 assert.equal(calendarReads,mode==='known-empty'?1:0);assert.equal(pendingReads,mode==='known-empty'?1:0);
 assert.deepEqual(rpcs,mode==='known-empty'?['player_props_ai_plan_v4','player_props_ai_reap']:[]);
 assert.equal(outcome.status,mode==='feature-disabled'?'disabled':mode==='paid-disabled'?'paid_disabled':'active');
 assert.deepEqual(outcome.findings,mode==='deferred'?[deferred]:[],'Only unknown inventory deferment; never an invented failed review');
 const health=summarizePropsAiRuntimeHealth(outcome,at),result={aiReviewRuntime:health};
 assert.equal(propsAiRuntimeFailure(health),mode==='deferred'?'incomplete':null);
 const classifications=[nbaPlayerPropsRefreshFailure({status:'published_private',aiReviewRuntime:health}),nflPlayerPropsRefreshFailure(result),mlbPlayerPropsRefreshFailure(result)];
 for(const classification of classifications){if(mode==='deferred')assert.match(classification!,/scheduled.*coverage unverified/);else assert.equal(classification,null);}
 return{sport,mode,remainingMs,inventory:mode==='known-empty'?'read-empty':'not-read',newlyCompletedReviews:health.newlyCompletedReviews};
}

async function main(){
 const names=['PLAYER_PROPS_AI_SITE_ENABLED','PLAYER_PROPS_AI_PAID_RUNS_ENABLED','PLAYER_PROPS_AI_OPENAI_API_KEY'] as const;
 const prior=Object.fromEntries(names.map(name=>[name,process.env[name]])),originalNow=Date.now,originalFetch=globalThis.fetch;
 Date.now=()=>epoch;globalThis.fetch=async()=>{throw Error('Inventory health controls forbid real HTTP');};process.env.PLAYER_PROPS_AI_OPENAI_API_KEY='synthetic-never-real';
 try{
  const proofs=[];
  for(const sport of ['nba','nfl','mlb'] as const){
   for(const remaining of [39000,0,-1000])proofs.push(await exercise(sport,'deferred',remaining));
   proofs.push(await exercise(sport,'known-empty',480000));
   for(const mode of ['no-games','all-locked','next-day','paid-disabled','feature-disabled'] as const)proofs.push(await exercise(sport,mode,39000));
  }
  assert.equal(proofs.length,27);
  console.log('Review inventory health passed: nine short/zero/expired actual-runtime cases classify unknown inventory as coverage unverified across all three helpers; actual known-empty reads and all-sport no-game/locked/next-day/disabled controls stay healthy; unchanged source/native/locked bytes and zero HTTP/count/generation/claims.');
 }finally{Date.now=originalNow;globalThis.fetch=originalFetch;for(const name of names){if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];}}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
