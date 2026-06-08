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
  // Phase 6B.31b — S6 first-inning splits refresh. Reuses the existing
  // operator env flag (same flag the manual backfill script consumes),
  // so flipping FIRST_INNING_DB_WRITES_ENABLED in one place gates both
  // the standalone CLI and the slate-cycle step. Writer scope is
  // limited to the six first_inning_* columns + updated_at.
  first_inning: "FIRST_INNING_DB_WRITES_ENABLED",
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
 *
 * @deprecated Phase 6B.31c — superseded by computeEffectiveWriteModeV2,
 * which consults a per-step provider dependency list instead of a single
 * coarse `upstreamBlocked` boolean. Old callers still work, but the
 * orchestrator now uses V2 so SharpAPI EV scarcity doesn't falsely block
 * MLB-Stats-only steps (S5 season-pitching, S6 first-inning). Kept here
 * for back-compat tests + any external operator scripts that import it.
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

// ─── Phase 6B.31c — Per-step provider-dependency gates ──────────────────
//
// Previously the orchestrator computed ONE `upstreamBlocked` boolean from
// a coarse OR of providerMode / reconciliation / G1 / G3 gates and
// cascaded it to every step. This conflated unrelated provider failures
// (e.g. `/opportunities/ev` shrinking when EV opportunities close) with
// "the whole slate is unsafe to write", which incorrectly blocked steps
// that don't read from SharpAPI EV at all (S5 season pitching, S6 first
// inning — both source from MLB Stats only).
//
// V2 splits the cascade by data source:
//   • Each gate signals a specific provider's health
//   • Each step declares which providers it actually depends on
//   • A step is blocked only when one of its required providers is unhealthy
//
// This preserves fail-closed safety where it belongs (S7 lines truly need
// SharpAPI odds; M2 needs lines + readiness) but lets MLB-Stats-only
// steps run normally when only SharpAPI EV scarcity has fired upstream.

/**
 * Provider data sources that orchestrator gates can signal about. New
 * providers can be added without changing the V2 helper signature —
 * callers just extend their per-step deps list.
 */
export type ProviderKind =
  /** BDL `/games` slate for the day. Signaled by G1 (min game count), G3 (in-progress). */
  | "bdl_slate"
  /**
   * SharpAPI `/opportunities/ev` — POSITIVE-EV opportunity list. Naturally
   * sparse outside morning windows; sparse ≠ unhealthy slate. Signaled
   * by providerDateAlignment + slateReconciliation gates (which both use
   * this endpoint as their SharpAPI-side input).
   */
  | "sharpapi_ev_opportunities"
  /**
   * SharpAPI `/odds` — full odds/lines coverage per book per market.
   * Distinct from EV opportunities. Currently signaled implicitly via
   * `lines` step itself running; no separate pre-flight gate today.
   * Reserved for future when we add an odds-coverage canary.
   */
  | "sharpapi_odds_lines"
  /**
   * SharpAPI `/events` — raw slate events feed (includes player props,
   * incomplete rows). Not used as primary canonical source today; reserved
   * if we ever build a filtered events canary.
   */
  | "sharpapi_events"
  /**
   * MLB Stats API (public). Used by season-pitching + first-inning + AI
   * starter-stats backfill. No pre-flight gate today; treated as `ok`
   * unless a step's own run reports an error (per-step counters).
   */
  | "mlb_stats"
  /**
   * ESPN public scoreboard / probable-pitcher tertiary source.
   * No pre-flight gate today.
   */
  | "espn_secondary";

/**
 * Health status of a single provider. `ok` = use it. `warn` = noisy but
 * usable. `fail_closed` = a step that requires this provider must NOT
 * write.
 */
export type ProviderHealthStatus = "ok" | "warn" | "fail_closed";

export type ProviderHealth = Record<ProviderKind, ProviderHealthStatus>;

/** Default healthy state — every provider `ok`. Callers override per gate. */
export function defaultProviderHealth(): ProviderHealth {
  return {
    bdl_slate: "ok",
    sharpapi_ev_opportunities: "ok",
    sharpapi_odds_lines: "ok",
    sharpapi_events: "ok",
    mlb_stats: "ok",
    espn_secondary: "ok",
  };
}

