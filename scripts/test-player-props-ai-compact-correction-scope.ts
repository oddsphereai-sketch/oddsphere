/** Regression for dense valid feedback disabling pending-only output. All HTTP mocked. */
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {runActorAdmissionAuditSelfTest} from './test-player-props-ai-actor-admission-audit';
import {withPendingActorScope,correctionActorIds,correctionScopeFittingReceipt} from '../lib/playerPropsAi/correctionActorScope';
import {jointReviewRequest} from '../lib/playerPropsAi/request';
import {PROPS_AI_PRIMARY_MODEL,PROPS_AI_RELEASE,propsReviewHasMemberExecutionContracts,propsReviewHasSemanticChecks,propsReviewHasVerifiedReaderClaims} from '../lib/playerPropsAi/releases';
import {OriginalPartActorAdmission} from '../lib/playerPropsAi/actorAdmission';
import {serializeAiRequest as serialize} from '../lib/playerPropsAi/openai';
import {digest} from '../lib/playerPropsAi/evidence';
async function main(){
 const f=await runActorAdmissionAuditSelfTest(),packet=f.packet,pending=['b'],before=digest(packet),prefix='Synthetic complete numeric finding and valid explicit-decline instructions.\n';
 const dense=prefix+'x'.repeat(1935-Buffer.byteLength(prefix)),legacy=dense+'\nKeep saved actors; return schema actor keys only.\nRETRY_ACTOR_SCOPE_V1=[1]';
 assert(Buffer.byteLength(JSON.stringify(legacy).slice(1,-1))>1984,'The previous full suffix cannot fit this real boundary');
 const text=withPendingActorScope(packet,pending,dense);assert(text.startsWith(dense));assert.notEqual(text,dense);assert.deepEqual(correctionActorIds(packet,text),pending);assert(Buffer.byteLength(JSON.stringify(text).slice(1,-1))<=1984);
 const full=jointReviewRequest(packet,PROPS_AI_PRIMARY_MODEL,7000,'synthetic original finding',dense),scoped=jointReviewRequest(packet,PROPS_AI_PRIMARY_MODEL,7000,'synthetic original finding',text);
 assert.equal(scoped.input,full.input);assert.deepEqual(scoped.text.format.schema.$defs,full.text.format.schema.$defs);assert.deepEqual((scoped.text.format.schema.properties.players as {required:string[]}).required,pending);assert(scoped.instructions.includes(dense));assert(scoped.instructions.includes('Return ONLY schema player keys'));assert.equal(scoped.max_output_tokens,7000);assert(Buffer.byteLength(JSON.stringify(scoped))<Buffer.byteLength(JSON.stringify(full)));
 const short='Synthetic complete finding.';assert.equal(withPendingActorScope(packet,pending,short),short+'\nKeep saved actors; return schema actor keys only.\nRETRY_ACTOR_SCOPE_V1=[1]','Previously fitting request text stays exact');
 for(const size of [1900,1935,1940,1950,1958,1960,1970,1980,1984]){
  const original='x'.repeat(size),result=withPendingActorScope(packet,pending,original),compact=original+'\nRETRY_ACTOR_SCOPE_V1=[1]',fits=Buffer.byteLength(JSON.stringify(compact).slice(1,-1))<=1984;
  assert(result.startsWith(original));assert.deepEqual(correctionActorIds(packet,result),fits?pending:packet.players.map(p=>p.id));if(!fits)assert.equal(result,original,'An unfitting scope cannot truncate a finding');
 }
 assert.throws(()=>withPendingActorScope(packet,['missing'],dense));assert.throws(()=>correctionActorIds(packet,text+'\nRETRY_ACTOR_SCOPE_V1=[1]'));
 const usage={padding:'x'.repeat(768000-Buffer.byteLength(JSON.stringify({padding:'',nextCorrectionText:dense})))};assert.equal(Buffer.byteLength(JSON.stringify({...usage,nextCorrectionText:dense})),768000);assert.equal(correctionScopeFittingReceipt(usage,dense,text),dense,'Targeting cannot displace an original combined receipt');
 type Archive={data:string};type Usage={failureEvidence:{draft:Archive;request:Archive};actorAdmissionEvidence:{lineage:Parameters<OriginalPartActorAdmission['propose']>[1]}};
 const u=f.attempts.map(a=>a.usage as unknown as Usage),decode=(a:Archive)=>gunzipSync(Buffer.from(a.data,'base64')).toString(),sha=(s:string)=>createHash('sha256').update(s).digest('hex'),firstDraft=decode(u[0].failureEvidence.draft),sourceHash=digest(packet),admission=new OriginalPartActorAdmission(packet),first=admission.propose(firstDraft,u[0].actorAdmissionEvidence.lineage);
 admission.retain(first,{receiptRecorded:true,receiptId:'synthetic-first-known',actualMicro:1,archivedInputDigest:sourceHash,archivedRequestSha256:sha(decode(u[0].failureEvidence.request)),archivedDraftSha256:sha(firstDraft)});
 const good=JSON.parse(decode(u[1].failureEvidence.draft)),focused=JSON.stringify({...good,players:{b:good.players.b}}),body=serialize(scoped,{serviceTier:'default'}),proposal=admission.propose(focused,{...u[1].actorAdmissionEvidence.lineage,requestHash:sha(body)},text);assert.deepEqual(proposal.requestedActorIds,pending);assert.deepEqual(proposal.consumedActorIds,pending);
 admission.retain(proposal,{receiptRecorded:true,receiptId:'synthetic-compact-known',actualMicro:1,archivedInputDigest:sourceHash,archivedRequestSha256:sha(body),archivedDraftSha256:sha(focused)});assert.deepEqual(admission.pendingActorIds(),[]);assert.equal(digest(admission.finish().review.players),digest(f.review.players),'All saved siblings, declined/null scopes and corrected actor stay exact');
 for(const release of [PROPS_AI_RELEASE,'player_props_ai_2026_11_26_r64_coupled_mean_tail_guidance','player_props_ai_2026_11_26_r63_retained_fixture_provenance']){assert(propsReviewHasMemberExecutionContracts(release));assert(propsReviewHasSemanticChecks(release));assert(propsReviewHasVerifiedReaderClaims(release));}
 assert.equal(digest(packet),before);console.log('Compact scope passed: dense1935-byte complete feedback targets only pending actor; full source/definitions/diagnostics/saved actors exact, legacy fitting form and byte/receipt/invalid-scope guards preserved; no network or paid calls.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
