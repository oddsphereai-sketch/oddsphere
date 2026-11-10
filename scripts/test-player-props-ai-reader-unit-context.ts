/** Only the exact prospective derived benchmark-unit annotation is neutral.
 * No source/evidence, accepted text or stored outcome law is rewritten. */
import assert from 'node:assert/strict';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {NBA_READER_UNIT_CONTRACT} from '../lib/playerPropsAi/readerUnitContract';
import {PRODUCT_RELEASE,type GamePacket,type Player,type Json} from '../lib/playerPropsAi/evidenceContract';
import {digest} from '../lib/playerPropsAi/evidence';
globalThis.fetch=async()=>{throw Error('Reader unit context proof forbids network');};
const at='2026-11-10T17:00:00Z';
const object=(value:Json):Record<string,Json>=>{assert(value!==null&&typeof value==='object'&&!Array.isArray(value));return value;};
const original:GamePacket={release:PRODUCT_RELEASE,sport:'nba',gameId:'synthetic',start:'2026-11-11T01:00:00Z',lock:'2026-11-11T00:00:00Z',cutoff:at,stage:'early',sourceLimitations:[],quotes:[],players:Array.from({length:14},(_,i):Player=>({id:`synthetic:${i}`,name:`Synthetic ${i}`,team:'PHI',opponent:'BOS',markets:['points'],missing:[],evidence:[{id:`benchmark:${i}`,kind:'matchup',source:'synthetic observed source benchmark',availableAt:at,value:{readerBenchmarks:true,reference:{league_current_season_pace:101.8736,league_current_season_team_games:300,league_prior_season_pace:101.6933,league_prior_season_team_games:300}}},{id:`own:${i}`,kind:'availability',source:'synthetic own actor status',availableAt:at,value:{status:'unknown'}}]}))};
const frozen=digest(original),before=criticalContextHashes(original),future=structuredClone(original);
for(const player of future.players){const evidence=player.evidence[0];evidence.value={...(evidence.value as Record<string,Json>),readerUnitContract:NBA_READER_UNIT_CONTRACT};}
assert.deepEqual(criticalContextHashes(future),before,'An exact derived annotation must not invalidate any of the fourteen same-source reviews');assert.notEqual(digest(future),frozen,'Exact input evidence still records the metadata change');assert.equal(digest(original),frozen);
const mutate=(fn:(packet:GamePacket)=>void)=>{const changed=structuredClone(future);fn(changed);assert.notEqual(criticalContextHashes(changed)[changed.players[0].id],before[changed.players[0].id]);};
mutate(p=>{object(object(p.players[0].evidence[0].value).reference).league_current_season_pace=99;});
mutate(p=>{object(p.players[0].evidence[0].value).readerUnitContract={...NBA_READER_UNIT_CONTRACT,unit:'other_convention'};});
mutate(p=>{object(p.players[0].evidence[0].value).readerUnitContract={...NBA_READER_UNIT_CONTRACT,unknown:true};});
mutate(p=>{object(p.players[0].evidence[0].value).readerUnitContract={...NBA_READER_UNIT_CONTRACT,release:'unknown_release'};});
mutate(p=>{object(p.players[0].evidence[1].value).status='Out';});
// A lookalike property outside the exact NBA benchmark envelope is NOT neutral.
for(const mode of ['other_sport','other_kind','not_benchmark','nested','arbitrary_unit'] as const){
 const base=structuredClone(original),annotated=structuredClone(original);
 if(mode==='other_sport'){base.sport='nfl';annotated.sport='nfl';}
 if(mode==='other_kind'){base.players[0].evidence[0].kind='availability';annotated.players[0].evidence[0].kind='availability';}
 if(mode==='not_benchmark'){object(base.players[0].evidence[0].value).readerBenchmarks=false;object(annotated.players[0].evidence[0].value).readerBenchmarks=false;}
 const value=annotated.players[0].evidence[0].value as Record<string,Json>;
 if(mode==='nested')value.reference={...(value.reference as Record<string,Json>),readerUnitContract:NBA_READER_UNIT_CONTRACT};
 else if(mode==='arbitrary_unit')value.unit=NBA_READER_UNIT_CONTRACT.unit;
 else value.readerUnitContract=NBA_READER_UNIT_CONTRACT;
 assert.notEqual(criticalContextHashes(annotated)[annotated.players[0].id],criticalContextHashes(base)[base.players[0].id],mode);
}
assert.equal(digest(original),frozen,'Context projection cannot change original evidence bytes');
console.log('Reader unit-context neutrality passed: fourteen exact annotation-only contexts retain eligibility; full input changes remain archived, while benchmark values, unknown units/releases, own status and out-of-envelope metadata still invalidate. No I/O.');
