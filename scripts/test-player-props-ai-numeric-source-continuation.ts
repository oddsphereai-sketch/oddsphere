/** Synthetic future request/real reviewer proof. Every HTTP call is mocked. */
import assert from 'node:assert/strict';
import {PRODUCT_RELEASE,type GamePacket,type Evidence} from '../lib/playerPropsAi/evidenceContract';
import {digest} from '../lib/playerPropsAi/evidence';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {primitives,validateLaw} from '../lib/playerPropsAi/law';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {PROPS_AI_RELEASE,PROPS_AI_PRIMARY_MODEL,propsReviewHasMemberExecutionContracts,propsReviewHasVerifiedReaderClaims} from '../lib/playerPropsAi/releases';
import {sourceForecastIssues,sourceMeanAdmissionSupport} from '../lib/playerPropsAi/forecastSanity';
import {numericSourceNavigation} from '../lib/playerPropsAi/numericSourceNavigation';
import {sourceAwareDiagnosticCorrection} from '../lib/playerPropsAi/sourceAwareCorrectionFeedback';
import {reviewCorrectionFeedback} from '../lib/playerPropsAi/reviewCorrectionFeedback';
import {completeDiagnosticCorrection} from '../lib/playerPropsAi/completeCorrectionFeedback';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';
import {jointReviewRequest,parseJointReview,parseJointPlayerReview} from '../lib/playerPropsAi/request';
import {runPropsReview} from '../lib/playerPropsAi/reviewer';
import type {PropsAiJob,PropsAiReviewStore} from '../lib/playerPropsAi/budget';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';
globalThis.fetch=async()=>{throw Error('Real network forbidden');};
const at='2030-06-01T16:00:00Z',v=(a:number,b=a)=>Array.from({length:16},(_,i)=>i%2?b:a);
function packet(count=1):GamePacket{return{release:PRODUCT_RELEASE,sport:'nfl',gameId:'synthetic-qb-source-contract',start:'2030-06-01T23:00:00Z',lock:'2030-06-01T22:00:00Z',stage:'final',cutoff:at,quotes:[],sourceLimitations:[],players:Array.from({length:count},(_,i)=>{
 const id=`p${i}`,markets=['passing_attempts','passing_completions','passing_yards','passing_tds','interceptions'];
 const evidence:Evidence[]=[...[22,26,28].map((attempts,j)=>({id:`${id}:log${j}`,kind:'recent_games' as const,source:'Synthetic played game',availableAt:at,value:{game:{startTime:`2030-05-${27+j}T23:00:00Z`,awayTeam:'A',homeTeam:'B'},box:{passing_attempts:attempts,passing_completions:16+j,passing_yards:180+20*j}}})),...markets.slice(0,3).map((market,j)=>({id:`${id}:prior:${j}`,kind:'independent_model' as const,source:'Synthetic same-unit prior',availableAt:at,value:{market,independentProjection:[27,17,200][j],line:[25.5,17.5,199.5][j],independentOver:.5,independentUnder:.5}}))];
 return{id,name:'Synthetic QB',team:'A',opponent:'B',markets,missing:[],evidence};})};}
