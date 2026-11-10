import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
/** Actual parser/publication/binding admission and legacy-lock controls. All
 * sources, responses and receipts are synthetic; no HTTP or paid inference. */
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {PRODUCT_RELEASE,type Evidence,type GamePacket,type Quote} from '../lib/playerPropsAi/evidenceContract';
import {digest} from '../lib/playerPropsAi/evidence';
import {compileMarketReport} from '../lib/playerPropsAi/marketReport';
import {readerEvidence,READER_AREAS} from '../lib/playerPropsAi/readerCoverage';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {PROPS_AI_RELEASE} from '../lib/playerPropsAi/releases';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {readerAvailabilityContextHash,reviewedReaderContextCurrent} from '../lib/playerPropsAi/readerClaimFreshness';
import {testNbaSourceAuthority,testNbaHandoffCapture,mergeNbaHandoffs} from '../lib/playerPropsAi/nbaLockAuthority';
import {siteAiDecisions,siteReviewCoverage,siteReviewQualification} from '../lib/playerPropsAi/publication';
import {applyNbaSiteAi,applyNflSiteAi,applyMlbSiteAi} from '../lib/playerPropsAi/siteBindings';
import {playerParticipationEligibility,qualifiedParticipationException,attachCapturedNbaParticipationReports,type CapturedNbaParticipationReport} from '../lib/playerPropsAi/participationEligibility';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {NflPlayerPropsRuntimeBoard} from '../lib/services/football/nflPlayerPropsRuntime';
import {buildNbaPlayerPropsMemberSnapshot} from '../lib/services/nba/nbaPlayerPropsProductContract';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';
globalThis.fetch=async()=>{throw Error('Participation publication proof forbids network');};

