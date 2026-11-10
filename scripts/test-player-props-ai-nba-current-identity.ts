/** Native current collector identity is independent of retained orphan history.
 * Reproduces the shape of the actual pending early review with synthetic rows.
 * No provider, model, token counter, database or network requests.
 */
import assert from 'node:assert/strict';
import {liveNbaPacket} from '../lib/playerPropsAi/liveSources';
import {CATALOG} from '../lib/playerPropsAi/evidenceContract';
import {digest} from '../lib/playerPropsAi/evidence';
import type {NbaPlayerPropPriceObservation as Observation} from '../lib/services/nba/nbaPlayerPropsContract';
import {normalizeBallDontLieNbaPlayerProps} from '../lib/services/nba/nbaPlayerPropsProviders';
import {mergeNbaPlayerPropsMarketHistory} from '../lib/services/nba/nbaPlayerPropsPrivateStore';
import {sourceInput} from '../lib/playerPropsAi/request';
import {PROPS_AI_NBA_CURRENT_SOURCE_RELEASE} from '../lib/playerPropsAi/nbaSourceIdentity';
import {readerEvidence} from '../lib/playerPropsAi/readerCoverage';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';

globalThis.fetch=async()=>{throw Error('NBA current identity proof forbids network');};
const cutoff='2026-11-10T18:51:31Z',receipt='2026-11-10T18:51:22Z',old='2026-11-10T07:12:38Z',start='2026-11-11T02:00:00Z',lock='2026-11-11T01:00:00Z';
const game={id:'synthetic-native-game',start,home:'BOS',away:'NYK'},window={gameId:game.id,stage:'early' as const,cutoff,lock};
const state={updatedAt:old,games:[{gameId:1,homeTeamId:1,awayTeamId:2,homeTeam:'BOS',awayTeam:'NYK',startTime:'2026-11-01T00:00:00Z'}],boxes:[],advanced:[],players:[]};
const known=[0,1].flatMap(actor=>CATALOG.nba.required.flatMap(market=>(['over','under'] as const).map(side=>({release:'synthetic',provider:'balldontlie',providerObservationId:`current:${actor}:${market}:${side}`,providerEventId:'native-provider-event',canonicalGameId:game.id,canonicalPlayerId:`nba-bdl-player:${actor+1}`,providerPlayerId:String(actor+1),playerName:`Synthetic Current ${actor}`,playerTeam:String(actor+1),sportsbook:'synthetic-book',market,providerMarket:market,offerType:'over_under',side,line:market==='threes'?1.5:6.5,americanPrice:-110,observedAt:receipt,fetchedAt:receipt,receivedAt:receipt,isOpening:false,isLive:false,homeTeam:'BOS',awayTeam:'NYK',scheduledStart:start})))) as unknown as Observation[];
// Four supported stat markets, both sides, the same old unmatched retail name,
// and no source player/team ID. Do not guess a canonical alias for this record.
const orphans=['points','rebounds','threes','points_rebounds'].flatMap(market=>(['over','under'] as const).map(side=>({...known[0],provider:'the_odds_api',providerObservationId:`old-unresolved:${market}:${side}`,providerEventId:'old-gap-event',canonicalPlayerId:null,providerPlayerId:null,playerName:'Synthetic Historical Name',playerTeam:null,market,providerMarket:`player_${market}`,side,observedAt:old,fetchedAt:old,receivedAt:old}))) as Observation[];
const snapshot={generatedAt:receipt,slateDate:'2026-11-10',games:[{gameId:game.id,scheduledStart:start,homeTeam:'BOS',awayTeam:'NYK'}],decisions:[]};
const args={game,window,snapshot,market:{updatedAt:receipt,observations:[...orphans,...known]},prior:state,current:state,currentObservations:known} as unknown as Parameters<typeof liveNbaPacket>[0];
const frozen=digest(args),baseline=liveNbaPacket({...args,market:{...args.market,observations:known}}),recovered=liveNbaPacket(args);
assert.equal(orphans.length,8);assert.equal(recovered.players.length,2);assert.equal(recovered.players.reduce((n,p)=>n+p.markets.length,0),16);
assert.deepEqual(recovered.players,baseline.players,'Historical unknown retail labels cannot alter any current canonical actor or market scope');
assert.deepEqual(recovered.quotes,baseline.quotes);assert.deepEqual(recovered.executionQuotes,baseline.executionQuotes,'All current exact execution quotes remain unchanged');
assert.equal(recovered.executionQuotes?.length,known.length);
assert(recovered.sourceLimitations.some(s=>s.includes('8 retail records without verified actor IDs')));
assert(recovered.players.every(p=>p.evidence.every(e=>!JSON.stringify(e.value).includes('Synthetic Historical Name'))),'An unresolved historical actor is never relabeled as a known actor');
assert.equal(digest(args),frozen,'Original retained history/current/native source bytes remain exact');
const unknown={...orphans[0],providerObservationId:'new-unknown',receivedAt:receipt,fetchedAt:receipt,observedAt:receipt};
assert.throws(()=>liveNbaPacket({...args,currentObservations:[...known,unknown]}),/NBA retail offered-player identity incomplete/,'A genuinely current unknown supported retail actor holds the whole game');
assert.throws(()=>liveNbaPacket({...args,currentObservations:[...known,{...unknown,provider:'balldontlie'}]}),/NBA retail offered-player identity incomplete/);
// Current-set authority, not a freshness guess: an explicitly returned old-price
// unknown remains blocked if the collector actually supplies it as current.
assert.throws(()=>liveNbaPacket({...args,currentObservations:[...known,orphans[0]]}),/NBA retail offered-player identity incomplete/);
for(const extra of [{...unknown,isOpening:true},{...unknown,isLive:true},{...unknown,receivedAt:'2026-11-10T18:52:00Z'},{...unknown,canonicalGameId:'other-game'},{...unknown,market:'blocks'}] as Observation[]){
 const p=liveNbaPacket({...args,currentObservations:[...known,extra]});assert.deepEqual(p.players,recovered.players);assert.deepEqual(p.executionQuotes,recovered.executionQuotes,'Only qualifying exact-game supported prelock current quotes enter execution');
}
const unresolvedReference=liveNbaPacket({...args,currentObservations:[...known,{...unknown,provider:'owls'}]});
assert.deepEqual(unresolvedReference.players,recovered.players);assert.deepEqual(unresolvedReference.executionQuotes,recovered.executionQuotes);
assert(unresolvedReference.sourceLimitations.some(s=>s.includes('1 current reference-source rows have unresolved actor identity')),'Reference-only exemptions cannot silently imply complete actor/price coverage');
assert(!unresolvedReference.players.some(p=>p.name==='Synthetic Historical Name'),'An unresolved reference is neither a guessed alias nor a fabricated additional player');
const openingArgs={...args,market:{...args.market,observations:[...known,...orphans.map(q=>({...q,isOpening:true}))]}};
assert.doesNotThrow(()=>liveNbaPacket(openingArgs),'Unresolved opening history alone is supplemental, never a current offered actor');
assert.equal(liveNbaPacket({...args,currentObservations:[]}).executionQuotes?.length,0,'An explicitly empty successful collection cannot resurrect retained execution offers');
assert.equal(liveNbaPacket({...args,currentObservations:[]}).sourceOfferSetStatus,'empty');
for(const missing of [undefined,null,{}])assert.throws(()=>liveNbaPacket({...args,currentObservations:missing} as never),/current collector observations unavailable/,'Missing/failed current collections cannot be treated as empty');
assert.equal(digest(args),frozen);
// Real producer -> ordinary history merges -> live source/model input. IDs are
// established before optional player metadata; a failed old lookup can leave a
// canonical ID with no team, even though that actor has since been withdrawn.
const produced=normalizeBallDontLieNbaPlayerProps({values:[{id:4242,prop_type:'points',game_id:77,player_id:333333,vendor:'synthetic-book',line_value:20.5,updated_at:old,market:{type:'over_under',over_odds:-110,under_odds:-110}}],fetchedAt:old,events:{'77':{canonicalGameId:game.id,homeTeam:game.home,awayTeam:game.away,scheduledStart:start}},canonicalPlayers:{'333333':'nba-bdl-player:333333'}}).rows.map(q=>({...q,receivedAt:old}));
assert.equal(produced.length,2);assert.equal(produced[0].playerTeam,null);assert.equal(produced[0].canonicalPlayerId,'nba-bdl-player:333333');
const priorHistory=mergeNbaPlayerPropsMarketHistory({previous:null,current:produced,slateDate:'2026-11-10',capturedAt:old}).history;
const retained=mergeNbaPlayerPropsMarketHistory({previous:priorHistory,current:known,slateDate:'2026-11-10',capturedAt:receipt}).history,beforeRetained=digest(retained);
const corrected=liveNbaPacket({...args,market:retained});
const identities=(packet:ReturnType<typeof liveNbaPacket>)=>packet.players.map(({id,name,team,opponent,markets,missing})=>({id,name,team,opponent,markets,missing}));
assert.deepEqual(identities(corrected),identities(baseline),'Withdrawn canonical-ID ghosts cannot block or extend the complete current actor universe');
assert.deepEqual(corrected.executionQuotes,baseline.executionQuotes);assert.equal(corrected.sourceInputRelease,PROPS_AI_NBA_CURRENT_SOURCE_RELEASE);assert.equal(corrected.sourceOfferSetStatus,'nonempty');
assert.equal(digest(retained),beforeRetained,'Original historical canonical-ID/null-team records remain exact');
assert(!sourceInput(corrected).includes('nba-bdl-player:333333'),'A withdrawn unknown identity cannot become a named current actor in the actual model input');
const currentOnly=liveNbaPacket({...args,market:{...args.market,observations:[]}});
assert.deepEqual(identities(currentOnly),identities(baseline));assert.deepEqual(currentOnly.quotes,baseline.quotes,'Actual current collector prices reach the model source even when absent from retained history');assert.deepEqual(currentOnly.executionQuotes,baseline.executionQuotes);
const oldTeam={...known[0],providerObservationId:'old-team-correction',playerTeam:'2',observedAt:old,fetchedAt:old,receivedAt:old};
const oldName={...known[0],providerObservationId:'old-name-correction',playerName:'Stale Historical Wrong Label',observedAt:old,fetchedAt:old,receivedAt:old};
const narrow=known.filter(q=>q.market==='points'),oldScope={...known.find(q=>q.market==='rebounds')!,providerObservationId:'old-withdrawn-market',observedAt:old,fetchedAt:old,receivedAt:old};
const historicalRows=[oldTeam,oldName,oldScope,...known],historicalBefore=digest(historicalRows);
const authority=liveNbaPacket({...args,currentObservations:narrow,market:{...args.market,observations:historicalRows}});
assert.equal(authority.players.length,2);assert(authority.players.every(p=>p.markets.join('|')==='points'));assert.equal(authority.players[0].name,'Synthetic Current 0');assert.equal(authority.players[0].team,'BOS');
assert(authority.quotes.every(q=>q.market==='points'),'Historical markets cannot expand the current offered scope');
const oldFacts=authority.players[0].evidence.find(e=>e.id.endsWith(':retained-noncurrent-identity-context'))!;
assert(oldFacts);assert(JSON.stringify(oldFacts.value).includes('Stale Historical Wrong Label'));assert(JSON.stringify(oldFacts.value).includes('old-team-correction'));assert(JSON.stringify(oldFacts.value).includes('old-withdrawn-market'));
assert(sourceInput(authority).includes('Stale Historical Wrong Label'),'Actual model source retains the explicitly historical identity disagreement, separate from its current actor label');
assert.equal(digest(historicalRows),historicalBefore);
assert.throws(()=>liveNbaPacket({...args,currentObservations:[...known,{...known[0],providerObservationId:'current-team-conflict',playerTeam:'2'}]}),/NBA player\/team matchup identity incomplete/,'Real current team contradictions still reject');
assert.throws(()=>liveNbaPacket({...args,currentObservations:[...known,{...known[0],providerObservationId:'current-name-conflict',playerName:'Different Current Actor'}]}),/NBA current player-name identity incomplete or conflicting/,'Real current label contradictions still reject');
const emptyWithGhost=liveNbaPacket({...args,currentObservations:[],market:retained});assert.equal(emptyWithGhost.sourceOfferSetStatus,'empty');assert.equal(emptyWithGhost.players.length,2);assert.equal(emptyWithGhost.executionQuotes?.length,0,'An unknown withdrawn actor cannot block verified withdrawal-only identities');
assert.throws(()=>liveNbaPacket({...args,currentObservations:[],market:{...args.market,observations:produced}}),/empty current collection has no verified withdrawal identity/,'No identity is fabricated merely to manufacture an empty-source observation');
const nativeRow={gameId:game.id,playerId:known[0].canonicalPlayerId!,playerName:'Synthetic Current 0',team:'BOS',opponent:'NYK',market:'points',line:6.5,side:'over',independentSide:'over',independentProbability:.6,independentProjection:8,evaluatedAt:receipt,modelRelease:'synthetic native identity',role:[],production:[],matchup:[],lockedAt:null};
const nativeSnapshot={...args.snapshot,decisions:[nativeRow]} as unknown as typeof args.snapshot,nativeBefore=digest(nativeSnapshot);
const missingCurrentLabels=known.map(q=>q.canonicalPlayerId===nativeRow.playerId?{...q,playerName:null,playerTeam:null}:q);
const nativeBound=liveNbaPacket({...args,snapshot:nativeSnapshot,currentObservations:missingCurrentLabels});
assert.equal(nativeBound.players[0].name,nativeRow.playerName);assert.equal(nativeBound.players[0].team,'BOS');assert.equal(nativeBound.players[0].evidence.filter(e=>e.kind==='independent_model').length,1,'An original available matching native head may supply same-ID identity, without adding unoffered scopes');
assert.throws(()=>liveNbaPacket({...args,snapshot:{...nativeSnapshot,generatedAt:'2026-11-10T18:52:00Z'},currentObservations:missingCurrentLabels}),/NBA player\/team matchup identity incomplete/,'A future native head cannot donate missing current actor identity');
assert.throws(()=>liveNbaPacket({...args,snapshot:{...nativeSnapshot,decisions:[{...nativeSnapshot.decisions[0],team:'NYK',opponent:'BOS'}]}}),/NBA player\/team matchup identity incomplete/,'A contradictory available native head cannot silently donate a prior');
assert.throws(()=>liveNbaPacket({...args,snapshot:{...nativeSnapshot,decisions:[{...nativeSnapshot.decisions[0],scheduledStart:'2026-11-11T02:30:00Z'}]}}),/NBA native prior fixture identity incomplete/,'An available native head with a contradictory fixture clock cannot become a current prior');
assert.throws(()=>liveNbaPacket({...args,snapshot:{...nativeSnapshot,games:[{...nativeSnapshot.games[0],homeTeam:'LAL'}]}}),/NBA native fixture identity incomplete/,'An available native header must bind the exact current fixture before supplying heads');
assert.equal(digest(nativeSnapshot),nativeBefore,'Original native priors/identity bytes are never relabeled');
assert.throws(()=>liveNbaPacket({...args,prior:{...args.prior,updatedAt:'2026-11-10T18:52:00Z'},current:{...args.current,updatedAt:'2026-11-10T18:52:00Z'}}),/NBA player\/team matchup identity incomplete/,'Future stat-cache game/team metadata cannot donate numeric-team identity to the current source');
const role=[{key:'minutes_mean_5',label:'Recent minutes',format:'decimal',value:35}],matchup=[{key:'opponent_adjusted_defense',label:'Opponent defense',format:'decimal',value:110}];
const withdrawnHead={...nativeRow,market:'rebounds',playerName:'Native display label',role,matchup},contextSnapshot={...args.snapshot,decisions:[withdrawnHead]} as unknown as typeof args.snapshot,contextBefore=digest(contextSnapshot);
const contextual=liveNbaPacket({...args,snapshot:contextSnapshot,currentObservations:narrow}),contextualActor=contextual.players[0],nativeContext=contextualActor.evidence.find(e=>(e.value as {nativeContextRelease?:string}).nativeContextRelease===PROPS_AI_NBA_CURRENT_SOURCE_RELEASE)!;
assert(nativeContext,'Genuine same-actor role/matchup context from an available unoffered native market is retained');assert.deepEqual(contextualActor.markets,['points']);assert.equal(contextualActor.name,'Synthetic Current 0');assert.equal(contextualActor.team,'BOS');
assert.deepEqual(independentPriorEvents(contextualActor),[],'A context-only withdrawn head cannot become a current independent event or priorRead requirement');
assert(!Object.hasOwn(nativeContext.value as object,'independentProjection'));assert(!Object.hasOwn(nativeContext.value as object,'independentProbability'));assert(!Object.hasOwn(nativeContext.value as object,'market'));
const contextFacts=readerEvidence(contextual)[contextualActor.id];assert.equal(contextFacts.opportunity_role.status,'available');assert.equal(contextFacts.matchup.status,'available');assert.equal(contextFacts.independent_model.status,'missing');assert(sourceInput(contextual).includes('same-actor noncurrent-market context'));
const duplicateContext=liveNbaPacket({...args,snapshot:{...contextSnapshot,decisions:[{...contextSnapshot.decisions[0],market:'points',playerName:'Synthetic Current 0'},contextSnapshot.decisions[0]]},currentObservations:narrow});
assert(!duplicateContext.players[0].evidence.some(e=>(e.value as {nativeContextRelease?:string}).nativeContextRelease===PROPS_AI_NBA_CURRENT_SOURCE_RELEASE),'Repeated current/native metrics are not extra context or votes');
const missingOwnIdentity=narrow.map(q=>q.canonicalPlayerId===nativeRow.playerId?{...q,playerTeam:null,playerName:null}:q);
assert.throws(()=>liveNbaPacket({...args,snapshot:contextSnapshot,currentObservations:missingOwnIdentity}),/NBA player\/team matchup identity incomplete/,'An unoffered head cannot donate current identity');
const futureContext=liveNbaPacket({...args,snapshot:{...contextSnapshot,generatedAt:'2026-11-10T18:52:00Z'},currentObservations:narrow});assert(!futureContext.players[0].evidence.some(e=>(e.value as {nativeContextRelease?:string}).nativeContextRelease===PROPS_AI_NBA_CURRENT_SOURCE_RELEASE));
const wrongContext=liveNbaPacket({...args,snapshot:{...contextSnapshot,decisions:[{...contextSnapshot.decisions[0],team:'NYK',opponent:'BOS'}]},currentObservations:narrow});assert(!wrongContext.players[0].evidence.some(e=>(e.value as {nativeContextRelease?:string}).nativeContextRelease===PROPS_AI_NBA_CURRENT_SOURCE_RELEASE));assert(wrongContext.players[0].missing.some(s=>s.includes('noncurrent native context identity mismatch')));
assert.equal(digest(contextSnapshot),contextBefore);
console.log('NBA current identity passed: eight old orphan retail records do not block all current actors/scopes/quotes; explicit current unknowns remain fail-closed, opening/live/future/wrong-game/unsupported isolation, explicit-empty versus missing, honest source limitations and immutable raw history. Synthetic only; no network.');
