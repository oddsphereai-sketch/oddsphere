/**
 * Phase 4B — unit tests for operator-script CLI parsing.
 *
 * Covers the shared parser helpers in scripts/operator/_cliCommon.ts:
 *   • parseCommonCliOptions defaults + validation
 *   • readStringFlag / readNumberFlag / readBoolFlag
 *   • parseStageFlag
 *   • rejectWriteFlag (via process.exit stub)
 *
 * Plus an end-to-end integration check: actually spawn the
 * morning-card script with `--write` and verify exit code 1 + the
 * rejection text in stderr.
 *
 * No DB. Runs via:
 *   npx tsx scripts/test-operator-cli-parsing.ts
 */

import { spawnSync } from "child_process";
import {
  parseCommonCliOptions,
  parseStageFlag,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  rejectWriteFlag,
  todayUTC,
} from "../scripts/operator/_cliCommon";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
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

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

function checkThrows(label: string, fn: () => unknown, expectedSubstr?: string) {
  try {
    fn();
    fail++;
    const msg = `  ✗ ${label} did NOT throw`;
    console.log(msg);
    failures.push(msg);
  } catch (e) {
    const m = (e as Error).message;
    if (!expectedSubstr || m.includes(expectedSubstr)) {
      pass++;
      console.log(`  ✓ ${label} threw "${m.slice(0, 80)}"`);
    } else {
      fail++;
      const msg = `  ✗ ${label} threw wrong message: ${m}`;
      console.log(msg);
      failures.push(msg);
    }
  }
}

// ─── readStringFlag ───────────────────────────────────────────────────
section("readStringFlag — space-separated and equals-separated forms");

check(
  '--date 2026-05-22 → "2026-05-22"',
  readStringFlag(["--date", "2026-05-22"], "--date") === "2026-05-22"
);
check(
  '--date=2026-05-22 → "2026-05-22"',
  readStringFlag(["--date=2026-05-22"], "--date") === "2026-05-22"
);
check(
  "missing flag → undefined",
  readStringFlag(["--other"], "--date") === undefined
);
check(
  "flag with no value (next arg is another flag) → undefined",
  readStringFlag(["--date", "--sport", "mlb"], "--date") === undefined
);
check(
  "empty argv → undefined",
  readStringFlag([], "--date") === undefined
);

// ─── readNumberFlag ───────────────────────────────────────────────────
section("readNumberFlag — number parsing + NaN handling");

check(
  "--window-minutes 75 → 75",
  readNumberFlag(["--window-minutes", "75"], "--window-minutes") === 75
);
check(
  "--window-minutes=30 → 30",
  readNumberFlag(["--window-minutes=30"], "--window-minutes") === 30
);
check(
  "--n garbage → undefined",
  readNumberFlag(["--n", "abc"], "--n") === undefined
);
check(
  "missing → undefined",
  readNumberFlag([], "--n") === undefined
);
check(
  "negative number → still a number (caller validates if needed)",
  readNumberFlag(["--n", "-5"], "--n") === -5
);
check(
  "decimal → parsed",
  readNumberFlag(["--n", "8.5"], "--n") === 8.5
);

// ─── readBoolFlag ─────────────────────────────────────────────────────
section("readBoolFlag — presence check");

check(
  "--verbose present → true",
  readBoolFlag(["--verbose"], "--verbose") === true
);
check(
  "--verbose absent → false",
  readBoolFlag(["--date", "2026-05-22"], "--verbose") === false
);
check(
  "case-sensitive: --VERBOSE !== --verbose",
  readBoolFlag(["--VERBOSE"], "--verbose") === false
);

// ─── parseCommonCliOptions ────────────────────────────────────────────
section("parseCommonCliOptions — defaults, validation, sport routing");

const today = todayUTC();
const defaults = parseCommonCliOptions([]);
check(
  `defaults: date=today (${today}), sport=mlb, json=false, verbose=false`,
  defaults.date === today &&
    defaults.sport === "mlb" &&
    defaults.json === false &&
    defaults.verbose === false
);

const withFlags = parseCommonCliOptions([
  "--date",
  "2026-05-22",
  "--sport",
  "mlb",
  "--json",
  "--verbose",
]);
check(
  "all flags set → mirrored",
  withFlags.date === "2026-05-22" &&
    withFlags.sport === "mlb" &&
    withFlags.json === true &&
    withFlags.verbose === true
);

