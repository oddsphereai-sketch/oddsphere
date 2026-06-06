/**
 * Phase 6B.1 — fixture-only unit tests for the auto-model version resolver.
 *
 * Pure tests — no DB, no env, no network. Verifies precedence rules:
 *   override > env > default "v1".
 *
 * Run: npx tsx scripts/test-automodel-model-version.ts
 */

import {
  resolveAutomodelVersion,
  resolveEffectiveVersion,
  AUTOMODEL_VERSION_ENV,
  type AutomodelVersion,
} from "../lib/automodel/modelVersion";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; const m = `  ✗ ${label}`; console.log(m); failures.push(m); }
}

function section(t: string) { console.log(`\n━━━ ${t} ━━━`); }

async function main() {
  section("resolveAutomodelVersion — env reading");
  check("missing env → v1", resolveAutomodelVersion({}) === "v1");
  check("empty string env → v1", resolveAutomodelVersion({ [AUTOMODEL_VERSION_ENV]: "" }) === "v1");
  check("explicit 'v1' → v1", resolveAutomodelVersion({ [AUTOMODEL_VERSION_ENV]: "v1" }) === "v1");
  check("explicit 'v2' → v2", resolveAutomodelVersion({ [AUTOMODEL_VERSION_ENV]: "v2" }) === "v2");
  check("explicit 'shadow' → shadow", resolveAutomodelVersion({ [AUTOMODEL_VERSION_ENV]: "shadow" }) === "shadow");
  check("case-insensitive: 'V2' → v2", resolveAutomodelVersion({ [AUTOMODEL_VERSION_ENV]: "V2" }) === "v2");
  check("trim: ' v2 ' → v2", resolveAutomodelVersion({ [AUTOMODEL_VERSION_ENV]: " v2 " }) === "v2");
  check("invalid value → v1 (with warn)", resolveAutomodelVersion({ [AUTOMODEL_VERSION_ENV]: "v3" }) === "v1");
  check("garbage value → v1", resolveAutomodelVersion({ [AUTOMODEL_VERSION_ENV]: "nonsense" }) === "v1");

  section("resolveEffectiveVersion — precedence");
  check("override 'v2' beats env 'v1'", resolveEffectiveVersion("v2", { [AUTOMODEL_VERSION_ENV]: "v1" }) === "v2");
  check("override 'v1' beats env 'v2'", resolveEffectiveVersion("v1", { [AUTOMODEL_VERSION_ENV]: "v2" }) === "v1");
  check("override 'shadow' beats env 'v2'", resolveEffectiveVersion("shadow", { [AUTOMODEL_VERSION_ENV]: "v2" }) === "shadow");
  check("undefined override + env 'v2' → v2", resolveEffectiveVersion(undefined, { [AUTOMODEL_VERSION_ENV]: "v2" }) === "v2");
  check("undefined override + env unset → v1", resolveEffectiveVersion(undefined, {}) === "v1");

  section("type narrowing");
  const v: AutomodelVersion = resolveAutomodelVersion({});
  check("return type is AutomodelVersion narrow", v === "v1" || v === "v2" || v === "shadow");

  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All modelVersion resolver tests passed.`);
}

main().then(() => process.exit(0), (e) => { console.error("FATAL:", e); process.exit(1); });
