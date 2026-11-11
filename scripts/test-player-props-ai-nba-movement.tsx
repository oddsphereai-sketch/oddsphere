/** Actual NBA source -> parser -> member reader/tracking; synthetic I/O only. */
import assert from 'node:assert/strict';
import {nbaPlayedStateFixture} from './lib/player-props-ai-nba-played-fixture';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NbaPlayerPropsProductDashboard} from '../app/player-props/components/NbaPlayerPropsProductDashboard';
import {liveNbaPacket} from '../lib/playerPropsAi/liveSources';
import {readerEvidence,READER_AREAS} from '../lib/playerPropsAi/readerCoverage';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {applyNbaSiteAi} from '../lib/playerPropsAi/siteBindings';
import {digest} from '../lib/playerPropsAi/evidence';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import {buildNbaPlayerPropsMemberSnapshot,type NbaPlayerPropsMemberDecision} from '../lib/services/nba/nbaPlayerPropsProductContract';
import {buildNbaPlayerPropsLockedTrackingRows} from '../lib/services/nba/nbaPlayerPropsPrivateTrackingStore';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';

globalThis.fetch=async()=>{throw Error('NBA movement proof forbids network');};
const at='2026-11-10T16:00:00Z',past='2026-11-10T15:59:00Z',openingAt='2026-11-10T14:00:00Z',priorAt='2026-11-10T15:00:00Z';
const start='2026-11-11T00:30:00Z',lock='2026-11-10T23:30:00Z',id='nba-bdl-player:9001';
const game={id:'synthetic-nba',home:'BOS',away:'NYK',start},window={gameId:game.id,cutoff:at,lock,stage:'early' as const};
type Observation=Parameters<typeof liveNbaPacket>[0]['currentObservations'][number];
function quote(line:number,price:number,clock:string,opening:boolean|undefined=true,provider='balldontlie'):Observation{
 return{canonicalPlayerId:id,canonicalGameId:game.id,playerName:'Synthetic Player',playerTeam:'1',market:'rebounds',sportsbook:'synthetic',line,side:'over',americanPrice:price,provider,providerObservationId:[line,price,clock,opening,provider].join(':'),isOpening:opening,isLive:false,observedAt:clock,receivedAt:clock,fetchedAt:clock} as unknown as Observation;
}
const native:NbaPlayerPropsMemberDecision={decisionKey:'synthetic-native',gameId:game.id,scheduledStart:start,homeTeam:'BOS',awayTeam:'NYK',playerId:id,playerName:'Synthetic Player',team:'BOS',opponent:'NYK',market:'rebounds',line:6.5,side:'over',independentSide:'over',independentProbability:.65,independentProjection:7.25,projection:7.25,probability:.65,grade:'No Play',sportsbook:'synthetic',americanPrice:-110,expectedValue:.24,modelRelease:'synthetic-native',calibrationRelease:'synthetic-calibration',decisionRelease:'synthetic-decision',targetExcludedProbability:null,targetExcludedBooks:0,targetExcludedReferenceBooks:0,marketEvidenceMode:'independent_projection',gradePolicySource:'forecast_only',role:[],production:[],matchup:[],priceLadder:[],movement:null,evaluatedAt:past,lockedAt:null};
const baseline=buildNbaPlayerPropsMemberSnapshot({mode:'private_forward_candidate',generatedAt:past,slateDate:'2026-11-10',games:[{gameId:game.id,scheduledStart:start,homeTeam:'BOS',awayTeam:'NYK'}],decisions:[native],inputRows:1});
const state=nbaPlayedStateFixture(past,[9001],[20,20],[4,8]);
function packet(history:Observation[],price=-110,side:'over'|'under'='over'){
 const current=[quote(6.5,side==='over'?price:-110,past,false),{...quote(6.5,side==='under'?price:-110,past,false),side:'under' as const,providerObservationId:'current-under'}];
 return liveNbaPacket({game,window,snapshot:baseline,market:{updatedAt:at,observations:[...history,...current]},prior:state,current:state,currentObservations:current} as unknown as Parameters<typeof liveNbaPacket>[0]);
}
function accepted(p:GamePacket,side:'over'|'under'='over'):AcceptedGameReview{
 const player=p.players[0],areas=readerEvidence(p)[id],aliases=evidenceAliases(p),alias=(key:string)=>[...aliases].find(([,value])=>value===key)![0];
 const law={weights:Array<number>(16).fill(1),outcomes:{points:Array<number>(16).fill(20),rebounds:side==='over'?[4,...Array<number>(15).fill(8)]:[8,...Array<number>(15).fill(4)],assists:Array<number>(16).fill(3),threes:Array<number>(16).fill(2)}};
 const row={assessment:'The supplied evidence permits a conditional forecast.',priorRead:Object.fromEntries(independentPriorEvents(player).map(e=>[alias(e.sourceId),e.preferredOutcome])),coverage:Object.fromEntries(READER_AREAS.map(area=>[area,{status:areas[area].status,factIds:areas[area].facts.slice(0,1).map(f=>f.id),effect:'uncertain',observation:'The supplied evidence has limits that require caution.'}])),evidenceIds:[alias(player.evidence[0].id)],gaps:[],law:encodeCanonicalScenarioLaw('nba',player,law),confidence:[2],exceptions:[null]};
 const parsed=parseJointReview(p,{wireRelease:PROPS_AI_WIRE_RELEASE,players:{[id]:verifiedReaderFixture(p,id,row)}}),inputHash=digest(p);
 return{...parsed,gameId:p.gameId,start,lock,cutoff:at,stage:'early',issuedAt:at,criticalContextHashes:criticalContextHashes(p),marketScopes:{[id]:player.markets},inputHash,inputEvidence:{encoding:'gzip-base64',digest:inputHash,bytes:0,data:''},partProvenance:[],model:'synthetic'};
}
function publish(history:Observation[],price=-110,side:'over'|'under'='over'){
 const p=packet(history,price,side),before=digest(p),review=accepted(p,side),choices=siteAiDecisions(p,review,at),snapshot=applyNbaSiteAi(baseline,p,choices,at),row=snapshot.decisions[0];
 assert.equal(choices.length,1);assert.equal(row.grade,'Best Angle');assert.equal(row.aiReview!.executionEvidence!.selectedQuote.id,choices[0].quote.id);assert.equal(digest(p),before);
 const html=renderToStaticMarkup(<NbaPlayerPropsProductDashboard snapshot={snapshot} initialSelectedKey={row.decisionKey}/>);
 const locked={...snapshot,decisions:snapshot.decisions.map(r=>({...r,lockedAt:lock}))},tracking=buildNbaPlayerPropsLockedTrackingRows({snapshot:locked})[0];
 assert.deepEqual(tracking.marketEvidence?.movement,row.movement);assert.equal(tracking.marketMovement,row.movement?`${row.movement.openingLine}->${row.movement.currentLine}`:null);
 return{p,choices,snapshot,row,html,locked,tracking};
}
const exact=quote(6.5,-110,openingAt),alternate=quote(2.5,-500,openingAt),normal=publish([exact]);
for(const history of [[alternate,exact],[exact,alternate],[alternate,alternate,exact,exact],[quote(2.5,200,openingAt,true,'owls'),exact,alternate]]){
 const result=publish(history);
 assert.deepEqual(result.row.movement,normal.row.movement,'Opening ladder/order/duplicate and unrelated feed cannot create movement');
 assert.deepEqual(result.row.movement,{sportsbook:'synthetic',openingLine:6.5,openingPrice:-110,priorLine:null,priorPrice:null,currentLine:6.5,currentPrice:-110});
 assert.doesNotMatch(result.html,/Line moved toward Over|Line moved toward Under|Price strengthened/);
 const stripMovement=(r:NbaPlayerPropsMemberDecision)=>{const {movement:ignored,...rest}=r;void ignored;return rest;};
 // All numerical forecast, price, grade and selected quote fields stay exact.
 for(const key of ['line','side','projection','probability','americanPrice','expectedValue','grade'] as const)assert.equal(stripMovement(result.row)[key],stripMovement(normal.row)[key]);
 assert.deepEqual(result.row.aiReview!.executionEvidence,normal.row.aiReview!.executionEvidence);
}
for(const history of [[],[alternate],[{...exact,isOpening:undefined} as unknown as Observation],[quote(6.5,-105,priorAt,false)]]){
 const result=publish(history);assert.equal(result.row.movement,null,'Missing exact opening cannot be invented from alternates/current/unknown history');assert.doesNotMatch(result.html,/Same-book movement|Line moved toward/);assert.equal(result.tracking.marketMovement,null);
}
const changed=publish([alternate,exact,quote(6.5,-115,priorAt,false)],-125);
assert.deepEqual(changed.row.movement,{sportsbook:'synthetic',openingLine:6.5,openingPrice:-110,priorLine:6.5,priorPrice:-115,currentLine:6.5,currentPrice:-125});assert.match(changed.html,/Price strengthened Over/);assert.equal(changed.tracking.marketMovement,'6.5->6.5');
const reversed=publish([quote(6.5,-115,priorAt,false),exact,alternate],-125);assert.deepEqual(reversed.row.movement,changed.row.movement,'Actual exact-event chronology survives source permutation');
const under=publish([{...alternate,side:'under'}, {...exact,side:'under'}, {...quote(6.5,-115,priorAt,false),side:'under'}],-125,'under');
assert.equal(under.row.side,'under');assert.deepEqual(under.row.movement,changed.row.movement);assert.match(under.html,/Price strengthened Under/);
for(const history of [[exact,quote(6.5,-120,openingAt)],[exact,quote(6.5,-115,priorAt,false),quote(6.5,-125,priorAt,false)],[exact,quote(6.5,-120,past,false)]]){
 for(const ordered of [history,[...history].reverse()])assert.equal(publish(ordered).row.movement,null,'Equal-native-clock contradictory prices refuse movement without an arbitrary winner');
}
// Cross-line history remains raw context. Even a sole old different line is
// not a declared main-line path in the captured Quote contract.
assert.equal(publish([quote(5.5,-110,openingAt),quote(5.5,-115,priorAt,false)]).row.movement,null);
const old=structuredClone(changed.locked);old.decisions[0].movement={sportsbook:'synthetic',openingLine:2.5,openingPrice:-500,priorLine:null,priorPrice:null,currentLine:6.5,currentPrice:-125};
const oldBytes=JSON.stringify(old),legacyHtml=renderToStaticMarkup(<NbaPlayerPropsProductDashboard snapshot={old} initialSelectedKey={old.decisions[0].decisionKey}/>),oldTracking=buildNbaPlayerPropsLockedTrackingRows({snapshot:old});
assert.strictEqual(applyNbaSiteAi(old,normal.p,normal.choices,at),old);assert.equal(JSON.stringify(old),oldBytes);assert.equal(renderToStaticMarkup(<NbaPlayerPropsProductDashboard snapshot={old} initialSelectedKey={old.decisions[0].decisionKey}/>),legacyHtml);assert.deepEqual(buildNbaPlayerPropsLockedTrackingRows({snapshot:old}),oldTracking,'Stored legacy locked movement remains exact');
console.log('NBA AI movement passed: actual source/parser/pricing/member/render/tracking, exact-line price chronology, alternate/missing/unknown/conflict refusal, permutation/feed-duplicate invariance, unchanged forecast/price/grade and exact old locked precedence. No I/O.');
