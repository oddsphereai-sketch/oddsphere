/** Actual empty NBA source -> site runtime; every HTTP/SQL operation is mocked. */
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {liveNbaPacket} from '../lib/playerPropsAi/liveSources';
import {reviewPropsForSite} from '../lib/playerPropsAi/siteRuntime';
import {PROPS_AI_CONTROL_RELEASE} from '../lib/playerPropsAi/siteConfig';
import {PROPS_AI_CALENDAR_RELEASE,type PropsCalendar} from '../lib/playerPropsAi/calendar';
import {testNbaSourceAuthority} from '../lib/playerPropsAi/nbaLockAuthority';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import {digest} from '../lib/playerPropsAi/evidence';
globalThis.fetch=async()=>{throw Error('Empty-source proof forbids network');};
const now='2030-11-17T17:40:00Z',start='2030-11-17T19:00:00Z',lock='2030-11-17T18:00:00Z';
const game={id:'native-nba',start,home:'BOS',away:'NYK'};
const sourceArgs={game,window:{gameId:game.id,stage:'final',cutoff:now,lock},snapshot:{generatedAt:now,slateDate:'2030-11-17',games:[{gameId:game.id,scheduledStart:start,homeTeam:'BOS',awayTeam:'NYK'}],decisions:[{gameId:game.id,playerId:'nba-bdl-player:1',playerName:'Synthetic Known Native',team:'BOS',opponent:'NYK',market:'points',line:20.5,side:'over',independentSide:'over',independentProbability:.6,independentProjection:23,evaluatedAt:now,modelRelease:'synthetic native',role:[],production:[],matchup:[],lockedAt:null}]},market:{updatedAt:now,observations:[]},prior:{updatedAt:now,games:[],boxes:[],advanced:[],players:[]},current:{updatedAt:now,games:[],boxes:[],advanced:[],players:[]},currentObservations:[]} as unknown as Parameters<typeof liveNbaPacket>[0];
const original=digest(sourceArgs),empty=liveNbaPacket(sourceArgs);
assert.equal(empty.sourceOfferSetStatus,'empty');assert.equal(empty.players.length,1);assert.equal(empty.executionQuotes?.length,0);assert.equal(digest(sourceArgs),original);
async function run(packet:GamePacket,short=false){
 let counts=0,claims=0,generations=0,sources=0,observed=0;const sport=packet.sport;
 const calendar:PropsCalendar={release:PROPS_AI_CALENDAR_RELEASE,month:'2030-11',capturedAt:now,games:[{sport,id:`espn:${sport}:1`,start,lock,home:'BOS',away:'NYK',confirmed:true}],sources:{nba:{complete:true,source:'synthetic'},nfl:{complete:true,source:'synthetic'},mlb:{complete:true,source:'synthetic'}}};
 const job={job_key:`props-ai|${sport}|espn:${sport}:1|2030-11-17|final`,sport,game_id:`espn:${sport}:1`,game_day:'2030-11-17',stage:'final',scheduled_start:start,lock_at:lock,due_at:'2030-11-17T17:35:00Z',billing_month:'2030-11',state:'pending'};
 const client={from(table:string){let selection='';const q={select(s:string){selection=s;return q;},eq(){return q;},gte(){return q;},in(){return q;},lte(){return q;},gt(){return q;},order(){return q;},limit(){return q;},single:async()=>({data:{release:PROPS_AI_CONTROL_RELEASE,paid_enabled:true},error:null}),maybeSingle:async()=>({data:{release:calendar.release,captured_at:now,payload:calendar},error:null}),then(resolve:(r:unknown)=>unknown,reject:(e:unknown)=>unknown){assert.equal(table,'player_props_ai_reviews');return Promise.resolve({data:selection==='*'?[job]:[],error:null}).then(resolve,reject);}};return q;},rpc:async(name:string)=>{
  if(name==='player_props_ai_plan_v4')return{data:{funded:true},error:null};if(name==='player_props_ai_reap')return{data:0,error:null};
  if(name==='player_props_ai_claim'){claims++;return{data:{claimed:false,reason:'synthetic control leaves slot pending'},error:null};}throw Error('Unexpected RPC '+name);
 }} as unknown as SupabaseClient;
 const fetchImpl:typeof fetch=async url=>{if(String(url).endsWith('/input_tokens')){counts++;return Response.json({input_tokens:1000});}generations++;throw Error('No generation/provider request is allowed');};
 const result=await reviewPropsForSite({client,sport,writerRunId:'synthetic-owner',games:[game],clock:()=>now,deadline:Date.now()+(short?125000:300000),fetchImpl,load:(_g,w)=>({...structuredClone(packet),cutoff:w.cutoff,stage:w.stage}),onSourceReady:p=>{sources++;if(p.sport==='nba'&&p.sourceOfferSetStatus==='empty'){const frame=testNbaSourceAuthority(()=>now)(p,null);assert.equal(frame.observations.length,1);assert.equal(frame.observations[0].quotes.length,0);}},onReviewObserved:()=>{observed++;}});
 return{counts,claims,generations,sources,observed,result};
}
async function main(){
 Object.assign(process.env,{NODE_ENV:'test',PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'true',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic'});
 const noOffers=await run(empty);assert.equal(noOffers.counts,0);assert.equal(noOffers.claims,0);assert.equal(noOffers.generations,0);assert.equal(noOffers.sources,1);assert.equal(noOffers.observed,1);assert(noOffers.result.findings.includes('review_deferred_empty_current_offers:native-nba'));assert.equal(noOffers.result.games[0].packet.sourceOfferSetStatus,'empty');
 const legacy=structuredClone(empty);delete legacy.sourceOfferSetStatus;const unchanged=await run(legacy);assert.equal(unchanged.counts,2,'Existing primary and optional stronger input counts remain unchanged for this gapped final source');assert.equal(unchanged.claims,1);assert.equal(unchanged.generations,0,'A synthetic refused claim must not dispatch generation');
 const positive=await run({...empty,sourceOfferSetStatus:'nonempty'});assert.equal(positive.counts,unchanged.counts);assert.equal(positive.claims,1);
 const short=await run(legacy,true);assert.equal(short.counts,0);assert.equal(short.claims,0,'Existing deadline refusal remains unchanged');
 const nfl:GamePacket={...legacy,sport:'nfl',sourceOfferSetStatus:'empty',players:[{id:'nfl-bdl-player:1',name:'Synthetic Receiver',team:'BOS',opponent:'NYK',markets:['receptions'],missing:[],evidence:[{id:'nfl-source',kind:'recent_games',availableAt:now,source:'synthetic source',value:{game:{start:'2030-11-16T19:00:00Z',home:'BOS',away:'NYK'},box:{receptions:5}}}]}]};
 const otherSport=await run(nfl);assert.equal(otherSport.counts,1);assert.equal(otherSport.claims,1,'New NBA metadata cannot change other-sport scheduled admission');
 assert.equal(digest(sourceArgs),original);console.log('NBA empty-source runtime passed: actual successful empty source emits withdrawal-only authority, zero count/claim/generation, known callback/reader scopes retained, source bytes exact, legacy/nonempty/other-sport and short-deadline controls unchanged. All HTTP/SQL mocked.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