checkThrows(
  "invalid date format → throws with helpful message",
  () => parseCommonCliOptions(["--date", "2026/05/22"]),
  "YYYY-MM-DD"
);

checkThrows(
  "invalid sport → throws listing valid sports",
  () => parseCommonCliOptions(["--sport", "soccer"]),
  "mlb"
);

const nbaOpts = parseCommonCliOptions(["--sport", "nba"]);
check(
  "valid non-mlb sport accepted (parser is sport-agnostic; V1 MLB-only is orchestrator concern)",
  nbaOpts.sport === "nba"
);

// ─── parseStageFlag ───────────────────────────────────────────────────
section("parseStageFlag — only morning_draft | t60_locked allowed");

check(
  '--stage morning_draft → "morning_draft"',
  parseStageFlag(["--stage", "morning_draft"], "t60_locked") ===
    "morning_draft"
);
check(
  '--stage t60_locked → "t60_locked"',
  parseStageFlag(["--stage", "t60_locked"], "morning_draft") === "t60_locked"
);
check(
  "no --stage → returns default",
  parseStageFlag([], "morning_draft") === "morning_draft"
);
check(
  "no --stage with different default → returns that default",
  parseStageFlag([], "t60_locked") === "t60_locked"
);
checkThrows(
  "invalid --stage → throws",
  () => parseStageFlag(["--stage", "preseason"], "morning_draft"),
  "Invalid --stage"
);

// ─── rejectWriteFlag (process.exit stub) ──────────────────────────────
section("rejectWriteFlag — process.exit on --write");

const originalExit = process.exit;
const originalError = console.error;
let exitCode: number | null = null;
let stderr = "";
const exitStub: (code?: number) => never = ((code?: number) => {
  exitCode = code ?? 0;
  throw new Error("__test_exit__");
}) as unknown as (code?: number) => never;
console.error = (msg: string) => {
  stderr += msg + "\n";
};
try {
  process.exit = exitStub;
  try {
    rejectWriteFlag(["--write"]);
    check("rejectWriteFlag(--write) called process.exit", false);
  } catch (e) {
    check(
      "rejectWriteFlag(--write) triggered process.exit(1)",
      (e as Error).message === "__test_exit__" && exitCode === 1
    );
  }
  check(
    "rejectWriteFlag(--write) wrote rejection message to stderr",
    stderr.includes("not supported in Phase 4B") && stderr.includes("Phase 4C")
  );

  // No --write → does NOT exit
  exitCode = null;
  stderr = "";
  try {
    rejectWriteFlag(["--date", "2026-05-22", "--json"]);
    check("rejectWriteFlag(no --write) does NOT call process.exit", exitCode === null);
  } catch (e) {
    check(
      `rejectWriteFlag(no --write) should NOT have thrown — got "${(e as Error).message}"`,
      false
    );
  }
} finally {
  process.exit = originalExit;
  console.error = originalError;
}

// ─── End-to-end: spawn morning-card with --write ─────────────────────
section("End-to-end — spawn morning-card --write expects exit 1 + Phase 4C message");

// Spawn needs --env-file=.env.local because the operator script imports
// the orchestrator (which imports supabase) at module load. Without env,
// the process would die during import with a "Missing NEXT_PUBLIC_SUPABASE_URL"
// error and exit 1, masking the actual rejectWriteFlag rejection. With env,
// modules load cleanly, main() runs, rejectWriteFlag exits 1 with the
// approved Phase 4B rejection message.
const result = spawnSync(
  "npx",
  [
    "tsx",
    "--env-file=.env.local",
    "scripts/operator/automodel-morning-card.ts",
    "--write",
  ],
  { encoding: "utf-8", cwd: process.cwd() }
);
check(
  "spawn morning-card --write exited with non-zero status",
  result.status !== 0
);
check(
  "spawn morning-card --write status === 1 (rejection)",
  result.status === 1
);
const combinedOutput = (result.stdout ?? "") + (result.stderr ?? "");
check(
  "spawn morning-card --write stderr/stdout contains 'not supported in Phase 4B'",
  combinedOutput.includes("not supported in Phase 4B")
);
check(
  "spawn morning-card --write stderr/stdout points to Phase 4C",
  combinedOutput.includes("Phase 4C")
);

// ─── Summary ──────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All operator-cli-parsing tests passed.`);
