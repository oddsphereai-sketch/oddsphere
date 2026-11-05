import assert from "node:assert/strict";
import {createCbbOutcomeArtifactDownload} from "../lib/services/cbb/cbbOutcomeArtifactStorage";
const key="a".repeat(64)+".json.gz",settings={supabaseURL:"https://synthetic.invalid",serviceRoleKey:"synthetic_service_key"};
void(async()=>{
 let calls=0;const download=createCbbOutcomeArtifactDownload({...settings,fetcher:async(url,options)=>{calls++;assert.equal(String(url),"https://synthetic.invalid/storage/v1/object/model-artifacts/cbb/contextual-outcome/"+key);assert.equal(options?.redirect,"error");assert.equal(options?.cache,"no-store");assert.equal(new Headers(options?.headers).get("authorization"),"Bearer synthetic_service_key");return new Response(new Uint8Array([1,2,3]),{headers:{"content-length":"3"}});}});
 assert.deepEqual(await download(key,3),new Uint8Array([1,2,3]));assert.equal(calls,1);await assert.rejects(download("../escape",3),/identity/);assert.equal(calls,1);
 const read=(response:Response)=>createCbbOutcomeArtifactDownload({...settings,fetcher:async()=>response})(key,3);
 await assert.rejects(read(new Response(new Uint8Array([1,2,3,4]))),/exceeds budget/);
 await assert.rejects(read(new Response(new Uint8Array([1,2]))),/size differs/);
 await assert.rejects(read(new Response(new Uint8Array([1,2,3]),{headers:{"content-length":"9"}})),/declared size/);
 await assert.rejects(read(new Response("private error body must not leak",{status:403})),e=>e instanceof Error&&e.message==="CBB private artifact download failed (HTTP 403)");
 assert.throws(()=>createCbbOutcomeArtifactDownload({...settings,supabaseURL:"https://user:password@synthetic.invalid"}),/configuration/);
 assert.throws(()=>createCbbOutcomeArtifactDownload({...settings,supabaseURL:"http://synthetic.invalid"}),/configuration/);
 const timed=createCbbOutcomeArtifactDownload({...settings,timeoutMs:1,fetcher:async(_url,options)=>new Promise((_resolve,reject)=>options!.signal!.addEventListener("abort",()=>reject(Error("aborted")),{once:true}))});await assert.rejects(timed(key,3),/aborted/);
 console.log("PASS private artifact storage: authenticated fixed path, no redirects, bounded streamed/declaration size, redacted errors and timeout; fake transport only, zero network/writes");
})();
