/** Exact original proof bytes and bounded hashing work; all sources synthetic,
 * every network path blocked. The virtual legacy copy restores only the prior
 * per-proof hash expression so this test compares the complete capture output. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as evidence from '../lib/playerPropsAi/evidence';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {NbaPlayerPropsMemberDecision as Row} from '../lib/services/nba/nbaPlayerPropsProductContract';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {applyNbaSiteAi} from '../lib/playerPropsAi/siteBindings';
import {nbaAuthorityFixture,nbaAuthorityReview} from './test-player-props-ai-nba-lock-authority';
import type * as Authority from '../lib/playerPropsAi/nbaLockAuthority';

globalThis.fetch=async()=>{throw Error('Handoff hash proof forbids network and paid calls');};
const sourceFile=new URL('../lib/playerPropsAi/nbaLockAuthority.ts',import.meta.url);
const current=readFileSync(sourceFile,'utf8');
const hoist='const sourcePacketHash=digest(source);';
assert.equal(current.split(hoist).length,2,'The full packet hash must be computed once per capture');
const expression='readyAt,sourcePacketHash,executionQuote:clone(quote)';
assert.equal(current.split(expression).length,2);
const legacy=current.replace(hoist,'').replace(expression,'readyAt,sourcePacketHash:digest(source),executionQuote:clone(quote)');
const originalRequire=createRequire(sourceFile);
function load(text:string){
 let fullPacketHashes=0;
 const exports={} as typeof Authority;
 const javascript=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(javascript,{module:{exports},exports,console,Date,process,require:(name:string)=>name==='./evidence'?{...evidence,digest:(value:unknown)=>{
  const packet=value as Partial<GamePacket>|null;
  if(packet?.sport==='nba'&&Array.isArray(packet.players)&&Array.isArray(packet.quotes))fullPacketHashes++;
  return evidence.digest(value);
 }}:originalRequire(name)},{filename:'offline-nba-handoff-hash-work.cjs'});
 return{api:exports,hashes:()=>fullPacketHashes};
}
const previousEnv=process.env.NODE_ENV;
Object.assign(process.env,{NODE_ENV:'test'});
try{
 const optimized=load(current),prior=load(legacy),f=nbaAuthorityFixture(),at=f.packet.cutoff;
 const native=[f.row(),f.row('a','rebounds'),f.row('b')],review=nbaAuthorityReview(f.packet);
 const ai=applyNbaSiteAi(f.snapshot(native),f.packet,siteAiDecisions(f.packet,review,at),at).decisions;
 assert.equal(ai.length,3);
 function compare(rows:readonly Row[],packet:GamePacket,selected:AcceptedGameReview|null,kind:'ai'|'native',clock=at){
  const before=JSON.stringify({rows,packet,selected});
  const oldStart=prior.hashes(),newStart=optimized.hashes();
  const original=prior.api.testNbaHandoffCapture(()=>clock)(rows,packet,selected,kind);
  const next=optimized.api.testNbaHandoffCapture(()=>clock)(rows,packet,selected,kind);
  assert.equal(JSON.stringify(next),JSON.stringify(original),'Every original proof, row, hash, value, price, clock and duplicate stays byte-exact');
  assert.equal(JSON.stringify({rows,packet,selected}),before,'Capture cannot mutate inputs');
  const oldHashes=prior.hashes()-oldStart,newHashes=optimized.hashes()-newStart;
  assert.equal(oldHashes,original.proofs.length,'Legacy repeats one complete-source hash per qualified proof');
  assert(newHashes<=1,'Complete-source serialization/hash work is bounded once per capture');
  if(next.proofs.length)assert.equal(newHashes,1);
  return next;
 }
 const nativeResult=compare(native,f.packet,null,'native');assert.equal(nativeResult.proofs.length,3);
 const aiResult=compare(ai,f.packet,review,'ai');assert.equal(aiResult.proofs.length,3);
 assert.equal(compare([...native,...native],f.packet,null,'native').proofs.length,6,'Original multiplicity is preserved');
 assert.equal(compare([...ai,...ai],f.packet,review,'ai').proofs.length,6);
 assert.equal(compare(native.map(row=>({...row,lockedAt:f.packet.lock})),f.packet,null,'native').proofs.length,0,'Stored locks cannot become new proofs');
 assert.equal(compare(native,f.packet,null,'native',f.packet.lock).proofs.length,0,'No readiness is backdated across lock');
 const changed=structuredClone(f.packet);changed.sourceLimitations.push('A synthetic source value changed.');
 const changedResult=compare(native,changed,null,'native');assert.equal(changedResult.proofs.length,3);
 assert.notEqual(changedResult.proofs[0].sourcePacketHash,nativeResult.proofs[0].sourcePacketHash,'Separate captures cannot reuse a stale source hash');
 assert.equal(changedResult.proofs[0].sourcePacketHash,evidence.digest(changed));
 const large=structuredClone(f.packet);large.sourceLimitations.push('synthetic-source-padding:'+Array(262145).join('x'));
 const wide=Array.from({length:32},()=>native).flat();
 const full=compare(wide,large,null,'native');assert.equal(full.proofs.length,96);
 console.log('NBA handoff hash work passed: complete original native/AI/duplicate proof bytes exact, locked/late refusal, changed-source detection, inputs immutable and one full packet hash instead of96. All data synthetic and network blocked.');
}finally{
 if(previousEnv===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:previousEnv});
}
