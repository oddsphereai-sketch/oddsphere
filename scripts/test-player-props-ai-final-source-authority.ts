/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated route VM uses synthetic lease and failure transports. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {propsAiFinalSourceHolds} from '../lib/playerPropsAi/runtimeHealth';
globalThis.fetch=async()=>{throw Error('Final-source authority proof forbids real transport');};
const games=['nba-bdl:1','nfl:game:1','mlb:game:2'];
assert.deepEqual(propsAiFinalSourceHolds(undefined,games),[]);
assert.deepEqual(propsAiFinalSourceHolds({findings:games.map(id=>`current_source_unavailable:${id}:unclassified`)},games),games);
assert.deepEqual(propsAiFinalSourceHolds({findings:['current_source_unavailable:nba-bdl:10:unclassified']},games),[]);
assert.deepEqual(propsAiFinalSourceHolds({findings:games.flatMap(id=>[`lock_source_unavailable:${id}:unclassified`,`current_source_reload_unavailable_after_ready_lock:${id}:unclassified`])},games),[]);
assert.deepEqual(propsAiFinalSourceHolds({findings:['current_source_unavailable:nba-bdl:1:unclassified']},['nba-bdl:1','nba-bdl:1']),['nba-bdl:1']);
const code=ts.transpileModule(readFileSync('app/api/cron/mlb-player-props-refresh/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function main(){
 for(const name of ['MlbPropsPublicationUncertainError','MlbPropsReviewAuthorityUnavailableError']){
  let writes=0,reads=0,leased=false;const error=Object.assign(new Error('Synthetic bounded authority unavailable'),{name});
  const modules:any={runCron:{cronHandler:async(_r:any,_n:any,run:any,options:any)=>{assert.equal(options.sport,'mlb');assert.equal(options.leaseGroup,'prediction_pipeline');assert.equal(options.requireLease,true);leased=true;try{return await run({runId:'synthetic-owner'});}finally{leased=false;}}},playerPropsRefreshTelemetry:{},
   liveBoard:{easternSlateDate:()=> '2030-06-01',refreshMlbPropsBoard:async()=>{assert(leased);throw error;}},
   boardSnapshotStore:{loadLatestMlbPropsBoardSnapshot:async()=>{reads++;throw Error('Unknown authority forbids fallback');}},
   internalTracking:{syncInternalMlbPropsTracking:async()=>{writes++;}},memberReadSnapshotStore:{publishMlbPropsMemberReadSnapshots:async()=>{writes++;}}};
  const instance={exports:{}};vm.runInNewContext(code,{module:instance,exports:instance.exports,require:(path:string)=>{const key=path.split('/').at(-1)!;assert(Object.hasOwn(modules,key));return modules[key];},Date,URL,Error,process:{env:{MLB_PLAYER_PROPS_CRON_ENABLED:'true'}}});
  const result=await(instance.exports as any).GET(new Request('https://offline.invalid/api/cron/mlb-player-props-refresh'));
  assert.equal(result.partial,true);assert.equal(writes+reads,0);assert.equal(result.details.lockFallbackAttempted,false);assert.equal(result.records_updated,undefined);assert(!leased);
  if(name==='MlbPropsReviewAuthorityUnavailableError'){assert.equal(result.details.reviewAuthorityUnavailable,true);assert.equal(result.details.publicationAuthorityUncertain,false);assert.equal(result.details.publicationCommit,'not_inferred_from_review_lookup');}
  else{assert.equal(result.details.publicationAuthorityUncertain,true);assert.equal(result.details.publicationCommit,'unknown');}
 }
 console.log(JSON.stringify({finalSourceHolds:true,exactGameIdentity:true,initialRecoveredAndPostlockReadyNotFalselyHeld:true,actualRouteReadVsWriteTruth:true,noFallbackOrTransport: true}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
