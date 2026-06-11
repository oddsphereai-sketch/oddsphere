/**
 * Synthetic tests for the soccer grading helpers — WC-1.
 *
 * No DB, no provider, no fixtures. Pure deterministic input/output
 * checks for:
 *   - gradeMatchResult (3-way result, regulation-only)
 *   - gradeTotalGoals (over/under with push handling)
 *   - gradeBtts (yes/no, regulation-only)
 *   - defaultSoccerMarketConvention (convention metadata)
 *   - SOCCER_CONFIDENCE_CAPS sanity
 *
 * Critical scenarios covered:
 *   - Knockout match that goes to ET/penalties — match_result stays
 *     "draw" if tied @ 90'.
 *   - Total push at whole-line totals.
 *   - BTTS edge cases (0-0, 1-0, 1-1).
 *   - Pending when score is unavailable.
 */

import {
  gradeMatchResult,
  gradeTotalGoals,
  gradeBtts,
  gradeDoubleChance,
  defaultSoccerMarketConvention,
  SOCCER_CONFIDENCE_CAPS,
} from "../lib/services/soccer/soccerGrading";

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }
}

console.log("");
console.log("scripts/test-soccer-grading.ts — soccer grading helpers");
console.log("─".repeat(60));

// ─── gradeMatchResult ─────────────────────────────────────────────

