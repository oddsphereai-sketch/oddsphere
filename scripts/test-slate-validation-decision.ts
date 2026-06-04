/**
 * Phase 4.2.C.1.R-1 — pure unit tests for the slate apply decision
 * helper used by `scripts/operator/refresh-slate.ts`.
 *
 * No HTTP, no DB. Covers the full decision matrix from
 * `lib/services/slateValidationDecision.ts`.
 */

import { decideSlateApply } from "../lib/services/slateValidationDecision";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}
function section(label: string): void {
  console.log(`\n━━━ ${label} ━━━`);
}

// ─── overlap above threshold → allow ─────────────────────────────────

function test_PassedNoOverride() {
  section("overlap above threshold → allow");
  const r = decideSlateApply({
    passed: true,
    reason: null,
    sharpApiFetchError: null,
    allowMismatch: false,
  });
  check("kind === 'allow'", r.kind === "allow");
}

function test_PassedWithOverrideFlag() {
  section("overlap above threshold + override flag → still plain allow");
  // Override is irrelevant when the comparison already passed; the
  // decision should not flip to allow_with_override just because the
  // operator passed the flag defensively.
  const r = decideSlateApply({
    passed: true,
    reason: null,
    sharpApiFetchError: null,
    allowMismatch: true,
  });
  check("kind === 'allow' (not 'allow_with_override')", r.kind === "allow");
}

// ─── overlap below threshold without override → block (default safety) ───

function test_FailedNoOverride() {
  section("overlap below threshold WITHOUT override → block");
  const r = decideSlateApply({
    passed: false,
    reason: "overlap 53.3% < threshold 90%",
    sharpApiFetchError: null,
    allowMismatch: false,
  });
  check("kind === 'block'", r.kind === "block");
  if (r.kind !== "block") return;
  check(
    "block reason quotes the overlap shortfall",
    r.reason.includes("53.3%") && r.reason.includes("90%")
  );
}

function test_FailedNoOverride_NullReason() {
  section("overlap below threshold with null reason → block with default");
  const r = decideSlateApply({
    passed: false,
    reason: null,
    sharpApiFetchError: null,
    allowMismatch: false,
  });
  check("kind === 'block'", r.kind === "block");
  if (r.kind !== "block") return;
  check("block reason defaults non-empty", r.reason.length > 0);
}

// ─── overlap below threshold WITH override → allow_with_override ──────

function test_FailedWithOverride() {
  section("overlap below threshold WITH --allow-validation-mismatch → allow_with_override");
  const r = decideSlateApply({
    passed: false,
    reason: "overlap 53.3% < threshold 90%",
    sharpApiFetchError: null,
    allowMismatch: true,
  });
  check("kind === 'allow_with_override'", r.kind === "allow_with_override");
  if (r.kind !== "allow_with_override") return;
  check(
    "override carries the validation reason",
    r.reason.includes("53.3%") && r.reason.includes("90%")
  );
  check(
    "override_source names the CLI flag",
    r.override_source === "--allow-validation-mismatch"
  );
}

function test_FailedWithOverride_NullReason() {
  section("overlap below threshold + override + null reason → allow_with_override w/ default reason");
  // Defensive: the caller should always supply a reason, but the
  // helper must degrade gracefully rather than emit an empty string
  // that loses audit context downstream.
  const r = decideSlateApply({
    passed: false,
    reason: null,
    sharpApiFetchError: null,
    allowMismatch: true,
  });
  check("kind === 'allow_with_override'", r.kind === "allow_with_override");
  if (r.kind !== "allow_with_override") return;
  check("override reason defaults non-empty", r.reason.length > 0);
}

// ─── fetch errors are NEVER overrideable ─────────────────────────────

function test_FetchErrorWithoutOverride() {
  section("SharpAPI fetch error, no override → block");
  const r = decideSlateApply({
    passed: false,
    reason: null,
    sharpApiFetchError: "HTTP 503",
    allowMismatch: false,
  });
  check("kind === 'block'", r.kind === "block");
  if (r.kind !== "block") return;
  check("block reason quotes the fetch error", r.reason.includes("HTTP 503"));
}

function test_FetchErrorWithOverride_StillBlocks() {
  section("SharpAPI fetch error WITH override → STILL block (different safety class)");
  // Critical: --allow-validation-mismatch only unlocks the
  // "comparison ran and failed" branch. A fetch error means we never
  // compared anything, so the override has no evidence to override
  // against. Must remain blocking.
  const r = decideSlateApply({
    passed: false,
    reason: "overlap 53.3% < threshold 90%",
    sharpApiFetchError: "fetch failed: ECONNRESET",
    allowMismatch: true,
  });
  check("kind === 'block' (override does NOT bypass fetch error)", r.kind === "block");
  if (r.kind !== "block") return;
  check("block reason quotes the fetch error", r.reason.includes("ECONNRESET"));
}

// ─── boundary: passed=true wins over a fetch error (logically impossible
//     but the helper must still behave defensively) ────────────────────

function test_PassedTrueWithFetchError_BlocksOnError() {
  section("passed=true with a fetch error reported → block on fetch error");
  // In practice the caller computes `passed` from the overlap which
  // requires a successful fetch. But if both states are passed in,
  // the fetch-error precondition must win — we treat the absence of
  // a valid comparison as the dominant signal.
  const r = decideSlateApply({
    passed: true,
    reason: null,
    sharpApiFetchError: "HTTP 500",
    allowMismatch: false,
  });
  check("kind === 'block' (fetch-error precondition dominates)", r.kind === "block");
}

// ─── Runner ─────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4.2.C.1.R-1 — slate validation decision tests");
  console.log("===================================================");

  test_PassedNoOverride();
  test_PassedWithOverrideFlag();
  test_FailedNoOverride();
  test_FailedNoOverride_NullReason();
  test_FailedWithOverride();
  test_FailedWithOverride_NullReason();
  test_FetchErrorWithoutOverride();
  test_FetchErrorWithOverride_StillBlocks();
  test_PassedTrueWithFetchError_BlocksOnError();

  console.log();
  console.log("===================================================");
  console.log(`Total: ${pass + fail}  pass: ${pass}  fail: ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
