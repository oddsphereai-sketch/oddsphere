/** Real reviewer plumbing; all Responses/count HTTP is mocked. No live inference. */
import assert from 'node:assert/strict';
import {runActorAdmissionAuditSelfTest} from './test-player-props-ai-actor-admission-audit';
import {jointReviewRequest} from '../lib/playerPropsAi/request';
import {serializeAiRequest,countAiInput,generateAiReview,structuredAiText,type AiRequest} from '../lib/playerPropsAi/openai';
import {usageMicroUsd} from '../lib/playerPropsAi/budget';
import {digest} from '../lib/playerPropsAi/evidence';
import {PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL,PROPS_AI_MAX_OUTPUT_PER_REQUEST,PROPS_AI_RELEASE,propsReviewUsesMediumCorrectionReasoning,propsReviewHasMemberExecutionContracts,propsReviewHasVerifiedReaderClaims,propsReviewHasSemanticChecks} from '../lib/playerPropsAi/releases';

async function main(){
 const f=await runActorAdmissionAuditSelfTest(),before=digest(f.packet),bodies=f.bodies.map(s=>JSON.parse(s));
 assert.equal(bodies.length,2,'Exactly the existing primary/correction HTTP pair');
 assert.equal(bodies[0].reasoning.effort,'low');assert.equal(bodies[1].reasoning.effort,'medium');
 assert.equal(bodies[1].model,PROPS_AI_PRIMARY_MODEL);assert.equal(bodies[1].service_tier,'default');
 assert.deepEqual(bodies[1].reasoning,{effort:'medium'},'No Pro mode or other inference expansion');
 for(const body of bodies){assert.equal(body.max_output_tokens,7000);assert.equal(body.store,false);assert.equal(body.truncation,'disabled');}
 const primary=jointReviewRequest(f.packet,PROPS_AI_PRIMARY_MODEL,7000),correction=jointReviewRequest(f.packet,PROPS_AI_PRIMARY_MODEL,7000,'Synthetic original rejection','\nSynthetic complete findings.');
 const legacySerialize=(body:AiRequest)=>{const base={...body};delete base.reasoning;return JSON.stringify({...base,stream:false,service_tier:'default',truncation:'disabled',reasoning:{effort:'low'},prompt_cache_options:{mode:'explicit'}});};
 assert.equal(serializeAiRequest(primary),legacySerialize(primary),'Primary request byte shape stays unchanged');
 const current=JSON.parse(serializeAiRequest(correction)),old=JSON.parse(legacySerialize(correction));
 old.reasoning.effort='medium';assert.deepEqual(current,old,'Only the existing correction reasoning metadata changes');
 assert.equal(correction.input,primary.input);assert.deepEqual(correction.text,primary.text,'Full unscoped source/schema unchanged');
 const stronger=jointReviewRequest(f.packet,PROPS_AI_STRONG_MODEL,7000,'Synthetic original rejection');
 assert.equal(JSON.parse(serializeAiRequest(stronger)).reasoning.effort,'low','Configured stronger-model contract is unchanged');
 assert.throws(()=>serializeAiRequest({...stronger,reasoning:{effort:'medium'}}),/configured primary model/);
 const older='player_props_ai_2026_11_26_r65_compact_correction_scope';
 const legacyBody={...primary,instructions:'Synthetic original-generation instructions'};
 assert.equal(serializeAiRequest(legacyBody),legacySerialize(legacyBody),'Default legacy transport remains low and byte exact; original-generation modules own archived request replay');
 assert(propsReviewUsesMediumCorrectionReasoning(PROPS_AI_RELEASE));assert(propsReviewUsesMediumCorrectionReasoning('player_props_ai_2026_11_26_r66_correction_reasoning'));assert(!propsReviewUsesMediumCorrectionReasoning(older));assert(!propsReviewUsesMediumCorrectionReasoning('unknown'));
 let counts=0;const counted:string[]=[];
 const countMock=async(_url:unknown,init?:RequestInit)=>{counts++;counted.push(String(init?.body));return Response.json({input_tokens:1000});};
 await countAiInput(primary,{key:'synthetic',fetchImpl:countMock});await countAiInput(correction,{key:'synthetic',fetchImpl:countMock});
 assert.equal(counts,2);assert.deepEqual(JSON.parse(counted[0]).input,JSON.parse(counted[1]).input);
 assert(!counted.some(s=>s.includes('"reasoning"')),'No new counted source or count endpoint behavior');
 let invalidHttp=0;
 for(const reasoning of [null,{},'medium',{effort:'high'},{effort:'medium',mode:'pro'},{effort:'low',extra:true}]){
  const invalid={...primary,reasoning} as unknown as AiRequest;
  assert.throws(()=>serializeAiRequest(invalid),/Unsupported props reasoning/);
  await assert.rejects(generateAiReview(invalid,{key:'synthetic',timeoutMs:1000,fetchImpl:async()=>{invalidHttp++;throw Error('Must not send invalid reasoning');}}),/Unsupported props reasoning/);
 }
 assert.equal(invalidHttp,0);
 const cap=PROPS_AI_MAX_OUTPUT_PER_REQUEST;assert.equal(cap,7000);
 const lowUsage={input_tokens:145000,output_tokens:cap,output_tokens_details:{reasoning_tokens:300}};
 const mediumUsage={...lowUsage,output_tokens_details:{reasoning_tokens:6000}};
 assert.equal(usageMicroUsd(PROPS_AI_PRIMARY_MODEL,lowUsage,'default'),18000);
 assert.equal(usageMicroUsd(PROPS_AI_PRIMARY_MODEL,mediumUsage,'default'),18000,'Reasoning is included in total output, never an extra cap or double charge');
 let incompleteHttp=0;
 const incomplete=await generateAiReview(correction,{key:'synthetic',timeoutMs:1000,fetchImpl:async(_url,init)=>{
  incompleteHttp++;const sent=JSON.parse(String(init?.body));assert.equal(sent.reasoning.effort,'medium');assert.equal(sent.max_output_tokens,cap);
  return Response.json({id:'synthetic-capped',model:PROPS_AI_PRIMARY_MODEL,status:'incomplete',service_tier:'default',usage:{input_tokens:1000,output_tokens:cap,output_tokens_details:{reasoning_tokens:6900}},output:[]});
 }});
 assert.equal(incompleteHttp,1);assert.throws(()=>structuredAiText(incomplete));
 assert.equal(digest(f.packet),before);assert.equal(f.review.players.length,f.packet.players.length,'Actual known-receipt sibling retention remains complete');
 for(const release of [PROPS_AI_RELEASE,'player_props_ai_2026_11_26_r65_compact_correction_scope','player_props_ai_2026_11_26_r64_coupled_mean_tail_guidance']){assert(propsReviewHasMemberExecutionContracts(release));assert(propsReviewHasVerifiedReaderClaims(release));assert(propsReviewHasSemanticChecks(release));}
 console.log('Correction reasoning policy passed: same two phases/model/tier/7000 total output and cost escrow; primary/stronger low exact, Luna correction medium only, complete original sources/known-receipt union preserved, invalid settings cannot send and capped incomplete responses stay rejected. No live HTTP or claim of future numerical success.');
}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>{console.error(e);process.exitCode=1;});
