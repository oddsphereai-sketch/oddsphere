/**
 * Phase 4.2.C.1.R-19 Phase 5a — pregame-sweep safety-gate tests.
 *
 * Pins the new dry-run + master-gate behavior added to
 * /api/cron/pregame-sweep/route.ts:
 *
 *   • missing CRON_SECRET still returns 401
 *   • dryRun=true works without PREGAME_SWEEP_CRON_ACTIVE (read-only)
 *   • dryRun=true returns structured snapshot, ZERO writes
 *   • non-dry-run without PREGAME_SWEEP_CRON_ACTIVE returns blocked report
 *   • partial: true is set on blocked responses
 *   • report fields include dry_run, pregame_sweep_active, partition,
 *     would_lock_count, steps_skipped
 *
 * The write-path is exercised by scripts/test-refresh-cycle-crons.ts
 * (which now sets PREGAME_SWEEP_CRON_ACTIVE=true around the existing
 * pregame-sweep test).
 *
 * Pure helper unit tests cover the env+query parsers
 * (isPregameSweepDryRun, isPregameSweepGateActive,
 *  buildPregameSweepBlockedDetails) — these are exported from the
 * route module.
 *
 * Run: npx tsx scripts/test-pregame-sweep-safety.ts
 */

import {
  isPregameSweepDryRun,
  isPregameSweepGateActive,
  buildPregameSweepBlockedDetails,
  PREGAME_SWEEP_CRON_ACTIVE_ENV,
  PREGAME_SWEEP_DRY_RUN_ENV,
  GET as pregameSweep,
} from "../app/api/cron/pregame-sweep/route";

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

const TEST_SECRET = "test-secret-pregame-sweep-safety";
const SLATE_DATE = "2026-06-04";

function makeRequest(opts: { secret?: string; dryRun?: boolean | "raw"; date?: string }): Request {
  const url = new URL("http://localhost/api/cron/pregame-sweep");
  url.searchParams.set("date", opts.date ?? SLATE_DATE);
  if (opts.dryRun === true) url.searchParams.set("dryRun", "true");
  if (opts.dryRun === "raw") url.searchParams.set("dryRun", "TRUE"); // case test
  const headers = new Headers();
  if (opts.secret) headers.set("Authorization", `Bearer ${opts.secret}`);
  return new Request(url, { method: "GET", headers });
}

