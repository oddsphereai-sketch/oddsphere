/** Synthetic byte parity against the previous two-compilation request path.
 * No cache crosses a request, and every network path is blocked. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as claims from '../lib/playerPropsAi/readerClaims';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import {PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL,type PropsAiModel} from '../lib/playerPropsAi/releases';
import {nbaAuthorityFixture} from './test-player-props-ai-nba-lock-authority';
import type * as RequestModule from '../lib/playerPropsAi/request';

globalThis.fetch=async()=>{throw Error('Request compilation proof forbids network and paid calls');};
const file=new URL('../lib/playerPropsAi/request.ts',import.meta.url),source=readFileSync(file,'utf8'),rq=createRequire(file);
const declaration='  const compiled=compileReaderClaimRequest(packet);';
assert.equal(source.split(declaration).length,2);
const legacy=source.replace(declaration,'').replace('input: sourceInputWithClaims(packet,compiled.modelInput),','input: sourceInput(packet),').replace('schema: jointReviewSchemaFromCatalogs(packet,compiled.catalogs) } },','schema: jointReviewSchema(packet) } },');
assert.notEqual(legacy,source);
function load(text:string){
 let compilations=0;
 const exports={} as typeof RequestModule;
 const javascript=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(javascript,{module:{exports},exports,Buffer,Date,console,process,require:(name:string)=>name==='./readerClaims'?{...claims,
  compileReaderClaims:(packet:GamePacket)=>{compilations++;return claims.compileReaderClaims(packet);},
  compileReaderClaimRequest:(packet:GamePacket)=>{compilations++;return claims.compileReaderClaimRequest(packet);},
  readerClaimModelInput:(packet:GamePacket)=>{compilations++;return claims.readerClaimModelInput(packet);},
 }:rq(name)},{filename:'offline-request-compilation.cjs'});
 return{api:exports,compilations:()=>compilations};
}
const next=load(source),old=load(legacy),nba=nbaAuthorityFixture().packet;
const minimal=(sport:'nfl'|'mlb'):GamePacket=>({...nba,sport,quotes:[],executionQuotes:[],players:[{id:'p',name:'Synthetic Player',team:'A',opponent:'B',markets:sport==='nfl'?['passing_yards']:['hits'],missing:[],evidence:[{id:'matchup',kind:'matchup',availableAt:nba.cutoff,source:'synthetic-matchup',value:{context:'The supplied synthetic matchup is exact-game context.'}}]}]});
let requests=0;
function compare(packet:GamePacket,model:PropsAiModel,maxOutput:number,previousFailure?:string,correctionText?:string){
 const before=JSON.stringify(packet),a=next.compilations(),b=old.compilations();
 const original=old.api.jointReviewRequest(packet,model,maxOutput,previousFailure,correctionText),optimized=next.api.jointReviewRequest(packet,model,maxOutput,previousFailure,correctionText);
 assert.equal(JSON.stringify(optimized),JSON.stringify(original),'Model, instructions, raw/typed sources, claim IDs/schema, clocks, corrections and output cap must remain byte-exact');
 assert.equal(JSON.stringify(packet),before,'Request construction must not mutate its source');
 assert.equal(next.compilations()-a,1,'One request owns one factual compilation');
 assert.equal(old.compilations()-b,2,'The exact previous path compiled model input and schema independently');
 requests++;return optimized;
}
for(const packet of [nba,minimal('nfl'),minimal('mlb')])for(const model of [PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL]){
 compare(packet,model,7000);compare(packet,model,4096,'source_or_tail_failure');
 assert.equal(JSON.stringify(next.api.sourceInput(packet)),JSON.stringify(old.api.sourceInput(packet)));
 assert.equal(JSON.stringify(next.api.jointReviewSchema(packet)),JSON.stringify(old.api.jointReviewSchema(packet)));
 const compiled=claims.compileReaderClaimRequest(packet);assert.equal(JSON.stringify(compiled.modelInput),JSON.stringify(claims.readerClaimModelInput(packet)));assert.equal(JSON.stringify(compiled.catalogs),JSON.stringify(claims.compileReaderClaims(packet)));
}
compare(nba,PROPS_AI_PRIMARY_MODEL,7000,'source_or_tail_failure','Use the exact original typed source facts and correct the affected scope.');
const before=compare(nba,PROPS_AI_PRIMARY_MODEL,7000),changed=structuredClone(nba);changed.sourceLimitations.push('An independent synthetic source limitation changed.');
const after=compare(changed,PROPS_AI_PRIMARY_MODEL,7000);assert.notEqual(before.input,after.input,'A subsequent source call must never reuse cached factual material');
assert.equal(JSON.stringify(compare(nba,PROPS_AI_PRIMARY_MODEL,7000)),JSON.stringify(before),'Unrelated calls cannot contaminate the original request');
const later=structuredClone(nba);later.cutoff=new Date(Date.parse(nba.cutoff)+1000).toISOString();assert.notEqual(compare(later,PROPS_AI_PRIMARY_MODEL,7000).input,before.input,'A later source cutoff is independently compiled');
const failure=(packet:GamePacket,correction?:string)=>{
 const caught=(api:typeof RequestModule)=>{try{api.jointReviewRequest(packet,PROPS_AI_PRIMARY_MODEL,7000,'source_or_tail_failure',correction);return null;}catch(e){return(e as Error).message;}};
 const original=caught(old.api),current=caught(next.api);assert(original);assert.equal(current,original,'Invalid source/correction guards keep their exact failure contract');
};
failure(nba,'x'.repeat(1985));failure(nba,'non-ASCII \u00e9');failure(minimal('nfl'),'NBA-only named correction');
const empty=structuredClone(nba);empty.players[0].evidence=[];failure(empty);
const future=structuredClone(nba);future.players[0].evidence[0].availableAt=new Date(Date.parse(nba.cutoff)+1000).toISOString();failure(future);
const afterLock=structuredClone(nba);afterLock.cutoff=afterLock.start;failure(afterLock);
console.log(`Request compilation passed: ${requests} exact old/new NBA/NFL/MLB primary/strong/correction requests, one factual compilation per request, independent changed-source/cutoff calls, immutable inputs and original invalid-source/correction refusal. Network blocked.`);
