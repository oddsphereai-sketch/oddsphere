import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
/** Actual siteRuntime/count API with virtual abort timers and synthetic IO only. */
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {reviewPropsForSite,type PropsAiSourceLoadContext} from '../lib/playerPropsAi/siteRuntime';
import {PROPS_AI_CONTROL_RELEASE} from '../lib/playerPropsAi/siteConfig';
import {PROPS_AI_CALENDAR_RELEASE,type PropsCalendar} from '../lib/playerPropsAi/calendar';
import {playerSubset} from '../lib/playerPropsAi/partitions';
import {PRODUCT_RELEASE,type GamePacket,type Player} from '../lib/playerPropsAi/evidenceContract';
import {readerEvidence,READER_AREAS} from '../lib/playerPropsAi/readerCoverage';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import type {PropsAiJob} from '../lib/playerPropsAi/budget';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import {countAiInput,type AiRequest} from '../lib/playerPropsAi/openai';
globalThis.fetch=async()=>{throw Error('Preparation deadline proof forbids network');};
const originalNow=Date.now,originalTimeout=AbortSignal.timeout,epoch=Date.parse('2030-11-17T17:36:00Z'),iso=(n:number)=>new Date(epoch+n).toISOString(),v=(n:number)=>Array<number>(16).fill(n);
type DbResult={data:unknown;error:null};
type Timer={at:number;run:()=>void;cancelled?:boolean};
async function exercise(mode:'unpackable'|'orphan'|'full_parts'|'small_window'|'staged_abort'|'small_with_large'){
 let now=0,activeCounts=0,countCalls=0,aborted=0,generation=0,sent=0,receipts=0,firstGenerationAt:number|null=null,badCountCalls=0;
 const fullParts=mode==='full_parts'||mode==='staged_abort',budgetMs=mode==='small_window'||mode==='small_with_large'?210000:300000;
 let healthyCountCalls=0,activeHooks=0,readyHooks=0,observedHooks=0,peakCounts=0;
 const timers:Timer[]=[],claimEvents:{game:string;at:number}[]=[],countEvents:{at:number;game:string}[]=[],purposes:{game:string;purpose:PropsAiSourceLoadContext['purpose']|undefined;jobKey?:string}[]=[],completed=new Map<string,AcceptedGameReview>();
 Date.now=()=>epoch+now;
 const schedule=(ms:number,run:()=>void)=>{const timer:Timer={at:now+ms,run};timers.push(timer);return timer;};
 AbortSignal.timeout=(ms:number)=>{assert(ms>0&&ms<=180000);const controller=new AbortController();schedule(ms,()=>controller.abort(new DOMException('Synthetic actual count timeout','TimeoutError')));return controller.signal;};
 async function wait(ms:number,signal?:AbortSignal){
  return new Promise<void>((resolve,reject)=>{
   const cleanup=()=>signal?.removeEventListener('abort',onAbort);
   const timer=schedule(ms,()=>{cleanup();resolve();});
   const onAbort=()=>{timer.cancelled=true;cleanup();reject(signal!.reason);};
   if(signal?.aborted)onAbort();else signal?.addEventListener('abort',onAbort,{once:true});
  });
 }
 const definitions=[{native:'native-healthy',funded:'espn:nfl:healthy',away:'BUF',home:'MIN',players:fullParts?16:1,lock:24*60000},
  {native:'native-bad',funded:'espn:nfl:bad',away:'TB',home:'CHI',players:mode==='small_with_large'?16:11,lock:24*60000},
  {native:'native-short',funded:'espn:nfl:short',away:'NE',home:'NYJ',players:1,lock:60000}];
 const jobs=definitions.map(g=>({job_key:`props-ai|nfl|${g.funded}|2030-11-17|final`,sport:'nfl',game_id:g.funded,game_day:'2030-11-17',stage:'final',scheduled_start:iso(g.lock+3600000),lock_at:iso(g.lock),due_at:iso(g.lock-25*60000),billing_month:'2030-11',state:'pending',claim_token:null,model:'gpt-6-luna',requested_tier:'default',parts:null,phase:0,input_hash:null,result:null,error_code:null} as PropsAiJob));
 const calendar:PropsCalendar={release:PROPS_AI_CALENDAR_RELEASE,month:'2030-11',capturedAt:iso(0),games:definitions.map(g=>({sport:'nfl',id:g.funded,start:iso(g.lock+3600000),lock:iso(g.lock),away:g.away,home:g.home,confirmed:true})),sources:{nba:{complete:true,source:'synthetic complete calendar'},nfl:{complete:true,source:'synthetic complete calendar'},mlb:{complete:true,source:'synthetic complete calendar'}}};
 const packets=new Map<string,GamePacket>();
 for(const g of definitions){
  const players:Player[]=Array.from({length:g.players},(_,i)=>({id:`${g.native}-p${i}`,name:`Synthetic ${g.native} ${i}`,team:g.away,opponent:g.home,markets:['receptions'],missing:[],evidence:[4,6,8].map((receptions,j)=>({id:`${g.native}-p${i}-log${j}`,kind:'recent_games',source:'synthetic played source',availableAt:iso(0),value:{game:{startTime:`2030-11-${String(7+j).padStart(2,'0')}T18:00:00Z`,homeTeam:g.home,awayTeam:g.away},box:{receptions,receiving_yards:receptions*10}}}))}));
  packets.set(g.native,{release:PRODUCT_RELEASE,sport:'nfl',gameId:g.native,start:iso(g.lock+3600000),lock:iso(g.lock),cutoff:iso(0),stage:'final',players,quotes:[],sourceLimitations:[]});
 }
 const client={from(table:string){let selection='';const query={
  select(s:string){selection=s;return query;},eq(){return query;},gte(){return query;},in(){return query;},lte(){return query;},gt(){return query;},order(){return query;},limit(){return query;},
  single:async()=>{assert.equal(table,'player_props_ai_control');return{data:{release:PROPS_AI_CONTROL_RELEASE,paid_enabled:true},error:null};},
  maybeSingle:async()=>{assert.equal(table,'player_props_ai_calendars');return{data:{release:PROPS_AI_CALENDAR_RELEASE,captured_at:iso(0),payload:calendar},error:null};},
  then(resolve:(value:DbResult)=>unknown,reject:(error:unknown)=>unknown){assert.equal(table,'player_props_ai_reviews');return Promise.resolve({data:selection==='*'?jobs.filter(j=>j.state==='pending'):jobs.filter(j=>j.state==='completed').map(j=>({result:j.result})),error:null} as DbResult).then(resolve,reject);},
 };return query;},rpc:async(name:string,args:Record<string,unknown>={})=>{
  if(name==='player_props_ai_plan_v4')return{data:{funded:true,budget:{}},error:null};if(name==='player_props_ai_reap')return{data:0,error:null};
  const job=jobs.find(j=>j.job_key===args.p_key);
  if(name==='player_props_ai_claim'){assert(job);assert.equal(activeCounts,0,'No claim can race orphan/default count HTTP');assert.equal(activeHooks,0,'Source publication hooks must finish before preparation/claim');assert.equal(job.state,'pending');assert(Array.isArray(args.p_requests));assert.equal(args.p_requests.length,fullParts?16:1);assert(budgetMs-now>=(fullParts?210000:120000),'No paid claim before actual whole-game feasibility');claimEvents.push({game:job.game_id,at:now});job.state='running';job.parts=args.p_requests.length;job.input_hash=String(args.p_hash);return{data:{claimed:true,token:'synthetic',job:{...job,model:'gpt-6-luna',requested_tier:'default'}},error:null};}
  if(name==='player_props_ai_send'){assert(job);return{data:{id:`synthetic-attempt-${++sent}`,model:'gpt-6-luna',requested_tier:'default',reserved_micro:100000},error:null};}
  if(name==='player_props_ai_receipt'){receipts++;return{data:null,error:null};}
  if(name==='player_props_ai_fallback')throw Error('The healthy prevalidated draft must not buy a fallback');
  if(name==='player_props_ai_finish'){assert(job);assert(args.p_result,'Only the healthy complete game may finish');const review={...(args.p_result as AcceptedGameReview),issuedAt:iso(now),inputHash:job.input_hash!};Object.assign(job,{state:'completed',result:review});completed.set(job.game_id,review);return{data:{...job},error:null};}
  throw Error('Unexpected synthetic RPC '+name);
 }} as unknown as SupabaseClient;
 const healthy=packets.get('native-healthy')!;
 function wire(ids:string[]){
  const part=playerSubset(healthy,ids),facts=readerEvidence(part),aliases=evidenceAliases(part);
  return{wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(part.players.map(p=>[p.id,verifiedReaderFixture(part,p.id,{assessment:'The supplied evidence supports a conditional forecast.',priorRead:{},coverage:Object.fromEntries(READER_AREAS.map(area=>[area,{status:facts[p.id][area].status,factIds:facts[p.id][area].facts.slice(0,1).map(f=>f.id),effect:'uncertain',observation:'The supplied context requires appropriate caution.'}])),evidenceIds:[[...aliases].find(([,id])=>id===p.evidence[0].id)![0]],gaps:[],confidence:[2],exceptions:[null],law:encodeCanonicalScenarioLaw('nfl',p,{weights:v(1),outcomes:{receptions:[4,8,...v(6).slice(2)]}})})]))};
 }
 const fetchImpl:typeof fetch=async(url,options)=>{
  const body=JSON.parse(String(options?.body)),signal=options?.signal??undefined;
  if(String(url).endsWith('/input_tokens')){
   const ids=Object.keys(body.text.format.schema.properties.players.properties),bad=ids.some(id=>id.startsWith('native-bad'));
   countCalls++;activeCounts++;peakCounts=Math.max(peakCounts,activeCounts);assert(activeCounts<=16);countEvents.push({at:now,game:bad?'bad':'healthy'});
   try{
    if(!bad){healthyCountCalls++;const delay=mode==='staged_abort'?(healthyCountCalls===1?40000:healthyCountCalls===5?25000:1):mode==='small_with_large'?40000:1;await wait(delay,signal);return Response.json({input_tokens:fullParts&&ids.length>1?145001:1000});}
    badCountCalls++;
    if(mode==='orphan'&&badCountCalls===1)return Response.json({error:'synthetic first sibling refusal'},{status:500});
    try{await wait(mode==='orphan'?999999:mode==='small_with_large'?1:40000,signal);}catch(error){aborted++;throw error;}
    return Response.json({input_tokens:145001});
   }finally{activeCounts--;}
  }
  assert.equal(String(url),'https://api.openai.com/v1/responses','No provider/calendar network is allowed');assert.equal(activeCounts,0);generation++;const responseNumber=generation;firstGenerationAt??=now;
  const ids=Object.keys(body.text.format.schema.properties.players.properties);assert(ids.every(id=>id.startsWith('native-healthy')));await wait(10000,signal);
  return Response.json({id:`synthetic-response-${responseNumber}`,model:'gpt-6-luna',status:'completed',service_tier:'default',usage:{input_tokens:1000,output_tokens:200},output:[{content:[{type:'output_text',text:JSON.stringify(wire(ids))}]}]});
 };
 try{
  let done=false;const promise=reviewPropsForSite({client,sport:'nfl',writerRunId:'synthetic-owner',games:definitions.map(g=>({id:g.native,start:iso(g.lock+3600000),away:g.away,home:g.home})),deadline:epoch+budgetMs,clock:()=>iso(now),fetchImpl,
   load:(game,window,context)=>{assert.equal(activeHooks,0,'No later source work races an awaited publication hook');purposes.push({game:game.id,purpose:context?.purpose,...(context?.purpose==='scheduled_review'?{jobKey:context.job.job_key}:{})});const base=packets.get(game.id)!;if(Date.parse(window.cutoff)>=Date.parse(base.lock))throw Error('Synthetic source refuses postlock capture');return{...structuredClone(base),cutoff:window.cutoff,stage:window.stage};},
   onSourceReady:async()=>{activeHooks++;await wait(1);activeHooks--;},
   onReviewObserved:async()=>{activeHooks++;await wait(2);activeHooks--;observedHooks++;},
   onReviewReady:async()=>{assert.equal(activeHooks,0);activeHooks++;await wait(3);activeHooks--;readyHooks++;},
  }).then(result=>{done=true;return result;});
  for(let guard=0;!done&&guard<2000;guard++){
   for(let flush=0;flush<120;flush++)await Promise.resolve();if(done)break;
   const available=timers.filter(t=>!t.cancelled);assert(available.length,'Virtual counts must terminate by their actual abort signals');now=Math.min(...available.map(t=>t.at));
   for(const timer of timers.filter(t=>!t.cancelled&&t.at===now)){timer.cancelled=true;timer.run();}
  }
  assert(done);const result=await promise;
  assert.equal(activeCounts,0);assert.equal(activeHooks,0);assert.equal(readyHooks,1);assert(observedHooks>=2);assert(healthyCountCalls>0);assert(peakCounts<=16);assert.equal(generation,fullParts?16:1);assert.equal(sent,generation);assert.equal(receipts,generation);assert.equal(claimEvents.length,1);assert.equal(claimEvents[0].game,'espn:nfl:healthy');
  assert.equal(jobs.find(j=>j.game_id==='espn:nfl:bad')!.state,'pending');assert.equal(jobs.find(j=>j.game_id==='espn:nfl:short')!.state,'pending');
  assert.equal(completed.size,1);assert(result.games.some(g=>g.game.id==='native-healthy'&&g.authorityReview));assert(result.findings.some(f=>f==='review_preparation_deferred_lock:espn:nfl:short'));
  if(fullParts){const full=completed.get('espn:nfl:healthy')!;assert.equal(full.players.length,16);assert.equal(full.partProvenance.length,16);assert.equal(new Set(full.partProvenance.map(p=>p.responseId)).size,16);}
  const countCutoff=budgetMs-(fullParts?220000:130000);
  assert(countEvents.every(e=>e.at<countCutoff),'No count request begins after the common stage-aware preparation deadline');assert(!countEvents.some(e=>e.game==='short'));
  assert(firstGenerationAt!==null);assert(budgetMs-firstGenerationAt!>=(fullParts?210000:120000),'The retained healthy prepared game has its actual complete generation opportunity');assert(now<budgetMs);
  assert(purposes.some(e=>e.purpose==='lock_authority'));assert(purposes.some(e=>e.purpose==='member_publication'));
  for(const g of ['healthy','bad'])assert(purposes.some(e=>e.game===`native-${g}`&&e.purpose==='scheduled_review'&&e.jobKey===jobs.find(j=>j.game_id===`espn:nfl:${g}`)!.job_key));
  assert(!purposes.some(e=>e.game==='native-short'&&e.purpose==='scheduled_review'),'A too-short job does not block or perform a scheduled preparation for healthy later locks');
  assert(purposes.filter(e=>e.purpose!=='scheduled_review').every(e=>e.jobKey===undefined));
  if(mode==='orphan'){assert.equal(aborted,2);assert(firstGenerationAt!>=45000,'Orphan sibling counts are drained through real timeout abortion before generation');}
  else if(mode==='small_with_large'){assert.equal(aborted,0);assert(firstGenerationAt!>=40000&&firstGenerationAt!<45000,'An infeasible discovered second wave defers only its game; the valid in-flight one-part count completes');assert(result.findings.some(f=>f.startsWith('source_or_review_unavailable:native-bad:')));}
  else{assert(aborted>0);assert.equal(firstGenerationAt,countCutoff,'Slow unpackable rebalances stop exactly at their shared stage-aware timeout deadline');}
  if(mode==='small_window'){assert.equal(budgetMs,210000);assert.equal(generation,1,'The original one-part210s omission is repaired without shrinking its full120s completion reserve');}
  if(mode==='staged_abort'){assert(countEvents.some(e=>e.game==='bad'&&e.at>=40000&&e.at<60000),'A bad sibling count is already in flight before the healthy game discovers its second generation wave');assert.equal(firstGenerationAt,80000,'The shortened shared deadline aborts that in-flight sibling before its original45s timeout');}
  const before=countCalls;for(const timer of timers.filter(t=>!t.cancelled)){timer.cancelled=true;timer.run();}for(let i=0;i<30;i++)await Promise.resolve();assert.equal(countCalls,before);assert.equal(activeCounts,0,'No count HTTP or count-loop continuation remains after runtime returns');
 }finally{Date.now=originalNow;AbortSignal.timeout=originalTimeout;}
}
async function main(){
 const names=['PLAYER_PROPS_AI_SITE_ENABLED','PLAYER_PROPS_AI_PAID_RUNS_ENABLED','PLAYER_PROPS_AI_OPENAI_API_KEY'] as const,previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 Object.assign(process.env,{PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'true',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-never-real'});
 try{
  let calls=0;const request:AiRequest={model:'gpt-6-luna',instructions:'Synthetic count.',input:'{}',text:{},max_output_tokens:7000,store:false};
  await assert.rejects(countAiInput(request,{key:'synthetic',deadline:Date.now()-1,fetchImpl:async()=>{calls++;throw Error('No expired count may start');}}),/deadline_exhausted/);assert.equal(calls,0);
  await exercise('unpackable');await exercise('orphan');await exercise('full_parts');await exercise('small_window');await exercise('staged_abort');await exercise('small_with_large');
  console.log('Actual site preparation deadline passed: adaptive one-part210s admission, discovered sixteen-part210s opportunity, in-flight sibling abort on stage contraction, queued/orphan count drain before claims, global16 count/generation bound, awaited publication hooks and short-lock pending refusal. Virtual time; all SQL/HTTP/counts/models mocked. No paid calls or background requests.');
 }finally{Date.now=originalNow;AbortSignal.timeout=originalTimeout;for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}}
}
void main().catch(error=>{Date.now=originalNow;AbortSignal.timeout=originalTimeout;console.error(error);process.exitCode=1;});
