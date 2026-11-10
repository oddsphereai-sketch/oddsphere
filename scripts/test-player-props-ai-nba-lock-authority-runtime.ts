/** Actual siteRuntime/reviewer/parser/binding/lifecycle; every I/O mocked. */
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {PropsAiJob} from '../lib/playerPropsAi/budget';
import {reviewPropsForSite} from '../lib/playerPropsAi/siteRuntime';
import {PROPS_AI_CONTROL_RELEASE} from '../lib/playerPropsAi/siteConfig';
import {PROPS_AI_CALENDAR_RELEASE,type PropsCalendar} from '../lib/playerPropsAi/calendar';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {applyNbaSiteAi,restoreNbaNativeGame} from '../lib/playerPropsAi/siteBindings';
import {capturedReviewSlots} from '../lib/playerPropsAi/liveWindow';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';
import {mergeNbaHandoffs,testNbaSourceAuthority,testNbaHandoffCapture,type NbaLockHandoff} from '../lib/playerPropsAi/nbaLockAuthority';
import {nbaAuthorityFixture,nbaAuthorityDraft} from './test-player-props-ai-nba-lock-authority';
globalThis.fetch=async()=>{throw Error('NBA runtime proof forbids real HTTP');};
async function exercise(failedFinalRead:boolean){
 const initial='2026-11-10T22:24:00Z',completed='2026-11-10T22:26:00Z',after='2026-11-10T22:30:01Z';let tick=initial,reads=0,generations=0,counts=0,receipts=0,claimHash='';
 const f=nbaAuthorityFixture(initial),baseline=f.snapshot([f.row('a'),f.row('a','rebounds')]);let candidate=baseline,stored:AcceptedGameReview|null=null;
 const frames:NbaLockHandoff[]=[],callbackOrder:string[]=[],sourcePurposes:string[]=[];
 const calendar:PropsCalendar={release:PROPS_AI_CALENDAR_RELEASE,month:'2026-11',capturedAt:initial,games:[{sport:'nba',id:'espn:nba:synthetic',confirmed:true,start:f.packet.start,lock:f.packet.lock,away:'BOS',home:'NYK'}],sources:{nba:{complete:true,source:'synthetic complete schedule'},nfl:{complete:true,source:'synthetic empty schedule'},mlb:{complete:true,source:'synthetic empty schedule'}}};
 const job={job_key:'props-ai|nba|espn:nba:synthetic|2026-11-10|final',sport:'nba',game_id:'espn:nba:synthetic',game_day:'2026-11-10',stage:'final',scheduled_start:f.packet.start,lock_at:f.packet.lock,due_at:'2026-11-10T22:05:00Z',billing_month:'2026-11',state:'pending'}as PropsAiJob;
 type DbResult={data:unknown;error:{code:string}|null};
 const client={from(table:string){let selection='';const query={select(value:string){selection=value;return query;},eq(){return query;},gte(){return query;},lte(){return query;},gt(){return query;},in(){return query;},order(){return query;},limit(){return query;},
  single:async()=>{assert.equal(table,'player_props_ai_control');return{data:{release:PROPS_AI_CONTROL_RELEASE,paid_enabled:true},error:null};},
  maybeSingle:async()=>{assert.equal(table,'player_props_ai_calendars');return{data:{release:PROPS_AI_CALENDAR_RELEASE,captured_at:initial,payload:calendar},error:null};},
  then(resolve:(result:DbResult)=>unknown,reject:(error:unknown)=>unknown){assert.equal(table,'player_props_ai_reviews');if(selection==='*')return Promise.resolve({data:job.state==='pending'?[job]:[],error:null}).then(resolve,reject);reads++;if(reads===1)return Promise.resolve({data:[],error:null}).then(resolve,reject);tick=after;callbackOrder.push('final_review_get_crossed_lock');return Promise.resolve(failedFinalRead?{data:null,error:{code:'synthetic_read_unavailable'}}:{data:stored?[{result:stored}]:[],error:null}).then(resolve,reject);},
 };return query;},rpc:async(name:string,args:Record<string,unknown>={})=>{
  if(name==='player_props_ai_plan_v4')return{data:{funded:true,budget:{}},error:null};if(name==='player_props_ai_reap')return{data:0,error:null};
  if(name==='player_props_ai_claim'){assert.equal(job.state,'pending');claimHash=String(args.p_hash);job.state='running';return{data:{claimed:true,token:'synthetic-token',job:{...job,parts:1,model:'gpt-6-luna',requested_tier:'default'}},error:null};}
  if(name==='player_props_ai_send')return{data:{id:'synthetic-attempt',reserved_micro:100000,model:'gpt-6-luna',requested_tier:'default'},error:null};
  if(name==='player_props_ai_receipt'){receipts++;return{data:null,error:null};}
  if(name==='player_props_ai_finish'){assert(args.p_result,'Only a valid complete final may finish');stored={...args.p_result as AcceptedGameReview,issuedAt:tick,inputHash:claimHash};job.state='completed';callbackOrder.push('final_completed');return{data:{...job,result:stored},error:null};}
  throw Error('Unexpected mocked RPC '+name);
 }}as unknown as SupabaseClient;
 const observe=(packet:typeof f.packet,review:AcceptedGameReview|null,lookupAvailable:boolean)=>{
  frames.push(testNbaSourceAuthority(()=>tick)(packet,review,lookupAvailable));
  if(Date.parse(tick)>=Date.parse(packet.lock))return;
  candidate=restoreNbaNativeGame(candidate,baseline,packet,tick);
  if(review)candidate=applyNbaSiteAi(candidate,packet,siteAiDecisions(packet,review,tick),tick);
  frames.push(testNbaHandoffCapture(()=>tick)(candidate.decisions,packet,review,'ai'));
 };
 const result=await reviewPropsForSite({client,sport:'nba',writerRunId:'synthetic-nba-lease-owner',games:[{id:'g',start:f.packet.start,away:'BOS',home:'NYK'}],deadline:Date.now()+450000,clock:()=>tick,
  load:(_game,window,context)=>{sourcePurposes.push(context?.purpose??'missing');capturedReviewSlots({gameId:'g',start:f.packet.start,lock:f.packet.lock},window,()=>[]);return{...structuredClone(f.packet),cutoff:window.cutoff,stage:window.stage};},
  onSourceReady:(packet,review,_at,lookupAvailable)=>{callbackOrder.push('source_ready');frames.push(testNbaHandoffCapture(()=>tick)(baseline.decisions,packet,review,'native'));observe(packet,review,lookupAvailable);},
  onReviewObserved:(packet,review,lookupAvailable)=>{callbackOrder.push('review_observed');observe(packet,review,lookupAvailable);},
  onReviewReady:(packet,review)=>{callbackOrder.push('review_ready');observe(packet,review,true);},
  fetchImpl:async(url,options)=>{if(String(url).endsWith('/input_tokens')){counts++;return Response.json({input_tokens:1000});}assert.equal(String(url),'https://api.openai.com/v1/responses');generations++;const request=JSON.parse(String(options?.body));assert.equal(request.model,'gpt-6-luna');assert.equal(request.max_output_tokens,7000);tick=completed;return Response.json({id:'synthetic-nba-response',model:'gpt-6-luna',service_tier:'default',status:'completed',usage:{input_tokens:1000,output_tokens:200},output:[{content:[{type:'output_text',text:JSON.stringify(nbaAuthorityDraft({...f.packet,gameId:job.game_id,sourceGameId:'g'},[1,4,5,...Array(13).fill(0)]))}]}]});},
 });
 assert.equal(generations,1);assert.equal(counts,1);assert.equal(receipts,1);assert.equal(job.state,'completed');assert(stored);assert(callbackOrder.indexOf('review_ready')<callbackOrder.indexOf('final_review_get_crossed_lock'),'Actual completed review is materialized before the later GET');
 assert.deepEqual(sourcePurposes,['lock_authority','scheduled_review','member_publication']);assert(result.findings.some(f=>f.startsWith('current_source_unavailable:')));assert.equal(result.games.length,1);assert.equal(result.games[0].decisions.length,0,'A postlock public reprice is not fabricated');
 const locked=advanceNbaPlayerPropsCandidateLifecycle({now:tick,previous:baseline,candidate,lockHandoff:mergeNbaHandoffs(frames)});
 assert.equal(locked.snapshot.decisions.length,3,'The final covers both actors and all three markets, including an AI-only scope with no native predecessor');assert(locked.snapshot.decisions.every(r=>r.aiReview?.inputHash===claimHash&&Date.parse(r.lockedAt!)===Date.parse(f.packet.lock)));
 const accepted=result.games[0].authorityReview;assert(accepted);assert.equal(accepted.players.length,2);assert.equal(Object.values(accepted.marketScopes).flat().length,3);assert(locked.snapshot.decisions.every(r=>r.projection===candidate.decisions.find(c=>c.playerId===r.playerId&&c.market===r.market)!.projection));
}
async function main(){const keys=['NODE_ENV','PLAYER_PROPS_AI_SITE_ENABLED','PLAYER_PROPS_AI_PAID_RUNS_ENABLED','PLAYER_PROPS_AI_OPENAI_API_KEY']as const,previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));Object.assign(process.env,{NODE_ENV:'test',PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'true',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-never-real'});try{await exercise(false);await exercise(true);console.log('Actual NBA siteRuntime handoff passed: one mocked normal final/count/receipt, immediate complete actor/scope overlay before later GET/source cross-lock, local trusted completion after failed GET, exact final locks and AI-only scope recovery. No real SQL, HTTP, provider, cron or paid test calls.');}finally{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else Object.assign(process.env,{[key]:previous[key]});}}}
void main().catch(error=>{console.error(error);process.exitCode=1;});
