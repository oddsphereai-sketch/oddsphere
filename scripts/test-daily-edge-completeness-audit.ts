/**
 * Phase 6B.30C — Daily Edge Data Completeness Audit tests.
 *
 * Pure / fixture-only. Validates the analyzer at
 * lib/services/dailyEdgeCompletenessAudit.ts against the seven
 * requirements (17–23) from the Phase 6B.30C spec:
 *
 *  17. Audit flags a game with one missing starter as warning/provisional
 *  18. Audit flags a game with lines but no prediction
 *  19. Audit reports real/preferred/fallback/proxy/neutral/missing feature counts per game
 *  20. Audit detects when official scheduled count does not equal Daily Edge ready + pending/provisional cards
 *  21. Audit detects when lines exist in DB but are not used/displayed
 *  22. Audit detects when broad neutral fallback usage exceeds a safe threshold
 *  23. Audit output clearly distinguishes "source unavailable" from "available but not mapped/used"
 *
 * Run: npx tsx scripts/test-daily-edge-completeness-audit.ts
 */

import {
  auditDailyEdgeCompleteness,
  classifyStarter,
  classifyLines,
  classifyGame,
  type DailyEdgeCompletenessInput,
  type AuditGameInput,
} from "../lib/services/dailyEdgeCompletenessAudit";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

// ─── Builders ─────────────────────────────────────────────────────

function buildGame(o: Partial<AuditGameInput> = {}): AuditGameInput {
  // Use `in` checks for nullable fields so explicit `null` overrides
  // are preserved (instead of `??` which would replace null with the
  // default). This matters for has_prediction=false fixtures that set
  // tier/provisional/feature_counts to null.
  return {
    game_external_id: o.game_external_id ?? 1000,
    game_id: o.game_id ?? 100,
    matchup: o.matchup ?? "AWY@HOM",
    home: o.home ?? {
      pitcher_id: 1, mapped: true, season_stats_present: true,
      last_updated_iso: "2026-06-08T12:00:00Z",
    },
    away: o.away ?? {
      pitcher_id: 2, mapped: true, season_stats_present: true,
      last_updated_iso: "2026-06-08T12:00:00Z",
    },
    lines: o.lines ?? { ml_books_count: 5, ou_books_count: 5, fi_books_count: 3 },
    has_prediction: o.has_prediction ?? true,
    prediction_tier: "prediction_tier" in o ? o.prediction_tier! : "high",
    prediction_provisional: "prediction_provisional" in o ? o.prediction_provisional! : false,
    prediction_held: o.prediction_held ?? false,
    prediction_hold_picks: o.prediction_hold_picks ?? [],
    feature_counts: "feature_counts" in o
      ? o.feature_counts!
      : { preferred: 8, fallback_real: 2, proxy: 2, neutral_fallback: 0, missing: 0, present: 12 },
  };
}

function buildInput(games: AuditGameInput[], threshold = 3): DailyEdgeCompletenessInput {
  return { sport: "mlb", slate_date: "2026-06-08", games, neutral_fallback_threshold: threshold };
}

