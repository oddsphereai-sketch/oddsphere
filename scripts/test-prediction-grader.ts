/**
 * Push 4 — tests for predictionGrader (pure logic).
 */

import { gradePrediction } from "../lib/services/predictionGrader";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

function makeRecord(overrides: Partial<PredictionRecordRow> = {}): PredictionRecordRow {
  return {
    id: 1,
    game_prediction_id: 100,
    game_id: 1000,
    external_id: 5058725,
    sport: "mlb",
    slate_date: "2026-06-06",
    game_date: "2026-06-06T17:10:00Z",
    matchup: "SEA@DET",
    market: "moneyline",
    pick: "home",
    side: "home",
    line_value: null,
    odds_american: null,
    odds_decimal: null,
    model_used: "v2_1",
    model_version: "auto_v2.1_mlb_prediction_integrity",
    prediction_source: "auto_v1_mlb_rules",
    confidence: 55,
    model_probability: 0.55,
    market_probability: null,
    edge: null,
    expected_value: null,
    play_grade: "lean",
    prediction_type: "lean",
    best_angle: false,
    no_bet: false,
    no_bet_reason: null,
    market_aligned: false,
    data_quality_tier: "high",
    source_quality: null,
    provisional: false,
    held: false,
    hold_reason: null,
    launch_day: false,
    manual_outcome_expected: false,
    locked_at: null,
    published_at: null,
    snapshot_json: null,
    ...overrides,
  };
}

// ── Moneyline ──────────────────────────────────────────────────────
console.log("━━━ Moneyline grading ━━━");
{
  const r = makeRecord({ market: "moneyline", pick: "home" });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 3, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("home picked + home won → win", g.result === "win" && g.win === true && g.loss === false);
  check("winning_team='home'", g.winning_team === "home");
  check("actual_total=8", g.actual_total === 8);
}
{
  const r = makeRecord({ market: "moneyline", pick: "away" });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 3, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("away picked + home won → loss", g.result === "loss" && g.loss === true);
}
{
  const r = makeRecord({ market: "moneyline", pick: "home" });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 5, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("tie → void (rare MLB scenario)", g.result === "void");
}

// ── Total ──────────────────────────────────────────────────────────
console.log("\n━━━ Total grading ━━━");
{
  const r = makeRecord({ market: "total", pick: "over", side: "over", line_value: 7.5 });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 3, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("over picked + total=8 > 7.5 → win", g.result === "win");
}
{
  const r = makeRecord({ market: "total", pick: "under", side: "under", line_value: 7.5 });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 3, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("under picked + total=8 > 7.5 → loss", g.result === "loss");
}
{
  const r = makeRecord({ market: "total", pick: "over", side: "over", line_value: 8 });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 3, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("total=8 exactly line=8 → push", g.result === "push" && g.push === true);
}
{
  const r = makeRecord({ market: "total", pick: "under", side: "under", line_value: 8.5 });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 3, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("under picked + total=8 < 8.5 → win", g.result === "win");
}

// ── First Inning ──────────────────────────────────────────────────
console.log("\n━━━ First inning grading ━━━");
{
  const r = makeRecord({ market: "first_inning", pick: "NRFI" });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 3, first_inning_runs: 0 },
    source: "auto_score_ingest",
  });
  check("NRFI + FI runs=0 → win", g.result === "win");
}
{
  const r = makeRecord({ market: "first_inning", pick: "NRFI" });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 3, first_inning_runs: 2 },
    source: "auto_score_ingest",
  });
  check("NRFI + FI runs=2 → loss", g.result === "loss");
}
{
  const r = makeRecord({ market: "first_inning", pick: "YRFI" });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 3, first_inning_runs: 1 },
    source: "auto_score_ingest",
  });
  check("YRFI + FI runs=1 → win", g.result === "win");
}
{
  const r = makeRecord({ market: "first_inning", pick: "NRFI" });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 3, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("FI score null → pending (NEVER inferred from full-game total)", g.result === "pending" && g.pending === true);
  check("grade_notes mentions first-inning unavailable", typeof g.grade_notes === "string" && /first-inning/i.test(g.grade_notes!));
}

