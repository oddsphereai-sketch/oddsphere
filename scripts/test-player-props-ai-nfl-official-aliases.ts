/** Exact independently ID-bound official names. No network or paid request. */
import assert from 'node:assert/strict';
import {resolveNflPropSourcePlayer,sameNflPropActorName,PROPS_AI_NFL_ALIAS_RELEASE} from '../lib/playerPropsAi/nflPlayerIdentity';
import {liveNflPacket} from '../lib/playerPropsAi/liveSources';
import {digest,validatePacket} from '../lib/playerPropsAi/evidence';
import {PROPS_AI_RELEASE,propsReviewHasMemberExecutionContracts} from '../lib/playerPropsAi/releases';
globalThis.fetch=async()=>{throw Error('Official alias proof denies real network');};
type Args=Parameters<typeof resolveNflPropSourcePlayer>[0];
const at='2030-11-17T15:00:00Z',start='2030-11-17T21:00:00Z',lock='2030-11-17T20:00:00Z';
const cases=[{id:'33934589',canonical:'Matt Hibner',alias:'Matthew Hibner',team:'BAL',position:'TE',market:'receiving_yards'}, {id:'13873931',canonical:'Cam Ward',alias:'Cameron Ward',team:'TEN',position:'QB',market:'passing_yards'}, {id:'697',canonical:'Bam Knight',alias:'Zonovan Knight',team:'ARI',position:'RB',market:'rushing_yards'}] as const;
let controls=0;
for(const c of cases){
 const game={id:`synthetic-${c.team}`,home:c.team,away:'CHI',start};
 const quote:Args['row']={providerObservationId:'synthetic-offer',providerEventId:'synthetic-event',providerMarket:c.market,offerType:'over_under',homeTeam:c.team,awayTeam:'CHI',canonicalGameId:game.id,scheduledStart:start,providerPlayerId:null,playerName:c.alias,playerTeam:null,provider:'owls',market:c.market,line:20.5,side:'over',sportsbook:'synthetic',americanPrice:-110,isOpening:false,isLive:false,observedAt:at,receivedAt:at,fetchedAt:at};
 const native:Args['row']={...quote,provider:'balldontlie',providerPlayerId:c.id,playerName:c.canonical,playerTeam:c.team};
 const context={capturedAt:at,games:[{canonicalGameId:game.id,scheduledStart:start,homeTeam:c.team,awayTeam:'CHI',homeDepth:{team:c.team,capturedAt:at,roster:[{playerId:c.id,name:c.canonical,position:c.position}]},awayDepth:{team:'CHI',capturedAt:at,roster:[]},injuries:{players:[]},weather:null}]} as unknown as Args['context'];
 const stored={gameId:game.id,scheduledStart:start,providerPlayerId:c.id,playerName:c.canonical,team:c.team,opponent:'CHI',lockAt:lock,state:'unlocked',grade:'Held',healthHolds:['historical_identity_unmatched'],market:c.market,observedAt:at,forecastContext:{featureAsOf:at}} as unknown as Args['rows'][number];
 const args={row:quote,rows:[stored],observations:[native],context,game,cutoff:at,observationsAvailableAt:at,storedAvailableAt:at},before=digest(args);
 assert(sameNflPropActorName(c.canonical,c.alias,c.id));assert(sameNflPropActorName(c.alias,c.canonical,c.id));assert(!sameNflPropActorName(c.canonical,c.alias));assert(!sameNflPropActorName(c.canonical,c.alias,'wrong'));
 assert.equal(resolveNflPropSourcePlayer(args)?.providerId,c.id);assert.equal(resolveNflPropSourcePlayer(args)?.team,c.team);assert.equal(resolveNflPropSourcePlayer(args)?.name,c.alias);
 assert.equal(resolveNflPropSourcePlayer({...args,rows:[],observations:[],context:{...context,games:[]}}),null,'A name pair cannot invent a captured ID/team');
 assert.equal(resolveNflPropSourcePlayer({...args,row:{...quote,providerPlayerId:c.id}}),null,'An Owls ID cannot enter the BDL namespace');
 assert.equal(resolveNflPropSourcePlayer({...args,row:{...quote,canonicalGameId:'other-game'}}),null);
 assert.equal(resolveNflPropSourcePlayer({...args,row:{...quote,scheduledStart:'2030-11-17T22:00:00Z'}}),null);
 assert.equal(resolveNflPropSourcePlayer({...args,observationsAvailableAt:'2030-11-17T15:00:01Z'}),null);
 assert.throws(()=>resolveNflPropSourcePlayer({...args,row:{...quote,playerTeam:'CHI'}}),/team/);
 assert.throws(()=>resolveNflPropSourcePlayer({...args,context:{...context,games:[{...context.games[0],homeDepth:{...context.games[0].homeDepth,roster:[{playerId:c.id,name:'Unrelated Person'}]}}]}} as unknown as Args),/name/);
 const packet=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot:{week:10,generatedAt:at,board:{decisions:[stored]},memberDecisions:[]} as never,observations:{generatedAt:at,observations:[native,quote]} as never,history:{updatedAt:at,games:[],stats:[],teamStats:[],playMetrics:[],release:'synthetic'} as never,context});
 validatePacket(packet);assert.equal(packet.sourceAliasRelease,PROPS_AI_NFL_ALIAS_RELEASE);assert.equal(packet.players.length,1);assert.equal(packet.players[0].id,`nfl-bdl-player:${c.id}`);assert.equal(packet.quotes.length,2);assert(!packet.players[0].evidence.some(e=>e.kind==='independent_model'),'Missing numeric priors stay missing');
 assert.equal(digest(args),before);controls+=20;
}
assert(!sameNflPropActorName('Matt Other','Matthew Other','33934589'));assert(!sameNflPropActorName('Matt Hibner','Matthew Hibner','33934590'));controls+=2;
assert(!sameNflPropActorName('Benjamin Synthetic','Ben Synthetic','synthetic-unverified'),'Unproved name equivalence remains held');assert(!sameNflPropActorName('Cameron Other','Cam Ward','13873931'));assert(!sameNflPropActorName('Zonovan Other','Bam Knight','697'));controls+=3;
assert.equal(PROPS_AI_NFL_ALIAS_RELEASE,'player_props_ai_nfl_alias_catalog_2026_11_16_r2_hibner_official_names');assert(propsReviewHasMemberExecutionContracts('player_props_ai_2026_11_16_r43_numeric_source_continuation'));controls+=2;
assert.equal(PROPS_AI_RELEASE,'player_props_ai_2026_11_18_r52_joint_dependence_navigation');assert(propsReviewHasMemberExecutionContracts('player_props_ai_2026_11_15_r40_complete_correction_feedback'));controls+=2;
console.log(JSON.stringify({officialAliases:true,controls,threeProspectiveExactIdBoundPairs:true,unknownAliasRemainsHeld:true,currentSourcePacketVersioned:true,originalSourceAndGuardsUnchanged:true,noNetworkOrPaidCalls:true}));
