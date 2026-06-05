/**
 * Phase 4.2.C.1.R-19 Phase 2 — tests for the cron-safe slate-cycle
 * orchestrator's pure gate helpers + smoke test of the blocked-report
 * builder.
 *
 * The orchestrator's full pipeline (provider mode → reconciliation →
 * S1..M2) is hard to unit-test without heavy stubs, so this suite pins
 * the gate logic + report shape only. Integration is verified via the
 * live probe in the implementation report (read-only against today's
 * slate, no DB writes).
 *
 * Run: npx tsx scripts/test-automation-orchestrator-cron.ts
 */

import {
  isOrchestratorGateEnabled,
  readPerStepGates,
  computeEffectiveWriteMode,
  buildOrchestratorBlockedReport,
  isIntradayMode,
  PER_STEP_ENV_VARS,
  ORCHESTRATOR_GATE_ENV,
  SLATE_CYCLE_INTRADAY_MODE_ENV,
} from "../lib/services/automationOrchestratorGates";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

async function main() {
  // ── [A] Master gate (ORCHESTRATOR_SKIP_CONFIRMATION) ─────────────────
  section("Master gate — ORCHESTRATOR_SKIP_CONFIRMATION must be exactly 'true'");
  {
    check("env unset → false",                     isOrchestratorGateEnabled({}) === false);
    check("env = 'true' → true",                   isOrchestratorGateEnabled({ ORCHESTRATOR_SKIP_CONFIRMATION: "true" }) === true);
    check("env = 'TRUE' → false (case-sensitive)", isOrchestratorGateEnabled({ ORCHESTRATOR_SKIP_CONFIRMATION: "TRUE" }) === false);
    check("env = '1' → false",                     isOrchestratorGateEnabled({ ORCHESTRATOR_SKIP_CONFIRMATION: "1" }) === false);
    check("env = '' → false",                      isOrchestratorGateEnabled({ ORCHESTRATOR_SKIP_CONFIRMATION: "" }) === false);
    check("env = 'false' → false",                 isOrchestratorGateEnabled({ ORCHESTRATOR_SKIP_CONFIRMATION: "false" }) === false);
    check("env = undefined → false",               isOrchestratorGateEnabled({ ORCHESTRATOR_SKIP_CONFIRMATION: undefined }) === false);
  }

  // ── [B] Per-step gates ───────────────────────────────────────────────
  section("Per-step gates — each env var must be exactly 'true'");
  {
    const g0 = readPerStepGates({});
    check("all unset → all false", Object.values(g0).every((v) => v === false));

    const gAll = readPerStepGates({
      SLATE_DB_WRITES_ENABLED: "true",
      STARTER_DB_WRITES_ENABLED: "true",
      PLAYER_INGEST_DB_WRITES_ENABLED: "true",
      SEASON_PITCHING_DB_WRITES_ENABLED: "true",
      LINES_DB_WRITES_ENABLED: "true",
      SHARP_SIGNALS_DB_WRITES_ENABLED: "true",
      AUTOMODEL_DB_WRITES_ENABLED: "true",
    });
    check("all 'true' → all true", Object.values(gAll).every((v) => v === true));

    const gMixed = readPerStepGates({
      SLATE_DB_WRITES_ENABLED: "true",
      LINES_DB_WRITES_ENABLED: "true",
    });
    check("mixed: slate+lines true, others false",
      gMixed.slate === true && gMixed.lines === true &&
      gMixed.starter === false && gMixed.pitcher === false &&
      gMixed.season === false && gMixed.signals === false &&
      gMixed.automodel === false
    );

    const gTypos = readPerStepGates({
      SLATE_DB_WRITES_ENABLED: "TRUE",
      LINES_DB_WRITES_ENABLED: "1",
      AUTOMODEL_DB_WRITES_ENABLED: "yes",
    });
    check("typos do NOT count as enabled (strict 'true')",
      gTypos.slate === false && gTypos.lines === false && gTypos.automodel === false);
  }

  // ── [C] Effective write mode — three-way AND ─────────────────────────
  section("computeEffectiveWriteMode — all three conditions required");
  {
    // All three true → write
    check("orchestrator=t, perStep=t, upstreamBlocked=f → TRUE",
      computeEffectiveWriteMode({ orchestratorGate: true, perStepGate: true, upstreamBlocked: false }) === true);
    // Master gate off → no write
    check("orchestrator=f, perStep=t, upstreamBlocked=f → FALSE",
      computeEffectiveWriteMode({ orchestratorGate: false, perStepGate: true, upstreamBlocked: false }) === false);
    // Per-step gate off → no write
    check("orchestrator=t, perStep=f, upstreamBlocked=f → FALSE",
      computeEffectiveWriteMode({ orchestratorGate: true, perStepGate: false, upstreamBlocked: false }) === false);
    // Upstream blocked → no write (even if both gates set)
    check("orchestrator=t, perStep=t, upstreamBlocked=t → FALSE",
      computeEffectiveWriteMode({ orchestratorGate: true, perStepGate: true, upstreamBlocked: true }) === false);
    // Upstream blocked + others off → still FALSE
    check("orchestrator=f, perStep=f, upstreamBlocked=t → FALSE",
      computeEffectiveWriteMode({ orchestratorGate: false, perStepGate: false, upstreamBlocked: true }) === false);
  }

  // ── [D] Blocked-report builder ───────────────────────────────────────
  section("buildOrchestratorBlockedReport — structured response for missing gate");
  {
    const r = buildOrchestratorBlockedReport({ sport: "mlb", date: "2026-06-05" });
    check("returns blocked=true", r.blocked === true);
    check("reason mentions ORCHESTRATOR_SKIP_CONFIRMATION",
      r.reason.includes("ORCHESTRATOR_SKIP_CONFIRMATION"));
    check("includes requested_date", r.requested_date === "2026-06-05");
    check("includes sport", r.sport === "mlb");
    check("env_flag_required exposes the env var name",
      r.env_flag_required === ORCHESTRATOR_GATE_ENV);
  }

  // ── [E] Constant exposure / contract ─────────────────────────────────
  section("Constants — ORCHESTRATOR_GATE_ENV + PER_STEP_ENV_VARS exported");
  {
    check("ORCHESTRATOR_GATE_ENV is 'ORCHESTRATOR_SKIP_CONFIRMATION'",
      ORCHESTRATOR_GATE_ENV === "ORCHESTRATOR_SKIP_CONFIRMATION");
    check("PER_STEP_ENV_VARS.slate = SLATE_DB_WRITES_ENABLED",
      PER_STEP_ENV_VARS.slate === "SLATE_DB_WRITES_ENABLED");
    check("PER_STEP_ENV_VARS.lines = LINES_DB_WRITES_ENABLED",
      PER_STEP_ENV_VARS.lines === "LINES_DB_WRITES_ENABLED");
    check("PER_STEP_ENV_VARS.automodel = AUTOMODEL_DB_WRITES_ENABLED",
      PER_STEP_ENV_VARS.automodel === "AUTOMODEL_DB_WRITES_ENABLED");
    // 7 per-step gates expected
    const keys = Object.keys(PER_STEP_ENV_VARS);
    check("7 per-step env vars defined", keys.length === 7);
    check("expected keys present",
      ["slate", "starter", "pitcher", "season", "lines", "signals", "automodel"]
        .every((k) => keys.includes(k))
    );
  }

  // ── [F] Critical regression — Phase 2 default state ──────────────────
  // With NO env vars set (the state today and during dev), every step
  // must compute as effective_write_mode=false. This is the safe
  // default the user is asking us to preserve.
  section("Critical regression — env-empty default produces zero writes");
  {
    const env = {};  // empty
    const orchGate = isOrchestratorGateEnabled(env);
    const perStep = readPerStepGates(env);
    const allKeys = Object.keys(perStep) as (keyof typeof perStep)[];
    let anyWriteEffective = false;
    for (const k of allKeys) {
      const eff = computeEffectiveWriteMode({
        orchestratorGate: orchGate,
        perStepGate: perStep[k],
        upstreamBlocked: false,
      });
      if (eff) anyWriteEffective = true;
    }
    check("orchestrator gate disabled (default)", orchGate === false);
    check("all per-step gates disabled (default)",
      allKeys.every((k) => perStep[k] === false));
    check("zero effective writes across all steps (Phase 2 safe state)",
      anyWriteEffective === false);
  }

  // ── [G] Even with all per-step gates set, master gate disabled → no write ──
  section("Critical regression — per-step flags WITHOUT master gate → no write");
  {
    const env = {
      SLATE_DB_WRITES_ENABLED: "true",
      LINES_DB_WRITES_ENABLED: "true",
      AUTOMODEL_DB_WRITES_ENABLED: "true",
      // ORCHESTRATOR_SKIP_CONFIRMATION is NOT set
    };
    const orchGate = isOrchestratorGateEnabled(env);
    const perStep = readPerStepGates(env);
    check("master gate is OFF", orchGate === false);
    check("per-step slate is ON", perStep.slate === true);
    check("per-step lines is ON", perStep.lines === true);
    check("but effective write for slate = FALSE",
      computeEffectiveWriteMode({
        orchestratorGate: orchGate,
        perStepGate: perStep.slate,
        upstreamBlocked: false,
      }) === false);
  }

  // ── [H] R-19 Phase 5d — isIntradayMode ──────────────────────────────
  section("R-19 P5d — isIntradayMode (intraday mode resolver)");
  {
    const baseReq = new Request("http://x/api/cron/slate-cycle?date=2026-06-05");
    check("no param, no env → false", isIntradayMode(baseReq, {}) === false);
  }
  {
    const reqYes = new Request("http://x/api/cron/slate-cycle?intraday=true");
    check("query param 'true' + no env → true", isIntradayMode(reqYes, {}) === true);
  }
  {
    const reqWrong = new Request("http://x/api/cron/slate-cycle?intraday=yes");
    check("query param 'yes' (not 'true') → false", isIntradayMode(reqWrong, {}) === false);
  }
  {
    const reqWrong2 = new Request("http://x/api/cron/slate-cycle?intraday=TRUE");
    check("query param 'TRUE' → false (strict equality)", isIntradayMode(reqWrong2, {}) === false);
  }
  {
    const req = new Request("http://x/api/cron/slate-cycle");
    check("env 'true' + no query → true", isIntradayMode(req, { SLATE_CYCLE_INTRADAY_MODE: "true" }) === true);
    check("env 'TRUE' → false (strict)", isIntradayMode(req, { SLATE_CYCLE_INTRADAY_MODE: "TRUE" }) === false);
    check("env '1' → false", isIntradayMode(req, { SLATE_CYCLE_INTRADAY_MODE: "1" }) === false);
    check("env '' → false", isIntradayMode(req, { SLATE_CYCLE_INTRADAY_MODE: "" }) === false);
  }
  {
    // Query wins over env (when query is set; env irrelevant either way)
    const req = new Request("http://x/api/cron/slate-cycle?intraday=true");
    check("query 'true' + env undefined → true", isIntradayMode(req, {}) === true);
    check("query 'true' + env 'true' → true (both align)",
      isIntradayMode(req, { SLATE_CYCLE_INTRADAY_MODE: "true" }) === true);
  }
  {
    check("SLATE_CYCLE_INTRADAY_MODE_ENV = 'SLATE_CYCLE_INTRADAY_MODE'",
      SLATE_CYCLE_INTRADAY_MODE_ENV === "SLATE_CYCLE_INTRADAY_MODE");
  }

  // ── [I] R-19 P5d critical regression — write-flag mode after 1 game in progress ──
  // Conceptual coverage: ensure the gate logic doesn't accidentally
  // re-enable writes during morning-mode G3 fail_closed. The
  // computeEffectiveWriteMode pure helper still respects
  // upstreamBlocked=true regardless of any new intraday flag.
  section("R-19 P5d — write-flag mode unchanged when upstreamBlocked=true");
  {
    // upstreamBlocked=true is the orchestrator's morning-mode cascade
    // (G3 fail_closed → dataLayerBlocked=true). Confirm helper still
    // forces write_mode=false.
    check("morning mode + G3 fired (upstreamBlocked=true) → effective write OFF",
      computeEffectiveWriteMode({
        orchestratorGate: true,
        perStepGate: true,
        upstreamBlocked: true,
      }) === false);
    // Intraday-mode equivalent: orchestrator computes upstreamBlocked
    // WITHOUT G3 cascade. So when the only block is G3 (and intraday
    // is true), upstreamBlocked → false, and effective_write_mode is
    // TRUE for steps whose per-step env is set. The helper itself
    // doesn't know about intraday; the orchestrator does.
    check("intraday mode + G3 fired but upstreamBlocked=false → effective write ON",
      computeEffectiveWriteMode({
        orchestratorGate: true,
        perStepGate: true,
        upstreamBlocked: false,
      }) === true);
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All automation-orchestrator-cron tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); }
);
