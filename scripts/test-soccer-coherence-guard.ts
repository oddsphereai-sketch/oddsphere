/**
 * Unit tests for the WC cross-market coherence guard.
 * Run: npx tsx scripts/test-soccer-coherence-guard.ts
 */
import {
  jointProbabilityOfPicks,
  assessCrossMarketCoherence,
  mostLikelyCoherentCombo,
  COHERENCE_MIN_JOINT_PROB,
  type CrossMarketPicks,
} from "../lib/services/soccer/soccerCoherenceGuard";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); } else console.log(`✓ ${name}`);
}
function near(a: number, b: number): boolean { return Math.abs(a - b) < 1e-9; }

// Small joint: joint[h][a] = P(home h, away a). Sums to 1.0.
//   0-0 .10 (draw/under/no)  1-0 .20 (home/under/no)  0-1 .10 (away/under/no)
//   1-1 .25 (draw/under/yes) 2-1 .15 (home/over/yes)  1-2 .10 (away/over/yes)
//   2-2 .10 (draw/over/yes)
const J: number[][] = [
  [0.10, 0.10, 0.00], // h=0: a=0,1,2  → 0-0, 0-1, 0-2
  [0.20, 0.25, 0.10], // h=1           → 1-0, 1-1, 1-2
  [0.00, 0.15, 0.10], // h=2           → 2-0, 2-1, 2-2   (sums to 1.00)
];
const p = (o: Partial<CrossMarketPicks>): CrossMarketPicks => ({ matchSide: null, totalSide: null, totalLine: null, bttsSide: null, ...o });

// ── jointProbabilityOfPicks math ──
check("all null → full mass (1.0)", near(jointProbabilityOfPicks(J, p({})), 1.0));
check("draw only → .45", near(jointProbabilityOfPicks(J, p({ matchSide: "draw" })), 0.45));
check("under 2.5 only → .65", near(jointProbabilityOfPicks(J, p({ totalSide: "under", totalLine: 2.5 })), 0.65));
check("over 2.5 only → .35", near(jointProbabilityOfPicks(J, p({ totalSide: "over", totalLine: 2.5 })), 0.35));
check("btts yes only → .60", near(jointProbabilityOfPicks(J, p({ bttsSide: "yes" })), 0.60));

// ── The contradiction the guard exists for ──
{
  const picks = p({ matchSide: "home", totalSide: "under", totalLine: 2.5, bttsSide: "yes" });
  check("home + Under 2.5 + BTTS-yes → joint prob 0 (impossible)", near(jointProbabilityOfPicks(J, picks), 0));
  const v = assessCrossMarketCoherence(J, picks);
  check("...flagged INCOHERENT", v.coherent === false);
  check("...reason mentions contradictory", /contradictory/.test(v.reason));
}

// ── Coherent trios ──
{
  const v = assessCrossMarketCoherence(J, p({ matchSide: "home", totalSide: "over", totalLine: 2.5, bttsSide: "yes" }));
  check("home + Over 2.5 + BTTS-yes (2-1) → coherent", v.coherent === true && near(v.jointProb, 0.15));
}
{
  const v = assessCrossMarketCoherence(J, p({ matchSide: "draw", totalSide: "under", totalLine: 2.5, bttsSide: "yes" }));
  check("draw + Under 2.5 + BTTS-yes (1-1) → coherent", v.coherent === true && near(v.jointProb, 0.25));
}

// ── Fewer than two published markets → always coherent (no constraint) ──
check("single pick → coherent", assessCrossMarketCoherence(J, p({ matchSide: "home" })).coherent === true);
check("zero picks → coherent", assessCrossMarketCoherence(J, p({})).coherent === true);

// ── Two-market contradiction (Under 2.5 + BTTS-yes restricts to 1-1 only) ──
{
  // Under 2.5 + BTTS-yes alone is satisfiable (1-1), so coherent on its own...
  const ok = assessCrossMarketCoherence(J, p({ totalSide: "under", totalLine: 2.5, bttsSide: "yes" }));
  check("Under 2.5 + BTTS-yes (→1-1) coherent as a pair", ok.coherent === true && near(ok.jointProb, 0.25));
}

// ── Most-likely coherent combo (the correction target) ──
{
  // Highest-mass coherent combo in J is 1-1 → draw + Under + BTTS-yes (.25).
  const combo = mostLikelyCoherentCombo(J, 2.5);
  check("combo = most-probable coherent set (draw/under/yes for J)",
    combo.matchSide === "draw" && combo.totalSide === "under" && combo.bttsSide === "yes");
  // The returned combo is always coherent (never the contradiction).
  const v = assessCrossMarketCoherence(J, { matchSide: combo.matchSide, totalSide: combo.totalSide, totalLine: 2.5, bttsSide: combo.bttsSide });
  check("combo is itself coherent", v.coherent === true);
}

// ── Threshold sanity ──
check("threshold is a sensible small fraction", COHERENCE_MIN_JOINT_PROB > 0 && COHERENCE_MIN_JOINT_PROB < 0.2);

if (failures > 0) { console.error(`\n❌ ${failures} failed`); process.exit(1); }
console.log("\n✅ All coherence-guard tests passed.");
