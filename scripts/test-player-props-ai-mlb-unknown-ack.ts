/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic fluent Supabase rows and isolated actual-module VM boundaries intentionally exercise runtime admission, publication and retention. */
// Actual canonical/index/cutoff/first-lock regressions, including commit followed
// by rejected acknowledgement. All transport is controlled; no real DB/HTTP.
// The pre-fence b148 negative control is frozen privately with its diagnosis.
import {readerCanonicalContextHash} from '../lib/playerPropsAi/readerContext';
import {summarizePropsAiRuntimeHealth} from '../lib/playerPropsAi/runtimeHealth';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import * as source from '../lib/playerPropsAi/liveSources';
import * as handoffs from '../lib/playerPropsAi/mlbPrelockHandoff';
import * as publicationPolicy from '../lib/mlb/props/aiPublicationPolicy';
import * as marketEvidence from '../lib/mlb/props/marketEvidenceCapture';
import * as ordering from '../lib/mlb/props/releaseOrdering';
import * as lockPolicy from '../lib/mlb/props/lockPolicy';
import * as settlement from '../lib/mlb/props/settlement';
import * as pricePolicy from '../lib/mlb/props/pricePolicy';
import * as versions from '../lib/mlb/props/marketModelVersions';
import {resolveMlbStatsTeamId} from '../lib/mlb/props/mlbTeamAliases';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {digest} from '../lib/playerPropsAi/evidence';
import {packet as originalPacket,review as originalReview,native as originalNative,snapshot as fixture,at as fixtureAt} from './test-player-props-ai-mlb-event-settlement';
import type {MlbPropsBoardSnapshot} from '../lib/mlb/props/boardSnapshotStore';
import type {PlayerPropPreviewRow} from '../app/mlb/props/components/PlayerPropsDashboard';
import type {reviewPropsForSite} from '../lib/playerPropsAi/siteRuntime';

