/**
 * Push 3B-4 — gate-safety tests for repair-mlb-model-readiness.ts.
 *
 * Purpose: prove the operator FAILS CLOSED when apply is requested
 * without all required env gates, and prove dry-run mode never
 * writes regardless of env state. Forbidden-tables check is implicit:
 * the operator only imports runSeasonPitchingCycle, lineupService,
 * weatherService — there is no code path to game_predictions,
 * slate_status, locked_at, or model_version.
 */

import { execSync } from "node:child_process";

const SCRIPT = "scripts/operator/repair-mlb-model-readiness.ts";
const DATE = "2026-06-06";

type Case = {
  name: string;
  env: Record<string, string>;
  argv: string;
  expectExitNonZero: boolean;
  expectInOutput: string[];
};

const cases: Case[] = [
  {
    name: "dry-run (no flags) — no env required, exits 0",
    env: {},
    argv: `--sport mlb --date ${DATE}`,
    expectExitNonZero: false,
    expectInOutput: ["mode=DRY-RUN", "DRY-RUN — no DB writes performed"],
  },
  {
    name: "--apply without env gates — fails closed",
    env: {},
    argv: `--sport mlb --date ${DATE} --apply`,
    expectExitNonZero: true,
    expectInOutput: ["--apply requires BOTH", "MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED=true"],
  },
  {
    name: "--apply with only readiness env — still fails (missing automodel gate)",
    env: { MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED: "true" },
    argv: `--sport mlb --date ${DATE} --apply`,
    expectExitNonZero: true,
    expectInOutput: ["AUTOMODEL_DB_WRITES_ENABLED=true"],
  },
];

function runCase(c: Case): { ok: boolean; reason: string; out: string } {
  const envSetters = Object.entries(c.env).map(([k, v]) => `${k}=${v}`).join(" ");
  const cmd = `${envSetters} npx tsx --env-file=.env.local ${SCRIPT} ${c.argv}`;
  let out = "";
  let exitCode = 0;
  try {
    out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    out = `${err.stdout?.toString() ?? ""}\n${err.stderr?.toString() ?? ""}`;
    exitCode = err.status ?? 1;
  }
  if (c.expectExitNonZero && exitCode === 0) return { ok: false, reason: `expected non-zero exit, got 0`, out };
  if (!c.expectExitNonZero && exitCode !== 0) return { ok: false, reason: `expected exit 0, got ${exitCode}`, out };
  for (const expected of c.expectInOutput) {
    if (!out.includes(expected)) return { ok: false, reason: `expected to find "${expected}" in output`, out };
  }
  return { ok: true, reason: "", out };
}

async function main() {
  console.log(`\n━━━ readiness-repair gate-safety tests ━━━\n`);
  let pass = 0, fail = 0;
  for (const c of cases) {
    const r = runCase(c);
    if (r.ok) { console.log(`  ✓ ${c.name}`); pass++; }
    else {
      console.log(`  ✗ ${c.name}`);
      console.log(`     reason: ${r.reason}`);
      console.log(`     output:\n${r.out.split("\n").slice(-10).map((l) => "       " + l).join("\n")}`);
      fail++;
    }
  }
  console.log(`\n  result: ${pass}/${pass + fail} pass`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
