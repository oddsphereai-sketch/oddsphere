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
  deriveMarketContextEffect,
} from "../lib/services/marketVerdictDerivation";
import type { Grade } from "../lib/types/domain/Grade";

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

// ─────────────────────────────────────────────────────────────────────
// Phase 6B.30E — market-context policy (money + line + edge)
// ─────────────────────────────────────────────────────────────────────
console.log();
console.log("━━━ Phase 6B.30E — deriveMarketContextEffect (pure rule chain) ━━━");

{
  // Rule 0 — no context → no-op
  check(
    "Rule 0 — null context → no warning, no cap, no caution",
    JSON.stringify(deriveMarketContextEffect(null)) ===
      JSON.stringify({ warningCode: null, capAtWatchlist: false, forceCaution: false })
  );

  // Rule 0 — no conflict → no-op
  check(
    "Rule 0 — no moneyConflict → no warning, no cap, no caution",
    deriveMarketContextEffect({
      moneyConflict: false,
      lineMovementVsPick: "confirms_market",
      edgeStrength: "thin",
      sourceCount: 1,
      rlmAgainstPick: false,
    }).warningCode === null
  );

  // Rule 9 — RLM against pick fires even without moneyConflict
  check(
    "Rule 9 — rlmAgainstPick → forceCaution",
    deriveMarketContextEffect({
      moneyConflict: false,
      lineMovementVsPick: "flat",
      edgeStrength: "normal",
      sourceCount: 1,
      rlmAgainstPick: true,
    }).forceCaution === true
  );
  check(
    "Rule 9 — rlmAgainstPick → warningCode = rlm_against_pick",
    deriveMarketContextEffect({
      moneyConflict: false,
      lineMovementVsPick: "flat",
      edgeStrength: "normal",
      sourceCount: 1,
      rlmAgainstPick: true,
    }).warningCode === "rlm_against_pick"
  );

  // Rule 8 — multi-source (inert today, wired)
  check(
    "Rule 8 — multi-source conflict → cap at watchlist",
    deriveMarketContextEffect({
      moneyConflict: true,
      lineMovementVsPick: "flat",
      edgeStrength: "strong",
      sourceCount: 2,
      rlmAgainstPick: false,
    }).capAtWatchlist === true
  );

  // Rule 2 — confirms_pick → never downgrade
  check(
    "Rule 2 — confirms_pick → no cap, supportive warning code",
    deriveMarketContextEffect({
      moneyConflict: true,
      lineMovementVsPick: "confirms_pick",
      edgeStrength: "thin",
      sourceCount: 1,
      rlmAgainstPick: false,
    }).capAtWatchlist === false
  );
  check(
    "Rule 2 — warningCode = money_conflict_line_confirms_pick",
    deriveMarketContextEffect({
      moneyConflict: true,
      lineMovementVsPick: "confirms_pick",
      edgeStrength: "thin",
      sourceCount: 1,
      rlmAgainstPick: false,
    }).warningCode === "money_conflict_line_confirms_pick"
  );

  // Rule 1 — confirms_market + thin/normal/unknown → cap
  check(
    "Rule 1 — confirms_market + thin edge → cap",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "confirms_market", edgeStrength: "thin",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === true
  );
  check(
    "Rule 1 — confirms_market + normal edge → cap",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "confirms_market", edgeStrength: "normal",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === true
  );
  check(
    "Rule 1 — confirms_market + unknown edge → cap",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "confirms_market", edgeStrength: "unknown",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === true
  );

  // Rule 1b — confirms_market + strong edge → NO cap, warning only
  check(
    "Rule 1b — confirms_market + STRONG edge → NO cap (strong survives)",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "confirms_market", edgeStrength: "strong",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === false
  );
  check(
    "Rule 1b — warningCode = money_conflict_strong_edge_survives",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "confirms_market", edgeStrength: "strong",
      sourceCount: 1, rlmAgainstPick: false,
    }).warningCode === "money_conflict_strong_edge_survives"
  );

  // Rule 1c — confirms_market + negative edge → caution
  check(
    "Rule 1c — confirms_market + negative edge → forceCaution",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "confirms_market", edgeStrength: "negative",
      sourceCount: 1, rlmAgainstPick: false,
    }).forceCaution === true
  );

  // Rule 3 — flat + thin/negative/unknown → cap
  check(
    "Rule 3 — flat line + thin edge → cap",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "flat", edgeStrength: "thin",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === true
  );
  check(
    "Rule 3 — flat line + unknown edge → cap",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "flat", edgeStrength: "unknown",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === true
  );
  check(
    "Rule 3 — flat line + negative edge → cap",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "flat", edgeStrength: "negative",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === true
  );

  // Rule 4 — flat + normal/strong → stay, warning only
  check(
    "Rule 4 — flat line + normal edge → NO cap",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "flat", edgeStrength: "normal",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === false
  );
  check(
    "Rule 4 — flat line + strong edge → NO cap",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "flat", edgeStrength: "strong",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === false
  );

  // Rule 5 — unknown line + negative edge → caution
  check(
    "Rule 5 — unknown line + negative edge → forceCaution",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "unknown", edgeStrength: "negative",
      sourceCount: 1, rlmAgainstPick: false,
    }).forceCaution === true
  );

  // Rule 6 — unknown line + thin edge → cap
  check(
    "Rule 6 — unknown line + thin edge → cap",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "unknown", edgeStrength: "thin",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === true
  );

  // Rule 7 — one-source carve-out: unknown line + normal/strong/unknown → STAY
  check(
    "Rule 7 — unknown line + normal edge → NO cap (one-source carve-out)",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "unknown", edgeStrength: "normal",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === false
  );
  check(
    "Rule 7 — unknown line + strong edge → NO cap",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "unknown", edgeStrength: "strong",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === false
  );
  check(
    "Rule 7 — unknown line + unknown edge → NO cap (one-source carve-out, no signals)",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "unknown", edgeStrength: "unknown",
      sourceCount: 1, rlmAgainstPick: false,
    }).capAtWatchlist === false
  );
  check(
    "Rule 7 — warningCode = money_conflict_one_source_only",
    deriveMarketContextEffect({
      moneyConflict: true, lineMovementVsPick: "unknown", edgeStrength: "strong",
      sourceCount: 1, rlmAgainstPick: false,
    }).warningCode === "money_conflict_one_source_only"
  );
}

