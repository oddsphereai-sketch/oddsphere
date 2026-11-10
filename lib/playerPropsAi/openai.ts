import { invariant } from "./evidence";
import type { PropsAiModel } from "./releases";
import {requireRealPropsAiPermission} from "./siteConfig";
export type AiUsage = { input_tokens: number; output_tokens: number; input_tokens_details?: { cache_write_tokens?: number; cache_write_tokens_details?: { ttl_12h_tokens?: number } }; output_tokens_details?: { reasoning_tokens?: number } };
export type AiTransportDiagnostics={unrecognizedErrorFields?:("code"|"type")[];status:number;code:string|null;type:string|null;requestId:string|null;retryAfter:string|null;rateLimits:Record<string,string>};
export type AiResponse = { transportDiagnostics?:AiTransportDiagnostics; id: string; status: string; model: string; service_tier?:string; usage?: AiUsage; output?: { content?: { type: string; text?: string }[] }[] };
export type AiRequest = { model: PropsAiModel; instructions: string; input: string; text: unknown; max_output_tokens: number; store: false };
export class AiGenerationError extends Error {
  constructor(readonly status:number,readonly code:string|null,readonly knownUnbilled:boolean,readonly diagnostics?:AiTransportDiagnostics){super(`generation_http_${status}${knownUnbilled?"_resource_unavailable":""}`);}
}
const safeCode=(v:unknown)=>typeof v==="string"&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v)&&!/sk-|bearer/i.test(v)?v:null;
const rateHeaders=["x-ratelimit-limit-requests","x-ratelimit-limit-tokens","x-ratelimit-remaining-requests","x-ratelimit-remaining-tokens","x-ratelimit-reset-requests","x-ratelimit-reset-tokens","x-ratelimit-limit-project-tokens","x-ratelimit-remaining-project-tokens","x-ratelimit-reset-project-tokens"];
function transportDiagnostics(response:Response,code:string|null=null,type:string|null=null):AiTransportDiagnostics{
 const rateLimits=Object.fromEntries(rateHeaders.flatMap(name=>{const value=response.headers.get(name);const valid=name.includes("-reset-")?/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/.test(value??""):/^\d{1,20}$/.test(value??"");return value&&value.length<=96&&valid?[[name,value]]:[];}));
 const retry=response.headers.get("retry-after");
 return {status:response.status,code,type,requestId:safeCode(response.headers.get("x-request-id")),retryAfter:retry&&retry.length<=96&&(/^[0-9]+(?:\.[0-9]+)?$/.test(retry)||/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(retry)&&Number.isFinite(Date.parse(retry))&&new Date(retry).toUTCString()===retry)?retry:null,rateLimits};
}
/** Explicit Flex capacity rejection only; billing/rate/conflicting errors stay unknown. */
export function unbilledFlexCapacity(status:number,tier:string|undefined,code:string|null,type:string|null,explicitCode=code!==null,explicitType=type!==null){
 if(status!==429||tier!=="flex"||explicitType&&type===null)return false;
 const types=["resource_unavailable","resource_unavailable_error"],codes=[...types,"flex_unavailable"];
 return explicitCode?code!==null&&codes.includes(code)&&(type===null||types.includes(type)):types.includes(type??"");
}
export function serializeAiRequest(body:AiRequest,args:{serviceTier?:"default"|"flex";stream?:boolean}={}){
 return JSON.stringify({...body,stream:args.stream??false,service_tier:args.serviceTier??"default",truncation:"disabled",reasoning:{effort:"low"},prompt_cache_options:{mode:"explicit"}});
}
/** Bound bytes while reading, before error-body allocation/JSON parsing. */
async function boundedErrorText(response:Response){
 if(!response.body)return "";const reader=response.body.getReader(),decoder=new TextDecoder();let text="",bytes=0;
 try{while(true){const {value,done}=await reader.read();bytes+=value?.byteLength??0;if(bytes>16384)return "";text+=decoder.decode(value,{stream:!done});if(done)return text;}}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
export async function countAiInput(body: AiRequest, args: { key: string; fetchImpl?: typeof fetch;deadline?:number|(()=>number);signal?:AbortSignal }) {
  if(!args.fetchImpl)requireRealPropsAiPermission();
  const deadline=()=>typeof args.deadline==="function"?args.deadline():args.deadline;
  const limit=deadline(),remaining=limit===undefined?45000:Math.floor(limit-Date.now());
  invariant(Number.isFinite(remaining)&&remaining>0,"input_count_deadline_exhausted");
  invariant(!args.signal?.aborted,"input_count_deadline_exhausted");
  const timeout=AbortSignal.timeout(Math.min(45000,remaining));
  const response = await (args.fetchImpl ?? fetch)("https://api.openai.com/v1/responses/input_tokens", {
    method: "POST", headers: { Authorization: `Bearer ${args.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: body.model, instructions: body.instructions, input: body.input, text: body.text }), signal: args.signal?AbortSignal.any([timeout,args.signal]):timeout,
  });
  invariant(response.ok, `input_count_http_${response.status}`);
  const data = await response.json();
  const completedLimit=deadline();
  invariant(!args.signal?.aborted&&(completedLimit===undefined||Date.now()<=completedLimit),"input_count_completed_after_deadline");
  invariant(Number.isSafeInteger(data.input_tokens) && data.input_tokens > 0, "invalid_input_token_count"); return data.input_tokens as number;
}
export async function generateAiReview(body: AiRequest, args: { key: string; timeoutMs: number; fetchImpl?: typeof fetch; serviceTier?:"default"|"flex"; stream?:boolean; onOutputText?:(delta:string)=>void; onCreated?: (id: string) => Promise<void>; onProgress?: (event:{type:string;elapsedMs:number;textCharacters:number})=>void }): Promise<AiResponse> {
  if(!args.fetchImpl)requireRealPropsAiPermission();
  const started=Date.now();let textCharacters=0;
  invariant(args.key && Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 && args.timeoutMs <= 180000, "invalid_generation_configuration");
  const response = await (args.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", { method: "POST",
    headers: { Authorization: `Bearer ${args.key}`, "Content-Type": "application/json" },
    body: serializeAiRequest(body,args),
    signal: AbortSignal.timeout(args.timeoutMs),
  });
  if(!response.ok){
    let code:string|null=null,type:string|null=null,explicitCode=false,explicitType=false;
    try{const error=JSON.parse(await boundedErrorText(response))?.error;explicitCode=error?.code!==null&&error?.code!==undefined;explicitType=error?.type!==null&&error?.type!==undefined;code=safeCode(error?.code);type=safeCode(error?.type);}catch{}
    throw new AiGenerationError(response.status,code??(explicitCode?null:type),unbilledFlexCapacity(response.status,args.serviceTier,code,type,explicitCode,explicitType),{...transportDiagnostics(response,code,type),unrecognizedErrorFields:[...(explicitCode&&code===null?["code" as const]:[]),...(explicitType&&type===null?["type" as const]:[])]});
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    invariant(response.body,"missing_response_body");
    const reader=response.body.getReader(),decoder=new TextDecoder();let text="",bytes=0;
    try{while(true){const {value,done}=await reader.read();bytes+=value?.byteLength??0;invariant(bytes<=4000000,"oversize_response_body");text+=decoder.decode(value,{stream:!done});if(done)break;}}
    finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
    const result=JSON.parse(text) as AiResponse;
    const visible=result.output?.flatMap(o=>o.content??[]).filter(c=>c.type==="output_text").map(c=>c.text??"").join("")??"";
    args.onOutputText?.(visible);args.onProgress?.({type:`response.${result.status}`,elapsedMs:Date.now()-started,textCharacters:visible.length});
    return {...result,transportDiagnostics:transportDiagnostics(response)};
  }
  invariant(response.body, "missing_response_stream");
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "", bytes = 0;
  try{
  while (true) {
    const { value, done } = await reader.read(); bytes += value?.byteLength ?? 0;
    invariant(bytes <= 4_000_000, "oversize_response_stream");
    pending = (pending+decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");
    let boundary;
    while ((boundary = pending.indexOf("\n\n")) >= 0) {
      const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
      const text = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
      if (!text || text === "[DONE]") continue;
      const event = JSON.parse(text);
      if(event.type==="response.output_text.delta"&&typeof event.delta==="string"){textCharacters+=event.delta.length;args.onOutputText?.(event.delta);}
      args.onProgress?.({type:String(event.type),elapsedMs:Date.now()-started,textCharacters});
      if (event.type === "response.created" && event.response?.id) await args.onCreated?.(event.response.id);
      if (["response.completed", "response.incomplete", "response.failed"].includes(event.type)) return {...event.response,transportDiagnostics:transportDiagnostics(response)} as AiResponse;
      invariant(event.type !== "error", "generation_stream_error");
    }
    invariant(!done, "response_ended_without_usage_receipt");
  }
  }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
export function structuredAiText(response: AiResponse) {
  invariant(response.status === "completed", `generation_${response.status}`);
  const content = response.output?.flatMap(o => o.content ?? []) ?? [];
  invariant(!content.some(c => c.type === "refusal"), "generation_refused");
  const texts = content.filter(c => c.type === "output_text"); invariant(texts.length === 1 && texts[0].text, "missing_structured_output");
  return JSON.parse(texts[0].text);
}
