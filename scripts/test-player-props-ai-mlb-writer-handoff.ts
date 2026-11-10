/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic fluent Supabase rows and isolated actual-module VM boundaries intentionally exercise runtime admission, publication and retention. */
/** Actual MLB writer AI block, canonical publisher/retention/cutoff reader and
 * game-lock writer. All DB/provider I/O is an in-memory fixture. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import * as source from '../lib/playerPropsAi/liveSources';
import * as handoffs from '../lib/playerPropsAi/mlbPrelockHandoff';
import * as marketEvidence from '../lib/mlb/props/marketEvidenceCapture';
import * as ordering from '../lib/mlb/props/releaseOrdering';
import * as lockPolicy from '../lib/mlb/props/lockPolicy';
import * as settlement from '../lib/mlb/props/settlement';
import * as pricePolicy from '../lib/mlb/props/pricePolicy';
import * as versions from '../lib/mlb/props/marketModelVersions';
import {resolveMlbStatsTeamId} from '../lib/mlb/props/mlbTeamAliases';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {digest} from '../lib/playerPropsAi/evidence';
import {packet as originalPacket,review as originalReview,native as originalNative,snapshot as fixture,at,now} from './test-player-props-ai-mlb-event-settlement';
import type {MlbPropsBoardSnapshot} from '../lib/mlb/props/boardSnapshotStore';
import type {reviewPropsForSite} from '../lib/playerPropsAi/siteRuntime';

globalThis.fetch=async()=>{throw Error('MLB writer proof forbids real HTTP');};
async function main(){
 const envNames=['NODE_ENV','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'] as const;const originals=Object.fromEntries(envNames.map(n=>[n,process.env[n]]));Object.assign(process.env,{NODE_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1',SUPABASE_SERVICE_ROLE_KEY:'synthetic-never-real'});
 try{
 const live=await import('../lib/mlb/props/liveBoard');
 const lock=new Date(Date.parse(at)+240000).toISOString(),start=new Date(Date.parse(lock)+3600000).toISOString();
 const packet={...structuredClone(originalPacket),start,lock},native={...originalNative,gameStartTime:start};
 const review={...structuredClone(originalReview),start,lock,criticalContextHashes:criticalContextHashes(packet),inputHash:digest(packet),inputEvidence:{...originalReview.inputEvidence,digest:digest(packet)}};
 let tick=at,serial=0,readies=0,providerCalls=0;
 const env={NODE_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1',SUPABASE_SERVICE_ROLE_KEY:'synthetic-never-real',ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED:'true',ODDSPHERE_PROPS_SNAPSHOT_RETENTION_PER_SLATE:'2',ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED:'true',ODDSPHERE_PROPS_DISPLAY_ENABLED:'true'};
 const tables:Record<string,any[]>={prop_scoring_runs:[],admin_audit_log:[],mlb_prop_tracking_entries:[]};
 const contains=(row:any,value:any):boolean=>Object.entries(value).every(([k,v])=>v&&typeof v==='object'?contains(row?.[k],v):row?.[k]===v);
 const client={from(table:string){assert(Object.hasOwn(tables,table),`Unexpected fixture table ${table}`);const filters:((r:any)=>boolean)[]=[],orders:{key:string;ascending:boolean}[]=[];let limit=Infinity,offset=0,insert:any[]|null=null,deleting=false;
  const query:any={select(){return query;},eq(k:string,v:any){filters.push(r=>r[k]===v);return query;},lte(k:string,v:any){filters.push(r=>r[k]<=v);return query;},not(k:string,_op:string,v:any){filters.push(r=>r[k]!==v&&r[k]!==undefined);return query;},contains(k:string,v:any){filters.push(r=>contains(r[k],v));return query;},in(k:string,vs:any[]){filters.push(r=>vs.includes(r[k]));return query;},order(key:string,o:{ascending:boolean}){orders.push({key,ascending:o.ascending});return query;},limit(n:number){limit=n;return query;},range(from:number,to:number){offset=from;limit=to-from+1;return query;},insert(v:any){insert=Array.isArray(v)?v:[v];return query;},delete(){deleting=true;return query;},
   async execute(){if(insert){const added=insert.map(v=>({...structuredClone(v),id:String(++serial),created_at:tick}));tables[table].push(...added);return{data:added,error:null};}let rows=tables[table].filter(r=>filters.every(f=>f(r)));for(const {key,ascending} of [...orders].reverse())rows.sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(ascending?1:-1));rows=rows.slice(offset,offset+limit);if(deleting)tables[table]=tables[table].filter(r=>!rows.includes(r));return{data:structuredClone(rows),error:null};},
   async single(){const r=await query.execute();return{...r,data:r.data[0]??null};},async maybeSingle(){return query.single();},then(resolve:any,reject:any){return query.execute().then(resolve,reject);}};return query;}};
 class Clock extends Date{constructor(v?:string|number){super(v??tick);}static now(){return Date.parse(tick);}}
 function loadModule(file:string,modules:Record<string,unknown>){const instance={exports:{}};const javascript=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(javascript,{module:instance,exports:instance.exports,Date:Clock,Buffer,console,process:{env},require:(name:string)=>{const key=name.split('/').at(-1)!;assert(Object.hasOwn(modules,key),`Unmocked ${file} dependency ${name}`);return modules[key];}},{filename:file+'.offline.cjs'});return instance.exports as any;}
 const canonical=loadModule('lib/mlb/props/boardSnapshotStore.ts',{'node:crypto':crypto,'node:zlib':zlib,'supabase-js':{createClient:()=>client},marketEvidenceCapture:marketEvidence,releaseOrdering:ordering});
 const tracking=loadModule('lib/mlb/props/internalTracking.ts',{'node:crypto':crypto,'supabase-js':{createClient:()=>client},_mlbStatsApiClient:{},boardSnapshotStore:canonical,paperTrading:{isPaperTradingMarketAllowed:()=>true},pricePolicy,marketModelVersions:versions,lockPolicy,providerClients:{},settlement});
 const games:any[]=[{id:packet.gameId,scheduledStart:start,awayTeamId:'147',homeTeamId:'111'}];
 const nativeRows=[{...native,confidence:.6,marketFamily:'batter',reasonCodes:[],modelInputWarnings:[]}];
 const data=live.buildDashboardData({slateDate:'2030-06-01',asOfTimestamp:at,games,probablePitchers:[],props:nativeRows,sourceOdds:[],environmentErrors:[]});
 const snapshot:any={...fixture,schemaVersion:1,snapshotId:'initial-native',refreshMode:'fast',data,validation:{publishable:true,errors:[],warnings:[],actionableRows:0,sourceRows:1,mappedRows:1,staleOddsRows:0,researchRows:1},movement:{comparedWith:null,changedPrices:0,changedLines:0,addedRows:1,removedRows:0},modelContext:{modelReleaseId:versions.MLB_PROPS_MODEL_RELEASE_ID,trackingEventRelease:settlement.MLB_PROPS_LOCKED_EVENT_RELEASE,probablePitcherSeasonStats:[]}};
 type ReviewArgs=Parameters<typeof reviewPropsForSite>[0];
 const provider={getClient:()=>({getRequestCount:()=>{providerCalls++;return 0;}})};
 const modules:any={snapshot,args:{persist:true,writerRunId:'synthetic-lease-owner',slateDate:'2030-06-01'},asOfTimestamp:at,games,probablePitchers:[],expandedDecisionProps:nativeRows,boardSourceOdds:[],openingOdds:[],environment:{errors:[]},previous:null,mappedOdds:[{}],providerCoverage:undefined,playerGameIdentityConflictRows:0,probablePitcherResolution:{fallbackAssignments:[],findings:[]},oddsClient:provider,researchClient:provider,lineupResult:{balldontlieCalls:0},
  createPropsAiDbClient:()=>client,propsAiSiteConfig:()=>({integrated:true}),createMlbPrelockHandoff:(rows:any,publish:any)=>handoffs.testMlbPrelockHandoff(rows,publish,()=>tick),MLB_PROPS_AI_HANDOFF_RELEASE:handoffs.MLB_PROPS_AI_HANDOFF_RELEASE,
  Date:Clock,randomUUID:crypto.randomUUID,process:{env},buildDashboardData:live.buildDashboardData,compareMlbPropsBoardMovement:live.compareMlbPropsBoardMovement,resolveMlbStatsTeamId,
  validateMlbPropsBoardData:(args:any)=>{const validation=live.validateMlbPropsBoardData({...args,sourceRows:1});assert(validation.publishable,validation.errors.join('|'));return validation;},
  enforceSnapshotPayloadLimits:(s:MlbPropsBoardSnapshot)=>canonical.assertSnapshotSizeWithinLimits(canonical.measureMlbPropsBoardSnapshot(s)),
  publishMlbPropsBoardSnapshot:async(s:MlbPropsBoardSnapshot)=>{readies++;return canonical.publishMlbPropsBoardSnapshot(s);},ensureMlbPropsGameLocks:tracking.ensureMlbPropsGameLocks,
  liveMlbPacket:source.liveMlbPacket,envPositiveInteger:(_k:string,n:number)=>n,DEFAULT_MAX_BDL_CALLS_PER_REFRESH:300,
  reviewPropsForSite:async(args:ReviewArgs)=>{
   await args.onSourceReady?.(packet,null,at,true);assert.equal(tables.prop_scoring_runs.length,1);
   tick=now;await args.onReviewObserved?.(packet,review,true);await args.onReviewReady?.(packet,review);
   assert.equal(tables.prop_scoring_runs.length,2,'Observed/ready exact duplicates publish once');
   const ready=await canonical.loadMlbPropsBoardSnapshotAtOrBefore('2030-06-01',lock);assert(ready?.data.props[0].aiReview,'Actual cutoff loader sees paid final before waiting for another game');
   tick=new Date(Date.parse(lock)+1000).toISOString();await args.onReviewObserved?.(packet,review,true);
   return{status:'active',games:[{game:{id:packet.gameId,start,away:'NYY',home:'BOS'},packet,decisions:[],authorityReview:review,observedAt:tick}],findings:[]};
  },};
 // Execute the exact shipped integration block, with real publication and lock
 // code and real parser-produced values. Upstream providers remain outside it.
 const text=readFileSync('lib/mlb/props/liveBoard.ts','utf8'),ast=ts.createSourceFile('liveBoard.ts',text,ts.ScriptTarget.Latest,true);
 const refresh=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='refreshMlbPropsBoard') as ts.FunctionDeclaration;
 const block=refresh.body!.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).includes('propsAiSiteConfig().integrated'))!;
 assert(block,'Actual writer callback block missing');
 const js=ts.transpileModule(`(async()=>{${block.getText(ast)}})()`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 await vm.runInNewContext(js,modules,{filename:'actual-mlb-writer-ai-block.offline.cjs'});
 assert.equal(readies,2);assert.equal(providerCalls,0,'Callback publications perform no provider reads');assert(snapshot.data.props[0].aiReview,'Returned board retains timely AI values even when runtime returns an empty late decision list');
 assert.equal(snapshot.asOfTimestamp,tick,'Final snapshot availability is the actual later clock');
 const sourceAtLock=await canonical.loadMlbPropsBoardSnapshotAtOrBefore('2030-06-01',lock);assert(sourceAtLock);assert.equal(sourceAtLock.data.props[0].finalProbability,.75);assert.equal(Date.parse(sourceAtLock.asOfTimestamp),Date.parse(now));assert.notEqual(snapshot.snapshotId,sourceAtLock.snapshotId,'Later ordinary publication owns a new immutable identity');
 await canonical.publishMlbPropsBoardSnapshot(snapshot);assert.equal((await canonical.loadMlbPropsBoardSnapshotById('2030-06-01',sourceAtLock.snapshotId)).asOfTimestamp,sourceAtLock.asOfTimestamp,'Actual later publication cannot replace the ready snapshot through a reused ID');
 const result=await tracking.ensureMlbPropsGameLocks(snapshot,tick);assert.equal(result.created,1);const originalLock=digest((await canonical.loadMlbPropsGameLocks('2030-06-01'))[0]);assert.equal(result.locks[0].board_snapshot_id,sourceAtLock.snapshotId);
 const storedRow=digest(sourceAtLock.data.props[0]);
 for(let i=0;i<5;i++){tick=new Date(Date.parse(tick)+1000).toISOString();await tracking.ensureMlbPropsGameLocks(snapshot,tick);await canonical.publishMlbPropsBoardSnapshot({...snapshot,snapshotId:'later-'+i,asOfTimestamp:tick});}
 const retained=await canonical.loadMlbPropsBoardSnapshotById('2030-06-01',sourceAtLock.snapshotId);assert(retained);assert.equal(digest(retained.data.props[0]),storedRow,'Actual retention preserves the exact locked paid row');
 assert.equal(digest((await canonical.loadMlbPropsGameLocks('2030-06-01'))[0]),originalLock,'Existing lock pointer remains exact');
 const display=await canonical.applyMlbPropsDisplayLocks(snapshot);assert.equal(display.data.props[0].lockStatus?.status,'locked');assert.equal(display.data.props[0].finalProbability,.75);
 const count=tables.prop_scoring_runs.length;
 await assert.rejects(canonical.publishMlbPropsBoardSnapshot({...snapshot,snapshotId:'forged-older',asOfTimestamp:at}),/stale|timestamp|regress/i);
 await assert.rejects(canonical.publishMlbPropsBoardSnapshot({...snapshot,snapshotId:'forged-release',asOfTimestamp:tick,modelContext:{...snapshot.modelContext,modelReleaseId:'mlb_props_2026_10_20_r43'}}),/regress|older|release/i);
 assert.equal(tables.prop_scoring_runs.length,count,'Ordinary publication head guards still reject before writes');
 assert(tables.prop_scoring_runs.every(r=>r.display_enabled===true&&r.publish_enabled===true),'Existing visibility flags flow through the canonical publisher');
 console.log('Actual MLB writer handoff passed: shipped callback block→actual canonical publication/index/cutoff reader→actual game lock→actual prune/retained exact member lock; true clocks, ordinary visibility/head guards, duplicate callback collapse, late unrelated return and zero provider calls. All DB/HTTP mocked.');
 }finally{for(const n of envNames){if(originals[n]===undefined)Reflect.deleteProperty(process.env,n);else Object.assign(process.env,{[n]:originals[n]});}}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
