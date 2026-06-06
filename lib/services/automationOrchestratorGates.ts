/**
 * Phase 4.2.C.1.R-19 Phase 2 — pure gate helpers for the cron-safe
 * slate-cycle orchestrator.
 *
 * Split out from automationOrchestrator.ts so the pure pieces can be
 * unit-tested without dragging in supabase / provider clients. The
 * orchestrator itself re-exports these for callers that already have
 * automationOrchestrator imported.
 */

/**
 * The env-flag shape this orchestrator and the cron route consume. Kept
 * narrow so tests can construct it without `as` casts.
 */
export type AutomationEnv = Record<string, string | undefined>;

/** Per-step env flags — each must be "true" for that step's writes to fire. */
export const PER_STEP_ENV_VARS = {
  slate: "SLATE_DB_WRITES_ENABLED",
  starter: "STARTER_DB_WRITES_ENABLED",
  pitcher: "PLAYER_INGEST_DB_WRITES_ENABLED",
  season: "SEASON_PITCHING_DB_WRITES_ENABLED",
  // Push 3B-6 — S5.6 readiness repair: BDL player backfill + retry
  // weather/lineup/season-pitching for games still short of feature
  // coverage after the upstream steps. Per-step gate joins the
  // existing AUTOMODEL_DB_WRITES_ENABLED gate (required for any
  // model-readiness repair to apply).
  readiness: "MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED",
  lines: "LINES_DB_WRITES_ENABLED",
  signals: "SHARP_SIGNALS_DB_WRITES_ENABLED",
  automodel: "AUTOMODEL_DB_WRITES_ENABLED",
} as const;

export type PerStepKey = keyof typeof PER_STEP_ENV_VARS;

/**
 * Master gate for non-interactive execution. The route refuses to run
 * when this is not "true" — preventing accidental cron activation by a
 * caller who didn't intentionally opt in.
 */
export const ORCHESTRATOR_GATE_ENV = "ORCHESTRATOR_SKIP_CONFIRMATION";

export function isOrchestratorGateEnabled(env: AutomationEnv): boolean {
  return env[ORCHESTRATOR_GATE_ENV] === "true";
}

export function readPerStepGates(env: AutomationEnv): Record<PerStepKey, boolean> {
  const out = {} as Record<PerStepKey, boolean>;
  for (const k of Object.keys(PER_STEP_ENV_VARS) as PerStepKey[]) {
    out[k] = env[PER_STEP_ENV_VARS[k]] === "true";
  }
  return out;
}

/**
 * Resolve the effective write mode for a single step. Three conditions
 * MUST all hold for a write to fire: master gate enabled, per-step gate
 * enabled, no blocking upstream condition.
 */
export function computeEffectiveWriteMode(opts: {
  orchestratorGate: boolean;
  perStepGate: boolean;
  upstreamBlocked: boolean;
}): boolean {
  if (opts.upstreamBlocked) return false;
  if (!opts.orchestratorGate) return false;
  if (!opts.perStepGate) return false;
  return true;
}

/**
 * Build a blocked-route report when ORCHESTRATOR_SKIP_CONFIRMATION is
 * not set. Used by the cron route to return a structured response
 * WITHOUT calling runSlateCycleAutomated (no DB I/O, no provider calls).
 */
export function buildOrchestratorBlockedReport(opts: {
  sport: string;
  date: string;
}): {
  blocked: true;
  reason: string;
  requested_date: string;
  sport: string;
  env_flag_required: string;
} {
  return {
    blocked: true,
    reason: `${ORCHESTRATOR_GATE_ENV} env var must be 'true' for non-interactive cron execution`,
    requested_date: opts.date,
    sport: opts.sport,
    env_flag_required: ORCHESTRATOR_GATE_ENV,
  };
}

// ─── R-19 Phase 5d — Intraday mode ────────────────────────────────────

/**
 * Env-flag alternative to the `?intraday=true` query param. Either
 * trigger switches G3 (in-progress ingest) from slate-wide block to
 * per-game exclusion of already-started games. Strict equality with
 * "true" — same pattern as the other R-19 env flags.
 */
export const SLATE_CYCLE_INTRADAY_MODE_ENV = "SLATE_CYCLE_INTRADAY_MODE";

/**
 * Resolve intraday mode from request URL or env. Pure helper. Used
 * by the cron route to switch G3 cascade semantics:
 *
 *   morning mode (default):  G3 fail_closed → push to blocking_reasons
 *                            + cascade to dataLayerBlocked → all
 *                            effective_write_mode = false. Correct
 *                            when cron fired too late for the first
 *                            morning run.
 *
 *   intraday mode:           G3 fail_closed → push to warnings
 *                            + affectedExternalIds become per-game
 *                            exclusions, union'd with lock_miss
 *                            exclusions. M2 runs for the remaining
 *                            future/unlocked games. Publish stays
 *                            held when any exclusion fires.
 *
 * Operator schedules vercel.json crons accordingly — early-morning
 * uses morning mode (no ?intraday param); midday/afternoon/evening
 * use ?intraday=true.
 */
export function isIntradayMode(
  request: Request,
  env: AutomationEnv = process.env
): boolean {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("intraday") === "true") return true;
  } catch {
    // Malformed URL — fall through to env check
  }
  return env[SLATE_CYCLE_INTRADAY_MODE_ENV] === "true";
}

// ─── R-19 Phase 5e — Intraday-aware alignment cascade ─────────────────

/**
 * Decide whether the orchestrator should demote a fail_closed provider
 * date alignment to "warn" before passing it into the R-17 G1 automation
 * gate.
 *
 * In intraday mode, SharpAPI's `/opportunities/ev` feed shrinks naturally
 * as games complete and as markets tighten — both are normal mid-day
 * behavior, not provider failure. The slate-level alignment canary
 * therefore fires false-positively, and its cascade into the R-17 G1
 * gate (status → "fail_closed") blocks M2 slate-wide. We soften only the
 * cascade input; the original alignment status still surfaces on the
 * top-level `provider_date_alignment` field of the report.
 *
 * Layered defenses that remain strict in intraday:
 *   • P2.5 slate reconciliation (BDL vs SharpAPI overlap) — catches
 *     "provider rolled forward / fully empty" scenarios
 *   • R-17 G1 per-game stale-line / missing ML / missing total /
 *     missing starter checks — real intraday quality canaries
 *   • Phase 5c lock_miss + Phase 5d G3-intraday — per-game exclusions
 *
 * Pure helper: returns true iff intradayMode is true AND alignment is
 * fail_closed. Caller composes the demoted object themselves to keep
 * the underlying ProviderDateAlignmentReport type out of this module.
 */
export function shouldDemoteAlignmentForGate(opts: {
  intradayMode: boolean;
  alignmentStatus:
    | "ok"
    | "warn"
    | "fail_closed"
    | "skipped"
    | null
    | undefined;
}): boolean {
  return opts.intradayMode === true && opts.alignmentStatus === "fail_closed";
}
