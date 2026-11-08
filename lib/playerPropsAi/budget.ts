import type { SupabaseClient } from "@supabase/supabase-js";
import { invariant } from "./evidence";
import type { WalletPlan } from "./walletPlan";
import type { PropsAiModel } from "./releases";
export type PropsAiBudget = { month_key: string; cap_micro: number; target_micro: number; core_reserved_micro: number; consumed_micro: number; fallback_remaining_micro: number; recovery_remaining_micro: number; unexpected_overrun_micro: number; planned_games: number; stronger_finals: number; full_calendar: boolean; funding_error: string | null; plan_hash: string | null };
export type PropsAiJob = { job_key: string; sport: "nba" | "nfl" | "mlb"; game_id: string; game_day: string; stage: "early" | "final"; scheduled_start: string; lock_at: string; due_at: string; billing_month: string; state: string; claim_token: string | null; model: PropsAiModel | null; requested_tier: "default"|"flex"; parts: number | null; phase: number; input_hash: string | null; result: unknown; error_code: string | null };
export class PropsAiStore {
  constructor(readonly client: SupabaseClient) {}
  async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw new Error(`Props AI ${name}: ${error.code ?? "database_error"}`);
    return data as T;
  }
  async plan(plan: WalletPlan) {
    return this.rpc<{funded:boolean;reason?:string;required_micro?:number;budget:PropsAiBudget}>("player_props_ai_plan_v3", { p_month: plan.month, p_jobs: plan.jobs, p_companions: plan.companionSlots, p_plan_hash: plan.hash, p_sources: plan.sources, p_release: plan.release });
  }
  async job(key: string): Promise<PropsAiJob | null> {
    const { data, error } = await this.client.from("player_props_ai_reviews").select("*").eq("job_key", key).maybeSingle();
    if (error) throw new Error(`Props AI job read: ${error.code}`); return data;
  }
  async budget(month: string): Promise<PropsAiBudget | null> {
    const { data, error } = await this.client.from("player_props_ai_budgets").select("*").eq("month_key", month).maybeSingle();
    if (error) throw new Error(`Props AI budget read: ${error.code}`); return data;
  }
  claim(key: string, inputHash: string, requests: {input_tokens:number;max_output_tokens:number;strong_input_tokens:number|null}[], preferStronger: boolean,writerRunId:string) {
    return this.rpc<{ claimed: boolean; token?: string; job?: PropsAiJob; reason?: string }>("player_props_ai_claim", { p_key: key, p_hash: inputHash, p_requests: requests, p_prefer_stronger: preferStronger,p_writer_run:writerRunId });
  }
  send(key: string, token: string, phase: number, part: number) {
    return this.rpc<{ id: string; reserved_micro: number; model:PropsAiModel; requested_tier:"default"|"flex" }>("player_props_ai_send", { p_key: key, p_token: token, p_phase: phase, p_part: part });
  }
  receipt(id: string, token: string, actual: number | null, responseId: string | null, usage: unknown) {
    return this.rpc<void>("player_props_ai_receipt", { p_id: id, p_token: token, p_actual: actual, p_response: responseId, p_usage: usage });
  }
  fallback(key: string, token: string, parts: number[], reason: string) { return this.rpc<boolean>("player_props_ai_fallback", { p_key: key, p_token: token, p_parts: parts, p_reason: reason }); }
  finish(key: string, token: string, result: unknown, error: string | null) {
    return this.rpc<PropsAiJob>("player_props_ai_finish", { p_key: key, p_token: token, p_result: result, p_error: error });
  }
  reap() { return this.rpc<number>("player_props_ai_reap"); }
  async due(sport:PropsAiJob["sport"],now:string,limit=2){
    invariant(Number.isInteger(limit)&&limit>=1&&limit<=4,"Invalid bounded review batch");
    const {data,error}=await this.client.from("player_props_ai_reviews").select("*").eq("sport",sport).eq("state","pending").lte("due_at",now).gt("lock_at",now).order("due_at",{ascending:true}).limit(limit);
    if(error)throw new Error(`Props AI due jobs:${error.code}`);return data as PropsAiJob[];
  }
}
/** Allows real Supabase and the exact same SQL through a disposable local pg adapter. */
export type PropsAiReviewStore = Pick<PropsAiStore,"claim"|"send"|"receipt"|"fallback"|"finish">;
/** Integer ceiling includes all output/reasoning. Cache writes are charged even if unexpectedly returned. */
export function usageMicroUsd(model: PropsAiModel, usage: { input_tokens: number; output_tokens: number; input_tokens_details?: { cache_write_tokens?: number; cache_write_tokens_details?: { ttl_12h_tokens?: number } } },confirmedTier?:string) {
  const input = usage?.input_tokens, output = usage?.output_tokens, writes = usage?.input_tokens_details?.cache_write_tokens ?? 0, longWrites = usage?.input_tokens_details?.cache_write_tokens_details?.ttl_12h_tokens ?? 0;
  invariant([input, output, writes, longWrites].every(n => Number.isSafeInteger(n) && n >= 0) && longWrites <= writes && writes <= input, "Missing/invalid usage receipt");
  const multiplier = BigInt(model === "gpt-6.1-terra" ? 10 : 1);
  const long = input >= 272000;
  // Fortieths of a microdollar avoid JS floating-point ceilings exceeding an
  // exact PostgreSQL reservation by a microdollar at valid token boundaries.
  const numerator=multiplier*((BigInt(4)*BigInt(input)+BigInt(writes-longWrites)+BigInt(6)*BigInt(longWrites))*BigInt(long?2:1)+BigInt(output)*BigInt(long?30:20));
  const denominator=BigInt(confirmedTier==="flex"?80:40);
  const result=Number((numerator+denominator-BigInt(1))/denominator);
  invariant(Number.isSafeInteger(result),"Usage charge exceeds safe integer range");return result;
}
