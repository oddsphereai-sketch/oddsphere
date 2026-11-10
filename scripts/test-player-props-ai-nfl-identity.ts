import assert from 'node:assert/strict';
import {resolveNflPropSourcePlayer,sameNflPropActorName,PROPS_AI_NFL_SOURCE_RELEASE,PROPS_AI_NFL_IDENTITY_RELEASE} from '../lib/playerPropsAi/nflPlayerIdentity';
import {liveNflPacket} from '../lib/playerPropsAi/liveSources';
import {enrichCachedPacket} from '../lib/playerPropsAi/cachedEnrichment';
globalThis.fetch=async()=>{throw Error('Offline NFL source proof forbids network');};
type IdentityArgs=Parameters<typeof resolveNflPropSourcePlayer>[0];
type LiveArgs=Parameters<typeof liveNflPacket>[0];
const at='2026-11-08T17:00:00Z',start='2026-11-08T21:00:00Z',lock='2026-11-08T20:00:00Z';
const game={id:'synthetic',start,away:'TB',home:'CHI'};
const quote={providerObservationId:'secondary',canonicalGameId:game.id,scheduledStart:start,providerPlayerId:null,playerName:'Kenneth Gainwell',playerTeam:null,provider:'owls',market:'receptions',line:2.5,side:'over',sportsbook:'synthetic',americanPrice:-110,observedAt:at,receivedAt:at,fetchedAt:at,isOpening:false,isLive:false} as IdentityArgs['row'];
const native={...quote,provider:'balldontlie',providerObservationId:'primary',playerName:'Kenny Gainwell',providerPlayerId:'12',playerTeam:'TB'} as IdentityArgs['row'];
const stored={gameId:game.id,scheduledStart:start,lockAt:lock,providerPlayerId:'12',playerName:'Kenny Gainwell',team:'TB',opponent:'CHI',observedAt:at,forecastContext:{featureAsOf:at},state:'unlocked',grade:'Held',healthHolds:['historical_identity_unmatched']} as unknown as IdentityArgs['rows'][number];
const context={capturedAt:at,games:[{canonicalGameId:game.id,scheduledStart:start,awayTeam:'TB',homeTeam:'CHI',awayDepth:{team:'TB',capturedAt:at,roster:[{playerId:'12',name:'Kenny Gainwell'}]},homeDepth:{team:'CHI',capturedAt:at,roster:[]},injuries:{players:[]},weather:null}]} as unknown as IdentityArgs['context'];
const args={row:quote,rows:[stored],observations:[native],context,game,cutoff:at,observationsAvailableAt:at,storedAvailableAt:at};
assert.equal(resolveNflPropSourcePlayer(args)?.providerId,'12');
assert.equal(resolveNflPropSourcePlayer({...args,rows:[],observations:[]})?.providerId,'12','a unique exact roster ID is sufficient without a numerical-model row');
assert.equal(resolveNflPropSourcePlayer({...args,rows:[],context:{...context,games:[{...context.games[0],awayDepth:{team:'TB',capturedAt:at,roster:[]}}]} as never})?.providerId,'12','a current primary-provider identity is sufficient without a model or roster row');
assert.equal(resolveNflPropSourcePlayer({...args,row:{...native,playerName:null}})?.name,'Kenny Gainwell','a supplied ID can recover its exact roster name');
assert.equal(resolveNflPropSourcePlayer({...args,row:{...quote,canonicalGameId:'wrong'}}),null);
assert.equal(resolveNflPropSourcePlayer({...args,row:{...quote,scheduledStart:'2026-11-09T21:00:00Z'}}),null);
assert.throws(()=>resolveNflPropSourcePlayer({...args,row:{...native,playerTeam:'CHI'}}),/player-team identity/);
assert.throws(()=>resolveNflPropSourcePlayer({...args,row:{...native,providerPlayerId:'999'}}),/provider player identity/);
assert.throws(()=>resolveNflPropSourcePlayer({...args,context:{...context,games:[{...context.games[0],scheduledStart:'2026-11-09T21:00:00Z'}]} as never}),/roster game identity/);
for(const [a,b,id] of [['Marquise Brown','Hollywood Brown','666'],['Kevin Concepcion','KC Concepcion Jr.','33934397'],['Kenneth Gainwell','Kenny Gainwell','12'],['Chigoziem Okonkwo','Chig Okonkwo','734']]){
 assert.equal(sameNflPropActorName(a,b,id),true);assert.equal(sameNflPropActorName(a,b,'wrong'),false);assert.equal(sameNflPropActorName(a,'Unrelated Player',id),false);
}
const snapshot={week:9,generatedAt:at,board:{decisions:[stored]},memberDecisions:[]} as unknown as LiveArgs['snapshot'];
const history={updatedAt:at,games:[],stats:[],teamStats:[],playMetrics:[],release:'synthetic'} as unknown as LiveArgs['history'];
const orphan={...quote,playerName:'Unresolved historical actor',isOpening:true};
const packet=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot,observations:{generatedAt:at,observations:[native,quote,orphan]} as never,history,context});
assert.equal(packet.sourceInputRelease,PROPS_AI_NFL_SOURCE_RELEASE);assert.equal(packet.sourceIdentityRelease,PROPS_AI_NFL_IDENTITY_RELEASE);assert.equal(packet.players.length,1);assert.equal(packet.players[0].id,'nfl-bdl-player:12');assert.equal(packet.quotes.length,2,'orphan history does not become a currently offered actor');
assert.throws(()=>liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot,observations:{generatedAt:at,observations:[native,quote,{...orphan,isOpening:false}]} as never,history,context}),/offered-player identity coverage incomplete/,'unresolved current actors still block completion');
// Regression from the ordinary producer: same actor represented by separate
// cached display groups must merge its evidence, not reject the whole game.
const priorHead={...stored,market:'receptions',line:2.5,side:'over',sportsbook:'synthetic',provider:'balldontlie',americanPrice:-110,observedAt:at,bookEvidence:[],participationProbability:.9,forecastContext:{featureAsOf:at},modelRelease:'synthetic'};
const aliasedSnapshot={...snapshot,memberDecisions:[priorHead,{...priorHead,playerName:'Kenny Gainwell Jr.'}]} as never;
const merged=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot:aliasedSnapshot,observations:{generatedAt:at,observations:[native,quote]} as never,history,context});
assert.equal(merged.players.length,1);assert.equal(merged.players[0].evidence.filter(e=>e.kind==='independent_model').length,1,'identical facts from suffix groups are deduplicated');
const pricedHead={...priorHead,decisionSupport:{projection:{independent:2.1},probability:{independentSelectedSide:.55},price:{currentPrice:-110}}};
const pricedSnapshot={...snapshot,memberDecisions:[pricedHead]} as never;
const pricedBefore=JSON.stringify(pricedSnapshot);
const withMovement=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot:pricedSnapshot,observations:{generatedAt:at,observations:[native,quote]} as never,history,context});
assert.ok(withMovement.players[0].evidence.some(e=>e.kind==='market'),'retained price movement remains supplied');
assert.ok(withMovement.players[0].evidence.some(e=>e.kind==='independent_model'));
assert.ok(!withMovement.players[0].missing.includes('independent model/context unavailable at this cutoff'),'additional market evidence cannot falsely mark the supplied model/context missing');
assert.equal(JSON.stringify(pricedSnapshot),pricedBefore,'source forecasts and movement stay exact');
const futureHead={...pricedHead,forecastContext:{featureAsOf:'2026-11-08T17:00:01Z'}};
const unavailable=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot:{...snapshot,memberDecisions:[futureHead]} as never,observations:{generatedAt:at,observations:[native,quote]} as never,history,context});
assert.ok(unavailable.players[0].missing.includes('independent model/context unavailable at this cutoff'),'genuinely future/unavailable model context remains missing');
assert.ok(!unavailable.players[0].evidence.some(e=>e.kind==='independent_model'),'future model context is not backdated');
const partialSnapshot={...snapshot,memberDecisions:[pricedHead,{...futureHead,market:'receiving_yards',line:20.5}]} as never;
const partial=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot:partialSnapshot,observations:{generatedAt:at,observations:[native,quote,{...native,market:'receiving_yards',line:20.5}]} as never,history,context});
assert.equal(partial.players[0].markets.length,2);
assert.equal(partial.players[0].evidence.filter(e=>e.kind==='independent_model').length,1);
assert.ok(partial.players[0].missing.includes('independent model/context unavailable at this cutoff'),'market evidence cannot hide a genuinely missing second model head');
const conflictingSnapshot={...snapshot,memberDecisions:[priorHead,{...priorHead,playerName:'Kenny Gainwell Jr.',providerPlayerId:'999'}],board:{decisions:[stored]}} as never;
assert.throws(()=>liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot:conflictingSnapshot,observations:{generatedAt:at,observations:[native,quote]} as never,history,context}),/Ambiguous NFL captured player/);
// Verified native ID joins historical stats despite a different display name.
const oldGame={gameId:'past',scheduledStart:'2026-11-01T18:00:00Z',homeTeam:'TB',awayTeam:'NO'};
const enriched=enrichCachedPacket(packet,{readOnly:true,generatedAt:at,nfl:[],nba:[],priorNba:{} as never,currentNba:{} as never,nflHistory:{...history,games:[oldGame],stats:[{gameId:'past',scheduledStart:oldGame.scheduledStart,playerId:'12',playerName:'Kenneth Gainwell',team:'TB'}]}} as never);
assert.ok(enriched.players[0].evidence.some(e=>e.kind==='recent_games'));