test("Match Result: pick=home and home wins 2-1 → win", () => {
  const r = gradeMatchResult("home", { home_goals_ft: 2, away_goals_ft: 1 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("Match Result: pick=away and away wins 1-2 → win", () => {
  const r = gradeMatchResult("away", { home_goals_ft: 1, away_goals_ft: 2 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("Match Result: pick=draw and 1-1 at 90' → win", () => {
  const r = gradeMatchResult("draw", { home_goals_ft: 1, away_goals_ft: 1 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("Match Result: pick=home but 0-2 → loss", () => {
  const r = gradeMatchResult("home", { home_goals_ft: 0, away_goals_ft: 2 });
  assert(r.result === "loss", `expected loss, got ${r.result}`);
});

test("Match Result: pick=home but draw 1-1 → loss (no two-way collapse)", () => {
  const r = gradeMatchResult("home", { home_goals_ft: 1, away_goals_ft: 1 });
  assert(r.result === "loss", `expected loss, got ${r.result}`);
  assert(r.notes.includes("actual=draw"), `notes should explain actual=draw, got: ${r.notes}`);
});

test("Match Result KNOCKOUT scenario: tied @ 90' resolves to draw even when ET happens later", () => {
  // Crucial soccer rule: knockout matches that go to extra time / penalties
  // are NOT resolved as match_result via the eventual winner. Match_result
  // graded on 90-minute regulation only.
  // Inputs are full-time regulation scores; ET/penalty info is metadata
  // not consulted by gradeMatchResult.
  const r = gradeMatchResult("home", { home_goals_ft: 1, away_goals_ft: 1 });
  assert(r.result === "loss", "home pick must be a loss when tied at 90' even if home wins in penalties");
  assert(r.notes.includes("regulation FT"), "notes must mention regulation FT");

  const draw = gradeMatchResult("draw", { home_goals_ft: 1, away_goals_ft: 1 });
  assert(draw.result === "win", "draw must win when tied at 90' regardless of ET/penalties");
});

test("Match Result: pending when score is null", () => {
  const r1 = gradeMatchResult("home", { home_goals_ft: null, away_goals_ft: null });
  assert(r1.result === "pending", `expected pending, got ${r1.result}`);
  const r2 = gradeMatchResult("home", { home_goals_ft: 2, away_goals_ft: null });
  assert(r2.result === "pending", "partial null also pending");
  const r3 = gradeMatchResult("home", { home_goals_ft: null, away_goals_ft: 1 });
  assert(r3.result === "pending", "partial null also pending");
});

// ─── gradeTotalGoals ─────────────────────────────────────────────

test("Total Goals: pick=over 2.5 and total=3 → win", () => {
  const r = gradeTotalGoals("over", 2.5, { home_goals_ft: 2, away_goals_ft: 1 });
  assert(r.result === "win", `expected win, got ${r.result}`);
  assert(r.actual_value === 3, `actual_value should be 3, got ${r.actual_value}`);
});

test("Total Goals: pick=under 2.5 and total=2 → win", () => {
  const r = gradeTotalGoals("under", 2.5, { home_goals_ft: 1, away_goals_ft: 1 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("Total Goals: pick=over 2.5 and total=2 → loss", () => {
  const r = gradeTotalGoals("over", 2.5, { home_goals_ft: 2, away_goals_ft: 0 });
  assert(r.result === "loss", `expected loss, got ${r.result}`);
});

test("Total Goals: pick=under 2.5 and total=3 → loss", () => {
  const r = gradeTotalGoals("under", 2.5, { home_goals_ft: 2, away_goals_ft: 1 });
  assert(r.result === "loss", `expected loss, got ${r.result}`);
});

test("Total Goals: HALF-LINE NEVER pushes (2.5)", () => {
  const r = gradeTotalGoals("over", 2.5, { home_goals_ft: 1, away_goals_ft: 1 });
  assert(r.result !== "push", "half-line should never push");
});

test("Total Goals: WHOLE-LINE PUSH at line=2 with total=2", () => {
  const r = gradeTotalGoals("over", 2, { home_goals_ft: 1, away_goals_ft: 1 });
  assert(r.result === "push", `expected push, got ${r.result}`);
  assert(r.actual_value === 2, `actual_value should be 2, got ${r.actual_value}`);
});

test("Total Goals: WHOLE-LINE PUSH applies to under too", () => {
  const r = gradeTotalGoals("under", 3, { home_goals_ft: 2, away_goals_ft: 1 });
  assert(r.result === "push", `expected push, got ${r.result}`);
});

test("Total Goals: WHOLE-LINE win-side at line=2 with total=3 → over wins", () => {
  const r = gradeTotalGoals("over", 2, { home_goals_ft: 2, away_goals_ft: 1 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("Total Goals: pending when score null", () => {
  const r = gradeTotalGoals("over", 2.5, { home_goals_ft: null, away_goals_ft: null });
  assert(r.result === "pending", `expected pending, got ${r.result}`);
  assert(r.actual_value === null, "actual_value must be null when pending");
});

// ─── gradeBtts ───────────────────────────────────────────────────

test("BTTS Yes: 1-1 → both scored → yes wins", () => {
  const r = gradeBtts("yes", { home_goals_ft: 1, away_goals_ft: 1 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("BTTS Yes: 2-3 → both scored → yes wins", () => {
  const r = gradeBtts("yes", { home_goals_ft: 2, away_goals_ft: 3 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("BTTS Yes: 1-0 → away didn't score → yes loses", () => {
  const r = gradeBtts("yes", { home_goals_ft: 1, away_goals_ft: 0 });
  assert(r.result === "loss", `expected loss, got ${r.result}`);
});

test("BTTS Yes: 0-0 → neither scored → yes loses", () => {
  const r = gradeBtts("yes", { home_goals_ft: 0, away_goals_ft: 0 });
  assert(r.result === "loss", `expected loss, got ${r.result}`);
});

test("BTTS No: 0-0 → no wins", () => {
  const r = gradeBtts("no", { home_goals_ft: 0, away_goals_ft: 0 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("BTTS No: 1-0 → no wins (one side blanked)", () => {
  const r = gradeBtts("no", { home_goals_ft: 1, away_goals_ft: 0 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("BTTS No: 1-1 → no loses (both scored)", () => {
  const r = gradeBtts("no", { home_goals_ft: 1, away_goals_ft: 1 });
  assert(r.result === "loss", `expected loss, got ${r.result}`);
});

test("BTTS: pending when score null", () => {
  const r = gradeBtts("yes", { home_goals_ft: null, away_goals_ft: null });
  assert(r.result === "pending", `expected pending, got ${r.result}`);
});

// ─── gradeDoubleChance ────────────────────────────────────────────

test("Double Chance: pick=home_or_draw and home wins 2-1 → win", () => {
  const r = gradeDoubleChance("home_or_draw", { home_goals_ft: 2, away_goals_ft: 1 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("Double Chance: pick=home_or_draw and draw 1-1 → win", () => {
  const r = gradeDoubleChance("home_or_draw", { home_goals_ft: 1, away_goals_ft: 1 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("Double Chance: pick=home_or_draw and away wins → loss", () => {
  const r = gradeDoubleChance("home_or_draw", { home_goals_ft: 0, away_goals_ft: 2 });
  assert(r.result === "loss", `expected loss, got ${r.result}`);
});

test("Double Chance: pick=away_or_draw and away wins 0-1 → win", () => {
  const r = gradeDoubleChance("away_or_draw", { home_goals_ft: 0, away_goals_ft: 1 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("Double Chance: pick=away_or_draw and draw 0-0 → win", () => {
  const r = gradeDoubleChance("away_or_draw", { home_goals_ft: 0, away_goals_ft: 0 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("Double Chance: pick=away_or_draw and home wins → loss", () => {
  const r = gradeDoubleChance("away_or_draw", { home_goals_ft: 3, away_goals_ft: 0 });
  assert(r.result === "loss", `expected loss, got ${r.result}`);
});

test("Double Chance: pick=home_or_away and home wins → win", () => {
  const r = gradeDoubleChance("home_or_away", { home_goals_ft: 1, away_goals_ft: 0 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("Double Chance: pick=home_or_away and away wins → win", () => {
  const r = gradeDoubleChance("home_or_away", { home_goals_ft: 0, away_goals_ft: 2 });
  assert(r.result === "win", `expected win, got ${r.result}`);
});

test("Double Chance: pick=home_or_away and draw → loss (only outcome where 12 loses)", () => {
  const r = gradeDoubleChance("home_or_away", { home_goals_ft: 2, away_goals_ft: 2 });
  assert(r.result === "loss", `expected loss, got ${r.result}`);
});

test("Double Chance: KNOCKOUT — tied @ 90' graded on 90' only", () => {
  // Same convention as match_result: knockouts going to ET/penalties
  // resolve double_chance on the 90' score. The eventual ET/penalty
  // winner is irrelevant to the grade.
  const r = gradeDoubleChance("home_or_draw", { home_goals_ft: 1, away_goals_ft: 1 });
  assert(r.result === "win", "home_or_draw wins when tied at 90' even if home wins on pens");
  assert(r.notes.includes("regulation FT"), "notes must say regulation FT");
});

test("Double Chance: pending when score null", () => {
  const r = gradeDoubleChance("home_or_draw", { home_goals_ft: null, away_goals_ft: null });
  assert(r.result === "pending", `expected pending, got ${r.result}`);
});

test("Double Chance: never pushes — every regulation outcome decides", () => {
  // Spot-check all 3 outcomes × all 3 picks = 9 combos. None should push.
  const outcomes: Array<{ ft: { home_goals_ft: number; away_goals_ft: number }; label: string }> = [
    { ft: { home_goals_ft: 2, away_goals_ft: 0 }, label: "home" },
    { ft: { home_goals_ft: 1, away_goals_ft: 1 }, label: "draw" },
    { ft: { home_goals_ft: 0, away_goals_ft: 3 }, label: "away" },
  ];
  const picks: Array<"home_or_draw" | "away_or_draw" | "home_or_away"> = [
    "home_or_draw", "away_or_draw", "home_or_away",
  ];
  for (const out of outcomes) {
    for (const p of picks) {
      const r = gradeDoubleChance(p, out.ft);
      assert(r.result !== "push", `double_chance never pushes (pick=${p}, actual=${out.label})`);
      assert(r.result === "win" || r.result === "loss", `must be win or loss (got ${r.result})`);
    }
  }
});

// ─── Convention helper ─────────────────────────────────────────────

test("defaultSoccerMarketConvention always returns regulation_90", () => {
  const c = defaultSoccerMarketConvention(false, false);
  assert(c.resolution_window === "regulation_90", "must default to regulation_90");
  assert(c.extra_time_occurred === false, "ET observed flag preserved");
  assert(c.penalty_shootout_occurred === false, "penalty observed flag preserved");

  const cET = defaultSoccerMarketConvention(true, true);
  assert(cET.resolution_window === "regulation_90", "regulation_90 stays even when ET observed");
  assert(cET.extra_time_occurred === true, "ET observed flag captured");
  assert(cET.penalty_shootout_occurred === true, "penalty observed flag captured");
});

// ─── Confidence caps ──────────────────────────────────────────────

test("SOCCER_CONFIDENCE_CAPS values are conservative per spec", () => {
  assert(SOCCER_CONFIDENCE_CAPS.match_result_default === 68, "match_result_default should be 68 per spec");
  assert(SOCCER_CONFIDENCE_CAPS.match_result_draw === 60, "draw cap is more conservative");
  assert(SOCCER_CONFIDENCE_CAPS.total_default === 66, "total cap ~66 per spec");
  assert(SOCCER_CONFIDENCE_CAPS.btts_default === 65, "btts cap ~65 per spec");
  assert(SOCCER_CONFIDENCE_CAPS.double_chance_default === 72, "double_chance cap ~72 per spec");
  // Draw cap should be tighter than match_result_default
  assert(
    SOCCER_CONFIDENCE_CAPS.match_result_draw < SOCCER_CONFIDENCE_CAPS.match_result_default,
    "draw cap must be stricter than default match_result cap",
  );
  // Double chance cap should be ABOVE match_result_default because
  // it covers 2 of 3 outcomes.
  assert(
    SOCCER_CONFIDENCE_CAPS.double_chance_default > SOCCER_CONFIDENCE_CAPS.match_result_default,
    "double_chance cap must exceed match_result_default (covers 2 of 3 outcomes)",
  );
});

// ─── Notes always populated (audit contract) ──────────────────────

test("notes field is always populated on every resolved outcome", () => {
  const cases = [
    gradeMatchResult("home", { home_goals_ft: 2, away_goals_ft: 0 }),
    gradeMatchResult("draw", { home_goals_ft: 1, away_goals_ft: 1 }),
    gradeMatchResult("away", { home_goals_ft: 0, away_goals_ft: 1 }),
    gradeMatchResult("home", { home_goals_ft: null, away_goals_ft: null }),
    gradeTotalGoals("over", 2.5, { home_goals_ft: 2, away_goals_ft: 1 }),
    gradeTotalGoals("over", 2, { home_goals_ft: 1, away_goals_ft: 1 }),
    gradeTotalGoals("under", 2.5, { home_goals_ft: null, away_goals_ft: null }),
    gradeBtts("yes", { home_goals_ft: 1, away_goals_ft: 1 }),
    gradeBtts("no", { home_goals_ft: 1, away_goals_ft: 0 }),
    gradeBtts("yes", { home_goals_ft: null, away_goals_ft: null }),
    gradeDoubleChance("home_or_draw", { home_goals_ft: 2, away_goals_ft: 0 }),
    gradeDoubleChance("away_or_draw", { home_goals_ft: 2, away_goals_ft: 0 }),
    gradeDoubleChance("home_or_away", { home_goals_ft: 1, away_goals_ft: 1 }),
    gradeDoubleChance("home_or_draw", { home_goals_ft: null, away_goals_ft: null }),
  ];
  for (const r of cases) {
    assert(r.notes.length > 0, `notes must be non-empty (got "${r.notes}")`);
  }
});

// ─── Result ───────────────────────────────────────────────────────

console.log("");
console.log("━".repeat(60));
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
console.log("");
if (fail > 0) {
  console.log(`❌ ${fail} test(s) failed.`);
  process.exit(1);
}
console.log(`✅ All ${pass} soccer-grading tests passed.`);
