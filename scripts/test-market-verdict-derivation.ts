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
  "best_signal at 0.61 → falls through to lean (≥ 0.58 floor, R-16I)",
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
// R-16I Phase 1 — LEAN_CONFIDENCE_FLOOR raised 0.55 → 0.58.
check(
  "confidence 0.58 + no sharp → lean (R-16I new floor)",
  marketVerdictFor({
    market: "total",
    confidence: 0.58,
    grade: "market_led" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "lean"
);
check(
  "confidence 0.56 + no sharp → watchlist (R-16I: below new lean floor)",
  marketVerdictFor({
    market: "total",
    confidence: 0.56,
    grade: "market_led" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "watchlist"
);
check(
  "confidence 0.55 + no sharp → watchlist (R-16I: below new lean floor)",
  marketVerdictFor({
    market: "total",
    confidence: 0.55,
    grade: "market_led" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "watchlist"
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
  // R-16I: bumped confidence 0.56 → 0.60 so it clears the new 0.58
  // lean floor; the original test intent (limited doesn't downgrade
  // existing leans) is preserved.
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.60,
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

// ═════════════════════════════════════════════════════════════════════
// R-16I Phase 1 — Reviewer authority over final verdict
// ═════════════════════════════════════════════════════════════════════

console.log();
console.log("━━━ R-16I Rule 1a: reviewer sharpConflict → caution ━━━");
check(
  "OU + reviewer.sharpConflict=true + high conf + market_watch → caution",
  marketVerdictFor({
    market: "total",
    confidence: 0.626,
    grade: "market_watch" as never,
    sharpDirection: "none",
    marketDataLimited: false,
    reviewerSignals: {
      sharpConflict: true,
      publicSmokeAligned: false,
      hasFragilityFlag: false,
    },
  }).key === "caution"
);
check(
  "OU + reviewer.sharpConflict=true even at best_signal/0.70 → caution (reviewer authoritative)",
  marketVerdictFor({
    market: "total",
    confidence: 0.70,
    grade: "best_signal",
    sharpDirection: "support",
    marketDataLimited: false,
    reviewerSignals: {
      sharpConflict: true,
      publicSmokeAligned: false,
      hasFragilityFlag: false,
    },
  }).key === "caution"
);
check(
  "ML + reviewer.sharpConflict=true → caution (symmetric)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.65,
    grade: "market_watch" as never,
    sharpDirection: "none",
    marketDataLimited: false,
    reviewerSignals: {
      sharpConflict: true,
      publicSmokeAligned: false,
      hasFragilityFlag: false,
    },
  }).key === "caution"
);

console.log();
console.log("━━━ R-16I Rule 8a: public_smoke caps verdict at watchlist ━━━");
check(
  "ML + grade=public_smoke + conf 0.65 → watchlist (not lean)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.65,
    grade: "public_smoke" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "watchlist"
);
check(
  "ML + grade=public_smoke + conf 0.62 + sharp support → watchlist (not best_angle)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.62,
    grade: "public_smoke" as never,
    sharpDirection: "support",
    marketDataLimited: false,
  }).key === "watchlist"
);
check(
  "ML + reviewerSignals.publicSmokeAligned=true at conf 0.64 → watchlist (R-16I)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.64,
    grade: "market_watch" as never,
    sharpDirection: "none",
    marketDataLimited: false,
    reviewerSignals: {
      sharpConflict: false,
      publicSmokeAligned: true,
      hasFragilityFlag: false,
    },
  }).key === "watchlist"
);
check(
  "ML + public_smoke + conf 0.50 → no_play (cap does NOT promote sub-floor)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.50,
    grade: "public_smoke" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "no_play"
);
check(
  "ML + public_smoke + conf 0.53 → watchlist (normal watchlist tier, unchanged)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.53,
    grade: "public_smoke" as never,
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "watchlist"
);

console.log();
console.log("━━━ R-16I Rule 8a: single fragility flag caps verdict at watchlist ━━━");
check(
  "ML + hasFragilityFlag=true + conf 0.65 → watchlist (single-flag downgrade)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.65,
    grade: "market_watch" as never,
    sharpDirection: "none",
    marketDataLimited: false,
    reviewerSignals: {
      sharpConflict: false,
      publicSmokeAligned: false,
      hasFragilityFlag: true,
    },
  }).key === "watchlist"
);
check(
  "ML + hasFragilityFlag=true + best_signal/0.70 → watchlist (cap fires before best_angle)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.70,
    grade: "best_signal",
    sharpDirection: "support",
    marketDataLimited: false,
    reviewerSignals: {
      sharpConflict: false,
      publicSmokeAligned: false,
      hasFragilityFlag: true,
    },
  }).key === "watchlist"
);