// The same primary ID may be carried by a partially enriched current row. It
// must join the complete current sibling before optional target-name matching.
const noRoster={...context,games:[{...context.games[0],awayDepth:{...context.games[0].awayDepth,roster:[]},homeDepth:{...context.games[0].homeDepth,roster:[]}}]};
const quoteOnlySnapshot={...snapshot,board:{decisions:[]},memberDecisions:[]};
const partialPrimary={...native,providerObservationId:'partial',playerName:null,playerTeam:null,market:'receiving_yards',line:20.5} as IdentityArgs['row'];
const capture=(observations:IdentityArgs['row'][],generatedAt=at)=>({generatedAt,observations}) as LiveArgs['observations'];
const live=(observations:IdentityArgs['row'][],extra:Partial<LiveArgs>={})=>liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot:quoteOnlySnapshot,observations:capture(observations),history,context:noRoster,...extra});
const identity=(row:IdentityArgs['row'],extra:Partial<IdentityArgs>={})=>resolveNflPropSourcePlayer({...args,row,rows:[],context:noRoster,...extra});
for(const observations of [[partialPrimary,native],[native,partialPrimary]]){
 const inputBefore=JSON.stringify(observations),joined=live(observations);
 assert.equal(joined.players.length,1);assert.equal(joined.players[0].id,'nfl-bdl-player:12');
 assert.deepEqual(joined.players[0].markets,['receiving_yards','receptions']);
 assert.equal(joined.players[0].evidence.filter(e=>e.kind==='independent_model').length,0,'A quote-only actor never fabricates a numerical head');
 assert.deepEqual(joined.quotes.map(q=>q.market).sort(),['receiving_yards','receptions']);
 assert.equal(JSON.stringify(observations),inputBefore,'Joining never mutates raw declarations or source clocks');
}
assert.equal(identity({...partialPrimary,playerName:'Kenny Gainwell'})?.providerId,'12');
assert.equal(identity({...partialPrimary,playerTeam:'TB'})?.providerId,'12');
assert.throws(()=>identity({...partialPrimary,playerName:'Unrelated Player'}),/player-name identity/);
assert.throws(()=>identity({...partialPrimary,playerTeam:'CHI'}),/player-team identity/);
assert.throws(()=>identity({...native,providerPlayerId:'999'}),/provider player identity/);
assert.equal(identity({...quote,providerPlayerId:'12'}),null,'A secondary namespace ID is never silently treated as a BDL ID');
assert.equal(identity({...quote,playerName:'Kenneth Gainwell'}, {observations:[{...native,providerPlayerId:'999'}]}),null,'Documented aliases are bound to their one exact ID');

