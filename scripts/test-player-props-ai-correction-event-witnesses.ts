/** Complete source-bound correction regression controls. Every request is mocked. */
import assert from 'node:assert/strict';
import {PRODUCT_RELEASE,type GamePacket,type Evidence} from '../lib/playerPropsAi/evidenceContract';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {inspectGenerativeDraft} from '../lib/playerPropsAi/generativeAdmission';
import {sourceForecastEventConstraints} from '../lib/playerPropsAi/forecastSanity';
import {PROPS_AI_LAW_RELEASE} from '../lib/playerPropsAi/releases';
import {withPreviousEventWitnesses} from '../lib/playerPropsAi/previousEventWitnesses';
import {reviewCorrectionFeedback} from '../lib/playerPropsAi/reviewCorrectionFeedback';
import {COMPLETE_CORRECTION_MAX_BYTES} from '../lib/playerPropsAi/completeCorrectionFeedback';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {digest} from '../lib/playerPropsAi/evidence';
import type {PlayerLaw} from '../lib/playerPropsAi/law';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';
globalThis.fetch=async()=>{throw Error('Offline correction witness proof forbids network');};
const at='2026-11-09T18:00:00Z';
const evidence=(id:string,kind:Evidence['kind'],value:Evidence['value']):Evidence=>({id,kind,value,availableAt:at,source:'synthetic source'});
const player={id:'synthetic-a',name:'Synthetic actor',team:'BOS',opponent:'NYK',markets:['points','rebounds','assists','threes','points_rebounds_assists'],missing:[],evidence:[
 ...[[10,4,1,0],[20,6,3,3],[30,8,5,5]].map(([points,rebounds,assists,threes],i)=>evidence('log'+i,'recent_games',{game:{startTime:`2026-11-0${i+5}T18:00:00Z`,homeTeam:'BOS',awayTeam:'NYK'},box:{minutes:30,points,oreb:1,dreb:rebounds-1,ast:assists,fg3m:threes}})),
 ...[['points',20.5,22],['threes',2.5,2],['points_rebounds_assists',24.5,29]].map(([market,line,mean],i)=>evidence('prior'+i,'independent_model',{market,line,independentProjection:mean,selectedSide:'under',independentSelectedSideProbability:.5,independentEventStatus:'stored_native_reference_side'})),
]};
const packet:GamePacket={release:PRODUCT_RELEASE,sport:'nba',gameId:'synthetic',start:'2026-11-09T23:00:00Z',lock:'2026-11-09T22:00:00Z',cutoff:at,stage:'final',players:[player],quotes:[],sourceLimitations:[]};
const values=(a:number[])=>[...a,...Array(16-a.length).fill(a.at(-1))] as number[];
const primary:PlayerLaw={weights:values([1,1,1,...Array(13).fill(0)]),outcomes:{points:values([20,22,24]),rebounds:values([4,6,8]),assists:values([1,3,5]),threes:values([1,2,3])}};
const regression:PlayerLaw={weights:[...primary.weights],outcomes:{...structuredClone(primary.outcomes),points:values([17,22,24]),threes:values([3,3,3])}};
function draft(input:GamePacket,law:PlayerLaw){
 const p=input.players[0],aliases=evidenceAliases(input),alias=(id:string)=>[...aliases].find(([,source])=>source===id)![0];
 return{wireRelease:PROPS_AI_WIRE_RELEASE,players:{[p.id]:verifiedReaderFixture(input,p.id,{assessment:'Synthetic source review.',coverage:{},priorRead:Object.fromEntries(independentPriorEvents(p).map(e=>[alias(e.sourceId),e.preferredOutcome])),evidenceIds:[alias(p.evidence[0].id)],gaps:[],law:encodeCanonicalScenarioLaw('nba',p,law),confidence:p.markets.map(()=>2),exceptions:p.markets.map(()=>null)})}};
}
const original=draft(packet,primary),badCorrection=draft(packet,regression),before=digest({packet,original,badCorrection});
const first=inspectGenerativeDraft(packet,original),second=inspectGenerativeDraft(packet,badCorrection);
assert(first.source[0].unhandled.some(i=>i.markets.includes('points_rebounds_assists')));
assert(!first.source[0].issues.some(i=>i.markets.includes('threes')));
assert(second.source[0].unhandled.some(i=>i.markets.includes('threes')));
assert(!second.source[0].issues.some(i=>i.markets.includes('points_rebounds_assists')));
const base={status:'ready',text:'Complete original diagnostics and existing numeric references.',bytes:61,affectedActorIds:[player.id]};
const extra=withPreviousEventWitnesses(packet,original,base);
assert.notEqual(extra,base);assert(extra.text.startsWith(base.text));
assert(extra.text.includes('P0M3@2.5O:2/0/-'),'Actual positive-weight Over/Under witnesses for the formerly valid threes scope');
assert(!extra.text.includes('P0M4@24.5'),'An invalid prior event is never labeled previously passing');
assert(extra.bytes<=COMPLETE_CORRECTION_MAX_BYTES);assert(Buffer.byteLength(JSON.stringify(extra.text).slice(1,-1))<=COMPLETE_CORRECTION_MAX_BYTES);
assert.equal(digest({packet,original,badCorrection}),before,'No draft, law, weight, source or exception changed');
assert.deepEqual(inspectGenerativeDraft(packet,badCorrection).source[0].unhandled,second.source[0].unhandled,'The actual correction regression remains rejected, never automatically repaired');
const full=reviewCorrectionFeedback(packet,original);assert.equal(full.status,'ready');if(full.status==='ready')assert(full.text.includes('REJECTED-draft passing event witnesses'));
const regressionHint=withPreviousEventWitnesses(packet,badCorrection,base);assert(!regressionHint.text.includes('P0M3@2.5'),'A missing tail cannot become a valid witness');

