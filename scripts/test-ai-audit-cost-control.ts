import { resolveAiAuditorBudgetMode, shouldSkipAiAudit } from "../lib/services/aiAuditCostControl";

let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else {
    fail++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

check("Normal below soft cap", resolveAiAuditorBudgetMode({ total_spend_usd: 25, projected_spend_usd: 80 }) === "NORMAL");
check("Conserve above soft cap", resolveAiAuditorBudgetMode({ total_spend_usd: 151, projected_spend_usd: 160 }) === "CONSERVE");
check("Protect above protect cap", resolveAiAuditorBudgetMode({ total_spend_usd: 205, projected_spend_usd: 210 }) === "PROTECT");
check("Hard stop at hard cap", resolveAiAuditorBudgetMode({ total_spend_usd: 250, projected_spend_usd: 260 }) === "HARD_STOP");

check(
  "Unchanged payload skips AI",
  shouldSkipAiAudit({
    payloadHash: "abc",
    previousPayloadHash: "abc",
    playGrade: "Lean",
    sourceConflict: false,
    lockSnapshot: false,
    budgetMode: "NORMAL",
  }).reason === "unchanged_payload",
);

check(
  "Hard cap stops calls",
  shouldSkipAiAudit({
    payloadHash: "abc",
    playGrade: "Best Angle",
    sourceConflict: true,
    lockSnapshot: true,
    budgetMode: "HARD_STOP",
  }).reason === "monthly_hard_cap_reached",
);

check(
  "Protect mode allows public-play candidates",
  shouldSkipAiAudit({
    payloadHash: "abc",
    playGrade: "Lean",
    sourceConflict: false,
    lockSnapshot: false,
    budgetMode: "PROTECT",
  }).skip === false,
);

check(
  "Protect mode skips stable low grade cards",
  shouldSkipAiAudit({
    payloadHash: "abc",
    playGrade: "No Play",
    sourceConflict: false,
    lockSnapshot: false,
    budgetMode: "PROTECT",
  }).reason === "protect_mode_scope",
);

check(
  "Conserve mode audits source conflicts",
  shouldSkipAiAudit({
    payloadHash: "abc",
    playGrade: "Caution",
    sourceConflict: true,
    lockSnapshot: false,
    budgetMode: "CONSERVE",
  }).skip === false,
);

if (fail > 0) process.exit(1);
console.log("\nAll AI audit cost-control tests passed.");