const at='2026-11-10T20:50:00Z',past='2026-11-10T20:40:00Z',now='2026-11-10T20:51:00Z',start='2026-11-10T22:00:00Z',lock='2026-11-10T21:00:00Z';
const v=(n:number)=>Array<number>(16).fill(n),name='Synthetic Player';
type StatusCase='out'|'cleared'|'teammate'|'opponent'|'unlisted'|'no_source'|'lineup_out'|'lineup_cleared';
function statusEvidence(statusCase:StatusCase,team:string,opponent:string):Evidence[]{
 const source=(status:string,availableAt:string,ownTeam=team,ownName=name):Evidence=>({id:`status:${ownTeam}:${ownName}:${status}`,kind:'availability',availableAt,source:'synthetic exact-game participation report',value:{context:{away:{team,known:true,players:ownTeam===team?[{name:ownName,status,reportedAt:availableAt}]:[]},home:{team:opponent,known:true,players:ownTeam===opponent?[{name:ownName,status,reportedAt:availableAt}]:[]}}}});
 if(statusCase==='no_source')return[];
 if(statusCase==='out')return[source('Out',past)];
 if(statusCase==='cleared')return[source('Out',past),source('Available',at)];
 if(statusCase==='teammate')return[source('Out',past,team,'Different Teammate')];
 if(statusCase==='opponent')return[source('Out',past,opponent)];
 if(statusCase==='unlisted')return[source('Out',past,team,'Different Teammate'),source('Questionable',at,opponent,'Different Opponent')];
 const lineup=(status:string,availableAt:string,battingOrder:number|null):Evidence=>({id:`lineup:${status}`,kind:'availability',source:'synthetic exact-actor lineup',availableAt,value:{status,battingOrder,asOfTimestamp:availableAt}});
 return statusCase==='lineup_out'?[lineup('not_in_lineup',past,null)]:[lineup('not_in_lineup',past,null),lineup('confirmed',at,3)];
}
function sourcePacket(sport:GamePacket['sport'],statusCase:StatusCase):GamePacket{
 const team=sport==='nfl'?'BUF':sport==='mlb'?'NYY':'BOS',opponent=sport==='nfl'?'MIN':sport==='mlb'?'BOS':'NYK';
 const id=sport==='nfl'?'nfl-bdl-player:9001':sport==='nba'?'nba-bdl-player:9001':'mlb-player:9001',market=sport==='nfl'?'receptions':sport==='mlb'?'batter_hits':'rebounds',line=sport==='mlb'?2.5:6.5;
 const history:Evidence[]=sport==='mlb'?[{id:`${id}:batter_hits:recentForm`,kind:'recent_games',availableAt:past,source:'synthetic played batting games',value:{sampleLabel:'games',statLabel:'Hits',logs:[1,2,3].map((value,i)=>({gameId:i+1,date:`2026-11-0${6+i}`,value,plateAppearances:4}))}}]:[4,6,8].map((value,i):Evidence=>({id:`log:${i}`,kind:'recent_games',availableAt:past,source:'synthetic played stat games',value:{game:{startTime:`2026-11-0${6+i}T00:00:00Z`,homeTeam:team,awayTeam:opponent},box:sport==='nba'?{minutes:30,points:20,oreb:1,dreb:value-1,ast:3,fg3m:1}:{receptions:value,receiving_yards:value*10}}}));
 const quotes:Quote[]=(['over','under'] as const).map(side=>({id:`q:${side}`,playerId:id,market,provider:'synthetic-feed',book:'synthetic-book',line,side,american:-110,opening:false,live:false,observedAt:at,receivedAt:at,receivedAtProvenance:'provider_response'}));
 return{release:PRODUCT_RELEASE,sport,gameId:`synthetic-${sport}`,start,lock,cutoff:at,stage:'final',sourceLimitations:[],players:[{id,name,team,opponent,markets:[market],missing:[],evidence:[...history,...statusEvidence(statusCase,team,opponent)]}],quotes};
}
for(const statusCase of ['out','cleared','teammate','opponent','unlisted','no_source'] as const){
 const packet=sourcePacket('nfl',statusCase),eligibility=playerParticipationEligibility(packet,packet.players[0]),before=digest(eligibility),approved='Immutable accepted semantic exception.';
 assert.equal(qualifiedParticipationException(eligibility,approved),statusCase==='out'?'Source participation unavailable: explicit_out':approved);
 assert.equal(qualifiedParticipationException(eligibility,null),statusCase==='out'?'Source participation unavailable: explicit_out':null);
 assert.equal(qualifiedParticipationException({...eligibility,blocked:1 as unknown as boolean},approved),approved,'A truthy malformed flag cannot authorize the own-player overlay');
 assert.equal(digest(eligibility),before);
}
function accepted(input:GamePacket,side:'over'|'under'){
 const packet=compileMarketReport(input),player=packet.players[0],facts=readerEvidence(packet)[player.id],aliases=evidenceAliases(packet),low=packet.sport==='mlb'?1:4,high=packet.sport==='mlb'?3:8;
 const outcomes=side==='over'?[low,...v(high).slice(1)]:[high,...v(low).slice(1)];
 const canonical:Record<string,number[]>=packet.sport==='nba'?{points:v(20),rebounds:outcomes,assists:v(3),threes:v(1)}:packet.sport==='nfl'?{receptions:outcomes}:{batter_singles:outcomes,batter_doubles:v(0),batter_triples:v(0),batter_home_runs:v(0),batter_walks:v(0),batter_strikeouts:v(0),batter_rbis:v(0),batter_runs_scored:v(0),batter_stolen_bases:v(0)};
 const actor=verifiedReaderFixture(packet,player.id,{assessment:'The supplied evidence supports a conditional participation forecast.',priorRead:{},coverage:Object.fromEntries(READER_AREAS.map(area=>[area,{status:facts[area].status,factIds:facts[area].facts.slice(0,1).map(f=>f.id),effect:'uncertain',observation:'The supplied source requires appropriate participation caution.'}])),evidenceIds:[[...aliases].find(([,id])=>id===player.evidence[0].id)![0]],gaps:[],confidence:[2],exceptions:[null],law:encodeCanonicalScenarioLaw(packet.sport,player,{weights:v(1),outcomes:canonical})});
 const raw={wireRelease:PROPS_AI_WIRE_RELEASE,players:{[player.id]:actor}},parsed=parseJointReview(packet,raw),inputBytes=Buffer.from(JSON.stringify(packet));
 const review:AcceptedGameReview={release:PROPS_AI_RELEASE,gameId:packet.gameId,sourceGameId:packet.gameId,start,lock,cutoff:at,stage:'final',issuedAt:now,model:'synthetic-offline',partProvenance:[],marketScopes:{[player.id]:[...player.markets]},criticalContextHashes:criticalContextHashes(packet),players:parsed.players,inputHash:digest(packet),inputEvidence:{encoding:'gzip-base64',digest:digest(packet),bytes:inputBytes.length,data:gzipSync(inputBytes).toString('base64')}};
 return{packet,raw,review};
}
function nbaBaseline(packet:GamePacket){const player=packet.players[0];return buildNbaPlayerPropsMemberSnapshot({mode:'private_forward_candidate',generatedAt:at,slateDate:'2026-11-10',games:[{gameId:packet.gameId,scheduledStart:start,homeTeam:player.opponent,awayTeam:player.team}],decisions:[],inputRows:packet.quotes.length});}
type MlbRow=Parameters<typeof applyMlbSiteAi>[0][number];
function mlbRows(packet:GamePacket):MlbRow[]{return(['over','under'] as const).map(side=>({id:`synthetic-mlb:${side}`,providerIds:{gameId:packet.gameId,mlbStatsPlayerId:packet.players[0].id,bdlPlayerId:9001},market:'batter_hits',line:2.5,book:'synthetic-book',side,lockStatus:null,missingFeatures:[],oddsSanity:[]} as unknown as MlbRow));}
function verify(sport:GamePacket['sport'],statusCase:StatusCase,side:'over'|'under'){
 const {packet,raw,review}=accepted(sourcePacket(sport,statusCase),side),before=digest({packet,review,raw}),lawBefore=digest(review.players[0].law),inputBefore=digest(review.inputEvidence);
 const blocked=statusCase==='out'||statusCase==='lineup_out',eligibility=playerParticipationEligibility(packet,packet.players[0]);
 assert.equal(eligibility.blocked,blocked);
 assert.equal(eligibility.status,blocked?'blocked':statusCase==='cleared'||statusCase==='lineup_cleared'?'eligible':'unknown','Unrelated/omitted sources never become a health clearance');
 const decisions=siteAiDecisions(packet,review,now);assert.equal(decisions.length,1);const c=decisions[0];
 assert.equal(c.side,side);assert.equal(c.grade,blocked?'No Play':'Best Angle');assert(c.expectedValue>0);assert.equal(c.evidence.confidence,2);assert.equal(c.probability,.9375);
 assert.deepEqual(c.evidence.sourceEligibility,eligibility);assert.equal(c.evidence.exception,blocked?`Source participation unavailable: ${eligibility.reason}`:null);
 assert.equal(c.evidence.inputHash,review.inputHash);assert.equal(c.evidence.lawHash,review.players[0].law!.hash);
 const coverage=siteReviewCoverage(packet,review,now);assert.equal(coverage.length,1);assert.equal(coverage[0].reviewed,true);assert.equal(coverage[0].contextCurrent,true);assert.deepEqual(coverage[0].markets,packet.players[0].markets);assert.deepEqual(coverage[0].unreviewedMarkets,[]);
 const qualification=siteReviewQualification(packet,review,now,15*60000,decisions);assert.equal(qualification.qualifiedLawPlayers,1);assert.equal(qualification.participationBlockedScopes,blocked?1:0);assert.equal(qualification.sourceDeclinedScopes,0);assert.equal(qualification.pricedExecutionContracts,1);
 if(blocked){const fact=eligibility.facts.find(f=>f.status==='blocked')!;assert(fact);assert.equal(fact.evidenceId,statusCase==='out'?`status:${packet.players[0].team}:${name}:Out`:'lineup:not_in_lineup');assert.equal(fact.source,statusCase==='out'?'synthetic exact-game participation report':'synthetic exact-actor lineup');assert.equal(fact.effectiveAt,new Date(past).toISOString());assert(eligibility.facts.every(f=>f.evidenceId&&f.source&&f.availableAt&&f.effectiveAt&&f.timeBasis));}
 if(sport==='nba'){
  const applied=applyNbaSiteAi(nbaBaseline(packet),packet,decisions,now);assert.equal(applied.decisions.length,1);const row=applied.decisions[0];assert.equal(row.grade,c.grade);assert.equal(row.projection,c.projection);assert.equal(row.probability,c.probability);assert.deepEqual(row.aiReview!.sourceEligibility,eligibility);assert.equal(row.aiReview!.exception,c.evidence.exception);
  const locked=structuredClone(advanceNbaPlayerPropsCandidateLifecycle({now:lock,previous:applied,candidate:applied}).snapshot);delete locked.decisions[0].aiReview!.sourceEligibility;const bytes=JSON.stringify(locked);
  assert.strictEqual(applyNbaSiteAi(locked,packet,decisions,now),locked);assert.equal(JSON.stringify(locked),bytes,'An existing NBA lock wins before new participation metadata');
 }else if(sport==='nfl'){
  const empty={decisions:[],counts:{},diagnostics:{}} as unknown as NflPlayerPropsRuntimeBoard;
  const populated=applyNflSiteAi(empty,packet,decisions,now),native={...populated,decisions:populated.decisions.map(row=>({...row,modelRelease:"synthetic-native-source",aiReview:undefined}))};
  const applied=applyNflSiteAi(native,packet,decisions,now);assert.equal(applied.decisions.length,2);
  for(const row of applied.decisions){assert.equal(row.grade,blocked?'No Play':row.side===side?'Best Angle':'Watchlist');assert.equal(row.projection,c.projection);assert.equal(row.finalProbability,row.side==='over'?c.over:c.under);assert.deepEqual(row.aiReview!.sourceEligibility,eligibility);assert.equal(row.aiReview!.exception,c.evidence.exception);assert.equal(row.aiReview!.lawHash,c.evidence.lawHash);}
  const locked={...applied,decisions:applied.decisions.map(row=>({...row,state:'locked' as const,aiReview:{...row.aiReview!}}))};for(const row of locked.decisions)delete row.aiReview.sourceEligibility;const bytes=JSON.stringify(locked);
  assert.strictEqual(applyNflSiteAi(locked,packet,decisions,now),locked);assert.equal(JSON.stringify(locked),bytes,'An existing NFL lock wins before new participation metadata');
 }else{
  const applied=applyMlbSiteAi(mlbRows(packet),packet,decisions,now);assert.equal(applied.length,2);
  for(const row of applied){assert.equal(row.playGrade,blocked?'NO_PLAY':row.side===side?'BEST_ANGLE':'WATCHLIST');assert.equal(row.projection,c.projection);assert.equal(row.finalProbability,row.side==='over'?c.over:c.under);assert.deepEqual(row.aiReview!.sourceEligibility,eligibility);assert.equal(row.aiReview!.exception,c.evidence.exception);if(blocked)assert.equal(row.units,0);}
  const locked=applied.map(row=>({...row,lockStatus:{status:'locked' as const,lockedAt:lock},aiReview:{...row.aiReview!}}));for(const row of locked)delete row.aiReview.sourceEligibility;const bytes=JSON.stringify(locked);
  assert.strictEqual(applyMlbSiteAi(locked,packet,decisions,now),locked);assert.equal(JSON.stringify(locked),bytes,'An existing MLB lock wins before new participation metadata');
 }
 assert.equal(digest(review.players[0].law),lawBefore,'Conditional numerical law remains exact');assert.equal(digest(review.inputEvidence),inputBefore,'Archived input bytes/digest remain exact');assert.equal(digest({packet,review,raw}),before,'Parser and all publication paths preserve source and accepted review');
 return{packet,raw,review};
}
for(const sport of ['nba','nfl','mlb'] as const)for(const side of ['over','under'] as const){
 for(const statusCase of ['out','cleared','teammate','opponent','unlisted','no_source'] as const)verify(sport,statusCase,side);
 if(sport==='mlb')for(const statusCase of ['lineup_out','lineup_cleared'] as const)verify(sport,statusCase,side);
}
// Full fresh report from the already-completed NBA fetch reaches the same real
// parser/publication/binding path even when native filtering left no row.
const captureInput=sourcePacket('nba','no_source'),capture:CapturedNbaParticipationReport={gameId:captureInput.gameId,start,awayTeam:'BOS',homeTeam:'NYK',expectedEventId:'synthetic-espn',availableAt:at,report:{eventId:'synthetic-espn',teams:new Map([['BOS',[{player_id:null,name,status:'out',reported_at:past,source_player_id:'synthetic-9001'}]],['NYK',[]]])}};
const captured=accepted(attachCapturedNbaParticipationReports(captureInput,[capture]),'over'),captureChoices=siteAiDecisions(captured.packet,captured.review,now),captureMember=applyNbaSiteAi(nbaBaseline(captured.packet),captured.packet,captureChoices,now);
assert.equal(captureMember.decisions[0].grade,'No Play');assert.equal(captureMember.decisions[0].aiReview!.sourceEligibility!.facts[0].effectiveAt,new Date(past).toISOString());assert.equal(captureMember.decisions[0].aiReview!.sourceEligibility!.facts[0].timeBasis,'provider_reported');assert.equal(siteReviewQualification(captured.packet,captured.review,now).participationBlockedScopes,1);
const certainty=verify('nba','cleared','over'),id=certainty.packet.players[0].id,bad=structuredClone(certainty.raw);Object.assign(bad.players[id],{assessment:'Insider money guarantees the player will exceed this line.'});
assert.throws(()=>parseJointReview(certainty.packet,bad),/Future assessment must select verified claims/);
const caution=structuredClone(certainty.raw);Object.assign(caution.players[id],{assessment:'There is no verified smart money in the supplied source.'});assert.throws(()=>parseJointReview(certainty.packet,caution),/Future assessment must select verified claims/,'Even cautious unrestricted factual prose cannot bypass future source claims');
// Effective source chronology is substantive even when the unordered source
// values remain identical. Routine receipts and unchanged authority are neutral.
for(const sport of ['nba','nfl','mlb'] as const)for(const side of ['over','under'] as const){
 const input=sourcePacket(sport,'no_source'),p=input.players[0],actorId=p.id;
 const medical=(id:string,status:string,reportedAt:string):Evidence=>({id,kind:'availability',source:'synthetic exact-game medical report',availableAt:at,value:{canonicalGameId:input.gameId,scheduledStart:input.start,context:{away:{team:p.team,known:true,players:[{name:p.name,status,reportedAt}]},home:{team:p.opponent,known:true,players:[]}}}});
 const lineup=(id:string,status:string,asOfTimestamp:string,battingOrder:number|null):Evidence=>({id,kind:'availability',source:'stored MLB lineup',availableAt:at,value:{canonicalGameId:input.gameId,scheduledStart:input.start,status,battingOrder,asOfTimestamp}});
 p.evidence.push(...(sport==='mlb'?[lineup('blocked','not_in_lineup','2026-11-10T20:40:00Z',null),lineup('returned','posted','2026-11-10T20:30:00Z',4)]:[medical('blocked','Out','2026-11-10T20:40:00Z'),medical('returned','Available','2026-11-10T20:30:00Z')]));
 const old=accepted(input,side),before=digest(old.review),currentInput=structuredClone(input),returned=currentInput.players[0].evidence.find(e=>e.id==='returned')!;
 if(sport==='mlb')(returned.value as Record<string,unknown>).asOfTimestamp='2026-11-10T20:45:00Z';
 else (((returned.value as Record<string,unknown>).context as {away:{players:{reportedAt:string}[]}}).away.players[0]).reportedAt='2026-11-10T20:45:00Z';
 const current=compileMarketReport(currentInput);
 assert.deepEqual(criticalContextHashes(current),criticalContextHashes(old.packet),'The established source-content hash remains exact');
 assert.notEqual(readerAvailabilityContextHash(current,actorId),readerAvailabilityContextHash(old.packet,actorId));
 assert.equal(siteAiDecisions(old.packet,old.review,now)[0].grade,'No Play');
 assert.equal(reviewedReaderContextCurrent(current,old.review,actorId),false);
 assert.equal(siteReviewCoverage(current,old.review,now)[0].contextCurrent,false);
 assert.deepEqual(siteAiDecisions(current,old.review,now),[],'A changed current authority cannot reuse the old factual reading or confidence');
 const fresh=accepted(currentInput,side),freshChoice=siteAiDecisions(fresh.packet,fresh.review,now)[0];
 assert.equal(freshChoice.side,side);assert.equal(freshChoice.grade,'Best Angle','A normal new final restores both qualified directional paths');
 const conflicted=structuredClone(current),conflictingReturn=conflicted.players[0].evidence.find(e=>e.id==='returned')!;
 if(sport==='mlb')(conflictingReturn.value as Record<string,unknown>).asOfTimestamp='2026-11-10T20:40:00Z';
 else (((conflictingReturn.value as Record<string,unknown>).context as {away:{players:{reportedAt:string}[]}}).away.players[0]).reportedAt='2026-11-10T20:40:00Z';
 assert.equal(playerParticipationEligibility(conflicted,conflicted.players[0]).conflict,true);
 assert.equal(reviewedReaderContextCurrent(conflicted,fresh.review,actorId),false,'New equal-clock conflicts cannot reuse the previous resolved reading');
 assert.deepEqual(siteAiDecisions(conflicted,fresh.review,now),[]);
 const refetched=structuredClone(current);for(const e of refetched.players[0].evidence)e.availableAt=now;
 refetched.cutoff=now;
 assert.equal(readerAvailabilityContextHash(refetched,actorId),readerAvailabilityContextHash(current,actorId));
 assert.equal(reviewedReaderContextCurrent(refetched,fresh.review,actorId),true,'A later receipt with unchanged authority is not new context');
 const funded={...current,sourceGameId:current.gameId,gameId:'funded-fixture'};
 assert.equal(readerAvailabilityContextHash(funded,actorId),readerAvailabilityContextHash(current,actorId),'Funding/native aliases denote the same exact fixture');
 const missing=structuredClone(fresh.review);delete missing.players[0].sourceReadProofs;
 assert.equal(reviewedReaderContextCurrent(current,missing,actorId),false,'A future claim review with missing proof fails closed');
 const legacy={...missing,release:'player_props_ai_2026_11_10_r29_identity_and_execution_evidence' as const};
 assert.equal(reviewedReaderContextCurrent(current,legacy,actorId),true,'Legacy reviews keep their established unchanged-content contract');
 assert.equal(digest(old.review),before,'No accepted text, law, input or proof is rewritten');
 if(sport==='nba'){
  const previousEnv=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'test'});
  try{
   const applied=applyNbaSiteAi(nbaBaseline(old.packet),old.packet,siteAiDecisions(old.packet,old.review,now),now);
   const observed=testNbaSourceAuthority(()=>now)(current,old.review);
   assert(observed.observations[0].actors[0].scopes.every(s=>s.status==='context_changed'));
   const firstLock=advanceNbaPlayerPropsCandidateLifecycle({now:lock,previous:applied,candidate:applied,lockHandoff:mergeNbaHandoffs([testNbaHandoffCapture(()=>now)(applied.decisions,old.packet,old.review,'ai'),observed])});
   assert.equal(firstLock.snapshot.decisions.length,0,'The new first lock cannot admit an AI proof whose effective medical authority changed');
  }finally{if(previousEnv===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:previousEnv});}
 }
}
console.log('Participation publication passed: actual parser→publication→NBA/NFL/MLB; own Out/lineup blocks, paired Over/Under clearance promotions, teammate/opponent/unlisted controls, complete coverage versus blocked qualification, exact law/input/provenance, fresh fetched report, legacy locks and assessment certainty. Synthetic/offline; no paid calls.');