function draft(p:GamePacket,valid=false){const aliases=new Map([...evidenceAliases(p)].map(([a,id])=>[id,a]));return{wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(p.players.map(player=>[player.id,verifiedReaderFixture(p,player.id,{priorRead:Object.fromEntries(independentPriorEvents(player).map(e=>[aliases.get(e.sourceId)!,e.preferredOutcome])),evidenceIds:[aliases.get(player.evidence[0].id)!],gaps:[],confidence:[1,1,1,0,0],exceptions:[null,null,null,'forecast_declined','forecast_declined'],law:encodeCanonicalScenarioLaw('nfl',player,{weights:v(1),outcomes:{passing_attempts:valid?v(22,28):v(32),passing_completions:v(16,18),passing_yards:v(180,220),passing_tds:v(0,1),interceptions:v(0,1)}})})]))};}
const p=packet(),bad=draft(p),good=draft(p,true),before=digest({p,bad,good}),support=sourceMeanAdmissionSupport(p,p.players[0]),nav=numericSourceNavigation(p)!;
assert.deepEqual(nav.players[0].markets.map(m=>m.market),p.players[0].markets);
for(const row of nav.players[0].markets)assert.deepEqual(row.meanAdmissionSupport,support[row.market]);
assert.equal(support.passing_attempts.minimum,22);assert.equal(support.passing_attempts.maximum,28);
assert.equal(support.passing_tds.state,'unavailable');assert.equal(support.interceptions.state,'unavailable');
assert(nav.coordinateMeaning.includes('non_touchdown_completions+passing_tds+interceptions+other_incomplete_passes'));
const old=completeDiagnosticCorrection(p,bad),next=sourceAwareDiagnosticCorrection(p,bad);
assert.equal(old.status,'ready');assert.equal(next.status,'ready');if(old.status!=='ready'||next.status!=='ready')throw Error();
assert(!old.text.includes('Previously valid'));assert(next.text.startsWith(old.text));assert(next.text.includes('P0 M3,4'));
assert(next.bytes<=1984);assert(!next.text.includes('Synthetic QB'));assert.equal(next.bytes,Buffer.byteLength(next.text));
const request=jointReviewRequest(p,PROPS_AI_PRIMARY_MODEL,7000,'failed',next.text),input=JSON.parse(request.input);
assert.deepEqual(input.numericSourceNavigation,nav);assert(request.instructions.includes('new prose role adjustment or team total cannot waive'));
assert(!request.instructions.includes('needs a new supported quantitative role input'));assert(request.instructions.endsWith(next.text));
assert.equal(request.input,jointReviewRequest(p,PROPS_AI_PRIMARY_MODEL,7000).input);
assert.throws(()=>parseJointReview(p,bad),/mean/);const parsed=parseJointReview(p,good);
assert.deepEqual(parsed.players[0].sourceDeclinedMarkets,['passing_tds','interceptions']);
assert.equal(parsed.players[0].law?.weights.length,16);assert.equal(parsed.players[0].confidence.length,5);
const reopened=structuredClone(good);reopened.players.p0.exceptions[3]=null;assert.throws(()=>parseJointReview(p,reopened),/support/);
const noExceptions=structuredClone(bad);noExceptions.players.p0.exceptions[3]=null;noExceptions.players.p0.exceptions[4]=null;
const noRetain=sourceAwareDiagnosticCorrection(p,noExceptions);assert.equal(noRetain.status,'ready');if(noRetain.status==='ready'){assert(!noRetain.text.includes('Previously valid'));assert(noRetain.text.includes('passing_tds'));}
const unsafe=structuredClone(bad);Object.assign(unsafe.players.p0.exceptions,{3:'fabricated-reason'});const unsafeResult=sourceAwareDiagnosticCorrection(p,unsafe);if(unsafeResult.status==='ready')assert(!unsafeResult.text.includes('Previously valid'));
const many=packet(40),overflow=sourceAwareDiagnosticCorrection(many,draft(many));assert.equal(overflow.status,'unavailable');if(overflow.status==='unavailable'){assert.equal(overflow.reason,'feedback_exceeds_cushion');assert(!('text'in overflow));}
const nba=structuredClone(p);nba.sport='nba';assert.equal(numericSourceNavigation(nba),null);
const mlb:GamePacket={...structuredClone(p),sport:'mlb',players:[{...structuredClone(p.players[0]),markets:['batter_home_runs'],evidence:[{id:'p0:batter_home_runs:recentForm',kind:'recent_games',source:'Synthetic tagged game',availableAt:at,value:{logs:[{gameId:'one',value:0,plateAppearances:4},{gameId:'two',value:0,plateAppearances:5}]}}]}]};
assert.equal(numericSourceNavigation(mlb)!.players[0].markets[0].meanAdmissionSupport?.state,'source_opportunity');assert.equal(numericSourceNavigation(mlb)!.players[0].markets[0].meanAdmissionSupport?.maximum,5);
for(const release of ['player_props_ai_2026_11_16_r43_numeric_source_continuation','player_props_ai_2026_11_15_r42_supported_nfl_binary_events',PROPS_AI_RELEASE]){assert(propsReviewHasMemberExecutionContracts(release));assert(propsReviewHasVerifiedReaderClaims(release));}
assert.equal(digest({p,bad,good}),before);
// Frozen round70 counterexamples: null-law siblings and derived components.
const siblings=packet(2),siblingDraft=draft(siblings);Object.assign(siblingDraft.players.p1,{law:null,gaps:['forecast_declined'],confidence:[0,0,0,0,0],exceptions:Array(5).fill('forecast_declined')});
assert.equal(parseJointPlayerReview(siblings,'p1',siblingDraft.players.p1).law,null);
const siblingCorrection=sourceAwareDiagnosticCorrection(siblings,siblingDraft);assert.equal(siblingCorrection.status,'ready');if(siblingCorrection.status==='ready'){assert(siblingCorrection.text.includes('P1 M3,4'));assert(!siblingCorrection.text.includes('P1 M0'),'Numerically supported scopes are not blanket-declined by guidance');}
const combo:GamePacket={...packet(),players:[{id:'p0',name:'Synthetic combo',team:'A',opponent:'B',markets:['rushing_receiving_yards'],missing:[],evidence:[{id:'log',kind:'recent_games',source:'Synthetic single game',availableAt:at,value:{game:{startTime:'2030-05-29T23:00:00Z',awayTeam:'A',homeTeam:'B'},box:{rushing_yards:10,receiving_yards:20}}},{id:'prior',kind:'independent_model',source:'Synthetic sum prior',availableAt:at,value:{market:'rushing_receiving_yards',independentProjection:40,line:35.5,independentOver:.5,independentUnder:.5}}]}]};
const combined=numericSourceNavigation(combo)!,constraints=combined.players[0].canonicalMeanConstraints;assert.equal(combined.players[0].markets[0].meanAdmissionSupport?.active,true);
for(const stat of ['rushing_yards','receiving_yards']){const c=constraints.find(c=>c.statistic===stat)!;assert.equal(c.meanRule,'explicit_decline_affected');assert.deepEqual(c.affectedMarketIndices,[0]);}
assert(!combined.meaning.includes('missing dependency envelope is not'));
const unsupportedCombo=validateLaw('nfl',combo.players[0],{weights:v(1),outcomes:{rushing_yards:v(15),receiving_yards:v(20)}});assert.equal(sourceForecastIssues(combo,combo.players[0],unsupportedCombo).filter(i=>i.code==='forecast_numeric_support_unavailable').length,2);
const supportedCombo=structuredClone(combo);supportedCombo.players[0].evidence.push(...[0,1,2].map(i=>({id:'extra'+i,kind:'recent_games' as const,source:'Synthetic component game',availableAt:at,value:{game:{startTime:`2030-05-${26+i}T23:00:00Z`,awayTeam:'A',homeTeam:'B'},box:{rushing_yards:10+i*5,receiving_yards:20+i*5}}})));
const supportedConstraints=numericSourceNavigation(supportedCombo)!.players[0].canonicalMeanConstraints;assert(supportedConstraints.every(c=>c.meanRule==='within_range'));const usefulCombo=validateLaw('nfl',supportedCombo.players[0],{weights:v(1),outcomes:{rushing_yards:v(10,20),receiving_yards:v(20,30)}});assert.equal(sourceForecastIssues(supportedCombo,supportedCombo.players[0],usefulCombo).length,0,'Valid derived recovery remains eligible');
const componentMismatch=validateLaw('nfl',supportedCombo.players[0],{weights:v(1),outcomes:{rushing_yards:v(-95),receiving_yards:v(135)}});assert(sourceForecastIssues(supportedCombo,supportedCombo.players[0],componentMismatch).filter(i=>i.code==='forecast_mean_outside_supplied_support').length>=2,'A plausible sum cannot cancel unsupported signed components');
const dependent=numericSourceNavigation({...p,players:[{...p.players[0],markets:['passing_yards']}]} )!.players[0].canonicalMeanConstraints;assert.deepEqual(dependent.map(c=>c.statistic),['passing_yards'],'Structural QB coordinates do not invent a mean gate for an unoffered event');
// Frozen round71 counterexample: an unavailable direct count must not
// demote a separately supported derived market.
const mixed:GamePacket={...packet(),sport:'mlb',players:[{id:'p0',name:'Synthetic batter',team:'A',opponent:'B',markets:['batter_singles','batter_hits'],missing:[],evidence:[{id:'p0:batter_hits:recentForm',kind:'recent_games',source:'Synthetic tagged hits games',availableAt:at,value:{logs:[{gameId:'one',date:'2030-05-28',opponent:'B',homeAway:'home',value:1},{gameId:'two',date:'2030-05-29',opponent:'B',homeAway:'away',value:2},{gameId:'three',date:'2030-05-30',opponent:'B',homeAway:'home',value:3}]}},{id:'p0:prior:hits',kind:'independent_model',source:'Synthetic hits prior',availableAt:at,value:{market:'batter_hits',independentProjection:2,line:1.5,independentOver:.5,independentUnder:.5}}]}]};
const mixedPlayer=mixed.players[0],mixedNav=numericSourceNavigation(mixed)!,mixedConstraint=mixedNav.players[0].canonicalMeanConstraints.find(c=>c.statistic==='batter_singles')!;assert.equal(mixedConstraint.meanRule,'explicit_decline_affected');assert.deepEqual(mixedConstraint.affectedMarketIndices,[0]);
const mixedOutcomes=Object.fromEntries(primitives('mlb',mixedPlayer).map(stat=>[stat,stat==='batter_doubles'?v(1,3):v(0)]));const mixedLaw=validateLaw('mlb',mixedPlayer,{weights:v(1),outcomes:mixedOutcomes});
const mixedIssues=sourceForecastIssues(mixed,mixedPlayer,mixedLaw);assert.equal(mixedIssues.length,1);assert.deepEqual(mixedIssues[0].markets,['batter_singles']);
const mixedAliases=new Map([...evidenceAliases(mixed)].map(([a,id])=>[id,a]));const mixedDraft={wireRelease:PROPS_AI_WIRE_RELEASE,players:{p0:verifiedReaderFixture(mixed,'p0',{priorRead:Object.fromEntries(independentPriorEvents(mixedPlayer).map(e=>[mixedAliases.get(e.sourceId)!,e.preferredOutcome])),evidenceIds:[mixedAliases.get(mixedPlayer.evidence[0].id)!],gaps:[],confidence:[0,1],exceptions:['forecast_declined',null],law:encodeCanonicalScenarioLaw('mlb',mixedPlayer,{weights:v(1),outcomes:mixedOutcomes})})}};
assert.deepEqual(parseJointReview(mixed,mixedDraft).players[0].sourceDeclinedMarkets,['batter_singles']);assert.deepEqual(JSON.parse(jointReviewRequest(mixed,PROPS_AI_PRIMARY_MODEL,7000).input).numericSourceNavigation.players[0].canonicalMeanConstraints.find((c:{statistic:string})=>c.statistic==='batter_singles').affectedMarketIndices,[0]);
const dispatchedCorrection=reviewCorrectionFeedback(p,bad);assert.equal(dispatchedCorrection.status,'ready');
if(dispatchedCorrection.status!=='ready')throw Error('Expected complete dispatched correction');
assert(dispatchedCorrection.text.startsWith(next.text),'The existing supported-scope diagnostic must remain complete');
const expectedCorrectionText=dispatchedCorrection.text;
async function main(){let phase=0;const requests:ReturnType<typeof jointReviewRequest>[]=[],receipts:Record<string,unknown>[]=[];
 const job={job_key:'synthetic-source-continuation',sport:'nfl',game_id:p.gameId,game_day:'2030-06-01',stage:'final',scheduled_start:p.start,lock_at:p.lock,state:'pending',model:PROPS_AI_PRIMARY_MODEL,requested_tier:'default'} as PropsAiJob;
 const store={claim:async()=>({claimed:true,token:'synthetic',job}),send:async(_k:string,_t:string,n:number)=>{phase=n;return{id:`synthetic-${n}`,model:PROPS_AI_PRIMARY_MODEL,requested_tier:'default',reserved_micro:100000};},receipt:async(_id:string,_t:string,actual:number|null,_r:string|null,usage:Record<string,unknown>)=>{assert(actual!==null&&actual>0);receipts.push(usage);},fallback:async()=>true,finish:async(_k:string,_t:string,result:unknown,error:unknown)=>{assert(result);assert.equal(error,null);return{...job,state:'completed',result};}} as unknown as PropsAiReviewStore;
 const fetchImpl:typeof fetch=async(url,options)=>{assert.equal(String(url),'https://api.openai.com/v1/responses');const body=JSON.parse(String(options?.body));requests.push(body);return Response.json({id:`synthetic-response-${phase}`,model:body.model,status:'completed',service_tier:'default',usage:{input_tokens:1000,output_tokens:300},output:[{content:[{type:'output_text',text:JSON.stringify(phase===1?bad:good)}]}]});};
 const result=await runPropsReview({packet:p,job,store,key:'synthetic-no-real-key',writerRunId:'synthetic',preferStronger:false,deadline:Date.now()+360000,clock:()=>at,prepare:async()=>[{packet:p,inputTokens:1000}],fetchImpl});
 assert.equal(result.status,'completed');assert.equal(requests.length,2);assert.equal(receipts.length,2);
 assert.equal(requests[0].input,requests[1].input);assert(requests[1].instructions.endsWith(expectedCorrectionText));assert.equal(receipts[0].nextCorrectionText,expectedCorrectionText);assert.equal(digest({p,bad,good}),before);
 console.log(JSON.stringify({numericSourceContinuation:true,canonicalEnvelopesExact:true,fullActorMarketInventory:true,validUnsupportedDeclinesRetained:true,supportedScopesRemainQualified:3,unavailableScopesDeclined:2,actualReviewerPrimary:1,actualReviewerCorrection:1,unchanged1984AsciiBound:true,oldR42Membership:true,networkOrPaidCalls:0}));}
void main().catch(e=>{console.error(e);process.exitCode=1;});
