/** Actual reviewer under virtual time; every count, HTTP and store boundary is mocked. */
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {runPropsReview,type AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import {propsAiCompletionWindowMs,propsAiTwoPhaseCompletionWindowMs,propsAiGenerationPool} from '../lib/playerPropsAi/completionWindow';
import {propsAiGameAdmission} from '../lib/playerPropsAi/gameAdmission';
import {PRODUCT_RELEASE,type GamePacket,type Player} from '../lib/playerPropsAi/evidenceContract';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {PROPS_AI_PRIMARY_MODEL,PROPS_AI_MAX_OUTPUT_PER_REQUEST,PROPS_AI_PART_CONCURRENCY} from '../lib/playerPropsAi/releases';
import {playerSubset} from '../lib/playerPropsAi/partitions';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';
import {auditPropsActorAdmissionPart,type PersistedActorAttempt} from './lib/player-props-ai-actor-admission-audit';
import type {PropsAiJob,PropsAiReviewStore} from '../lib/playerPropsAi/budget';
import {digest} from '../lib/playerPropsAi/evidence';

globalThis.fetch=async()=>{throw Error('Two-phase proof forbids real HTTP/provider/model/count calls');};
const epoch=Date.parse('2030-11-17T17:00:00Z'),iso=(ms:number)=>new Date(epoch+ms).toISOString(),v=(n:number)=>Array<number>(16).fill(n);
const originalNow=Date.now,originalTimeout=AbortSignal.timeout;
type Mode={claimMs?:number;invalidCorrection?:boolean;parts?:number;actorsPerPart?:number;deadlineMs:number;lockMs?:number;prepareMs?:number;admissionMs?:number;sendMs?:number;receiptMs?:number;primaryMs?:number;correctionMs?:number;invalidPrimary?:boolean;retainedActor?:boolean;preferStronger?:boolean;queueMs?:number;capacityRejection?:boolean};
type Event={kind:string;at:number;part?:number;phase?:number;timeout?:number;ids?:string[]};

function packet(game:number,parts:number,actorsPerPart:number,cutoff:number,lockMs:number):GamePacket{
  const players:Player[]=Array.from({length:parts*actorsPerPart},(_,i)=>({id:`g${game}-p${i}`,name:`Synthetic ${game} Actor ${i}`,team:'BOS',opponent:'NYK',markets:['points'],missing:[],evidence:[18,20,22].map((points,n)=>({id:`g${game}-p${i}:log${n}`,kind:'recent_games' as const,source:'synthetic prior-only recorded statistics',availableAt:iso(0),value:{game:{startTime:`2030-11-${String(5+n).padStart(2,'0')}T20:00:00Z`,homeTeam:'BOS',awayTeam:'NYK'},box:{points,minutes:30}}}))}));
  return{release:PRODUCT_RELEASE,sport:'nba',gameId:`synthetic-window-${game}`,start:iso(lockMs+3600000),lock:iso(lockMs),cutoff:iso(cutoff),stage:'final',sourceLimitations:[],players,quotes:[]};
}
function draft(source:GamePacket,phase:number,mode:Mode){
  const aliases=evidenceAliases(source);
  return{wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(source.players.map((player,index)=>{
    const bad=phase===2&&mode.invalidCorrection||phase===1&&mode.invalidPrimary&&(!mode.retainedActor||index===1)||phase===2&&mode.retainedActor&&index===0;
    return[player.id,verifiedReaderFixture(source,player.id,{priorRead:{},evidenceIds:[[...aliases].find(([,id])=>id===player.evidence[0].id)![0]],gaps:[],confidence:[2],exceptions:[null],law:encodeCanonicalScenarioLaw('nba',player,{weights:v(1),outcomes:{points:bad?v(50):[18,22,...v(20).slice(2)],rebounds:v(4),assists:v(2),threes:v(1)}})})];
  }))};
}

async function simulation(modes:Mode[],options:{sharedPool?:boolean;wholeGameAdmission?:boolean;pendingRescue?:boolean}={}){
  let now=0,done=false,active=0,peak=0,strongCounts=0;
  const timers:{at:number;resolve:()=>void}[]=[],budgets=new WeakMap<AbortSignal,number>(),events:Event[]=[],attempts:PersistedActorAttempt[]=[],bodies:{game:number;part:number;phase:number;body:string}[]=[];
  const claims=Array(modes.length).fill(0) as number[],finishes=Array(modes.length).fill(0) as number[],fallbacks=Array(modes.length).fill(0) as number[];
  Date.now=()=>epoch+now;AbortSignal.timeout=(ms:number)=>{const signal=new AbortController().signal;budgets.set(signal,ms);return signal;};
  const sleep=(ms:number)=>ms?new Promise<void>(resolve=>timers.push({at:now+ms,resolve})):Promise.resolve();
  const pool=propsAiGenerationPool(16),admission=propsAiGameAdmission(16);
  const jobs=modes.map((mode,game)=>{const source=packet(game,mode.parts??1,mode.actorsPerPart??1,0,mode.lockMs??1000000);return{job_key:`props-ai|nba|${source.gameId}|2030-11-17|final`,sport:'nba',game_id:source.gameId,game_day:'2030-11-17',stage:'final',scheduled_start:source.start,lock_at:source.lock,state:'pending',requested_tier:'default',model:PROPS_AI_PRIMARY_MODEL,parts:mode.parts??1} as PropsAiJob;});
  async function run(game:number,routeAt=0,prepareOverride?:number){
    const mode=modes[game],lockMs=mode.lockMs??1000000,source=packet(game,mode.parts??1,mode.actorsPerPart??1,now,lockMs),sourceDigest=digest(source),parts=Array.from({length:mode.parts??1},(_,i)=>({packet:playerSubset(source,source.players.slice(i*(mode.actorsPerPart??1),(i+1)*(mode.actorsPerPart??1)).map(p=>p.id)),inputTokens:1000}));
    const store:PropsAiReviewStore={
      claim:async(key,_hash,requests)=>{assert.equal(key,jobs[game].job_key);assert.equal(jobs[game].state,'pending');assert.equal(requests.length,parts.length);assert(requests.every(r=>r.max_output_tokens===7000));claims[game]++;events.push({kind:`claim-${game}`,at:now});await sleep(mode.claimMs??0);jobs[game]={...jobs[game],state:'running'};return{claimed:true,token:'synthetic',job:jobs[game]};},
      send:async(_key,_token,phase,part)=>{events.push({kind:`send-${game}`,at:now,phase,part});const id=`attempt-${game}-${phase}-${part}`,requestedTier=mode.capacityRejection&&phase===1?'flex' as const:'default' as const;assert(!attempts.some(a=>a.id===id));attempts.push({id,job_key:jobs[game].job_key,part,phase,state:'sending',model:PROPS_AI_PRIMARY_MODEL,requested_tier:requestedTier,response_id:null,actual_micro:null,usage:null} as PersistedActorAttempt);await sleep(mode.sendMs??0);return{id,reserved_micro:10000,model:PROPS_AI_PRIMARY_MODEL,requested_tier:requestedTier};},
      receipt:async(id,_token,actual,responseId,usage)=>{const record=attempts.find(a=>a.id===id)!;assert.equal(record.usage,null,'Receipt is immutable');Object.assign(record,{actual_micro:actual,response_id:responseId,usage:structuredClone(usage),state:actual===null?'unknown':'completed'});await sleep(mode.receiptMs??0);},
      fallback:async(_key,_token,partNumbers)=>{fallbacks[game]++;assert.equal(fallbacks[game],1);events.push({kind:`fallback-${game}`,at:now,ids:partNumbers.map(String)});return true;},
      finish:async(_key,_token,result,error)=>{finishes[game]++;assert.equal(finishes[game],1);jobs[game]={...jobs[game],state:result?'completed':'failed',result:result?{...result,issuedAt:iso(now)}:null,error_code:error};events.push({kind:`finish-${game}`,at:now});return jobs[game];},
    };
    const result=await runPropsReview({packet:source,job:jobs[game],store,key:'synthetic-never-real',writerRunId:'synthetic-existing-sport-owner',preferStronger:mode.preferStronger??false,clock:()=>iso(now),deadline:epoch+routeAt+mode.deadlineMs,
      prepare:async()=>{await sleep(prepareOverride??mode.prepareMs??0);return parts;},countStrong:async()=>{strongCounts++;return 1000;},
      gameAdmission:options.wholeGameAdmission?admission:mode.admissionMs?async()=>{await sleep(mode.admissionMs!);return()=>events.push({kind:`permit-released-${game}`,at:now});}:undefined,
      generationSlot:options.sharedPool?pool:mode.queueMs?async fn=>{await sleep(mode.queueMs!);return fn();}:undefined,
      fetchImpl:async(url,init)=>{
        assert.equal(String(url),'https://api.openai.com/v1/responses','No provider or count endpoint');const body=JSON.parse(String(init?.body));assert.equal(body.max_output_tokens,PROPS_AI_MAX_OUTPUT_PER_REQUEST);assert.equal(body.model,PROPS_AI_PRIMARY_MODEL);
        const ids=Object.keys(body.text.format.schema.properties.players.properties),partIndex=parts.findIndex(p=>p.packet.players[0].id===ids[0]),part=parts[partIndex];assert(part);assert.deepEqual(ids,part.packet.players.map(p=>p.id));
        const phase=fallbacks[game]?2:1,timeout=budgets.get(init!.signal!)!;assert(timeout>=90000&&timeout<=180000);assert(now<lockMs);events.push({kind:`http-${game}`,at:now,part:partIndex+1,phase,timeout,ids});bodies.push({game,part:partIndex+1,phase,body:String(init?.body)});
        active++;peak=Math.max(peak,active);assert(active<=16);const latency=phase===1?(mode.primaryMs??1000):(mode.correctionMs??1000);
        await sleep(Math.min(latency,timeout));active--;if(latency>timeout)throw Error('Synthetic bounded generation timeout');
        assert(now<lockMs,'A bounded response cannot cross the existing lock');if(mode.capacityRejection&&phase===1)return Response.json({error:{code:'resource_unavailable',type:'resource_unavailable_error'}},{status:429});return Response.json({id:`response-${game}-${phase}-${partIndex+1}`,model:body.model,status:'completed',service_tier:'default',usage:{input_tokens:1000,output_tokens:200},output:[{content:[{type:'output_text',text:JSON.stringify(draft(part.packet,phase,{...mode,invalidPrimary:mode.invalidPrimary&&(!mode.retainedActor||partIndex===0),retainedActor:mode.retainedActor&&partIndex===0}))}]}]});
      },
    });assert.equal(digest(source),sourceDigest,'Timing never mutates source evidence');return result;
  }
  let results:Awaited<ReturnType<typeof run>>[]=[];
  const work=(async()=>{
    results=await Promise.all(modes.map((_,i)=>run(i)));
    if(options.pendingRescue){assert.equal(results[0].status,'skipped');assert.equal(claims[0],0);assert.equal(jobs[0].state,'pending');now=200000;results.push(await run(0,200000,0));}
  })().finally(()=>{done=true;});
  try{
    for(let turns=0;!done;turns++){
      assert(turns<20000,'Virtual reviewer stalled');for(let n=0;n<30;n++)await Promise.resolve();
      if(timers.length){const next=Math.min(...timers.map(t=>t.at));now=next;const due=timers.filter(t=>t.at===next);timers.splice(0,timers.length,...timers.filter(t=>t.at!==next));due.forEach(t=>t.resolve());}
      else if(!done)await new Promise<void>(resolve=>setImmediate(resolve));
    }
    await work;return{results,jobs,claims,finishes,fallbacks,events,attempts,bodies,strongCounts,peak,now};
  }finally{Date.now=originalNow;AbortSignal.timeout=originalTimeout;}
}

async function main(){
  assert.equal(propsAiCompletionWindowMs(1),120000);assert.equal(propsAiTwoPhaseCompletionWindowMs(1),240000);assert.equal(propsAiTwoPhaseCompletionWindowMs(8),240000);assert.equal(propsAiTwoPhaseCompletionWindowMs(16),420000);assert.throws(()=>propsAiTwoPhaseCompletionWindowMs(17));
  for(const remaining of [141000,104513,111391]){const deferred=await simulation([{deadlineMs:remaining}]);assert.equal(deferred.results[0].status,'skipped');assert.equal(deferred.claims[0],0);assert.equal(deferred.attempts.length,0);assert.equal(deferred.jobs[0].state,'pending');}
  // A claim ACK, generation queue or unknown response must never make a
  // later wave buy work after an earlier mandatory wave cannot be recovered.
  for(const parts of [1,8,9,16]){
    const minimum=propsAiTwoPhaseCompletionWindowMs(parts);
    const lateClaim=await simulation([{parts,deadlineMs:minimum,claimMs:1}]);
    assert.equal(lateClaim.claims[0],1);assert.equal(lateClaim.attempts.length,0);assert.equal(lateClaim.bodies.length,0);assert.equal(lateClaim.finishes[0],1);assert.equal(lateClaim.fallbacks[0],0);assert.equal(lateClaim.results[0].status,'failed');
    const exactClaim=await simulation([{parts,deadlineMs:minimum+1,claimMs:1}]);
    assert.equal(exactClaim.results[0].status,'completed');assert.equal(exactClaim.bodies.length,parts);
    const queuedWave=await simulation([{parts,deadlineMs:minimum,queueMs:1}]);
    assert.equal(queuedWave.attempts.length,0);assert.equal(queuedWave.bodies.length,0);assert.equal(queuedWave.finishes[0],1);assert.equal(queuedWave.results[0].status,'failed');
  }
  for(const parts of [9,16]){
    const unknownWave=await simulation([{parts,deadlineMs:480000,primaryMs:180001}]);
    assert.equal(unknownWave.attempts.length,8);assert.equal(unknownWave.bodies.length,8);assert(unknownWave.attempts.every(a=>a.actual_micro===null&&a.state==='unknown'));assert.equal(unknownWave.fallbacks[0],0);assert.equal(unknownWave.finishes[0],1);assert.equal(unknownWave.results[0].status,'failed');
    const finalWave=await simulation([{parts,deadlineMs:480000,invalidPrimary:true,invalidCorrection:true}]);
    assert.equal(finalWave.bodies.filter(b=>b.phase===1).length,parts);assert.equal(finalWave.bodies.filter(b=>b.phase===2).length,8);assert.equal(finalWave.fallbacks[0],1);assert.equal(finalWave.finishes[0],1);assert.equal(finalWave.results[0].status,'failed');assert(finalWave.attempts.every(a=>a.actual_micro!==null),'Known receipts stay exact; no unknown hold is fabricated or released');
  }
  const prepared=await simulation([{deadlineMs:300000,prepareMs:159000,invalidPrimary:true}],{pendingRescue:true});assert.equal(prepared.results[1].status,'completed');assert.equal(prepared.claims[0],1);assert.equal(prepared.fallbacks[0],1);assert.equal(prepared.jobs[0].job_key,'props-ai|nba|synthetic-window-0|2030-11-17|final');assert(prepared.events.find(e=>e.kind==='claim-0')!.at>=200000);
  const delayedAdmission=await simulation([{deadlineMs:300000,admissionMs:100000}]);assert.equal(delayedAdmission.results[0].status,'skipped');assert.equal(delayedAdmission.claims[0],0);assert(delayedAdmission.events.some(e=>e.kind==='permit-released-0'));
  const bounded=await simulation([{parts:2,actorsPerPart:2,deadlineMs:240000,primaryMs:90000,correctionMs:90000,receiptMs:20000,invalidPrimary:true,retainedActor:true}]);assert.equal(bounded.results[0].status,'completed');assert.equal(bounded.fallbacks[0],1);assert(bounded.events.filter(e=>e.kind==='http-0'&&e.phase===2).every(e=>e.timeout!>=90000));assert(bounded.now<240000);
  const retained=bounded.results[0];assert('review'in retained&&retained.review);const review=retained.review as AcceptedGameReview;assert(review.partProvenance.some(p=>p.phase===1&&p.actorAdmissionRelease));assert(review.partProvenance.some(p=>p.phase===2&&p.actorAdmissionRelease));
  const originalPart=JSON.parse(gunzipSync(Buffer.from(review.inputEvidence.data,'base64')).toString()) as GamePacket;const partSource=playerSubset(originalPart,originalPart.players.slice(0,2).map(p=>p.id));const retainedAttempts=bounded.attempts.filter(a=>a.part===1);assert(auditPropsActorAdmissionPart({packet:partSource,attempts:retainedAttempts,provenance:review.partProvenance.filter(p=>p.part===1)}).complete);
  assert.equal(bounded.events.filter(e=>e.kind==='http-0'&&e.phase===1).length,2);assert.equal(bounded.events.filter(e=>e.kind==='http-0'&&e.phase===2).length,1,'Successful original part is never regenerated');assert.deepEqual(bounded.events.find(e=>e.kind==='http-0'&&e.phase===2)!.ids,partSource.players.map(p=>p.id),'Correction still requests the exact whole original part');
  const allParts=await simulation([{parts:16,deadlineMs:480000,prepareMs:60000,primaryMs:90000,correctionMs:90000,invalidPrimary:true}]);assert.equal(allParts.results[0].status,'completed');assert.equal(allParts.bodies.length,32);assert.equal(allParts.fallbacks[0],1);assert.equal(allParts.peak,PROPS_AI_PART_CONCURRENCY);assert.equal(allParts.now,420000);assert(allParts.now<480000);
  const optional=await simulation([{deadlineMs:245000,preferStronger:true,invalidPrimary:true}]);assert.equal(optional.results[0].status,'completed');assert.equal(optional.strongCounts,0,'Optional count cannot consume two-phase reserve');
  const delayedSend=await simulation([{deadlineMs:240000,sendMs:20000}]);assert.equal(delayedSend.bodies.length,0);assert.equal(delayedSend.attempts.length,1);assert.equal(delayedSend.attempts[0].actual_micro,0);assert.equal((delayedSend.attempts[0].usage as {kind:string}).kind,'known_unbilled_before_http');assert.equal(delayedSend.fallbacks[0],0);
  const capacity=await simulation([{deadlineMs:300000,capacityRejection:true}]);assert.equal(capacity.results[0].status,'completed');assert.equal(capacity.fallbacks[0],1);assert.equal(capacity.attempts.length,2);assert.equal(capacity.attempts[0].actual_micro,0);assert.equal((capacity.attempts[0].usage as {kind:string}).kind,'known_unbilled');assert.equal(capacity.attempts[0].requested_tier,'flex');assert.equal(capacity.attempts[1].requested_tier,'default');assert.equal(capacity.bodies.length,2,'A genuinely dispatched known-unbilled Flex capacity response retains exactly the existing Standard recovery');
  const lockBound=await simulation([{deadlineMs:300000,lockMs:141000}]);assert.equal(lockBound.claims[0],0);assert.equal(lockBound.bodies.length,0);
  const timeout=await simulation([{deadlineMs:240000,lockMs:240000,primaryMs:120000}]);assert.equal(timeout.attempts.length,1);assert.equal(timeout.attempts[0].actual_micro,null);assert.equal(timeout.attempts[0].state,'unknown');assert.equal(timeout.fallbacks[0],0);assert(timeout.now<240000);
  const queued=await simulation(Array.from({length:3},()=>({parts:8,deadlineMs:300000,primaryMs:100000})),{sharedPool:true});assert.equal(queued.results[2].status,'failed');assert.equal(queued.events.filter(e=>e.kind==='http-2').length,0);assert.equal(queued.attempts.filter(a=>String((a as {job_key?:string}).job_key).includes('synthetic-window-2')).length,0,'Queue exhaustion before send has no attempt or invented zero receipt');
  const admitted=await simulation(Array.from({length:3},()=>({parts:8,deadlineMs:300000,primaryMs:100000})),{sharedPool:true,wholeGameAdmission:true});assert.equal(admitted.results[2].status,'skipped');assert.equal(admitted.claims[2],0);assert.equal(admitted.jobs[2].state,'pending');
  console.log('Actual two-phase reviewer window passed:141s/observed104513ms+111391ms primary-only windows defer unclaimed; delayed preparation/admission preserves same pending slot and fresh rescue;240s supports retained actors/parts plus a full correction;16 parts retain both full waves; optional count, queue/send delays, known-zero unsent versus unknown dispatched charges and lock bounds remain exact. Virtual time and mocked store/HTTP only; zero real provider/model/count/paid calls.');
}
main().catch(error=>{Date.now=originalNow;AbortSignal.timeout=originalTimeout;console.error(error);process.exitCode=1;});
