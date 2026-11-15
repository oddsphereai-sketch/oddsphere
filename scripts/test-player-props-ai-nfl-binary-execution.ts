import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import {qualifyNflExecutionContracts,assertNflExecutionContracts,PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE} from '../lib/playerPropsAi/nflExecutionContracts';
import {sourceEventUsable} from '../lib/playerPropsAi/sourceEvents';
import {executionQuotes} from '../lib/playerPropsAi/executionQuotes';
import {validatePacket,digest} from '../lib/playerPropsAi/evidence';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {validateLaw,lawForecast} from '../lib/playerPropsAi/law';
import {sourceForecastIssues} from '../lib/playerPropsAi/forecastSanity';
import {liveNflPacket} from '../lib/playerPropsAi/liveSources';
import type {GamePacket,Quote} from '../lib/playerPropsAi/evidenceContract';
const deny=()=>{throw Error('Offline binary-event proof denies network');};
globalThis.fetch=async()=>deny();http.get=http.request=https.get=https.request=deny;
net.connect=net.createConnection=tls.connect=deny;
const at='2030-11-17T15:00:00Z',start='2030-11-17T21:00:00Z',lock='2030-11-17T20:00:00Z';
const player={id:'nfl-bdl-player:697',name:'Synthetic Runner',team:'TEN',opponent:'CHI',markets:['anytime_td'],evidence:[],missing:['No independent head supplied']};
const quote=(line:number,id=String(line)):Quote=>({id,playerId:player.id,market:'anytime_td',provider:'balldontlie',book:'synthetic',line,side:'yes',american:150,observedAt:at,receivedAt:at,receivedAtProvenance:'provider_response',opening:false,live:false});
const packet=(rows:Quote[]):GamePacket=>({release:'player_props_ai_offline_full_product_2026_11_06_r1',sport:'nfl',gameId:'game',start,lock,stage:'early',cutoff:at,players:[structuredClone(player)],quotes:rows,executionQuotes:rows,sourceLimitations:[],sourceInputRelease:'player_props_ai_nfl_source_2026_11_09_r3_event_qualification',sourceIdentityRelease:'player_props_ai_nfl_identity_2026_11_10_r1_cutoff_exact_id',sourceIdentityAvailableAt:at});
let checks=0;
const original=packet([quote(.5),quote(2)]),before=digest(original),future=qualifyNflExecutionContracts(original);
validatePacket(future);checks++;
assert.equal(digest(original),before);checks++;
assert.equal(future.sourceExecutionContractRelease,PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE);checks++;
assert.deepEqual(future.players,original.players);checks++;
assert.deepEqual(criticalContextHashes(future),criticalContextHashes(original));checks++;
assert.equal(future.quotes.length,2);checks++;
assert.equal(future.quotes[1].line,2);checks++;
assert.equal(future.quotes[1].american,150);checks++;
assert(!sourceEventUsable(future.quotes[1]));checks++;
assert.deepEqual(executionQuotes(future,at).map(q=>q.line),[.5]);checks++;
const law=validateLaw('nfl',player,{weights:Array(16).fill(1),outcomes:{touchdowns:Array.from({length:16},(_,i)=>i%2)}});
assert.equal(lawForecast(law,'anytime_td',2,true).over,0);checks++;
assert(sourceForecastIssues(original,player,law).some(i=>i.code==='unsupported_priced_event_certainty'&&i.events?.some(e=>e.line===2)));checks++;
assert(!sourceForecastIssues(future,player,law).some(i=>i.events?.some(e=>e.line===2)));checks++;
const certain=validateLaw('nfl',player,{weights:Array(16).fill(1),outcomes:{touchdowns:Array(16).fill(0)}});
assert(sourceForecastIssues(future,player,certain).some(i=>i.code==='unsupported_priced_event_certainty'&&i.events?.some(e=>e.line===.5)));checks++;
for(const line of [-1,0,1,1.5,2,3,20]){
  const raw=packet([quote(line)]),held=qualifyNflExecutionContracts(raw);
  validatePacket(held);assert.deepEqual(held.players,raw.players);assert.equal(executionQuotes(held,at).length,0);checks+=3;
}
const withPrior=structuredClone(future);
withPrior.players[0].evidence=[{id:'independent-binary-contract',kind:'independent_model',availableAt:at,source:'synthetic independent source',value:{market:'anytime_td',line:2,selectedSide:'yes',independentSelectedSideProbability:.25}}];
assert(sourceForecastIssues(withPrior,withPrior.players[0],law).some(i=>i.code==='unsupported_zero_probability_tail'));checks++;
withPrior.players[0].evidence[0].value={market:'anytime_td',line:.5,selectedSide:'yes',independentSelectedSideProbability:.25};
assert(sourceForecastIssues(withPrior,withPrior.players[0],certain).some(i=>i.code==='unsupported_zero_probability_tail'));checks++;
for(const delta of [
  (p:GamePacket)=>{delete p.sourceExecutionContractRelease;},
  (p:GamePacket)=>{delete p.quotes[1].sourceEvent;},
  (p:GamePacket)=>{p.quotes[1].sourceEvent!.threshold=3;},
  (p:GamePacket)=>{p.quotes[1].sourceEvent!.status='verified';},
  (p:GamePacket)=>{p.sourceIdentityAvailableAt='2030-11-17T15:00:01Z';},
  (p:GamePacket)=>{p.sourceInputRelease='unknown';},
]){const bad=structuredClone(future);delta(bad);assert.throws(()=>validatePacket(bad));checks++;}
for(const market of ['passing_tds','passing_attempts','receptions','rushing_yards']){
  const q={...quote(2),market},raw=packet([q]);raw.players[0].markets=[market];
  const qualified=qualifyNflExecutionContracts(raw);validatePacket(qualified);
  assert.equal(executionQuotes(qualified,at).length,1);assert.equal(qualified.quotes[0].sourceEvent,undefined);checks+=2;
}
for(const sport of ['nba','mlb'] as const){assert.throws(()=>qualifyNflExecutionContracts({...original,sport}));checks++;}
// Real live-source builder: raw source declaration is preserved when available;
// no price, line, player or otherwise supported binary event is replaced.
type Args=Parameters<typeof liveNflPacket>[0];
const observations=[.5,2].map(line=>({provider:'balldontlie',providerObservationId:'source-'+line,providerEventId:'event',providerPlayerId:'697',playerName:player.name,playerTeam:'TEN',canonicalGameId:'game',scheduledStart:start,homeTeam:'TEN',awayTeam:'CHI',market:'anytime_td',providerMarket:'anytime_td',offerType:'milestone',side:'yes',line,sportsbook:'synthetic',americanPrice:150,observedAt:at,receivedAt:at,fetchedAt:at,isOpening:false,isLive:false}));
const liveArgs:Args={game:{id:'game',start,home:'TEN',away:'CHI'},window:{gameId:'game',stage:'early',cutoff:at,lock},snapshot:{week:11,generatedAt:at,board:{decisions:[]},memberDecisions:[]} as unknown as Args['snapshot'],observations:{generatedAt:at,observations} as unknown as Args['observations'],history:{games:[],stats:[],teamStats:[],playMetrics:[],updatedAt:at} as unknown as Args['history'],context:{capturedAt:at,games:[{canonicalGameId:'game',scheduledStart:start,homeTeam:'TEN',awayTeam:'CHI',homeDepth:{team:'TEN',capturedAt:at,roster:[{playerId:'697',name:player.name,position:'RB'}]},awayDepth:{team:'CHI',capturedAt:at,roster:[]},injuries:{players:[]},weather:null}]} as unknown as Args['context']};
const live=liveNflPacket(liveArgs);
validatePacket(live);checks++;
assert.equal(live.players.length,1);checks++;
assert.deepEqual(live.players[0].markets,['anytime_td']);checks++;
assert.equal(executionQuotes(live,at).filter(q=>q.market==='anytime_td').length,1);checks++;
const unsupported=live.executionQuotes!.find(q=>q.line===2)!;
assert.equal(unsupported.sourceEvent!.providerMarket,'anytime_td');checks++;
assert.equal(unsupported.sourceEvent!.normalizedOfferType,'milestone');checks++;
assert.equal(unsupported.sourceEvent!.observationId,'source-2');checks++;
assertNflExecutionContracts(live);checks++;
// The owned upstream conflict diagnostic must remain an unqualified source
// reference, without blocking the valid binary quote or another healthy actor.
const conflictArgs=structuredClone(liveArgs);
conflictArgs.observations.observations.push({...conflictArgs.observations.observations[1],providerMarket:'player_anytime_td'});
const conflictBefore=digest(conflictArgs),conflict=liveNflPacket(conflictArgs);
validatePacket(conflict);checks++;
assert.equal(digest(conflictArgs),conflictBefore);checks++;
assert.equal(conflict.players.length,1);checks++;
assert.deepEqual(conflict.players[0].markets,['anytime_td']);checks++;
assert.deepEqual(criticalContextHashes(conflict),criticalContextHashes(live));checks++;
assert.deepEqual(executionQuotes(conflict,at).map(q=>q.line),[.5]);checks++;
const conflicts=conflict.quotes.filter(q=>q.line===2);
assert.equal(conflicts.length,2);checks++;
assert(conflicts.every(q=>!sourceEventUsable(q)&&q.sourceEvent!.reason.includes('Conflicting raw market declarations')));checks++;
assert.deepEqual(conflicts.map(q=>q.sourceEvent!.providerMarket).sort(),['anytime_td','player_anytime_td']);checks++;
for(const reason of ['', '  ', 'x'.repeat(2049)]){const bad=structuredClone(future);bad.quotes[1].sourceEvent!.reason=reason;assert.throws(()=>validatePacket(bad));checks++;}
console.log(`NFL binary execution contract: ${checks} controls passed; all actors/scopes retained, valid event promotion and invalid-quote refusal, original law and context unchanged. No network or paid calls.`);