for(const reverse of [false,true]){
 const roster=[{playerId:'12',name:'Kenny Gainwell'},{playerId:'12',name:'Other Person'}];if(reverse)roster.reverse();
 const conflicts={...context,games:[{...context.games[0],awayDepth:{...context.games[0].awayDepth,roster}}]} as IdentityArgs['context'];
 assert.throws(()=>identity(native,{context:conflicts}),/player-name identity/,'Conflicting same-ID roster labels cannot select array[0]');
 assert.throws(()=>live([native],{context:conflicts}),/player-name identity/);
}
const sameNameOtherId={...context,games:[{...context.games[0],awayDepth:{...context.games[0].awayDepth,roster:[{playerId:'999',name:'Kenny Gainwell'}]}}]} as IdentityArgs['context'];
assert.throws(()=>identity(native,{context:sameNameOtherId}),/provider player identity/);
const bothTeams={...context,games:[{...context.games[0],homeDepth:{...context.games[0].homeDepth,roster:[{playerId:'12',name:'Kenny Gainwell'}]}}]} as IdentityArgs['context'];
assert.throws(()=>identity(native,{context:bothTeams}),/player-team identity/);

const future='2026-11-08T17:00:01Z';
assert.equal(identity(partialPrimary,{observationsAvailableAt:future}),null,'Early quote receipts do not attest later player-name/team enrichment');
assert.throws(()=>live([partialPrimary,native],{observations:capture([partialPrimary,native],future)}),/identity coverage incomplete/);
assert.equal(live([partialPrimary,native]).players.length,1,'The real completed collector header restores same-ID coverage once available');
assert.equal(identity(native,{observationsAvailableAt:undefined as never}),null,'No source completion header may default to the review cutoff');
assert.equal(identity(native,{row:{...native,receivedAt:future}}),null);
assert.equal(identity(native,{row:{...native,fetchedAt:future}}),null);
assert.equal(identity(native,{row:{...native,observedAt:future}}),null);
assert.equal(identity(partialPrimary,{observations:[{...native,receivedAt:future,observedAt:future,fetchedAt:future}]}),null);
assert.equal(identity(partialPrimary,{observations:[{...native,isOpening:true}]}),null,'An opening cannot establish a new current identity');
assert.equal(identity(partialPrimary,{observations:[{...native,isLive:true}]}),null);
assert.equal(identity(native,{context:{...context,capturedAt:future}}),null);
assert.equal(identity(native,{context:{...context,games:[]}}),null,'Missing exact-game context is a distinct current source block');
assert.equal(identity(native,{context:{...context,games:[context.games[0],context.games[0]]}}),null);
const futureDepth={...context,games:[{...context.games[0],awayDepth:{...context.games[0].awayDepth,capturedAt:future}}]} as IdentityArgs['context'];
assert.equal(identity(quote,{observations:[],context:futureDepth}),null,'Future-only roster identity cannot resolve a name-only offer');
assert.equal(identity(quote,{observations:[]}),null,'No native head or roster is inferred when it was not passed');
assert.equal(resolveNflPropSourcePlayer({...args,observations:[],rows:[],row:quote})?.providerId,'12','Genuine contemporaneous roster recovers a name-only offer');
assert.equal(resolveNflPropSourcePlayer({...args,context:noRoster,observations:[],rows:[stored]})?.providerId,'12','Explicit original snapshot availability can establish stored identity');
assert.equal(resolveNflPropSourcePlayer({...args,context:noRoster,observations:[],rows:[stored],storedAvailableAt:undefined}),null);
assert.equal(resolveNflPropSourcePlayer({...args,context:noRoster,observations:[],rows:[stored],storedAvailableAt:future}),null);
assert.equal(resolveNflPropSourcePlayer({...args,context:noRoster,observations:[],rows:[{...stored,observedAt:future}]}),null);
assert.equal(resolveNflPropSourcePlayer({...args,context:noRoster,observations:[],rows:[{...stored,forecastContext:{...stored.forecastContext,featureAsOf:future}}]}),null);