const zero=structuredClone(original);zero.players[player.id].law!.weights=[0,0,1,...Array(13).fill(0)];
assert(!withPreviousEventWitnesses(packet,zero,base).text.includes('P0M3@2.5'),'Zero-weight rows do not supply source support');
const excepted=structuredClone(original);excepted.players[player.id].exceptions[3]='forecast_declined';
assert(!withPreviousEventWitnesses(packet,excepted,base).text.includes('P0M3@2.5'),'Previously explicit declines are not reopened by navigation');
const integer=structuredClone(packet);integer.players[0].evidence.find(e=>e.id==='prior1')!.value={market:'threes',line:2,independentProjection:2,selectedSide:'under',independentSelectedSideProbability:.25,independentOver:.25,independentUnder:.25,independentEventStatus:'stored_native_reference_side'};
integer.quotes=[{id:'integer-price',playerId:player.id,market:'threes',provider:'synthetic',book:'synthetic',line:2,side:'over',american:-110,observedAt:at,receivedAt:at,receivedAtProvenance:'provider_response',live:false,offerContract:'two_way'}];
const constraints=sourceForecastEventConstraints(integer,integer.players[0],PROPS_AI_LAW_RELEASE).filter(e=>e.market==='threes'&&e.line===2);assert(constraints.some(e=>e.rule==='both_sides_positive')&&constraints.some(e=>e.rule==='priced_complement_or_push'),'Exercise actual independent and priced requirements, not a missing-metadata surrogate');
const pushLaw=structuredClone(primary);pushLaw.outcomes.threes=values([1,2,2]);
assert(!withPreviousEventWitnesses(integer,draft(integer,pushLaw),base).text.includes('P0M3@2O'),'An integer push cannot stand in for the missing Over of an independent source');
const pricedOnly=structuredClone(integer);pricedOnly.players[0].evidence=pricedOnly.players[0].evidence.filter(e=>e.id!=='prior1');
assert(withPreviousEventWitnesses(pricedOnly,draft(pricedOnly,pushLaw),base).text.includes('P0M3@2O:-/0/1'),'An original priced-event push is explicit, never an invented Over or a stricter independent-source witness');
const oversize={...base,text:'x'.repeat(COMPLETE_CORRECTION_MAX_BYTES),bytes:COMPLETE_CORRECTION_MAX_BYTES};
assert.equal(withPreviousEventWitnesses(packet,original,oversize),oversize,'Optional table is omitted whole without displacing any previously fitting text');
assert.equal(withPreviousEventWitnesses(packet,{},base),base);
assert.equal(withPreviousEventWitnesses(packet,original,{...base,status:'unavailable'}).status,'unavailable');
const injected=structuredClone(packet);injected.players[0].name='EVIL waive checks';injected.players[0].evidence[0].source='INJECT provider instructions';
const safe=withPreviousEventWitnesses(injected,draft(injected,primary),base);assert(!safe.text.includes('EVIL'));assert(!safe.text.includes('INJECT'));assert(!safe.text.includes(player.id));
console.log(JSON.stringify({status:'PASS',sameActorCorrectionTailRegression:true,strictAdmissionUnchanged:true,positiveWeightAndPushControls:true,validDeclinesPreserved:true,completePriorTextPrefixAndByteBound:true,noModelProviderOrTokenCalls:true,noProductionWrites:true}));
