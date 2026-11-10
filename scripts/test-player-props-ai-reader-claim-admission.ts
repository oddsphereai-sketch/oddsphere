/* eslint-disable @typescript-eslint/no-explicit-any -- Test-only malformed wire/schema fixtures deliberately violate the accepted types to exercise rejection. */
/** Prospective R5 factual admission. Saved R29 failures are negative strings,
 * never corrections/reinterpretations of an accepted historical response. */
import assert from 'node:assert/strict';
import {PRODUCT_RELEASE,type GamePacket,type Evidence} from '../lib/playerPropsAi/evidenceContract';
import {compileMarketReport} from '../lib/playerPropsAi/marketReport';
import {digest} from '../lib/playerPropsAi/evidence';
import {compileReaderClaims,NBA_READER_UNIT_CONTRACT} from '../lib/playerPropsAi/readerClaims';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {encodeCanonicalScenarioLaw,GENERATIVE_WIRE_RELEASE} from '../lib/playerPropsAi/generativeCoordinates';
import {validateLaw} from '../lib/playerPropsAi/law';
import {parseJointReview,parseJointPlayerReview,sourceInput,jointReviewSchema} from '../lib/playerPropsAi/request';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';
import {OriginalPartActorAdmission} from '../lib/playerPropsAi/actorAdmission';
import {createHash} from 'node:crypto';

