/**
 * Phase 6B V2.1 — unit tests for playGrade.ts.
 * Pure tests, no DB, no env, no network.
 */

import {
  computePlayGrade,
  BEST_ANGLE_MIN_EDGE_PCT_ML,
  BEST_ANGLE_MIN_EDGE_PCT_OU,
  BEST_ANGLE_MIN_CONFIDENCE_PCT,
  LEAN_MIN_EDGE_PCT,
  type PlayGradeInput,
} from "../lib/automodel/playGrade";

let pass = 0, fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; const m = `  ✗ ${label}${hint ? " — " + hint : ""}`; console.log(m); failures.push(m); }
}

function section(t: string) { console.log(`\n━━━ ${t} ━━━`); }

function buildMl(opts: Partial<PlayGradeInput> = {}): PlayGradeInput {
  return {
    modelProb: opts.modelProb ?? 0.6,
    marketProb: opts.marketProb ?? 0.55,
    americanOdds: opts.americanOdds ?? -120,
    dataQualityTier: opts.dataQualityTier ?? "high",
    provisional: opts.provisional ?? false,
    isHeld: opts.isHeld ?? false,
    minBestAngleEdgePct: opts.minBestAngleEdgePct ?? BEST_ANGLE_MIN_EDGE_PCT_ML,
    minBestAngleConfidencePct: opts.minBestAngleConfidencePct ?? BEST_ANGLE_MIN_CONFIDENCE_PCT,
    sharpAgreement: opts.sharpAgreement ?? "neutral",
  };
}

function buildOu(opts: Partial<PlayGradeInput> = {}): PlayGradeInput {
  return {
    modelProb: opts.modelProb ?? 0.6,
    marketProb: opts.marketProb ?? 0.5,
    americanOdds: opts.americanOdds ?? -110,
    dataQualityTier: opts.dataQualityTier ?? "high",
    provisional: opts.provisional ?? false,
    isHeld: opts.isHeld ?? false,
    minBestAngleEdgePct: opts.minBestAngleEdgePct ?? BEST_ANGLE_MIN_EDGE_PCT_OU,
    minBestAngleConfidencePct: opts.minBestAngleConfidencePct ?? BEST_ANGLE_MIN_CONFIDENCE_PCT,
    sharpAgreement: opts.sharpAgreement ?? "neutral",
  };
}

