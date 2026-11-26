/** Actual reviewer/receipt mock plus scope and original-byte adversarial controls. */
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {runActorAdmissionAuditSelfTest} from './test-player-props-ai-actor-admission-audit';
import {correctionActorIds,scopedReviewSchema,withPendingActorScope,correctionScopeFittingReceipt} from '../lib/playerPropsAi/correctionActorScope';
import {OriginalPartActorAdmission,type ActorAdmissionLineage,type ActorAdmissionProposal} from '../lib/playerPropsAi/actorAdmission';
import {jointReviewRequest,jointReviewSchema} from '../lib/playerPropsAi/request';
import {digest} from '../lib/playerPropsAi/evidence';
import {PROPS_AI_PRIMARY_MODEL} from '../lib/playerPropsAi/releases';

async function main(){
 const f=await runActorAdmissionAuditSelfTest(),packet=f.packet,before=digest(packet),text='\nKeep every original diagnostic, numeric reference and valid decline.',scoped=withPendingActorScope(packet,['b'],text),clone=structuredClone;
 assert(scoped.startsWith(text));assert.deepEqual(correctionActorIds(packet,scoped),['b']);assert.deepEqual(correctionActorIds(packet,text),['a','b','c','d']);
 assert.equal(withPendingActorScope(packet,['a','b','c','d'],text),text);
 const full='x'.repeat(1984);assert.equal(withPendingActorScope(packet,['b'],full),full,'Never truncate complete original diagnostics to fit a target');
 const escaped='"'.repeat(990);assert.equal(withPendingActorScope(packet,['b'],escaped),escaped,'Serialized retry cushion remains bounded');
 const emptyReceipt={padding:'',nextCorrectionText:text},baseBytes=Buffer.byteLength(JSON.stringify(emptyReceipt)),fullReceipt={...emptyReceipt,padding:'x'.repeat(768000-baseBytes)},receiptHash=digest(fullReceipt);
 assert.equal(Buffer.byteLength(JSON.stringify(fullReceipt)),768000);assert.equal(correctionScopeFittingReceipt(fullReceipt,text,scoped),text,'Targeting cannot turn a fitting original receipt into an archive failure');assert.equal(digest(fullReceipt),receiptHash);
 const exactScope={...emptyReceipt,padding:'x'.repeat(768000-Buffer.byteLength(JSON.stringify({...emptyReceipt,nextCorrectionText:scoped})))};assert.equal(correctionScopeFittingReceipt(exactScope,text,scoped),scoped,'Exact combined receipt boundary remains available');
 for(const bad of ['[]','[1,1]','[2,1]','[4]','[-1]','[0,1,2,3]','[1.0]','[1] extra','[1]\nRETRY_ACTOR_SCOPE_V1=[2]'])assert.throws(()=>correctionActorIds(packet,text+'\nRETRY_ACTOR_SCOPE_V1='+bad));
 assert.throws(()=>withPendingActorScope(packet,[],text));assert.throws(()=>withPendingActorScope(packet,['foreign'],text));assert.throws(()=>withPendingActorScope(packet,['b','b'],text));assert.throws(()=>withPendingActorScope(packet,['b'],scoped));
 type Schema={properties:{players:{required:string[];properties:Record<string,unknown>}};$defs:unknown};
 const schema=jointReviewSchema(packet) as unknown as Schema,schemaHash=digest(schema),only=scopedReviewSchema(schema,packet,scoped);assert.deepEqual(only.properties.players.required,['b']);assert.deepEqual(Object.keys(only.properties.players.properties),['b']);assert.equal(digest(only.properties.players.properties.b),digest(schema.properties.players.properties.b));assert.equal(digest(only.$defs),digest(schema.$defs));assert.equal(digest(schema),schemaHash);
 const primary=jointReviewRequest(packet,PROPS_AI_PRIMARY_MODEL,7000),retry=jointReviewRequest(packet,PROPS_AI_PRIMARY_MODEL,7000,'Original rejected scope',scoped);assert.equal(primary.input,retry.input);assert.equal(primary.max_output_tokens,retry.max_output_tokens);assert.deepEqual((retry.text.format.schema as unknown as Schema).properties.players.required,['b']);
 type Usage={failureEvidence:{draft:{data:string}};actorAdmissionEvidence:{draftSha256:string}};
 const raw=(i:number)=>JSON.parse(gunzipSync(Buffer.from((f.attempts[i].usage as Usage).failureEvidence.draft.data,'base64')).toString()),first=raw(0),second=raw(1),sha=(s:string)=>createHash('sha256').update(s).digest('hex');
 const lineage=(phase:1|2):ActorAdmissionLineage=>({part:1,phase,model:PROPS_AI_PRIMARY_MODEL,requestedTier:'default',actualTier:'default',responseId:'synthetic-'+phase,requestHash:'a'.repeat(64)});
 function retain(s:OriginalPartActorAdmission,p:ActorAdmissionProposal){s.retain(p,{receiptRecorded:true,receiptId:'synthetic-known-'+p.lineage.phase,actualMicro:1,archivedInputDigest:s.sourceInputHash,archivedRequestSha256:p.lineage.requestHash,archivedDraftSha256:p.draftSha256});}
 const session=()=>{const s=new OriginalPartActorAdmission(packet),p=s.propose(JSON.stringify(first),lineage(1));retain(s,p);return s;};
 assert.throws(()=>new OriginalPartActorAdmission(packet).propose(JSON.stringify(first),lineage(1),scoped));
 assert.throws(()=>session().propose(JSON.stringify(second),lineage(2),withPendingActorScope(packet,['a'],text)),'A target cannot skip unadmitted b');
 const unwanted=clone(second);unwanted.players.a=first.players.a;const rejected=session().propose(JSON.stringify(unwanted),lineage(2),scoped);assert.equal(rejected.globalEnvelopeValid,false);assert.equal(rejected.admittedActors.length,0);
 const broken=clone(second);broken.players.b.confidence=[];assert.equal(session().propose(JSON.stringify(broken),lineage(2),scoped).admittedActors.length,0,'Every original market entry remains required');
 const s=session(),oldA=s.retainedCanonicalHash('a'),p=s.propose(JSON.stringify(second),lineage(2),scoped);assert.deepEqual(p.requestedActorIds,['b']);assert.deepEqual(p.consumedActorIds,['b']);assert.deepEqual(p.ignoredActorIds,[]);retain(s,p);const done=s.finish();assert.equal(s.retainedCanonicalHash('a'),oldA);assert.equal(digest(done.review.players),digest(f.review.players));assert.equal(digest(packet),before);assert.equal(sha(gunzipSync(Buffer.from((f.attempts[0].usage as Usage).failureEvidence.draft.data,'base64')).toString()),(f.attempts[0].usage as Usage).actorAdmissionEvidence.draftSha256,'Original primary wire, including whitespace, is unchanged');
 assert.equal(f.attempts.length,2);console.log('Scoped correction PASS: original full input/aliases/claim schemas/market inventory, exact known-receipt retention/full-union replay, complete diagnostic/serialized bounds, malformed/foreign/omitted/extra actor refusal, two mocked requests only. No live inference.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
