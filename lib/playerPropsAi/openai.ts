import { invariant } from "./evidence";
import type { PropsAiModel } from "./releases";
export type AiUsage = { input_tokens: number; output_tokens: number; input_tokens_details?: { cache_write_tokens?: number; cache_write_tokens_details?: { ttl_12h_tokens?: number } }; output_tokens_details?: { reasoning_tokens?: number } };
export type AiResponse = { id: string; status: string; model: string; usage?: AiUsage; output?: { content?: { type: string; text?: string }[] }[] };
export type AiRequest = { model: PropsAiModel; instructions: string; input: string; text: unknown; max_output_tokens: number; store: false };
export async function countAiInput(body: AiRequest, args: { key: string; fetchImpl?: typeof fetch }) {
  const response = await (args.fetchImpl ?? fetch)("https://api.openai.com/v1/responses/input_tokens", {
    method: "POST", headers: { Authorization: `Bearer ${args.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: body.model, instructions: body.instructions, input: body.input, text: body.text }), signal: AbortSignal.timeout(45000),
  });
  invariant(response.ok, `input_count_http_${response.status}`);
  const data = await response.json(); invariant(Number.isSafeInteger(data.input_tokens) && data.input_tokens > 0, "invalid_input_token_count"); return data.input_tokens as number;
}
export async function generateAiReview(body: AiRequest, args: { key: string; timeoutMs: number; fetchImpl?: typeof fetch; onCreated?: (id: string) => Promise<void>; onProgress?: (event:{type:string;elapsedMs:number;textCharacters:number})=>void }): Promise<AiResponse> {
  const started=Date.now();let textCharacters=0;
  invariant(args.key && Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 && args.timeoutMs <= 180000, "invalid_generation_configuration");
  const response = await (args.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", { method: "POST",
    headers: { Authorization: `Bearer ${args.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true, service_tier: "default", truncation: "disabled", reasoning: { effort: "low" }, prompt_cache_options: { mode: "explicit" } }),
    signal: AbortSignal.timeout(args.timeoutMs),
  });
  invariant(response.ok, `generation_http_${response.status}`);
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return await response.json() as AiResponse;
  invariant(response.body, "missing_response_stream");
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "", bytes = 0;
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
      if(event.type==="response.output_text.delta")textCharacters+=typeof event.delta==="string"?event.delta.length:0;
      args.onProgress?.({type:String(event.type),elapsedMs:Date.now()-started,textCharacters});
      if (event.type === "response.created" && event.response?.id) await args.onCreated?.(event.response.id);
      if (["response.completed", "response.incomplete", "response.failed"].includes(event.type)) return event.response as AiResponse;
      invariant(event.type !== "error", "generation_stream_error");
    }
    invariant(!done, "response_ended_without_usage_receipt");
  }
}
export function structuredAiText(response: AiResponse) {
  invariant(response.status === "completed", `generation_${response.status}`);
  const content = response.output?.flatMap(o => o.content ?? []) ?? [];
  invariant(!content.some(c => c.type === "refusal"), "generation_refused");
  const texts = content.filter(c => c.type === "output_text"); invariant(texts.length === 1 && texts[0].text, "missing_structured_output");
  return JSON.parse(texts[0].text);
}
