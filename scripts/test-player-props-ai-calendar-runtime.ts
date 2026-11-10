import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {reviewPropsForSite} from '../lib/playerPropsAi/siteRuntime';
import {PROPS_AI_CONTROL_RELEASE} from '../lib/playerPropsAi/siteConfig';
import {PROPS_AI_CALENDAR_RELEASE,type PropsCalendar} from '../lib/playerPropsAi/calendar';
import {PRODUCT_RELEASE,type GamePacket} from '../lib/playerPropsAi/evidenceContract';
import {readerEvidence,READER_AREAS} from '../lib/playerPropsAi/readerCoverage';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
/** Actual site runtime through official calendar repair, count, review and finish; all I/O mocked. */
globalThis.fetch=async()=>{throw Error('All real network is forbidden');};
const now='2030-11-17T17:40:00Z',currentStart='2030-11-17T19:00:00Z',currentLock='2030-11-17T18:00:00Z';
const packet:GamePacket={release:PRODUCT_RELEASE,sport:'nfl',gameId:'native',start:currentStart,lock:currentLock,cutoff:now,stage:'final',quotes:[],sourceLimitations:[],players:[{id:'p1',name:'Synthetic Receiver',team:'BUF',opponent:'MIN',markets:['receptions'],missing:[],evidence:[4,6,8].map((receptions,j)=>({id:`log-${j}`,kind:'recent_games',source:'synthetic played game',availableAt:'2030-11-17T10:00:00Z',value:{game:{startTime:`2030-11-${14+j}T18:00:00Z`,homeTeam:'BUF',awayTeam:'MIN'},box:{receptions,receiving_yards:receptions*10}}}))}]};
async function run(stale:boolean){
 let dueReads=0,counts=0,generations=0,calendarFetches=0;let completed:AcceptedGameReview|null=null,job:Record<string,unknown>|null=null;
 const calendar:PropsCalendar={release:PROPS_AI_CALENDAR_RELEASE,month:'2030-11',capturedAt:'2030-11-17T10:00:00Z',games:[{sport:'nfl',id:'espn:nfl:1',away:'BUF',home:'MIN',confirmed:true,start:stale?'2030-11-17T18:00:00Z':currentStart,lock:stale?'2030-11-17T17:00:00Z':currentLock}],sources:{nba:{complete:true,source:'synthetic none'},nfl:{complete:true,source:'synthetic complete'},mlb:{complete:true,source:'synthetic none'}}};
 const client={from(table:string){let selection='';const q={select(s:string){selection=s;return q;},eq(){return q;},gte(){return q;},in(){return q;},lte(){return q;},gt(){return q;},order(){return q;},limit(){return q;},single:async()=>({data:{release:PROPS_AI_CONTROL_RELEASE,paid_enabled:true},error:null}),maybeSingle:async()=>({data:{release:PROPS_AI_CALENDAR_RELEASE,captured_at:calendar.capturedAt,payload:calendar},error:null}),then(resolve:(r:unknown)=>unknown,reject:(e:unknown)=>unknown){assert.equal(table,'player_props_ai_reviews');if(selection==='*')dueReads++;return Promise.resolve({data:selection==='*'?[job]:completed?[{result:completed}]:[],error:null}).then(resolve,reject);}};return q;},rpc:async(name:string,args:Record<string,unknown>={})=>{
  if(name==='player_props_ai_merge_calendar_day_v1'){const update=args.p_update as {fixtures:PropsCalendar['games']};assert.equal(args.p_writer_run,'synthetic-owner');return{data:{status:'merged',calendar:{...calendar,games:update.fixtures,revision:'synthetic-revision'}},error:null};}
  if(name==='player_props_ai_plan_v4'){const jobs=args.p_jobs as Record<string,unknown>[];const j=jobs.find(j=>j.stage==='final')!;job={job_key:j.key,sport:'nfl',game_id:j.gameId,game_day:j.gameDay,stage:'final',scheduled_start:j.start,lock_at:j.lock,due_at:j.dueAt,state:'pending',model:'gpt-6-luna',requested_tier:'default'};return{data:{funded:true},error:null};}
  if(name==='player_props_ai_reap')return{data:0,error:null};
  if(name==='player_props_ai_claim')return{data:{claimed:true,token:'synthetic',job:{...job,parts:1}},error:null};
  if(name==='player_props_ai_send')return{data:{id:'synthetic',model:'gpt-6-luna',requested_tier:'default'},error:null};
  if(name==='player_props_ai_receipt')return{data:null,error:null};
  if(name==='player_props_ai_finish'){assert(args.p_result,'Healthy source should complete');completed={...(args.p_result as AcceptedGameReview),issuedAt:now,inputHash:String(args.p_hash??(args.p_result as AcceptedGameReview).inputEvidence.digest)};return{data:{state:'completed',result:completed},error:null};}
  throw Error('Unexpected RPC '+name);
 }} as unknown as SupabaseClient;
 const fetchImpl:typeof fetch=async(url)=>{
  if(String(url).includes('espn.com')){calendarFetches++;assert(String(url).endsWith('dates=20301117&limit=100'));return Response.json({events:[{id:'1',date:currentStart,competitions:[{competitors:[{homeAway:'away',team:{abbreviation:'BUF'}},{homeAway:'home',team:{abbreviation:'MIN'}}]}]}]});}
  if(String(url).endsWith('/input_tokens')){counts++;return Response.json({input_tokens:1000});}
  assert.equal(String(url),'https://api.openai.com/v1/responses');generations++;
  const facts=readerEvidence(packet),alias=[...evidenceAliases(packet)].find(([,id])=>id==='log-0')![0],p=packet.players[0];
  const wire={wireRelease:PROPS_AI_WIRE_RELEASE,players:{p1:verifiedReaderFixture(packet,p.id,{assessment:'The supplied evidence supports a conditional forecast.',priorRead:{},coverage:Object.fromEntries(READER_AREAS.map(area=>[area,{status:facts.p1[area].status,factIds:facts.p1[area].facts.slice(0,1).map(f=>f.id),effect:'uncertain',observation:'The supplied context requires appropriate caution.'}])),evidenceIds:[alias],gaps:[],confidence:[2],exceptions:[null],law:encodeCanonicalScenarioLaw('nfl',p,{weights:Array(16).fill(1),outcomes:{receptions:[4,8,...Array(14).fill(6)]}})})}};
  return Response.json({id:'synthetic-response',model:'gpt-6-luna',status:'completed',service_tier:'default',usage:{input_tokens:1000,output_tokens:100},output:[{content:[{type:'output_text',text:JSON.stringify(wire)}]}]});
 };
 const result=await reviewPropsForSite({client,sport:'nfl',writerRunId:'synthetic-owner',games:[{id:'native',start:currentStart,away:'BUF',home:'MIN'}],deadline:Date.now()+300000,clock:()=>now,fetchImpl,load:(_g,w)=>({...packet,cutoff:w.cutoff,stage:w.stage})});
 return{stale,dueReads,counts,generations,calendarFetches,completed:Boolean(completed),findings:result.findings};
}
async function main(){Object.assign(process.env,{PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'true',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic'});const stale=await run(true),fresh=await run(false);assert.equal(stale.calendarFetches,1);assert.equal(stale.dueReads,1);assert.equal(stale.generations,1);assert.equal(stale.completed,true);assert.equal(fresh.calendarFetches,0);assert.equal(fresh.completed,true);assert.equal(fresh.generations,1);console.log('Actual calendar/runtime repair passed: stale official time refreshes once, full actor review completes through plan_v4, unchanged current fixtures make no day request. Every HTTP/count/model/SQL path mocked.');}
main().catch(e=>{console.error(e);process.exitCode=1;});