// ── Void / postponed ──────────────────────────────────────────────
console.log("\n━━━ Void / postponed ━━━");
{
  const r = makeRecord({ market: "moneyline", pick: "home" });
  const g = gradePrediction({
    record: r,
    game: { status: "postponed", home_score: null, away_score: null, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("postponed → void", g.result === "void" && g.void === true);
  check("postponed → win=loss=push=false", !g.win && !g.loss && !g.push);
}
{
  const r = makeRecord({ market: "moneyline", pick: "home" });
  const g = gradePrediction({
    record: r,
    game: { status: "canceled", home_score: null, away_score: null, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("canceled → void", g.result === "void");
}
{
  const r = makeRecord({ market: "moneyline", pick: "home" });
  const postponed = gradePrediction({
    record: r,
    game: { status: "STATUS_POSTPONED", home_score: null, away_score: null, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  const canceled = gradePrediction({
    record: r,
    game: { status: "STATUS_CANCELED", home_score: null, away_score: null, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("provider STATUS_POSTPONED → void", postponed.result === "void");
  check("provider STATUS_CANCELED → void", canceled.result === "void");
}

// ── Pending (game not final) ──────────────────────────────────────
console.log("\n━━━ Pending ━━━");
{
  const r = makeRecord({ market: "moneyline", pick: "home" });
  const g = gradePrediction({
    record: r,
    game: { status: "scheduled", home_score: null, away_score: null, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("scheduled → pending", g.result === "pending");
}
{
  const r = makeRecord({ market: "moneyline", pick: "home" });
  const g = gradePrediction({
    record: r,
    game: { status: "STATUS_SCHEDULED", home_score: null, away_score: null, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("STATUS_SCHEDULED → pending", g.result === "pending");
}
{
  const r = makeRecord({ market: "moneyline", pick: "home" });
  const g = gradePrediction({
    record: r,
    game: { status: "in_progress", home_score: 2, away_score: 1, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("in_progress → pending (don't grade live)", g.result === "pending");
}

// ── no_bet guidance vs genuine Toss-Up tracking exclusion ──
console.log("\n━━━ no_bet guidance vs genuine Toss-Up exclusion ━━━");
{
  // Toss-Up FI row with no_bet=true should NOT be graded as W/L even
  // when first_inning_runs is populated.
  const r = makeRecord({ market: "first_inning", pick: "Toss-Up", no_bet: true, no_bet_reason: "non-actionable: locked pill was Toss-Up" });
  const g = gradePrediction({
    record: r,
    game: { status: "STATUS_IN_PROGRESS", home_score: 1, away_score: 0, first_inning_runs: 0 },
    source: "auto_score_ingest",
  });
  check("no_bet=true FI → void, not win", g.result === "void");
  check("void carries the no_bet_reason in grade_notes", typeof g.grade_notes === "string" && /non-actionable/i.test(g.grade_notes!));
}
{
  // A real-sided stand-down still counts toward accuracy; no_bet only means
  // it was not recommended as an actionable wager.
  const r = makeRecord({ sport: "wnba", market: "moneyline", pick: "home", side: "home", held: true, odds_american: null, no_bet: true, no_bet_reason: "moneyline_exact_price_unavailable" });
  const g = gradePrediction({
    record: r,
    game: { status: "final", home_score: 5, away_score: 3, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("price-missing Held/No Play with a real ML side → graded win for accuracy", g.result === "win");
}

// ── Phase 6B.19 — FI markets grade mid-game once inning 1 complete ──
console.log("\n━━━ Phase 6B.19 — FI grades mid-game (no need to wait for final) ━━━");
{
  // NRFI + game still in progress, but 1st inning has closed scoreless.
  // Pre-6B.19 returned pending until full final. Post-6B.19 should grade win.
  const r = makeRecord({ market: "first_inning", pick: "NRFI" });
  const g = gradePrediction({
    record: r,
    game: { status: "STATUS_IN_PROGRESS", home_score: 3, away_score: 2, first_inning_runs: 0 },
    source: "auto_score_ingest",
  });
  check("NRFI + in_progress + first_inning_runs=0 → win", g.result === "win" && g.win === true);
  check("FI win records actual_first_inning_runs", g.actual_first_inning_runs === 0);
}
{
  // YRFI + in_progress + first inning had 1 run → win
  const r = makeRecord({ market: "first_inning", pick: "YRFI" });
  const g = gradePrediction({
    record: r,
    game: { status: "STATUS_IN_PROGRESS", home_score: 4, away_score: 5, first_inning_runs: 1 },
    source: "auto_score_ingest",
  });
  check("YRFI + in_progress + first_inning_runs=1 → win", g.result === "win");
}
{
  // FI in_progress but first_inning_runs not yet populated → pending
  // (linescore ingester hasn't processed inning 1 close yet)
  const r = makeRecord({ market: "first_inning", pick: "NRFI" });
  const g = gradePrediction({
    record: r,
    game: { status: "STATUS_IN_PROGRESS", home_score: 0, away_score: 0, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("FI + in_progress + first_inning_runs=null → pending", g.result === "pending");
}
{
  // FI + postponed → void (precedes the in-progress short-circuit)
  const r = makeRecord({ market: "first_inning", pick: "NRFI" });
  const g = gradePrediction({
    record: r,
    game: { status: "postponed", home_score: null, away_score: null, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("FI + postponed → void (void check still wins)", g.result === "void");
}

// ── NHL label-style picks (regression: 2026-06-10 grader bug) ─────────
console.log("\n━━━ NHL label-style picks (pick=label, side=canonical) ━━━");
{
  // CAR ML: pick="CAR ML", side="away". CAR (away) won 5-3 → WIN.
  const r = makeRecord({
    sport: "nhl", market: "moneyline", pick: "CAR ML", side: "away",
  });
  const g = gradePrediction({
    record: r,
    game: { status: "OFF", home_score: 3, away_score: 5, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("NHL ML: pick='CAR ML' side='away' + away won → win", g.result === "win" && g.win === true);
}
{
  // VGK ML: pick="VGK ML", side="home". VGK (home) lost 3-5 → LOSS.
  const r = makeRecord({
    sport: "nhl", market: "moneyline", pick: "VGK ML", side: "home",
  });
  const g = gradePrediction({
    record: r,
    game: { status: "OFF", home_score: 3, away_score: 5, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("NHL ML: pick='VGK ML' side='home' + home lost → loss", g.result === "loss" && g.loss === true);
}
{
  // OVER 5.5: pick="OVER 5.5", side="over". Total=8 > 5.5 → WIN.
  const r = makeRecord({
    sport: "nhl", market: "total", pick: "OVER 5.5", side: "over", line_value: 5.5,
  });
  const g = gradePrediction({
    record: r,
    game: { status: "OFF", home_score: 3, away_score: 5, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("NHL Total: pick='OVER 5.5' side='over' + total=8 → win", g.result === "win" && g.win === true);
}
{
  // UNDER 5.5: pick="UNDER 5.5", side="under". Total=8 > 5.5 → LOSS.
  const r = makeRecord({
    sport: "nhl", market: "total", pick: "UNDER 5.5", side: "under", line_value: 5.5,
  });
  const g = gradePrediction({
    record: r,
    game: { status: "OFF", home_score: 3, away_score: 5, first_inning_runs: null },
    source: "auto_score_ingest",
  });
  check("NHL Total: pick='UNDER 5.5' side='under' + total=8 → loss", g.result === "loss" && g.loss === true);
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All prediction grader tests passed.");
