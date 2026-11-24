/** Offline actual partition/control replay; every model/token call is mocked. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {prepareReviewParts} from '../lib/playerPropsAi/partitions';
import {PROPS_AI_MAX_INPUT_PER_REQUEST} from '../lib/playerPropsAi/releases';
import {digest} from '../lib/playerPropsAi/evidence';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {PlayerLaw} from '../lib/playerPropsAi/law';
globalThis.fetch=async()=>{throw Error('Offline count/correction proof forbids network');};
const root=process.cwd();
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
 const controlFile=root+'/scripts/fixtures/player-props-ai-r58-partitions-control.ts.txt';
 const frozen=readFileSync(controlFile,'utf8');
 assert.equal(createHash('sha256').update(frozen).digest('hex'),'53f96e7a4871ca9cd9214eb6587295fb1f5aef3ccaa17df21ffb002a7720592d');
 const control=load(frozen+'\nmodule.exports={prepareReviewParts};',root+'/lib/playerPropsAi/partitions.ts').prepareReviewParts as typeof prepareReviewParts;
 const input=f.packet(Array.from({length:14},(_,i)=>f.player('p'+i))),original=digest(input);
 async function run(fn:typeof prepareReviewParts,deadline=false){
  let elapsed=90000,calls=0,stages=0,waves=0,batch:Promise<void>|null=null;
  const parts=await fn(input,{key:'synthetic-never-real',count:async p=>{
   calls++;
   if(!batch){waves++;batch=Promise.resolve().then(()=>{elapsed+=30000;batch=null;if(deadline&&elapsed>225000)throw Error('synthetic_preparation_deadline');});}
   await batch;return p.players.length*35000;
  },onCountStage:()=>{stages++;if(deadline&&elapsed>225000)throw Error('synthetic_preparation_deadline');}});
  return{parts,elapsed,calls,stages,waves};
 }
 const prior=await run(control),current=await run(prepareReviewParts);
 assert.equal(JSON.stringify(current.parts),JSON.stringify(prior.parts),'Same accepted complete player/market/input parts and measured counts');
 assert.equal(digest(input),original);assert.equal(current.parts.length,4);
 assert(current.parts.every(p=>p.inputTokens<=PROPS_AI_MAX_INPUT_PER_REQUEST));
 assert.deepEqual(current.parts.flatMap(p=>p.packet.players.map(p=>p.id)).sort(),input.players.map(p=>p.id).sort());
 assert(current.calls<prior.calls&&current.waves<prior.waves&&current.stages<prior.stages);
 await assert.rejects(run(control,true),/synthetic_preparation_deadline/);
 const fits=await run(prepareReviewParts,true);assert.equal(JSON.stringify(fits.parts),JSON.stringify(current.parts));
 // Measured-token headroom can differ from equal byte weights. Preserve useful
 // transfers that fit two parts instead of prematurely expanding paid waves.
 for(const [heavy,other] of [[90000,10000],[40000,18000]]){
  const exactCount=async(p:GamePacket)=>p.players.reduce((n,x)=>n+(x.id==='p2'?heavy:other),0);
  const before=await control(input,{key:'synthetic',count:exactCount});
  const after=await prepareReviewParts(input,{key:'synthetic',count:exactCount});
  assert.equal(before.length,2);assert.equal(JSON.stringify(after),JSON.stringify(before));
 }
 let sends=0;await assert.rejects(prepareReviewParts(input,{key:'synthetic',count:async()=>{sends++;return 1;},onCountStage:()=>{throw Error('closed_stage');}}),/closed_stage/);assert.equal(sends,0);
 console.log(JSON.stringify({status:'PASS',originalCountCalls:prior.calls,newCountCalls:current.calls,originalWaves:prior.waves,newWaves:current.waves,sameExactAcceptedParts:true,sourceActorMarketBytesUnchanged:true,virtualOriginalMs:prior.elapsed,virtualCurrentMs:current.elapsed,virtualDeadlineMs:225000,noProviderModelCountCalls:true,noLiveLatencyOrAccuracyClaim:true}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