globalThis.fetch=async()=>{throw Error('MLB writer proof forbids real HTTP');};
const originalGlobalDate=globalThis.Date;
const modes=['success','unknown-append','unknown-index','before-write','null-append','undefined-index','queued-index','late-index','midnight-index','returned-append','returned-index','index-refused','generic-append','generic-index','generic-returned-index'] as const;
type Mode=typeof modes[number];
async function runScenario(mode:Mode){
 const at=mode==='midnight-index'?'2030-06-01T23:58:00Z':fixtureAt,now=new Date(Date.parse(at)+60000).toISOString();
 const retime=<T>(value:T):T=>JSON.parse(JSON.stringify(value).split(fixtureAt).join(at));
 const envNames=['NODE_ENV','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'] as const;const originals=Object.fromEntries(envNames.map(n=>[n,process.env[n]]));Object.assign(process.env,{NODE_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1',SUPABASE_SERVICE_ROLE_KEY:'synthetic-never-real'});
 try{
 const live=await import('../lib/mlb/props/liveBoard');
 const lock=new Date(Date.parse(at)+240000).toISOString(),start=new Date(Date.parse(lock)+3600000).toISOString();
 const packet={...retime(originalPacket),start,lock},native={...retime(originalNative),gameStartTime:start};
 const archived=Buffer.from(JSON.stringify(packet));
 const review={...structuredClone(originalReview),start,lock,cutoff:at,issuedAt:now,criticalContextHashes:criticalContextHashes(packet),inputHash:digest(packet),inputEvidence:{encoding:'gzip-base64' as const,bytes:archived.length,data:zlib.gzipSync(archived).toString('base64'),digest:digest(packet)}};
 // This synthetic callback fixture retimes its source before publication; bind
 // the prospective proof to that fixture, never to a real stored review.
 for(const player of review.players){player.sourceReadProofs!.originalCriticalContextHash=review.criticalContextHashes[player.playerId];player.sourceReadProofs!.canonicalContextHash=readerCanonicalContextHash(packet,player.playerId);}
 let tick=at,serial=0,providerCalls=0;
 let faultNext:string|null=null,unknownAck=0,capturedFailure:unknown=null,genericPublications=0;
 const failed=mode!=='success',genericFailure=mode.startsWith('generic-'),handoffFailed=failed&&!genericFailure;
 const commits=handoffFailed&&mode!=='before-write',indexed=mode.includes('index')&&mode!=='index-refused';
 const uncertain=(error:any)=>{assert.equal(error?.name,'MlbPropsPublicationUncertainError');capturedFailure=error;return true;};
 const env={MLB_PLAYER_PROPS_CRON_ENABLED:'true',NODE_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1',SUPABASE_SERVICE_ROLE_KEY:'synthetic-never-real',ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED:'true',ODDSPHERE_PROPS_SNAPSHOT_RETENTION_PER_SLATE:'20',ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED:'true',ODDSPHERE_PROPS_DISPLAY_ENABLED:'true'};
 const tables:Record<string,any[]>={prop_scoring_runs:[],admin_audit_log:[],mlb_prop_tracking_entries:[]};
 const contains=(row:any,value:any):boolean=>Object.entries(value).every(([k,v])=>v&&typeof v==='object'?contains(row?.[k],v):row?.[k]===v);
 const client={from(table:string){assert(Object.hasOwn(tables,table),`Unexpected fixture table ${table}`);const filters:((r:any)=>boolean)[]=[],orders:{key:string;ascending:boolean}[]=[];let limit=Infinity,offset=0,insert:any[]|null=null,deleting=false;
  const query:any={select(){return query;},eq(k:string,v:any){filters.push(r=>r[k]===v);return query;},lte(k:string,v:any){filters.push(r=>r[k]<=v);return query;},not(k:string,_op:string,v:any){filters.push(r=>r[k]!==v&&r[k]!==undefined);return query;},contains(k:string,v:any){filters.push(r=>contains(r[k],v));return query;},in(k:string,vs:any[]){filters.push(r=>vs.includes(r[k]));return query;},order(key:string,o:{ascending:boolean}){orders.push({key,ascending:o.ascending});return query;},limit(n:number){limit=n;return query;},range(from:number,to:number){offset=from;limit=to-from+1;return query;},insert(v:any){insert=Array.isArray(v)?v:[v];return query;},delete(){deleting=true;return query;},
   async execute(){if(insert){if(faultNext===table&&(mode==='before-write'||mode==='index-refused')){faultNext=null;unknownAck++;if(mode==='index-refused')return{data:null,error:{message:'PRIVATE_REJECTED_INDEX_MESSAGE'}};throw Error('synthetic_before_write_failure');}const added=insert.map(v=>({...structuredClone(v),id:String(++serial),created_at:tick}));tables[table].push(...added);if(faultNext===table){faultNext=null;unknownAck++;if(mode.startsWith('returned-')||mode==='generic-returned-index')return{data:null,error:{message:'PRIVATE_COMMITTED_TRANSPORT_MESSAGE'}};throw mode==='null-append'?null:mode==='undefined-index'?undefined:Error('synthetic_commit_then_lost_ack:'+table);}return{data:added,error:null};}let rows=tables[table].filter(r=>filters.every(f=>f(r)));for(const {key,ascending} of [...orders].reverse())rows.sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(ascending?1:-1));rows=rows.slice(offset,offset+limit);if(deleting)tables[table]=tables[table].filter(r=>!rows.includes(r));return{data:structuredClone(rows),error:null};},
   async single(){const r=await query.execute();return{...r,data:r.data[0]??null};},async maybeSingle(){return query.single();},then(resolve:any,reject:any){return query.execute().then(resolve,reject);}};return query;}};
 class Clock extends Date{constructor(v?:string|number){super(v??tick);}static now(){return Date.parse(tick);}}
 function loadModule(file:string,modules:Record<string,unknown>){const instance={exports:{}};const javascript=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(javascript,{module:instance,exports:instance.exports,Date:Clock,Error,Request,URL,Buffer,console,process:{env},require:(name:string)=>{const key=name.split('/').at(-1)!;assert(Object.hasOwn(modules,key),`Unmocked ${file} dependency ${name}`);return modules[key];}},{filename:file+'.offline.cjs'});return instance.exports as any;}
 globalThis.Date=Clock as DateConstructor;
 const canonical=loadModule('lib/mlb/props/boardSnapshotStore.ts',{'node:crypto':crypto,'node:zlib':zlib,'supabase-js':{createClient:()=>client},aiPublicationPolicy:publicationPolicy,marketEvidenceCapture:marketEvidence,releaseOrdering:ordering});
 const tracking=loadModule('lib/mlb/props/internalTracking.ts',{'node:crypto':crypto,'supabase-js':{createClient:()=>client},_mlbStatsApiClient:{},boardSnapshotStore:canonical,paperTrading:{isPaperTradingMarketAllowed:()=>true},pricePolicy,marketModelVersions:versions,lockPolicy,providerClients:{},settlement});
 const lockB=new Date(Date.parse(lock)+600000).toISOString(),startB=new Date(Date.parse(lockB)+3600000).toISOString();
 const packetB={...structuredClone(packet),gameId:'balldontlie-game-2',start:startB,lock:lockB};
 const archivedB=Buffer.from(JSON.stringify(packetB));
 const reviewB={...structuredClone(review),gameId:packetB.gameId,sourceGameId:packetB.gameId,start:startB,lock:lockB,criticalContextHashes:criticalContextHashes(packetB),inputHash:digest(packetB),inputEvidence:{encoding:'gzip-base64' as const,bytes:archivedB.length,data:zlib.gzipSync(archivedB).toString('base64'),digest:digest(packetB)}};
 for(const player of reviewB.players){player.sourceReadProofs!.originalCriticalContextHash=reviewB.criticalContextHashes[player.playerId];player.sourceReadProofs!.canonicalContextHash=readerCanonicalContextHash(packetB,player.playerId);}
 const games:any[]=[{id:packet.gameId,scheduledStart:start,awayTeamId:'147',homeTeamId:'111'},{id:packetB.gameId,scheduledStart:startB,awayTeamId:'147',homeTeamId:'111'}];
 const nativeRows:PlayerPropPreviewRow[]=[{...native,confidence:.6,marketFamily:'batter',reasonCodes:[],modelInputWarnings:[]},{...native,id:'native-B',gameStartTime:startB,providerIds:{...native.providerIds!,gameId:packetB.gameId,bdlGameId:'2'},confidence:.6,marketFamily:'batter',reasonCodes:[],modelInputWarnings:[]}];
 const data=live.buildDashboardData({slateDate:'2030-06-01',asOfTimestamp:at,games,probablePitchers:[],props:nativeRows,sourceOdds:[],environmentErrors:[]});
 const snapshot:any={...retime(fixture),asOfTimestamp:at,schemaVersion:1,snapshotId:'initial-native',refreshMode:'fast',data,validation:{publishable:true,errors:[],warnings:[],actionableRows:0,sourceRows:1,mappedRows:1,staleOddsRows:0,researchRows:1},movement:{comparedWith:null,changedPrices:0,changedLines:0,addedRows:1,removedRows:0},modelContext:{modelReleaseId:versions.MLB_PROPS_MODEL_RELEASE_ID,trackingEventRelease:settlement.MLB_PROPS_LOCKED_EVENT_RELEASE,probablePitcherSeasonStats:[]}};
 type ReviewArgs=Parameters<typeof reviewPropsForSite>[0];
 const provider={getClient:()=>({getRequestCount:()=>{providerCalls++;return 0;}})};
 const modules:any={snapshot,aiReviewRuntime:undefined,summarizePropsAiRuntimeHealth,args:{persist:true,writerRunId:'synthetic-lease-owner',slateDate:'2030-06-01'},asOfTimestamp:at,games,probablePitchers:[],expandedDecisionProps:nativeRows,boardSourceOdds:[],openingOdds:[],environment:{errors:[]},previous:null,mappedOdds:[{}],providerCoverage:undefined,playerGameIdentityConflictRows:0,probablePitcherResolution:{fallbackAssignments:[],findings:[]},oddsClient:provider,researchClient:provider,lineupResult:{balldontlieCalls:0},
  createPropsAiDbClient:()=>client,propsAiSiteConfig:()=>({integrated:true}),createMlbPrelockHandoff:handoffs.createMlbPrelockHandoff,MLB_PROPS_AI_HANDOFF_RELEASE:handoffs.MLB_PROPS_AI_HANDOFF_RELEASE,
  Date:Clock,randomUUID:crypto.randomUUID,process:{env},buildDashboardData:live.buildDashboardData,compareMlbPropsBoardMovement:live.compareMlbPropsBoardMovement,resolveMlbStatsTeamId,
  validateMlbPropsBoardData:(args:any)=>{const validation=live.validateMlbPropsBoardData({...args,sourceRows:1});assert(validation.publishable,validation.errors.join('|'));return validation;},
  enforceSnapshotPayloadLimits:(s:MlbPropsBoardSnapshot)=>canonical.assertSnapshotSizeWithinLimits(canonical.measureMlbPropsBoardSnapshot(s)),
  publishMlbPropsBoardSnapshot:async(s:MlbPropsBoardSnapshot)=>{if(genericFailure&&s.asOfTimestamp===tick&&Date.parse(tick)>Date.parse(lock))faultNext=mode.includes('index')?'admin_audit_log':'prop_scoring_runs';return canonical.publishMlbPropsBoardSnapshot(s);},ensureMlbPropsGameLocks:tracking.ensureMlbPropsGameLocks,
  liveMlbPacket:source.liveMlbPacket,envPositiveInteger:(_k:string,n:number)=>n,DEFAULT_MAX_BDL_CALLS_PER_REFRESH:300,
  genericPublications:0,reviewPropsForSite:async(args:ReviewArgs)=>{
   await args.onSourceReady?.(packet,null,at,true);assert.equal(tables.prop_scoring_runs.length,1);
   tick=now;
   if(handoffFailed)faultNext=mode.includes('index')?'admin_audit_log':'prop_scoring_runs';
   if(mode==='queued-index'){
    const siblings=await Promise.allSettled([args.onReviewObserved!(packet,review,true),args.onSourceReady!(packetB,null,tick,true)]);
    assert.equal(siblings.length,2);for(const sibling of siblings){assert.equal(sibling.status,'rejected');if(sibling.status==='rejected')uncertain(sibling.reason);}
   }else if(handoffFailed)await assert.rejects(async()=>{await args.onReviewObserved!(packet,review,true);},uncertain);
   else await args.onReviewObserved!(packet,review,true);
   const appended=await canonical.loadMlbPropsBoardSnapshotAtOrBefore('2030-06-01',tick);assert(appended);
   assert.equal(Boolean(appended.data.props.find((r:any)=>r.providerIds?.gameId===packet.gameId)?.aiReview),!handoffFailed||commits&&indexed);
   assert.equal(tables.prop_scoring_runs.some(r=>canonical.decodeMlbPropsBoardSnapshot(r.metadata_json)?.data.props.find((p:any)=>p.providerIds?.gameId===packet.gameId)?.aiReview),!handoffFailed||commits,'The original uncertain raw append is retained even when it is not publication authority');
   const writes=tables.prop_scoring_runs.length,indexWrites=tables.admin_audit_log.length;
   tick=new Date(Date.parse(mode==='late-index'?lock:at)+(mode==='late-index'?1000:120000)).toISOString();
   if(handoffFailed)await assert.rejects(async()=>{await args.onSourceReady!(packetB,null,tick,true);},uncertain);else await args.onSourceReady?.(packetB,null,tick,true);
   tick=new Date(Date.parse(mode==='late-index'?lock:at)+(mode==='late-index'?2000:180000)).toISOString();
   if(handoffFailed){
    await assert.rejects(async()=>{await args.onReviewObserved!(packetB,reviewB,true);},uncertain);
    await assert.rejects(async()=>{await args.onReviewReady!(packetB,reviewB);},uncertain);
    assert.equal(tables.prop_scoring_runs.length,writes,'Fenced siblings never send a later canonical insert');
    assert.equal(tables.admin_audit_log.length,indexWrites,'Fenced siblings never send a later index/lock insert');
   }else{await args.onReviewObserved?.(packetB,reviewB,true);await args.onReviewReady?.(packetB,reviewB);}
   tick=new Date(Date.parse(lock)+3000).toISOString();
   if(handoffFailed)await assert.rejects(async()=>{await args.onReviewObserved!(packet,review,true);},uncertain);else await args.onReviewObserved?.(packet,review,true);
   return{status:'active',games:[],findings:handoffFailed?['source_or_review_unavailable:'+packet.gameId+':synthetic_unknown_ack']:[],newlyCompletedReviews:handoffFailed?1:2};
  },};
 // Execute the exact shipped integration block, with real publication and lock
 // code and real parser-produced values. Upstream providers remain outside it.
 const text=readFileSync('lib/mlb/props/liveBoard.ts','utf8'),ast=ts.createSourceFile('liveBoard.ts',text,ts.ScriptTarget.Latest,true);
 const refresh=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='refreshMlbPropsBoard') as ts.FunctionDeclaration;
 const block=refresh.body!.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).includes('propsAiSiteConfig().integrated'))!;
 assert(block,'Actual writer callback block missing');
 const js=ts.transpileModule(`(async()=>{${block.getText(ast)} genericPublications++;await publishMlbPropsBoardSnapshot(snapshot);})()`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const publication=vm.runInNewContext(js,modules,{filename:'actual-mlb-writer-ai-block.offline.cjs'});
 if(failed)await assert.rejects(publication,uncertain);else await publication;
 genericPublications=modules.genericPublications;
 assert.equal(genericPublications,handoffFailed?0:1,'The actual final whole-board path cannot continue after rows() loses authority');
 assert.equal(providerCalls,0);
 const envelopeHash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const originalSources=new Map(tables.prop_scoring_runs.map(r=>[r.id,envelopeHash(r.metadata_json)]));
 const aRow=(s:any)=>s.data.props.find((r:any)=>r.providerIds?.gameId===packet.gameId);
 const cutoff=await canonical.loadMlbPropsBoardSnapshotAtOrBefore('2030-06-01',lock);assert(cutoff);
 const finalEligible=!handoffFailed||commits&&indexed;
 assert.equal(Boolean(aRow(cutoff).aiReview),finalEligible,'Only the original indexed source can become a future R2 first lock');
 // A new ordinary invocation may read original persisted source and run the
 // existing cutoff lock writer. It cannot invent a missing publication index.
 tick=new Date(Date.parse(lock)+4000).toISOString();
 const locks=await tracking.ensureMlbPropsGameLocks(snapshot,tick);assert.equal(locks.created,1);
 const firstLock=locks.locks.find((l:any)=>l.external_game_id===packet.gameId);assert(firstLock);assert.equal(firstLock.board_snapshot_id,cutoff.snapshotId);
 const lockBytes=digest((await canonical.loadMlbPropsGameLocks('2030-06-01')).find((l:any)=>l.external_game_id===packet.gameId)),sourceBytes=digest(aRow(cutoff));
 const rawSource=()=>tables.prop_scoring_runs.map(r=>canonical.decodeMlbPropsBoardSnapshot(r.metadata_json)).find(s=>s?.snapshotId===cutoff.snapshotId);
 assert.equal(digest(aRow(rawSource())),sourceBytes);
 const byId=await canonical.loadMlbPropsBoardSnapshotById('2030-06-01',cutoff.snapshotId);
 assert(byId,'Every selected future R2 first-lock source is actually readable by immutable ID');
 const display=await canonical.applyMlbPropsDisplayLocks(snapshot);
 assert.equal(aRow(display).lockStatus?.status,'locked');assert.equal(Boolean(aRow(display).aiReview),finalEligible);
 const restartRows=display.data.props;
 const storedRowsBefore=digest(restartRows);
 const restart=handoffs.createMlbPrelockHandoff(restartRows,async(rows)=>{
  const next={...snapshot,snapshotId:crypto.randomUUID(),asOfTimestamp:tick,data:live.buildDashboardData({slateDate:'2030-06-01',asOfTimestamp:tick,games,probablePitchers:[],props:rows,sourceOdds:[],environmentErrors:[]})};
  await tracking.ensureMlbPropsGameLocks(next,tick);await canonical.publishMlbPropsBoardSnapshot(next);
 });
 await restart.observe(packet,review,true);
 assert.equal(digest(restart.rows()),storedRowsBefore,'Restart cannot reinterpret or backdate an already locked game');
 {
  await restart.observe(packetB,reviewB,true);
  const current=await canonical.loadLatestMlbPropsBoardSnapshot('2030-06-01');assert(current);
  const lockedDisplay=await canonical.applyMlbPropsDisplayLocks(current);assert.equal(digest(aRow(lockedDisplay)),digest(aRow(display)),'An ordinary restart keeps the existing exact locked row');
 }
 for(let i=0;i<3;i++)await tracking.ensureMlbPropsGameLocks(snapshot,tick);
 assert.equal(digest((await canonical.loadMlbPropsGameLocks('2030-06-01')).find((l:any)=>l.external_game_id===packet.gameId)),lockBytes);
 assert.equal(digest(aRow(rawSource())),sourceBytes,'Original persisted source remains unchanged');
 for(const [id,bytes] of originalSources){const retained=tables.prop_scoring_runs.find(r=>r.id===id);assert(retained);assert.equal(envelopeHash(retained.metadata_json),bytes,'Every original stored source, including an unindexed uncertain append, remains exact');}
 if(failed){
  let routeRefreshes=0,fallbackReads=0,fallbackTracking=0,fallbackMembers=0,leased=false;
  const route=loadModule('app/api/cron/mlb-player-props-refresh/route.ts',{
   runCron:{cronHandler:async(_r:any,_name:any,run:any,options:any)=>{assert.equal(options.sport,'mlb');assert.equal(options.leaseGroup,'prediction_pipeline');assert.equal(options.requireLease,true);leased=true;try{return await run({runId:'same-mlb-owner'});}finally{leased=false;}}},
   playerPropsRefreshTelemetry:{},liveBoard:{easternSlateDate:()=> '2030-06-01',refreshMlbPropsBoard:async()=>{assert(leased);routeRefreshes++;throw capturedFailure;}},
   boardSnapshotStore:{loadLatestMlbPropsBoardSnapshot:async()=>{fallbackReads++;throw Error('Unknown authority cannot use a cached/LKG fallback');}},
   internalTracking:{syncInternalMlbPropsTracking:async()=>{fallbackTracking++;}},memberReadSnapshotStore:{publishMlbPropsMemberReadSnapshots:async()=>{fallbackMembers++;}},
  });
  const result=await route.GET(new Request('https://offline.invalid/api/cron/mlb-player-props-refresh'));
  assert.equal(routeRefreshes,1);assert.equal(result.partial,true);assert.equal(result.details.publicationAuthorityUncertain,true);assert.equal(result.details.lockFallbackAttempted,false);
  assert.equal(result.records_updated,undefined);assert.equal(result.api_calls_made,undefined);assert.equal(result.details.publicationCommit,'unknown');assert.equal(result.details.providerCallCount,'unknown');
  assert(!JSON.stringify(result).includes('PRIVATE_'),'Neither returned nor thrown transport messages enter route diagnostics');
  assert.equal(fallbackReads+fallbackTracking+fallbackMembers,0);assert.equal(leased,false);
 }
 return{mode,unknownAck,genericPublications,committedFinal:mode!=='before-write',cutoffFinal:Boolean(aRow(cutoff).aiReview),firstLockReadable:true,originalSourceAndLocksUnchanged:true,providerCalls};
 }finally{globalThis.Date=originalGlobalDate;for(const n of envNames){if(originals[n]===undefined)Reflect.deleteProperty(process.env,n);else Object.assign(process.env,{[n]:originals[n]});}}
}
async function main(){const results=[];for(const mode of modes)results.push(await runScenario(mode));console.log(JSON.stringify({mlbUnknownAcknowledgementFence:true,actualAppendIndexCutoffFirstLock:true,actualRouteNoStaleFallback:true,scenarios:results,realNetwork:0,realSql:0,providerModelCountCalls:0}));}
void main().catch(e=>{console.error(e);process.exitCode=1;});
