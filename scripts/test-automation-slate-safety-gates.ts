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
  }
  {
    // All starters set
    const games = [
      { home_pitcher_id: 1, away_pitcher_id: 2 },
      { home_pitcher_id: 3, away_pitcher_id: 4 },
      { home_pitcher_id: 5, away_pitcher_id: 6 },
    ];
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("3/3 games complete → ok", r.status === "ok");
    check("totalGames = 3", r.totalGames === 3);
    check("gamesWithBothStarters = 3", r.gamesWithBothStarters === 3);
    check("coveragePct = 100", r.coveragePct === 100);
    check("threshold = 90 (DEFAULT_MIN_STARTER_COVERAGE_PCT)", r.threshold === 90);
  }
  {
    // Mixed — at threshold
    // 9 of 10 complete = 90% = pass
    const games = Array.from({ length: 10 }, (_, i) => ({
      home_pitcher_id: i === 9 ? null : i,
      away_pitcher_id: i === 9 ? null : i + 100,
    }));
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("9/10 games complete (90%) → ok", r.status === "ok");
    check("coveragePct = 90", r.coveragePct === 90);
    check("gamesMissingBoth = 1", r.gamesMissingBoth === 1);
  }
  {
    // Just below — 8/10 = 80%
    const games = Array.from({ length: 10 }, (_, i) => ({
      home_pitcher_id: i < 2 ? null : i,
      away_pitcher_id: i < 2 ? null : i + 100,
    }));
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("8/10 games complete (80%) → fail_closed", r.status === "fail_closed");
    check("reason mentions 80%", r.reason.includes("80%"));
    check("reason cites 2026-06-03 pattern", r.reason.includes("2026-06-03"));
  }
  {
    // The 2026-06-01 pattern — all 9 games missing both starters
    const games = Array.from({ length: 9 }, () => ({
      home_pitcher_id: null,
      away_pitcher_id: null,
    }));
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("9 games, all NULL pitchers → fail_closed", r.status === "fail_closed");
    check("gamesMissingBoth = 9", r.gamesMissingBoth === 9);
    check("gamesWithBothStarters = 0", r.gamesWithBothStarters === 0);
    check("coveragePct = 0", r.coveragePct === 0);
  }
  {
    // Missing-one case
    const games = [
      { home_pitcher_id: 1, away_pitcher_id: null },
      { home_pitcher_id: null, away_pitcher_id: 2 },
      { home_pitcher_id: 3, away_pitcher_id: 4 },
    ];
    const r = assessStarterCoverage({ sport: "mlb", games });
    check("2 missing-one + 1 complete → fail_closed", r.status === "fail_closed");
    check("gamesMissingOne = 2", r.gamesMissingOne === 2);
    check("gamesMissingBoth = 0", r.gamesMissingBoth === 0);
  }
  {
    // Operator override
    const games = [
      { home_pitcher_id: 1, away_pitcher_id: null },
      { home_pitcher_id: null, away_pitcher_id: 2 },
    ];
    const r = assessStarterCoverage({ sport: "mlb", games, minCoveragePct: 0 });
    check("override coverage=0% → ok even with no starters set", r.status === "ok");
  }
  {
    check("DEFAULT_MIN_STARTER_COVERAGE_PCT = 90", DEFAULT_MIN_STARTER_COVERAGE_PCT === 90);
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
      status: "ok", totalGames: 10, gamesWithBothStarters: 10, gamesMissingOne: 0, gamesMissingBoth: 0, coveragePct: 100, threshold: 90, reason: "ok",
    };
    const g3Ok: ReturnType<typeof assessInProgressGames> = {
      status: "ok", totalGames: 10, inProgressCount: 0, affectedExternalIds: [], reason: "ok",
    };
    check("all ok → false", anyGateFailedClosed(g1Ok, g2Ok, g3Ok) === false);
  }
  {
    const g1Fail = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 5 });
    const g2Ok = assessStarterCoverage({ sport: "mlb", games: [{ home_pitcher_id: 1, away_pitcher_id: 2 }], minCoveragePct: 0 });
    const g3Ok = assessInProgressGames({ sport: "mlb", bdlGames: [] });
    check("only G1 fail_closed → true", anyGateFailedClosed(g1Fail, g2Ok, g3Ok) === true);
  }
  {
    const g1Ok = assessMinimumGameCount({ sport: "mlb", bdlGameCount: 15 });
    const g2Fail = assessStarterCoverage({
      sport: "mlb",
      games: Array.from({ length: 10 }, () => ({ home_pitcher_id: null, away_pitcher_id: null })),
    });
    const g3Ok = assessInProgressGames({ sport: "mlb", bdlGames: [] });
    check("only G2 fail_closed → true", anyGateFailedClosed(g1Ok, g2Fail, g3Ok) === true);
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
      games: Array.from({ length: 15 }, () => ({
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