async function main() {
  // ── [A] Pure helpers — isPregameSweepDryRun ─────────────────────────
  section("isPregameSweepDryRun — query param OR env");
  {
    const reqNo = new Request("http://x/api/cron/pregame-sweep");
    check("no param, no env → false", isPregameSweepDryRun(reqNo, {}) === false);
    check("env = 'true' → true", isPregameSweepDryRun(reqNo, { PREGAME_SWEEP_DRY_RUN: "true" }) === true);
    check("env = 'TRUE' → false (strict)", isPregameSweepDryRun(reqNo, { PREGAME_SWEEP_DRY_RUN: "TRUE" }) === false);
    check("env = '1' → false", isPregameSweepDryRun(reqNo, { PREGAME_SWEEP_DRY_RUN: "1" }) === false);
    check("env = '' → false", isPregameSweepDryRun(reqNo, { PREGAME_SWEEP_DRY_RUN: "" }) === false);

    const reqDry = new Request("http://x/api/cron/pregame-sweep?dryRun=true");
    check("query param = 'true' + no env → true", isPregameSweepDryRun(reqDry, {}) === true);

    const reqWrong = new Request("http://x/api/cron/pregame-sweep?dryRun=yes");
    check("query param = 'yes' (not 'true') → false", isPregameSweepDryRun(reqWrong, {}) === false);

    const reqEither = new Request("http://x/api/cron/pregame-sweep?dryRun=true");
    check("query param wins + env unset → true", isPregameSweepDryRun(reqEither, {}) === true);
  }

  // ── [B] Pure helpers — isPregameSweepGateActive ─────────────────────
  section("isPregameSweepGateActive — strict env check");
  {
    check("empty env → false", isPregameSweepGateActive({}) === false);
    check("'true' → true", isPregameSweepGateActive({ PREGAME_SWEEP_CRON_ACTIVE: "true" }) === true);
    check("'TRUE' → false (strict)", isPregameSweepGateActive({ PREGAME_SWEEP_CRON_ACTIVE: "TRUE" }) === false);
    check("'1' → false", isPregameSweepGateActive({ PREGAME_SWEEP_CRON_ACTIVE: "1" }) === false);
    check("'yes' → false", isPregameSweepGateActive({ PREGAME_SWEEP_CRON_ACTIVE: "yes" }) === false);
    check("'false' → false", isPregameSweepGateActive({ PREGAME_SWEEP_CRON_ACTIVE: "false" }) === false);
    check("undefined → false", isPregameSweepGateActive({ PREGAME_SWEEP_CRON_ACTIVE: undefined }) === false);
  }

  // ── [C] Constants ───────────────────────────────────────────────────
  section("Constants");
  {
    check("PREGAME_SWEEP_CRON_ACTIVE_ENV = 'PREGAME_SWEEP_CRON_ACTIVE'", PREGAME_SWEEP_CRON_ACTIVE_ENV === "PREGAME_SWEEP_CRON_ACTIVE");
    check("PREGAME_SWEEP_DRY_RUN_ENV = 'PREGAME_SWEEP_DRY_RUN'", PREGAME_SWEEP_DRY_RUN_ENV === "PREGAME_SWEEP_DRY_RUN");
  }

  // ── [D] Blocked-report builder ──────────────────────────────────────
  section("buildPregameSweepBlockedDetails");
  {
    const d = buildPregameSweepBlockedDetails({ sport: "mlb", date: "2026-06-05" });
    check("blocked=true", d.blocked === true);
    check("reason mentions env flag name", String(d.reason).includes("PREGAME_SWEEP_CRON_ACTIVE"));
    check("reason mentions dryRun=true alternative", String(d.reason).includes("dryRun=true"));
    check("env_flag_required exposes the name", d.env_flag_required === PREGAME_SWEEP_CRON_ACTIVE_ENV);
    check("dry_run = false", d.dry_run === false);
    check("pregame_sweep_active = false", d.pregame_sweep_active === false);
    check("sport echoed", d.sport === "mlb");
    check("date echoed", d.date === "2026-06-05");
  }

  // ── [E] Integration — invoke GET() in-process ───────────────────────
  // The route uses cronHandlerPerSport which:
  //   1. Validates CRON_SECRET → 401 on miss
  //   2. Per-sport lock check (cleared between tests)
  //   3. Calls our handler
  // We set CRON_SECRET in process.env so the auth gate passes, then
  // exercise the dry-run / blocked / write paths via env + query.
  section("Integration — GET handler dispatch");

  const origSecret = process.env.CRON_SECRET;
  const origGate = process.env.PREGAME_SWEEP_CRON_ACTIVE;
  const origDry = process.env.PREGAME_SWEEP_DRY_RUN;
  process.env.CRON_SECRET = TEST_SECRET;

  try {
    // [E.1] Missing CRON_SECRET still returns 401
    {
      delete process.env.PREGAME_SWEEP_CRON_ACTIVE;
      delete process.env.PREGAME_SWEEP_DRY_RUN;
      const res = await pregameSweep(makeRequest({})); // no secret
      check("[E.1] no CRON_SECRET → 401", res.status === 401);
    }

    // [E.2] dryRun=true (query) + no master gate → 200 + dry_run report
    {
      delete process.env.PREGAME_SWEEP_CRON_ACTIVE;
      delete process.env.PREGAME_SWEEP_DRY_RUN;
      const res = await pregameSweep(makeRequest({ secret: TEST_SECRET, dryRun: true }));
      check("[E.2] dryRun=true (query) + no gate → 200", res.status === 200);
      const body = (await res.json()) as { ok: boolean; runs?: Array<Record<string, unknown>> };
      check("[E.2] body.ok = true", body.ok === true);
      const mlb = body.runs?.find((r) => r.sport === "mlb");
      check("[E.2] mlb run present", mlb !== undefined);
      check("[E.2] mlb status = 'ok' (dry-run succeeded)", mlb?.status === "ok");
      check("[E.2] records_updated = 0 (no writes)", mlb?.records_updated === 0);
      const details = (mlb?.details ?? {}) as Record<string, unknown>;
      check("[E.2] details.dry_run = true", details.dry_run === true);
      check("[E.2] details.pregame_sweep_active = false (gate not set)", details.pregame_sweep_active === false);
      check("[E.2] details.candidates_count is a number", typeof details.candidates_count === "number");
      check("[E.2] details.partition object present", typeof details.partition === "object");
      check("[E.2] details.would_lock_count is a number", typeof details.would_lock_count === "number");
      check("[E.2] details.would_lock_games is an array", Array.isArray(details.would_lock_games));
      check("[E.2] details.steps_skipped is an array", Array.isArray(details.steps_skipped));
      check("[E.2] details.lock_writes_skipped is a number", typeof details.lock_writes_skipped === "number");
      // The 7 skipped step names match what the route documented
      const skipped = details.steps_skipped as string[];
      check(
        "[E.2] steps_skipped includes lock_updates",
        skipped.includes("lock_updates")
      );
      check(
        "[E.2] steps_skipped includes audit_inserts",
        skipped.includes("audit_inserts")
      );
      check(
        "[E.2] steps_skipped includes entering_lock_t60_model_pass",
        skipped.includes("entering_lock_t60_model_pass")
      );
    }

    // [E.3] dryRun via PREGAME_SWEEP_DRY_RUN env (no query param)
    {
      delete process.env.PREGAME_SWEEP_CRON_ACTIVE;
      process.env.PREGAME_SWEEP_DRY_RUN = "true";
      const res = await pregameSweep(makeRequest({ secret: TEST_SECRET }));
      check("[E.3] env-flag dry-run + no gate → 200", res.status === 200);
      const body = (await res.json()) as { runs?: Array<Record<string, unknown>> };
      const mlb = body.runs?.find((r) => r.sport === "mlb");
      const details = (mlb?.details ?? {}) as Record<string, unknown>;
      check("[E.3] details.dry_run = true (via env)", details.dry_run === true);
      check("[E.3] records_updated = 0", mlb?.records_updated === 0);
    }

    // [E.4] dryRun=true with gate active too — still dry-run (no writes)
    {
      process.env.PREGAME_SWEEP_CRON_ACTIVE = "true";
      delete process.env.PREGAME_SWEEP_DRY_RUN;
      const res = await pregameSweep(makeRequest({ secret: TEST_SECRET, dryRun: true }));
      check("[E.4] dryRun=true + gate=true → 200", res.status === 200);
      const body = (await res.json()) as { runs?: Array<Record<string, unknown>> };
      const mlb = body.runs?.find((r) => r.sport === "mlb");
      const details = (mlb?.details ?? {}) as Record<string, unknown>;
      check("[E.4] details.dry_run = true (dry-run wins)", details.dry_run === true);
      check("[E.4] details.pregame_sweep_active = true (gate reflected)", details.pregame_sweep_active === true);
      check("[E.4] records_updated = 0 (no writes despite gate)", mlb?.records_updated === 0);
    }

    // [E.5] Non-dry-run, gate missing → blocked report
    {
      delete process.env.PREGAME_SWEEP_CRON_ACTIVE;
      delete process.env.PREGAME_SWEEP_DRY_RUN;
      const res = await pregameSweep(makeRequest({ secret: TEST_SECRET }));
      check("[E.5] no dryRun + no gate → 200 (structured block)", res.status === 200);
      const body = (await res.json()) as { runs?: Array<Record<string, unknown>> };
      const mlb = body.runs?.find((r) => r.sport === "mlb");
      const details = (mlb?.details ?? {}) as Record<string, unknown>;
      check("[E.5] details.blocked = true", details.blocked === true);
      check("[E.5] details.dry_run = false", details.dry_run === false);
      check("[E.5] details.pregame_sweep_active = false", details.pregame_sweep_active === false);
      check(
        "[E.5] details.env_flag_required = 'PREGAME_SWEEP_CRON_ACTIVE'",
        details.env_flag_required === "PREGAME_SWEEP_CRON_ACTIVE"
      );
      check("[E.5] records_updated = 0", mlb?.records_updated === 0);
      check("[E.5] mlb status = 'partial' (operator monitoring signal)", mlb?.status === "partial");
    }

    // [E.6] Strict equality — only `dryRun=true` (lowercase exact) opts in
    {
      delete process.env.PREGAME_SWEEP_CRON_ACTIVE;
      delete process.env.PREGAME_SWEEP_DRY_RUN;
      const res = await pregameSweep(makeRequest({ secret: TEST_SECRET, dryRun: "raw" })); // dryRun=TRUE
      const body = (await res.json()) as { runs?: Array<Record<string, unknown>> };
      const mlb = body.runs?.find((r) => r.sport === "mlb");
      const details = (mlb?.details ?? {}) as Record<string, unknown>;
      // dryRun=TRUE should NOT be treated as dry-run (case sensitive),
      // so without master gate this falls into the blocked path.
      check("[E.6] dryRun=TRUE does NOT opt into dry-run (strict)", details.dry_run === false);
      check("[E.6] dryRun=TRUE without gate → blocked", details.blocked === true);
    }
  } finally {
    if (origSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = origSecret;
    if (origGate === undefined) delete process.env.PREGAME_SWEEP_CRON_ACTIVE;
    else process.env.PREGAME_SWEEP_CRON_ACTIVE = origGate;
    if (origDry === undefined) delete process.env.PREGAME_SWEEP_DRY_RUN;
    else process.env.PREGAME_SWEEP_DRY_RUN = origDry;
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All pregame-sweep safety tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); }
);
