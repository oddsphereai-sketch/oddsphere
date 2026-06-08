/**
 * Phase 6B.31c — orchestrator per-step provider-dependency tests.
 *
 * The orchestrator used to compute ONE `upstreamBlocked` boolean from a
 * coarse OR of providerMode + reconciliation + G1 + G3 gates, then
 * cascaded it into every step. This conflated unrelated provider
 * failures (notably: `/opportunities/ev` shrinking when EV opportunities
 * close as games approach) with "the slate is structurally unsafe," and
 * incorrectly blocked steps that don't read from SharpAPI EV at all
 * (S5 season pitching, S6 first-inning — both MLB-Stats-only writers).
 *
 * The V2 path (`computeEffectiveWriteModeV2`) tags each step with the
 * specific providers it depends on (via `STEP_PROVIDER_DEPS`). A step is
 * blocked only when one of its REQUIRED providers reports `fail_closed`.
 * `providerModeBlocking` remains a cross-cutting master kill (any
 * provider in mock mode → no writes anywhere).
 *
 * These tests pin the new semantics with the six scenarios specified in
 * the Phase 6B.31c brief:
 *
 *   T1 — sparse SharpAPI EV, healthy MLB Stats → S5/S6 still write.
 *   T2 — sparse SharpAPI EV, healthy /odds → S7 lines still writes.
 *   T3 — EV truly unavailable → only EV-consumer steps (S8) blocked;
 *        other steps untouched.
 *   T4 — `sharpapi_odds_lines` truly fail_closed → S7/M2 block; others write.
 *   T5 — `bdl_slate` fail_closed (G1 below threshold) → slate-dependent
 *        steps block; pure MLB-Stats steps (S5/S6) untouched.
 *   T6 — MLB Stats healthy + SharpAPI EV sparse → S6 writes when its
 *        own per-step env flag is on.
 *
 * Plus a few invariant tests:
 *   I1 — `masterProviderBlock` kills every step regardless of perStepGate.
 *   I2 — `orchestratorGate=false` kills every step (env-undefined default).
 *   I3 — Every PerStepKey is present in STEP_PROVIDER_DEPS (no orphans).
 *   I4 — STEP_PROVIDER_DEPS for S5/S6 does NOT include sharpapi_ev_*
 *        — guards against accidental re-introduction of the bug.
 */

