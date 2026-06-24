/**
 * Conviction/Value play-grade gate regression (2026-06-15). Verifies the four evidence-gated,
 * environment-checked demotions and that non-Lean grades + clean Leans are untouched:
 *   1. weak model probability (<55%)        2. EV<0 (coherence, arithmetic)
 *   3. low-conviction ML favorite           4. extreme-low total line (<8)
 */
import { applyPlayGradeGate, GATE_LEAN_MIN_MODEL_PROB, GATE_LOW_CONVICTION_RUNGAP, GATE_LOW_TOTAL_LINE } from "../lib/services/predictionRecordService";

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) pass++; else { fail++; console.error(`❌ ${name}`); } }
const ml = (p: number | null, odds: number | null, runGap: number | null) => applyPlayGradeGate("lean", { modelProb: p, americanOdds: odds, market: "moneyline" as const, runGapAbs: runGap, totalLine: null });
const ou = (p: number | null, odds: number | null, line: number | null) => applyPlayGradeGate("lean", { modelProb: p, americanOdds: odds, market: "total" as const, runGapAbs: null, totalLine: line });

// 1. weak model-probability floor (<55%)
check("lean @ 0.54 → market_aligned even with plus odds", ml(0.54, 130, 1.5) === "market_aligned");
check(`lean floor boundary ${GATE_LEAN_MIN_MODEL_PROB} inclusive-keep`, ml(GATE_LEAN_MIN_MODEL_PROB, 130, 1.5) === "lean");
check("lean total @ 0.54 → market_aligned", ou(0.54, 120, 8.5) === "market_aligned");
check("null prob does not trigger confidence floor", ml(null, 130, 1.5) === "lean");

// 2. EV gate (coherence): fav -150 → breakeven 60%; model 56% = EV<0 → demote
check("lean fav -150 @ 0.56 (EV<0) → market_aligned", ml(0.56, -150, 1.5) === "market_aligned");
check("lean fav -150 @ 0.54 (EV<0) → market_aligned", ml(0.54, -150, 1.5) === "market_aligned");
check("lean fav -150 @ 0.62 (EV>0)+conviction stays lean", ml(0.62, -150, 1.5) === "lean");
check("lean dog +120 @ 0.40 (EV<0) → market_aligned", ml(0.40, 120, 0.8) === "market_aligned");
check("lean dog +120 @ 0.55 (EV>0) stays lean", ml(0.55, 120, 0.8) === "lean");

// 3. low-conviction favorite (run-gap < 0.5)
check("lean fav -110 @ 0.55 gap 0.3 → market_aligned", ml(0.55, -110, 0.3) === "market_aligned");
check("lean fav -110 @ 0.55 gap 1.2 stays lean", ml(0.55, -110, 1.2) === "lean");
check("low-conviction = FAVORITES only (dog kept)", ml(0.55, 130, 0.3) === "lean");
check(`run-gap boundary ${GATE_LOW_CONVICTION_RUNGAP} inclusive-keep`, ml(0.55, -110, GATE_LOW_CONVICTION_RUNGAP) === "lean");

// 4. extreme-low total line (<8)
check("lean total line 7.5 → market_aligned", ou(0.56, -110, 7.5) === "market_aligned");
check("lean total line 8.5 stays lean", ou(0.56, -110, 8.5) === "lean");
check(`total-line boundary ${GATE_LOW_TOTAL_LINE} inclusive-keep`, ou(0.56, -110, GATE_LOW_TOTAL_LINE) === "lean");

// 4. null-safety + non-lean untouched
check("null prob+odds → unchanged lean", ml(null, null, null) === "lean");
check("best_angle untouched", applyPlayGradeGate("best_angle", { modelProb: 0.40, americanOdds: -150, market: "moneyline", runGapAbs: 0.1, totalLine: 7 }) === "best_angle");
check("market_aligned untouched", applyPlayGradeGate("market_aligned", { modelProb: 0.40, americanOdds: -150, market: "moneyline", runGapAbs: 0.1, totalLine: 7 }) === "market_aligned");
check("provisional untouched", applyPlayGradeGate("provisional", { modelProb: 0.40, americanOdds: -150, market: "total", runGapAbs: null, totalLine: 7 }) === "provisional");
check("null grade untouched", applyPlayGradeGate(null, { modelProb: 0.40, americanOdds: -150, market: "moneyline", runGapAbs: 0.1, totalLine: 7 }) === null);

console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
console.log("✅ All conviction/value gate tests passed.");
