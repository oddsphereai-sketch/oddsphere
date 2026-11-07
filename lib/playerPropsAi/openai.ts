import { invariant } from "./evidence";
import type { PropsAiModel } from "./releases";
export type AiUsage = { input_tokens: number; output_tokens: number; input_tokens_details?: { cache_write_tokens?: number; cache_write_tokens_details?: { ttl_12h_tokens?: number } }; output_tokens_details?: { reasoning_tokens?: number } };
export type AiResponse = { id: string; status: string; model: string; service_tier?:string; usage?: AiUsage; output?: { content?: { type: string; text?: string }[] }[] };
export type AiRequest = { model: PropsAiModel; instructions: string; input: string; text: unknown; max_output_tokens: number; store: false };
export class AiGenerationError extends Error {
  constructor(readonly status:number,readonly code:string|null,readonly knownUnbilled:boolean){super(`generation_http_${status}${knownUnbilled?"_resource_unavailable":""}`);}
}
export async function countAiInput(body: AiRequest, args: { key: string; fetchImpl?: typeof fetch }) {
  const response = await (args.fetchImpl ?? fetch)("https://api.openai.com/v1/responses/input_tokens", {
    method: "POST", headers: { Authorization: `Bearer ${args.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: body.model, instructions: body.instructions, input: body.input, text: body.text }), signal: AbortSignal.timeout(45000),
  });
  invariant(response.ok, `input_count_http_${response.status}`);
  const data = await response.json(); invariant(Number.isSafeInteger(data.input_tokens) && data.input_tokens > 0, "invalid_input_token_count"); return data.input_tokens as number;
}
export async function generateAiReview(body: AiRequest, args: { key: string; timeoutMs: number; fetchImpl?: typeof fetch; serviceTier?:"default"|"flex"; stream?:boolean; onOutputText?:(delta:string)=>void; onCreated?: (id: string) => Promise<void>; onProgress?: (event:{type:string;elapsedMs:number;textCharacters:number})=>void }): Promise<AiResponse> {
  const started=Date.now();let textCharacters=0;
  invariant(args.key && Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 && args.timeoutMs <= 180000, "invalid_generation_configuration");
  const response = await (args.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", { method: "POST",
    headers: { Authorization: `Bearer ${args.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: args.stream??false, service_tier: args.serviceTier??"default", truncation: "disabled", reasoning: { effort: "low" }, prompt_cache_options: { mode: "explicit" } }),
    signal: AbortSignal.timeout(args.timeoutMs),
  });
  if(!response.ok){
    let code:string|null=null;
    // Only explicit Flex capacity rejection is documented as uncharged.
    try{const text=await response.text();if(text.length<=16384){const error=JSON.parse(text)?.error;code=typeof error?.code==="string"?error.code:typeof error?.type==="string"?error.type:null;}}catch{}
    throw new AiGenerationError(response.status,code,args.serviceTier==="flex"&&response.status===429&&["resource_unavailable","resource_unavailable_error"].includes(code??""));
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    invariant(response.body,"missing_response_body");
    const reader=response.body.getReader(),decoder=new TextDecoder();let text="",bytes=0;
    try{while(true){const {value,done}=await reader.read();bytes+=value?.byteLength??0;invariant(bytes<=4000000,"oversize_response_body");text+=decoder.decode(value,{stream:!done});if(done)break;}}
    finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
    const result=JSON.parse(text) as AiResponse;
    const visible=result.output?.flatMap(o=>o.content??[]).filter(c=>c.type==="output_text").map(c=>c.text??"").join("")??"";
    args.onOutputText?.(visible);args.onProgress?.({type:`response.${result.status}`,elapsedMs:Date.now()-started,textCharacters:visible.length});
    return result;
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
      if (["response.completed", "response.incomplete", "response.failed"].includes(event.type)) return event.response as AiResponse;
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
