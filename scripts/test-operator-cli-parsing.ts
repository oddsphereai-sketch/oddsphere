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
  validateWriteGate,
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

// ─── rejectWriteFlag — Phase 4C semantics ────────────────────────────
// Phase 4C: rejectWriteFlag now belongs to the 2 READ-ONLY scripts only
// (status + show-deltas). Message updated to "READ-ONLY by design".
section("rejectWriteFlag — process.exit on --write (read-only scripts)");

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
    "rejectWriteFlag(--write) wrote READ-ONLY-by-design rejection message",
    stderr.includes("READ-ONLY by design") &&
      stderr.includes("automodel-morning-card") &&
      stderr.includes("-rerun-game.ts")
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

// ─── validateWriteGate — Phase 4C three-key gate ────────────────────
section("validateWriteGate — Phase 4C three-key gate");

const originalExit2 = process.exit;
const originalError2 = console.error;
let exitCode2: number | null = null;
let stderr2 = "";
const exitStub2: (code?: number) => never = ((code?: number) => {
  exitCode2 = code ?? 0;
  throw new Error("__test_exit__");
}) as unknown as (code?: number) => never;
console.error = (msg: string) => {
  stderr2 += msg + "\n";
};
const originalEnv = process.env.AUTOMODEL_DB_WRITES_ENABLED;

try {
  process.exit = exitStub2;

  // 1. No --write → writeMode=false, no exit
  delete process.env.AUTOMODEL_DB_WRITES_ENABLED;
  exitCode2 = null;
  stderr2 = "";
  const noWriteFlag = validateWriteGate(["--date", "2026-05-22"]);
  check(
    "validateWriteGate(no --write) → { writeMode: false } AND no exit",
    noWriteFlag.writeMode === false && exitCode2 === null
  );

  // 2. --write WITHOUT env → exits 1 with AUTOMODEL_DB_WRITES_ENABLED message
  delete process.env.AUTOMODEL_DB_WRITES_ENABLED;
  exitCode2 = null;
  stderr2 = "";
  try {
    validateWriteGate(["--write"]);
    check("validateWriteGate(--write, no env) called process.exit", false);
  } catch (e) {
    check(
      "validateWriteGate(--write, no env) triggered process.exit(1)",
      (e as Error).message === "__test_exit__" && exitCode2 === 1
    );
  }
  check(
    "validateWriteGate(--write, no env) error mentions AUTOMODEL_DB_WRITES_ENABLED",
    stderr2.includes("AUTOMODEL_DB_WRITES_ENABLED")
  );
  check(
    "validateWriteGate(--write, no env) error mentions defense in depth",
    stderr2.includes("Defense in depth") || stderr2.includes("defense in depth")
  );

  // 3. --write WITH env → writeMode=true, no exit
  process.env.AUTOMODEL_DB_WRITES_ENABLED = "true";
  exitCode2 = null;
  stderr2 = "";
  const bothGates = validateWriteGate(["--write"]);
  check(
    "validateWriteGate(--write, env=true) → { writeMode: true } AND no exit",
    bothGates.writeMode === true && exitCode2 === null
  );

  // 4. Env=true but no --write → writeMode=false (lone env doesn't write)
  process.env.AUTOMODEL_DB_WRITES_ENABLED = "true";
  exitCode2 = null;
  stderr2 = "";
  const envOnly = validateWriteGate(["--date", "2026-05-22"]);
  check(
    "validateWriteGate(env=true, no --write) → { writeMode: false } (env alone never writes)",
    envOnly.writeMode === false && exitCode2 === null
  );

  // 5. Env=anything-but-"true" → treated as missing
  process.env.AUTOMODEL_DB_WRITES_ENABLED = "1";
  exitCode2 = null;
  stderr2 = "";
  try {
    validateWriteGate(["--write"]);
    check('validateWriteGate(--write, env="1") called process.exit', false);
  } catch (e) {
    check(
      'validateWriteGate(--write, env="1" — not literal "true") still triggers exit(1)',
      (e as Error).message === "__test_exit__" && exitCode2 === 1
    );
  }
} finally {
  process.exit = originalExit2;
  console.error = originalError2;
  if (originalEnv === undefined) {
    delete process.env.AUTOMODEL_DB_WRITES_ENABLED;
  } else {
    process.env.AUTOMODEL_DB_WRITES_ENABLED = originalEnv;
  }
}

// ─── End-to-end: spawn write-capable script with --write, no env ─────
section(
  "End-to-end — spawn morning-card --write (no env) expects exit 1 + AUTOMODEL_DB_WRITES_ENABLED message"
);

// Phase 4C: morning-card uses validateWriteGate now (not rejectWriteFlag).
// With --write but no env, the script exits 1 BEFORE any DB call.
// The spawned process must NOT have AUTOMODEL_DB_WRITES_ENABLED set.
const writeNoEnvResult = spawnSync(
  "npx",
  [
    "tsx",
    "--env-file=.env.local",
    "scripts/operator/automodel-morning-card.ts",
    "--write",
  ],
  {
    encoding: "utf-8",
    cwd: process.cwd(),
    // Defensive: ensure no inherited AUTOMODEL_DB_WRITES_ENABLED
    env: { ...process.env, AUTOMODEL_DB_WRITES_ENABLED: "" },
  }
);
check(
  "spawn morning-card --write (no env) exited with non-zero status",
  writeNoEnvResult.status !== 0
);
check(
  "spawn morning-card --write (no env) status === 1",
  writeNoEnvResult.status === 1
);
const writeNoEnvOutput =
  (writeNoEnvResult.stdout ?? "") + (writeNoEnvResult.stderr ?? "");
check(
  "spawn morning-card --write (no env) output mentions AUTOMODEL_DB_WRITES_ENABLED",
  writeNoEnvOutput.includes("AUTOMODEL_DB_WRITES_ENABLED")
);

// ─── End-to-end: spawn READ-ONLY script with --write ─────────────────
section(
  "End-to-end — spawn automodel-status.ts --write expects exit 1 + READ-ONLY message"
);

const readOnlyResult = spawnSync(
  "npx",
  [
    "tsx",
    "--env-file=.env.local",
    "scripts/operator/automodel-status.ts",
    "--write",
  ],
  { encoding: "utf-8", cwd: process.cwd() }
);
check(
  "spawn status --write exited with non-zero status",
  readOnlyResult.status !== 0
);
check(
  "spawn status --write status === 1",
  readOnlyResult.status === 1
);
const readOnlyOutput =
  (readOnlyResult.stdout ?? "") + (readOnlyResult.stderr ?? "");
check(
  "spawn status --write output mentions READ-ONLY by design",
  readOnlyOutput.includes("READ-ONLY by design")
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