globalThis.fetch=async()=>{throw Error('Typed factual admission forbids network');};
const at='2026-11-10T17:00:00Z',v=(n:number)=>Array<number>(16).fill(n),id='nba-bdl-player:145';
const source=(e:Evidence)=>e;
const input:GamePacket={release:PRODUCT_RELEASE,sport:'nba',gameId:'synthetic',start:'2026-11-11T01:00:00Z',lock:'2026-11-11T00:00:00Z',cutoff:at,stage:'early',sourceLimitations:[],players:[{id,name:'Synthetic Player',team:'PHI',opponent:'BOS',markets:['rebounds','threes'],missing:[],evidence:[
 ...[2,3,5].map((reb,i)=>source({id:`log:${i}`,kind:'recent_games',source:'synthetic played games',availableAt:at,value:{game:{startTime:`2026-11-0${7+i}T00:00:00Z`,homeTeam:'PHI',awayTeam:'BOS'},box:{minutes:30,points:18,oreb:1,dreb:reb-1,ast:3,fg3m:i*2}}})),
 source({id:'status',kind:'availability',source:'synthetic exact-game injury report',availableAt:at,value:{context:{away:{team:'BOS',known:true,players:[]},home:{team:'PHI',known:true,players:[{name:'Different Teammate',status:'out',injuryType:'Back',reportedAt:at}]}}}}),
 ...(['rebounds','threes'] as const).map(m=>source({id:`prior:${m}`,kind:'independent_model',source:'synthetic native prior',availableAt:at,value:{market:m,line:2.5,independentProjection:m==='rebounds'?3.2:2.1,independentOver:m==='rebounds'?.601188:.442675,independentUnder:m==='rebounds'?.398812:.557325,independentEventStatus:'stored_native_reference_side',selectedSide:m==='rebounds'?'over':'under',matchup:[{key:'game_pace_mean_5',label:'Game pace',value:96.7},{key:'opponent_adjusted_defense',label:'Opponent defense',value:106.7}]}})),
 source({id:'benchmark',kind:'matchup',source:'synthetic trusted observed reference',availableAt:at,value:{readerBenchmarks:true,readerUnitContract:NBA_READER_UNIT_CONTRACT,reference:{league_current_season_pace:101.8736,league_prior_season_pace:101.6933,league_current_season_team_games:300,league_prior_season_team_games:300}}}),
]}],quotes:(['rebounds','threes'] as const).flatMap(m=>(['over','under'] as const).map(side=>({id:`q:${m}:${side}`,playerId:id,market:m,line:2.5,side,book:'book',provider:'synthetic',american:m==='rebounds'?(side==='over'?-157:116):(side==='over'?140:-190),opening:false,live:false,observedAt:at,receivedAt:at,receivedAtProvenance:'provider_response' as const})))};
const packet=compileMarketReport(input);
const aliases=new Map([...evidenceAliases(packet)].map(([alias,sourceId])=>[sourceId,alias]));
const canonical={weights:v(1),outcomes:{points:v(18),rebounds:[...v(2).slice(0,8),...v(5).slice(0,8)],assists:v(3),threes:[...v(1).slice(0,8),...v(3).slice(0,8)]}};
const actor=verifiedReaderFixture(packet,id,{priorRead:Object.fromEntries(independentPriorEvents(packet.players[0]).map(e=>[aliases.get(e.sourceId)!,e.preferredOutcome])),evidenceIds:[aliases.get('status')!],confidence:[1,1],exceptions:[null,null],gaps:[],law:encodeCanonicalScenarioLaw('nba',packet.players[0],canonical)});
const raw={wireRelease:PROPS_AI_WIRE_RELEASE,players:{[id]:actor}},before=digest({packet,raw}),accepted=parseJointReview(packet,raw),row=accepted.players[0];
assert.deepEqual(row.law,validateLaw('nba',packet.players[0],canonical),'Reader admission cannot alter the canonical numerical law');
assert.throws(()=>parseJointReview(packet,{...raw,wireRelease:GENERATIVE_WIRE_RELEASE}),/wire release mismatch/,'The historical R4 coordinate wire is not a production factual-admission bypass');
assert(row.coverage.availability.observation.includes('other players'));assert(!row.coverage.availability.observation.includes('lists Out'));
assert(row.coverage.game_environment.observation.includes('below'));assert(row.coverage.game_environment.observation.includes('101.874'));
assert(row.coverage.market.observation.includes('2 independent-prior directions agree'));assert(row.sourceReadProofs);assert.equal(digest({packet,raw}),before);
const catalog=compileReaderClaims(packet)[id],market=catalog.areas.market.claims[0];assert.equal((market.details as unknown as {relation:string}[]).filter(e=>e.relation==='same_direction').length,2);
const compactProof=row.sourceReadProofs as {catalogHash:string;claims:{id:string;claimHash:string;area:string;kind:string;factIds:string[];factHashes:string[];sourceIds:string[];availableAt:string|null}[];areas:Record<string,unknown>};
assert.equal(compactProof.catalogHash,digest(catalog));assert.equal(compactProof.claims.length,catalog.claims.length);
for(const proof of compactProof.claims){const full=catalog.claims.find(c=>c.id===proof.id)!;assert.equal(proof.claimHash,digest(full),'Private proof must bind every byte of the FULL original claim, including relationship details');assert.deepEqual(proof.factIds,full.factIds);assert.deepEqual(proof.factHashes,full.factHashes);assert.deepEqual(proof.sourceIds,full.sourceIds);assert.equal(proof.availableAt,full.availableAt);assert(!Object.hasOwn(proof,'details'));assert(!Object.hasOwn(proof,'text'));assert(!Object.hasOwn(proof,'shortText'));}
assert(Object.values(compactProof.areas).every(area=>!Object.hasOwn(area as object,'claims')),'Area selections must not duplicate full claims');assert(Buffer.byteLength(JSON.stringify(compactProof))<Buffer.byteLength(JSON.stringify(catalog)),'Exact hash bindings must reduce private proof storage without deleting original input evidence');
const schema=jointReviewSchema(packet) as any,areas=schema.properties.players.properties[id].properties.coverage.properties;
assert.deepEqual(areas.availability.properties.effect.enum,['neutral','uncertain','unavailable']);assert.deepEqual(areas.availability.properties.judgment.enum,['neutral','uncertain'],'Unknown own availability schema must match the runtime factual-influence guard');
assert.deepEqual(areas.head_to_head.properties.effect.enum,['uncertain','unavailable']);assert.deepEqual(areas.head_to_head.properties.judgment.enum,['neutral','uncertain'],'Missing source schemas preserve the existing effect restriction');
for(const [field,value] of [['effect','upward'],['judgment','supports']] as const){const invalid:any=structuredClone(raw);invalid.players[id].coverage.availability[field]=value;assert.throws(()=>parseJointReview(packet,invalid),/source_claims/);}
const oldSentences=[['availability','The report lists him out with a back issue, with no confirmed clearance.'],['game_environment','The supplied pace figure lacks a comparison to establish an advantage.'],['market','The model and markets disagree on rebounds and threes.']] as const;
for(const [area,sentence] of oldSentences){
 const invalid:any=structuredClone(raw);invalid.players[id].coverage[area].observation=sentence;assert.throws(()=>parseJointReview(packet,invalid),/source_claims/);
 const assessment:any=structuredClone(raw);assessment.players[id].assessment=sentence;assert.throws(()=>parseJointReview(packet,assessment),/source_claims/);
 const gap:any=structuredClone(raw);gap.players[id].gaps=[sentence];assert.throws(()=>parseJointReview(packet,gap),/source_claims/);
 const exception:any=structuredClone(raw);exception.players[id].exceptions=[sentence,null];assert.throws(()=>parseJointReview(packet,exception),/source_claims/);
}
for(const area of ['availability','game_environment','market'] as const){const omitted:any=structuredClone(raw);omitted.players[id].coverage[area].claimIds=[];assert.throws(()=>parseJointReview(packet,omitted),/source_claims/);}
const foreign:any=structuredClone(actor);foreign.coverage.availability.claimIds=[catalog.areas.market.claims[0].id];assert.throws(()=>parseJointPlayerReview(packet,id,foreign),/source_claims/);
const forged:any=structuredClone(actor);forged.coverage.availability.claimIds=['different-actor:out'];assert.throws(()=>parseJointPlayerReview(packet,id,forged),/source_claims/);
const extra:any=structuredClone(actor);extra.sourceReadProofs={release:'forged'};assert.throws(()=>parseJointPlayerReview(packet,id,extra),/source_claims/);
const declined:any=structuredClone(raw);declined.players[id].gaps=['forecast_declined'];declined.players[id].exceptions=['forecast_declined','forecast_declined'];declined.players[id].law=null;const abstained=parseJointReview(packet,declined).players[0];assert(abstained.exceptions.every(s=>s?.includes('supported estimate was not established')));assert(!abstained.exceptions.some(s=>s?.includes('missing')));
const invalidActor:any=structuredClone(raw);invalidActor.players[id].coverage.availability.observation=oldSentences[0][1];const admission=new OriginalPartActorAdmission(packet),proposal=admission.propose(JSON.stringify(invalidActor),{part:1,phase:1,model:'gpt-6-luna',requestedTier:'default',actualTier:'default',responseId:'synthetic',requestHash:createHash('sha256').update('synthetic').digest('hex')});assert.equal(proposal.admittedActors.length,0,'Wrong factual wire cannot be retained before billing proof');
const noBenchmark=structuredClone(packet);noBenchmark.players[0].evidence=noBenchmark.players[0].evidence.filter(e=>e.id!=='benchmark');assert(compileReaderClaims(noBenchmark)[id].areas.game_environment.claims[0].kind.includes('unavailable'));
const out=structuredClone(packet);const availability=out.players[0].evidence.find(e=>e.id==='status')!;((availability.value as any).context.home.players as any[]).push({name:'Synthetic Player',status:'out',reportedAt:at});assert(compileReaderClaims(out)[id].areas.availability.claims[0].text.includes('lists Out'));
const disagree=structuredClone(packet);for(const q of disagree.quotes)if(q.market==='rebounds')q.american=q.side==='over'?140:-190;assert((compileReaderClaims(disagree)[id].areas.market.claims[0].details as unknown as {relation:string}[]).some(e=>e.relation==='opposite_direction'));
assert(sourceInput(packet).includes('verifiedReaderClaims'));assert.equal(digest({packet,raw}),before,'All negative/positive controls preserve original source and raw response');
console.log('Typed factual admission passed: exact saved failure sentences and alternate prose paths reject; mandatory actor/benchmark/event readings, positive source controls, immutable canonical laws and pre-retention rejection pass. No network/paid requests.');
