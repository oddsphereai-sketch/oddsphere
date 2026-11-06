/** Manually invoked, LOCAL evaluation only. Never imported by a route, writer or cron. */
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, fsyncSync } from "node:fs";
import path from "node:path";
import { digest, invariant, request, reviewKey, validateReview, parseRequiredReview } from "./core";
import { bill, type Model } from "./validation";
import type { GamePacket } from "./catalog";
import { readableRequest, expandReadableCitations } from "./readable";
import { pointForecasts } from "./point-forecast";
import { probabilityProposals } from "./probability-proposals";

export const TEST_CEILING_USD = 2;
export type Attempt = { id: string; job: string; model: Model; reservedUsd: number; actualUsd: number | null;
  status: string; inputTokens: number; outputTokens: number | null; responseId?: string; qualityError?: string;
  billingCorrection?: { previousUsd: number; correctedUsd: number; at: string; reason: string } };
type Ledger = { schema: 1; ceilingUsd: number; attempts: Attempt[] };
export class TestBudget {
  constructor(readonly file: string) {}
  transaction<T>(fn: (ledger: Ledger) => T): T {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const lock = `${this.file}.lock`, fd = openSync(lock, "wx", 0o600);
    try {
      let ledger: Ledger;
      try { ledger = JSON.parse(readFileSync(this.file, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; ledger = { schema: 1, ceilingUsd: TEST_CEILING_USD, attempts: [] }; }
      invariant(ledger.schema === 1 && ledger.ceilingUsd === TEST_CEILING_USD && Array.isArray(ledger.attempts), "Invalid/changed test budget");
      invariant(ledger.attempts.every(a => Number.isFinite(a.reservedUsd) && a.reservedUsd >= 0 && (a.actualUsd === null || Number.isFinite(a.actualUsd) && a.actualUsd >= 0)), "Invalid ledger balances");
      const result = fn(ledger), temp = `${this.file}.${process.pid}.tmp`;
      const output = openSync(temp, "w", 0o600);
      try { writeFileSync(output, JSON.stringify(ledger, null, 2)); fsyncSync(output); } finally { closeSync(output); }
      renameSync(temp, this.file);
      return result;
    } finally { closeSync(fd); unlinkSync(lock); }
  }
  reserve(attempt: Attempt) {
    return this.reserveMany([attempt]);
  }
  reserveMany(attempts: Attempt[]) {
    return this.transaction(ledger => {
      invariant(attempts.length > 0 && new Set(attempts.map(a => a.id)).size === attempts.length, "Duplicate/empty reservation batch");
      invariant(!attempts.some(attempt => ledger.attempts.some(a => a.id === attempt.id)), "Request already attempted; no automatic repeat");
      const held = ledger.attempts.reduce((n, a) => n + (a.actualUsd ?? a.reservedUsd), 0);
      const next = attempts.reduce((n, a) => n + a.reservedUsd, 0);
      invariant(held + next <= TEST_CEILING_USD, `Test ceiling would be exceeded; held=${held.toFixed(6)} next=${next.toFixed(6)}`);
      ledger.attempts.push(...attempts); return { held: held + next, ceiling: TEST_CEILING_USD };
    });
  }
  claim(attempt: Attempt) {
    this.transaction(ledger => {
      const saved = ledger.attempts.find(a => a.id === attempt.id);
      invariant(saved && saved.status === "reserved" && saved.model === attempt.model && saved.job === attempt.job && saved.inputTokens === attempt.inputTokens && saved.reservedUsd >= attempt.reservedUsd, "Invalid/already claimed reservation");
      saved.status = "sending";
    });
  }
  update(id: string, update: Partial<Attempt>) {
    this.transaction(ledger => {
      const attempt = ledger.attempts.find(a => a.id === id); invariant(attempt, "Unreserved request");
      invariant(update.actualUsd === undefined || update.actualUsd === null || update.actualUsd <= attempt.reservedUsd, "Usage exceeds reserved bound; stop and reconcile");
      Object.assign(attempt, update);
    });
  }
}
export async function postOpenAi(endpoint: "responses" | "responses/input_tokens", body: unknown, fetchImpl: typeof fetch = fetch, onCreated?: (id: string) => void, onHeaders?: (headers: Record<string, string>) => void) {
  const key = process.env.OPENAI_API_KEY; invariant(key, "Configure OPENAI_API_KEY securely in the evaluation environment");
  const response = await fetchImpl(`https://api.openai.com/v1/${endpoint}`, { method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) });
  onHeaders?.(Object.fromEntries(["x-request-id", "x-ratelimit-limit-requests", "x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens", "x-ratelimit-reset-tokens"].flatMap(k => response.headers.get(k) ? [[k, response.headers.get(k)!]] : [])));
  if (response.ok && response.headers.get("content-type")?.includes("text/event-stream")) {
    invariant(response.body, "Missing response stream");
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "";
    while (true) {
      const { done, value } = await reader.read(); pending += decoder.decode(value, { stream: !done });
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data);
        if (event.type === "response.created" && event.response?.id) onCreated?.(event.response.id);
        if (["response.completed", "response.incomplete", "response.failed"].includes(event.type)) return event.response;
        invariant(event.type !== "error", `OpenAI stream error: ${event.code ?? "unknown"}`);
      }
      if (done) throw new Error("Stream ended without a final usage receipt; reservation retained");
    }
  }
  const json = await response.json();
  invariant(response.ok, `OpenAI HTTP ${response.status}; code=${json.error?.code ?? "unknown"}; type=${json.error?.type ?? "unknown"}`);
  return json;
}
export function countedBody(body: ReturnType<typeof request>) {
  return { model: body.model, instructions: body.instructions, input: body.input, text: body.text };
}
export async function countInput(body: ReturnType<typeof request>, fetchImpl: typeof fetch = fetch): Promise<number> {
  const count = await postOpenAi("responses/input_tokens", countedBody(body), fetchImpl);
  invariant(Number.isSafeInteger(count.input_tokens) && count.input_tokens > 0, "Invalid API input count"); return count.input_tokens;
}
export function caseReservation(packet: GamePacket, model: Model, maxOutput: number, label: string, inputTokens: number, format?: "codec" | "readable"): Attempt {
  const body = format === "readable" ? readableRequest(packet, model, maxOutput) : request(packet, model, maxOutput);
  const reservedUsd = Math.ceil(bill(model, { input: Math.ceil(inputTokens * 1.10) + 2048, output: maxOutput }) * 1.20 * 1e6) / 1e6;
  return { id: digest({ body, label }), job: reviewKey(packet), model, reservedUsd, actualUsd: null, status: "reserved", inputTokens, outputTokens: null };
}
export async function evaluateApiCase(args: { packet: GamePacket; model: Model; maxOutput: number; budget: TestBudget;
  outputFile: string; label: string; format?: "codec" | "readable"; fetchImpl?: typeof fetch; preReservedInputCount?: number }) {
  invariant(Number.isInteger(args.maxOutput) && args.maxOutput > 0 && args.maxOutput <= 16000, "Evaluation output limit outside allowed range");
  const body = args.format === "readable" ? readableRequest(args.packet, args.model, args.maxOutput) : request(args.packet, args.model, args.maxOutput), inputTokens = args.preReservedInputCount ?? await countInput(body, args.fetchImpl);
  // Count endpoint includes input/schema. Add headroom and charge long-context whenever headroom crosses its boundary.
  const reservation = caseReservation(args.packet, args.model, args.maxOutput, args.label, inputTokens, args.format), { id, job, reservedUsd } = reservation;
  if (args.preReservedInputCount === undefined) args.budget.reserve(reservation);
  args.budget.claim(reservation);
  let result; let rateLimits: Record<string, string> = {};
  try {
    mkdirSync(path.dirname(args.outputFile), { recursive: true, mode: 0o700 });
    writeFileSync(args.outputFile.replace(/\.json$/, ".request.json"), JSON.stringify({ id, job, label: args.label, body }), { mode: 0o600, flag: "wx" });
    // Two reviews hours apart rarely reuse a 30m cache. Explicit mode with no
    // breakpoints avoids the default 1.25x cache-write price on changing packets.
    result = await postOpenAi("responses", { ...body, prompt_cache_options: { mode: "explicit" }, stream: true, service_tier: "default", truncation: "disabled", reasoning: { effort: "low" } }, args.fetchImpl,
      responseId => args.budget.update(id, { responseId, status: "streaming" }), headers => { rateLimits = headers; });
    // Save the original vendor receipt even when the response is incomplete/refused/semantically invalid.
    mkdirSync(path.dirname(args.outputFile), { recursive: true, mode: 0o700 });
    writeFileSync(args.outputFile, JSON.stringify({ id, job, label: args.label, inputCount: inputTokens, reservedUsd, rateLimits, response: result }), { mode: 0o600, flag: "wx" });
    const usage = result.usage;
    invariant(Number.isSafeInteger(usage?.input_tokens) && usage.input_tokens >= 0 && Number.isSafeInteger(usage?.output_tokens) && usage.output_tokens >= 0, "Missing vendor usage; reservation remains held");
    const writes = usage.input_tokens_details?.cache_write_tokens ?? 0;
    const write12 = usage.input_tokens_details?.cache_write_tokens_details?.ttl_12h_tokens ?? 0;
    const actualUsd = bill(args.model, { input: usage.input_tokens, output: usage.output_tokens, cacheWrite30m: writes - write12, cacheWrite12h: write12 });
    args.budget.update(id, { actualUsd, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, status: result.status, responseId: result.id });
    let qualityError: string | null = null;
    try {
      invariant(result.status === "completed", `Response ${result.status}`);
      const parts = (result.output ?? []).flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? []);
      invariant(!parts.some((p: { type: string }) => p.type === "refusal"), "Model refused");
      const texts = parts.filter((p: { type: string }) => p.type === "output_text").map((p: { text?: string }) => p.text ?? "");
      invariant(texts.length === 1, "Expected one structured result");
      const parsed = parseRequiredReview(JSON.parse(texts[0]), args.packet);
      const review = validateReview(args.packet, args.format === "readable" ? expandReadableCitations(args.packet, parsed) : parsed);
      // Preserve every structurally complete hypothesis before coherence gating. Dropping
      // failed games from a later accuracy report would select an easier evaluation cohort.
      const issuedAt = new Date().toISOString();
      writeFileSync(args.outputFile.replace(/\.json$/, ".probabilities.json"), JSON.stringify({ issuedAt, scope: "raw hypotheses; acceptance also requires the separate receipt quality gate", proposals: probabilityProposals(args.packet, review, args.model, issuedAt) }), { mode: 0o600, flag: "wx" });
      const points = pointForecasts(args.packet, review);
      writeFileSync(args.outputFile.replace(/\.json$/, ".points.json"), JSON.stringify({ packetDigest: digest(args.packet), issuedAt: new Date().toISOString(), scope: "offline point proposals only; no probabilities/grades/stakes", points }), { mode: 0o600, flag: "wx" });
      invariant(points.every(p => p.directionConsistent), "Review confused baseline adjustment with line direction");
      writeFileSync(args.outputFile.replace(/\.json$/, ".review.json"), JSON.stringify(review), { mode: 0o600, flag: "wx" });
    } catch (error) { qualityError = (error as Error).message; args.budget.update(id, { qualityError }); }
    return { id, job, model: args.model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? null, actualUsdConservativeNoCacheDiscount: actualUsd, reservedUsd, status: result.status, qualityError, rateLimits, outputFile: args.outputFile };
  } catch (error) {
    // Unknown completion/billing keeps the entire reservation, including timeouts. No retry loop.
    args.budget.update(id, { status: "failed_reservation_retained" }); throw error;
  }
}