async function main() {
  // ─── Held → hold ────────────────────────────────────────────────────
  section("isHeld → hold");
  {
    const r = computePlayGrade(buildMl({ isHeld: true }));
    check("grade=hold", r.grade === "hold");
    check("predictionType=null", r.predictionType === null);
    check("edgePct=null", r.edgePct === null);
    check("noBetReason set", r.noBetReason !== null);
  }

  // ─── Best Angle happy path (ML) ─────────────────────────────────────
  section("Best Angle happy path — ML (edge 5%, conf 60%)");
  {
    const r = computePlayGrade(buildMl({ modelProb: 0.6, marketProb: 0.55 }));
    check("grade=best_angle", r.grade === "best_angle");
    check("predictionType=best_angle", r.predictionType === "best_angle");
    check("edgePct = 5.0", r.edgePct === 5.0);
    check("bestAngleReason populated", r.bestAngleReason !== null);
    check("noBetReason null", r.noBetReason === null);
  }

  // ─── Best Angle happy path (OU) ─────────────────────────────────────
  section("Best Angle happy path — OU (edge 5%, conf 55%)");
  {
    const r = computePlayGrade(buildOu({ modelProb: 0.55, marketProb: 0.50 }));
    // Edge = 5%; OU threshold = 3% → passes edge; conf 55 = threshold → passes conf
    check("grade=best_angle (OU)", r.grade === "best_angle");
  }

  // ─── Min confidence gate ────────────────────────────────────────────
  section("Min confidence gate (55%)");
  {
    // ML edge 2% (meets), conf 50.1% (fails)
    const r = computePlayGrade(buildMl({ modelProb: 0.501, marketProb: 0.481 }));
    check("conf 50.1 + edge 2% → NOT best_angle", r.grade !== "best_angle");
    check("predictionType=lean", r.predictionType === "lean");
    check("noBetReason mentions confidence", r.noBetReason !== null && r.noBetReason!.toLowerCase().includes("confidence"));
  }
  {
    // ML edge 5% (meets), conf 54.9 (fails)
    const r = computePlayGrade(buildMl({ modelProb: 0.549, marketProb: 0.499 }));
    check("conf 54.9 + edge 5% → NOT best_angle", r.grade !== "best_angle");
  }
  {
    // ML edge 2.5% (meets), conf 55.0 (passes)
    const r = computePlayGrade(buildMl({ modelProb: 0.55, marketProb: 0.525 }));
    check("conf 55.0 + edge 2.5% → best_angle", r.grade === "best_angle");
  }

  // ─── ML edge threshold (2%) ────────────────────────────────────────
  section("ML edge gate (2%)");
  {
    const r = computePlayGrade(buildMl({ modelProb: 0.58, marketProb: 0.575 }));
    // Edge = 0.5%; conf 58 — passes conf but fails edge
    check("ML edge 0.5% → market_aligned or lean", r.grade !== "best_angle");
  }
  {
    const r = computePlayGrade(buildMl({ modelProb: 0.62, marketProb: 0.60 }));
    // Edge = 2.0% exactly, conf 62
    check("ML edge 2.0% exactly → best_angle", r.grade === "best_angle");
  }

  // ─── OU edge threshold (3%, raised) ────────────────────────────────
  section("OU edge gate (3% — raised due to no OU odds)");
  {
    const r = computePlayGrade(buildOu({ modelProb: 0.575, marketProb: 0.55 }));
    // Edge = 2.5%, conf 57.5 — passes conf, fails OU edge (2.5 < 3)
    check("OU edge 2.5% → NOT best_angle (needs >=3%)", r.grade !== "best_angle");
  }
  {
    const r = computePlayGrade(buildOu({ modelProb: 0.58, marketProb: 0.55 }));
    // Edge = 3.0% exactly, conf 58
    check("OU edge 3.0% + conf 58 → best_angle", r.grade === "best_angle");
  }

  // ─── Provisional + low-quality cannot be Best Angle ────────────────
  section("Provisional / low-quality → not best_angle");
  {
    const r = computePlayGrade(buildMl({ modelProb: 0.7, marketProb: 0.5, provisional: true }));
    // Massive edge but provisional
    check("provisional → grade=provisional", r.grade === "provisional");
    check("provisional predictionType=lean", r.predictionType === "lean");
    check("NOT best_angle despite edge", r.grade !== "best_angle");
  }
  {
    const r = computePlayGrade(buildMl({ modelProb: 0.7, marketProb: 0.5, dataQualityTier: "low" }));
    check("low quality → grade=provisional", r.grade === "provisional");
  }
  {
    const r = computePlayGrade(buildMl({ modelProb: 0.7, marketProb: 0.5, dataQualityTier: "fallback" }));
    check("fallback → grade=provisional", r.grade === "provisional");
  }
  {
    const r = computePlayGrade(buildMl({ modelProb: 0.7, marketProb: 0.5, dataQualityTier: "medium" }));
    // Per V2.1 spec: Best Angle REQUIRES data_quality === "high".
    // Medium tier with big edge → falls to "lean" (still picks, but no BA badge).
    check("medium tier → NOT best_angle (requires high)", r.grade !== "best_angle");
    check("medium tier with edge → grade=lean", r.grade === "lean");
  }

  // ─── Negative edge → no_bet ─────────────────────────────────────────
  section("Negative edge → no_bet");
  {
    const r = computePlayGrade(buildMl({ modelProb: 0.5, marketProb: 0.55 }));
    // Edge -5%
    check("negative edge → grade=no_bet", r.grade === "no_bet");
    check("predictionType=no_bet", r.predictionType === "no_bet");
    check("noBetReason mentions negative", r.noBetReason !== null && r.noBetReason!.toLowerCase().includes("negative"));
  }

  // ─── Market-aligned (edge in [-1, 1)%) ─────────────────────────────
  section("Market-aligned (small edge)");
  {
    const r = computePlayGrade(buildMl({ modelProb: 0.555, marketProb: 0.55 }));
    // Edge 0.5%
    check("edge 0.5% → market_aligned", r.grade === "market_aligned");
    check("predictionType=market_aligned", r.predictionType === "market_aligned");
    check("marketAligned=true", r.marketAligned);
  }

  // ─── EV < 0 cannot be Best Angle ───────────────────────────────────
  section("Negative EV → not best_angle");
  {
    // Big edge but odds make EV negative
    const r = computePlayGrade(buildMl({ modelProb: 0.55, marketProb: 0.50, americanOdds: -300 }));
    // EV at -300 with 0.55 prob: payoff=0.333, EV = 0.55*0.333 - 0.45 = 0.1833 - 0.45 = -0.267
    check("negative EV → not best_angle", r.grade !== "best_angle");
  }

  // ─── 50.1% confidence + 2% edge canonical case (the bug we fixed) ──
  section("Canonical bug case: 50.1% conf + 2% edge → lean, NOT best_angle");
  {
    const r = computePlayGrade(buildMl({ modelProb: 0.501, marketProb: 0.481 }));
    check("grade=lean", r.grade === "lean");
    check("predictionType=lean", r.predictionType === "lean");
    check("NOT best_angle", r.grade !== "best_angle");
  }

  // ─── Constants ───────────────────────────────────────────────────────
  section("Threshold constants");
  check("BEST_ANGLE_MIN_EDGE_PCT_ML = 2.0", BEST_ANGLE_MIN_EDGE_PCT_ML === 2.0);
  check("BEST_ANGLE_MIN_EDGE_PCT_OU = 3.0", BEST_ANGLE_MIN_EDGE_PCT_OU === 3.0);
  check("BEST_ANGLE_MIN_CONFIDENCE_PCT = 55", BEST_ANGLE_MIN_CONFIDENCE_PCT === 55);
  check("LEAN_MIN_EDGE_PCT = 1.0", LEAN_MIN_EDGE_PCT === 1.0);

  // ─── Summary ────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All playGrade tests passed.`);
}

main().then(() => process.exit(0), (e) => { console.error("FATAL:", e); process.exit(1); });
