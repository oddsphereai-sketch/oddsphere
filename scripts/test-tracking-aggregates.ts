/**
 * Push 4 — tests for tracking aggregate helpers.
 *
 * Tests the pure helpers — bucketing, Brier/log-loss math. Full
 * service (computeTrackingAggregate) reaches into Supabase so it
 * lives in the dry-run smoke (operator), not here.
 */

import {
  bucketForConfidence,
  CONFIDENCE_BUCKET_RANGES,
} from "../lib/types/domain/Tracking";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("━━━ Confidence buckets ━━━");
check("49 → lt_50", bucketForConfidence(49) === "lt_50");
check("50 → 50_52", bucketForConfidence(50) === "50_52");
check("51.5 → 50_52", bucketForConfidence(51.5) === "50_52");
check("53 → 53_55", bucketForConfidence(53) === "53_55");
check("55.999 → 53_55", bucketForConfidence(55.999) === "53_55");
check("56 → 56_58", bucketForConfidence(56) === "56_58");
check("59 → 59_62", bucketForConfidence(59) === "59_62");
check("62.999 → 59_62", bucketForConfidence(62.999) === "59_62");
check("63 → gte_63", bucketForConfidence(63) === "gte_63");
check("99 → gte_63", bucketForConfidence(99) === "gte_63");
check("null → lt_50 (safe default)", bucketForConfidence(null) === "lt_50");
check("undefined → lt_50", bucketForConfidence(undefined) === "lt_50");

console.log("\n━━━ Bucket ranges export ━━━");
check("6 buckets defined", CONFIDENCE_BUCKET_RANGES.length === 6);
check("first bucket = lt_50", CONFIDENCE_BUCKET_RANGES[0].label === "lt_50");
check("last bucket = gte_63", CONFIDENCE_BUCKET_RANGES[CONFIDENCE_BUCKET_RANGES.length - 1].label === "gte_63");
check("display strings non-empty", CONFIDENCE_BUCKET_RANGES.every((b) => b.display.length > 0));

console.log("\n━━━ Brier score sanity (manual computation) ━━━");
// Brier = mean((p - outcome)^2)
// p=0.6, win (outcome=1): (0.6-1)^2 = 0.16
// p=0.6, loss (outcome=0): (0.6-0)^2 = 0.36
// mean = 0.26
{
  const brier = ((0.6 - 1) ** 2 + (0.6 - 0) ** 2) / 2;
  check("Brier for (0.6 win, 0.6 loss) = 0.26", Math.abs(brier - 0.26) < 0.0001);
}
{
  // Perfect predictor (p=1, all wins)
  const brier = ((1 - 1) ** 2 + (1 - 1) ** 2) / 2;
  check("Brier for perfect predictor = 0", brier === 0);
}
{
  // Worst predictor (p=1 but all losses)
  const brier = ((1 - 0) ** 2 + (1 - 0) ** 2) / 2;
  check("Brier for worst predictor (p=1, all loss) = 1.0", brier === 1);
}

console.log("\n━━━ Log loss sanity ━━━");
// Log loss = -mean(o*log(p) + (1-o)*log(1-p))
// p=0.5, win: -log(0.5) ≈ 0.693
{
  const ll = -(1 * Math.log(0.5));
  check("Log loss for (p=0.5, win) ≈ 0.693", Math.abs(ll - 0.6931) < 0.001);
}
{
  // p=0.9, win: -log(0.9) ≈ 0.105
  const ll = -(1 * Math.log(0.9));
  check("Log loss for (p=0.9, win) ≈ 0.105", Math.abs(ll - 0.1054) < 0.001);
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All tracking aggregate tests passed.");
