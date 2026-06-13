/**
 * Soccer grading delegation test (WC tracking integration 2026-06-12).
 *
 * Verifies predictionGrader.gradePrediction routes soccer markets to the
 * soccer-native grader on the 90' regulation score: Match Result (3-way),
 * Double Chance, Total goals (with push), BTTS. Also checks pending/void
 * handling and that no_bet records still grade (the no_bet EXCLUSION lives
 * at the tracking-aggregate read layer, same as MLB/NBA/NHL).
 *
 * Pure logic via the exported grader. Run:
 *   npx tsx scripts/test-soccer-prediction-grading.ts
 */

import { gradePrediction } from "../lib/services/predictionGrader";

let failures = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.error(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

type Rec = Record<string, unknown>;
function rec(market: string, pick: string, line: number | null, extra: Rec = {}): any {
  return {
    id: 1, game_id: 1, external_id: 1, sport: "soccer", slate_date: "2026-06-12",
    game_date: "2026-06-12", matchup: "AAA vs BBB", market, pick, side: pick,
    line_value: line, odds_american: null, odds_decimal: null, no_bet: false,
    ...extra,
  };
}
function game(h: number | null, a: number | null, status = "final"): any {
  return { status, home_score: h, away_score: a, first_inning_runs: null };
}
function grade(market: string, pick: string, line: number | null, h: number | null, a: number | null, status = "final", extra: Rec = {}) {
  return gradePrediction({ record: rec(market, pick, line, extra), game: game(h, a, status), source: "auto_score_ingest" }).result;
}

// 25 — Match Result (3-way) on 90' score
ok("MR home win (2-1)", grade("match_result", "home", null, 2, 1) === "win");
ok("MR home loss (1-2)", grade("match_result", "home", null, 1, 2) === "loss");
ok("MR home loss on draw (1-1)", grade("match_result", "home", null, 1, 1) === "loss");
ok("MR draw win (1-1)", grade("match_result", "draw", null, 1, 1) === "win");
ok("MR away win (0-2)", grade("match_result", "away", null, 0, 2) === "win");

// 26 — Double Chance
ok("DC home_or_draw win on draw (1-1)", grade("double_chance", "home_or_draw", null, 1, 1) === "win");
ok("DC home_or_draw win on home (2-0)", grade("double_chance", "home_or_draw", null, 2, 0) === "win");
ok("DC home_or_draw loss on away (0-1)", grade("double_chance", "home_or_draw", null, 0, 1) === "loss");
ok("DC away_or_draw win on away (0-1)", grade("double_chance", "away_or_draw", null, 0, 1) === "win");
ok("DC home_or_away loss on draw (1-1)", grade("double_chance", "home_or_away", null, 1, 1) === "loss");

// 27 — Total goals with push handling
ok("Total over 2.5 win (total 3)", grade("total", "over", 2.5, 2, 1) === "win");
ok("Total under 2.5 win (total 2)", grade("total", "under", 2.5, 1, 1) === "win");
ok("Total over 2.0 PUSH (total 2)", grade("total", "over", 2.0, 1, 1) === "push");
ok("Total over 2.0 win (total 3)", grade("total", "over", 2.0, 2, 1) === "win");
ok("Total under 3.0 win (total 2)", grade("total", "under", 3.0, 1, 1) === "win");

// 28 — BTTS
ok("BTTS yes win (1-1)", grade("btts", "yes", null, 1, 1) === "win");
ok("BTTS yes loss (1-0)", grade("btts", "yes", null, 1, 0) === "loss");
ok("BTTS no win (1-0)", grade("btts", "no", null, 1, 0) === "win");
ok("BTTS no loss (2-1)", grade("btts", "no", null, 2, 1) === "loss");

// 29 — pending/void handling
ok("pending when not final", grade("match_result", "home", null, null, null, "scheduled") === "pending");
ok("pending when final but scores missing", grade("match_result", "home", null, null, null, "final") === "pending");
ok("total pending when line missing", grade("total", "over", null, 2, 1) === "pending");

// 30 — no_bet/held records are marked no-action (void), consistent with
// MLB/NBA/NHL: the grader short-circuits no_bet=true → void so the row is
// auditable but excluded from public W/L tallies.
ok("no_bet soccer record → void (no-action)", grade("match_result", "home", null, 2, 1, "final", { no_bet: true }) === "void");

if (failures > 0) { console.error(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nAll soccer grading-delegation assertions passed.");
