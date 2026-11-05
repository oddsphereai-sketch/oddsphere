import {gzipSync} from "node:zlib";
import type {DailyEdgeResponse} from "@/app/lab/lib/labTypes";

/** Lossless published transport. A complete rolling slate can exceed the
 * buffered function limit; neither cards nor locked evidence may be trimmed. */
export function cbbPublishedResponse(payload:DailyEdgeResponse,headers:HeadersInit,acceptEncoding:string|null):Response{
  const bytes=Buffer.from(JSON.stringify(payload));
  const gzip=(acceptEncoding??"").split(",").some(part=>{
    const [coding,...parameters]=part.trim().toLowerCase().split(";");
    if(coding!=="gzip")return false;
    const q=parameters.find(p=>p.trim().startsWith("q="));
    return q===undefined||Number(q.trim().slice(2))>0;
  });
  const body=gzip?gzipSync(bytes):bytes;
  const outputHeaders=new Headers(headers);
  outputHeaders.set("Content-Type","application/json; charset=utf-8");
  outputHeaders.set("Vary",[outputHeaders.get("Vary"),"Accept-Encoding"].filter(Boolean).join(", "));
  if(gzip)outputHeaders.set("Content-Encoding","gzip");
  // Streaming also preserves the complete response for clients that explicitly
  // decline gzip. JSON semantics and browser response.json() remain unchanged.
  let offset=0;
  return new Response(new ReadableStream<Uint8Array>({pull(controller){
    if(offset>=body.byteLength){controller.close();return;}
    controller.enqueue(body.subarray(offset,offset+=32_768));
  }}),{headers:outputHeaders});
}