console.log();
console.log("━━━ Phase 6B.30E — full-pipeline scenarios (4 user-named cases) ━━━");

// Scenario 1 — MIL@ATH-style: strong edge + confirming line + existing
// public_smoke cap. Verdict stays Watchlist (cap holds) + warning rides.
check(
  "MIL@ATH-style — strong edge + confirms_market + public_smoke → Watchlist + strong-edge-survives warning",
  (() => {
    const v = marketVerdictFor({
      market: "total",
      confidence: 0.58,
      grade: "public_smoke" as Grade,
      sharpDirection: "none",
      marketDataLimited: false,
      reviewerSignals: { sharpConflict: false, publicSmokeAligned: true, hasFragilityFlag: false },
      marketContext: {
        moneyConflict: true, lineMovementVsPick: "confirms_market", edgeStrength: "strong",
        sourceCount: 1, rlmAgainstPick: false,
      },
    });
    return v.key === "watchlist" && v.warning === "money_conflict_strong_edge_survives";
  })()
);

// Scenario 2 — WSH@SF-style: confirms_pick → chip unchanged, supportive copy
check(
  "WSH@SF-style — confirms_pick → no downgrade, supportive warning code",
  (() => {
    const v = marketVerdictFor({
      market: "total",
      confidence: 0.55,
      grade: "market_watch" as Grade,
      sharpDirection: "none",
      marketDataLimited: false,
      marketContext: {
        moneyConflict: true, lineMovementVsPick: "confirms_pick", edgeStrength: "unknown",
        sourceCount: 1, rlmAgainstPick: false,
      },
    });
    return v.key === "watchlist" && v.warning === "money_conflict_line_confirms_pick";
  })()
);

