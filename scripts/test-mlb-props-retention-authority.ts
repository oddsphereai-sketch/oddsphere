/* eslint-disable @typescript-eslint/no-explicit-any -- Fault-injected actual module storage tests deliberately model unknown array responses. */
/** Actual publish/prune/cutoff/first-lock authority. All storage is in-memory;
 * optional frozen baseline is a private negative control, never production I/O. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import * as policy from '../lib/mlb/props/aiPublicationPolicy';
import * as marketEvidence from '../lib/mlb/props/marketEvidenceCapture';
import * as ordering from '../lib/mlb/props/releaseOrdering';
import * as lockPolicy from '../lib/mlb/props/lockPolicy';
import * as settlement from '../lib/mlb/props/settlement';
import * as pricePolicy from '../lib/mlb/props/pricePolicy';
import * as versions from '../lib/mlb/props/marketModelVersions';
import {digest} from '../lib/playerPropsAi/evidence';
import {native,at,lock} from './test-player-props-ai-mlb-event-settlement';
import type {MlbPropsBoardSnapshot} from '../lib/mlb/props/boardSnapshotStore';

globalThis.fetch=async()=>{throw Error('Retention controls forbid HTTP/provider/model/SQL');};
const slate='2030-06-01',legacy='mlb_props_ai_handoff_2026_11_10_r1_ready_publication';
type Family='sources'|'tracking'|'games'|'index'|'cutoff-index';
type Fault='null'|'undefined'|'malformed'|'bad-row'|'error'|'rejected'|'overflow'|'later-unknown'|'pagination-overflow';
const baselinePath=process.argv.find(a=>a.startsWith('--baseline-store='))?.slice('--baseline-store='.length);
const baseline=Boolean(process.argv.includes('--expect-baseline-unsafe'));
assert.equal(Boolean(baselinePath),baseline,'Baseline mode requires an explicit frozen source and negative-control flag');
function fixture(){
 let tick=at,serial=0,retentionPhase=false,retention='20';
 let fault:{family:Family;kind:Fault}|null=null;
 const deletes:string[][]=[],reads:{family:Family|null;offset:number;limit:number}[]=[];
 const tables:Record<string,any[]>={prop_scoring_runs:[],admin_audit_log:[],mlb_prop_tracking_entries:[]};
 const contains=(a:any,b:any):boolean=>Object.entries(b).every(([k,v])=>v&&typeof v==='object'?contains(a?.[k],v):a?.[k]===v);
 const client={from(table:string){assert(Object.hasOwn(tables,table),`Unexpected table ${table}`);const filters:((r:any)=>boolean)[]=[],orders:{key:string;ascending:boolean}[]=[];const captured:Record<string,unknown>={};let offset=0,limit=Infinity,columns='',insert:any[]|null=null,deleting=false;
  const q:any={select(value:string){columns=value;return q;},eq(k:string,v:any){captured[k]=v;filters.push(r=>r[k]===v);return q;},not(k:string,_op:string,v:any){filters.push(r=>r[k]!==v&&r[k]!==undefined);return q;},contains(k:string,v:any){captured[k]=v;filters.push(r=>contains(r[k],v));return q;},in(k:string,v:any[]){captured['in:'+k]=v;filters.push(r=>v.includes(r[k]));return q;},lte(k:string,v:any){filters.push(r=>r[k]<=v);return q;},order(key:string,o:{ascending:boolean}){orders.push({key,ascending:o.ascending});return q;},limit(n:number){limit=n;return q;},range(a:number,b:number){offset=a;limit=b-a+1;return q;},insert(v:any){insert=Array.isArray(v)?v:[v];return q;},delete(){deleting=true;return q;},
   async execute(){
    if(insert){const added=insert.map(v=>({...structuredClone(v),id:String(++serial),created_at:tick}));tables[table].push(...added);if(added.some(r=>r.action_type==='mlb_props.board_snapshot_published'&&r.after_state?.snapshot_id==='trigger-current'))retentionPhase=true;return{data:added,error:null};}
    const rows=tables[table].filter(r=>filters.every(f=>f(r)));for(const {key,ascending}of [...orders].reverse())rows.sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(ascending?1:-1));
    if(deleting){const selected=rows.slice(offset,offset+limit);deletes.push(selected.map(r=>String(r.id)));tables[table]=tables[table].filter(r=>!selected.includes(r));return{data:null,error:null};}
    const family:Family|null=captured['in:target_id']?'cutoff-index':retentionPhase?(table==='prop_scoring_runs'&&columns==='id,created_at'?'sources':table==='mlb_prop_tracking_entries'?'tracking':captured.action_type==='mlb_props.game_locked_t60'?'games':captured.action_type==='mlb_props.board_snapshot_published'?'index':null):null;
    reads.push({family,offset,limit});
    if(fault?.family===family){const kind=fault.kind;if(kind==='pagination-overflow'||kind==='later-unknown'&&offset===0){const row=rows[0]??{};return{data:Array.from({length:limit},()=>structuredClone(row)),error:null};}if(kind==='error')return{data:null,error:{message:'synthetic unavailable inventory'}};if(kind==='rejected')throw Error('synthetic rejected inventory');if(kind==='null'||kind==='later-unknown')return{data:null,error:null};if(kind==='undefined')return{data:undefined,error:null};if(kind==='malformed')return{data:{unknown:true},error:null};if(kind==='bad-row')return{data:[null],error:null};if(kind==='overflow')return{data:Array.from({length:limit+1},()=>structuredClone(rows[0]??{})),error:null};}
    return{data:structuredClone(rows.slice(offset,offset+limit)),error:null};
   },async single(){const r=await q.execute();return{...r,data:Array.isArray(r.data)?r.data[0]??null:r.data};},async maybeSingle(){return q.single();},then(a:any,b:any){return q.execute().then(a,b);}};return q;}};
 class Clock extends Date{constructor(value?:string|number){super(value??tick);}static now(){return Date.parse(tick);}}
 const env:Record<string,string>={NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1',SUPABASE_SERVICE_ROLE_KEY:'synthetic-never-real',ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED:'true'};
 Object.defineProperty(env,'ODDSPHERE_PROPS_SNAPSHOT_RETENTION_PER_SLATE',{get:()=>retention});
 function load(file:string,modules:Record<string,unknown>){const instance={exports:{}};const source=file.endsWith('/boardSnapshotStore.ts')&&baselinePath?readFileSync(baselinePath,'utf8'):readFileSync(file,'utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(js,{module:instance,exports:instance.exports,Date:Clock,Buffer,console,process:{env},require:(name:string)=>{const key=name.split('/').at(-1)!;assert(Object.hasOwn(modules,key),`Unmocked dependency ${name}`);return modules[key];}});return instance.exports as any;}
 const store=load('lib/mlb/props/boardSnapshotStore.ts',{'node:crypto':crypto,'node:zlib':zlib,'supabase-js':{createClient:()=>client},aiPublicationPolicy:policy,marketEvidenceCapture:marketEvidence,releaseOrdering:ordering});
 const tracking=load('lib/mlb/props/internalTracking.ts',{'node:crypto':crypto,'supabase-js':{createClient:()=>client},_mlbStatsApiClient:{},boardSnapshotStore:store,paperTrading:{},pricePolicy,marketModelVersions:versions,lockPolicy,providerClients:{},settlement});
 const snapshot=(id:string,time:string,release=legacy)=>({schemaVersion:1,snapshotId:id,slateDate:slate,asOfTimestamp:time,refreshMode:'fast',data:{date:slate,lastUpdated:time,props:[{...native,id:'row-'+id,projection:2}],summary:{gamesWithProps:1,marketsAvailable:1},research:{}},validation:{publishable:true,sourceRows:1,mappedRows:1,actionableRows:0,errors:[],warnings:[]},movement:{},modelContext:{modelReleaseId:'mlb_props_2030_06_01_r101',aiHandoffRelease:release,probablePitcherSeasonStats:[]}} as unknown as MlbPropsBoardSnapshot);
 const addRef=(source:MlbPropsBoardSnapshot,kind:'tracking'|'game',i=0)=>{if(kind==='tracking')tables.mlb_prop_tracking_entries.push({id:'legacy-ref-'+i,slate_date:slate,board_snapshot_id:source.snapshotId,external_game_id:native.providerIds!.gameId,locked_at:lock});else tables.admin_audit_log.push({id:'game-ref-'+i,created_at:lock,action_type:'mlb_props.game_locked_t60',target_table:'prop_scoring_runs',target_id:'game-ref-'+i,after_state:{slate_date:slate,external_game_id:native.providerIds!.gameId,game_start_timestamp:native.gameStartTime,lock_cutoff_timestamp:lock,board_snapshot_id:source.snapshotId,snapshot_as_of_timestamp:source.asOfTimestamp,locked_at:lock,model_release_id:source.modelContext!.modelReleaseId}});};
 return{store,tracking,tables,deletes,reads,snapshot,addRef,clock:(v:string)=>{tick=v;},fault:(family:Family,kind:Fault)=>{fault={family,kind};},retention:(n:number)=>{retention=String(n);},startRetention:()=>{retentionPhase=true;}};
}
async function retentionCase(family:Family|null,kind:Fault|null,reference:'tracking'|'game'|'both'|'none'='both'){
 const f=fixture(),source=f.snapshot('original-locked',at);await f.store.publishMlbPropsBoardSnapshot(source);f.clock('2030-06-01T18:00:00Z');await f.store.publishMlbPropsBoardSnapshot(f.snapshot('old-unreferenced','2030-06-01T18:00:00Z'));
 if(reference==='tracking'||reference==='both')f.addRef(source,'tracking');if(reference==='game'||reference==='both')f.addRef(source,'game');
 const originals=structuredClone(f.tables.prop_scoring_runs),refs=digest({tracking:f.tables.mlb_prop_tracking_entries,games:f.tables.admin_audit_log.filter(r=>r.action_type==='mlb_props.game_locked_t60')});
 f.retention(1);if(family&&kind)f.fault(family,kind);f.clock('2030-06-01T19:00:00Z');await f.store.publishMlbPropsBoardSnapshot(f.snapshot('trigger-current','2030-06-01T19:00:00Z'));
 const originalId=originals[0].id,present=f.tables.prop_scoring_runs.some(r=>r.id===originalId);
 if(!baseline){if(family)assert.equal(f.deletes.length,0,`${family}/${kind}: unknown inventory must skip all deletion`);else{assert.equal(present,reference!=='none');assert(f.deletes.flat().includes(String(originals[1].id)),'Known unreferenced old snapshot should prune');}if(reference!=='none')assert(present,`${family}/${kind}: original locked source must survive`);}
 for(const old of originals)if(f.tables.prop_scoring_runs.some(r=>r.id===old.id))assert.equal(digest(f.tables.prop_scoring_runs.find(r=>r.id===old.id)),digest(old),'Retained original source bytes/hash unchanged');
 assert.equal(digest({tracking:f.tables.mlb_prop_tracking_entries,games:f.tables.admin_audit_log.filter(r=>r.action_type==='mlb_props.game_locked_t60')}),refs,'Original lock/reference payloads unchanged');
 return{family,kind,reference,present,deletes:f.deletes.length};
}
async function main(){
 const results=[];
 if(baseline){for(const family of ['tracking','games'] as const){const r=await retentionCase(family,'null',family==='tracking'?'tracking':'game');assert.equal(r.present,false,'Original19aa negative control must independently expose deletion');results.push(r);}console.log(JSON.stringify({baselineUnsafeDeletionConfirmed:true,sourceSha256:crypto.createHash('sha256').update(readFileSync(baselinePath!)).digest('hex'),results,realIO:0}));return;}
 for(const family of ['sources','tracking','games','index'] as const)for(const kind of ['null','undefined','malformed','bad-row','error','rejected','overflow'] as const)results.push(await retentionCase(family,kind,family==='tracking'?'tracking':family==='games'?'game':'both'));
 for(const family of ['tracking','index'] as const)for(const kind of ['later-unknown','pagination-overflow'] as const)results.push(await retentionCase(family,kind));
 for(const reference of ['none','tracking','game','both'] as const)results.push(await retentionCase(null,null,reference));
 // Every stored same-game pointer is retained for cleanup even though display
 // first-lock selection intentionally uses only its first authority.
 {const f=fixture(),first=f.snapshot('first-original',at),second=f.snapshot('second-original','2030-06-01T18:00:00Z');await f.store.publishMlbPropsBoardSnapshot(first);f.clock(second.asOfTimestamp);await f.store.publishMlbPropsBoardSnapshot(second);f.addRef(first,'game',1);f.addRef(second,'game',2);const originals=structuredClone(f.tables.prop_scoring_runs),pointers=digest(f.tables.admin_audit_log.filter(r=>r.action_type==='mlb_props.game_locked_t60'));f.retention(1);f.clock('2030-06-01T19:00:00Z');await f.store.publishMlbPropsBoardSnapshot(f.snapshot('trigger-current','2030-06-01T19:00:00Z'));for(const old of originals)assert.equal(digest(f.tables.prop_scoring_runs.find(r=>r.id===old.id)),digest(old),'Duplicate game keys cannot delete either original referenced source');assert.equal(digest(f.tables.admin_audit_log.filter(r=>r.action_type==='mlb_props.game_locked_t60')),pointers);assert.equal(f.deletes.length,0);results.push({duplicateGamePointersPreserved:true});}
 // An ambiguous index run mapping is unavailable authority, never permission
 // to prune either interpretation of its original source.
 {const f=fixture(),original=f.snapshot('ambiguous-source',at);await f.store.publishMlbPropsBoardSnapshot(original);const source=structuredClone(f.tables.prop_scoring_runs[0]),index=f.tables.admin_audit_log.find(r=>r.after_state?.snapshot_id===original.snapshotId)!;f.tables.admin_audit_log.push({...structuredClone(index),id:'ambiguous-index',after_state:{...index.after_state,snapshot_id:'other-identity'}});f.retention(1);f.clock('2030-06-01T19:00:00Z');await f.store.publishMlbPropsBoardSnapshot(f.snapshot('trigger-current','2030-06-01T19:00:00Z'));assert.equal(digest(f.tables.prop_scoring_runs.find(r=>r.id===source.id)),digest(source));assert.equal(f.deletes.length,0);results.push({ambiguousIndexSourcePreserved:true});}
 // More than 5000 legacy refs cannot hide a genuinely referenced original.
 {const f=fixture(),original=f.snapshot('original-locked',at);await f.store.publishMlbPropsBoardSnapshot(original);const originalRow=structuredClone(f.tables.prop_scoring_runs[0]);for(let i=0;i<5001;i++)f.addRef({...original,snapshotId:i===5000?original.snapshotId:'unrelated-'+i},'tracking',i);f.retention(1);f.clock('2030-06-01T19:00:00Z');await f.store.publishMlbPropsBoardSnapshot(f.snapshot('trigger-current','2030-06-01T19:00:00Z'));assert.equal(digest(f.tables.prop_scoring_runs.find(r=>r.id===originalRow.id)),digest(originalRow));assert.equal(f.deletes.length,0);assert(f.reads.some(r=>r.family==='tracking'&&r.offset>=5000),'Legacy references must be completely paged beyond old5000 bound');results.push({completeLegacyRefs:5001});}
 // Unknown publication-index arrays cannot manufacture a lock from an older
 // legacy fallback. A genuinely empty array still allows that declared policy.
 for(const kind of ['null','undefined','malformed','bad-row','error','rejected','overflow'] as const){const f=fixture(),prior=f.snapshot('legacy-prior',at),current=f.snapshot('future','2030-06-01T19:00:00Z',policy.MLB_PROPS_AI_HANDOFF_RELEASE);await f.store.publishMlbPropsBoardSnapshot(prior);f.clock(current.asOfTimestamp);await f.store.publishMlbPropsBoardSnapshot(current);f.fault('cutoff-index',kind);f.clock('2030-06-01T20:00:01Z');const before=digest(f.tables);await assert.rejects(()=>f.tracking.ensureMlbPropsGameLocks(current,'2030-06-01T20:00:01Z'),()=>true,`cutoff ${kind}`);assert.equal(digest(f.tables),before);assert(!f.tables.admin_audit_log.some(r=>r.action_type==='mlb_props.game_locked_t60'));results.push({cutoffUnknown:kind,createdLocks:0});}
 {const f=fixture(),prior=f.snapshot('legacy-prior',at),current=f.snapshot('future','2030-06-01T19:00:00Z',policy.MLB_PROPS_AI_HANDOFF_RELEASE);await f.store.publishMlbPropsBoardSnapshot(prior);f.clock(current.asOfTimestamp);await f.store.publishMlbPropsBoardSnapshot(current);f.tables.admin_audit_log=f.tables.admin_audit_log.filter(r=>r.after_state?.snapshot_id!=='future');f.clock('2030-06-01T20:00:01Z');const result=await f.tracking.ensureMlbPropsGameLocks(current,'2030-06-01T20:00:01Z');assert.equal(result.created,1);assert.equal(result.locks[0].board_snapshot_id,'legacy-prior');results.push({knownMissingIndexLegacyFallback:true});}
 console.log(JSON.stringify({retentionAuthority:true,cases:results.length,allArrayFamiliesFailClosed:true,completeLegacyPagination:true,unknownCutoffCreatesNoLocks:true,knownUnreferencedCleanup:true,originalSourceAndRefHashesUnchanged:true,realIO:0,results}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
