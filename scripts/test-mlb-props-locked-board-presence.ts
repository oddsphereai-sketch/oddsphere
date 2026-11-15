/* eslint-disable @typescript-eslint/no-explicit-any -- Actual private reader VM uses synthetic lock inventories, no transport. */
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const source=readFileSync('lib/mlb/props/memberReadSnapshotStore.ts','utf8');
assert(source.includes('memberRowsHonorCurrentLocks(date, manifest.data.props, true)'));
assert(source.includes('memberRowsHonorCurrentLocks(date, assembled.data.props, true)'));
let unavailable=false;const locks=new Map([['game-B','2030-06-01T20:00:00Z']]);
const modules:any={boardSnapshotStore:{loadMlbPropsLockedGameTimes:async()=>{if(unavailable)throw Error('synthetic unavailable');return locks;}},'supabase-js':{createClient:()=>({})}};
const instance={exports:{}};vm.runInNewContext(ts.transpileModule(source+'\nexport {memberRowsHonorCurrentLocks,assertLockedGamesUseAuthoritativeRows};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:instance,exports:instance.exports,require:(name:string)=>modules[name.split('/').at(-1)!]??{},process:{env:{}},Date,Map,Set,Buffer,console});
const api=instance.exports as any,a={providerIds:{gameId:'game-A'},lockStatus:{status:'locked'},projection:3},b={providerIds:{gameId:'game-B'},lockStatus:{status:'locked'},projection:8},before=JSON.stringify([a,b]);
async function main(){
 assert.equal(await api.memberRowsHonorCurrentLocks('2030-06-01',[],true),false);
 assert.equal(await api.memberRowsHonorCurrentLocks('2030-06-01',[a],true),false,'A whole board missing an entire newly locked game must return to original display authority');
 assert.equal(await api.memberRowsHonorCurrentLocks('2030-06-01',[a,b],true),true);
 assert.equal(await api.memberRowsHonorCurrentLocks('2030-06-01',[{...b,lockStatus:{status:'unlocked'}}],true),false);
 assert.equal(await api.memberRowsHonorCurrentLocks('2030-06-01',[a]),true,'A scoped player read does not require unrelated games');
 assert.equal(await api.memberRowsHonorCurrentLocks('2030-06-01',[]),true,'Research-only shards remain allowed');
 assert.throws(()=>api.assertLockedGamesUseAuthoritativeRows([a],locks));
 api.assertLockedGamesUseAuthoritativeRows([a,b],locks);assert.equal(JSON.stringify([a,b]),before);
 unavailable=true;await assert.rejects(()=>api.memberRowsHonorCurrentLocks('2030-06-01',[a,b],true));
 console.log(JSON.stringify({lockedBoardPresence:true,cases:9,originalFieldsUnchanged:true,noMissingLockedGameFastPath:true,scopedResearchUnchanged:true,networkCalls:0}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
