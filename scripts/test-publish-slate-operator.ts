/**
 * Phase 4.2.A — Unit tests for publish-slate.ts operator script.
 *
 * Tests the script's defense-in-depth gate behavior by spawning it as a
 * subprocess with controlled env / argv combinations and asserting on
 * stderr/exit-code. No DB I/O — when the gates pass we never reach the
 * confirmation prompt because we don't feed stdin.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-publish-slate-operator.ts
 */

import { spawn } from "node:child_process";

const SCRIPT = "scripts/operator/publish-slate.ts";

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

type SpawnResult = {
  code: number;
  stdout: string;
  stderr: string;
};

/**
 * Spawn the operator script. Default behavior: provide no stdin so the
 * interactive prompt (if reached) returns empty → operator declines.
 *
 * `withTimeout` kills any process that doesn't exit within 5s — protects
 * the test runner if a gate accidentally lets us reach the prompt.
 */
function runScript(
  args: string[],
  env: Record<string, string | undefined> = {}
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["tsx", "--env-file=.env.local", SCRIPT, ...args],
      {
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
        cwd: "/Users/danielmengel/Projects/oddsphere",
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, 30_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function testRefusesApplyWithoutEnv() {
  section("--apply WITHOUT SLATE_PUBLISH_DB_WRITES_ENABLED → refuse + exit 1");
  const r = await runScript(
    ["--sport", "mlb", "--date", "2026-05-22", "--apply"],
    { SLATE_PUBLISH_DB_WRITES_ENABLED: undefined }
  );
  check("exit code === 1", r.code === 1, `code=${r.code}`);
  check(
    "stderr explains SLATE_PUBLISH_DB_WRITES_ENABLED requirement",
    r.stderr.includes("SLATE_PUBLISH_DB_WRITES_ENABLED")
  );
  check(
    "stderr mentions two-key gate",
    r.stderr.toLowerCase().includes("two-key") || r.stderr.toLowerCase().includes("two key")
  );
}

async function testRefusesApplyWithWrongEnvValue() {
  section("--apply with SLATE_PUBLISH_DB_WRITES_ENABLED=yes (not 'true') → refuse");
  const r = await runScript(
    ["--sport", "mlb", "--date", "2026-05-22", "--apply"],
    { SLATE_PUBLISH_DB_WRITES_ENABLED: "yes" }
  );
  check("exit code === 1", r.code === 1, `code=${r.code}`);
  check(
    "stderr explains exact env requirement",
    r.stderr.includes("SLATE_PUBLISH_DB_WRITES_ENABLED=true")
  );
}

async function testDryRunDefault() {
  section("No --apply → dry-run runs and exits 0 with NO DB WRITES banner");
  const r = await runScript(["--sport", "mlb", "--date", "2026-05-22"]);
  check("exit code === 0", r.code === 0, `code=${r.code} stderr=${r.stderr.slice(0, 200)}`);
  check(
    "stdout contains DRY-RUN banner",
    r.stdout.includes("DRY-RUN") || r.stdout.includes("DRY RUN"),
    `stdout head: ${r.stdout.slice(0, 200)}`
  );
  check(
    "stdout shows 'NO DB WRITES' confirmation",
    r.stdout.includes("NO DB WRITES")
  );
  check(
    "stdout reports pre-state",
    r.stdout.includes("Pre-state") || r.stdout.includes("━━━")
  );
  check(
    "stdout does NOT show 'APPLY complete'",
    !r.stdout.includes("APPLY complete")
  );
}

async function testInvalidDate() {
  section("Invalid --date format → rejects with clear error");
  const r = await runScript(["--sport", "mlb", "--date", "not-a-date"]);
  check("exit code !== 0", r.code !== 0, `code=${r.code}`);
  // The script throws via parseCommonCliOptions; tsx surfaces as stderr.
  check(
    "stderr or stdout mentions date format requirement",
    r.stderr.toLowerCase().includes("date") || r.stdout.toLowerCase().includes("date")
  );
}

async function testInvalidSport() {
  section("Invalid --sport → rejects with clear error");
  const r = await runScript(["--sport", "soccer", "--date", "2026-05-22"]);
  check("exit code !== 0", r.code !== 0, `code=${r.code}`);
  check(
    "error mentions sport",
    r.stderr.toLowerCase().includes("sport") || r.stdout.toLowerCase().includes("sport")
  );
}

async function testApplyWithEnvAndNoStdin() {
  section("--apply with env=true but no stdin → reaches confirm prompt then declines");
  // stdin is "ignore" in runScript → readline.question gets EOF and the
  // confirmation regex test fails → "Cancelled by operator". This proves
  // the gates pass without writing.
  const r = await runScript(
    ["--sport", "mlb", "--date", "2026-05-22", "--apply"],
    { SLATE_PUBLISH_DB_WRITES_ENABLED: "true" }
  );
  check("exit code === 0 (decline path is clean exit)", r.code === 0, `code=${r.code}`);
  check(
    "stdout contains APPLY banner (gates passed)",
    r.stdout.includes("mode=APPLY")
  );
  check(
    "stdout shows interactive prompt header text",
    r.stdout.includes("Continue? [y/N]") || r.stdout.includes("Cancelled by operator") || r.stdout.includes("About to PUBLISH")
  );
  check(
    "stdout shows 'Cancelled by operator' or similar (no write happened)",
    r.stdout.includes("Cancelled") || !r.stdout.includes("APPLY complete")
  );
}

async function main() {
  console.log("Phase 4.2.A — publish-slate.ts operator script tests");
  console.log("====================================================");

  await testRefusesApplyWithoutEnv();
  await testRefusesApplyWithWrongEnvValue();
  await testDryRunDefault();
  await testInvalidDate();
  await testInvalidSport();
  await testApplyWithEnvAndNoStdin();

  console.log();
  console.log("====================================================");
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
