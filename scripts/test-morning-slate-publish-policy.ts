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
  // ── Default behavior: env var unset → HOLD ───────────────────────────
  section("Env var unset → default HOLD");
  {
    const r = shouldAutoPublishMorningSlate({});
    check("unset → false (default HOLD-as-draft)", r === false);
  }

  // [B] Explicit "true" → publish enabled
  section("MORNING_SLATE_AUTO_PUBLISH='true' → auto-publish enabled");
  {
    const r = shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "true" });
    check("'true' → true", r === true);
  }

  // [C] Other truthy-looking values stay HOLD (strict equality)
  section("Non-strict truthy values → HOLD (strict 'true' only)");
  {
    check("'TRUE' → false (case-sensitive)", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "TRUE" }) === false);
    check("'1' → false", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "1" }) === false);
    check("'yes' → false", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "yes" }) === false);
    check("'on' → false", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "on" }) === false);
    check("'' → false", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: "" }) === false);
    check("undefined → false", shouldAutoPublishMorningSlate({ MORNING_SLATE_AUTO_PUBLISH: undefined }) === false);
  }

  // [D] Explicit "false" → HOLD
  section("'false' → explicit HOLD");
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
    check("autoPublish=true label mentions env var name", onLabel.includes("MORNING_SLATE_AUTO_PUBLISH"));
    check("autoPublish=false label starts with 'skipped'", offLabel.startsWith("skipped"));
    check("autoPublish=false label mentions 'hold-as-draft'", offLabel.includes("hold-as-draft"));
  }

  // [F] Cron-handler integration shape — the cron writes
  // stepDetails.slate_published using this decision. Confirm both code
  // paths produce inspectable outputs.
  section("Integration shape — cron step-details consumers grep on labels");
  {
    // Off-by-default: step details should contain hold-as-draft so
    // operators can confirm the safe default is in effect.
    const off = publishDecisionLabel(false);
    check("off label is grep-friendly for 'hold-as-draft'", off.includes("hold-as-draft"));
    // On (when flipped): step details should mention the env var so
    // operators auditing the cron run can find the trigger.
    const on = publishDecisionLabel(true);
    check("on label is grep-friendly for 'MORNING_SLATE_AUTO_PUBLISH'", on.includes("MORNING_SLATE_AUTO_PUBLISH"));
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
