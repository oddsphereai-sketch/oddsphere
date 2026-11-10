/** Generic supported mixed-source contract and actual current MLB producer.
 * A medical report is not emitted by today's MLB adapter; this is an invariant
 * test, not evidence of an observed production incident. All I/O is mocked. */
import assert from 'node:assert/strict';
import {liveMlbPacket} from '../lib/playerPropsAi/liveSources';
import {playerParticipationEligibility} from '../lib/playerPropsAi/participationEligibility';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {applyMlbSiteAi} from '../lib/playerPropsAi/siteBindings';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {digest} from '../lib/playerPropsAi/evidence';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {GamePacket,Json} from '../lib/playerPropsAi/evidenceContract';
globalThis.fetch=async()=>{throw Error('Participation channel proof forbids HTTP');};
const at='2026-11-10T16:00:00Z',past='2026-11-10T15:59:00Z',early='2026-11-10T15:00:00Z',later='2026-11-10T15:30:00Z',start='2026-11-11T00:30:00Z',lock='2026-11-10T23:30:00Z';
const game={id:'synthetic-mlb',start,away:'NYY',home:'BOS'},v=(n:number)=>Array<number>(16).fill(n);
const baseRow={player:'Synthetic Batter',team:'NYY',opponent:'BOS',market:'batter_hits',line:1.5,book:'synthetic',odds:-110,lastUpdated:past,projection:1.8,finalProbability:.6,playGrade:'LEAN',marketEvidenceId:'row',gameStartTime:start,providerIds:{gameId:game.id,bdlGameId:'1',bdlPlayerId:'9001',mlbStatsPlayerId:'9001'},missingFeatures:[],oddsSanity:[],lockStatus:null,offerContract:'two_way',lineupStatus:{status:'posted',battingOrder:4,asOfTimestamp:later}};
const snapshot={asOfTimestamp:past,slateDate:'2026-11-10',modelContext:{modelReleaseId:'mlb_props_2026_10_21_r44'},marketEvidence:{r:'synthetic',i:[['row',null,[],[],null,[1.8,null,null,.6,.4]]]},data:{props:['over','under'].map(side=>({...baseRow,id:side,side}))}};
const source=liveMlbPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot,currentOdds:['over','under'].map(side=>({gameId:'1',playerId:'9001',marketKey:'batter_hits',sportsbook:'synthetic',provider:'balldontlie',line:1.5,side,americanOdds:-110,asOfTimestamp:past,providerResponseAt:past,rawPayload:{market_kind:'over_under'}})),openingOdds:[]} as never);
assert.deepEqual(source.players[0].evidence.filter(e=>e.kind==='availability').map(e=>e.source),['stored MLB lineup']);
function medical(packet:GamePacket,status:string,clock:string,id='medical'){
 packet.players[0].evidence.push({id,kind:'availability',source:'synthetic generic mixed-source contract; not current MLB collector',availableAt:past,value:{context:{away:{team:'NYY',known:true,players:[{name:'Synthetic Batter',status,reportedAt:clock}]},home:{team:'BOS',known:true,players:[]}}}});
}
function lineup(packet:GamePacket,status:string,clock:string,id='lineup-change'){
 packet.players[0].evidence.push({id,kind:'availability',source:'stored MLB lineup',availableAt:past,value:{status,battingOrder:status==='posted'?4:null,asOfTimestamp:clock}});
}
function qualify(packet:GamePacket,side:'over'|'under'){
 const p=packet.players[0],aliases=evidenceAliases(packet),alias=(id:string)=>[...aliases].find(([,value])=>value===id)![0],before=digest(packet);
 const raw=verifiedReaderFixture(packet,p.id,{priorRead:Object.fromEntries(independentPriorEvents(p).map(e=>[alias(e.sourceId),e.preferredOutcome])),evidenceIds:[alias(p.evidence[0].id)],gaps:[],confidence:[2],exceptions:[null],law:encodeCanonicalScenarioLaw('mlb',p,{weights:v(1),outcomes:{batter_singles:side==='over'?[0,...v(2).slice(1)]:[2,...v(0).slice(1)],batter_doubles:v(0),batter_triples:v(0),batter_home_runs:v(0),batter_walks:v(0),batter_strikeouts:v(0),batter_rbis:v(0),batter_runs_scored:v(0),batter_stolen_bases:v(0)}})});
 const parsed=parseJointReview(packet,{wireRelease:PROPS_AI_WIRE_RELEASE,players:{[p.id]:raw}}),review={...parsed,gameId:game.id,start,lock,cutoff:at,stage:'early',issuedAt:at,criticalContextHashes:criticalContextHashes(packet),marketScopes:{[p.id]:p.markets},inputHash:before,inputEvidence:{digest:before},model:'synthetic',partProvenance:[]} as unknown as AcceptedGameReview;
 const choices=siteAiDecisions(packet,review,at),rows=applyMlbSiteAi(snapshot.data.props as never,packet,choices,at);assert.equal(choices.length,1);assert.equal(choices[0].side,side);assert.equal(digest(packet),before);
 return{eligibility:playerParticipationEligibility(packet,p),choice:choices[0],rows,review,reading:parsed.players[0].coverage.availability.observation};
}
for(const side of ['over','under'] as const){
 const native=qualify(source,side);assert.equal(native.choice.grade,'Best Angle');assert.equal(native.eligibility.status,'eligible');
 const ownOut=structuredClone(source);medical(ownOut,'Out',early);const blocked=qualify(ownOut,side);assert.equal(blocked.eligibility.blocked,true);assert.equal(blocked.choice.grade,'No Play');assert(blocked.rows.every(r=>r.playGrade==='NO_PLAY'));assert.match(blocked.reading,/batting position 4.*Out/);assert.equal(blocked.review.players[0].law!.hash,native.review.players[0].law!.hash,'Qualification never changes the conditional law');assert.equal(blocked.choice.probability,native.choice.probability);assert.equal(blocked.choice.american,native.choice.american);
 const unknownAfterOut=structuredClone(ownOut);medical(unknownAfterOut,'Unknown',past,'medical-unknown');assert.equal(qualify(unknownAfterOut,side).choice.grade,'No Play');
 const clear=structuredClone(ownOut);medical(clear,'Available',past,'medical-clear');const recovered=qualify(clear,side);assert.equal(recovered.choice.grade,'Best Angle');assert.equal(recovered.review.players[0].law!.hash,blocked.review.players[0].law!.hash);
 const outAfterPosted=structuredClone(source);medical(outAfterPosted,'Out',past);assert.equal(qualify(outAfterPosted,side).choice.grade,'No Play');
 const tied=structuredClone(ownOut);medical(tied,'Available',early,'equal-medical-clear');assert.equal(qualify(tied,side).choice.grade,'No Play');assert.equal(qualify(tied,side).eligibility.conflict,true);
 const missingLineup=structuredClone(source);lineup(missingLineup,'not in lineup',past);medical(missingLineup,'Available',past);assert.equal(qualify(missingLineup,side).choice.grade,'No Play','Medical clearance cannot clear a missing lineup');
 const returned=structuredClone(source);lineup(returned,'not in lineup',early);lineup(returned,'posted',past);assert.equal(qualify(returned,side).choice.grade,'Best Angle','Real lineup return remains a promotion with unknown medical status');
 const lineupConflict=structuredClone(source);lineup(lineupConflict,'not in lineup',later);assert.equal(qualify(lineupConflict,side).choice.grade,'No Play');assert.equal(qualify(lineupConflict,side).eligibility.conflict,true);
 const unknownMedical=structuredClone(source);medical(unknownMedical,'Unknown',past);assert.equal(qualify(unknownMedical,side).choice.grade,'Best Angle');
 const unknownLineup=structuredClone(source);lineup(unknownLineup,'not in lineup','2026-11-10T15:45:00Z');lineup(unknownLineup,'unknown',past);assert.equal(qualify(unknownLineup,side).choice.grade,'No Play');
 const locked=recovered.rows.map(r=>({...r,lockStatus:{status:'locked' as const,lockedAt:lock},aiReview:{...r.aiReview!,sourceEligibility:undefined}}));const bytes=JSON.stringify(locked);assert.strictEqual(applyMlbSiteAi(locked,ownOut,[blocked.choice],at),locked);assert.equal(JSON.stringify(locked),bytes);
 const statusFacts=blocked.eligibility.facts;assert(statusFacts.some(f=>f.rawStatus==='Out'&&f.effectiveAt===early.replace('Z','.000Z')));assert(statusFacts.some(f=>f.rawStatus==='posted'&&f.effectiveAt===later.replace('Z','.000Z')));
 // Source metadata is data, never rewritten to synthesize a clearance.
 assert.equal((ownOut.players[0].evidence.find(e=>e.id==='medical')!.value as Record<string,Json>).context!==undefined,true);
}
console.log('Participation channels passed: actual current MLB producer unchanged, generic valid mixed-source parser/pricing/member Out demotion and own-clear/lineup-return promotions, independent barriers, unknown/equal-clock blocks, unchanged law/price/source clocks and exact legacy locks. No I/O; no observed-production-incident claim.');
