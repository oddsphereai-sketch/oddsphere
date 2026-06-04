/**
 * Phase 4.2.C.1.H-6.3b — pure unit tests for the FI backfill operator's
 * season-resolution helper.
 *
 * No HTTP, no DB. Covers the full decision matrix from
 * `lib/services/firstInningSeasonResolver.ts`.
 */

import { resolveOperatorSeason } from "../lib/services/firstInningSeasonResolver";

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

// ─── slate-date only (default season from slate year) ────────────────

async function test_SlateDateOnly() {
  section("slate-date only → season derived from slate year");
  const r = resolveOperatorSeason({
    slateDate: "2026-06-03",
    seasonFlag: undefined,
    allowMismatch: false,
  });
  check("kind === 'ok'", r.kind === "ok");
  if (r.kind !== "ok") return;
  check("season === 2026", r.season === 2026);
  check("source === 'derived_from_slate_date'", r.source === "derived_from_slate_date");
}

async function test_SlateDateOnly_DifferentYear() {
  section("slate-date only — different year (2025-09-15)");
  const r = resolveOperatorSeason({
    slateDate: "2025-09-15",
    seasonFlag: undefined,
    allowMismatch: false,
  });
  check("season === 2025", r.kind === "ok" && r.season === 2025);
}

// ─── explicit season only (legitimate historical backfill) ───────────

async function test_ExplicitSeasonOnly() {
  section("explicit --season only (historical backfill)");
  const r = resolveOperatorSeason({
    slateDate: undefined,
    seasonFlag: "2026",
    allowMismatch: false,
  });
  check("kind === 'ok'", r.kind === "ok");
  if (r.kind !== "ok") return;
  check("season === 2026", r.season === 2026);
  check("source === 'explicit_flag'", r.source === "explicit_flag");
}

async function test_ExplicitSeasonOnly_HistoricalYear() {
  section("explicit --season only — historical year (2022)");
  const r = resolveOperatorSeason({
    slateDate: undefined,
    seasonFlag: "2022",
    allowMismatch: false,
  });
  check("season === 2022", r.kind === "ok" && r.season === 2022);
}

// ─── both provided, years match ──────────────────────────────────────

async function test_BothMatch() {
  section("both --slate-date and --season provided, years match");
  const r = resolveOperatorSeason({
    slateDate: "2026-06-15",
    seasonFlag: "2026",
    allowMismatch: false,
  });
  check("kind === 'ok'", r.kind === "ok");
  if (r.kind !== "ok") return;
  check("season === 2026", r.season === 2026);
  check("source === 'matched_explicit_and_slate'", r.source === "matched_explicit_and_slate");
}

// ─── both provided, years mismatch (the H-6.3a bug shape) ────────────

async function test_BothMismatchRejected() {
  section("both provided, years mismatch — REJECTED without --allow-season-mismatch");
  const r = resolveOperatorSeason({
    slateDate: "2026-06-03",
    seasonFlag: "2025",
    allowMismatch: false,
  });
  check("kind === 'error' (H-6.3 bug shape blocked)", r.kind === "error");
  if (r.kind !== "error") return;
  check(
    "error mentions both years explicitly",
    r.message.includes("2026") && r.message.includes("2025")
  );
  check(
    "error names the override flag",
    r.message.includes("--allow-season-mismatch")
  );
  check(
    "error explains the H-6.3 bug shape (no NRFI signal)",
    r.message.includes("H-6.3") || r.message.includes("NRFI") || r.message.includes("held")
  );
}

async function test_BothMismatchOverride() {
  section("both provided, years mismatch — ALLOWED with --allow-season-mismatch");
  const r = resolveOperatorSeason({
    slateDate: "2026-06-03",
    seasonFlag: "2025",
    allowMismatch: true,
  });
  check("kind === 'ok' with override", r.kind === "ok");
  if (r.kind !== "ok") return;
  // Explicit --season wins when operator opts in
  check("season === 2025 (explicit flag wins on override)", r.season === 2025);
  check("source === 'mismatch_override'", r.source === "mismatch_override");
}

