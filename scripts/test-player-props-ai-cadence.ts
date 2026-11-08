/** Due-job scheduling hint only. No database, provider, OpenAI or paid request. */
import assert from 'node:assert/strict';
import {hasDuePropsAiReview} from '../lib/playerPropsAi/dueReview';
import {PROPS_AI_CONTROL_RELEASE} from '../lib/playerPropsAi/siteConfig';
import {planNflPlayerPropsRefresh} from '../lib/services/football/nflPlayerPropsCadence';
import {NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE} from '../lib/services/football/nflPlayerPropsProductionContract';
const now='2026-11-08T19:51:00Z';
function client({paid=true,release=PROPS_AI_CONTROL_RELEASE,pending=true,error=false}={}){
 type Query={select:(...a:unknown[])=>Query;eq:(...a:unknown[])=>Query;lte:(...a:unknown[])=>Query;gt:(...a:unknown[])=>Query;single:()=>Promise<{data:{paid_enabled:boolean;release:string};error:object|null}>;limit:(n:number)=>Promise<{data:{job_key:string}[];error:object|null}>};
 const calls:unknown[][]=[];
 const value={from:(table:string)=>{calls.push(['from',table]);const chain:Query={select:(...a:unknown[])=>{calls.push(['select',...a]);return chain;},eq:(...a:unknown[])=>{calls.push(['eq',...a]);return chain;},lte:(...a:unknown[])=>{calls.push(['lte',...a]);return chain;},gt:(...a:unknown[])=>{calls.push(['gt',...a]);return chain;},single:async()=>({data:{paid_enabled:paid,release},error:error?{}:null}),limit:async(n:number)=>{calls.push(['limit',n]);return {data:pending?[{job_key:'synthetic-final'}]:[],error:error?{}:null};}};return chain;}};
 return {value:value as never,calls};
}
async function main(){
 const old={site:process.env.PLAYER_PROPS_AI_SITE_ENABLED,paid:process.env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED,key:process.env.PLAYER_PROPS_AI_OPENAI_API_KEY};
 try{
 process.env.PLAYER_PROPS_AI_SITE_ENABLED='false';process.env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED='true';process.env.PLAYER_PROPS_AI_OPENAI_API_KEY='synthetic';
 const off=client();assert.equal(await hasDuePropsAiReview({client:off.value,sport:'nfl',now}),false);assert.equal(off.calls.length,0);
 process.env.PLAYER_PROPS_AI_SITE_ENABLED='true';const dbOff=client({paid:false});assert.equal(await hasDuePropsAiReview({client:dbOff.value,sport:'nfl',now}),false);assert.equal(dbOff.calls.filter(c=>c[0]==='from').length,1);
 const wrong=client({release:'old' as typeof PROPS_AI_CONTROL_RELEASE});assert.equal(await hasDuePropsAiReview({client:wrong.value,sport:'nfl',now}),false);
 const done=client({pending:false});assert.equal(await hasDuePropsAiReview({client:done.value,sport:'nfl',now}),false);
 const due=client();const hint=await hasDuePropsAiReview({client:due.value,sport:'nfl',now});assert.equal(hint,true);
 for(const filter of [['eq','sport','nfl'],['eq','game_day','2026-11-08'],['eq','state','pending'],['lte','due_at',now],['gt','lock_at',now],['limit',1]])assert.ok(due.calls.some(c=>JSON.stringify(c)===JSON.stringify(filter)),JSON.stringify(filter));
 const previous={release:NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE,generatedAt:'2026-11-08T19:40:00Z',board:{decisions:[{state:'unlocked',scheduledStart:'2026-11-08T21:05:00Z',lockAt:'2026-11-08T20:05:00Z'}]}} as never;
 assert.equal(planNflPlayerPropsRefresh({now,previous}).run,false);
 assert.equal(planNflPlayerPropsRefresh({now,previous,propsAiReviewDue:hint}).reason,'ai_review_due');
 assert.equal(planNflPlayerPropsRefresh({now,previous,propsAiReviewDue:false}).reason,'not_due');
 const failing=client({error:true});await assert.rejects(hasDuePropsAiReview({client:failing.value,sport:'nfl',now}),/control_read_failed/);
 process.env.PLAYER_PROPS_AI_PAID_RUNS_ENABLED='false';const paidOff=client();assert.equal(await hasDuePropsAiReview({client:paidOff.value,sport:'nfl',now}),false);assert.equal(paidOff.calls.length,0);
 console.log('AI cadence proof passed: 4:05 kickoff final window cannot be skipped by a fresh independent snapshot; same-day pending/pre-lock/read-only limits and disabled zero-I/O hold. No network calls.');
 }finally{for(const [k,v] of Object.entries({PLAYER_PROPS_AI_SITE_ENABLED:old.site,PLAYER_PROPS_AI_PAID_RUNS_ENABLED:old.paid,PLAYER_PROPS_AI_OPENAI_API_KEY:old.key}))if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
void main();
