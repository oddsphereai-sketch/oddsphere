import type { SupabaseClient } from "@supabase/supabase-js";
import { digest, invariant } from "./evidence";
import type { PropsReviewSlot } from "./schedule";
import { PROPS_AI_PRIMARY_SLOT_BY_SPORT, PROPS_AI_MONTHLY_CAP_MICRO_USD, PROPS_AI_RECOVERY_RESERVE_MICRO_USD, type PropsAiModel } from "./releases";
export type PropsAiBudget = { month_key: string; cap_micro: number; core_reserved_micro: number; consumed_micro: number; recovery_remaining_micro: number; planned_games: number; stronger_finals: number; full_calendar: boolean; plan_hash: string | null };
export type PropsAiJob = { job_key: string; sport: "nba" | "nfl" | "mlb"; game_id: string; game_day: string; stage: "early" | "final"; scheduled_start: string; lock_at: string; due_at: string; billing_month: string; state: string; claim_token: string | null; model: PropsAiModel | null; parts: number | null; phase: number; input_hash: string | null; result: unknown; error_code: string | null };
export class PropsAiStore {
  constructor(readonly client: SupabaseClient) {}
  async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw new Error(`Props AI ${name}: ${error.code ?? "database_error"}`);
    return data as T;
  }
  async plan(month: string, slots: PropsReviewSlot[], sources: Record<string, unknown>, fullCalendar: boolean) {
    invariant(fullCalendar, "Full-month calendar required before any paid review");
    const total = slots.reduce((n,slot)=>n+PROPS_AI_PRIMARY_SLOT_BY_SPORT[slot.sport],0) + PROPS_AI_RECOVERY_RESERVE_MICRO_USD;
    invariant(total <= PROPS_AI_MONTHLY_CAP_MICRO_USD, `Complete primary calendar needs ${(total / 1e6).toFixed(2)} USD; it cannot be silently shortened to fit`);
    return this.rpc<PropsAiBudget>("player_props_ai_plan", { p_month: month, p_jobs: slots, p_plan_hash: digest({ slots, sources }), p_sources: sources, p_complete: true });
  }
  async job(key: string): Promise<PropsAiJob | null> {
    const { data, error } = await this.client.from("player_props_ai_reviews").select("*").eq("job_key", key).maybeSingle();
    if (error) throw new Error(`Props AI job read: ${error.code}`); return data;
  }
  async budget(month: string): Promise<PropsAiBudget | null> {
    const { data, error } = await this.client.from("player_props_ai_budgets").select("*").eq("month_key", month).maybeSingle();
    if (error) throw new Error(`Props AI budget read: ${error.code}`); return data;
  }
  claim(key: string, inputHash: string, requests: {input_tokens:number;max_output_tokens:number;strong_input_tokens:number|null}[], preferStronger: boolean) {
    return this.rpc<{ claimed: boolean; token?: string; job?: PropsAiJob; reason?: string }>("player_props_ai_claim", { p_key: key, p_hash: inputHash, p_requests: requests, p_prefer_stronger: preferStronger });
  }
  send(key: string, token: string, phase: number, part: number) {
    return this.rpc<{ id: string; reserved_micro: number }>("player_props_ai_send", { p_key: key, p_token: token, p_phase: phase, p_part: part });
  }
  receipt(id: string, token: string, actual: number | null, responseId: string | null, usage: unknown) {
    return this.rpc<void>("player_props_ai_receipt", { p_id: id, p_token: token, p_actual: actual, p_response: responseId, p_usage: usage });
  }
  repair(key: string, token: string) { return this.rpc<boolean>("player_props_ai_repair", { p_key: key, p_token: token }); }
  finish(key: string, token: string, result: unknown, error: string | null) {
    return this.rpc<PropsAiJob>("player_props_ai_finish", { p_key: key, p_token: token, p_result: result, p_error: error });
  }
  reap() { return this.rpc<number>("player_props_ai_reap"); }
}
/** Integer ceiling includes all output/reasoning. Cache writes are charged even if unexpectedly returned. */
export function usageMicroUsd(model: PropsAiModel, usage: { input_tokens: number; output_tokens: number; input_tokens_details?: { cache_write_tokens?: number; cache_write_tokens_details?: { ttl_12h_tokens?: number } } },confirmedTier?:string) {
  const input = usage?.input_tokens, output = usage?.output_tokens, writes = usage?.input_tokens_details?.cache_write_tokens ?? 0, longWrites = usage?.input_tokens_details?.cache_write_tokens_details?.ttl_12h_tokens ?? 0;
  invariant([input, output, writes, longWrites].every(n => Number.isSafeInteger(n) && n >= 0) && longWrites <= writes && writes <= input, "Missing/invalid usage receipt");
  const multiplier = model === "gpt-6.1-terra" ? 10 : 1;
  const long = input >= 272000;
  return Math.ceil((confirmedTier==="flex"?.5:1)*multiplier * ((input + (writes - longWrites) * .25 + longWrites * 1.5) * .1 * (long ? 2 : 1) + output * .5 * (long ? 1.5 : 1)));
}
