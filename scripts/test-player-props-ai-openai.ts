import assert from "node:assert/strict";
import {generateAiReview,structuredAiText,AiGenerationError,unbilledFlexCapacity,type AiRequest} from "../lib/playerPropsAi/openai";
const body:AiRequest={model:"gpt-6-luna",instructions:"Synthetic parser test",input:"{}",text:{},max_output_tokens:100,store:false};
const complete={id:"synthetic",model:"gpt-6-luna",status:"completed",usage:{input_tokens:10,output_tokens:5},output:[{content:[{type:"output_text",text:'{"ok":true}'}]}]};
async function main(){
  const events=[{type:"response.created",response:{id:"synthetic"}},{type:"response.output_text.delta",delta:"Synthetic"},{type:"response.completed",response:complete}];
  // Deliberately split every CRLF and UTF-8 sequence across network reads.
  const bytes=new TextEncoder().encode(events.map(e=>`data: ${JSON.stringify(e)}\r\n\r\n`).join(""));
  const mock=async(_url:unknown,options?:RequestInit)=>{
    const request=JSON.parse(String(options!.body));
    assert.equal(request.store,false);assert.equal(request.stream,true);assert.equal(request.truncation,"disabled");assert.equal(request.max_output_tokens,100);
    assert.deepEqual(request.prompt_cache_options,{mode:"explicit"});
    return new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}}),{headers:{"content-type":"text/event-stream"}});
  };
  const ids:string[]=[],progress:{type:string;elapsedMs:number;textCharacters:number}[]=[];
  const response=await generateAiReview(body,{key:"synthetic-key",timeoutMs:10000,stream:true,fetchImpl:mock as typeof fetch,onCreated:async id=>{ids.push(id);},onProgress:event=>progress.push(event)});
  assert.deepEqual(ids,["synthetic"]);assert.deepEqual(structuredAiText(response),{ok:true});
  assert.equal(progress.at(-1)!.textCharacters,9);assert.ok(progress.every(p=>Object.keys(p).sort().join("|")==="elapsedMs|textCharacters|type"));
  assert.throws(()=>structuredAiText({...complete,status:"incomplete"}),/incomplete/);
  const json=await generateAiReview(body,{key:"synthetic-key",timeoutMs:10000,fetchImpl:(async(_url,options)=>{assert.equal(JSON.parse(String(options?.body)).stream,false);return Response.json(complete);}) as typeof fetch});
  assert.deepEqual(structuredAiText(json),{ok:true});assert.deepEqual(json.usage,complete.usage);
  const flex=await generateAiReview(body,{key:"synthetic-key",timeoutMs:10000,serviceTier:"flex",fetchImpl:(async(_url,options)=>{assert.equal(JSON.parse(String(options?.body)).service_tier,"flex");return Response.json({...complete,service_tier:"flex"});}) as typeof fetch});
  assert.equal(flex.service_tier,"flex");
  for(const [tier,code,unbilled] of [["flex","resource_unavailable",true],["flex","rate_limit_exceeded",false],["default","resource_unavailable",false]] as const){
    await assert.rejects(()=>generateAiReview(body,{key:"synthetic-key",timeoutMs:10000,serviceTier:tier,fetchImpl:(async()=>Response.json({error:{code}},{status:429})) as typeof fetch}),error=>error instanceof AiGenerationError&&error.knownUnbilled===unbilled);
  }
  for(const [status,tier,code,type,expected]of [[429,"flex","flex_unavailable","resource_unavailable",true],[429,"flex",null,"resource_unavailable",true],[429,"default","flex_unavailable","resource_unavailable",false],[503,"flex","flex_unavailable","resource_unavailable",false],[429,"flex","insufficient_quota","resource_unavailable",false],[429,"flex","rate_limit_exceeded","resource_unavailable",false],[429,"flex","flex_unavailable","insufficient_quota",false]] as const)assert.equal(unbilledFlexCapacity(status,tier,code,type),expected);
  await assert.rejects(()=>generateAiReview(body,{key:"synthetic-key",timeoutMs:10000,serviceTier:"flex",fetchImpl:(async()=>Response.json({error:{code:"flex_unavailable",type:"resource_unavailable"}},{status:429,headers:{"Retry-After":"300"}})) as typeof fetch}),error=>error instanceof AiGenerationError&&error.knownUnbilled&&error.code==="flex_unavailable"&&error.diagnostics?.code==="flex_unavailable"&&error.diagnostics.type==="resource_unavailable");
  for(const type of ["insufficient quota","rate-limit-exceeded / tokens",123,{code:"insufficient_quota"}])await assert.rejects(()=>generateAiReview(body,{key:"synthetic-key",timeoutMs:10000,serviceTier:"flex",fetchImpl:(async()=>Response.json({error:{code:"flex_unavailable",type}},{status:429})) as typeof fetch}),error=>error instanceof AiGenerationError&&!error.knownUnbilled&&error.diagnostics?.unrecognizedErrorFields?.includes("type")===true);
  let cancelled=false;
  const oversized=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4000001));},cancel(){cancelled=true;}}),{headers:{"content-type":"application/json"}});
  await assert.rejects(()=>generateAiReview(body,{key:"synthetic-key",timeoutMs:10000,fetchImpl:oversized as typeof fetch}),/oversize_response_body/);
  assert.equal(cancelled,true);
  assert.throws(()=>structuredAiText({...complete,output:[{content:[{type:"refusal"}]}]}),/refused/);
  const ended=async()=>new Response('data: {"type":"response.created","response":{"id":"unknown"}}\n\n',{headers:{"content-type":"text/event-stream"}});
  await assert.rejects(()=>generateAiReview(body,{key:"synthetic-key",timeoutMs:10000,fetchImpl:ended as typeof fetch}),/without_usage/);
  console.log("AI client stream checks passed: split network frames, exact usage receipts, privacy-safe progress, refusal/incomplete and unknown-completion handling. No real API calls.");
}
void main();
