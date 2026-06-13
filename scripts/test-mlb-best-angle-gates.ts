/**
 * MLB-P0 Best Angle market-sanity gate tests (deterministic, pure).
 *
 * Covers:
 *   • computePlayGrade uses the regularized prob/edge it's handed;
 *   • a fallback/missing market probability can never be Best Angle;
 *   • a caller hard-block (totals real-odds requirement) can never be BA;
 *   • a normal ML favorite with a real regularized edge IS Best Angle;
 *   • resolveMlbBestAngle: line-against blocks, large-edge needs confirming
 *     move, toward-move confirms but never upgrades, public-money demotes,
 *     and ML-favorite protection holds only when no contradiction flags.
 *
 * Run: npx tsx scripts/test-mlb-best-angle-gates.ts
 */

import { computePlayGrade, type PlayGradeInput } from "../lib/automodel/playGrade";
import { resolveMlbBestAngle } from "../lib/services/predictionRecordService";

let failures = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    failures++;
    console.error(`✗ ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

function input(over: Partial<PlayGradeInput>): PlayGradeInput {
  return {
    modelProb: 0.6,
    marketProb: 0.55,
    americanOdds: 100, // +100 → EV(0.60)=+0.20 > 0
    dataQualityTier: "high",
    provisional: false,
    isHeld: false,
    minBestAngleEdgePct: 3.0,
    minBestAngleConfidencePct: 56,
    ...over,
  };
}

// ── computePlayGrade gates ──────────────────────────────────────────────
// 1 — normal regularized ML favorite (+5pp) → best_angle (control).
const normal = computePlayGrade(input({ modelProb: 0.6, marketProb: 0.55 }));
ok("regularized +5pp ML favorite → best_angle", normal.grade === "best_angle");
ok("normal: not blocked", normal.bestAngleBlocked === false);
ok("normal: fallback flag false", normal.marketProbWasFallback === false);

// 2 — edge is computed from the (already regularized) modelProb handed in.
ok("grade uses handed-in (regularized) edge", normal.edgePct === 5.0);

// 3 — fallback market prob → never best_angle (caps to lean, flagged).
const fallback = computePlayGrade(
  input({ modelProb: 0.6, marketProb: 0.5, marketProbIsFallback: true, minBestAngleEdgePct: 3.5 }),
);
ok("fallback market prob is NOT best_angle", fallback.grade !== "best_angle");
ok("fallback caps to lean (still shown)", fallback.grade === "lean");
ok("fallback flag echoed", fallback.marketProbWasFallback === true);
ok("fallback is best-angle-blocked", fallback.bestAngleBlocked === true);

// 4 — totals real-odds hard block → never best_angle.
const totalNoOdds = computePlayGrade(
  input({ modelProb: 0.6, marketProb: 0.53, minBestAngleEdgePct: 3.5,
    bestAngleHardBlockReason: "total requires real O/U odds (no fallback) for Best Angle" }),
);
ok("total without real O/U odds is NOT best_angle", totalNoOdds.grade !== "best_angle");
ok("total hard-block reason surfaced", (totalNoOdds.bestAngleBlockReason ?? "").includes("O/U odds"));

// 5 — total WITH real odds + real edge → best_angle.
const realTotal = computePlayGrade(
  input({ modelProb: 0.59, marketProb: 0.53, minBestAngleEdgePct: 3.5, marketProbIsFallback: false }),
);
ok("total real market +6pp → best_angle", realTotal.grade === "best_angle");

// ── resolveMlbBestAngle (writer confirmation layer) ─────────────────────
const clean = { baseEligible: true, requiresConfirmation: false, lineDirection: "neutral" as const, opposingPublicMoney: false };

// 6 — clean eligible pick stays Best Angle.
ok("clean eligible → best_angle true", resolveMlbBestAngle(clean).bestAngle === true);

// 7 — line movement AGAINST blocks Best Angle.
const against = resolveMlbBestAngle({ ...clean, lineDirection: "against_pick" });
ok("line against → demoted", against.bestAngle === false);
ok("line against → reason line_movement_against_pick", against.demoteReason === "line_movement_against_pick");

// 8 — large unconfirmed edge (requiresConfirmation, no toward move) → demote.
const unconfirmed = resolveMlbBestAngle({ ...clean, requiresConfirmation: true, lineDirection: "unknown" });
ok("large edge + unknown move → demoted", unconfirmed.bestAngle === false);
ok("large edge reason large_unconfirmed_regularized_edge", unconfirmed.demoteReason === "large_unconfirmed_regularized_edge");
const unconfirmedNeutral = resolveMlbBestAngle({ ...clean, requiresConfirmation: true, lineDirection: "neutral" });
ok("large edge + neutral move → still demoted (neutral ≠ confirmation)", unconfirmedNeutral.bestAngle === false);

// 9 — large edge WITH a toward move → confirmed, stays Best Angle.
const confirmed = resolveMlbBestAngle({ ...clean, requiresConfirmation: true, lineDirection: "toward_pick" });
ok("large edge + toward move → confirmed best_angle", confirmed.bestAngle === true);

// 10 — toward move never UPGRADES a non-eligible pick.
const notEligible = resolveMlbBestAngle({ ...clean, baseEligible: false, lineDirection: "toward_pick" });
ok("toward move does NOT upgrade non-eligible pick", notEligible.bestAngle === false);
ok("non-eligible has no demote reason", notEligible.demoteReason === null);

// 11 — opposing public money demotes (existing narrow guard preserved).
const pubMoney = resolveMlbBestAngle({ ...clean, opposingPublicMoney: true });
ok("opposing public money → demoted", pubMoney.bestAngle === false);
ok("opposing public money reason", pubMoney.demoteReason === "opposing_public_money");

// 12 — ML favorite protection: a normal eligible favorite stays BA when no
//      contradiction flags, and only demotes when a flag is present.
ok("ML favorite protected when clean", resolveMlbBestAngle(clean).bestAngle === true);
ok("ML favorite demoted only with a contradiction flag",
  resolveMlbBestAngle({ ...clean, lineDirection: "against_pick" }).bestAngle === false);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll MLB-P0 Best Angle gate assertions passed.");
