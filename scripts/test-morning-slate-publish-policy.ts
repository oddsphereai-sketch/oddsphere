/**
 * Phase 4.2.C.1.R-19 Phase 1 (C4) — tests for the morning-slate publish-
 * policy gate (lib/services/morningSlatePublishPolicy.ts).
 *
 * Pure tests — no DB, no env-mutation, no network.
 *
 * Run: npx tsx scripts/test-morning-slate-publish-policy.ts
 */

import {
  shouldAutoPublishMorningSlate,
  publishDecisionLabel,
} from "../lib/services/morningSlatePublishPolicy";

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
  // ── Default behavior (2026-06-12 flip): env var unset → AUTO-PUBLISH ─
  section("Env var unset → default AUTO-PUBLISH");
  {
    const r = shouldAutoPublishMorningSlate({});
    check("unset → true (default auto-publish)", r === true);
  }

  // [B] Explicit "true" → publish enabled
  section("MORNING_SLATE_AUTO_PUBLISH='true' → auto-publish enabled");
  {
    const r = shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "true" });
    check("'true' → true", r === true);
  }

  // [C] Any non-"false" value → auto-publish (case-sensitive opt-out)
  section("Non-'false' values → AUTO-PUBLISH");
  {
    check("'TRUE' → true", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "TRUE" }) === true);
    check("'1' → true", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "1" }) === true);
    check("'yes' → true", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "yes" }) === true);
    check("'on' → true", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "on" }) === true);
    check("'' → true", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "" }) === true);
    check("undefined → true", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: undefined }) === true);
  }

  // [D] Explicit "false" → HOLD (operator opt-out path)
  section("'false' → explicit HOLD (operator opt-out)");
  {
    const r = shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "false" });
    check("'false' → false", r === false);
  }

  // [E] Label generation
  section("publishDecisionLabel — stable operator-log strings");
  {
    const onLabel = publishDecisionLabel(true);
    const offLabel = publishDecisionLabel(false);
    check("autoPublish=true label mentions 'auto-publish enabled'", onLabel.includes("auto-publish enabled"));
    check("autoPublish=false label starts with 'skipped'", offLabel.startsWith("skipped"));
    check("autoPublish=false label mentions 'operator hold-as-draft'", offLabel.includes("hold-as-draft"));
    check("autoPublish=false label mentions env var name", offLabel.includes("MORNING_SLATE_AUTO_PUBLISH"));
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All morning-slate publish-policy tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); }
);
