/**
 * NBA qualified-Best-Angle gate test (lib/automodel/nba/nbaGrounding.ts).
 *
 * The calibration LOCK was removed. Best Angle is now unlocked behind a
 * qualification gate parallel to the WC model:
 *   positive edge in [3.5, 8.0]pp + high tier + injuries known + true
 *   multi-book consensus + market favors the pick side (no-vig ≥ 50%) +
 *   sharp money NOT fading the pick (consensus handle vs bets).
 *
 * Pure logic. Run: npx tsx scripts/test-nba-grounding-best-angle.ts
 */

import { groundNbaPrediction, type NbaGroundingInput } from "../lib/automodel/nba/nbaGrounding";

let failures = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.error(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

// Base case engineered to produce a ~+5pp POSITIVE edge on home with the
// market also favoring home (no-vig 0.55) under a clean multi-book consensus.
function base(over: Partial<NbaGroundingInput> = {}): NbaGroundingInput {
  return {
    rawHomeScore: 113,
    rawAwayScore: 108,
    consensusSpreadHome: -3, // market: home favored by 3
    consensusTotal: 220,
    consensusHomeMlNoVig: 0.55, // market favors home
    mlIsSpreadImpliedFallback: false,
    consensusStrength: "multi_book",
    tier: "high",
    injuryHomePts: 0,
    injuryAwayPts: 0,
    injuriesKnown: true,
    splitsMl: null, // unobserved ⇒ not against
    ...over,
  };
}

// 0 — sanity: the base case lands a positive edge in the BA band.
const b = groundNbaPrediction(base());
console.log(`   base: pick=${b.mlPick} edge=${b.mlEdgePct}pp grade=${b.playGrade} conf=${b.confidence}`);
ok("base edge is positive and in the BA band [3.5,8]", b.mlEdgePct !== null && b.mlEdgePct >= 3.5 && b.mlEdgePct <= 8.0, `edge=${b.mlEdgePct}`);

// 1 — fully qualified ⇒ Best Angle (splits unobserved counts as not-against).
ok("qualified (high/multi-book/market-confirms/no-fade) ⇒ Best Angle", b.playGrade === "best_angle", b.playGrade);
ok("rationale notes splits unobserved", b.gradeRationale.includes("splits unobserved"));

// 2 — sharp money FADING the pick ⇒ demoted to Lean.
const fade = groundNbaPrediction(base({ splitsMl: { betsHome: 0.6, handleHome: 0.48, betsAway: 0.4, handleAway: 0.52 } }));
ok("sharp money fading pick ⇒ Lean (not Best Angle)", fade.playGrade === "lean", `${fade.playGrade} :: ${fade.gradeRationale}`);
ok("fade rationale explains why not BA", fade.gradeRationale.includes("sharp money fading"));

// 3 — sharp money WITH the pick (handle out-indexes bets) ⇒ still Best Angle.
const withSharp = groundNbaPrediction(base({ splitsMl: { betsHome: 0.5, handleHome: 0.62, betsAway: 0.5, handleAway: 0.38 } }));
ok("sharp money WITH pick ⇒ Best Angle", withSharp.playGrade === "best_angle", withSharp.playGrade);
ok("with-sharp rationale notes not against", withSharp.gradeRationale.includes("sharp money not against"));

// 4 — market favors the OTHER side (no-vig < 0.5) ⇒ Lean, never Best Angle.
const contra = groundNbaPrediction(base({ consensusHomeMlNoVig: 0.46 }));
ok("market favors other side ⇒ not Best Angle", contra.playGrade !== "best_angle", `${contra.playGrade} :: ${contra.gradeRationale}`);

// 5 — limited (single-book / spread-implied) consensus ⇒ never Best Angle.
const limited = groundNbaPrediction(base({ consensusStrength: "limited_spread_confirmed" }));
ok("limited consensus ⇒ not Best Angle", limited.playGrade !== "best_angle", limited.playGrade);

// 6 — medium tier ⇒ never Best Angle (fails the Lean qualifier too).
const medium = groundNbaPrediction(base({ tier: "medium" }));
ok("medium tier ⇒ not Best Angle", medium.playGrade !== "best_angle", medium.playGrade);

// 7 — implausibly large edge (> 8pp) ⇒ stays Lean (guards over-confidence).
const huge = groundNbaPrediction(base({ rawHomeScore: 128, rawAwayScore: 100, consensusHomeMlNoVig: 0.52 }));
console.log(`   huge: edge=${huge.mlEdgePct}pp grade=${huge.playGrade}`);
ok("edge > 8pp ⇒ not Best Angle (implausible)", huge.mlEdgePct !== null && huge.mlEdgePct > 8 ? huge.playGrade !== "best_angle" : true, `${huge.mlEdgePct} :: ${huge.playGrade}`);

// 8 — injuries unknown ⇒ never Best Angle.
const noInj = groundNbaPrediction(base({ injuriesKnown: false }));
ok("injuries unknown ⇒ not Best Angle", noInj.playGrade !== "best_angle", noInj.playGrade);

if (failures > 0) { console.error(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nAll NBA qualified-Best-Angle gate assertions passed.");
