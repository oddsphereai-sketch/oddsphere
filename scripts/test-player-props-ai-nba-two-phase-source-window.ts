/** Real writer source guard via its existing mocked durable harness. No network/DB. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {propsAiTwoPhaseCompletionWindowMs} from '../lib/playerPropsAi/completionWindow';

type ProbeHarness={run:(callback:()=>Promise<unknown>)=>Promise<unknown>;setTick:(at:string)=>void;counts:()=>{writes:number;rpcs:number};};
const initial=Date.parse('2026-11-10T22:24:00Z');
let source=readFileSync('scripts/test-player-props-ai-nba-durable-publication.ts','utf8').split('async function main(){')[0];
source=source.replace('readNbaPlayerPropsCurrentState:async()=>state','readNbaPlayerPropsCurrentState:async()=>{(options as any).beforeStateRead?.();return state;}');
source=source.replace('now:tick,fetchImpl:globalThis.fetch','now:tick,aiDeadline:(options as any).aiDeadline,reserveReviewWindow:(options as any).reserveReviewWindow,fetchImpl:globalThis.fetch');
source=source.replace('collectNbaPlayerPropsLiveMarket:async()=>({','collectNbaPlayerPropsLiveMarket:async(args:{fetchImpl:typeof fetch})=>{await (options as any).onSourceFetch?.(args.fetchImpl);return({');
source=source.replace('findings:options.findings??[]})},','findings:options.findings??[]});}},');
source=source.replace('exports,Date:Clock,console,require:','exports,Date:Clock,AbortSignal,console,require:');
source+='\nexport {harness};';
const exports:Record<string,unknown>={},context=vm.createContext({exports,module:{exports},require:createRequire(resolve('scripts/test-player-props-ai-nba-durable-publication.ts')),console,process,Date,Response,AbortSignal,structuredClone});
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
vm.runInContext(code,context);
const harness=exports.harness as (options:Record<string,unknown>)=>ProbeHarness;
const outcome=async()=>({status:'active',games:[],findings:[]});
async function main(){
 Object.assign(process.env,{NODE_ENV:"test"});
 assert.equal(propsAiTwoPhaseCompletionWindowMs(1),240000);assert.equal(propsAiTwoPhaseCompletionWindowMs(16),420000);
 let calls=0;const signals:AbortSignal[]=[];
 context.fetch=async(_url:unknown,init?:RequestInit)=>{calls++;signals.push(init!.signal!);return Response.json({fixture:true});};
 const good=harness({aiDeadline:initial+480000,reserveReviewWindow:true,onSourceFetch:async(fetchSource:typeof fetch)=>{const own=new AbortController();await fetchSource('https://synthetic.invalid/source',{signal:own.signal});assert.notEqual(signals.at(-1),own.signal);own.abort();assert(signals.at(-1)!.aborted,'Source deadline composes with rather than replaces original source cancellation');}});
 await good.run(outcome);assert.equal(calls,1);assert(good.counts().writes>0);
 const beforeCalls=calls;
 const expired:ProbeHarness=harness({aiDeadline:initial+480000,reserveReviewWindow:true,onSourceFetch:async(fetchSource:typeof fetch)=>{expired.setTick(new Date(initial+240000).toISOString());await fetchSource('https://synthetic.invalid/must-not-start');}});
 await assert.rejects(expired.run(outcome),/source_preparation_window_exhausted/);assert.equal(calls,beforeCalls);assert.equal(expired.counts().writes,0);assert.equal(expired.counts().rpcs,0);
 const slow:ProbeHarness=harness({aiDeadline:initial+480000,reserveReviewWindow:true,beforeStateRead:()=>slow.setTick(new Date(initial+240000).toISOString())});
 await assert.rejects(slow.run(outcome),/source_preparation_window_exhausted/);assert.equal(slow.counts().writes,0);
 // A non-due native/lock sweep keeps the same absolute bound without reserving
 // a paid review that was never due. It still runs after 339s of normal DE work.
 const native=harness({aiDeadline:initial+480000,reserveReviewWindow:false});native.setTick(new Date(initial+339000).toISOString());await native.run(outcome);assert(native.counts().writes>0);
 console.log('Actual NBA writer source window passed: derived 480−240s due preparation bound, original provider cancellation retained, no fetch/publication after slow source or DB preparation, and late non-due native lifecycle retained. Full 16-part420s capacity still requires preparation/counts <60s; no live latency claim.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