// Scenario 3 — HOU@LAA-style: flat line + unknown edge → Rule 3 cap
check(
  "HOU@LAA-style — flat line + unknown edge → cap at Watchlist + warning",
  (() => {
    const v = marketVerdictFor({
      market: "total",
      confidence: 0.60,
      grade: "market_watch" as Grade,
      sharpDirection: "none",
      marketDataLimited: false,
      marketContext: {
        moneyConflict: true, lineMovementVsPick: "flat", edgeStrength: "unknown",
        sourceCount: 1, rlmAgainstPick: false,
      },
    });
    return v.key === "watchlist" && v.warning === "money_conflict_flat_line_thin_edge";
  })()
);

// Scenario 4 — CIN@SD-style: strong-edge ML + flat line + conflict → Rule 4
// (verdict module alone resolves to Lean; the route's existing 6B.10
// BA-block keeps it at Watchlist via a separate path.)
check(
  "CIN@SD-style — flat line + strong edge + conflict → Lean + warning (route's BA-block runs separately)",
  (() => {
    const v = marketVerdictFor({
      market: "moneyline",
      confidence: 0.633,
      grade: "market_watch" as Grade,
      sharpDirection: "none",
      marketDataLimited: false,
      marketContext: {
        moneyConflict: true, lineMovementVsPick: "flat", edgeStrength: "strong",
        sourceCount: 1, rlmAgainstPick: false,
      },
    });
    return v.key === "lean" && v.warning === "money_conflict_flat_line_strong_edge";
  })()
);

console.log();
console.log("━━━ Phase 6B.30E — anti-regression: clean Leans / Best Angle / FI stay clean ━━━");

check(
  "Clean Lean — no marketContext → lean, no warning",
  (() => {
    const v = marketVerdictFor({
      market: "moneyline", confidence: 0.60, grade: "market_watch" as Grade,
      sharpDirection: "none", marketDataLimited: false,
    });
    return v.key === "lean" && v.warning === null;
  })()
);

check(
  "Clean Best Angle — no marketContext → best_angle, no warning",
  (() => {
    const v = marketVerdictFor({
      market: "moneyline", confidence: 0.65, grade: "best_signal" as Grade,
      sharpDirection: "none", marketDataLimited: false,
    });
    return v.key === "best_angle" && v.warning === null;
  })()
);

check(
  "Clean Best Angle WITH marketContext but no conflict → best_angle, no warning",
  (() => {
    const v = marketVerdictFor({
      market: "moneyline", confidence: 0.65, grade: "best_signal" as Grade,
      sharpDirection: "none", marketDataLimited: false,
      marketContext: {
        moneyConflict: false, lineMovementVsPick: "flat", edgeStrength: "strong",
        sourceCount: 1, rlmAgainstPick: false,
      },
    });
    return v.key === "best_angle" && v.warning === null;
  })()
);

check(
  "FI — marketContext ignored, verdict unchanged",
  (() => {
    const v = marketVerdictFor({
      market: "first_inning", confidence: 0.60, grade: "market_watch" as Grade,
      sharpDirection: "none", marketDataLimited: false,
      marketContext: {
        moneyConflict: true, lineMovementVsPick: "confirms_market", edgeStrength: "thin",
        sourceCount: 1, rlmAgainstPick: false,
      },
    });
    return v.key === "lean" && v.warning === null;
  })()
);

check(
  "Anti-regression — sharp_conflict grade still → caution (warning may attach)",
  marketVerdictFor({
    market: "moneyline", confidence: 0.65, grade: "sharp_conflict" as Grade,
    sharpDirection: "none", marketDataLimited: false,
  }).key === "caution"
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