import {
  computeEffectiveWriteModeV2,
  defaultProviderHealth,
  PER_STEP_ENV_VARS,
  STEP_PROVIDER_DEPS,
  type PerStepKey,
  type ProviderHealth,
} from "../lib/services/automationOrchestratorGates";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, msg?: string): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`);
    fail++;
  }
}
function section(t: string): void {
  console.log(`\n━━━ ${t} ━━━`);
}

// Helper: build an effective-mode result for every step under the given
// providerHealth + masterProviderBlock. Per-step gates are all assumed
// ON unless overridden, so the test focuses on the cascade behavior.
function computeAll(opts: {
  providerHealth: ProviderHealth;
  masterProviderBlock?: boolean;
  perStepGatesOverride?: Partial<Record<PerStepKey, boolean>>;
  orchestratorGate?: boolean;
}): Record<PerStepKey, boolean> {
  const out = {} as Record<PerStepKey, boolean>;
  for (const k of Object.keys(PER_STEP_ENV_VARS) as PerStepKey[]) {
    const perStepGate = opts.perStepGatesOverride?.[k] ?? true;
    out[k] = computeEffectiveWriteModeV2({
      orchestratorGate: opts.orchestratorGate ?? true,
      perStepGate,
      masterProviderBlock: opts.masterProviderBlock ?? false,
      stepDependencies: STEP_PROVIDER_DEPS[k],
      providerHealth: opts.providerHealth,
    });
  }
  return out;
}

console.log(`\n━━━ Phase 6B.31c — provider-dependency gate tests ━━━`);

// ── T1 — sparse SharpAPI EV, healthy MLB Stats → S5/S6 still write ─────
section("T1 — sparse /opportunities/ev → S5/S6 must STILL write");
{
  const health: ProviderHealth = defaultProviderHealth();
  health.sharpapi_ev_opportunities = "fail_closed"; // the regression scenario
  const eff = computeAll({ providerHealth: health });
  check("T1 S5 season-pitching effectiveWriteMode === true", eff.season === true);
  check("T1 S6 first-inning effectiveWriteMode === true", eff.first_inning === true);
  // Pure MLB-Stats steps unaffected.
  check("T1 S5.6 readiness effectiveWriteMode === true", eff.readiness === true);
  // S8 sharp-signals legitimately depends on EV → should be false.
  check("T1 S8 sharp-signals === false (EV unavailable)", eff.signals === false);
  // S7 lines depends on /odds (not /opportunities/ev) → should be true.
  check("T1 S7 lines === true (lines don't depend on EV)", eff.lines === true);
  // M2 depends on odds/mlb_stats/bdl — none failed → should be true.
  check("T1 M2 automodel === true (no model-input failure)", eff.automodel === true);
}

// ── T2 — sparse EV but healthy /odds → S7 not blocked ──────────────────
section("T2 — sparse EV + healthy odds → S7 lines refresh runs");
{
  const health: ProviderHealth = defaultProviderHealth();
  health.sharpapi_ev_opportunities = "fail_closed";
  // sharpapi_odds_lines stays ok
  const eff = computeAll({ providerHealth: health });
  check("T2 S7 lines refresh === true", eff.lines === true);
  check("T2 S7B (lines) === true", eff.lines === true);
}

// ── T3 — EV unavailable → only EV consumers (S8) blocked ───────────────
section("T3 — only EV consumers blocked when EV unavailable");
{
  const health: ProviderHealth = defaultProviderHealth();
  health.sharpapi_ev_opportunities = "fail_closed";
  const eff = computeAll({ providerHealth: health });
  // Walk all steps and assert only S8 (signals) is blocked
  const blocked: PerStepKey[] = [];
  for (const k of Object.keys(PER_STEP_ENV_VARS) as PerStepKey[]) {
    if (!eff[k]) blocked.push(k);
  }
  check(
    `T3 exactly one step blocked (signals), got [${blocked.join(", ")}]`,
    blocked.length === 1 && blocked[0] === "signals",
  );
}

// ── T4 — odds genuinely fail_closed → S7/M2 block; others write ────────
section("T4 — sharpapi_odds_lines fail_closed → S7 + M2 block, others write");
{
  const health: ProviderHealth = defaultProviderHealth();
  health.sharpapi_odds_lines = "fail_closed";
  const eff = computeAll({ providerHealth: health });
  check("T4 S7 lines === false (odds failed)", eff.lines === false);
  check("T4 M2 automodel === false (model needs odds)", eff.automodel === false);
  // Stat enrichment unaffected.
  check("T4 S5 season-pitching === true", eff.season === true);
  check("T4 S6 first-inning === true", eff.first_inning === true);
  check("T4 S8 sharp-signals === true (EV ok)", eff.signals === true);
}

// ── T5 — BDL slate fail_closed → slate-dependent block, MLB-Stats untouched
section("T5 — bdl_slate fail_closed → S1/S3/S4/M2 block, S5/S6 untouched");
{
  const health: ProviderHealth = defaultProviderHealth();
  health.bdl_slate = "fail_closed";
  const eff = computeAll({ providerHealth: health });
  check("T5 S1 slate === false (BDL failed)", eff.slate === false);
  check("T5 S3 starter === false", eff.starter === false);
  check("T5 S4 pitcher === false", eff.pitcher === false);
  check("T5 M2 automodel === false (depends on bdl_slate)", eff.automodel === false);
  check("T5 S5 season-pitching === true (MLB-Stats only)", eff.season === true);
  check("T5 S6 first-inning === true (MLB-Stats only)", eff.first_inning === true);
  check("T5 S7 lines === true (only odds dep)", eff.lines === true);
  check("T5 S8 signals === true (EV dep ok)", eff.signals === true);
}

// ── T6 — MLB Stats healthy + EV sparse → S6 writes when env on ─────────
section("T6 — exact bug repro: EV sparse + S6 env on → S6 writes");
{
  const health: ProviderHealth = defaultProviderHealth();
  health.sharpapi_ev_opportunities = "fail_closed";
  // Simulate: only S6 env is on (matches user's first-write rollout).
  const eff = computeAll({
    providerHealth: health,
    perStepGatesOverride: {
      slate: false,
      starter: false,
      pitcher: false,
      season: false,
      first_inning: true, // ← the one we care about
      readiness: false,
      lines: false,
      signals: false,
      automodel: false,
    },
  });
  check("T6 S6 === true (the actual bug-fix case)", eff.first_inning === true);
  check("T6 S5 === false (env off; not because of provider)", eff.season === false);
}

// ── T7 — MLB Stats fail_closed → S5/S6 block; S7 unaffected ────────────
section("T7 — mlb_stats fail_closed → S5/S6 block; S7 unaffected");
{
  const health: ProviderHealth = defaultProviderHealth();
  health.mlb_stats = "fail_closed";
  const eff = computeAll({ providerHealth: health });
  check("T7 S5 === false (mlb_stats failed)", eff.season === false);
  check("T7 S6 === false (mlb_stats failed)", eff.first_inning === false);
  check("T7 S4 pitcher === false (also needs mlb_stats)", eff.pitcher === false);
  check("T7 M2 === false (also needs mlb_stats)", eff.automodel === false);
  check("T7 S7 === true (only needs odds)", eff.lines === true);
  check("T7 S1 === true (only needs bdl_slate)", eff.slate === true);
}

// ── I1 — masterProviderBlock kills everything ──────────────────────────
section("I1 — masterProviderBlock kills every step");
{
  const health: ProviderHealth = defaultProviderHealth();
  const eff = computeAll({ providerHealth: health, masterProviderBlock: true });
  for (const k of Object.keys(PER_STEP_ENV_VARS) as PerStepKey[]) {
    check(`I1 ${k} === false`, eff[k] === false);
  }
}

// ── I2 — orchestratorGate=false kills everything ───────────────────────
section("I2 — orchestratorGate=false kills every step");
{
  const health: ProviderHealth = defaultProviderHealth();
  const eff = computeAll({ providerHealth: health, orchestratorGate: false });
  for (const k of Object.keys(PER_STEP_ENV_VARS) as PerStepKey[]) {
    check(`I2 ${k} === false`, eff[k] === false);
  }
}

// ── I3 — every PerStepKey has a STEP_PROVIDER_DEPS entry ───────────────
section("I3 — STEP_PROVIDER_DEPS covers every PerStepKey (no orphans)");
{
  for (const k of Object.keys(PER_STEP_ENV_VARS) as PerStepKey[]) {
    check(`I3 STEP_PROVIDER_DEPS[${k}] is defined`, Array.isArray(STEP_PROVIDER_DEPS[k]));
  }
}

// ── I4 — S5/S6 must NOT depend on sharpapi_ev_opportunities ────────────
section("I4 — S5/S6/readiness MUST NOT list sharpapi_ev_opportunities (anti-regression)");
{
  check(
    "I4 STEP_PROVIDER_DEPS.season excludes sharpapi_ev_opportunities",
    !STEP_PROVIDER_DEPS.season.includes("sharpapi_ev_opportunities"),
  );
  check(
    "I4 STEP_PROVIDER_DEPS.first_inning excludes sharpapi_ev_opportunities",
    !STEP_PROVIDER_DEPS.first_inning.includes("sharpapi_ev_opportunities"),
  );
  check(
    "I4 STEP_PROVIDER_DEPS.readiness excludes sharpapi_ev_opportunities",
    !STEP_PROVIDER_DEPS.readiness.includes("sharpapi_ev_opportunities"),
  );
  check(
    "I4 STEP_PROVIDER_DEPS.lines excludes sharpapi_ev_opportunities",
    !STEP_PROVIDER_DEPS.lines.includes("sharpapi_ev_opportunities"),
  );
  check(
    "I4 STEP_PROVIDER_DEPS.automodel excludes sharpapi_ev_opportunities",
    !STEP_PROVIDER_DEPS.automodel.includes("sharpapi_ev_opportunities"),
  );
  // S8 signals SHOULD list it — sanity that we didn't accidentally drop it.
  check(
    "I4 STEP_PROVIDER_DEPS.signals INCLUDES sharpapi_ev_opportunities",
    STEP_PROVIDER_DEPS.signals.includes("sharpapi_ev_opportunities"),
  );
}

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
