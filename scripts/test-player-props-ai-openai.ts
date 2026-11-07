import assert from "node:assert/strict";
import {generateAiReview,structuredAiText,type AiRequest} from "../lib/playerPropsAi/openai";
const body:AiRequest={model:"gpt-6-luna",instructions:"Synthetic parser test",input:"{}",text:{},max_output_tokens:100,store:false};
const complete={id:"synthetic",model:"gpt-6-luna",status:"completed",usage:{input_tokens:10,output_tokens:5},output:[{content:[{type:"output_text",text:'{"ok":true}'}]}]};
async function main(){
  const events=[{type:"response.created",response:{id:"synthetic"}},{type:"response.output_text.delta",delta:"Synthetic"},{type:"response.completed",response:complete}];
  // Deliberately split every CRLF and UTF-8 sequence across network reads.
  const bytes=new TextEncoder().encode(events.map(e=>`data: ${JSON.stringify(e)}\r\n\r\n`).join(""));
  const mock=async(_url:unknown,options?:RequestInit)=>{
    const request=JSON.parse(String(options!.body));
    assert.equal(request.store,false);assert.equal(request.truncation,"disabled");assert.equal(request.max_output_tokens,100);
    assert.deepEqual(request.prompt_cache_options,{mode:"explicit"});
    return new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}}),{headers:{"content-type":"text/event-stream"}});
  };
  const ids:string[]=[],progress:{type:string;elapsedMs:number;textCharacters:number}[]=[];
  const response=await generateAiReview(body,{key:"synthetic-key",timeoutMs:10000,fetchImpl:mock as typeof fetch,onCreated:async id=>{ids.push(id);},onProgress:event=>progress.push(event)});
  assert.deepEqual(ids,["synthetic"]);assert.deepEqual(structuredAiText(response),{ok:true});
  assert.equal(progress.at(-1)!.textCharacters,9);assert.ok(progress.every(p=>Object.keys(p).sort().join("|")==="elapsedMs|textCharacters|type"));
  assert.throws(()=>structuredAiText({...complete,status:"incomplete"}),/incomplete/);
  assert.throws(()=>structuredAiText({...complete,output:[{content:[{type:"refusal"}]}]}),/refused/);
  const ended=async()=>new Response('data: {"type":"response.created","response":{"id":"unknown"}}\n\n',{headers:{"content-type":"text/event-stream"}});
  await assert.rejects(()=>generateAiReview(body,{key:"synthetic-key",timeoutMs:10000,fetchImpl:ended as typeof fetch}),/without_usage/);
  console.log("AI client stream checks passed: split network frames, exact usage receipts, privacy-safe progress, refusal/incomplete and unknown-completion handling. No real API calls.");
}
void main();
