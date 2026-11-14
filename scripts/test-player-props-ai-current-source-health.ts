/** Actual shared runtime: current-source failure cannot hide behind native continuity. */
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {reviewPropsForSite} from '../lib/playerPropsAi/siteRuntime';
import {PROPS_AI_CONTROL_RELEASE} from '../lib/playerPropsAi/siteConfig';
import {PRODUCT_RELEASE,type Sport} from '../lib/playerPropsAi/evidenceContract';
import {summarizePropsAiRuntimeHealth,propsAiRuntimeFailure} from '../lib/playerPropsAi/runtimeHealth';
import {nbaPlayerPropsRefreshFailure,nflPlayerPropsRefreshFailure,mlbPlayerPropsRefreshFailure} from '../lib/cron/playerPropsRefreshTelemetry';
globalThis.fetch=async()=>{throw Error('Source health proof forbids HTTP');};
async function exercise(sport:Sport){
 const at='2030-11-17T17:36:00.000Z',game={id:`synthetic-${sport}`,start:'2030-11-17T20:00:00.000Z',away:'A',home:'B'};
 let loads=0,sourceReady=0;
 type Result={data:unknown[];error:null};
 const query={select(){return this;},eq(){return this;},gte(){return this;},order(){return this;},limit(){return this;},
  single:async()=>({data:{paid_enabled:true,release:PROPS_AI_CONTROL_RELEASE},error:null}),
  then(resolve:(r:Result)=>unknown,reject:(e:unknown)=>unknown){return Promise.resolve({data:[],error:null} as Result).then(resolve,reject);}};
 const client={from:()=>query,rpc:()=>{throw Error('No calendar/count/generation/SQL write is permitted');}} as unknown as SupabaseClient;
 const outcome=await reviewPropsForSite({client,writerRunId:'synthetic-only',deadline:Date.now()+39000,sport,games:[game],clock:()=>at,
  load:(_game,window,context)=>{loads++;if(context?.purpose==='member_publication')throw Error('synthetic_current_source_failure');return{release:PRODUCT_RELEASE,sport,gameId:game.id,start:game.start,lock:window.lock,cutoff:window.cutoff,stage:window.stage,players:[],quotes:[],sourceLimitations:[]};},
  onSourceReady:()=>{sourceReady++;}});
 assert.equal(loads,2);assert.equal(sourceReady,1);assert.equal(outcome.status,'active');assert.equal(outcome.newlyCompletedReviews,0);
 assert.deepEqual(outcome.findings,[`current_source_unavailable:${game.id}:unclassified`]);
 const health=summarizePropsAiRuntimeHealth(outcome,at);assert.equal(propsAiRuntimeFailure(health),'incomplete');
 const result={aiReviewRuntime:health};
 assert.match(nflPlayerPropsRefreshFailure(result)!,/source|preparation/);assert.match(mlbPlayerPropsRefreshFailure(result)!,/source verification/);
 assert.match(nbaPlayerPropsRefreshFailure({status:'published_private',aiReviewRuntime:{...health,findings:[...health.findings]}})!,/source verification/);
}
async function main(){const keys=['PLAYER_PROPS_AI_SITE_ENABLED','PLAYER_PROPS_AI_PAID_RUNS_ENABLED','PLAYER_PROPS_AI_OPENAI_API_KEY'] as const,prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));Object.assign(process.env,{PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'true',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-never-real'});try{for(const sport of ['nba','nfl','mlb'] as const)await exercise(sport);console.log('All-sport source health passed: actual prelock load failure, zero newly completed reviews, initial successful source handoff cannot hide later source failure, native continuity unchanged; no HTTP or paid requests.');}finally{for(const key of keys){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}}
void main().catch(error=>{console.error(error);process.exitCode=1;});
