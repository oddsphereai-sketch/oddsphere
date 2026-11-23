/** Independent schema validation plus the actual parser/feedback, zero HTTP. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {jointReviewSchema,parseJointReview} from '../lib/playerPropsAi/request';
import {inspectGenerativeDraft} from '../lib/playerPropsAi/generativeAdmission';
import {reviewCorrectionFeedback} from '../lib/playerPropsAi/reviewCorrectionFeedback';
import {nbaAuthorityFixture,nbaAuthorityDraft} from './test-player-props-ai-nba-lock-authority';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {PROPS_AI_RELEASE,propsReviewHasSemanticChecks,propsReviewHasVerifiedReaderClaims,propsReviewHasMemberExecutionContracts} from '../lib/playerPropsAi/releases';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import {resolveReviewSchema} from './lib/player-props-ai-schema-fixture';

globalThis.fetch=async()=>{throw Error('Disposition proof forbids network/provider/model/count/SQL');};
// Ajv is the independent JSON Schema validator installed by the repository's
// existing ESLint dependency. It is not imported by production code.
const Ajv=createRequire(import.meta.url)('ajv') as new(options:object)=>{compile:(schema:unknown)=>((value:unknown)=>boolean)};
const validator=(p:GamePacket)=>new Ajv({allErrors:true}).compile(jointReviewSchema(p));
const base=nbaAuthorityFixture().packet,original=nbaAuthorityDraft(base),check=validator(base);
assert(check(original),'Existing supported source-bound law is still schema-valid');
const admitted=parseJointReview(base,original),before=JSON.stringify(original);
assert.deepEqual(parseJointReview(base,structuredClone(original)),admitted);
let negative=0,positive=1;
for(const sport of ['nba','nfl','mlb'] as const){
 const packet:GamePacket=sport==='nba'?base:{...base,sport,quotes:[],executionQuotes:[],players:[{...base.players[0],markets:sport==='nfl'?['receptions','receiving_yards']:['hits','total_bases'],evidence:[{id:'context',kind:'matchup',source:'synthetic recorded context',availableAt:base.cutoff,value:{context:'Exact synthetic game context.'}}]}]};
 const draft={wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(packet.players.map(p=>[p.id,verifiedReaderFixture(packet,p.id,{priorRead:{},evidenceIds:[[...evidenceAliases(packet)].find(([,id])=>id===p.evidence[0].id)![0]],law:null,gaps:['forecast_declined'],exceptions:p.markets.map(()=> 'forecast_declined'),confidence:p.markets.map(()=>0)})]))};
 if(sport==='nba')for(const p of packet.players)draft.players[p.id].priorRead=original.players[p.id].priorRead;
 const valid=validator(packet);assert(valid(draft));parseJointReview(packet,draft);positive++;
 for(const p of packet.players){
  const missingGap=structuredClone(draft);missingGap.players[p.id].gaps=[];assert(!valid(missingGap));assert.throws(()=>parseJointReview(packet,missingGap),/unsupported_disposition/);negative++;
  for(let i=0;i<p.markets.length;i++){
   const bad=structuredClone(draft);bad.players[p.id].exceptions[i]=null;bad.players[p.id].confidence[i]=1;
   const bytes=JSON.stringify(bad);assert(!valid(bad));assert.throws(()=>parseJointReview(packet,bad),/unsupported_disposition/);assert.equal(JSON.stringify(bad),bytes);
   const inspection=inspectGenerativeDraft(packet,bad);assert(inspection.coordinates.some(c=>c.playerId===p.id&&c.code==='unsupported_disposition'));
   const feedback=reviewCorrectionFeedback(packet,bad);assert.equal(feedback.status,'ready');if(feedback.status==='ready'){
    assert(feedback.text.includes('EVERY market'));assert(feedback.affectedActorIds.includes(p.id));assert(feedback.bytes<=1984);assert(Buffer.byteLength(JSON.stringify(feedback.text).slice(1,-1))<=1984);
   }negative++;
  }
 }
 const alien=structuredClone(draft);alien.players.foreign=structuredClone(Object.values(draft.players)[0]);assert(!valid(alien));negative++;
 const wrong=structuredClone(draft);Reflect.set(Object.values(wrong.players)[0],'gaps',['invented_source']);assert(!valid(wrong));negative++;
 // Every nested object in both supported and unsupported branches is strict;
 // definitions resolve locally and the top-level remains an object, not anyOf.
 const schema=jointReviewSchema(packet);assert.equal(schema.type,'object');assert(!Object.hasOwn(schema,'anyOf'));
 const walk=(node:unknown)=>{if(!node||typeof node!=='object')return;const x=node as Record<string,unknown>;if(x.type==='object'){assert.equal(x.additionalProperties,false);assert.deepEqual((x.required as string[]).slice().sort(),Object.keys(x.properties as object).sort());}for(const v of Object.values(x))if(Array.isArray(v))v.forEach(walk);else walk(v);};
 walk(resolveReviewSchema(schema,schema));
}
const mixed=structuredClone(original);mixed.players.a.exceptions[1]='forecast_declined';assert(check(mixed));parseJointReview(base,mixed);positive++;
const unsupportedSibling=structuredClone(original);Reflect.set(unsupportedSibling.players.b,'law',null);unsupportedSibling.players.b.gaps=['forecast_declined'];unsupportedSibling.players.b.exceptions=['forecast_declined'];assert(check(unsupportedSibling));parseJointReview(base,unsupportedSibling);positive++;
assert.equal(JSON.stringify(original),before,'Schema/parser/diagnostics never rewrite a returned draft');
const old='player_props_ai_2026_11_19_r56_forecast_strength';assert.notEqual(PROPS_AI_RELEASE,old);for(const f of [propsReviewHasSemanticChecks,propsReviewHasVerifiedReaderClaims,propsReviewHasMemberExecutionContracts])assert(f(old),'Original R56 release membership is permanent');
// Exercise the actual private envelope validator with malicious schema refs;
// production schemas are frozen and have no caller-supplied reference path.
const actorFile=new URL('../lib/playerPropsAi/actorAdmission.ts',import.meta.url),actorRequire=createRequire(actorFile);
const actorSource=readFileSync(actorFile,'utf8')+'\nexport {schemaValid as testSchemaValid};';
const actorExports={} as {testSchemaValid:(value:unknown,schema:unknown)=>boolean};
vm.runInNewContext(ts.transpileModule(actorSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:{exports:actorExports},exports:actorExports,require:actorRequire,Buffer,Date,process,console});
assert(actorExports.testSchemaValid(original,jointReviewSchema(base)));
for(const schema of [{$ref:'https://invalid.example/schema'},{$ref:'#/$defs/missing',$defs:{}},{$ref:'#/$defs/a',$defs:{a:{$ref:'#/$defs/a'}}},{$ref:'#/$defs/__proto__',$defs:{}},{type:'string',unsupportedKeyword:true}]){assert.equal(actorExports.testSchemaValid('x',schema),false);negative++;}
for(const ref of ['#/$defs/a','#/$defs/missing','#/$defs/__proto__','https://invalid.example/schema']){
 const schema={type:'object',additionalProperties:false,required:['x'],properties:{x:{$ref:ref}},$defs:{a:{$ref:'#/$defs/a'}}};
 assert.equal(actorExports.testSchemaValid({x:'x'},schema),false);negative++;
}
console.log(JSON.stringify({proof:'explicit_null_law_disposition',positive,negative,oldReleaseRetained:true,boundedLocalReferenceRejection:true,networkCalls:0}));