/**
 * Per-step provider dependency map. A step is blocked when ANY provider
 * in its `requires` list reports `fail_closed`. Each entry documents WHY
 * the dependency is what it is — important for safe maintenance, since
 * the wrong dependency list re-introduces the cascade bug or breaks
 * fail-closed safety.
 *
 * Conservative defaults:
 *   • If a step writes to a DB table fed by Provider X, X is required.
 *   • SharpAPI EV opportunities is ONLY required when the step actually
 *     consumes EV-derived data (sharp signals). Pure odds consumers list
 *     `sharpapi_odds_lines` instead.
 *   • Steps that only read MLB Stats list `mlb_stats` and nothing else.
 *   • Steps that only need the BDL slate to find players to act on list
 *     `bdl_slate` — but in practice they read DB-resident games, not the
 *     live BDL feed, so they can succeed even if BDL is currently down.
 *     We list `bdl_slate` anyway because a sustained BDL outage is the
 *     scenario where the slate IS structurally broken.
 */
export const STEP_PROVIDER_DEPS: Record<PerStepKey, readonly ProviderKind[]> = {
  // S1 — BDL slate ingest writes to `games` table from BDL.
  slate: ["bdl_slate"],
  // S3 / M1 — Starter refresh consults BDL slate + ESPN secondary fallback.
  starter: ["bdl_slate", "espn_secondary"],
  // S4 — Missing-pitcher ingest creates `players` rows from BDL + MLB Stats lookups.
  pitcher: ["bdl_slate", "mlb_stats"],
  // S5 — Season pitching stats from MLB Stats API. Does NOT depend on SharpAPI EV.
  season: ["mlb_stats"],
  // S6 — First-inning splits from MLB Stats API. Does NOT depend on SharpAPI EV.
  first_inning: ["mlb_stats"],
  // S5.6 — Readiness repair delegates to BDL backfill + season-pitching + lineup + weather.
  // Does NOT depend on SharpAPI.
  readiness: ["bdl_slate", "mlb_stats", "espn_secondary"],
  // S7 — Lines refresh reads SharpAPI ODDS feed (not /opportunities/ev).
  // Does NOT depend on `sharpapi_ev_opportunities`. This is the key fix:
  // sparse EV opportunities should not block real odds coverage.
  lines: ["sharpapi_odds_lines"],
  // S8 — Sharp signals are EV-derived. Sparse EV → signals legitimately sparse;
  // step still runs (writes 0) rather than fail. Listed here for transparency.
  signals: ["sharpapi_ev_opportunities"],
  // M2 — Automodel consumes lines + MLB Stats + slate. Doesn't directly read
  // SharpAPI EV (signals are optional inputs). Listed deps reflect the
  // hard requirements.
  automodel: ["sharpapi_odds_lines", "mlb_stats", "bdl_slate"],
};

/**
 * V2: resolve effective write mode using per-step provider dependencies.
 *
 *   • orchestratorGate off  → false (master kill-switch, e.g. running locally)
 *   • perStepGate off       → false (env flag not set)
 *   • masterProviderBlock   → false (e.g. providerMode audit failed:
 *                                    provider is in mock mode, no real data)
 *   • Any required provider is `fail_closed` → false
 *   • Otherwise              → true
 *
 * `masterProviderBlock` is reserved for cross-cutting concerns that
 * should kill writes regardless of which provider the step needs — e.g.
 * provider-mode audit failure (none of the providers are wired up real_api),
 * or a master-kill flag. Per-provider health goes in `providerHealth`.
 */
export function computeEffectiveWriteModeV2(opts: {
  orchestratorGate: boolean;
  perStepGate: boolean;
  masterProviderBlock: boolean;
  stepDependencies: readonly ProviderKind[];
  providerHealth: ProviderHealth;
}): boolean {
  if (!opts.orchestratorGate) return false;
  if (!opts.perStepGate) return false;
  if (opts.masterProviderBlock) return false;
  for (const dep of opts.stepDependencies) {
    if (opts.providerHealth[dep] === "fail_closed") return false;
  }
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
