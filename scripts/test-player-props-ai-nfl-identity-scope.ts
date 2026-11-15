/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic malformed and captured-immutable source controls. */
import assert from 'node:assert/strict';
import {createNflPacketActorResolver,resolveNflPropSourcePlayer} from '../lib/playerPropsAi/nflPlayerIdentity';
import {digest} from '../lib/playerPropsAi/evidence';
globalThis.fetch=async()=>{throw Error('NETWORK BLOCKED');};
const at='2026-11-15T10:00:00Z',cutoff='2026-11-15T11:00:00Z',start='2026-11-15T14:30:00Z';
const people=Array.from({length:24},(_,i)=>({playerId:String(1000+i),name:`Player ${String.fromCharCode(65+i)} Test`,position:i?'WR':'QB'}));
const game={id:'captured-game',start,away:'NE',home:'DET'};
let reads=0;
const observations:any[]=people.flatMap(p=>Array.from({length:8},(_,i)=>({canonicalGameId:game.id,scheduledStart:start,provider:'balldontlie',providerPlayerId:p.playerId,playerName:p.name,playerTeam:'NE',isLive:false,isOpening:false,receivedAt:at,observedAt:at,fetchedAt:at,market:i%2?'receptions':'receiving_yards'})));
const instrument=()=>observations.map(row=>new Proxy(row,{get(target,key,receiver){if(key==='provider')reads++;return Reflect.get(target,key,receiver);}}));
const source=(quotes:any[]=observations):any=>({game,cutoff,observationsAvailableAt:at,storedAvailableAt:at,observations:quotes,rows:people.map(p=>({gameId:game.id,scheduledStart:start,providerPlayerId:p.playerId,playerName:p.name,team:'NE',observedAt:at,forecastContext:{featureAsOf:at}})),context:{capturedAt:at,games:[{canonicalGameId:game.id,scheduledStart:start,awayTeam:'NE',homeTeam:'DET',awayDepth:{capturedAt:at,team:'NE',roster:structuredClone(people)},homeDepth:{capturedAt:at,team:'DET',roster:[]}}]}});
const targets=instrument(),args=source(targets),resolve=createNflPacketActorResolver(args),before=digest(JSON.parse(JSON.stringify(args)));
reads=0;const shared=targets.map(row=>resolve(row)),sharedReads=reads;
reads=0;const fresh=targets.map(row=>resolveNflPropSourcePlayer({...args,row})),freshReads=reads;
assert.deepEqual(shared,fresh);assert(shared.every(Boolean));assert.equal(shared[0]!.name,people[0].name);assert.equal(shared[0]!.rosterPosition,'QB');
assert(sharedReads<freshReads/10,'Full original observation facts should be scanned once per packet, not once per quote');
assert.equal(digest(JSON.parse(JSON.stringify(args))),before);
for(const change of [(r:any)=>r.isLive=true,(r:any)=>r.receivedAt='2026-11-15T12:00:00Z',(r:any)=>r.fetchedAt='2026-11-15T12:00:00Z',(r:any)=>r.scheduledStart='2026-11-16T14:30:00Z',(r:any)=>r.provider='owls']){const row=structuredClone(observations[0]);change(row);assert.equal(resolve(row),null);}
const conflict=structuredClone(observations[0]);conflict.playerTeam='DET';assert.throws(()=>resolve(conflict),/player-team/);assert.deepEqual(resolve(observations[0]),shared[0],'A rejected target cannot poison the captured scope');
// Even after warming the name/ID cache, direct target IDs/names/teams remain checked.
const idConflict={...observations[0],providerPlayerId:'different'};assert.throws(()=>resolve(idConflict),/provider player identity/);
const aliasSource=source();aliasSource.observations=[];aliasSource.rows=[];aliasSource.context.games[0].awayDepth.roster=[{playerId:'666',name:'Marquise Brown',position:'WR'}];
const alias=createNflPacketActorResolver(aliasSource),q={...observations[0],providerPlayerId:'666',playerName:'Hollywood Brown'};
for(const name of ['Hollywood Brown','HOLLYWOOD BROWN','Hollywood Brown Jr.'])assert.equal(alias({...q,playerName:name})!.name,name);
assert.equal(alias({...q,playerName:'Marquise Brown'})!.providerId,'666');
const unrelatedPosition=source();unrelatedPosition.context.games[0].awayDepth.roster.push({playerId:'other',name:'Unrelated Person',position:123});assert(createNflPacketActorResolver(unrelatedPosition)(observations[0]),'Unrelated malformed position was never visited by the original selected-ID resolver');
const badPosition=source();badPosition.context.games[0].awayDepth.roster[0].position=123;const bad=createNflPacketActorResolver(badPosition);assert.throws(()=>bad(observations[0]));
const badContext=source();badContext.context.games[0].homeTeam='GB';const lazy=createNflPacketActorResolver(badContext);assert.equal(lazy({...observations[0],isLive:true}),null);assert.equal(lazy({...observations[0],provider:'owls'}),null);assert.throws(()=>lazy(observations[0]),/roster game/);
// A new actual source/cutoff always creates a new scope; no module/request cache.
const changed=source();changed.context.games[0].awayDepth.roster[0].name='Conflicting Name';assert.throws(()=>createNflPacketActorResolver(changed)(observations[0]),/provider player identity|player-name/);assert.deepEqual(resolve(observations[0]),shared[0]);
const future=source();future.cutoff='2026-11-15T09:00:00Z';assert.equal(createNflPacketActorResolver(future)(observations[0]),null);
console.log(JSON.stringify({passed:true,packetTargets:targets.length,sharedProviderReads:sharedReads,freshProviderReads:freshReads,exactResults:true,completeFactsAndConflictsRetained:true,clockAndNamespaceGuards:true,lazyUnrelatedErrorOrder:true,idBoundAliasesAndOriginalLabels:true,freshScopeIsolation:true,sourceUnchanged:true,noNetwork:true}));