// Original native snapshot availability must not be rewritten to cutoff during
// source construction. A future header excludes priors even with older features.
const futureSnapshot={...pricedSnapshot,generatedAt:future};
const futureSnapshotBefore=JSON.stringify(futureSnapshot);
const headerUnavailable=live([native,quote],{snapshot:futureSnapshot,context});
assert.equal(headerUnavailable.players[0].evidence.filter(e=>e.kind==='independent_model').length,0);
assert(headerUnavailable.players[0].missing.includes('independent model/context unavailable at this cutoff'));
const headerAvailable=live([native,quote],{snapshot:pricedSnapshot,context});
assert.equal(headerAvailable.players[0].evidence.filter(e=>e.kind==='independent_model').length,1);
assert.equal(JSON.stringify(futureSnapshot),futureSnapshotBefore,'A legacy/native snapshot header and all stored payloads stay exact');

// Source event role evidence must come from the same admissible roster used by
// identity resolution. A future defensive role cannot downgrade a current BDL
// passing declaration; a genuinely available role still exposes the conflict.
const interception={...native,market:'interceptions',providerMarket:'interceptions'} as IdentityArgs['row'];
const futureDefense={...context,games:[{...context.games[0],awayDepth:{...context.games[0].awayDepth,capturedAt:future,roster:[{playerId:'12',name:'Kenny Gainwell',position:'CB'}]}}]} as IdentityArgs['context'];
const actualDefense={...futureDefense,games:[{...futureDefense.games[0],awayDepth:{...futureDefense.games[0].awayDepth,capturedAt:at}}]};
const deferred=live([interception],{context:futureDefense});
const conflict=live([interception],{context:actualDefense});
assert.equal(deferred.quotes[0].sourceEvent?.rosterPosition,null);assert.equal(deferred.quotes[0].sourceEvent?.status,'verified');
assert.equal(conflict.quotes[0].sourceEvent?.rosterPosition,'CB');assert.equal(conflict.quotes[0].sourceEvent?.status,'unresolved');
assert.equal(deferred.sourceInputRelease,PROPS_AI_NFL_SOURCE_RELEASE,'Identity chronology does not change event-source release routing');
assert.equal(deferred.sourceIdentityRelease,PROPS_AI_NFL_IDENTITY_RELEASE);
console.log('Verified NFL actor proof passed: exact ID-first current sibling joins, no fabricated heads, aliases/conflicts/namespace, genuine collector-enrichment/roster/stored clocks, unchanged native headers, offered scope preservation, event-role chronology, and immutable original inputs. No network calls.');
