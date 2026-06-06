/**
 * Phase 4.2.C.1.R-19 Phase 4a — tests for the slate-safety gates
 * (G1 minimum game count, G2 starter coverage, G3 in-progress ingest).
 *
 * Pure tests — no DB, no env, no network. All three gate helpers are
 * pure functions that take typed inputs and return verdicts.
 *
 * Run: npx tsx scripts/test-automation-slate-safety-gates.ts
 */

import {
  assessMinimumGameCount,
  assessStarterCoverage,
  assessInProgressGames,
  anyGateFailedClosed,
  DEFAULT_MIN_MLB_GAMES,
  DEFAULT_MIN_STARTER_COVERAGE_PCT,
  DEFAULT_MIN_STARTER_COVERAGE_CATASTROPHIC_PCT,
  DEFAULT_MAX_MISSING_BOTH_FOR_CATASTROPHIC,
  IN_PROGRESS_BDL_STATUSES,
} from "../lib/services/automationSlateSafetyGates";

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

async function main() {
  // ── G1 — Minimum game count ─────────────────────────────────────────
  section("G1 — minimum game count");

  {
    const r = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 15 });
    check("MLB 15 games → ok", r.status === "ok");
    check("threshold = 8 (DEFAULT_MIN_MLB_GAMES)", r.threshold === 8);
    check("observed = 15", r.observed === 15);
  }
  {
    const r = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 8 });
    check("MLB 8 games (at threshold) → ok", r.status === "ok");
  }
  {
    const r = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 7 });
    check("MLB 7 games (below threshold) → fail_closed", r.status === "fail_closed");
    check("reason mentions below-floor", r.reason.includes("below"));
    check("reason mentions blocking writes", r.reason.includes("blocking"));
  }
  {
    // The 2026-05 mock-fixture pattern would have caught this
    const r = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 5 });
    check("MLB 5 games (May fixture pattern) → fail_closed", r.status === "fail_closed");
    check("reason calls out mock-fixture possibility", r.reason.includes("mock-fixture"));
  }
  {
    const r = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 0 });
    check("MLB 0 games → fail_closed", r.status === "fail_closed");
  }
  {
    // Operator override path: small slate but explicit threshold
    const r = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 3, minGameCount: 1 });
    check("override threshold=1 with 3 games → ok", r.status === "ok");
    check("threshold reflects override", r.threshold === 1);
  }
  {
    // Constant exposure
    check("DEFAULT_MIN_MLB_GAMES = 8", DEFAULT_MIN_MLB_GAMES === 8);
  }

  // ── G2 — Starter coverage ───────────────────────────────────────────
  section("G2 — starter coverage");

  {
    // Empty games array → deferred
    const r = assessStarterCoverage({ sport: "mlb", games: [] });
    check("empty games array → deferred", r.status === "deferred");
    check("total = 0", r.totalGames === 0);
    check("coverage_pct = 0", r.coveragePct === 0);
    check("reason explains deferral", r.reason.includes("deferred"));
    check("deferred → excluded_external_ids = []", r.excluded_external_ids.length === 0);
    check("deferred → held_reasons = {}", Object.keys(r.held_reasons).length === 0);
  }
  {
    // All starters set
    const games = [
      { external_id: 1, home_pitcher_id: 1, away_pitcher_id: 2 },
      { external_id: 2, home_pitcher_id: 3, away_pitcher_id: 4 },
      { external_id: 3, home_pitcher_id: 5, away_pitcher_id: 6 },
    ];
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("3/3 games complete → ok", r.status === "ok");
    check("totalGames = 3", r.totalGames === 3);
    check("gamesWithBothStarters = 3", r.gamesWithBothStarters === 3);
    check("coveragePct = 100", r.coveragePct === 100);
    check("threshold = 90 (DEFAULT_MIN_STARTER_COVERAGE_PCT)", r.threshold === 90);
    check("3/3 → excluded_external_ids = []", r.excluded_external_ids.length === 0);
    check("3/3 → held_reasons = {}", Object.keys(r.held_reasons).length === 0);
  }
  {
    // R-19 Phase 5g.4 — Mixed at-threshold case. 9 of 10 complete = 90%
    // = pass overall; the 1 missing-both game is STILL excluded per-game.
    const games = Array.from({ length: 10 }, (_, i) => ({
      external_id: 100 + i,
      home_pitcher_id: i === 9 ? null : i,
      away_pitcher_id: i === 9 ? null : i + 100,
    }));
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("9/10 games complete (90%) → ok (above threshold)", r.status === "ok");
    check("coveragePct = 90", r.coveragePct === 90);
    check("gamesMissingBoth = 1", r.gamesMissingBoth === 1);
    // Phase 5g.4 — the 1 missing game STILL gets excluded per-game even
    // at "ok" status (unconditional per-game hold).
    check("9/10 ok → excluded_external_ids contains the 1 missing game", r.excluded_external_ids.length === 1);
    check("excluded id = 109 (the 10th game, missing both)", r.excluded_external_ids[0] === 109);
    check("held_reasons[109] = missing_both", r.held_reasons[109] === "missing_both");
  }
  {
    // R-19 Phase 5g.4 — Today's 2026-06-06 pattern. 13/15 = 86.7% is
    // BELOW the 90% threshold but ABOVE the 50% catastrophic threshold
    // AND missingBoth=0. Result: partial_ok (per-game exclusion, slate
    // still runs). This was the trigger incident for the patch.
    const games = Array.from({ length: 15 }, (_, i) => ({
      external_id: 5058725 + i,
      home_pitcher_id: i < 2 ? null : i,
      away_pitcher_id: i + 100,
    }));
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("13/15 (86.7%, 2 missing home) → partial_ok", r.status === "partial_ok");
    check("coveragePct = 86.7", r.coveragePct === 86.7);
    check("gamesWithBothStarters = 13", r.gamesWithBothStarters === 13);
    check("gamesMissingOne = 2", r.gamesMissingOne === 2);
    check("gamesMissingBoth = 0", r.gamesMissingBoth === 0);
    check("partial_ok → excluded_external_ids has 2 games", r.excluded_external_ids.length === 2);
    check("excluded ids sorted ascending", r.excluded_external_ids[0] < r.excluded_external_ids[1]);
    check("held_reasons[first excluded] = missing_home", r.held_reasons[r.excluded_external_ids[0]] === "missing_home");
    check("reason mentions 'Partial-OK'", r.reason.includes("Partial-OK"));
    check("reason mentions per-game exclusion", r.reason.includes("Per-game exclusion"));
  }
  {
    // R-19 Phase 5g.4 — Just below threshold, only 1 missing-one game.
    // 14/15 = 93.3% (above 90% so still ok) — but ALSO covers the
    // 2026-06-05 pattern where 1 game had a missing starter.
    const games = Array.from({ length: 15 }, (_, i) => ({
      external_id: 200 + i,
      home_pitcher_id: i,
      away_pitcher_id: i === 0 ? null : i + 100,
    }));
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("14/15 (93.3%, 1 missing away) → ok", r.status === "ok");
    check("ok → still excluded the 1 missing game", r.excluded_external_ids.length === 1);
    check("excluded id = 200 (game 0)", r.excluded_external_ids[0] === 200);
    check("held_reasons[200] = missing_away", r.held_reasons[200] === "missing_away");
  }
  {
    // Phase 5g.4 — Catastrophic by % (below 50%).
    // 4/10 games complete = 40% coverage → fail_closed.
    const games = Array.from({ length: 10 }, (_, i) => ({
      external_id: 300 + i,
      home_pitcher_id: i < 4 ? i : null,
      away_pitcher_id: i < 4 ? i + 100 : null,
    }));
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("4/10 (40% < 50% catastrophic) → fail_closed", r.status === "fail_closed");
    check("reason mentions catastrophic", r.reason.toLowerCase().includes("catastrophic"));
    check("catastrophic → excluded_external_ids populated", r.excluded_external_ids.length === 6);
  }
  {
    // Phase 5g.4 — Catastrophic by gamesMissingBoth ≥ 3 even when
    // coverage % is above 50%. Slate of 15 with 4 missing both, 1
    // missing one, 10 complete = 66.7% coverage but 4 missing-both
    // triggers catastrophic regardless.
    const games = Array.from({ length: 15 }, (_, i) => {
      if (i < 4) return { external_id: 400 + i, home_pitcher_id: null, away_pitcher_id: null };
      if (i < 5) return { external_id: 400 + i, home_pitcher_id: i, away_pitcher_id: null };
      return { external_id: 400 + i, home_pitcher_id: i, away_pitcher_id: i + 100 };
    });
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("10/15 (66.7%) but 4 missing-both → fail_closed (catastrophic)", r.status === "fail_closed");
    check("coveragePct > catastrophic_pct (66.7 > 50)", r.coveragePct > 50);
    check("gamesMissingBoth >= 3", r.gamesMissingBoth >= 3);
    check("reason mentions missing BOTH", r.reason.includes("BOTH"));
  }
  {
    // The 2026-06-01 pattern — all 9 games missing both starters.
    // Both catastrophic conditions trigger.
    const games = Array.from({ length: 9 }, (_, i) => ({
      external_id: 500 + i,
      home_pitcher_id: null,
      away_pitcher_id: null,
    }));
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("9 games, all NULL pitchers → fail_closed (catastrophic)", r.status === "fail_closed");
    check("gamesMissingBoth = 9", r.gamesMissingBoth === 9);
    check("gamesWithBothStarters = 0", r.gamesWithBothStarters === 0);
    check("coveragePct = 0", r.coveragePct === 0);
    check("9 excluded external_ids", r.excluded_external_ids.length === 9);
  }
  {
    // Missing-one distribution case (Phase 5g.4 — held reason variety).
    const games = [
      { external_id: 700, home_pitcher_id: 1, away_pitcher_id: null },
      { external_id: 701, home_pitcher_id: null, away_pitcher_id: 2 },
      { external_id: 702, home_pitcher_id: 3, away_pitcher_id: 4 },
    ];
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("2 missing-one + 1 complete → fail_closed (1/3 < 50%)", r.status === "fail_closed");
    check("gamesMissingOne = 2", r.gamesMissingOne === 2);
    check("gamesMissingBoth = 0", r.gamesMissingBoth === 0);
    check("excluded_external_ids = [700, 701] sorted", r.excluded_external_ids.length === 2 && r.excluded_external_ids[0] === 700 && r.excluded_external_ids[1] === 701);
    check("held_reasons[700] = missing_away", r.held_reasons[700] === "missing_away");
    check("held_reasons[701] = missing_home", r.held_reasons[701] === "missing_home");
  }
  {
    // Operator override — relax coverage to 0%. Phase 5g.4: when the
    // operator wants a true bypass (e.g. unit-test of a synthetic
    // slate), they must override BOTH the coverage threshold AND
    // catastrophicMinPct, since catastrophic now triggers on coverage
    // < 50% by default. This documents the explicit two-key bypass.
    const games = [
      { external_id: 800, home_pitcher_id: 1, away_pitcher_id: null },
      { external_id: 801, home_pitcher_id: null, away_pitcher_id: 2 },
    ];
    const r = assessStarterCoverage({
      sport: "mlb",
      games,
      minCoveragePct: 0,
      catastrophicMinPct: 0,
    });
    check("override coverage=0% AND catastrophicMinPct=0 → ok even with no starters set", r.status === "ok");
    check("override + missing → exclusions still populated", r.excluded_external_ids.length === 2);
  }
  {
    // Operator override on catastrophic — raise the catastrophic
    // missing-both threshold to allow a slate with many missing-both.
    const games = Array.from({ length: 10 }, (_, i) => ({
      external_id: 900 + i,
      home_pitcher_id: i < 5 ? null : i,
      away_pitcher_id: i < 5 ? null : i + 100,
    }));
    const r = assessStarterCoverage({
      sport: "mlb",
      games,
      catastrophicMaxMissingBoth: 99,
      catastrophicMinPct: 0,
    });
    check("override catastrophic thresholds → partial_ok (5 missing-both)", r.status === "partial_ok");
    check("excluded_external_ids = 5", r.excluded_external_ids.length === 5);
  }
  {
    check("DEFAULT_MIN_STARTER_COVERAGE_PCT = 90", DEFAULT_MIN_STARTER_COVERAGE_PCT === 90);
    check("DEFAULT_MIN_STARTER_COVERAGE_CATASTROPHIC_PCT = 50", DEFAULT_MIN_STARTER_COVERAGE_CATASTROPHIC_PCT === 50);
    check("DEFAULT_MAX_MISSING_BOTH_FOR_CATASTROPHIC = 3", DEFAULT_MAX_MISSING_BOTH_FOR_CATASTROPHIC === 3);
  }

  // ── G3 — In-progress ingest ─────────────────────────────────────────
  section("G3 — in-progress ingest");

  {
    // All games SCHEDULED → ok
    const bdlGames = [
      { status: "STATUS_SCHEDULED", external_id: 1 },
      { status: "STATUS_SCHEDULED", external_id: 2 },
      { status: "STATUS_SCHEDULED", external_id: 3 },
    ];
    const r = assessInProgressGames({ sport: "mlb", bdlGames });
    check("3 scheduled → ok", r.status === "ok");
    check("inProgressCount = 0", r.inProgressCount === 0);
    check("affectedExternalIds is empty", r.affectedExternalIds.length === 0);
  }
  {
    // The 2026-06-01 pattern — 6 of 9 already in progress
    const bdlGames = [
      { status: "STATUS_IN_PROGRESS", external_id: 5058662 },
      { status: "STATUS_IN_PROGRESS", external_id: 5058663 },
      { status: "STATUS_IN_PROGRESS", external_id: 5058664 },
      { status: "STATUS_IN_PROGRESS", external_id: 5058665 },
      { status: "STATUS_IN_PROGRESS", external_id: 5058666 },
      { status: "STATUS_IN_PROGRESS", external_id: 5058667 },
      { status: "STATUS_SCHEDULED", external_id: 5058668 },
      { status: "STATUS_SCHEDULED", external_id: 5058669 },
      { status: "STATUS_SCHEDULED", external_id: 5058670 },
    ];
    const r = assessInProgressGames({ sport: "mlb", bdlGames });
    check("6/9 in progress (June 1 pattern) → fail_closed", r.status === "fail_closed");
    check("inProgressCount = 6", r.inProgressCount === 6);
    check("affectedExternalIds.length = 6", r.affectedExternalIds.length === 6);
    check(
      "affectedExternalIds sorted",
      JSON.stringify(r.affectedExternalIds) ===
        JSON.stringify([5058662, 5058663, 5058664, 5058665, 5058666, 5058667])
    );
    check("reason cites cron-too-late framing", r.reason.includes("Cron firing too late"));
  }
  {
    // Single in-progress → still blocks (any in-progress = unattended unsafe)
    const bdlGames = [
      { status: "STATUS_SCHEDULED", external_id: 1 },
      { status: "STATUS_IN_PROGRESS", external_id: 2 },
      { status: "STATUS_SCHEDULED", external_id: 3 },
    ];
    const r = assessInProgressGames({ sport: "mlb", bdlGames });
    check("1/3 in progress → fail_closed", r.status === "fail_closed");
    check("affectedExternalIds = [2]", JSON.stringify(r.affectedExternalIds) === "[2]");
  }
  {
    // STATUS_FINAL also blocks (the day rolled over completely)
    const bdlGames = [
      { status: "STATUS_FINAL", external_id: 10 },
      { status: "STATUS_SCHEDULED", external_id: 11 },
    ];
    const r = assessInProgressGames({ sport: "mlb", bdlGames });
    check("STATUS_FINAL counts as in-progress for ingest safety", r.status === "fail_closed");
  }
  {
    // STATUS_POSTPONED does NOT block (legitimate)
    const bdlGames = [
      { status: "STATUS_POSTPONED", external_id: 20 },
      { status: "STATUS_SCHEDULED", external_id: 21 },
      { status: "STATUS_SCHEDULED", external_id: 22 },
    ];
    const r = assessInProgressGames({ sport: "mlb", bdlGames });
    check("STATUS_POSTPONED does NOT trip the gate", r.status === "ok");
  }
  {
    // Empty BDL slate → ok (G1 will catch low count separately)
    const r = assessInProgressGames({ sport: "mlb", bdlGames: [] });
    check("empty BDL games → ok (G1 catches low count)", r.status === "ok");
  }
  {
    // Constant exposure
    check("IN_PROGRESS_BDL_STATUSES has STATUS_IN_PROGRESS", IN_PROGRESS_BDL_STATUSES.has("STATUS_IN_PROGRESS"));
    check("IN_PROGRESS_BDL_STATUSES has STATUS_FINAL", IN_PROGRESS_BDL_STATUSES.has("STATUS_FINAL"));
    check("IN_PROGRESS_BDL_STATUSES has STATUS_END_OF_GAME", IN_PROGRESS_BDL_STATUSES.has("STATUS_END_OF_GAME"));
    check("IN_PROGRESS_BDL_STATUSES does NOT have STATUS_SCHEDULED", !IN_PROGRESS_BDL_STATUSES.has("STATUS_SCHEDULED"));
    check("IN_PROGRESS_BDL_STATUSES does NOT have STATUS_POSTPONED", !IN_PROGRESS_BDL_STATUSES.has("STATUS_POSTPONED"));
  }

  // ── Compound check ─────────────────────────────────────────────────
  section("anyGateFailedClosed — compound predicate");

  {
    check("all null → false", anyGateFailedClosed(null, null, null) === false);
  }
  {
    const g1Ok: ReturnType<typeof assessMinimumGameCount> = {
      status: "ok", threshold: 8, observed: 10, reason: "ok",
    };
    const g2Ok: ReturnType<typeof assessStarterCoverage> = {
      status: "ok", totalGames: 10, gamesWithBothStarters: 10, gamesMissingOne: 0, gamesMissingBoth: 0, coveragePct: 100, threshold: 90, catastrophicThreshold: 50, catastrophicMissingBothThreshold: 3, excluded_external_ids: [], held_reasons: {}, reason: "ok",
    };
    const g3Ok: ReturnType<typeof assessInProgressGames> = {
      status: "ok", totalGames: 10, inProgressCount: 0, affectedExternalIds: [], reason: "ok",
    };
    check("all ok → false", anyGateFailedClosed(g1Ok, g2Ok, g3Ok) === false);
  }
  {
    const g1Fail = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 5 });
    const g2Ok = assessStarterCoverage({ sport: "mlb", games: [{ external_id: 1, home_pitcher_id: 1, away_pitcher_id: 2 }], minCoveragePct: 0 });
    const g3Ok = assessInProgressGames({ sport: "mlb", bdlGames: [] });
    check("only G1 fail_closed → true", anyGateFailedClosed(g1Fail, g2Ok, g3Ok) === true);
  }
  {
    const g1Ok = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 15 });
    const g2Fail = assessStarterCoverage({
      sport: "mlb",
      games: Array.from({ length: 10 }, (_, i) => ({ external_id: i, home_pitcher_id: null, away_pitcher_id: null })),
    });
    const g3Ok = assessInProgressGames({ sport: "mlb", bdlGames: [] });
    check("only G2 fail_closed (catastrophic) → true", anyGateFailedClosed(g1Ok, g2Fail, g3Ok) === true);
  }
  {
    // R-19 Phase 5g.4 — Critical regression: partial_ok must NOT count
    // as fail_closed. Today's 13/15 scenario: G2 returns partial_ok and
    // anyGateFailedClosed must stay false (slate is allowed to proceed).
    const g1Ok = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 15 });
    const g2Partial = assessStarterCoverage({
      sport: "mlb",
      games: Array.from({ length: 15 }, (_, i) => ({
        external_id: 5058725 + i,
        home_pitcher_id: i < 2 ? null : i,
        away_pitcher_id: i + 100,
      })),
    });
    const g3Ok = assessInProgressGames({ sport: "mlb", bdlGames: [] });
    check("G2 partial_ok (13/15) → status === 'partial_ok'", g2Partial.status === "partial_ok");
    check("G2 partial_ok + others ok → anyGateFailedClosed false", anyGateFailedClosed(g1Ok, g2Partial, g3Ok) === false);
  }
  {
    const g1Ok = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 15 });
    const g2Ok = assessStarterCoverage({ sport: "mlb", games: [], minCoveragePct: 0 });
    const g3Fail = assessInProgressGames({
      sport: "mlb",
      bdlGames: [{ status: "STATUS_IN_PROGRESS", external_id: 1 }],
    });
    check("only G3 fail_closed → true", anyGateFailedClosed(g1Ok, g2Ok, g3Fail) === true);
  }
  {
    // G2 deferred should NOT count as fail_closed
    const g1Ok = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 15 });
    const g2Deferred = assessStarterCoverage({ sport: "mlb", games: [] });
    const g3Ok = assessInProgressGames({ sport: "mlb", bdlGames: [] });
    check("G2 deferred + others ok → false (deferred ≠ fail)", anyGateFailedClosed(g1Ok, g2Deferred, g3Ok) === false);
  }

  // ── Critical regression — auto-publish blocking ─────────────────────
  section("Critical regression — auto-publish blocking when any gate fails");
  {
    // Realistic scenario: BDL has 15 games (G1 passes), 14 are in
    // progress (G3 fails), starters are all null because mid-game
    // (G2 fails too). Cron firing at midnight ET.
    const g1 = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 15 });
    const g2 = assessStarterCoverage({
      sport: "mlb",
      games: Array.from({ length: 15 }, (_, i) => ({
        external_id: 5058700 + i,
        home_pitcher_id: null,
        away_pitcher_id: null,
      })),
    });
    const g3 = assessInProgressGames({
      sport: "mlb",
      bdlGames: Array.from({ length: 15 }, (_, i) => ({
        status: i < 14 ? "STATUS_IN_PROGRESS" : "STATUS_SCHEDULED",
        external_id: 5058700 + i,
      })),
    });
    check("G1 passes (15 ≥ 8)", g1.status === "ok");
    check("G2 fail_closed (0% starters)", g2.status === "fail_closed");
    check("G3 fail_closed (14/15 in progress)", g3.status === "fail_closed");
    check("anyGateFailedClosed → true (publish would be blocked)", anyGateFailedClosed(g1, g2, g3) === true);
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All slate-safety-gates tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); }
);
