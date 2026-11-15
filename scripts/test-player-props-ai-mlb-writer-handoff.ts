/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic fluent Supabase rows and isolated actual-module VM boundaries intentionally exercise runtime admission, publication and retention. */
/** Actual MLB writer AI block, canonical publisher/retention/cutoff reader and
 * game-lock writer. All DB/provider I/O is an in-memory fixture. */
import {readerCanonicalContextHash} from '../lib/playerPropsAi/readerContext';
import {summarizePropsAiRuntimeHealth,propsAiFinalSourceHolds} from '../lib/playerPropsAi/runtimeHealth';
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
import {applyMlbSiteAi} from '../lib/playerPropsAi/siteBindings';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {readerAvailabilityContextHash} from '../lib/playerPropsAi/readerClaimFreshness';
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
 // This synthetic callback fixture retimes its source before publication; bind
 // the prospective proof to that fixture, never to a real stored review.
 for(const player of review.players){player.sourceReadProofs!.originalCriticalContextHash=review.criticalContextHashes[player.playerId];player.sourceReadProofs!.canonicalContextHash=readerCanonicalContextHash(packet,player.playerId);}
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
 const canonical=loadModule('lib/mlb/props/boardSnapshotStore.ts',{'node:crypto':crypto,'node:zlib':zlib,'supabase-js':{createClient:()=>client},aiPublicationPolicy:publicationPolicy,marketEvidenceCapture:marketEvidence,releaseOrdering:ordering});
 const tracking=loadModule('lib/mlb/props/internalTracking.ts',{'node:crypto':crypto,'supabase-js':{createClient:()=>client},_mlbStatsApiClient:{},boardSnapshotStore:canonical,paperTrading:{isPaperTradingMarketAllowed:()=>true},pricePolicy,marketModelVersions:versions,lockPolicy,providerClients:{},settlement});
 const games:any[]=[{id:packet.gameId,scheduledStart:start,awayTeamId:'147',homeTeamId:'111'}];
 const nativeRows=[{...native,confidence:.6,marketFamily:'batter' as const,reasonCodes:[],modelInputWarnings:[]}];
 const data=live.buildDashboardData({slateDate:'2030-06-01',asOfTimestamp:at,games,probablePitchers:[],props:nativeRows,sourceOdds:[],environmentErrors:[]});
 const snapshot:any={...fixture,schemaVersion:1,snapshotId:'initial-native',refreshMode:'fast',data,validation:{publishable:true,errors:[],warnings:[],actionableRows:0,sourceRows:1,mappedRows:1,staleOddsRows:0,researchRows:1},movement:{comparedWith:null,changedPrices:0,changedLines:0,addedRows:1,removedRows:0},modelContext:{modelReleaseId:versions.MLB_PROPS_MODEL_RELEASE_ID,trackingEventRelease:settlement.MLB_PROPS_LOCKED_EVENT_RELEASE,probablePitcherSeasonStats:[]}};
 type ReviewArgs=Parameters<typeof reviewPropsForSite>[0];
 const provider={getClient:()=>({getRequestCount:()=>{providerCalls++;return 0;}})};
 const modules:any={snapshot,aiReviewRuntime:undefined,summarizePropsAiRuntimeHealth,propsAiFinalSourceHolds,args:{persist:true,writerRunId:'synthetic-lease-owner',slateDate:'2030-06-01'},asOfTimestamp:at,games,probablePitchers:[],expandedDecisionProps:nativeRows,boardSourceOdds:[],openingOdds:[],environment:{errors:[]},previous:null,mappedOdds:[{}],providerCoverage:undefined,playerGameIdentityConflictRows:0,probablePitcherResolution:{fallbackAssignments:[],findings:[]},oddsClient:provider,researchClient:provider,lineupResult:{balldontlieCalls:0},
  createPropsAiDbClient:()=>client,propsAiSiteConfig:()=>({integrated:true}),createMlbPrelockHandoff:(rows:any,publish:any,options:any)=>handoffs.testMlbPrelockHandoff(rows,publish,()=>tick,options),MLB_PROPS_AI_HANDOFF_RELEASE:handoffs.MLB_PROPS_AI_HANDOFF_RELEASE,
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
   return{status:'active',games:[{game:{id:packet.gameId,start,away:'NYY',home:'BOS'},packet,decisions:[],authorityReview:review,observedAt:tick}],findings:[],newlyCompletedReviews:1};
  },};
 // Execute the exact shipped integration block, with real publication and lock
 // code and real parser-produced values. Upstream providers remain outside it.
 const text=readFileSync('lib/mlb/props/liveBoard.ts','utf8'),ast=ts.createSourceFile('liveBoard.ts',text,ts.ScriptTarget.Latest,true);
 const refresh=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='refreshMlbPropsBoard') as ts.FunctionDeclaration;
 const block=refresh.body!.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).includes('propsAiSiteConfig().integrated'))!;
 assert(block,'Actual writer callback block missing');
 const js=ts.transpileModule(`(async()=>{${block.getText(ast)}})()`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 await vm.runInNewContext(js,modules,{filename:'actual-mlb-writer-ai-block.offline.cjs'});
 assert.equal(modules.aiReviewRuntime.status,'active');assert.equal(modules.aiReviewRuntime.newlyCompletedReviews,1);assert.equal(modules.aiReviewRuntime.observedAt,tick);
 assert(!JSON.stringify(snapshot).includes('aiReviewRuntime'),'Process health remains outside canonical/member/lock snapshots');
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
 // Independent fresh in-memory branch: prior game B has acknowledged AI,
 // but only A has a current successful authority callback. The exact shipped
 // writer must publish A before B, omit B from new cutoff sources and refuse
 // a generic final native fallback. No old source is changed or reconstructed.
 for(const table of Object.values(tables))table.length=0;serial=0;tick=at;canonical.revalidateMlbPropsBoardCache();
 const packetB=structuredClone(packet);packetB.gameId='balldontlie-game-2';packetB.sourceGameId=packetB.gameId;
 const reviewB=structuredClone(review);reviewB.gameId=reviewB.sourceGameId=packetB.gameId;reviewB.criticalContextHashes=criticalContextHashes(packetB);reviewB.inputHash=digest(packetB);const rawB=JSON.stringify(packetB);reviewB.inputEvidence={encoding:'gzip-base64',digest:digest(packetB),bytes:Buffer.byteLength(rawB),data:zlib.gzipSync(rawB).toString('base64')};
 for(const p of reviewB.players){p.sourceReadProofs!.originalCriticalContextHash=reviewB.criticalContextHashes[p.playerId];p.sourceReadProofs!.canonicalContextHash=readerCanonicalContextHash(packetB,p.playerId);p.sourceReadProofs!.availabilityContextHash=readerAvailabilityContextHash(packetB,p.playerId)!;}
 const nativeB:typeof nativeRows[number]={...nativeRows[0],id:'native-B',providerIds:{...nativeRows[0].providerIds!,gameId:packetB.gameId}};
 const oldB=applyMlbSiteAi([nativeB],packetB,siteAiDecisions(packetB,reviewB,now),now)[0];assert(oldB.aiReview);
 const twoGames=[...games,{id:packetB.gameId,scheduledStart:start,awayTeamId:'147',homeTeamId:'111'}];
 const prior={...snapshot,snapshotId:'previous-two-game-ACK',asOfTimestamp:at,data:live.buildDashboardData({slateDate:'2030-06-01',asOfTimestamp:at,games:twoGames,probablePitchers:[],props:[nativeRows[0],oldB],sourceOdds:[],environmentErrors:[]})};
 await canonical.publishMlbPropsBoardSnapshot(prior);const priorBytes=digest(JSON.parse(JSON.stringify(prior)));
 const nextSnapshot={...snapshot,snapshotId:'new-native-private',asOfTimestamp:at,data:live.buildDashboardData({slateDate:'2030-06-01',asOfTimestamp:at,games:twoGames,probablePitchers:[],props:[nativeRows[0],nativeB],sourceOdds:[],environmentErrors:[]})};
 const twoModules={...modules,snapshot:nextSnapshot,previous:prior,games:twoGames,expandedDecisionProps:[nativeRows[0],nativeB],aiReviewRuntime:undefined,reviewPropsForSite:async(args:ReviewArgs)=>{
   await args.onSourceReady?.(packet,null,at,true);tick=now;await args.onReviewReady?.(packet,review);
   const latest=await canonical.loadLatestMlbPropsBoardSnapshot('2030-06-01');assert(latest);assert(latest.data.props.some((r:any)=>r.aiReview));assert(!latest.data.props.some((r:any)=>r.providerIds?.gameId===packetB.gameId));
   await assert.rejects(async()=>{await args.onReviewObserved?.(packetB,null,false);},handoffs.MlbPropsReviewAuthorityUnavailableError);
   return{status:'active',games:[],findings:['source_or_review_unavailable:'+packetB.gameId+':review_lookup_unknown'],newlyCompletedReviews:1};
 }};
 await assert.rejects(async()=>{await vm.runInNewContext(js,twoModules,{filename:'actual-mlb-partial-ready-writer.offline.cjs'});},handoffs.MlbPropsReviewAuthorityUnavailableError);
 const actualA=await canonical.loadLatestMlbPropsBoardSnapshot('2030-06-01');assert(actualA?.data.props.some((r:any)=>r.aiReview));assert(!actualA.data.props.some((r:any)=>r.providerIds?.gameId===packetB.gameId));assert.equal(digest(JSON.parse(JSON.stringify(prior))),priorBytes);
 const branchState=structuredClone(tables);tick=new Date(Date.parse(lock)+1).toISOString();
 const noFalseLock=await tracking.ensureMlbPropsGameLocksForSchedule({slateDate:'2030-06-01',schedule:twoGames.map(g=>({externalGameId:g.id,gameStartTimestamp:g.scheduledStart})),observedAt:tick});
 assert(noFalseLock.locks.some((l:any)=>l.external_game_id===packet.gameId));assert(!noFalseLock.locks.some((l:any)=>l.external_game_id===packetB.gameId),'New partial A source must hold B first-lock instead of falling through to its older source');
 const priorStored=await canonical.loadMlbPropsBoardSnapshotById('2030-06-01',prior.snapshotId);assert.equal(digest(priorStored),priorBytes,'Old acknowledged B source remains exact');
 // Separate before-lock restart branch from the same acknowledged database
 // checkpoint. Only known current B may restore B and permit its first lock.
 for(const [name,rows]of Object.entries(branchState))tables[name]=structuredClone(rows);canonical.revalidateMlbPropsBoardCache();tick=new Date(Date.parse(now)+1000).toISOString();
 const recovered=handoffs.testMlbPrelockHandoff([nativeRows[0],nativeB],async(rows)=>{const ready={...snapshot,snapshotId:crypto.randomUUID(),asOfTimestamp:tick,data:live.buildDashboardData({slateDate:'2030-06-01',asOfTimestamp:tick,games:twoGames,probablePitchers:[],props:rows,sourceOdds:[],environmentErrors:[]})};await canonical.publishMlbPropsBoardSnapshot(ready);},()=>tick,{slateDate:'2030-06-01',games:twoGames.map(g=>({gameId:g.id,start:g.scheduledStart})),previousSnapshot:actualA});
 await recovered.observe({...packet,cutoff:tick},review,true);assert.throws(()=>recovered.rows(),handoffs.MlbPropsReviewAuthorityUnavailableError);
 tick=new Date(Date.parse(tick)+1).toISOString();await recovered.observe({...packetB,cutoff:tick},reviewB,true);assert.equal(recovered.rows().length,2);assert(recovered.rows().every(r=>r.aiReview));
 tick=new Date(Date.parse(lock)+1).toISOString();const restoredLocks=await tracking.ensureMlbPropsGameLocksForSchedule({slateDate:'2030-06-01',schedule:twoGames.map(g=>({externalGameId:g.id,gameStartTimestamp:g.scheduledStart})),observedAt:tick});assert(restoredLocks.locks.some((l:any)=>l.external_game_id===packetB.gameId),'Known same-game recovery restores original positive qualification and first-lock');
 // Real unchanged validator: compare partial publication only with the same
 // declared known scope. Numeric/price/provider/actionable gates stay intact.
 const wide=(game:string,n:number):typeof nativeRows=>Array.from({length:n},(_,i)=>({...nativeRows[0],id:game+'-'+i,providerIds:{...nativeRows[0].providerIds!,gameId:game,bdlPlayerId:100+i,mlbStatsPlayerId:'mlbstats-player-'+(100+i)},player:'Synthetic '+game+' '+i}));
 const A=wide(packet.gameId,20),B=wide(packetB.gameId,80),hundred={...prior,data:live.buildDashboardData({slateDate:'2030-06-01',asOfTimestamp:at,games:twoGames,probablePitchers:[],props:[...A,...B],sourceOdds:[],environmentErrors:[]}),validation:{...prior.validation,sourceRows:100}};
 const validate=(rows:any[],comparison:any)=>live.validateMlbPropsBoardData({data:live.buildDashboardData({slateDate:'2030-06-01',asOfTimestamp:at,games:twoGames,probablePitchers:[],props:rows,sourceOdds:[],environmentErrors:[]}),sourceRows:100,mappedRows:100,asOfTimestamp:at,previousSnapshot:comparison});
 assert(validate(A,hundred).errors.some(e=>e.startsWith('UNEXPECTED_BOARD_CONTRACTION')),'Wholeboard comparison really rejects20of100');
 const scoped={...hundred,data:{...hundred.data,props:A}};assert(validate(A,scoped).publishable);assert(validate(A.slice(0,15),scoped).publishable,'Exact original75% boundary remains inclusive');assert(validate(A.slice(0,14),scoped).errors.some(e=>e.startsWith('UNEXPECTED_BOARD_CONTRACTION')));assert(validate(A.slice(0,9),scoped).errors.some(e=>e.startsWith('UNEXPECTED_BOARD_CONTRACTION')));
 const actionA=A.map(r=>({...r,playGrade:'LEAN' as const,units:1})),actionPrevious={...scoped,data:{...scoped.data,props:actionA}};assert(validate(A,actionPrevious).errors.some(e=>e.startsWith('UNEXPECTED_ACTIONABLE_CONTRACTION')),'Knownscope actionable contraction is still a real refusal');
 // An immutable already locked public price is not a new executable
 // quote. The actual writer validates fresh unlocked A without regrading,
 // repricing, suppressing or refreshing the exact stale locked B record.
 tick=new Date(Date.parse(now)+60000).toISOString();
 const staleLockedB={...oldB,lastUpdated:new Date(Date.parse(at)-7200000).toISOString(),lockStatus:{status:'locked' as const,lockedAt:at}},lockedBytes=digest(staleLockedB);
 const lockedPrevious={...prior,snapshotId:'stale-locked-ACK',asOfTimestamp:tick,data:live.buildDashboardData({slateDate:'2030-06-01',asOfTimestamp:at,games:twoGames,probablePitchers:[],props:[nativeRows[0],staleLockedB],sourceOdds:[],environmentErrors:[]})};
 await canonical.publishMlbPropsBoardSnapshot(lockedPrevious);const storedLockedPrevious=await canonical.loadMlbPropsBoardSnapshotById('2030-06-01',lockedPrevious.snapshotId);assert(storedLockedPrevious);assert.equal(digest(storedLockedPrevious.data.props.find((r:any)=>r.providerIds?.gameId===packetB.gameId)),lockedBytes,'The exact locked embedded modules originate in a stored canonical source');
 const lockedSnapshot={...nextSnapshot,snapshotId:'new-native-with-old-public-lock',asOfTimestamp:tick,data:live.buildDashboardData({slateDate:'2030-06-01',asOfTimestamp:tick,games:twoGames,probablePitchers:[],props:[nativeRows[0],nativeB],sourceOdds:[],environmentErrors:[]})};
 const lockedModules={...modules,snapshot:lockedSnapshot,previous:storedLockedPrevious,games:twoGames,expandedDecisionProps:[nativeRows[0],nativeB],asOfTimestamp:tick,aiReviewRuntime:undefined,reviewPropsForSite:async(args:ReviewArgs)=>{await args.onSourceReady?.({...packet,cutoff:tick},null,tick,true);return{status:'active',games:[],findings:[],newlyCompletedReviews:0};}};
 await vm.runInNewContext(js,lockedModules,{filename:'actual-mlb-stale-original-lock-scope.offline.cjs'});assert.equal(digest(lockedSnapshot.data.props.find((r:any)=>r.providerIds?.gameId===packetB.gameId)),lockedBytes);assert(lockedSnapshot.validation.publishable,'Old stale locked B cannot reject current known A');
 const staleA={...A[0],lastUpdated:staleLockedB.lastUpdated};assert(validate([staleA],null).errors.includes('STALE_ODDS_PRESENT'),'An unlocked stale quote remains a hard refusal');assert.equal(digest(staleLockedB),lockedBytes);
 console.log('MLB partial authority passed: actual two-game writer preserves prior source, publishes only timely knownA, unknownB cannot create first-lock across restart, knownB recovers twoAIrows/first-lock; actual100→20 scope comparison and retained contraction/actionable negatives.');
 console.log('Actual MLB writer handoff passed: shipped callback block→actual canonical publication/index/cutoff reader→actual game lock→actual prune/retained exact member lock; true clocks, ordinary visibility/head guards, duplicate callback collapse, late unrelated return and zero provider calls. All DB/HTTP mocked.');
 }finally{for(const n of envNames){if(originals[n]===undefined)Reflect.deleteProperty(process.env,n);else Object.assign(process.env,{[n]:originals[n]});}}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
