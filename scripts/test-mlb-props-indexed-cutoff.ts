/* eslint-disable @typescript-eslint/no-explicit-any -- Deliberately malformed private index/transport fixtures exercise the actual store and first-lock reader. */
/** Future R2 source authority only; original R1/unindexed payloads stay exact.
 * Actual publisher, cutoff/by-ID readers, lock writer and display reader; fake I/O. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import * as publicationPolicy from '../lib/mlb/props/aiPublicationPolicy';
import * as marketEvidence from '../lib/mlb/props/marketEvidenceCapture';
import * as ordering from '../lib/mlb/props/releaseOrdering';
import * as lockPolicy from '../lib/mlb/props/lockPolicy';
import * as settlement from '../lib/mlb/props/settlement';
import * as pricePolicy from '../lib/mlb/props/pricePolicy';
import * as versions from '../lib/mlb/props/marketModelVersions';
import {digest} from '../lib/playerPropsAi/evidence';
import {native,at,lock} from './test-player-props-ai-mlb-event-settlement';
import type {MlbPropsBoardSnapshot} from '../lib/mlb/props/boardSnapshotStore';

globalThis.fetch=async()=>{throw Error('Indexed cutoff controls forbid HTTP/provider/model/SQL');};
const slateDate='2030-06-01';
function fixture(){
 let tick=at,serial=0,indexError=false,indexOverflow=false,rawOverflow=false,indexInsertError=false;
 const warnings:string[]=[];
 const tables:Record<string,any[]>={prop_scoring_runs:[],admin_audit_log:[],mlb_prop_tracking_entries:[]};
 const boundedLookups:{ids:string[];limit:number}[]=[];
 const contains=(row:any,value:any):boolean=>Object.entries(value).every(([k,v])=>v&&typeof v==='object'?contains(row?.[k],v):row?.[k]===v);
 const client={from(table:string){assert(table in tables);const filters:((r:any)=>boolean)[]=[],orders:{key:string;ascending:boolean}[]=[];let offset=0,limit=Infinity,insert:any[]|null=null,deleting=false,ids:string[]|null=null;
  const query:any={select(){return query;},eq(k:string,v:any){filters.push(r=>r[k]===v);return query;},lte(k:string,v:any){filters.push(r=>r[k]<=v);return query;},not(k:string,_op:string,v:any){filters.push(r=>r[k]!==v&&r[k]!==undefined);return query;},contains(k:string,v:any){filters.push(r=>contains(r[k],v));return query;},in(k:string,values:any[]){filters.push(r=>values.includes(r[k]));if(table==='admin_audit_log'&&k==='target_id')ids=values;return query;},order(key:string,o:{ascending:boolean}){orders.push({key,ascending:o.ascending});return query;},limit(n:number){limit=n;return query;},range(from:number,to:number){offset=from;limit=to-from+1;return query;},insert(v:any){insert=Array.isArray(v)?v:[v];return query;},delete(){deleting=true;return query;},
   async execute(){
    if(insert){if(indexInsertError&&table==='admin_audit_log'&&insert[0]?.action_type==='mlb_props.board_snapshot_published'){indexInsertError=false;return{data:null,error:{message:'PRIVATE_INDEX_INSERT_ERROR'}};}const added=insert.map(r=>({...structuredClone(r),id:String(++serial),created_at:tick}));tables[table].push(...added);return{data:added,error:null};}
    if(rawOverflow&&table==='prop_scoring_runs'&&limit===12)return{data:Array(13).fill(tables[table].at(-1)),error:null};
    if(ids){assert(ids.length<=12);assert.equal(limit,13);boundedLookups.push({ids:[...ids],limit});if(indexError)return{data:null,error:{message:'synthetic cutoff index unavailable'}};if(indexOverflow)return{data:Array(13).fill({}),error:null};}
    let rows=tables[table].filter(r=>filters.every(f=>f(r)));for(const {key,ascending} of [...orders].reverse())rows.sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(ascending?1:-1));rows=rows.slice(offset,offset+limit);if(deleting)tables[table]=tables[table].filter(r=>!rows.includes(r));return{data:structuredClone(rows),error:null};
   },async single(){const r=await query.execute();return{...r,data:r.data?.[0]??null};},async maybeSingle(){return query.single();},then(resolve:any,reject:any){return query.execute().then(resolve,reject);}};return query;}};
 class Clock extends Date{constructor(value?:string|number){super(value??tick);}static now(){return Date.parse(tick);}}
 const env={NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1',SUPABASE_SERVICE_ROLE_KEY:'synthetic-never-real',ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED:'true',ODDSPHERE_PROPS_SNAPSHOT_RETENTION_PER_SLATE:'20'};
 function load(file:string,modules:Record<string,unknown>){const instance={exports:{}};const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(js,{module:instance,exports:instance.exports,Date:Clock,Buffer,console:{...console,warn:(...values:unknown[])=>warnings.push(values.map(String).join(' '))},process:{env},require:(name:string)=>{const key=name.split('/').at(-1)!;assert(key in modules,`Unmocked ${name}`);return modules[key];}});return instance.exports as any;}
 const store=load('lib/mlb/props/boardSnapshotStore.ts',{'node:crypto':crypto,'node:zlib':zlib,'supabase-js':{createClient:()=>client},aiPublicationPolicy:publicationPolicy,marketEvidenceCapture:marketEvidence,releaseOrdering:ordering});
 const tracking=load('lib/mlb/props/internalTracking.ts',{'node:crypto':crypto,'supabase-js':{createClient:()=>client},_mlbStatsApiClient:{},boardSnapshotStore:store,paperTrading:{},pricePolicy,marketModelVersions:versions,lockPolicy,providerClients:{},settlement});
 const snapshot=(id:string,time:string,release:string|undefined=publicationPolicy.MLB_PROPS_AI_HANDOFF_RELEASE,model='mlb_props_2030_06_01_r101')=>({schemaVersion:1,snapshotId:id,slateDate,asOfTimestamp:time,refreshMode:'fast',data:{date:slateDate,lastUpdated:time,props:[{...native,id:'row-'+id,projection:id==='prior'?1:2}],summary:{gamesWithProps:1,marketsAvailable:1},research:{}},validation:{publishable:true,sourceRows:1,mappedRows:1,actionableRows:0,errors:[],warnings:[]},movement:{},modelContext:{modelReleaseId:model,...(release?{aiHandoffRelease:release}:{}),probablePitcherSeasonStats:[]}} as unknown as MlbPropsBoardSnapshot);
 return{tables,boundedLookups,warnings,store,tracking,snapshot,clock:(at:string)=>{tick=at;},failIndexInsert:()=>{indexInsertError=true;},fault:(readError:boolean,overflow=false,raw=false)=>{indexError=readError;indexOverflow=overflow;rawOverflow=raw;}};
}
async function main(){
 const results=[];
 for(const mode of ['valid','missing','checksum','target','snapshot','slate','asof','model','before-row','late','invalid-clock','unknown-read','overflow','raw-overflow','no-eligible']){
  const f=fixture(),prior=f.snapshot('prior',at),final=f.snapshot('final','2030-06-01T19:00:00Z');
  await f.store.publishMlbPropsBoardSnapshot(prior);f.clock(final.asOfTimestamp);await f.store.publishMlbPropsBoardSnapshot(final);
  const index=f.tables.admin_audit_log.find(r=>r.after_state?.snapshot_id==='final')!;
  if(mode==='missing'||mode==='no-eligible')f.tables.admin_audit_log=f.tables.admin_audit_log.filter(r=>r!==index);
  if(mode==='checksum')index.after_state.payload_checksum='0'.repeat(64);
  if(mode==='target')index.target_id='unrelated-run';
  if(mode==='snapshot')index.after_state.snapshot_id='unrelated-snapshot';
  if(mode==='slate')index.after_state.slate_date='2030-06-02';
  if(mode==='asof')index.after_state.as_of_timestamp=at;
  if(mode==='model')index.after_state.model_release_id='mlb_props_2030_06_01_r102';
  if(mode==='before-row')index.created_at=at;
  if(mode==='late')index.created_at='2030-06-01T20:00:01Z';
  if(mode==='invalid-clock')index.created_at='invalid';
  if(mode==='unknown-read')f.fault(true);
  if(mode==='overflow')f.fault(false,true);
  if(mode==='raw-overflow')f.fault(false,false,true);
  if(mode==='no-eligible')f.tables.prop_scoring_runs=f.tables.prop_scoring_runs.filter(r=>f.store.decodeMlbPropsBoardSnapshot(r.metadata_json)?.snapshotId==='final');
  const originalRows=digest(f.tables.prop_scoring_runs);f.boundedLookups.length=0;
  if(mode==='unknown-read'||mode==='overflow'||mode==='raw-overflow'){
   await assert.rejects(f.store.loadMlbPropsBoardSnapshotAtOrBefore(slateDate,lock));assert.equal(f.boundedLookups.length,mode==='raw-overflow'?0:1);assert.equal(digest(f.tables.prop_scoring_runs),originalRows);results.push({mode,held:true});continue;
  }
  const selected=await f.store.loadMlbPropsBoardSnapshotAtOrBefore(slateDate,lock);
  assert.equal(selected?.snapshotId??null,mode==='valid'?'final':mode==='no-eligible'?null:'prior');assert.equal(f.boundedLookups.length,1);
  if(['checksum','target','snapshot','slate','asof','model','before-row','invalid-clock','missing','no-eligible'].includes(mode))assert.equal(await f.store.loadMlbPropsBoardSnapshotById(slateDate,'final'),null,'Malformed/missing R2 identity cannot become readable source authority');
  f.clock('2030-06-01T20:00:01Z');const locked=await f.tracking.ensureMlbPropsGameLocks(final,'2030-06-01T20:00:01Z');assert.equal(locked.created,selected?1:0);
  if(selected){
   assert.equal(locked.locks[0].board_snapshot_id,selected.snapshotId);assert(await f.store.loadMlbPropsBoardSnapshotById(slateDate,selected.snapshotId));
   const display=await f.store.applyMlbPropsDisplayLocks(final);assert.equal(display.data.props[0].lockStatus?.status,'locked');assert.equal(display.data.props[0].projection,selected.data.props[0].projection);
   const originalLocks=digest(await f.store.loadMlbPropsGameLocks(slateDate));await f.tracking.ensureMlbPropsGameLocks(final,'2030-06-01T20:01:00Z');assert.equal(digest(await f.store.loadMlbPropsGameLocks(slateDate)),originalLocks);
  }else assert.equal(f.tables.admin_audit_log.some(r=>r.action_type==='mlb_props.game_locked_t60'),false,'No eligible source creates no invented lock');
  assert.equal(digest(f.tables.prop_scoring_runs),originalRows);results.push({mode,selected:selected?.snapshotId??null});
 }
 // Legacy raw/unindexed cutoff authority is unchanged, including its historical
 // by-ID absence. This migration neither repairs nor reinterprets old records.
 for(const release of ['mlb_props_ai_handoff_2026_11_10_r1_ready_publication','']){
  const f=fixture(),legacy=f.snapshot('original-legacy',at,release);await f.store.publishMlbPropsBoardSnapshot(legacy);f.tables.admin_audit_log=[];
  const original=digest(f.tables.prop_scoring_runs),selected=await f.store.loadMlbPropsBoardSnapshotAtOrBefore(slateDate,lock);assert.equal(digest(selected),digest(legacy));assert.equal(f.boundedLookups.length,0);assert.equal(await f.store.loadMlbPropsBoardSnapshotById(slateDate,legacy.snapshotId),null);assert.equal(digest(f.tables.prop_scoring_runs),original);
 }
 for(const tag of ['mlb_props_ai_handoff_2030_06_01_r3_unsupported','',null,42]){
  const f=fixture(),original=f.snapshot('stored-unsupported',at);(original.modelContext as any).aiHandoffRelease=tag;
  await f.store.publishMlbPropsBoardSnapshot(original);const sourceBytes=digest(f.tables.prop_scoring_runs);
  assert.equal(await f.store.loadMlbPropsBoardSnapshotAtOrBefore(slateDate,lock),null,'An unsupported/malformed supplied tag never acquires legacy raw eligibility');
  assert.equal(digest(await f.store.loadMlbPropsBoardSnapshotById(slateDate,original.snapshotId)),digest(original),'Stored unsupported payloads retain opaque by-ID authority');
  // This is an original stored-lock fixture, not a new lock generated from an
  // unsupported source. New selection above correctly produced no candidate.
  const oldLock={slate_date:slateDate,external_game_id:native.providerIds!.gameId,game_start_timestamp:native.gameStartTime,lock_cutoff_timestamp:lock,board_snapshot_id:original.snapshotId,snapshot_as_of_timestamp:original.asOfTimestamp,locked_at:lock,model_release_id:original.modelContext!.modelReleaseId,originalOpaque:{kept:'exact'}};
  f.tables.admin_audit_log.push({id:'original-stored-lock',action_type:'mlb_props.game_locked_t60',target_table:'prop_scoring_runs',target_id:'original-lock',after_state:oldLock,created_at:lock});
  const oldLockBytes=digest(await f.store.loadMlbPropsGameLocks(slateDate));
  const later=f.snapshot('later', '2030-06-01T20:01:00Z');await f.tracking.ensureMlbPropsGameLocks(later,'2030-06-01T20:01:00Z');
  const display=await f.store.applyMlbPropsDisplayLocks(later);const {lockStatus,...storedRow}=display.data.props[0];assert.equal(lockStatus.status,'locked');assert.equal(digest(storedRow),digest(original.data.props[0]));
  assert.equal(digest(await f.store.loadMlbPropsGameLocks(slateDate)),oldLockBytes);assert.equal(digest(f.tables.prop_scoring_runs),sourceBytes);
 }
 const legacyError=fixture();legacyError.failIndexInsert();const legacy=legacyError.snapshot('legacy-returned-error',at,'mlb_props_ai_handoff_2026_11_10_r1_ready_publication');
 assert.equal(typeof await legacyError.store.publishMlbPropsBoardSnapshot(legacy),'string');assert.equal(legacyError.warnings.length,1,'Original legacy index error remains warn-and-success');assert.equal((await legacyError.store.loadMlbPropsBoardSnapshotAtOrBefore(slateDate,lock)).snapshotId,legacy.snapshotId);
 const futureError=fixture();futureError.failIndexInsert();await assert.rejects(futureError.store.publishMlbPropsBoardSnapshot(futureError.snapshot('future-returned-error',at)),(error:any)=>error?.name==='MlbPropsPublicationUncertainError');assert.equal(futureError.warnings.length,0,'Future R2 does not log raw index errors');assert.equal(futureError.tables.prop_scoring_runs.length,1);assert.equal(await futureError.store.loadMlbPropsBoardSnapshotAtOrBefore(slateDate,lock),null);
 const batch=fixture();for(let i=0;i<12;i++){const time=new Date(Date.parse(at)+i*60000).toISOString();batch.clock(time);await batch.store.publishMlbPropsBoardSnapshot(batch.snapshot('batch-'+i,time));}
 batch.boundedLookups.length=0;assert.equal((await batch.store.loadMlbPropsBoardSnapshotAtOrBefore(slateDate,lock)).snapshotId,'batch-11');assert.equal(batch.boundedLookups.length,1);assert.equal(batch.boundedLookups[0].ids.length,12);assert.equal(batch.boundedLookups[0].limit,13);
 console.log(JSON.stringify({futureR2IndexedCutoff:true,actualAppendIndexChecksumClockBinding:true,actualFirstLockAndMemberDisplay:true,legacyUnindexedContractUnchanged:true,unsupportedNewCutoffRefused:true,storedUnsupportedLocksOpaque:true,dynamicModelRelease:true,boundedExtraLookup:{requests:1,candidateIds:12,limit:13},results,realNetwork:0,realSql:0}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