async function main() {
  // ──────────────────────────────────────────────────────────────────
  section("Classifiers — starter / lines / game");

  // classifyStarter — 4 distinct states
  check("classifyStarter: pitcher_id null → missing_source_unavailable",
    classifyStarter({ pitcher_id: null, mapped: false, season_stats_present: false, last_updated_iso: null }) === "missing_source_unavailable");
  check("classifyStarter: pitcher_id set but mapped=false → present_unmapped (ingestion gap)",
    classifyStarter({ pitcher_id: 99, mapped: false, season_stats_present: false, last_updated_iso: "2026-06-08T00:00:00Z" }) === "present_unmapped");
  check("classifyStarter: mapped but no stats → present_mapped_no_stats (coverage gap)",
    classifyStarter({ pitcher_id: 99, mapped: true, season_stats_present: false, last_updated_iso: "2026-06-08T00:00:00Z" }) === "present_mapped_no_stats");
  check("classifyStarter: fully present → present_mapped_with_stats",
    classifyStarter({ pitcher_id: 99, mapped: true, season_stats_present: true, last_updated_iso: "2026-06-08T00:00:00Z" }) === "present_mapped_with_stats");

  // classifyLines — 3 states
  check("classifyLines: all three markets present → complete",
    classifyLines({ ml_books_count: 5, ou_books_count: 5, fi_books_count: 3 }) === "complete");
  check("classifyLines: only ML → partial",
    classifyLines({ ml_books_count: 5, ou_books_count: 0, fi_books_count: 0 }) === "partial");
  check("classifyLines: nothing → missing_all",
    classifyLines({ ml_books_count: 0, ou_books_count: 0, fi_books_count: 0 }) === "missing_all");

  // ──────────────────────────────────────────────────────────────────
  section("Test 17 — single-missing-starter is warning/provisional, not silent");
  {
    // SEA@BAL pattern: home_pitcher null, away present + mapped. Game
    // has a prediction (V2.2 fallback) with tier=fallback, provisional=true.
    const game = buildGame({
      matchup: "SEA@BAL",
      home: { pitcher_id: null, mapped: false, season_stats_present: false, last_updated_iso: null },
      away: { pitcher_id: 14303, mapped: true, season_stats_present: true, last_updated_iso: "2026-06-08T12:00:00Z" },
      has_prediction: true,
      prediction_tier: "fallback",
      prediction_provisional: true,
      feature_counts: { preferred: 3, fallback_real: 0, proxy: 6, neutral_fallback: 0, missing: 5, present: 9 },
    });
    const report = auditDailyEdgeCompleteness(buildInput([game]));
    check("T17 — game classification = provisional_fallback",
      report.per_game[0]!.classification === "provisional_fallback");
    check("T17 — per-game flag includes starter_warning_single_side",
      report.per_game[0]!.flags.includes("starter_warning_single_side"));
    check("T17 — per-game flag does NOT include starter_warning_both_sides",
      !report.per_game[0]!.flags.includes("starter_warning_both_sides"));
    check("T17 — slate starter_warning_count = 1",
      report.starter_warning_count === 1);
    check("T17 — slate starter_both_missing_count = 0",
      report.starter_both_missing_count === 0);
    check("T17 — slate provisional_fallback_count = 1",
      report.provisional_fallback_count === 1);
    check("T17 — starter_home status = missing_source_unavailable",
      report.per_game[0]!.starter_home === "missing_source_unavailable");
    check("T17 — starter_away status = present_mapped_with_stats",
      report.per_game[0]!.starter_away === "present_mapped_with_stats");
  }

  // ──────────────────────────────────────────────────────────────────
  section("Test 18 — game with lines but no prediction is flagged (SEA@BAL pre-fix pattern)");
  {
    const game = buildGame({
      matchup: "SEA@BAL",
      home: { pitcher_id: null, mapped: false, season_stats_present: false, last_updated_iso: null },
      away: { pitcher_id: 14303, mapped: true, season_stats_present: true, last_updated_iso: "2026-06-08T12:00:00Z" },
      lines: { ml_books_count: 7, ou_books_count: 7, fi_books_count: 2 },
      has_prediction: false,
      prediction_tier: null,
      prediction_provisional: null,
      feature_counts: null,
    });
    const report = auditDailyEdgeCompleteness(buildInput([game]));
    check("T18 — flag lines_present_but_no_prediction fires",
      report.per_game[0]!.flags.includes("lines_present_but_no_prediction"));
    check("T18 — flag no_prediction_row fires",
      report.per_game[0]!.flags.includes("no_prediction_row"));
    check("T18 — slate red_flags includes lines_present_but_no_prediction",
      report.red_flags.includes("lines_present_but_no_prediction"));
    check("T18 — slate lines_present_but_no_prediction_count = 1",
      report.lines_present_but_no_prediction_count === 1);
    check("T18 — classification = pending_one_starter (because home missing)",
      report.per_game[0]!.classification === "pending_one_starter");
  }

  // ──────────────────────────────────────────────────────────────────
  section("Test 19 — feature counts reported per game");
  {
    const fc = { preferred: 5, fallback_real: 1, proxy: 4, neutral_fallback: 2, missing: 2, present: 12 };
    const game = buildGame({ feature_counts: fc });
    const report = auditDailyEdgeCompleteness(buildInput([game]));
    check("T19 — per-game feature_counts.preferred = 5",
      report.per_game[0]!.feature_counts!.preferred === 5);
    check("T19 — per-game feature_counts.fallback_real = 1",
      report.per_game[0]!.feature_counts!.fallback_real === 1);
    check("T19 — per-game feature_counts.proxy = 4",
      report.per_game[0]!.feature_counts!.proxy === 4);
    check("T19 — per-game feature_counts.neutral_fallback = 2",
      report.per_game[0]!.feature_counts!.neutral_fallback === 2);
    check("T19 — per-game feature_counts.missing = 2",
      report.per_game[0]!.feature_counts!.missing === 2);
    check("T19 — per-game feature_counts.present = 12",
      report.per_game[0]!.feature_counts!.present === 12);
  }
  {
    const game = buildGame({
      has_prediction: false,
      prediction_tier: null,
      prediction_provisional: null,
      feature_counts: null,
    });
    const report = auditDailyEdgeCompleteness(buildInput([game]));
    check("T19 — no prediction → feature_counts === null",
      report.per_game[0]!.feature_counts === null);
  }

  // ──────────────────────────────────────────────────────────────────
  section("Test 20 — official count vs ready/pending breakdown");
  {
    // 8 games total: 6 ready (full data), 1 provisional fallback, 1 no
    // prediction (the SEA@BAL post-fix scenario, where V2.2 has emitted
    // for 7 games + 1 is missing_both_starters which can't be predicted).
    const games: AuditGameInput[] = [
      ...Array.from({ length: 6 }, (_, i) => buildGame({ game_external_id: 1000 + i, matchup: `G${i}` })),
      // 1 game = single-missing-starter, V2.2 fallback emitted
      buildGame({
        game_external_id: 1006, matchup: "FALL@BACK",
        home: { pitcher_id: null, mapped: false, season_stats_present: false, last_updated_iso: null },
        prediction_tier: "fallback", prediction_provisional: true,
        feature_counts: { preferred: 3, fallback_real: 0, proxy: 6, neutral_fallback: 0, missing: 5, present: 9 },
      }),
      // 1 game = both starters missing, no prediction
      buildGame({
        game_external_id: 1007, matchup: "DARK@VOID",
        home: { pitcher_id: null, mapped: false, season_stats_present: false, last_updated_iso: null },
        away: { pitcher_id: null, mapped: false, season_stats_present: false, last_updated_iso: null },
        has_prediction: false, prediction_tier: null, prediction_provisional: null, feature_counts: null,
      }),
    ];
    const report = auditDailyEdgeCompleteness(buildInput(games));
    check("T20 — official_count = 8", report.official_count === 8);
    check("T20 — prediction_count = 7", report.prediction_count === 7);
    check("T20 — no_prediction_count = 1", report.no_prediction_count === 1);
    check("T20 — provisional_fallback_count = 1", report.provisional_fallback_count === 1);
    check("T20 — official == prediction + no_prediction (card_count math holds)",
      report.official_count === report.prediction_count + report.no_prediction_count);
    check("T20 — slate red_flags does NOT include card_count_mismatch",
      !report.red_flags.includes("card_count_mismatch"));
    check("T20 — DARK@VOID classification = pending_both_starters",
      report.per_game.find((g) => g.matchup === "DARK@VOID")!.classification === "pending_both_starters");
    check("T20 — DARK@VOID flag starter_warning_both_sides",
      report.per_game.find((g) => g.matchup === "DARK@VOID")!.flags.includes("starter_warning_both_sides"));
  }

  // ──────────────────────────────────────────────────────────────────
  section("Test 21 — lines exist but not used/displayed (the SEA@BAL bug class)");
  {
    // Multiple games where lines are present in DB but no prediction
    // row exists. This should fire the lines_present_but_no_prediction
    // red flag at the slate level — the operator's signal that the
    // orchestrator pre-excluded games.
    const games: AuditGameInput[] = [
      // Game 1: complete, has prediction
      buildGame({ game_external_id: 1, matchup: "ONE@A" }),
      // Game 2: lines present, no prediction → red flag
      buildGame({
        game_external_id: 2, matchup: "TWO@A",
        has_prediction: false, prediction_tier: null, prediction_provisional: null, feature_counts: null,
      }),
      // Game 3: another lines-present-no-prediction
      buildGame({
        game_external_id: 3, matchup: "THR@A",
        has_prediction: false, prediction_tier: null, prediction_provisional: null, feature_counts: null,
      }),
    ];
    const report = auditDailyEdgeCompleteness(buildInput(games));
    check("T21 — slate red_flags includes lines_present_but_no_prediction",
      report.red_flags.includes("lines_present_but_no_prediction"));
    check("T21 — lines_present_but_no_prediction_count = 2",
      report.lines_present_but_no_prediction_count === 2);
    // Confirm per-game flag fires on the right games
    check("T21 — game 1 does NOT have lines_present_but_no_prediction flag",
      !report.per_game.find((g) => g.game_external_id === 1)!.flags.includes("lines_present_but_no_prediction"));
    check("T21 — game 2 has lines_present_but_no_prediction flag",
      report.per_game.find((g) => g.game_external_id === 2)!.flags.includes("lines_present_but_no_prediction"));
    check("T21 — game 3 has lines_present_but_no_prediction flag",
      report.per_game.find((g) => g.game_external_id === 3)!.flags.includes("lines_present_but_no_prediction"));
  }
  {
    // Lines missing entirely + no prediction → NOT a "lines present but
    // not used" issue (it's just "lines missing").
    const game = buildGame({
      matchup: "NO@LINES",
      lines: { ml_books_count: 0, ou_books_count: 0, fi_books_count: 0 },
      has_prediction: false, prediction_tier: null, prediction_provisional: null, feature_counts: null,
    });
    const report = auditDailyEdgeCompleteness(buildInput([game]));
    check("T21 — no lines + no prediction → lines_present_but_no_prediction does NOT fire",
      !report.per_game[0]!.flags.includes("lines_present_but_no_prediction"));
    check("T21 — no lines + no prediction → lines_missing_all_markets fires",
      report.per_game[0]!.flags.includes("lines_missing_all_markets"));
    check("T21 — classification = pending_lines",
      report.per_game[0]!.classification === "pending_lines");
  }

  // ──────────────────────────────────────────────────────────────────
  section("Test 22 — broad neutral fallback over threshold flagged");
  {
    // neutral_fallback = 5 > default threshold of 3
    const game = buildGame({
      feature_counts: { preferred: 1, fallback_real: 0, proxy: 3, neutral_fallback: 5, missing: 2, present: 9 },
    });
    const report = auditDailyEdgeCompleteness(buildInput([game]));
    check("T22 — per-game flag broad_neutral_fallback fires when neutral=5 > threshold 3",
      report.per_game[0]!.flags.includes("broad_neutral_fallback"));
    check("T22 — slate red_flags includes broad_neutral_fallback_used",
      report.red_flags.includes("broad_neutral_fallback_used"));
    check("T22 — slate broad_neutral_fallback_count = 1",
      report.broad_neutral_fallback_count === 1);
  }
  {
    // neutral_fallback = 0 (real-data fallback case from V2.2) — must NOT fire
    const game = buildGame({
      feature_counts: { preferred: 3, fallback_real: 0, proxy: 6, neutral_fallback: 0, missing: 5, present: 9 },
    });
    const report = auditDailyEdgeCompleteness(buildInput([game]));
    check("T22 — real-data fallback (neutral=0) does NOT fire broad_neutral_fallback",
      !report.per_game[0]!.flags.includes("broad_neutral_fallback"));
    check("T22 — slate red_flags does NOT include broad_neutral_fallback_used",
      !report.red_flags.includes("broad_neutral_fallback_used"));
  }
  {
    // Configurable threshold — set to 0 so even 1 neutral fallback fires.
    const game = buildGame({
      feature_counts: { preferred: 5, fallback_real: 2, proxy: 4, neutral_fallback: 1, missing: 2, present: 12 },
    });
    const report = auditDailyEdgeCompleteness(buildInput([game], /*threshold=*/0));
    check("T22 — threshold=0 + neutral=1 → broad_neutral_fallback fires",
      report.per_game[0]!.flags.includes("broad_neutral_fallback"));
    check("T22 — threshold echoed back in report",
      report.neutral_fallback_threshold === 0);
  }

  // ──────────────────────────────────────────────────────────────────
  section("Test 23 — distinguish 'source unavailable' from 'available but not mapped/used'");
  {
    // Four sub-cases, each producing a different starter status:
    //   a. pitcher_id null → source unavailable
    //   b. pitcher_id set, mapped=false → present_unmapped (DB ingestion gap)
    //   c. pitcher_id set, mapped=true, season_stats=false → mapped but no stats (coverage gap)
    //   d. pitcher_id set, mapped, season_stats → fully present
    const games: AuditGameInput[] = [
      buildGame({
        game_external_id: 100, matchup: "UNA@VAIL",
        home: { pitcher_id: null, mapped: false, season_stats_present: false, last_updated_iso: null },
        has_prediction: false, prediction_tier: null, prediction_provisional: null, feature_counts: null,
      }),
      buildGame({
        game_external_id: 101, matchup: "UNM@APPED",
        home: { pitcher_id: 999, mapped: false, season_stats_present: false, last_updated_iso: "2026-06-08T12:00:00Z" },
      }),
      buildGame({
        game_external_id: 102, matchup: "NO@STATS",
        home: { pitcher_id: 999, mapped: true, season_stats_present: false, last_updated_iso: "2026-06-08T12:00:00Z" },
      }),
      buildGame({
        game_external_id: 103, matchup: "ALL@GOOD",
      }),
    ];
    const report = auditDailyEdgeCompleteness(buildInput(games));

    // (a) source unavailable — only flag is starter_warning_single_side
    const una = report.per_game.find((g) => g.game_external_id === 100)!;
    check("T23 (a) — pitcher_id null → starter_home = missing_source_unavailable",
      una.starter_home === "missing_source_unavailable");
    check("T23 (a) — flag is starter_warning_single_side, NOT starter_unmapped_player_row_missing",
      una.flags.includes("starter_warning_single_side") &&
        !una.flags.includes("starter_unmapped_player_row_missing"));
    check("T23 (a) — NOT classified as starter_stats_missing",
      !una.flags.includes("starter_stats_missing"));

    // (b) available but not mapped — distinct flag
    const unm = report.per_game.find((g) => g.game_external_id === 101)!;
    check("T23 (b) — pitcher_id set but no player row → starter_home = present_unmapped",
      unm.starter_home === "present_unmapped");
    check("T23 (b) — flag starter_unmapped_player_row_missing fires",
      unm.flags.includes("starter_unmapped_player_row_missing"));
    check("T23 (b) — flag starter_warning_single_side does NOT fire (pitcher is set)",
      !unm.flags.includes("starter_warning_single_side"));
    check("T23 (b) — slate red_flags includes starter_player_mapping_gap",
      report.red_flags.includes("starter_player_mapping_gap"));

    // (c) mapped but no stats — distinct flag
    const ns = report.per_game.find((g) => g.game_external_id === 102)!;
    check("T23 (c) — mapped + no stats → starter_home = present_mapped_no_stats",
      ns.starter_home === "present_mapped_no_stats");
    check("T23 (c) — flag starter_stats_missing fires",
      ns.flags.includes("starter_stats_missing"));
    check("T23 (c) — slate red_flags includes starter_stats_coverage_gap",
      report.red_flags.includes("starter_stats_coverage_gap"));

    // (d) fully present — no starter flags
    const good = report.per_game.find((g) => g.game_external_id === 103)!;
    check("T23 (d) — fully present starter → starter_home = present_mapped_with_stats",
      good.starter_home === "present_mapped_with_stats");
    check("T23 (d) — no starter-related flags fire",
      !good.flags.includes("starter_warning_single_side") &&
        !good.flags.includes("starter_unmapped_player_row_missing") &&
        !good.flags.includes("starter_stats_missing"));
  }

  // ──────────────────────────────────────────────────────────────────
  section("Phase 6B.30C smoke — reproduce real 2026-06-08 slate shape");
  {
    // 8 games: 7 with both starters + lines + V2.2 high-tier prediction,
    // 1 SEA@BAL with home_pitcher null but lines present. Under the
    // Phase 6B.30C policy split + V2.2 fallback, SEA@BAL gets a
    // provisional_fallback prediction.
    const games: AuditGameInput[] = [
      ...Array.from({ length: 7 }, (_, i) => buildGame({ game_external_id: 5058755 + i + 1, matchup: `G${i}` })),
      buildGame({
        game_external_id: 5058755, matchup: "SEA@BAL",
        home: { pitcher_id: null, mapped: false, season_stats_present: false, last_updated_iso: null },
        away: { pitcher_id: 14303, mapped: true, season_stats_present: true, last_updated_iso: "2026-06-08T12:00:00Z" },
        lines: { ml_books_count: 7, ou_books_count: 7, fi_books_count: 2 },
        has_prediction: true,
        prediction_tier: "fallback",
        prediction_provisional: true,
        feature_counts: { preferred: 3, fallback_real: 0, proxy: 6, neutral_fallback: 0, missing: 5, present: 9 },
      }),
    ];
    const report = auditDailyEdgeCompleteness(buildInput(games));
    check("Smoke — official_count = 8", report.official_count === 8);
    check("Smoke — prediction_count = 8 (all 8 get a row)", report.prediction_count === 8);
    check("Smoke — no_prediction_count = 0", report.no_prediction_count === 0);
    check("Smoke — provisional_fallback_count = 1 (just SEA@BAL)", report.provisional_fallback_count === 1);
    check("Smoke — starter_warning_count = 1 (just SEA@BAL)", report.starter_warning_count === 1);
    check("Smoke — starter_both_missing_count = 0", report.starter_both_missing_count === 0);
    check("Smoke — broad_neutral_fallback_count = 0 (real-data fallback)", report.broad_neutral_fallback_count === 0);
    check("Smoke — slate red_flags is empty (no operator action needed)",
      report.red_flags.length === 0);
    check("Smoke — SEA@BAL classification = provisional_fallback",
      report.per_game.find((g) => g.matchup === "SEA@BAL")!.classification === "provisional_fallback");
  }

  // ──────────────────────────────────────────────────────────────────
  console.log(`\n━━━ Results ━━━\n  ✓ ${pass}    ✗ ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
