/** Offline failure diagnostics: synthetic bytes, no provider/model requests. */
import assert from "node:assert/strict";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {physicalLawFindings,physicalCorrectionSummary} from "../lib/playerPropsAi/physicalDiagnostics";
import {archiveFailureBytes,failureEvidence} from "../lib/playerPropsAi/failureEvidence";
import {correctionFeedback,parseJointReview} from "../lib/playerPropsAi/request";
import {validateLaw} from "../lib/playerPropsAi/law";
import {PRODUCT_RELEASE,type GamePacket} from "../lib/playerPropsAi/evidenceContract";
import {generateAiReview,AiGenerationError,serializeAiRequest,type AiRequest} from "../lib/playerPropsAi/openai";
const vector=(v:number)=>Array<number>(16).fill(v),at="2026-11-09T16:00:00Z";
const packet:GamePacket={release:PRODUCT_RELEASE,sport:"nba",gameId:"synthetic",start:"2026-11-09T23:00:00Z",lock:"2026-11-09T22:00:00Z",stage:"early",cutoff:at,quotes:[],sourceLimitations:[],players:Array.from({length:8},(_,i)=>({id:`p${i}`,name:`Synthetic ${i}`,team:"A",opponent:"B",markets:["points"],evidence:[],missing:[]}))};
const raw={weights:vector(1),outcomes:{points:vector(1),rebounds:vector(4),assists:vector(3),threes:vector(4)}};
const draft={players:Object.fromEntries(packet.players.map(p=>[p.id,{law:raw}]))},before=JSON.stringify(draft);
const issues=physicalLawFindings(packet,draft);assert.equal(issues.length,128);assert.equal(JSON.stringify(draft),before);
const feedback=correctionFeedback(physicalCorrectionSummary(issues));assert.ok(Buffer.byteLength(feedback)<2048);for(let i=0;i<8;i++)assert.ok(feedback.includes(`P${i} S0`));
const nfl={...packet,sport:"nfl" as const,players:packet.players.map(p=>({...p,markets:["passing_yards"]}))};
const badNfl={players:Object.fromEntries(nfl.players.map(p=>[p.id,{law:{weights:vector(1),outcomes:{passing_attempts:vector(2),passing_completions:vector(0),passing_tds:vector(1),interceptions:vector(3),passing_yards:vector(202)}}}]))};
const nflIssues=physicalLawFindings(nfl,badNfl);assert.equal(nflIssues.length,384);for(let i=0;i<8;i++)assert.ok(correctionFeedback(physicalCorrectionSummary(nflIssues)).includes(`P${i} `));
const mlb={...packet,sport:"mlb" as const,players:packet.players.map(p=>({...p,markets:["batter_home_runs"]}))};
const mlbIssues=physicalLawFindings(mlb,{players:Object.fromEntries(mlb.players.map(p=>[p.id,{law:{weights:vector(1),outcomes:{batter_home_runs:vector(3),batter_runs_scored:vector(1),batter_rbis:vector(0)}}}]))});assert.equal(mlbIssues.length,256);
for(let i=0;i<8;i++)assert.ok(correctionFeedback(physicalCorrectionSummary(mlbIssues)).includes(`P${i} `));
const valid={...raw,outcomes:{...raw.outcomes,points:vector(12)}};const hash=validateLaw("nba",packet.players[0],valid).hash;assert.equal(physicalLawFindings(packet,{players:{p0:{law:valid}}}).length,0);assert.equal(validateLaw("nba",packet.players[0],valid).hash,hash);
assert.equal(physicalLawFindings(nfl,{players:{p0:{law:{weights:vector(1),outcomes:{passing_attempts:vector(1),passing_completions:vector(1),passing_tds:vector(0),interceptions:vector(0),passing_yards:vector(-3)}}}}}).length,0);
assert.equal(physicalLawFindings(packet,{players:{p0:{law:null}}}).length,0);assert.deepEqual(physicalLawFindings(packet,null),[]);
const original=" \n"+before+"\n",archive=archiveFailureBytes(original);const decoded=gunzipSync(Buffer.from(archive.data,"base64"));assert.equal(decoded.toString(),original);assert.equal(decoded.length,archive.bytes);assert.equal(createHash("sha256").update(decoded).digest("hex"),archive.sha256);
const request:AiRequest={model:"gpt-6-luna",instructions:"Synthetic data",input:"{}",text:{},max_output_tokens:7000,store:false};
const exactBody=serializeAiRequest(request,{serviceTier:"default"});const evidence=failureEvidence({packet,requestBody:exactBody,draftText:original,reason:"Physical identity failed",physical:issues});assert.ok("request" in evidence);assert.equal(gunzipSync(Buffer.from(evidence.request!.data,"base64")).toString(),exactBody);assert.ok(!JSON.stringify(evidence).includes("synthetic-secret-key"));
const unavailable=failureEvidence({packet,requestBody:"x".repeat(16_000_001),draftText:null,reason:"A known failed draft",physical:issues});assert.ok("archiveUnavailable" in unavailable);assert.equal(unavailable.archiveUnavailable,"bounded_archive_construction_failed");assert.equal(unavailable.reason,"A known failed draft");
async function main(){
 for(const code of ["rate_limit_exceeded","insufficient_quota","credit_balance_exhausted"]){let calls=0;await assert.rejects(()=>generateAiReview(request,{key:"synthetic-secret-key",timeoutMs:10000,fetchImpl:(async()=>{calls++;return Response.json({error:{code,type:code==="rate_limit_exceeded"?"tokens":"insufficient_quota",message:"Do not retain raw message synthetic-secret-key"}},{status:429,headers:{"x-request-id":"req_synthetic","retry-after":"60","x-ratelimit-limit-tokens":"1000000","authorization":"Bearer synthetic-secret-key"}});}) as typeof fetch}),error=>{assert.ok(error instanceof AiGenerationError);assert.equal(error.code,code);assert.equal(error.knownUnbilled,false);assert.equal(error.diagnostics?.requestId,"req_synthetic");assert.equal(error.diagnostics?.retryAfter,"60");assert.equal(error.diagnostics?.rateLimits["x-ratelimit-limit-tokens"],"1000000");assert.ok(!JSON.stringify(error.diagnostics).includes("synthetic-secret-key"));return true;});assert.equal(calls,1,"ordinary 429 is never retried by transport");}
 for(const retry of ["Bearer sk-proj-synthetic-secret 2026","trace:sk-proj-synthetic-secret"]){await assert.rejects(()=>generateAiReview(request,{key:"synthetic",timeoutMs:10000,fetchImpl:(async()=>Response.json({error:{code:"trace:sk-proj-synthetic-secret",type:"trace:sk-proj-synthetic-secret"}},{status:429,headers:{"x-request-id":"trace:sk-proj-synthetic-secret","retry-after":retry}})) as typeof fetch}),error=>{assert.ok(error instanceof AiGenerationError);assert.equal(error.code,null);assert.equal(error.diagnostics?.type,null);assert.equal(error.diagnostics?.requestId,null);assert.equal(error.diagnostics?.retryAfter,null);return true;});}
 let cancelled=false;await assert.rejects(()=>generateAiReview(request,{key:"synthetic",timeoutMs:10000,fetchImpl:(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(16385));},cancel(){cancelled=true;}}),{status:429,headers:{"x-request-id":"req_large"}})) as typeof fetch}),error=>error instanceof AiGenerationError&&error.code===null&&error.diagnostics?.requestId==="req_large");assert.equal(cancelled,true);
 let observed="";const good=await generateAiReview(request,{key:"synthetic-secret-key",timeoutMs:10000,fetchImpl:(async(_url,o)=>{observed=String(o?.body);return Response.json({id:"r",status:"completed",model:"gpt-6-luna",usage:{input_tokens:1,output_tokens:1},output:[]},{headers:{"x-ratelimit-limit-tokens":"1000000","x-ratelimit-remaining-tokens":"800000","x-ratelimit-reset-tokens":"12s"}});}) as typeof fetch});assert.equal(observed,exactBody);assert.equal(good.transportDiagnostics?.rateLimits["x-ratelimit-limit-tokens"],"1000000");
 // Existing parser remains strict; diagnostics never make an invalid draft valid.
 assert.throws(()=>parseJointReview(packet,{wireRelease:"invalid",...draft}),/wire release/);
 console.log("Failure-evidence checks passed: all-player/scenario findings, existing feedback bound, exact private bytes, unchanged law hashes, bounded error reads, distinct rate/quota metadata, successful limit headers and no ordinary-429 retry. All HTTP mocked.");
}
void main();