// ─── missing both → reject ──────────────────────────────────────────

async function test_MissingBoth() {
  section("neither --slate-date nor --season → REJECTED");
  const r = resolveOperatorSeason({
    slateDate: undefined,
    seasonFlag: undefined,
    allowMismatch: false,
  });
  check("kind === 'error'", r.kind === "error");
  if (r.kind !== "error") return;
  check(
    "error tells caller what to provide",
    r.message.includes("--season") && r.message.includes("--slate-date")
  );
}

// ─── invalid --season flag ──────────────────────────────────────────

async function test_InvalidSeasonFlag() {
  section("--season is not a parseable number → REJECTED");
  const r = resolveOperatorSeason({
    slateDate: undefined,
    seasonFlag: "nope",
    allowMismatch: false,
  });
  check("kind === 'error'", r.kind === "error");
  if (r.kind !== "error") return;
  check("error quotes the bad value", r.message.includes("nope"));
}

async function test_OutOfRangeSeasonFlag() {
  section("--season is numerically out of range → REJECTED");
  const tooLow = resolveOperatorSeason({
    slateDate: undefined,
    seasonFlag: "1999",
    allowMismatch: false,
  });
  check("season=1999 rejected", tooLow.kind === "error");
  const tooHigh = resolveOperatorSeason({
    slateDate: undefined,
    seasonFlag: "3000",
    allowMismatch: false,
  });
  check("season=3000 rejected", tooHigh.kind === "error");
}

async function test_InvalidSeasonFlag_TakesPrecedenceOverSlateDefault() {
  section("--season invalid + --slate-date present → still REJECTED");
  // We intentionally don't silently default from slate-date when the
  // explicit flag is malformed — operator wrote something they meant
  // and got it wrong, so flag the error.
  const r = resolveOperatorSeason({
    slateDate: "2026-06-03",
    seasonFlag: "garbage",
    allowMismatch: false,
  });
  check("rejected (invalid flag takes precedence over silent fallback)", r.kind === "error");
}

// ─── slate-date format edge cases ───────────────────────────────────

async function test_SlateDateMalformed_TreatedAsAbsent() {
  section("malformed --slate-date (no --season) → REJECTED (no source available)");
  // The operator's date-format validator runs upstream, so this is
  // mostly belt-and-suspenders. Helper sees no extractable year and
  // no --season flag → returns the missing-source error.
  const r = resolveOperatorSeason({
    slateDate: "not-a-date",
    seasonFlag: undefined,
    allowMismatch: false,
  });
  check("kind === 'error'", r.kind === "error");
}

async function test_SlateDateMalformed_FlagSaves() {
  section("malformed --slate-date + valid --season → uses flag");
  // Defensive: if slate-date is unparseable but --season is valid, we
  // can still proceed via the explicit flag.
  const r = resolveOperatorSeason({
    slateDate: "not-a-date",
    seasonFlag: "2026",
    allowMismatch: false,
  });
  check("kind === 'ok'", r.kind === "ok");
  if (r.kind === "ok") check("source === 'explicit_flag'", r.source === "explicit_flag");
}

// ─── Runner ─────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4.2.C.1.H-6.3b — FI backfill season-resolver tests");
  console.log("=========================================================");

  await test_SlateDateOnly();
  await test_SlateDateOnly_DifferentYear();
  await test_ExplicitSeasonOnly();
  await test_ExplicitSeasonOnly_HistoricalYear();
  await test_BothMatch();
  await test_BothMismatchRejected();
  await test_BothMismatchOverride();
  await test_MissingBoth();
  await test_InvalidSeasonFlag();
  await test_OutOfRangeSeasonFlag();
  await test_InvalidSeasonFlag_TakesPrecedenceOverSlateDefault();
  await test_SlateDateMalformed_TreatedAsAbsent();
  await test_SlateDateMalformed_FlagSaves();

  console.log();
  console.log("=========================================================");
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
