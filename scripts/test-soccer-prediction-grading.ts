/**
 * Soccer grading delegation test (WC tracking integration 2026-06-12).
 *
 * Verifies predictionGrader.gradePrediction routes soccer markets to the
 * soccer-native grader on the 90' regulation score: Match Result (3-way),
 * Double Chance, Total goals (with push), BTTS. Also checks pending/void
 * handling and that real-sided no_bet records still grade. The only no_bet
 * rows withheld from W/L are true Toss-Ups with no side.
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

// 30 — no_bet is guidance, not a tracking exclusion. A real-sided no_bet
// prediction still grades from the final score.
ok("no_bet soccer record with real side → win", grade("match_result", "home", null, 2, 1, "final", { no_bet: true }) === "win");
ok("no_bet soccer record with wrong side → loss", grade("match_result", "away", null, 2, 1, "final", { no_bet: true }) === "loss");

// 31 — DOUBLE_CHANCE missing-odds fix (2026-06-15). A DC pick held SOLELY for
// MARKET_ODDS_MISSING still resolves win/loss from the final regulation score
// (outcome is score-determined); missing odds only makes it ROI-ineligible.
function gradeRow(market: string, pick: string, line: number | null, h: number | null, a: number | null, status = "final", extra: Rec = {}) {
  return gradePrediction({ record: rec(market, pick, line, extra), game: game(h, a, status), source: "auto_score_ingest" });
}
const dcOddsMissing = { no_bet: true, no_bet_reason: "MARKET_ODDS_MISSING", held: true, odds_american: null };
{
  // away_or_draw on 0-1 (away win) → WIN, not void; ROI-ineligible note.
  const g = gradeRow("double_chance", "away_or_draw", null, 0, 1, "final", dcOddsMissing);
  ok("DC odds-missing graded from score → win (not void)", g.result === "win" && g.void === false && g.win === true);
  ok("DC odds-missing ROI-ineligible note present", (g.grade_notes ?? "").includes("ROI-ineligible"));
  ok("DC odds-missing records actual score (accuracy tracked)", g.actual_home_score === 0 && g.actual_away_score === 1);
  // home_or_draw on 0-1 (away win) → LOSS.
  ok("DC odds-missing graded from score → loss", gradeRow("double_chance", "home_or_draw", null, 0, 1, "final", dcOddsMissing).result === "loss");
}
// 32 — pending/void game states stay non-W/L
ok("DC odds-missing but NO final score → pending (no score yet)", gradeRow("double_chance", "home_or_draw", null, null, null, "final", dcOddsMissing).result === "pending");
ok("DC odds-missing but game scheduled → void/pending (not graded win/loss)", ["void", "pending"].includes(gradeRow("double_chance", "home_or_draw", null, null, null, "scheduled", dcOddsMissing).result));
ok("DC no_bet for MODEL_WRONG_SIDE still grades when side is real", grade("double_chance", "home_or_draw", null, 2, 0, "final", { no_bet: true, no_bet_reason: "MODEL_WRONG_SIDE_OF_MARKET", odds_american: -3000 }) === "win");
ok("DC void game status → void", grade("double_chance", "home_or_draw", null, null, null, "postponed") === "void");
// 33 — no_bet guidance still grades for every real-sided market.
ok("MR odds-missing no_bet → win", grade("match_result", "home", null, 2, 1, "final", dcOddsMissing) === "win");
ok("Total odds-missing no_bet → win", grade("total", "over", 2.5, 2, 1, "final", dcOddsMissing) === "win");
ok("BTTS odds-missing no_bet → win", grade("btts", "yes", null, 1, 1, "final", dcOddsMissing) === "win");
// 34 — non-soccer follows the same contract: real-sided no_bet still grades.
ok("MLB FI no_bet with real side → win", gradePrediction({
  record: { ...rec("first_inning", "NRFI", 0.5, { sport: "mlb", side: "under", no_bet: true, no_bet_reason: "MARKET_ODDS_MISSING" }) },
  game: { ...game(1, 1, "final"), first_inning_runs: 0 },
  source: "auto_score_ingest",
}).result === "win");

if (failures > 0) { console.error(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nAll soccer grading-delegation assertions passed.");
