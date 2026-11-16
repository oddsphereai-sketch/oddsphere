/** Future review contract proof: all provider/model/DB traffic is mocked. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PRODUCT_RELEASE,type GamePacket,type Player,type Evidence,type Quote} from '../lib/playerPropsAi/evidenceContract';
import {digest} from '../lib/playerPropsAi/evidence';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';
import {reviewSupportNavigation} from '../lib/playerPropsAi/reviewSupportNavigation';
import {sourceForecastEventConstraints,sourceForecastIssues,unqualifiedEventTail} from '../lib/playerPropsAi/forecastSanity';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {PROPS_AI_RELEASE,PROPS_AI_PRIMARY_MODEL,PROPS_AI_LAW_RELEASE,propsReviewHasMemberExecutionContracts,propsReviewHasVerifiedReaderClaims} from '../lib/playerPropsAi/releases';
import {jointReviewRequest,parseJointPlayerReview} from '../lib/playerPropsAi/request';
import {lawEventMass,lawForecast,primitives,validateLaw} from '../lib/playerPropsAi/law';
import {priceAiLaw} from '../lib/playerPropsAi/pricing';
import {runPropsReview,type AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {PropsAiJob,PropsAiReviewStore} from '../lib/playerPropsAi/budget';
import {auditPropsActorAdmissionPart,type PersistedActorAttempt} from './lib/player-props-ai-actor-admission-audit';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';

globalThis.fetch=async()=>{throw Error('Real network forbidden');};
const at='2030-06-01T16:00:00Z',v=(a:number,b=a)=>Array.from({length:16},(_,i)=>i%2?b:a),weights=v(1,3),sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function fixture(sport:GamePacket['sport']):GamePacket{
 const market=sport==='nba'?'points':sport==='nfl'?'rushing_yards':'batter_hits';
 const players:Player[]=['stable','repair'].map(id=>{
  const evidence:Evidence[]=sport==='mlb'?[{id:`${id}:batter_hits:recentForm`,kind:'recent_games',source:'Synthetic same-market games',availableAt:at,value:{logs:[2,4,6].map((value,i)=>({gameId:`g${i}`,date:`2030-05-${27+i}`,opponent:'B',homeAway:'home',value,plateAppearances:7}))}}]
   :[2,4,6].map<Evidence>((value,i)=>{const box:Record<string,number>=sport==='nba'?{minutes:30,points:value}:{rushing_yards:value};return{id:`${id}:game:${i}`,kind:'recent_games',source:'Synthetic canonical played games',availableAt:at,value:{game:{startTime:`2030-05-${27+i}T23:00:00Z`,awayTeam:'A',homeTeam:'B'},box}};});
  evidence.push({id:`${id}:prior`,kind:'independent_model',source:'Synthetic same-event prior',availableAt:at,value:{market,line:3.5,independentProjection:4,independentOver:.55,independentUnder:.45}});
  return{id,name:`Synthetic ${id}`,team:'A',opponent:'B',markets:[market],evidence,missing:[]};
 });
 const quotes:Quote[]=players.flatMap(player=>['over','under'].map(side=>({id:`${player.id}:${side}`,playerId:player.id,market,provider:'synthetic',book:'SyntheticBook',line:3.5,side:side as 'over'|'under',american:-110,observedAt:at,receivedAt:at,receivedAtProvenance:'provider_response',live:false,opening:false})));
 return{release:PRODUCT_RELEASE,sport,gameId:`synthetic-${sport}-support`,start:'2030-06-01T23:00:00Z',lock:'2030-06-01T22:00:00Z',stage:'final',cutoff:at,players,quotes,sourceLimitations:[]};
}
function rawActor(p:GamePacket,player:Player,bad=false,under=false){
 const outcomes=Object.fromEntries(primitives(p.sport,player).map(stat=>[stat,v(0)]));
 const key=p.sport==='mlb'?'batter_singles':player.markets[0];outcomes[key]=bad?v(9):under?v(6,2):v(2,6);
 const aliases=new Map([...evidenceAliases(p)].map(([a,id])=>[id,a]));
 return verifiedReaderFixture(p,player.id,{priorRead:Object.fromEntries(independentPriorEvents(player).map(e=>[aliases.get(e.sourceId)!,e.preferredOutcome])),evidenceIds:[aliases.get(player.evidence[0].id)!],gaps:[],law:encodeCanonicalScenarioLaw(p.sport,player,{weights,outcomes}),confidence:[1],exceptions:[null]});
}
let scenarioControls=0;
for(const sport of ['nba','nfl','mlb'] as const){
 const p=fixture(sport),before=digest(p),nav=reviewSupportNavigation(p),input=JSON.parse(jointReviewRequest(p,PROPS_AI_PRIMARY_MODEL,7000).input);
 assert.deepEqual(input.reviewSupportNavigation,nav);assert.equal(nav.players.length,2);
 for(const actor of nav.players){assert.equal(actor.eventRequirements.length,2);assert.deepEqual(actor.eventRequirements.map(e=>e.rule),['both_sides_positive','priced_complement_or_push']);assert(actor.eventRequirements.every(e=>e.marketIndex===0&&e.line===3.5&&e.comparison==='ordinary'));assert.equal(actor.unavailableNumericActions.length,0);}
 const richer=structuredClone(p);richer.executionQuotes=[...p.quotes,{...p.quotes[0],id:'execution-only-unseen-line',line:900}];assert.deepEqual(reviewSupportNavigation(richer),nav,'Full execution universe must not become prompt evidence');
 for(const [change,included] of [[{opening:true},false],[{live:true},false],[{receivedAtProvenance:'collection_start'},false],[{receivedAt:'2030-06-01T16:00:00.001Z'},false],[{receivedAt:'2030-06-01T15:44:59.999Z'},false],[{receivedAt:'2030-06-01T15:45:00.000Z'},true]] as const){
  const q=structuredClone(p);q.quotes=q.quotes.map(v=>({...v,...change}));assert.equal(reviewSupportNavigation(q).players[0].eventRequirements.some(e=>e.source.kind==='priced_event'),included);scenarioControls++;
 }
 for(const under of [false,true]){
  const accepted=parseJointPlayerReview(p,p.players[0].id,rawActor(p,p.players[0],false,under));assert(accepted.law);assert.equal(sourceForecastIssues(p,p.players[0],accepted.law).length,0);
  const priced=priceAiLaw({law:accepted.law,market:p.players[0].markets[0],quotes:p.quotes.filter(q=>q.playerId===p.players[0].id).map(q=>({id:q.id,book:q.book,provider:q.provider,line:q.line,side:q.side,american:q.american,availableAt:at,confirmedAt:at,current:true,actionRule:'qualifying_participation'})),now:at,maxAgeMs:900000,confidence:1,exception:null});
  assert(priced&&priced.quote.side===(under?'under':'over')&&priced.grade==='Lean');scenarioControls++;
 }
 assert.equal(digest(p),before,'Navigation must never alter source');
}
// Exact positive-mass contracts differ: a priced integer push can oppose a
// decisive outcome; an uncertain independent prior still requires BOTH tails.
for(const over of [0,1,3])for(const under of [0,1,3])for(const push of [0,1,3])for(const oneWay of [false,true]){
 if(over+under+push===0)continue;const f={over,under,push};assert.equal(!unqualifiedEventTail(f,oneWay),(oneWay?over>0:Math.max(over,under)>0)&&(push>0||over>0&&under>0));scenarioControls++;
}
// A priced integer event with decisive+push mass is valid, whereas the SAME
// event with an uncertain independent prior still needs both non-push tails.
const integerPacket=fixture('nfl');integerPacket.players=integerPacket.players.slice(0,1);integerPacket.players[0].evidence=integerPacket.players[0].evidence.filter(e=>e.kind!=='independent_model');integerPacket.quotes=integerPacket.quotes.filter(q=>q.playerId==='stable').map(q=>({...q,line:4}));
for(const values of [v(2,4),v(4,6)]){
 const law=validateLaw('nfl',integerPacket.players[0],{weights,outcomes:{rushing_yards:values}}),mass=lawEventMass(law,'rushing_yards',4),f=lawForecast(law,'rushing_yards',4);
 assert(mass.push>0&&mass.over+mass.under>0);assert.equal(sourceForecastIssues(integerPacket,integerPacket.players[0],law).length,0);
 const withPrior=structuredClone(integerPacket);withPrior.players[0].evidence.push({id:'integer-prior',kind:'independent_model',source:'Synthetic uncertain exact event',availableAt:at,value:{market:'rushing_yards',line:4,independentOver:.5,independentUnder:.5}});
 assert(sourceForecastIssues(withPrior,withPrior.players[0],law).some(i=>i.code==='unsupported_zero_probability_tail'));assert.equal(f.push,mass.push/mass.total);scenarioControls+=4;
}
const allPush=validateLaw('nfl',integerPacket.players[0],{weights,outcomes:{rushing_yards:v(4)}});assert(sourceForecastIssues(integerPacket,integerPacket.players[0],allPush).some(i=>i.code==='unsupported_priced_event_certainty'));
// Negative net-yard units keep their true signed comparisons.
const negative=fixture('nfl');negative.players=negative.players.slice(0,1);negative.players[0].evidence=negative.players[0].evidence.filter(e=>e.kind==='recent_games').map((e,i)=>({...e,value:{game:{startTime:`2030-05-${27+i}T23:00:00Z`,homeTeam:'A',awayTeam:'B'},box:{rushing_yards:-6+2*i}}}));negative.quotes=negative.quotes.filter(q=>q.playerId==='stable').map(q=>({...q,line:-3.5}));
const negativeLaw=validateLaw('nfl',negative.players[0],{weights,outcomes:{rushing_yards:v(-6,-2)}});assert.equal(sourceForecastIssues(negative,negative.players[0],negativeLaw).length,0);assert(reviewSupportNavigation(negative).players[0].eventRequirements.every(e=>e.line===-3.5&&e.comparison==='ordinary'));scenarioControls+=2;
// One-way Anytime TD uses the own non-passing 0/1 indicator and inclusive
// comparison. A zero-weight positive value cannot pretend to supply support.
const binary=fixture('nfl');binary.players=binary.players.slice(0,1).map(p=>({...p,markets:['anytime_td'],evidence:[{id:'td-prior',kind:'independent_model',source:'Synthetic exact binary prior',availableAt:at,value:{market:'anytime_td',line:.5,selectedSide:'yes',independentSelectedSideProbability:.1}}]}));binary.quotes=[{...binary.quotes[0],market:'anytime_td',side:'yes',line:.5}];
const binaryRequirements=sourceForecastEventConstraints(binary,binary.players[0],PROPS_AI_LAW_RELEASE);assert.equal(binaryRequirements.length,2);assert(binaryRequirements.every(e=>e.inclusive&&e.contract==='milestone'));assert(reviewSupportNavigation(binary).players[0].eventRequirements.every(e=>e.comparison==='inclusive'));
for(const outcomes of [v(0),v(1)]){const law=validateLaw('nfl',binary.players[0],{weights,outcomes:{touchdowns:outcomes}});assert.equal(sourceForecastIssues(binary,binary.players[0],law).filter(i=>i.code.includes('tail')||i.code.includes('certainty')).length,2);scenarioControls++;}
const genericBinary=structuredClone(binary);genericBinary.quotes=genericBinary.quotes.map(q=>({...q,side:'over',line:1}));const genericRequirement=sourceForecastEventConstraints(genericBinary,genericBinary.players[0],PROPS_AI_LAW_RELEASE).find(e=>e.origin==='priced_event')!;assert.equal(genericRequirement.contract,'two_way','Preserve original diagnostic label');assert.equal(genericRequirement.inclusive,true,'Anytime indicator always uses its actual inclusive law math');assert(reviewSupportNavigation(genericBinary).players[0].eventRequirements.every(e=>e.comparison==='inclusive'));scenarioControls+=3;
const zeroWeight=validateLaw('nfl',binary.players[0],{weights:[0,...Array(15).fill(1)],outcomes:{touchdowns:[1,...Array(15).fill(0)]}});assert(sourceForecastIssues(binary,binary.players[0],zeroWeight).some(i=>i.code==='unsupported_zero_probability_tail'));scenarioControls++;

const supportPacket=fixture('nfl'),qb=supportPacket.players[0];qb.markets=['passing_tds','interceptions','rushing_yards'];
const action=reviewSupportNavigation(supportPacket).players[0];assert.deepEqual(action.unavailableNumericActions.map(a=>a.marketIndex),[0,1]);assert(action.unavailableNumericActions.every(a=>a.action.includes(`exceptions[${a.marketIndex}]`)&&a.action.includes('forecast_declined')));assert(!action.unavailableNumericActions.some(a=>a.market==='rushing_yards'));
for(const old of ['player_props_ai_2026_11_16_r45_explicit_abstention','player_props_ai_2026_11_16_r44_hibner_official_alias']){assert(propsReviewHasMemberExecutionContracts(old));assert(propsReviewHasVerifiedReaderClaims(old));}

async function retainedCase(sport:GamePacket['sport'],under:boolean,unknown=false){
 const p=fixture(sport),before=digest(p),first={wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(p.players.map(a=>[a.id,rawActor(p,a,a.id==='repair',under)]))},second={wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(p.players.map(a=>[a.id,rawActor(p,a,a.id==='stable',under)]))};
 const originalStable=parseJointPlayerReview(p,'stable',first.players.stable);assert.throws(()=>parseJointPlayerReview(p,'stable',second.players.stable));
 const job={job_key:`synthetic-${sport}-${under}-${unknown}`,sport,game_id:p.gameId,game_day:'2030-06-01',stage:'final',scheduled_start:p.start,lock_at:p.lock,state:'pending',model:PROPS_AI_PRIMARY_MODEL,requested_tier:'default',parts:1} as PropsAiJob;
 const attempts:PersistedActorAttempt[]=[],requests:string[]=[];let phase=0,finished:unknown=null;
 const store:PropsAiReviewStore={claim:async()=>({claimed:true,token:'synthetic',job}),send:async(_k,_t,n,part)=>{phase=n;return{id:`synthetic-${n}`,model:PROPS_AI_PRIMARY_MODEL,requested_tier:'default',reserved_micro:100000,part};},receipt:async(id,_t,actual,response,usage)=>{attempts.push({id,phase,part:1,state:actual===null?'unknown':'completed',model:PROPS_AI_PRIMARY_MODEL,requested_tier:'default',response_id:response,actual_micro:unknown&&phase===1?null:actual,usage});if(unknown&&phase===1)throw Error('Synthetic lost receipt acknowledgement');},fallback:async()=>true,finish:async(_k,_t,result,error)=>{finished=result;if(!unknown)assert.equal(error,null);return{...job,state:result?'completed':'failed',result};}};
 const fetchImpl:typeof fetch=async(url,options)=>{assert.equal(String(url),'https://api.openai.com/v1/responses');requests.push(String(options?.body));const body=JSON.parse(String(options?.body));return Response.json({id:`synthetic-response-${phase}`,model:body.model,status:'completed',service_tier:'default',usage:{input_tokens:1200,output_tokens:500},output:[{content:[{type:'output_text',text:JSON.stringify(phase===1?first:second)}]}]});};
 const result=await runPropsReview({packet:p,job,store,key:'synthetic-no-real-key',writerRunId:'synthetic',preferStronger:false,deadline:Date.now()+360000,clock:()=>at,prepare:async()=>[{packet:p,inputTokens:1500}],fetchImpl});
 if(unknown){assert.notEqual(result.status,'completed');assert.equal(requests.length,1);assert.equal(finished,null);return{sport,under,blockedUnknown:true};}
 assert.equal(result.status,'completed');assert.equal(requests.length,2);assert.equal(JSON.parse(requests[0]).input,JSON.parse(requests[1]).input);assert(attempts.every(a=>(a.usage as {actorAdmissionEvidence?:unknown}).actorAdmissionEvidence));
 const review=finished as AcceptedGameReview|null;assert(review);assert.deepEqual(review.players.find(a=>a.playerId==='stable'),originalStable,'Valid actor must retain the exact original law/claims/confidence/qualification');assert.equal(review.partProvenance.length,2);assert.deepEqual(review.partProvenance.map(a=>a.playerIds),[['stable'],['repair']]);
 const audit=auditPropsActorAdmissionPart({packet:p,attempts,provenance:review.partProvenance});assert(audit.complete);assert.deepEqual(audit.review.players,review.players);assert.equal(audit.verifiedAttempts,2);assert.equal(digest(p),before);
 const forged=structuredClone(attempts);(forged[1].usage as {actorAdmissionEvidence:{consumedActorIds:string[]}}).actorAdmissionEvidence.consumedActorIds=['stable','repair'];assert.throws(()=>auditPropsActorAdmissionPart({packet:p,attempts:forged,provenance:review.partProvenance}));
 const unknownCharge=structuredClone(attempts);unknownCharge[0].actual_micro=null;unknownCharge[0].state='unknown';assert.throws(()=>auditPropsActorAdmissionPart({packet:p,attempts:unknownCharge,provenance:review.partProvenance}));
 return{sport,under,completeActors:2,knownReceipts:2,positiveGradeRecovery:true,stableLawHash:originalStable.law?.hash,requestHash:sha(requests[0])};
}
async function main(){const results=[];for(const sport of ['nba','nfl','mlb'] as const){for(const under of [false,true])results.push(await retainedCase(sport,under));results.push(await retainedCase(sport,false,true));}console.log(JSON.stringify({release:PROPS_AI_RELEASE,eventSupportControls:scenarioControls,realReviewerCases:results.length,retainedValidActorsAndRepairedActors:12,primaryRequests:9,correctionRequests:6,allHttpMocked:true,paidCalls:0,productionWrites:0,results}));}
void main().catch(e=>{console.error(e);process.exitCode=1;});
