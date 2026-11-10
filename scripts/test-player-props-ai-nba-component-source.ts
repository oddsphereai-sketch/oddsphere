/** Source-to-generative-unit navigation. No forecast fit, network or paid calls. */
import assert from 'node:assert/strict';
import {readerLogWindows} from '../lib/playerPropsAi/readerLogs';
import {sourceConstraintCards} from '../lib/playerPropsAi/sourceConstraintCards';
import {PRODUCT_RELEASE,type Evidence,type GamePacket,type Json} from '../lib/playerPropsAi/evidenceContract';
import {digest} from '../lib/playerPropsAi/evidence';
globalThis.fetch=async()=>{throw Error('Offline source test forbids network');};
const at='2026-11-10T18:00:00Z';
function log(id:string,day:number,box:Record<string,Json>):Evidence{return{id,kind:'recent_games',source:'synthetic',availableAt:at,value:{game:{startTime:`2026-11-${String(day).padStart(2,'0')}T01:00:00Z`,homeTeam:'BOS',awayTeam:'NYK'},box}};}
const logs=[log('a',9,{points:20,fg3m:2,minutes:30}),log('b',8,{points:9,fg3m:3,minutes:30}),log('c',7,{points:30,minutes:30}),log('d',6,{fg3m:4,minutes:30}),log('dnp',5,{points:0,fg3m:0,minutes:0})];
const before=digest(logs),s=readerLogWindows('nba',logs,at),component=s.observedSupport.points_excluding_made_threes!;
assert.deepEqual(component,{n:2,minimum:0,maximum:14,mean:7});assert.equal(s.observedSupport.points.mean,59/3);assert.equal(s.observedSupport.threes.mean,3);
assert.notEqual(component.mean,s.observedSupport.points.mean-3*s.observedSupport.threes.mean,'Different sample denominators cannot be subtracted');
const alias=readerLogWindows('nba',[...logs,{...logs[0],id:'provider-alias'}],at);assert.deepEqual(alias.observedSupport,s.observedSupport,'Same-game aliases are one source observation');
for(const box of [{points:21,fg3m:2,minutes:30},{points:20,fg3m:1,minutes:30}]){
  const conflicted=readerLogWindows('nba',[...logs,log('conflict',9,box)],at);
  assert.deepEqual(conflicted.observedSupport.points_excluding_made_threes,{n:1,minimum:0,maximum:0,mean:0},'Conflicting canonical fields cannot produce a valid component');
  assert(conflicted.conflicts.length>0);
}
for(const box of [{points:2,fg3m:2,minutes:30},{points:5.5,fg3m:1,minutes:30},{points:5,fg3m:-1,minutes:30}])assert.equal(readerLogWindows('nba',[log('invalid',9,box)],at).observedSupport.points_excluding_made_threes,undefined,'Impossible/fractional source components remain unavailable, never repaired');
const packet:GamePacket={release:PRODUCT_RELEASE,sport:'nba',gameId:'synthetic',start:'2026-11-10T23:00:00Z',lock:'2026-11-10T22:00:00Z',cutoff:at,stage:'early',sourceLimitations:[],quotes:[],players:[{id:'p',name:'Synthetic',team:'BOS',opponent:'NYK',markets:['points','threes'],missing:[],evidence:logs}]};
const c=sourceConstraintCards(packet)[0];assert.equal(c.generativeComponentSupport?.mean,7);assert.equal(c.generativeComponentSupport?.playedGames,2);assert.equal(c.statistics.points?.mean,59/3);assert(c.generativeComponentSupport?.sourceFact);assert.deepEqual(c.independentEvents,[],'A component source does not invent an independent prior');
for(const sport of ['nfl','mlb'] as const)assert.equal(readerLogWindows(sport,logs,at).observedSupport.points_excluding_made_threes,undefined);
assert.equal(digest(logs),before,'Raw source remains exact');
console.log('NBA component-source proof passed: same-game non-three units, unequal denominators, genuine zero, alias deduplication, source conflict/impossibility/DNP refusal, exact canonical support and no inferred independent prior. No I/O.');
