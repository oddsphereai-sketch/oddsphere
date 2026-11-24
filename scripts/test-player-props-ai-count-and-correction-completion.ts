/** Offline actual partition/control replay; every model/token call is mocked. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {memoizePropsAiInputCount,prepareReviewParts} from '../lib/playerPropsAi/partitions';
import {PROPS_AI_MAX_INPUT_PER_REQUEST,PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL} from '../lib/playerPropsAi/releases';
import {jointReviewRequest} from '../lib/playerPropsAi/request';
import {digest} from '../lib/playerPropsAi/evidence';
import {withAllActorNumericCorrection} from '../lib/playerPropsAi/allActorNumericCorrection';
import {reviewCorrectionFeedback} from '../lib/playerPropsAi/reviewCorrectionFeedback';
import {namedSourceCorrection} from '../lib/playerPropsAi/sourceConstraintCards';
import {withOriginalDraftCorrectionContext} from '../lib/playerPropsAi/originalDraftCorrectionContext';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {PlayerLaw} from '../lib/playerPropsAi/law';
globalThis.fetch=async()=>{throw Error('Offline count/correction proof forbids network');};
const root=process.cwd(),rq=createRequire(root+'/package.json');
function load(source:string,file:string){const testModule={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:testModule,exports:testModule.exports,require:createRequire(file),console,Buffer,process,globalThis,structuredClone,setTimeout,clearTimeout},{filename:file});return testModule.exports as Record<string,unknown>;}
const fixtureFile=root+'/scripts/test-player-props-ai-source-constraint-cards.ts';
const fixtureSource=readFileSync(fixtureFile,'utf8'),fixtureAst=ts.createSourceFile(fixtureFile,fixtureSource,ts.ScriptTarget.Latest,true);
const fixtureChunks:string[]=[];
for(const node of fixtureAst.statements){
 if(ts.isImportDeclaration(node)||ts.isFunctionDeclaration(node)&&node.name&&['evidence','player','packet','row'].includes(node.name.text))fixtureChunks.push(node.getText(fixtureAst));
 if(ts.isVariableStatement(node))for(const declaration of node.declarationList.declarations)if(['at','v','invalidLaw'].includes(declaration.name.getText(fixtureAst)))fixtureChunks.push('const '+declaration.getText(fixtureAst)+';');
}
const f=load(fixtureChunks.join('\n')+'\nmodule.exports={packet,player,row,invalidLaw};',fixtureFile) as unknown as {
 packet:(players?:GamePacket['players'])=>GamePacket;player:(id:string)=>GamePacket['players'][number];
 row:(packet:GamePacket,player:GamePacket['players'][number],law:PlayerLaw)=>unknown;invalidLaw:PlayerLaw;
};
async function main(){
 let controls=0,calls=0;
 const packet=f.packet(),before=digest(packet),memo=memoizePropsAiInputCount(async()=>{calls++;return 123;});
 assert.deepEqual(await Promise.all([memo(packet,PROPS_AI_PRIMARY_MODEL),memo(structuredClone(packet),PROPS_AI_PRIMARY_MODEL)]),[123,123]);assert.equal(calls,1);controls+=2;
 for(const change of [(p:GamePacket)=>{p.cutoff='2026-11-09T18:00:01Z';},(p:GamePacket)=>{p.players[0].evidence[0].source+=' changed';},(p:GamePacket)=>{p.players[0].name+=' changed';}]){const p=structuredClone(packet);change(p);await memo(p,PROPS_AI_PRIMARY_MODEL);}
 await memo(packet,PROPS_AI_STRONG_MODEL);assert.equal(calls,5);assert.equal(digest(packet),before);controls+=5;
 await memoizePropsAiInputCount(async()=>{calls++;return 123;})(packet,PROPS_AI_PRIMARY_MODEL);assert.equal(calls,6,'No count survives its preparation invocation');controls++;
 const probe=structuredClone(packet),originalName=probe.players[0].name;
 const captured=memoizePropsAiInputCount(async p=>{assert.equal(p.players[0].name,originalName);return 321;});
 const queued=captured(probe,PROPS_AI_PRIMARY_MODEL);probe.players[0].name='Changed after queueing';assert.equal(await queued,321);controls++;
 let failures=0;const rejected=memoizePropsAiInputCount(async()=>{failures++;throw Error('original count unavailable');});for(let i=0;i<2;i++)await assert.rejects(rejected(packet,PROPS_AI_PRIMARY_MODEL),/original count unavailable/);assert.equal(failures,1);controls+=3;

 // Control is this exact partition implementation with only memoization removed.
 const sourceFile=root+'/lib/playerPropsAi/partitions.ts',source=readFileSync(sourceFile,'utf8');
 const line='const count = memoizePropsAiInputCount(args.count ?? ((p, m) => countAiInput(jointReviewRequest(p, m, PROPS_AI_MAX_OUTPUT_PER_REQUEST), args)));';
 assert.equal(source.split(line).length-1,1);const plain=source.replace(line,'const count = args.count ?? ((p, m) => countAiInput(jointReviewRequest(p, m, PROPS_AI_MAX_OUTPUT_PER_REQUEST), args));');
 const control=load(plain+'\nmodule.exports={prepareReviewParts};',sourceFile).prepareReviewParts as typeof prepareReviewParts;
 const input=f.packet(Array.from({length:12},(_,i)=>f.player('p'+i))),original=digest(input);
 const oracle=(p:GamePacket)=>Math.ceil(PROPS_AI_MAX_INPUT_PER_REQUEST*(p.players.length*.28+(p.players.some(x=>x.id==='p0')?.27:0)));
 const run=async(fn:typeof prepareReviewParts)=>{const wires:string[]=[],stages:number[]=[];const parts=await fn(input,{key:'synthetic',count:async(p,m)=>{wires.push(JSON.stringify(jointReviewRequest(p,m,7000)));return oracle(p);},onCountStage:n=>stages.push(n)});return{parts,wires,stages};};
 const a=await run(control),b=await run(prepareReviewParts);assert.equal(JSON.stringify(b.parts),JSON.stringify(a.parts));assert.deepEqual(b.stages,a.stages);assert(b.wires.length<=a.wires.length,'Headroom pruning may eliminate duplicate stages before the exact-wire cache is needed; caching must never add calls');assert.equal(new Set(b.wires).size,b.wires.length,'No identical model wire is counted twice');assert.equal(digest(input),original);controls+=5;
 let sent=0;await assert.rejects(prepareReviewParts(input,{key:'synthetic',count:async()=>{sent++;return 1;},onCountStage:()=>{throw Error('actual preparation deadline closed');}}),/actual preparation deadline closed/);assert.equal(sent,0,'Cached-count code cannot bypass the stage admission boundary');controls+=2;

 const multiple=f.packet([f.player('first'),f.player('second'),f.player('third')]);
 const draft={wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(multiple.players.map(p=>[p.id,f.row(multiple,p,f.invalidLaw)]))};
 const numericBefore=digest({multiple,draft}),base={status:'ready',text:'Complete original findings and references.',bytes:40,affectedActorIds:multiple.players.map(p=>p.id)};
 const guided=withAllActorNumericCorrection(multiple,draft,base);assert(guided.text?.startsWith(base.text));assert(guided.text?.includes('EVERY failed P0,1,2'));assert(guided.text?.includes('explicitly except affected scopes'));assert.deepEqual(guided.affectedActorIds,base.affectedActorIds);assert.equal(digest({multiple,draft}),numericBefore);controls+=5;
 // A malformed numeric law can have coordinate findings instead of source
 // findings. It still belongs in the complete original actor checklist.
 const mixed=structuredClone(draft) as {wireRelease:string;players:Record<string,{law:{weights:number[];outcomes:Record<string,number[]>}}>};
 for(const mutate of [(r:typeof mixed.players[string])=>{r.law.weights[0]=.5;},(r:typeof mixed.players[string])=>{r.law.outcomes.rebounds[0]=.5;},(r:typeof mixed.players[string])=>{r.law.outcomes.points_excluding_made_threes[0]=-1;}]){
  const candidate=structuredClone(mixed);mutate(candidate.players.second);const unchanged=digest(candidate),complete=withAllActorNumericCorrection(multiple,candidate,base);assert(complete.text?.includes('EVERY failed P0,1,2'));assert.equal(digest(candidate),unchanged);controls+=2;
 }
 const full={...base,text:'x'.repeat(1984),bytes:1984};assert.equal(withAllActorNumericCorrection(multiple,draft,full),full,'An existing complete diagnostic/reference must never be displaced');controls++;
 const escaped={...base,text:'"'.repeat(970),bytes:970};assert.equal(withAllActorNumericCorrection(multiple,draft,escaped),escaped,'Actual serialized escaping must fit the same cushion');controls++;
 const unavailable={...base,status:'unavailable'};assert.equal(withAllActorNumericCorrection(multiple,draft,unavailable),unavailable);assert.equal(withAllActorNumericCorrection({...multiple,sport:'nfl'},draft,base),base);assert.equal(withAllActorNumericCorrection(multiple,{},base),base);controls+=3;
 const one=f.packet();const oneDraft={wireRelease:PROPS_AI_WIRE_RELEASE,players:{a:f.row(one,one.players[0],f.invalidLaw)}};assert.equal(withAllActorNumericCorrection(one,oneDraft,base),base);controls++;
 const old=withOriginalDraftCorrectionContext(multiple,draft,namedSourceCorrection(multiple,draft));const result=reviewCorrectionFeedback(multiple,draft);assert(old.status==='ready'&&result.status==='ready');assert(result.text.startsWith(old.text));assert((result.bytes??0)<=1984);controls+=2;
 console.log(JSON.stringify({status:'PASS',controls,exactPartitionPartsAndStages:true,originalCountCalls:a.wires.length,memoizedCountCalls:b.wires.length,allEvidenceAndInputBytesUnchanged:true,allAffectedNumericActorsExplicit:true,noPriorDiagnosticOrReferenceDisplaced:true,networkCalls:0,productionWrites:0}));
}
void rq;main().catch(error=>{console.error(error);process.exitCode=1;});
