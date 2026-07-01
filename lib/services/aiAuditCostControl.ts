export type AiAuditorBudgetMode = "NORMAL" | "CONSERVE" | "PROTECT" | "HARD_STOP";

export type AiAuditUsageLedgerRow = {
  id?: string;
  created_at?: string;
  month_key: string;
  sport?: string | null;
  slate_date?: string | null;
  game_id?: string | null;
  audit_scope: string;
  payload_hash?: string | null;
  from_cache?: boolean;
  skipped_reason?: string | null;
  model?: string | null;
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  actual_cost_usd?: number | null;
  status?: string | null;
  severity?: string | null;
  recommended_actions?: string[] | null;
  escalation?: boolean;
  escalation_parent_id?: string | null;
  applied?: boolean;
};

export type AiAuditUsageSummary = {
  month_key: string;
  total_spend_usd: number;
  projected_spend_usd: number;
  calls_today: number;
  calls_month: number;
  cache_hits: number;
  cache_hit_rate: number;
  pass_count: number;
  warn_count: number;
  block_count: number;
  mini_escalation_count: number;
  spend_by_sport: Record<string, number>;
  spend_by_model: Record<string, number>;
  highest_cost_slates: Array<{ slate_date: string; spend_usd: number }>;
  highest_cost_games: Array<{ game_id: string; spend_usd: number }>;
  current_budget_mode: AiAuditorBudgetMode;
};

export function currentMonthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveAiAuditorBudgetMode(summary: Pick<AiAuditUsageSummary, "total_spend_usd" | "projected_spend_usd">): AiAuditorBudgetMode {
  const soft = envNumber("AI_AUDITOR_MONTHLY_SOFT_CAP_USD", 150);
  const protect = envNumber("AI_AUDITOR_MONTHLY_PROTECT_CAP_USD", 200);
  const hard = envNumber("AI_AUDITOR_MONTHLY_HARD_CAP_USD", 250);
  if (summary.total_spend_usd >= hard) return "HARD_STOP";
  if (summary.total_spend_usd > protect || summary.projected_spend_usd > protect) return "PROTECT";
  if (summary.total_spend_usd > soft || summary.projected_spend_usd > soft) return "CONSERVE";
  return "NORMAL";
}

export function shouldSkipAiAudit(args: {
  enabled?: boolean;
  payloadHash: string;
  previousPayloadHash?: string | null;
  playGrade: "No Play" | "Caution" | "Watchlist" | "Lean" | "Best Angle";
  sourceConflict: boolean;
  lockSnapshot: boolean;
  budgetMode: AiAuditorBudgetMode;
}): { skip: boolean; reason: string | null } {
  if (args.enabled === false || process.env.AI_AUDITOR_ENABLED === "false") {
    return { skip: true, reason: "disabled" };
  }
  if (args.budgetMode === "HARD_STOP") {
    return { skip: true, reason: "monthly_hard_cap_reached" };
  }
  if (
    process.env.AI_AUDITOR_SKIP_UNCHANGED_PAYLOADS !== "false" &&
    args.previousPayloadHash &&
    args.previousPayloadHash === args.payloadHash
  ) {
    return { skip: true, reason: "unchanged_payload" };
  }
  if (args.budgetMode === "PROTECT") {
    const allowed = args.playGrade === "Best Angle" || args.playGrade === "Lean" || args.sourceConflict || args.lockSnapshot;
    return allowed ? { skip: false, reason: null } : { skip: true, reason: "protect_mode_scope" };
  }
  if (args.budgetMode === "CONSERVE") {
    const stableLowGrade = (args.playGrade === "No Play" || args.playGrade === "Caution") && !args.sourceConflict && !args.lockSnapshot;
    return stableLowGrade ? { skip: true, reason: "conserve_mode_stable_low_grade" } : { skip: false, reason: null };
  }
  return { skip: false, reason: null };
}

export async function insertAiAuditLedger(row: AiAuditUsageLedgerRow): Promise<string | null> {
  const { supabase } = await import("../db/supabase");
  const { data, error } = await supabase.from("ai_audit_usage_ledger").insert(row).select("id").single();
  if (error) throw new Error(`ai_audit_usage_ledger insert failed: ${error.message}`);
  return (data as { id?: string } | null)?.id ?? null;
}

function addSpend(map: Record<string, number>, key: string | null | undefined, spend: number): void {
  if (!key) return;
  map[key] = +(Number(map[key] ?? 0) + spend).toFixed(6);
}

export async function loadAiAuditUsageSummary(monthKey = currentMonthKey()): Promise<AiAuditUsageSummary> {
  const { supabase } = await import("../db/supabase");
  const { data, error } = await supabase
    .from("ai_audit_usage_ledger")
    .select("*")
    .eq("month_key", monthKey)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(`ai_audit_usage_ledger summary failed: ${error.message}`);

  const rows = (data ?? []) as AiAuditUsageLedgerRow[];
  const today = new Date().toISOString().slice(0, 10);
  const spendBySport: Record<string, number> = {};
  const spendByModel: Record<string, number> = {};
  const spendBySlate: Record<string, number> = {};
  const spendByGame: Record<string, number> = {};
  let total = 0;
  let cacheHits = 0;
  let pass = 0;
  let warn = 0;
  let block = 0;
  let escalations = 0;
  let callsToday = 0;
  for (const row of rows) {
    const spend = Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0);
    total += spend;
    if (row.created_at?.slice(0, 10) === today) callsToday++;
    if (row.from_cache) cacheHits++;
    if (row.status === "pass") pass++;
    if (row.status === "warn") warn++;
    if (row.status === "block") block++;
    if (row.escalation) escalations++;
    addSpend(spendBySport, row.sport, spend);
    addSpend(spendByModel, row.model, spend);
    addSpend(spendBySlate, row.slate_date, spend);
    addSpend(spendByGame, row.game_id, spend);
  }
  const dayOfMonth = Math.max(1, new Date().getUTCDate());
  const projected = +(total / dayOfMonth * 31).toFixed(6);
  const highest = (obj: Record<string, number>) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  const summary: AiAuditUsageSummary = {
    month_key: monthKey,
    total_spend_usd: +total.toFixed(6),
    projected_spend_usd: projected,
    calls_today: callsToday,
    calls_month: rows.filter((r) => !r.from_cache && !r.skipped_reason).length,
    cache_hits: cacheHits,
    cache_hit_rate: rows.length > 0 ? +(cacheHits / rows.length).toFixed(4) : 0,
    pass_count: pass,
    warn_count: warn,
    block_count: block,
    mini_escalation_count: escalations,
    spend_by_sport: spendBySport,
    spend_by_model: spendByModel,
    highest_cost_slates: highest(spendBySlate).map(([slate_date, spend_usd]) => ({ slate_date, spend_usd })),
    highest_cost_games: highest(spendByGame).map(([game_id, spend_usd]) => ({ game_id, spend_usd })),
    current_budget_mode: "NORMAL",
  };
  summary.current_budget_mode = resolveAiAuditorBudgetMode(summary);
  return summary;
}
