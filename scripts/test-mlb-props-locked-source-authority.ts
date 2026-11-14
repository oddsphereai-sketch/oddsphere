/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic storage and module boundaries exercise exact original locked authority without real I/O. */
/** Actual original lock sources remain first authority through index, display,
 * raw cache and fast member read paths. All I/O is mocked and forbidden. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import * as jsx from 'react/jsx-runtime';
import * as publicationPolicy from '../lib/mlb/props/aiPublicationPolicy';
import * as marketEvidence from '../lib/mlb/props/marketEvidenceCapture';
import * as ordering from '../lib/mlb/props/releaseOrdering';
import * as lockPolicy from '../lib/mlb/props/lockPolicy';
import * as settlement from '../lib/mlb/props/settlement';
import * as pricePolicy from '../lib/mlb/props/pricePolicy';
import * as versions from '../lib/mlb/props/marketModelVersions';
import * as memberPayload from '../lib/mlb/props/memberPayload';
import {digest} from '../lib/playerPropsAi/evidence';
import {native,at,lock} from './test-player-props-ai-mlb-event-settlement';
import type {MlbPropsBoardSnapshot} from '../lib/mlb/props/boardSnapshotStore';

globalThis.fetch=async()=>{throw Error('Indexed cutoff controls forbid HTTP/provider/model/SQL');};
const slateDate='2030-06-01';
function fixture(){
 let tick=at,serial=0;
 const faults={gameLocks:false,trackingRefs:false,byIdIndex:false,byIdSource:false,rejectRaw:false,nullInventory:false,unknownArray:"" as string,unknownBody:undefined as unknown};
 const reads:{table:string;limit:number;filters:Record<string,unknown>}[]=[];
 const warnings:string[]=[];
 const tables:Record<string,any[]>={prop_scoring_runs:[],admin_audit_log:[],mlb_prop_tracking_entries:[],lab_response_snapshots:[]};

 const contains=(row:any,value:any):boolean=>Object.entries(value).every(([k,v])=>v&&typeof v==='object'?contains(row?.[k],v):row?.[k]===v);
 const client={from(table:string){assert(table in tables);const filters:((r:any)=>boolean)[]=[],orders:{key:string;ascending:boolean}[]=[];let offset=0,limit=Infinity,insert:any[]|null=null,deleting=false,selected="";const captured:Record<string,unknown>={};
  const query:any={select(fields:string){selected=fields;return query;},eq(k:string,v:any){captured[k]=v;filters.push(r=>r[k]===v);return query;},lte(k:string,v:any){filters.push(r=>r[k]<=v);return query;},gt(k:string,v:any){filters.push(r=>r[k]>v);return query;},abortSignal(){return query;},async upsert(values:any){for(const row of Array.isArray(values)?values:[values]){tables[table]=tables[table].filter(r=>r.snapshot_key!==row.snapshot_key);tables[table].push(structuredClone(row));}return{data:null,error:null};},not(k:string,_op:string,v:any){filters.push(r=>r[k]!==v&&r[k]!==undefined);return query;},contains(k:string,v:any){captured[k]=v;filters.push(r=>contains(r[k],v));return query;},in(k:string,values:any[]){filters.push(r=>values.includes(r[k]));return query;},order(key:string,o:{ascending:boolean}){orders.push({key,ascending:o.ascending});return query;},limit(n:number){limit=n;return query;},range(from:number,to:number){offset=from;limit=to-from+1;return query;},insert(v:any){insert=Array.isArray(v)?v:[v];return query;},delete(){deleting=true;return query;},
   async execute(){
    reads.push({table,limit,filters:structuredClone(captured)});
    const unknown=faults.unknownArray;
    if(unknown==='current-index'&&table==='admin_audit_log'&&captured.action_type==='mlb_props.board_snapshot_published'&&limit===100
      ||unknown==='recent-sources'&&table==='prop_scoring_runs'&&selected==='metadata_json'&&!captured.id
      ||unknown==='schedule'&&table==='admin_audit_log'&&captured.action_type==='mlb_props.board_snapshot_published'&&selected==='after_state'&&limit===10
      ||unknown==='by-id-index'&&table==='admin_audit_log'&&(captured.after_state as any)?.snapshot_id)return{data:faults.unknownBody,error:null};
    if(faults.nullInventory&&captured.action_type==='mlb_props.game_locked_t60')return{data:null,error:null};
    if(faults.gameLocks&&captured.action_type==='mlb_props.game_locked_t60'||faults.trackingRefs&&table==='mlb_prop_tracking_entries'||faults.byIdIndex&&table==='admin_audit_log'&&(captured.after_state as any)?.snapshot_id||faults.byIdSource&&table==='prop_scoring_runs'&&captured.id){if(faults.rejectRaw)throw Error('PRIVATE_STORAGE_DETAILS_MUST_NOT_ESCAPE');return{data:null,error:{message:'synthetic lock authority unavailable'}};}
    if(insert){const added=insert.map(r=>({...structuredClone(r),id:String(++serial),created_at:tick}));tables[table].push(...added);return{data:added,error:null};}
    let rows=tables[table].filter(r=>filters.every(f=>f(r)));for(const {key,ascending} of [...orders].reverse())rows.sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(ascending?1:-1));rows=rows.slice(offset,offset+limit);if(deleting)tables[table]=tables[table].filter(r=>!rows.includes(r));return{data:structuredClone(rows),error:null};
   },async single(){const r=await query.execute();return{...r,data:r.data?.[0]??null};},async maybeSingle(){return query.single();},then(resolve:any,reject:any){return query.execute().then(resolve,reject);}};return query;}};
 class Clock extends Date{constructor(value?:string|number){super(value??tick);}static now(){return Date.parse(tick);}}
 const env={NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1',SUPABASE_SERVICE_ROLE_KEY:'synthetic-never-real',ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED:'true',ODDSPHERE_PROPS_SNAPSHOT_RETENTION_PER_SLATE:'20'};
 function load(file:string,modules:Record<string,unknown>){const instance={exports:{}};const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(js,{module:instance,exports:instance.exports,Date:Clock,Buffer,AbortSignal,URL,Request,Response,console:{...console,warn:(...values:unknown[])=>warnings.push(values.map(String).join(' '))},process:{env},require:(name:string)=>{const key=name.split('/').at(-1)!;assert(key in modules,`Unmocked ${name}`);return modules[key];}});return instance.exports as any;}
 const store=load('lib/mlb/props/boardSnapshotStore.ts',{'node:crypto':crypto,'node:zlib':zlib,'supabase-js':{createClient:()=>client},aiPublicationPolicy:publicationPolicy,marketEvidenceCapture:marketEvidence,releaseOrdering:ordering});
 const member=load('lib/mlb/props/memberReadSnapshotStore.ts',{supabase:{supabase:client},boardSnapshotStore:store,memberPayload,marketModelVersions:versions,releaseOrdering:ordering,marketEvidenceCapture:marketEvidence});
 const tracking=load('lib/mlb/props/internalTracking.ts',{'node:crypto':crypto,'supabase-js':{createClient:()=>client},_mlbStatsApiClient:{},boardSnapshotStore:store,paperTrading:{},pricePolicy,marketModelVersions:versions,lockPolicy,providerClients:{},settlement});
 const snapshot=(id:string,time:string,release:string|undefined=publicationPolicy.MLB_PROPS_AI_HANDOFF_RELEASE,model='mlb_props_2030_06_01_r101')=>({schemaVersion:1,snapshotId:id,slateDate,asOfTimestamp:time,refreshMode:'fast',data:{date:slateDate,lastUpdated:time,props:[{...native,id:'row-'+id,projection:id==='prior'?1:2}],summary:{gamesWithProps:1,marketsAvailable:1},research:{}},validation:{publishable:true,sourceRows:1,mappedRows:1,actionableRows:0,errors:[],warnings:[]},movement:{},modelContext:{modelReleaseId:model,...(release?{aiHandoffRelease:release}:{}),probablePitcherSeasonStats:[]}} as unknown as MlbPropsBoardSnapshot);
 return{load,tables,reads,store,tracking,member,snapshot,clock:(at:string)=>{tick=at;},faults};
}

const legacy='mlb_props_ai_handoff_2026_11_10_r1_ready_publication';
const rowGame=(row:any)=>row.providerIds?.gameId;
function originalLock(f:ReturnType<typeof fixture>,snapshot:MlbPropsBoardSnapshot,gameId=rowGame(snapshot.data.props[0])){
 const pointer={slate_date:slateDate,external_game_id:gameId,game_start_timestamp:native.gameStartTime,lock_cutoff_timestamp:lock,board_snapshot_id:snapshot.snapshotId,snapshot_as_of_timestamp:snapshot.asOfTimestamp,locked_at:lock,model_release_id:snapshot.modelContext!.modelReleaseId,opaqueHistoricalLock:{kept:'exact'}};
 f.tables.admin_audit_log.push({id:'stored-lock-'+gameId,action_type:'mlb_props.game_locked_t60',target_table:'prop_scoring_runs',target_id:gameId,after_state:pointer,created_at:lock});return pointer;
}
const laterSnapshot=(f:ReturnType<typeof fixture>)=>{const next=f.snapshot('mutable-later','2030-06-01T20:01:00Z');next.data.props[0]={...next.data.props[0],projection:999,finalProbability:.001,odds:-900,units:99,playGrade:'NO_PLAY'};return next;};
const exact=(left:unknown,right:unknown,message:string)=>assert.equal(digest(left),digest(right),message);
async function main(){
 let cases=0;
 for(const era of [undefined,legacy,publicationPolicy.MLB_PROPS_AI_HANDOFF_RELEASE,'old-unknown-handoff']){
  const f=fixture(),source=f.snapshot('original',at,era);if(era===undefined)delete source.modelContext!.aiHandoffRelease;
  source.data.props=[{...source.data.props[0],opaqueOriginal:{kept:['exact',null,13]},marketEvidenceId:'old-opaque-reference'} as any];
  await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);const bytes=digest(f.tables),later=laterSnapshot(f);
  const display=await f.store.applyMlbPropsDisplayLocks(later),{lockStatus,...read}=display.data.props[0];exact(read,source.data.props[0],'Original row fields retained');assert.equal(lockStatus.status,'locked');
  for(let i=0;i<500;i++)f.tables.admin_audit_log.push({id:'unrelated-'+i,action_type:'mlb_props.board_snapshot_published',target_table:'prop_scoring_runs',target_id:'unrelated-'+i,after_state:{slate_date:'2030-06-02',snapshot_id:'noise-'+i},created_at:'2030-06-02T21:00:00Z'});
  exact(await f.store.loadMlbPropsBoardSnapshotById(slateDate,source.snapshotId),source,'Unrelated publications cannot hide exact original');
  const indexedRead=f.reads.filter(r=>r.table==='admin_audit_log'&&(r.filters.after_state as any)?.snapshot_id===source.snapshotId).at(-1)!;assert.equal(indexedRead.limit,2);assert.deepEqual(indexedRead.filters.after_state,{slate_date:slateDate,snapshot_id:source.snapshotId});
  exact((await f.store.applyMlbPropsDisplayLocks(later)).data.props,display.data.props,'Historical locked rows remain exact beyond500 unrelated indices');
  assert.equal(bytes,digest({...f.tables,admin_audit_log:f.tables.admin_audit_log.filter(r=>!String(r.id).startsWith('unrelated-'))}),'Reader never mutates source/lock/table');cases++;
 }
 for(const mode of ['missing-index','missing-source','bad-checksum','wrong-snapshot','wrong-slate','ambiguous-index','game-lock-read','tracking-ref-read','by-id-index-read','by-id-source-read','empty-original-game','malformed-lock','legacy-malformed-ref','unknown-inventory','inventory-overflow']){
  const f=fixture(),source=f.snapshot('original',at,legacy);await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);const index=f.tables.admin_audit_log.find(r=>r.after_state?.snapshot_id===source.snapshotId)!;
  if(mode==='missing-index')f.tables.admin_audit_log=f.tables.admin_audit_log.filter(r=>r!==index);
  if(mode==='missing-source')f.tables.prop_scoring_runs=[];
  if(mode==='bad-checksum')f.tables.prop_scoring_runs[0].metadata_json.checksum='0'.repeat(64);
  if(mode==='wrong-snapshot'||mode==='wrong-slate'||mode==='empty-original-game'){const changed=structuredClone(source);if(mode==='wrong-snapshot')changed.snapshotId='different';if(mode==='wrong-slate')changed.slateDate='2030-06-02';if(mode==='empty-original-game')changed.data.props=[];f.tables.prop_scoring_runs[0].metadata_json=f.store.encodeMlbPropsBoardSnapshot(changed);}
  if(mode==='ambiguous-index')f.tables.admin_audit_log.push({...structuredClone(index),id:'ambiguous'});
  if(mode==='game-lock-read')f.faults.gameLocks=true;if(mode==='tracking-ref-read')f.faults.trackingRefs=true;if(mode==='by-id-index-read')f.faults.byIdIndex=true;if(mode==='by-id-source-read')f.faults.byIdSource=true;
  if(mode==='malformed-lock')f.tables.admin_audit_log.find(r=>r.action_type==='mlb_props.game_locked_t60')!.after_state.board_snapshot_id='';
  if(mode==='legacy-malformed-ref')f.tables.mlb_prop_tracking_entries.push({external_game_id:native.providerIds!.gameId,board_snapshot_id:null,locked_at:lock,slate_date:slateDate});
  if(mode==='unknown-inventory')f.tables.admin_audit_log.find(r=>r.action_type==='mlb_props.game_locked_t60')!.after_state.locked_at='not-a-clock';
  if(mode==='inventory-overflow'){const pointer=f.tables.admin_audit_log.find(r=>r.action_type==='mlb_props.game_locked_t60')!;for(let i=0;i<100;i++)f.tables.admin_audit_log.push({...structuredClone(pointer),id:'overflow-'+i});}
  const sourceBytes=digest(f.tables);await assert.rejects(()=>f.store.applyMlbPropsDisplayLocks(laterSnapshot(f)),/MLB props.*(?:unavailable|limit)/,mode);exact(f.tables,JSON.parse(JSON.stringify(f.tables)),'Serializable source records preserved');assert.equal(digest(f.tables),sourceBytes);cases++;
 }
 // The actual public display entrypoint must propagate unknown lock inventory.
 {const f=fixture(),source=f.snapshot('original',at,legacy);await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);f.clock('2030-06-01T20:01:00Z');await f.store.publishMlbPropsBoardSnapshot(laterSnapshot(f));f.faults.gameLocks=true;await assert.rejects(()=>f.store.loadLatestMlbPropsDisplaySnapshot(slateDate),/MLB props.*unavailable/);cases++;}
 // A pre-lock raw cache still rereads newly created immutable lock authority.
 {const f=fixture(),source=f.snapshot('original',at,legacy);await f.store.publishMlbPropsBoardSnapshot(source);f.clock(new Date(Date.parse(lock)-1000).toISOString());const cached=await f.store.loadCachedLatestMlbPropsDisplaySnapshot(slateDate);assert(!cached.data.props[0].lockStatus);const reads=f.reads.filter(r=>r.table==='prop_scoring_runs'&&!r.filters.id).length;originalLock(f,source);f.clock(new Date(Date.parse(lock)+1000).toISOString());const locked=await f.store.loadCachedLatestMlbPropsDisplaySnapshot(slateDate);assert.equal(locked.data.props[0].lockStatus.status,'locked');assert.equal(locked.data.props[0].projection,source.data.props[0].projection);assert.equal(f.reads.filter(r=>r.table==='prop_scoring_runs'&&!r.filters.id).length,reads,'Raw current board remained coalesced');f.faults.gameLocks=true;await assert.rejects(()=>f.store.loadCachedLatestMlbPropsDisplaySnapshot(slateDate),/MLB props.*unavailable/);cases++;}
 // Stored pitcher/team contradictions and opaque old lock fields cannot be
 // reinterpreted through current coherence rules. Duplicate source rows survive.
 {const f=fixture(),source=f.snapshot('original',at,legacy);const row:any={...source.data.props[0],player:'Original Pitcher',team:'NYY',opponent:'BOS',marketFamily:'pitcher',lockStatus:{status:'locked',lockedAt:'2029-01-01T00:00:00Z',opaqueClock:true},opaqueEvidence:{exact:'stored'},researchKey:'original'};source.data.props=[row,structuredClone(row)];source.data.slate={matchups:[{gameStartTime:row.gameStartTime,awayTeam:'NYY',homeTeam:'BOS',awayProbablePitcher:'Other',homeProbablePitcher:'Original Pitcher'}]} as any;source.data.research={original:{opaqueResearch:'stored'}} as any;await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);const bytes=digest(f.tables),display=await f.store.applyMlbPropsDisplayLocks(laterSnapshot(f));exact(display.data.props,source.data.props,'Every original locked row and duplicate/opaque lock field retains precedence');exact(display.data.research,source.data.research,'Original research overrides mutable research');assert.equal(digest(f.tables),bytes);cases++;}
 // An already stored opaque locked row is first authority even on an older
 // snapshot with no separate game-lock index. Current team coherence applies
 // only to unlocked live materialization.
 {const f=fixture(),source=f.snapshot('opaque-latest',at,legacy);const row:any={...source.data.props[0],player:'Original Pitcher',team:'NYY',opponent:'BOS',marketFamily:'pitcher',lockStatus:{status:'locked',lockedAt:'2029-01-01T00:00:00Z',opaqueClock:true},opaqueOriginal:'exact'};source.data.props=[row];source.data.slate={matchups:[{gameStartTime:row.gameStartTime,awayTeam:'NYY',homeTeam:'BOS',awayProbablePitcher:'Other',homeProbablePitcher:'Original Pitcher'}]} as any;exact(await f.store.applyMlbPropsDisplayLocks(source),source,'Opaque already locked latest row precedes current team filter');cases++;}
 // Incomplete original rows in one game never authorize its mutable replacement,
 // even when another game's original source is completely readable.
 {const f=fixture(),source=f.snapshot('original',at,legacy);await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);originalLock(f,source,'unrepresented-game');await assert.rejects(()=>f.store.applyMlbPropsDisplayLocks(laterSnapshot(f)),/locked source.*unavailable/);cases++;}
 // Actual member cached entrypoints: pre-lock publication must be rejected when
 // a first lock appears without a new canonical head/release. Root owns guard.
 {const f=fixture(),source=f.snapshot('original',at,legacy,versions.MLB_PROPS_MODEL_RELEASE_ID);await f.store.publishMlbPropsBoardSnapshot(source);f.clock(new Date(Date.parse(lock)-1000).toISOString());await f.member.publishMlbPropsMemberReadSnapshots(source,{forceFull:true});const playerId=source.data.props[0].providerIds!.mlbStatsPlayerId!;assert(await f.member.loadMlbPropsMemberBoardSnapshot(slateDate));assert(await f.member.loadMlbPropsPlayerReadSnapshot(slateDate,playerId));originalLock(f,source);f.clock(new Date(Date.parse(lock)+1000).toISOString());assert.equal(await f.member.loadMlbPropsMemberBoardSnapshot(slateDate),null);assert.equal(await f.member.loadMlbPropsMemberBoardSnapshot(slateDate,true),null);assert.equal(await f.member.loadMlbPropsPlayerReadSnapshot(slateDate,playerId),null);const authoritative=await f.store.loadCachedLatestMlbPropsDisplaySnapshot(slateDate);assert.equal(authoritative.data.props[0].lockStatus.status,'locked');await f.member.publishMlbPropsMemberReadSnapshots(source,{forceFull:true});for(const member of [await f.member.loadMlbPropsMemberBoardSnapshot(slateDate),await f.member.loadMlbPropsMemberBoardSnapshot(slateDate,true)])assert.equal(member.data.props[0].lockStatus.status,'locked');assert.equal((await f.member.loadMlbPropsPlayerReadSnapshot(slateDate,playerId)).props[0].lockStatus.status,'locked');f.faults.gameLocks=true;await assert.rejects(()=>f.member.loadMlbPropsMemberBoardSnapshot(slateDate),/MLB props.*unavailable/);await assert.rejects(()=>f.member.loadMlbPropsPlayerReadSnapshot(slateDate,playerId),/MLB props.*unavailable/);cases++;}
 // A healthy mixed board keeps exact original locked rows and the unrelated
 // current game's still-unlocked rows. A later tuple cannot impersonate missing
 // original evidence when the stored locked reference has no archived tuple.
 {const f=fixture(),source=f.snapshot('original',at,legacy);source.data.props[0]={...source.data.props[0],marketEvidenceId:'original-evidence-id'} as any;await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);const later=laterSnapshot(f),unlocked={...native,id:'unrelated-unlocked',providerIds:{...native.providerIds!,gameId:'unlocked-game'},projection:77};later.data.props.push(unlocked);const captured=marketEvidence.buildMlbPropsMarketEvidenceCapture({rows:[{...later.data.props[0],marketEvidenceId:'original-evidence-id'}],contexts:new Map(),currentOdds:[],openingOdds:[],evaluatedAt:at,maximumQuoteAgeMinutes:45}).capture;const tuple:any=structuredClone(captured.i[0]);tuple[0]='original-evidence-id';later.marketEvidence={...captured,i:[tuple]};const bytes=digest(f.tables),display=await f.store.applyMlbPropsDisplayLocks(later);assert.equal(display.data.props.find((r:any)=>rowGame(r)===native.providerIds!.gameId).marketEvidenceId,'original-evidence-id');assert(!display.marketEvidence?.i.some((identity:any)=>identity[0]==='original-evidence-id'),'No current evidence attached to a missing original tuple');exact(display.data.props.find((r:any)=>rowGame(r)==='unlocked-game'),unlocked,'Unrelated current row unchanged');assert.equal(digest(f.tables),bytes);cases++;}
 // Referenced original tuples and unknown extra fields survive unchanged even
 // when a same-ID current tuple carries a different output/opaque payload.
 {const f=fixture(),source=f.snapshot('original',at,legacy);const capture=marketEvidence.buildMlbPropsMarketEvidenceCapture({rows:source.data.props,contexts:new Map(),currentOdds:[],openingOdds:[],evaluatedAt:at,maximumQuoteAgeMinutes:45}).capture;source.data.props=marketEvidence.attachMlbPropsMarketEvidenceReferences(source.data.props,new Set(capture.i.map(i=>i[0])));const originalTuple:any=structuredClone(capture.i[0]);originalTuple.push({opaqueOldEvidence:'exact'});source.marketEvidence={...capture,i:[originalTuple]};await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);const later=laterSnapshot(f),newTuple:any=structuredClone(originalTuple);newTuple[5][1]=999;newTuple.at(-1).opaqueOldEvidence='CHANGED';later.marketEvidence={...capture,i:[newTuple]};const bytes=digest(f.tables),display=await f.store.applyMlbPropsDisplayLocks(later);exact(display.marketEvidence.i.find((t:any)=>t[0]===originalTuple[0]),originalTuple,'Original evidence tuple/opaque fields are first authority');assert.equal(digest(f.tables),bytes);cases++;}
 for(const rejection of [false,true]){const f=fixture(),source=f.snapshot('original',at,legacy);await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);f.faults.gameLocks=true;f.faults.rejectRaw=rejection;await assert.rejects(()=>f.store.applyMlbPropsDisplayLocks(laterSnapshot(f)),(error:any)=>error.message==='MLB props locked source authority unavailable.');cases++;}
 {const f=fixture();await f.store.publishMlbPropsBoardSnapshot(f.snapshot('original',at,legacy));f.faults.nullInventory=true;await assert.rejects(()=>f.store.loadCachedLatestMlbPropsDisplaySnapshot(slateDate),/MLB props.*unavailable/);cases++;}
 // Two distinct locked sources cannot silently overwrite the same opaque
 // research/evidence identity with different original values.
 for(const conflicting of ['research','evidence']){const f=fixture(),first=f.snapshot('first',at,legacy),second=f.snapshot('second','2030-06-01T19:00:00Z',legacy);second.data.props[0]={...second.data.props[0],id:'second-row',providerIds:{...second.data.props[0].providerIds!,gameId:'second-game'}};if(conflicting==='research'){first.data.props[0].researchKey=second.data.props[0].researchKey='same-opaque-research';first.data.research={'same-opaque-research':{original:1}} as any;second.data.research={'same-opaque-research':{original:2}} as any;}else{const capture=marketEvidence.buildMlbPropsMarketEvidenceCapture({rows:first.data.props,contexts:new Map(),currentOdds:[],openingOdds:[],evaluatedAt:at,maximumQuoteAgeMinutes:45}).capture;const id=capture.i[0][0];(first.data.props[0] as any).marketEvidenceId=(second.data.props[0] as any).marketEvidenceId=id;first.marketEvidence=capture;const tuple:any=structuredClone(capture.i[0]);tuple[5][1]=999;second.marketEvidence={...capture,i:[tuple]};}await f.store.publishMlbPropsBoardSnapshot(first);f.clock(second.asOfTimestamp);await f.store.publishMlbPropsBoardSnapshot(second);originalLock(f,first);originalLock(f,second,'second-game');const bytes=digest(f.tables);await assert.rejects(()=>f.store.applyMlbPropsDisplayLocks(laterSnapshot(f)),/MLB props.*unavailable/);assert.equal(digest(f.tables),bytes);cases++;}
 // Actual page and board/player API modules use the fresh member guard and
 // the corrected canonical fallback. Unknown lock inventory cannot return a
 // mutable board through either the fast or scoped endpoint.
 {const f=fixture(),source=f.snapshot('public-original',at,legacy,versions.MLB_PROPS_MODEL_RELEASE_ID);await f.store.publishMlbPropsBoardSnapshot(source);f.clock(new Date(Date.parse(lock)-1000).toISOString());await f.member.publishMlbPropsMemberReadSnapshots(source,{forceFull:true});
  const Dashboard=()=>null,Frame=()=>null;const common:any={boardSnapshotStore:f.store,memberReadSnapshotStore:f.member,memberPayload,liveBoard:{easternSlateDate:()=>slateDate,mlbPropsSnapshotIsFresh:()=>true},publicPicksSafety:{getPublicPicksMode:()=>({mode:'display_enabled'})},productExperience:{isPlayerPropsExperienceCandidateEnabled:()=>false,isProductExperiencePreviewAvailable:()=>false},livePreviewStore:{loadMlbPropsLivePreviewSnapshot:()=>{throw Error('No public preview');}},ProductAppFrame:{default:Frame,__esModule:true},PlayerPropsDashboard:{PlayerPropsDashboard:Dashboard},PlayerPropsLeaguePills:{PlayerPropsLeaguePills:()=>null},memberDataAvailability:{readMemberDataWithDeadline:async(args:any)=>{try{return{value:await args.read(),unavailable:false};}catch{return{value:args.fallback,unavailable:true};}}},'jsx-runtime':jsx};
  const picks=f.load('app/api/mlb/props/picks/route.ts',common),player=f.load('app/api/mlb/props/player/[player_id]/route.ts',common),page=f.load('app/mlb/props/page.tsx',common);const playerId=source.data.props[0].providerIds!.mlbStatsPlayerId!;
  originalLock(f,source);f.clock(new Date(Date.parse(lock)+1000).toISOString());
  for(const query of ['', '?game_id='+native.providerIds!.gameId]){const response=await picks.GET(new Request('https://offline.invalid/api/mlb/props/picks'+query));assert.equal(response.status,200);const body=await response.json();assert.equal(body.board.props[0].lockStatus.status,'locked');assert.equal(body.board.props[0].projection,source.data.props[0].projection);}
  const response=await player.GET(new Request('https://offline.invalid/api/mlb/props/player/'+playerId),{params:Promise.resolve({player_id:playerId})});const body=await response.json();assert.equal(body.props[0].lockStatus.status,'locked');assert.equal(body.props[0].projection,source.data.props[0].projection);
  const find=(value:any):any=>!value||typeof value!=='object'?null:Array.isArray(value)?value.map(find).find(Boolean)??null:value.type===Dashboard?value:find(value.props?.children);const healthy=find(await page.default({searchParams:Promise.resolve({})}));assert(healthy);assert.equal(healthy.props.data.props[0].lockStatus.status,'locked');
  f.faults.gameLocks=true;f.faults.rejectRaw=true;
  for(const query of ['', '?game_id='+native.providerIds!.gameId])await assert.rejects(()=>picks.GET(new Request('https://offline.invalid/api/mlb/props/picks'+query)),(error:any)=>error.message==='MLB props locked source authority unavailable.');
  await assert.rejects(()=>player.GET(new Request('https://offline.invalid/api/mlb/props/player/'+playerId),{params:Promise.resolve({player_id:playerId})}),(error:any)=>error.message==='MLB props locked source authority unavailable.');
  const unavailable=await page.default({searchParams:Promise.resolve({})});assert.equal(find(unavailable),null);assert(JSON.stringify(unavailable).includes('Player Props data is temporarily unavailable.'));assert(!JSON.stringify(unavailable).includes('PRIVATE_STORAGE'));cases++;
 }
 // Every array-select reader treats unknown transport bodies as unavailable,
 // including current/head/history/schedule/by-ID paths, not just first locks.
 for(const reader of ['current-index','release-head','recent-sources','schedule','by-id-index'])for(const body of [null,undefined,{},'not-an-array',false,0]){
  const f=fixture(),source=f.snapshot('unknown-array-source',at,legacy);await f.store.publishMlbPropsBoardSnapshot(source);const before=digest(f.tables);
  f.faults.unknownArray=reader==='release-head'?'current-index':reader;f.faults.unknownBody=body;
  const read=reader==='current-index'?()=>f.store.loadLatestMlbPropsBoardSnapshot(slateDate):reader==='release-head'?()=>f.store.loadHighestIndexedMlbPropsReleaseHead(slateDate):reader==='recent-sources'?()=>f.store.loadRecentMlbPropsBoardSnapshots(slateDate):reader==='schedule'?()=>f.store.loadLatestMlbPropsGameLockSchedule(slateDate):()=>f.store.loadMlbPropsBoardSnapshotById(slateDate,source.snapshotId);
  await assert.rejects(read,/MLB props.*unavailable/,'Unknown array transport cannot prove empty authority');assert.equal(digest(f.tables),before);cases++;
 }
 // A missing original module remains missing even when the current source
 // has the identical research key. Optional legacy null/false/zero are own
 // original values, not permission to substitute current statistics.
 for(const mode of ['missing-dictionary','missing-key','present','null','false','zero']){
  const f=fixture(),source=f.snapshot('research-original',at,legacy),key='original-research';source.data.props[0].researchKey=key;
  const original:any=mode==='present'?{recentForm:{logs:[{value:2}]},opaque:'ORIGINAL'}:mode==='null'?null:mode==='false'?false:0;
  if(mode==='missing-dictionary')delete source.data.research;else source.data.research=mode==='missing-key'?{}:{[key]:original};
  await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);const bytes=digest(f.tables),later=laterSnapshot(f);
  const current:any={recentForm:{logs:[{value:999}]},opaque:'CURRENT_NOT_ORIGINAL'};later.data.research={[key]:current,'current-only':current};later.data.props.push({...native,id:'current-only-row',researchKey:'current-only',providerIds:{...native.providerIds!,gameId:'current-only-game'},projection:77});
  const display=await f.store.applyMlbPropsDisplayLocks(later),missing=mode.startsWith('missing');
  assert.equal(Object.hasOwn(display.data.research,key),!missing,'Original own-property absence/presence survives');if(!missing)exact(display.data.research[key],original,'Original opaque research value survives');
  exact(display.data.research['current-only'],current,'Unrelated current research is unchanged');assert.equal(display.data.props.length,2,'No valid row count change');
  const {lockStatus,...row}=display.data.props.find((r:any)=>r.researchKey===key);exact(row,source.data.props[0],'Original stored row/key remain exact');assert.equal(lockStatus.status,'locked');assert.equal(digest(f.tables),bytes);cases++;
 }
 // Property lookup may stringify an opaque legacy key, but the public row
 // retains its exact original key type/value. Prototype-shaped keys are own
 // dictionary identities, not an inherited/current module fallback.
 for(const [key,present] of [[42,false],['__proto__',false],[42,true]] as const){
  const f=fixture(),source=f.snapshot('opaque-research-key',at,legacy);(source.data.props[0] as any).researchKey=key;source.data.research=present?Object.fromEntries([[String(key),false]]) as any:{};await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);const bytes=digest(f.tables),later=laterSnapshot(f);later.data.research=Object.fromEntries([[String(key),{opaque:'CURRENT_NOT_ORIGINAL'}]]) as any;const display=await f.store.applyMlbPropsDisplayLocks(later);assert.equal(display.data.props[0].researchKey,key);assert.equal(Object.hasOwn(display.data.research,String(key)),present);if(present)assert.equal(display.data.research[String(key)],false);assert.equal(digest(f.tables),bytes);cases++;
 }
 // Opaque reference keys use JavaScript dictionary lookup without truthiness:
 // zero, false and an empty string reserve original presence and absence.
 for(const key of [0,false,""])for(const mode of ['missing','present','null','false','zero']){
  const f=fixture(),source=f.snapshot('falsy-original-key',at,legacy);(source.data.props[0] as any).researchKey=key;
  const original=mode==='present'?{recentForm:{logs:[{value:2}]},opaque:'ORIGINAL'}:mode==='null'?null:mode==='false'?false:0;
  source.data.research=mode==='missing'?{}:Object.fromEntries([[String(key),original]]) as any;
  await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);const bytes=digest(f.tables),later=laterSnapshot(f);
  later.data.research=Object.fromEntries([[String(key),{recentForm:{logs:[{value:999}]},opaque:'CURRENT_NOT_ORIGINAL'}]]) as any;
  const display=await f.store.applyMlbPropsDisplayLocks(later);assert.equal(display.data.props[0].researchKey,key,'Original opaque key type/value is never rewritten');
  assert.equal(Object.hasOwn(display.data.research,String(key)),mode!=='missing','Original falsy-key own presence remains authority');
  if(mode!=='missing')exact(display.data.research[String(key)],original,'Original falsy-key opaque value remains authority');assert.equal(digest(f.tables),bytes);cases++;
 }
 // Null/undefined denote absence of a reference; do not invent dictionary keys
 // named "null" or "undefined" from those non-references.
 for(const key of [null,undefined]){
  const f=fixture(),source=f.snapshot('no-original-reference',at,legacy);(source.data.props[0] as any).researchKey=key;
  source.data.research=Object.fromEntries([[String(key),{opaque:'UNREFERENCED_OLD'}]]) as any;await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);const bytes=digest(f.tables),later=laterSnapshot(f),current={opaque:'UNRELATED_CURRENT'};
  later.data.research=Object.fromEntries([[String(key),current]]) as any;const display=await f.store.applyMlbPropsDisplayLocks(later);assert.equal(display.data.props[0].researchKey,key);exact(display.data.research[String(key)],current,'No guessed null/undefined research reference');assert.equal(digest(f.tables),bytes);cases++;
 }
 for(const order of [false,true]){
  const f=fixture(),missing=f.snapshot('missing-original',at,legacy),present=f.snapshot('present-original','2030-06-01T19:00:00Z',legacy),key='ambiguous-original-key';missing.data.props[0].researchKey=key;missing.data.research={};present.data.props[0]={...present.data.props[0],researchKey:key,providerIds:{...native.providerIds!,gameId:'other-locked-game'}};present.data.research={[key]:{recentForm:{logs:[{value:3}]},opaque:'PRESENT'}} as any;
  await f.store.publishMlbPropsBoardSnapshot(missing);f.clock(present.asOfTimestamp);await f.store.publishMlbPropsBoardSnapshot(present);
  for(const source of order?[present,missing]:[missing,present])originalLock(f,source);
  const bytes=digest(f.tables);await assert.rejects(()=>f.store.applyMlbPropsDisplayLocks(laterSnapshot(f)),/MLB props.*unavailable/,'Missing versus present original modules sharing one key are conflicting authority');assert.equal(digest(f.tables),bytes);cases++;
 }
 // Actual canonical-to-member serialization and public page/API reads do not
 // reintroduce a module that was absent from the locked source.
 {const f=fixture(),source=f.snapshot('missing-research-original',at,legacy,versions.MLB_PROPS_MODEL_RELEASE_ID),key='original-missing-research';source.data.props[0].researchKey=key;source.data.research={};await f.store.publishMlbPropsBoardSnapshot(source);originalLock(f,source);f.clock('2030-06-01T20:01:00Z');
  const later=laterSnapshot(f);later.modelContext!.modelReleaseId=versions.MLB_PROPS_MODEL_RELEASE_ID;later.data.research={[key]:{recentForm:{logs:[{value:999}]},opponentProfile:null,pitchArsenal:null,pitchMatchup:{},matchupHistory:{},environment:{},opaque:'CURRENT_NOT_ORIGINAL'}} as any;await f.store.publishMlbPropsBoardSnapshot(later);const before=digest(f.tables.prop_scoring_runs),originalLocks=digest(f.tables.admin_audit_log.filter(r=>r.action_type==='mlb_props.game_locked_t60'));
  await f.member.publishMlbPropsMemberReadSnapshots(later,{forceFull:true});const playerId=source.data.props[0].providerIds!.mlbStatsPlayerId!;
  for(const payload of [await f.member.loadMlbPropsMemberBoardSnapshot(slateDate),await f.member.loadMlbPropsMemberBoardSnapshot(slateDate,true)]){assert.equal(payload.data.props[0].projection,source.data.props[0].projection);assert(!payload.data.research||!Object.hasOwn(payload.data.research,key));}
  const serializedPlayer=await f.member.loadMlbPropsPlayerReadSnapshot(slateDate,playerId);assert(!Object.hasOwn(serializedPlayer.research,key));assert.equal(serializedPlayer.props[0].lockStatus.status,'locked');
  const Dashboard=()=>null,Frame=()=>null,common:any={boardSnapshotStore:f.store,memberReadSnapshotStore:f.member,memberPayload,liveBoard:{easternSlateDate:()=>slateDate,mlbPropsSnapshotIsFresh:()=>true},publicPicksSafety:{getPublicPicksMode:()=>({mode:'display_enabled'})},productExperience:{isPlayerPropsExperienceCandidateEnabled:()=>false,isProductExperiencePreviewAvailable:()=>false},livePreviewStore:{loadMlbPropsLivePreviewSnapshot:()=>{throw Error('No public preview');}},ProductAppFrame:{default:Frame,__esModule:true},PlayerPropsDashboard:{PlayerPropsDashboard:Dashboard},PlayerPropsLeaguePills:{PlayerPropsLeaguePills:()=>null},memberDataAvailability:{readMemberDataWithDeadline:async(args:any)=>{try{return{value:await args.read(),unavailable:false};}catch{return{value:args.fallback,unavailable:true};}}},'jsx-runtime':jsx};
  const picks=f.load('app/api/mlb/props/picks/route.ts',common),player=f.load('app/api/mlb/props/player/[player_id]/route.ts',common),page=f.load('app/mlb/props/page.tsx',common);
  for(const query of ['', '?game_id='+native.providerIds!.gameId]){const response=await picks.GET(new Request('https://offline.invalid/api/mlb/props/picks'+query));const body=await response.json();assert.equal(body.board.props[0].projection,source.data.props[0].projection);assert(!body.board.research||!Object.hasOwn(body.board.research,key));}
  const response=await player.GET(new Request('https://offline.invalid/api/mlb/props/player/'+playerId),{params:Promise.resolve({player_id:playerId})}),body=await response.json();assert.equal(body.props[0].projection,source.data.props[0].projection);assert(!Object.hasOwn(body.research,key));
  const find=(value:any):any=>!value||typeof value!=='object'?null:Array.isArray(value)?value.map(find).find(Boolean)??null:value.type===Dashboard?value:find(value.props?.children),render=find(await page.default({searchParams:Promise.resolve({})}));assert(render);assert(!render.props.data.research||!Object.hasOwn(render.props.data.research,key));assert.equal(render.props.data.props[0].lockStatus.status,'locked');
  assert.equal(digest(f.tables.prop_scoring_runs),before);assert.equal(digest(f.tables.admin_audit_log.filter(r=>r.action_type==='mlb_props.game_locked_t60')),originalLocks);cases++;
 }
 console.log(JSON.stringify({lockedSourceAuthority:true,cases,exactScopedIndexLimit:2,unrelatedIndexControl:500,rawCacheCannotBypassNewLock:true,fastMemberCannotBypassNewLock:true,legacyOpaqueRowsAndDuplicateLocks:true,realIO:0}));
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
