import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
import {testMlbPrelockHandoff} from '../lib/playerPropsAi/mlbPrelockHandoff';
import type {PlayerPropPreviewRow} from '../app/mlb/props/components/PlayerPropsDashboard';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
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
async function exercise(){
 let now=0,activeCounts=0,countCalls=0,generation=0,sent=0,receipts=0,firstGenerationAt:number|null=null;
 const timers:Timer[]=[],claimEvents:{game:string;at:number}[]=[],countEvents:{at:number;game:string}[]=[],purposes:{game:string;purpose:PropsAiSourceLoadContext['purpose']|undefined;jobKey?:string}[]=[],completed=new Map<string,AcceptedGameReview>();
 Date.now=()=>epoch+now;
 const schedule=(ms:number,run:()=>void)=>{const timer:Timer={at:now+ms,run};timers.push(timer);return timer;};
 // Aggregate preparation timers may span the480s route; each vendor request
 // retains its separate existing generation/count timeout.
 AbortSignal.timeout=(ms:number)=>{assert(ms>0&&ms<=480000);const controller=new AbortController();schedule(ms,()=>controller.abort(new DOMException('Synthetic actual count timeout','TimeoutError')));return controller.signal;};
 async function wait(ms:number,signal?:AbortSignal){
  return new Promise<void>((resolve,reject)=>{
   const cleanup=()=>signal?.removeEventListener('abort',onAbort);
   const timer=schedule(ms,()=>{cleanup();resolve();});
   const onAbort=()=>{timer.cancelled=true;cleanup();reject(signal!.reason);};
   if(signal?.aborted)onAbort();else signal?.addEventListener('abort',onAbort,{once:true});
  });
 }
 const definitions=[{native:'native-healthy',funded:'espn:mlb:healthy',away:'BUF',home:'MIN',players:1,lock:300000},
  {native:'native-bad',funded:'espn:mlb:bad',away:'TB',home:'CHI',players:16,lock:24*60000},
  {native:'native-short',funded:'espn:mlb:short',away:'NE',home:'NYJ',players:1,lock:60000}];
 const jobs=definitions.map(g=>({job_key:`props-ai|mlb|${g.funded}|2030-11-17|final`,sport:'mlb',game_id:g.funded,game_day:'2030-11-17',stage:'final',scheduled_start:iso(g.lock+3600000),lock_at:iso(g.lock),due_at:iso(g.lock-25*60000),billing_month:'2030-11',state:'pending',claim_token:null,model:'gpt-6-luna',requested_tier:'default',parts:null,phase:0,input_hash:null,result:null,error_code:null} as PropsAiJob));
 const calendar:PropsCalendar={release:PROPS_AI_CALENDAR_RELEASE,month:'2030-11',capturedAt:iso(0),games:definitions.map(g=>({sport:'mlb',id:g.funded,start:iso(g.lock+3600000),lock:iso(g.lock),away:g.away,home:g.home,confirmed:true})),sources:{nba:{complete:true,source:'synthetic complete calendar'},nfl:{complete:true,source:'synthetic complete calendar'},mlb:{complete:true,source:'synthetic complete calendar'}}};
 const packets=new Map<string,GamePacket>();
 for(const g of definitions){
  const players:Player[]=Array.from({length:g.players},(_,i)=>({id:`${g.native}-p${i}`,name:`Synthetic ${g.native} ${i}`,team:g.away,opponent:g.home,markets:['pitcher_strikeouts'],missing:[],evidence:[{id:`${g.native}-p${i}:pitcher_strikeouts:recentForm`,kind:'recent_games',source:'synthetic canonical MLB start logs',availableAt:iso(0),value:{statLabel:'Strikeouts',sampleLabel:'starts',logs:[4,6,8].map((value,j)=>({gameId:j,date:`2030-11-${String(7+j).padStart(2,'0')}`,opponent:'OTHER',homeAway:'home',value}))}}]}));
  packets.set(g.native,{release:PRODUCT_RELEASE,sport:'mlb',gameId:g.native,start:iso(g.lock+3600000),lock:iso(g.lock),cutoff:iso(0),stage:'final',players,quotes:[],sourceLimitations:[]});
 }
 const client={from(table:string){let selection='';const query={
  select(s:string){selection=s;return query;},eq(){return query;},gte(){return query;},in(){return query;},lte(){return query;},gt(){return query;},order(){return query;},limit(){return query;},
  single:async()=>{assert.equal(table,'player_props_ai_control');return{data:{release:PROPS_AI_CONTROL_RELEASE,paid_enabled:true},error:null};},
  maybeSingle:async()=>{assert.equal(table,'player_props_ai_calendars');return{data:{release:PROPS_AI_CALENDAR_RELEASE,captured_at:iso(0),payload:calendar},error:null};},
  then(resolve:(value:DbResult)=>unknown,reject:(error:unknown)=>unknown){
   assert.equal(table,'player_props_ai_reviews');
   const result={data:selection==='*'?jobs.filter(j=>j.state==='pending'):jobs.filter(j=>j.state==='completed').map(j=>({result:j.result})),error:null} as DbResult;
   // Both phases now fit their declared admission window. A slow final lookup,
   // independent of paid generation, still returns after the healthy game's
   // lock: its already awaited canonical handoff must remain authoritative.
   const pending=selection!=='*'&&completed.size>0&&now<310000?wait(310000-now).then(()=>result):Promise.resolve(result);
   return pending.then(resolve,reject);
  },
 };return query;},rpc:async(name:string,args:Record<string,unknown>={})=>{
  if(name==='player_props_ai_plan_v4')return{data:{funded:true,budget:{}},error:null};if(name==='player_props_ai_reap')return{data:0,error:null};
  const job=jobs.find(j=>j.job_key===args.p_key);
  if(name==='player_props_ai_claim'){assert(job);assert.equal(activeCounts,0,'No claim can race orphan/default count HTTP');assert.equal(job.state,'pending');assert(Array.isArray(args.p_requests));claimEvents.push({game:job.game_id,at:now});job.state='running';job.parts=args.p_requests.length;job.input_hash=String(args.p_hash);return{data:{claimed:true,token:'synthetic',job:{...job,model:'gpt-6-luna',requested_tier:'default'}},error:null};}
  if(name==='player_props_ai_send'){assert(job);return{data:{id:`synthetic-attempt-${++sent}`,model:'gpt-6-luna',requested_tier:'default',reserved_micro:100000},error:null};}
  if(name==='player_props_ai_receipt'){receipts++;return{data:null,error:null};}
  if(name==='player_props_ai_fallback')throw Error('The healthy prevalidated draft must not buy a fallback');
  if(name==='player_props_ai_finish'){assert(job);assert(args.p_result,'Only the healthy complete game may finish');const review={...(args.p_result as AcceptedGameReview),issuedAt:iso(now),inputHash:job.input_hash!};Object.assign(job,{state:'completed',result:review});completed.set(job.game_id,review);return{data:{...job},error:null};}
  throw Error('Unexpected synthetic RPC '+name);
 }} as unknown as SupabaseClient;
 for(const [id,p] of packets){if(id==='native-short')continue;p.quotes=['over','under'].map(side=>({id:id+side,playerId:p.players[0].id,market:'pitcher_strikeouts',provider:'synthetic',book:'one',line:5.5,side:side as 'over'|'under',american:-110,observedAt:iso(0),receivedAt:iso(0),receivedAtProvenance:'provider_response' as const,opening:false,live:false}));}
 const healthy=packets.get('native-healthy')!;
 const nativeRows=definitions.map(g=>({id:`native:${g.native}`,providerIds:{gameId:g.native,mlbStatsPlayerId:packets.get(g.native)!.players[0].id,bdlPlayerId:1},player:'Synthetic',team:g.away,opponent:g.home,gameStartTime:iso(g.lock+3600000),market:'pitcher_strikeouts',offerContract:'two_way',line:5.5,side:'over',book:'one',odds:-110,projection:6,finalProbability:.6,modelProbability:.6,playGrade:'LEAN',units:1,missingFeatures:[],oddsSanity:[],lastUpdated:iso(0),reasonCodes:[]}) as unknown as PlayerPropPreviewRow);
 const durable:{rows:PlayerPropPreviewRow[];createdAt:string;gameId:string}[]=[];
 const handoff=testMlbPrelockHandoff(nativeRows,async(rows,gameId)=>{durable.push({rows,gameId,createdAt:iso(now)});},()=>iso(now));

 function wire(ids:string[]){
  const part=playerSubset(packets.get(ids[0].startsWith('native-bad')?'native-bad':'native-healthy')!,ids),facts=readerEvidence(part),aliases=evidenceAliases(part);
  return{wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(part.players.map(p=>[p.id,verifiedReaderFixture(part,p.id,{assessment:'The supplied evidence supports a conditional forecast.',priorRead:{},coverage:Object.fromEntries(READER_AREAS.map(area=>[area,{status:facts[p.id][area].status,factIds:facts[p.id][area].facts.slice(0,1).map(f=>f.id),effect:'uncertain',observation:'The supplied context requires appropriate caution.'}])),evidenceIds:[[...aliases].find(([,id])=>id===p.evidence[0].id)![0]],gaps:[],confidence:[2],exceptions:[null],law:encodeCanonicalScenarioLaw('mlb',p,{weights:v(1),outcomes:{pitcher_strikeouts:[4,8,...v(6).slice(2)],pitcher_outs:v(18),pitcher_hits_allowed:v(5),pitcher_walks:v(2),pitcher_earned_runs:v(2)}})})]))};
 }
 const fetchImpl:typeof fetch=async(url,options)=>{
  const body=JSON.parse(String(options?.body)),signal=options?.signal??undefined;
  if(String(url).endsWith('/input_tokens')){
   const ids=Object.keys(body.text.format.schema.properties.players.properties),bad=ids.some(id=>id.startsWith('native-bad'));
   countCalls++;activeCounts++;countEvents.push({at:now,game:bad?'bad':'healthy'});
   try{
    await wait(1,signal);return Response.json({input_tokens:bad&&ids.length>1?145001:1000});
   }finally{activeCounts--;}
  }
  assert.equal(String(url),'https://api.openai.com/v1/responses','No provider/calendar network is allowed');assert.equal(activeCounts,0);generation++;const responseNumber=generation;firstGenerationAt??=now;
  const ids=Object.keys(body.text.format.schema.properties.players.properties);await wait(ids[0].startsWith('native-bad')?120000:10000,signal);
  return Response.json({id:`synthetic-response-${responseNumber}`,model:'gpt-6-luna',status:'completed',service_tier:'default',usage:{input_tokens:1000,output_tokens:200},output:[{content:[{type:'output_text',text:JSON.stringify(wire(ids))}]}]});
 };
 try{
  let done=false;const promise=reviewPropsForSite({client,sport:'mlb',writerRunId:'synthetic-owner',games:definitions.map(g=>({id:g.native,start:iso(g.lock+3600000),away:g.away,home:g.home})),deadline:epoch+480000,clock:()=>iso(now),fetchImpl,onSourceReady:(p,r,_observed,available)=>handoff.observe(p,r,available),onReviewObserved:(p,r,available)=>handoff.observe(p,r,available),onReviewReady:(p,r)=>handoff.observe(p,r,true),
   load:(game,window,context)=>{purposes.push({game:game.id,purpose:context?.purpose,...(context?.purpose==='scheduled_review'?{jobKey:context.job.job_key}:{})});const base=packets.get(game.id)!;if(Date.parse(window.cutoff)>=Date.parse(base.lock))throw Error('Synthetic source refuses postlock capture');return{...structuredClone(base),cutoff:window.cutoff,stage:window.stage};},
  }).then(result=>{done=true;return result;});
  for(let guard=0;!done&&guard<2000;guard++){
   for(let flush=0;flush<120;flush++)await Promise.resolve();if(done)break;
   const available=timers.filter(t=>!t.cancelled);assert(available.length,'Virtual counts must terminate by their actual abort signals');now=Math.min(...available.map(t=>t.at));
   for(const timer of timers.filter(t=>!t.cancelled&&t.at===now)){timer.cancelled=true;timer.run();}
  }
  assert(done);const result=await promise;
  assert(!completed.has('espn:mlb:short'));assert(!claimEvents.some(event=>event.game==='espn:mlb:short'),'The too-short negative cannot claim or buy a primary-only review');
  const early=completed.get('espn:mlb:healthy')!;assert(early);assert(Date.parse(early.issuedAt!)<Date.parse(healthy.lock));const prelock=siteAiDecisions(healthy,early,early.issuedAt!);assert(prelock.length>0);const delivered=result.games.find(g=>g.game.id==='native-healthy');assert(delivered);assert.equal(delivered.decisions.length,0);assert(now>300000);assert(countCalls>0);assert.equal(receipts,sent);assert(firstGenerationAt!==null);
  const prelockPublications=durable.filter(s=>Date.parse(s.createdAt)<Date.parse(healthy.lock)&&s.rows.some(row=>row.providerIds?.gameId==='native-healthy'&&row.aiReview));
  assert(prelockPublications.length>0,'Actual runtime must await durable publication at the timely completed-review callback');
  const lockedSource=prelockPublications.at(-1)!;
  const lockedRow=lockedSource.rows.find(row=>row.providerIds?.gameId==='native-healthy')!;
  assert.equal(lockedRow.aiReview!.lawHash,early.players[0].law!.hash);assert.equal(lockedRow.finalProbability,prelock[0].probability);assert.equal(lockedRow.odds,prelock[0].american);assert.equal(lockedRow.units,1);
  assert.equal(lockedRow.aiReview!.executionEvidence!.selectedQuote.receivedAt,iso(0));
  assert.equal(handoff.rows().find(row=>row.providerIds?.gameId==='native-healthy')!.aiReview!.lawHash,lockedRow.aiReview!.lawHash,'Unrelated late games cannot erase a timely final');
  assert(durable.every(s=>s.createdAt===iso(0)||s.createdAt>=early.issuedAt!));
  console.log(JSON.stringify({proof:'actual_runtime_timely_mlb_review_durably_handed_off',finishedAt:early.issuedAt,lock:healthy.lock,returnedAt:iso(now),prelockPublications:prelockPublications.length,prelockDecisions:prelock.length,returnedDecisions:delivered.decisions.length,allGenerationMocked:true}));
 }finally{Date.now=originalNow;AbortSignal.timeout=originalTimeout;}
}
async function main(){
 const names=['NODE_ENV','PLAYER_PROPS_AI_SITE_ENABLED','PLAYER_PROPS_AI_PAID_RUNS_ENABLED','PLAYER_PROPS_AI_OPENAI_API_KEY'] as const,previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 Object.assign(process.env,{NODE_ENV:'test',PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'true',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-never-real'});
 try{
  let calls=0;const request:AiRequest={model:'gpt-6-luna',instructions:'Synthetic count.',input:'{}',text:{},max_output_tokens:7000,store:false};
  await assert.rejects(countAiInput(request,{key:'synthetic',deadline:Date.now()-1,fetchImpl:async()=>{calls++;throw Error('No expired count may start');}}),/deadline_exhausted/);assert.equal(calls,0);
  await exercise();

 }finally{Date.now=originalNow;AbortSignal.timeout=originalTimeout;for(const name of names){if(previous[name]===undefined)Reflect.deleteProperty(process.env,name);else Object.assign(process.env,{[name]:previous[name]});}}
}
void main().catch(error=>{Date.now=originalNow;AbortSignal.timeout=originalTimeout;console.error(error);process.exitCode=1;});
