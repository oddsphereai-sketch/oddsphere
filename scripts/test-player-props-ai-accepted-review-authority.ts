/* eslint-disable @typescript-eslint/no-explicit-any -- Actual runtime fault injection models malformed storage and opaque legacy records. */
/** Actual shared runtime inventory authority, with every database/HTTP/model
 * boundary in memory. Simulated known-local completions are not paid reviews. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {gzipSync} from 'node:zlib';
import {digest} from '../lib/playerPropsAi/evidence';
import {PRODUCT_RELEASE,type Sport} from '../lib/playerPropsAi/evidenceContract';
import {PROPS_AI_RELEASE} from '../lib/playerPropsAi/releases';
import {PROPS_AI_CONTROL_RELEASE} from '../lib/playerPropsAi/siteConfig';
import {propsAiRuntimeFailure,summarizePropsAiRuntimeHealth} from '../lib/playerPropsAi/runtimeHealth';

const at='2030-11-17T18:40:00.000Z',start='2030-11-17T20:00:00.000Z',lock='2030-11-17T19:00:00.000Z';
const baselinePath=process.argv.find(arg=>arg.startsWith('--baseline-runtime='))?.slice('--baseline-runtime='.length);
const baseline=process.argv.includes('--expect-baseline-unsafe');
assert.equal(Boolean(baselinePath),baseline,'An original-runtime negative requires its explicit frozen source');
type Inventory={data:unknown;error:unknown};
const known=(data:unknown[]=[]):Inventory=>({data,error:null});
const bad:Record<string,Inventory>={null:{data:null,error:null},undefined:{data:undefined,error:null},object:{data:{unknown:true},error:null},string:{data:'unknown',error:null},error:{data:[],error:{code:'synthetic_unavailable'}},falseError:{data:[],error:false},overflow:known(Array.from({length:257},()=>({result:{}}))),nullRow:known([null]),missingResult:known([{}]),nullResult:known([{result:null}])};
function exercise(sport:Sport,options:{initial?:Inventory;final?:Inventory;local?:boolean;before?:'early'|'final';readSource?:boolean;sourceFailure?:boolean;afterLockFailure?:boolean}={}){
 let tick=at,acceptedReads=0,sourceLoads=0,simulatedCompletions=0,ready=0;
 const callbacks:Array<{kind:string;review:any;available:boolean;at:string}>=[],audits:any[]=[],queryBounds:number[]=[],rpcs:string[]=[];
 const game={id:'synthetic-'+sport,start,away:'A',home:'B'};
 const packet:any={release:PRODUCT_RELEASE,sport,gameId:game.id,start,lock,cutoff:at,stage:'final',players:[],quotes:[],sourceLimitations:[]};
 const source={...packet,sourceGameId:game.id,gameId:'funded-'+sport},json=JSON.stringify(source);
 const review=(stage:'early'|'final')=>({release:PROPS_AI_RELEASE,sourceGameId:game.id,gameId:source.gameId,start,lock,cutoff:at,stage,issuedAt:stage==='early'?'2030-11-17T17:00:00Z':'2030-11-17T18:39:00Z',model:'gpt-6-luna',partProvenance:[],players:[],marketScopes:{},criticalContextHashes:{},inputHash:digest(source),inputEvidence:{encoding:'gzip-base64',digest:digest(source),bytes:Buffer.byteLength(json),data:gzipSync(json).toString('base64')},legacyOpaque:{projection:-1.23456789,grade:'Lean',price:-117,evidence:{original:true}}});
 const prior=options.before?review(options.before):null,local=review('final');
 const initial=options.initial??known(prior?[{result:prior}]:[]),final=options.final??known(prior?[{result:prior}]:[]);
 const pending={job_key:'pending-'+sport,game_id:source.gameId,sport,state:'pending',stage:'final',scheduled_start:start,lock_at:lock,due_at:'2030-11-17T18:35:00Z'};
 const client={from(table:string){assert(['player_props_ai_control','player_props_ai_reviews'].includes(table));let state='',bound=0;const q:any={select(){return q;},eq(key:string,value:any){if(key==='state')state=value;return q;},gte(){return q;},order(){return q;},in(){return q;},limit(value:number){bound=value;return q;},single:async()=>({data:{paid_enabled:Boolean(options.local),release:PROPS_AI_CONTROL_RELEASE},error:null}),then(resolve:any,reject:any){if(state==='pending'){assert(options.local);assert.equal(bound,3);return Promise.resolve(known([pending])).then(resolve,reject);}queryBounds.push(bound);acceptedReads++;return Promise.resolve(acceptedReads===1&&options.readSource!==false?initial:final).then(resolve,reject);}};return q;},rpc(){throw Error('No real SQL/RPC/claims permitted');}};
 class Clock extends Date{constructor(value?:string|number){super(value??tick);}static now(){return Date.parse(tick);}}
 const req=createRequire(process.cwd()+'/lib/playerPropsAi/siteRuntime.ts');
 const calendar={loadPropsCalendar:async()=>({games:[]}),calendarWalletPlan:()=>({}),reconcilePropsCalendarDay:async({calendar}:any)=>({calendar,findings:[]}),matchPropsCalendarGame:()=>({id:source.gameId})};
 class Store{async plan(){rpcs.push('simulated_plan');return{funded:true};}async reap(){rpcs.push('simulated_reap');}}
 const modules:Record<string,unknown>={'./calendar':calendar,'./budget':{PropsAiStore:Store},'./partitions':{prepareReviewParts:async(packet:any)=>[{packet,inputTokens:1}]},'./openai':{countAiInput:()=>{throw Error('No count permitted');}},'./reviewer':{runPropsReview:async()=>{assert(options.local);simulatedCompletions++;return{status:'completed',review:local};}}};
 const instance={exports:{}};const code=ts.transpileModule(readFileSync(baselinePath??'lib/playerPropsAi/siteRuntime.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const forbidden=async()=>{throw Error('Accepted inventory controls forbid all HTTP/provider/model requests');};
 vm.runInNewContext(code,{module:instance,exports:instance.exports,require:(name:string)=>Object.hasOwn(modules,name)?modules[name]:req(name),Date:Clock,process:{env:{...process.env,PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:options.local?'true':'false',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-never-real'}},console,Buffer,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:forbidden});
 // Imported pure configuration reads the ordinary process env; restore exact
 // originals in main after each fully awaited case.
 Object.assign(process.env,{PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:options.local?'true':'false',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-never-real'});
 const run=(instance.exports as any).reviewPropsForSite;
 return{review,prior,local,async run(){const result=await run({client,sport,writerRunId:'synthetic-only',games:[game],clock:()=>tick,deadline:Date.parse(at)+480000,fetchImpl:forbidden,
  load:()=>{sourceLoads++;if(sourceLoads===2&&(options.sourceFailure||options.afterLockFailure)){if(options.afterLockFailure)tick='2030-11-17T19:00:01Z';throw Error('synthetic_source_unavailable');}return structuredClone(packet);},
  ...(options.readSource===false?{}:{onSourceReady:(_packet:any,value:any,_at:string,available:boolean)=>{callbacks.push({kind:'source',review:value,available,at:tick});}}),
  onSourceAudit:(audit:any)=>{audits.push(audit);},onReviewObserved:(_packet:any,value:any,available:boolean)=>{callbacks.push({kind:'member',review:value,available,at:tick});},onReviewReady:()=>{ready++;}});
  assert(queryBounds.every(n=>n===256),'Existing accepted-review query cap unchanged');assert.equal(simulatedCompletions,options.local?1:0);assert.equal(ready,options.local?1:0);assert.equal(result.newlyCompletedReviews,options.local?1:0);
  assert.deepEqual(rpcs,options.local?['simulated_plan','simulated_reap']:[]);return{result,callbacks,audits,sourceLoads,acceptedReads,health:propsAiRuntimeFailure(summarizePropsAiRuntimeHealth(result,tick))};}};
}
async function main(){
 const keys=['PLAYER_PROPS_AI_SITE_ENABLED','PLAYER_PROPS_AI_PAID_RUNS_ENABLED','PLAYER_PROPS_AI_OPENAI_API_KEY'] as const,old=Object.fromEntries(keys.map(k=>[k,process.env[k]])),oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network permitted');};let cases=0;
 try{
  if(baseline){for(const sport of ['nba','nfl','mlb'] as const){const f=exercise(sport,{initial:bad.null,final:bad.null}),r=await f.run();assert(r.callbacks.every(c=>c.review===null&&c.available));assert.equal(JSON.stringify(r.result.findings),'[]');assert.equal(r.health,null);cases++;}console.log(JSON.stringify({baselineUnknownAuthorityConfirmed:true,cases,realIO:0}));return;}
  for(const sport of ['nba','nfl','mlb'] as const){
   for(const [label,inventory]of Object.entries(bad)){
    const r=await exercise(sport,{initial:inventory,final:inventory}).run();assert(r.callbacks.every(c=>!c.available&&c.review===null),`${sport}/${label} unknown must not attest empty`);assert(r.result.findings.includes('lock_prior_authority_unavailable'));assert.equal(r.health,'incomplete');cases++;
   }
   const malformed=exercise(sport);for(const mutate of [(r:any)=>{r.release='future-unsupported';},(r:any)=>{r.start='invalid';},(r:any)=>{r.players=null;},(r:any)=>{delete r.inputEvidence;},(r:any)=>{r.marketScopes=null;},(r:any)=>{r.partProvenance=[null];},(r:any)=>{r.criticalContextHashes=[];},(r:any)=>{r.marketScopes={p:['points']};r.players=[{playerId:'p'}];},(r:any)=>{r.marketScopes={p:['points']};r.players=[{playerId:'p',law:null,confidence:[],exceptions:[null],coverage:{},assessment:'Original read'}];},(r:any)=>{r.marketScopes={p:['points']};r.players=[{playerId:'p',law:null,confidence:[1],exceptions:[null],coverage:null,assessment:'Original read'}];}]){const review=malformed.review('early');mutate(review);const r=await exercise(sport,{initial:known([{result:review}]),final:known([{result:review}])}).run();assert(r.callbacks.every(c=>!c.available));assert.equal(r.health,'incomplete');cases++;}
   {const f=exercise(sport),review=f.review('early');for(const size of [255,256,257]){const rows=Array.from({length:size},()=>({result:review})),r=await exercise(sport,{initial:known(rows),final:known(rows)}).run();assert(r.callbacks.every(c=>c.available===(size===255)),'A full bounded page is unavailable; only a short valid page attests complete inventory');assert.equal(r.health,size===255?null:'incomplete');cases++;}}
   {const r=await exercise(sport).run();assert(r.callbacks.every(c=>c.available&&c.review===null));assert.equal(JSON.stringify(r.result.findings),'[]');assert.equal(r.health,null);cases++;}
   {const r=await exercise(sport,{initial:bad.null,final:known()}).run();assert.equal(r.callbacks[0].available,false);assert.equal(r.callbacks.at(-1)!.available,true,'A later real empty array is known authority');cases++;}
   {const r=await exercise(sport,{final:bad.null}).run();assert(r.callbacks.every(c=>c.available&&c.review===null),'Initial real empty array remains trusted');assert.equal(r.health,null);cases++;}
   {const f=exercise(sport,{before:'early',final:bad.null}),r=await f.run();assert(r.callbacks.every(c=>c.available&&digest(c.review)===digest(f.prior)));assert.equal(r.health,null);cases++;}
   {const f=exercise(sport,{before:'early'}),final=f.review('final'),r=await exercise(sport,{before:'early',final:known([{result:final}])}).run();assert.equal(r.callbacks[0].review.stage,'early');assert.equal(r.callbacks.at(-1)!.review.stage,'final');cases++;}
   {const r=await exercise(sport,{readSource:false,final:bad.null}).run();assert.equal(r.callbacks.length,1);assert(!r.callbacks[0].available);assert.equal(r.health,'incomplete');cases++;}
   {const f=exercise(sport,{before:'early',final:bad.null,sourceFailure:true}),r=await f.run();assert(r.result.findings.some((x:string)=>x.startsWith('current_source_unavailable:')));assert.equal(r.health,'incomplete');assert.equal(r.callbacks.length,2);assert.equal(r.callbacks[0].available,true,'The initial actual source and accepted prior are known');assert.equal(r.callbacks[1].available,false,'A failed current-source reload is unavailable publication authority, even with a trusted prior review');assert(r.callbacks.every(c=>c.review?.stage==='early'&&digest(c.review)===digest(f.prior)),'Original accepted prior remains exact; unavailable current source does not rewrite it');assert.equal(r.audits.length,1,'A captured fallback must not create a fresh current-source audit');assert.equal(r.sourceLoads,2);cases++;}
   {const f=exercise(sport,{initial:bad.null,final:bad.null,local:true}),r=await f.run();assert(!r.callbacks[0].available);assert(r.callbacks.slice(1).every(c=>c.available&&digest(c.review)===digest(f.local)),'A real successful local result retains its exact original authority');cases++;}
   {const f=exercise(sport,{local:true,final:bad.null,afterLockFailure:true}),r=await f.run();assert(r.result.findings.some((x:string)=>x.startsWith('current_source_reload_unavailable_after_ready_lock:')));assert(r.callbacks.every(c=>c.available));assert.equal(r.health,null,'Known timely local handoff stays distinct from postlock reload exception');assert.equal(digest(r.callbacks.at(-1)!.review),digest(f.local));cases++;}
   {const f=exercise(sport),legacy=f.review('early');delete (legacy as any).inputHash;delete (legacy as any).sourceGameId;delete (legacy as any).issuedAt;(legacy as any).release='player_props_ai_2026_11_08_r15_review_window_handoff';const r=await exercise(sport,{initial:known([{result:legacy}]),final:known([{result:legacy}])}).run();assert(r.callbacks.every(c=>c.available),'Optional historical fields remain optional; no law reparse');assert.equal(JSON.stringify(r.result.findings),'[]');cases++;}
  }
  console.log(JSON.stringify({acceptedReviewAuthority:true,cases,allSports:['nba','nfl','mlb'],unknownNeverEmpty:true,realEmptyPriorAndLocalAuthorityPreserved:true,finalPrecedenceAndPostlockSourceHealthPreserved:true,legacyValuesNotReparsed:true,existingQueryCap:256,realIO:0}));
 }finally{globalThis.fetch=oldFetch;for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