console.log();
console.log("━━━ R-16I PIT @ HOU regression fixture ━━━");
// Live state from 2026-06-04 PIT @ HOU prediction row:
//   raw: ML 68%, score 3.3-9.2 (HOU dominant), OU 62.6% over
//   reviewer fired: extreme_run_diff_with_coinflip_market,
//                   small_sample_starter_driver,
//                   raw_conf_extreme_fragile,
//                   huge_model_market_gap,
//                   review_recommends_caution,
//                   ou_sharp_conflict
//   actions: ml=cap_confidence (→ 52%), ou=keep
//   final stored: ML 52%, OU over 62.6%, both market_watch
const pitHouMlVerdict = marketVerdictFor({
  market: "moneyline",
  confidence: 0.52, // post-cap (52%)
  grade: "market_watch" as never,
  sharpDirection: "none",
  marketDataLimited: false,
  reviewerSignals: {
    sharpConflict: false,
    publicSmokeAligned: false,
    hasFragilityFlag: true, // multiple ML fragility flags
  },
});
check(
  "PIT @ HOU ML at capped 0.52 → watchlist (below lean floor, above no_play)",
  pitHouMlVerdict.key === "watchlist"
);
const pitHouOuVerdict = marketVerdictFor({
  market: "total",
  confidence: 0.626,
  grade: "market_watch" as never,
  sharpDirection: "none", // route's deriveSharpDirection didn't fire push_against
  marketDataLimited: false,
  reviewerSignals: {
    sharpConflict: true, // ou_sharp_conflict reviewer flag fired
    publicSmokeAligned: false,
    hasFragilityFlag: false,
  },
});
check(
  "PIT @ HOU OU Over 0.626 + reviewer ou_sharp_conflict → caution (not Lean)",
  pitHouOuVerdict.key === "caution"
);

console.log();
console.log("━━━ R-16I LAD @ ARI public_smoke fixture ━━━");
// Live state: ML away 64.9%, grade=public_smoke (public_money 12% / bets 13%
// on the model's pick). Currently displays as Lean. Should be Watchlist.
const ladAriMlVerdict = marketVerdictFor({
  market: "moneyline",
  confidence: 0.649,
  grade: "public_smoke" as never,
  sharpDirection: "none",
  marketDataLimited: false,
  reviewerSignals: {
    sharpConflict: false,
    publicSmokeAligned: false,
    hasFragilityFlag: false,
  },
});
check(
  "LAD @ ARI ML public_smoke 0.649 → watchlist (R-16I: public_smoke is a warning)",
  ladAriMlVerdict.key === "watchlist"
);

console.log();
console.log("━━━ R-16I: reviewer signals do NOT affect first_inning verdict ━━━");
check(
  "first_inning + reviewerSignals.sharpConflict=true → still routes through normal first_inning rules",
  // first_inning never has reviewer sharp data in V1; helper accepts the
  // input but the flag derivation in the route returns all-false for FI.
  // Here we test that supplying the signal still routes to caution (Rule 1a
  // is symmetric across markets) — this gives the FI surface room to
  // grow into the system without changing the verdict engine later.
  marketVerdictFor({
    market: "first_inning",
    confidence: 0.65,
    grade: "best_signal",
    sharpDirection: "none",
    marketDataLimited: false,
    reviewerSignals: {
      sharpConflict: true,
      publicSmokeAligned: false,
      hasFragilityFlag: false,
    },
  }).key === "caution"
);

console.log();
console.log("━━━ R-16I: reviewerSignals omitted defaults to all-false (back-compat) ━━━");
check(
  "best_signal at 0.65 with no reviewerSignals → best_angle (unchanged)",
  marketVerdictFor({
    market: "moneyline",
    confidence: 0.65,
    grade: "best_signal",
    sharpDirection: "none",
    marketDataLimited: false,
  }).key === "best_angle"
);

console.log();
console.log("━━━ Test summary ━━━");
console.log(`  Passed: ${pass}`);
console.log(`  Failed: ${fail}`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(f);
  process.exit(1);
}
