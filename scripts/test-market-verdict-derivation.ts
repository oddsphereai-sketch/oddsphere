/**
 * Tests for lib/services/marketVerdictDerivation.ts.
 *
 * Covers all rules 1-9 including first_inning special-case (sharpDirection
 * forced to "none", marketDataLimited never downgrades).
 *
 * Run: npx tsx scripts/test-market-verdict-derivation.ts
 */

import {
  marketVerdictFor,
  normalizeMarketKey,
} from "../lib/services/marketVerdictDerivation";

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

console.log("━━━ Rule 1: sharp_conflict / push_against → caution ━━━");
check(
  "sharp_conflict grade → caution regardless of confidence",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.99,
    grade: "sharp_conflict",
    sharpDirection: "support",
    marketDataLimited: false,
  }).key === "caution"
);
check(
  "push_against direction → caution",
  marketVerdictFor({
    market: "total",
    confidence: 0.75,
    grade: "best_signal",
    sharpDirection: "push_against",
    marketDataLimited: false,
  }).key === "caution"
);

console.log();
console.log("━━━ Rule 2: best_signal + confidence ≥ 0.62 → best_angle ━━━");
check(
  "best_signal at 0.62 → best_angle",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.62,
    grade: "best_signal",
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "best_angle"
);
check(
  "best_signal at 0.61 → falls through to lean (≥ 0.55)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.61,
    grade: "best_signal",
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "lean"
);

console.log();
console.log("━━━ Rule 3: sharp_confirmed + confidence ≥ 0.58 → best_angle ━━━");
check(
  "sharp_confirmed at 0.58 + support → best_angle",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.58,
    grade: "sharp_confirmed",
    sharpDirection: "support",
    marketDataLimited: false,
  }).key === "best_angle"
);
check(
  "sharp_confirmed at 0.58 + none → still best_angle (sharp_confirmed grade IS the signal)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.58,
    grade: "sharp_confirmed",
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "best_angle"
);

console.log();
console.log("━━━ Rule 4+5: lean candidates ━━━");
check(
  "confidence 0.58 + support → lean (when not best-angle eligible)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.58,
    grade: "standard" as never, // any non-best/non-sharp grade
    sharpDirection: "support",
    marketDataLimited: false,
  }).key === "lean"
);
check(
  "confidence 0.55 + no sharp → lean (rule 5 floor)",
  marketVerdictFor({
    market: "total",
    confidence: 0.55,
    grade: "market_led" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "lean"
);

console.log();
console.log("━━━ Rule 6: confidence 0.52-0.54 → watchlist ━━━");
check(
  "confidence 0.52 → watchlist",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.52,
    grade: "market_watch" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "watchlist"
);
check(
  "confidence 0.54 → watchlist",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.54,
    grade: "market_watch" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "watchlist"
);

console.log();
console.log("━━━ Rule 7: low confidence → no_play ━━━");
check(
  "confidence 0.51 → no_play",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.51,
    grade: "market_watch" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "no_play"
);
check(
  "confidence 0.30 → no_play",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.30,
    grade: "market_watch" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "no_play"
);

console.log();
console.log("━━━ Rule 8: marketDataLimited downgrades best_angle → lean (ML/Total only) ━━━");
check(
  "best_signal 0.70 + marketDataLimited → lean (downgraded)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.70,
    grade: "best_signal",
    sharpDirection: "none",
    marketDataLimited: true,
  }).key === "lean"
);
check(
  "sharp_confirmed 0.60 + marketDataLimited → lean (downgraded)",
  marketVerdictFor({
    market: "total",
    confidence: 0.60,
    grade: "sharp_confirmed",
    sharpDirection: "support",
    marketDataLimited: true,
  }).key === "lean"
);
check(
  "marketDataLimited does NOT touch lean (already lean)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.56,
    grade: "market_led" as never,
    sharpDirection: "support",
    marketDataLimited: true,
  }).key === "lean"
);
check(
  "marketDataLimited does NOT touch watchlist",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.53,
    grade: "market_watch" as never,
    sharpDirection: "none",
    marketDataLimited: true,
  }).key === "watchlist"
);

console.log();
console.log("━━━ Rule 9: first_inning special-case ━━━");
check(
  "first_inning: sharpDirection input is IGNORED (push_against treated as none)",
  marketVerdictFor({
    market: "first_inning",
    confidence: 0.65,
    grade: "best_signal",
    sharpDirection: "push_against",   // would be caution for ML/Total
    marketDataLimited: false,
  }).key === "best_angle"
);
check(
  "first_inning: marketDataLimited input is IGNORED (no downgrade)",
  marketVerdictFor({
    market: "first_inning",
    confidence: 0.65,
    grade: "best_signal",
    sharpDirection: "none",
    marketDataLimited: true,          // would downgrade to lean for ML/Total
  }).key === "best_angle"
);
check(
  "first_inning: sharp_conflict grade still → caution (grade itself dictates)",
  marketVerdictFor({
    market: "first_inning",
    confidence: 0.65,
    grade: "sharp_conflict",
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "caution"
);
check(
  "first_inning: low confidence → no_play",
  marketVerdictFor({
    market: "first_inning",
    confidence: 0.45,
    grade: "market_watch" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "no_play"
);

console.log();
console.log("━━━ normalizeMarketKey ━━━");
check("'ml' → 'moneyline'", normalizeMarketKey("ml") === "moneyline");
check("'moneyline' → 'moneyline'", normalizeMarketKey("moneyline") === "moneyline");
check("'ou' → 'total'", normalizeMarketKey("ou") === "total");
check("'total' → 'total'", normalizeMarketKey("total") === "total");
check("'nrfi' → 'first_inning'", normalizeMarketKey("nrfi") === "first_inning");
check("'first_inning' → 'first_inning'", normalizeMarketKey("first_inning") === "first_inning");

console.log();
console.log("━━━ Label round-trip ━━━");
const verdict = marketVerdictFor({
  market: "moneyline",
  confidence: 0.65,
  grade: "best_signal",
  sharpDirection: "support",
  marketDataLimited: false,
});
check(`best_angle has label "Best Angle"`, verdict.label === "Best Angle");

console.log();
console.log("━━━ Test summary ━━━");
console.log(`  Passed: ${pass}`);
console.log(`  Failed: ${fail}`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(f);
  process.exit(1);
}
