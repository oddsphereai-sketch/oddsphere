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
