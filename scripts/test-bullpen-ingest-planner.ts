/**
 * Phase 4.2.C.1.R-15 — pure tests for `bullpenIngestPlanner`.
 *
 * No DB, no network. Synthetic roster fixtures only.
 */

import {
  planBullpenSelections,
  truncateBullpenSelections,
  type RosterStatsLite,
} from "../lib/services/bullpenIngestPlanner";
import type { MlbRosterEntry } from "../lib/providers/real_api/_mlbStatsApiClient";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean): void {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`);
    failures.push(label);
  }
}

function section(label: string): void {
  console.log(`\n━━━ ${label} ━━━`);
}

function entry(
  personId: number,
  fullName: string,
  overrides: Partial<MlbRosterEntry> = {}
): MlbRosterEntry {
  return {
    personId,
    fullName,
    positionAbbreviation: "P",
    positionType: "Pitcher",
    status: "Active",
    ...overrides,
  };
}

async function main(): Promise<void> {
  section("Selection — RP/CL/MR position fires regardless of GS");
  {
    const res = planBullpenSelections({
      roster: [
        entry(1001, "RP A", { positionAbbreviation: "RP" }),
        entry(1002, "CL B", { positionAbbreviation: "CL" }),
        entry(1003, "MR C", { positionAbbreviation: "MR" }),
      ],
      seasonStatsByPersonId: new Map<number, RosterStatsLite>([
        [1001, { gamesStarted: 30 }],   // would normally fail GS gate
        [1002, { gamesStarted: 20 }],
        [1003, { gamesStarted: null }],
      ]),
    });
    check("[R-15] 3 RP/CL/MR rows selected", res.selected.length === 3);
    check(
      "[R-15] RP/CL/MR selection reasons are rp_cl_mr_position",
      res.selected.every((s) => s.selectionReason === "rp_cl_mr_position")
    );
  }

  section("Selection — pitcher with games_started < 5 fires");
  {
    const res = planBullpenSelections({
      roster: [
        entry(2001, "Low GS Pitcher"), // position "P"
      ],
      seasonStatsByPersonId: new Map<number, RosterStatsLite>([
        [2001, { gamesStarted: 1 }],
      ]),
    });
    check("[R-15] low-GS pitcher selected", res.selected.length === 1);
    check(
      "[R-15] selection reason = low_games_started",
      res.selected[0]?.selectionReason === "low_games_started"
    );
  }

  section("Skip — regular starter with gs >= 5 is skipped");
  {
    const res = planBullpenSelections({
      roster: [entry(3001, "Regular Starter")],
      seasonStatsByPersonId: new Map<number, RosterStatsLite>([
        [3001, { gamesStarted: 10 }],
      ]),
    });
    check("[R-15] regular starter not selected", res.selected.length === 0);
    check(
      "[R-15] skip reason = regular_starter",
      res.skipped[0]?.skipReason === "regular_starter"
    );
  }

  section("Skip — current probable starter is excluded");
  {
    const res = planBullpenSelections({
      roster: [entry(4001, "Tonight's Starter")],
      currentStarterMlbIds: new Set([4001]),
      seasonStatsByPersonId: new Map<number, RosterStatsLite>([
        [4001, { gamesStarted: 1 }], // would otherwise be selected by GS gate
      ]),
    });
    check(
      "[R-15] current starter excluded even with gs<5",
      res.selected.length === 0
    );
    check(
      "[R-15] skip reason = current_starter",
      res.skipped[0]?.skipReason === "current_starter"
    );
  }

  section("Skip — already-in-DB players never selected");
  {
    const res = planBullpenSelections({
      roster: [entry(5001, "Existing Reliever", { positionAbbreviation: "RP" })],
      existingPlayerMlbIds: new Set([5001]),
    });
    check(
      "[R-15] already-in-db player skipped even with RP position",
      res.selected.length === 0
    );
    check(
      "[R-15] skip reason = already_in_db",
      res.skipped[0]?.skipReason === "already_in_db"
    );
  }

  section("Skip — non-pitcher (position type / abbreviation)");
  {
    const res = planBullpenSelections({
      roster: [
        entry(6001, "Catcher", {
          positionAbbreviation: "C",
          positionType: "Catcher",
        }),
        entry(6002, "Shortstop", {
          positionAbbreviation: "SS",
          positionType: "Infielder",
        }),
      ],
    });
    check("[R-15] non-pitchers skipped", res.selected.length === 0);
    check(
      "[R-15] skip reasons = not_pitcher",
      res.skipped.every((s) => s.skipReason === "not_pitcher")
    );
  }

  section("Inclusive — missing season stats selects (rookie default)");
  {
    const res = planBullpenSelections({
      roster: [entry(7001, "Rookie Reliever")], // pos "P", no stats
      seasonStatsByPersonId: new Map(),         // empty
    });
    check("[R-15] no-stats pitcher selected", res.selected.length === 1);
    check(
      "[R-15] selection reason = no_season_stats",
      res.selected[0]?.selectionReason === "no_season_stats"
    );
  }

  section("Stability — no roster data does not crash");
  {
    const res = planBullpenSelections({ roster: [] });
    check("[R-15] empty roster → empty selected", res.selected.length === 0);
    check("[R-15] empty roster → empty skipped", res.skipped.length === 0);
  }

  section("Idempotency — second run after apply produces zero selections");
  {
    const roster = [
      entry(8001, "Pitcher A", { positionAbbreviation: "RP" }),
      entry(8002, "Pitcher B"),
    ];
    const stats = new Map<number, RosterStatsLite>([
      [8001, { gamesStarted: 0 }],
      [8002, { gamesStarted: 2 }],
    ]);
    const first = planBullpenSelections({
      roster,
      seasonStatsByPersonId: stats,
    });
    check("[R-15] first run selects 2", first.selected.length === 2);
    // Simulate apply having inserted both.
    const second = planBullpenSelections({
      roster,
      existingPlayerMlbIds: new Set([8001, 8002]),
      seasonStatsByPersonId: stats,
    });
    check(
      "[R-15] second run after apply selects 0 (idempotent)",
      second.selected.length === 0
    );
    check(
      "[R-15] second run skip reasons = already_in_db",
      second.skipped.every((s) => s.skipReason === "already_in_db")
    );
  }

  section("Determinism — output sorted by ascending personId");
  {
    const roster = [
      entry(9050, "C"),
      entry(9001, "A"),
      entry(9020, "B"),
    ];
    const stats = new Map<number, RosterStatsLite>([
      [9050, { gamesStarted: 0 }],
      [9001, { gamesStarted: 0 }],
      [9020, { gamesStarted: 0 }],
    ]);
    const res = planBullpenSelections({
      roster,
      seasonStatsByPersonId: stats,
    });
    check(
      "[R-15] selected sorted ascending by personId",
      res.selected[0]?.personId === 9001 &&
        res.selected[1]?.personId === 9020 &&
        res.selected[2]?.personId === 9050
    );
  }

  section("Dedupe — duplicate roster rows for one personId collapse");
  {
    const res = planBullpenSelections({
      roster: [
        entry(10001, "Dupe", { positionAbbreviation: "RP" }),
        entry(10001, "Dupe again", { positionAbbreviation: "RP" }),
      ],
    });
    check(
      "[R-15] duplicate personId → single selection",
      res.selected.length === 1
    );
  }

  section("Slate vs all-teams — planner is agnostic; pure inputs only");
  {
    // Same roster, different contexts: with vs without currentStarterMlbIds
    const roster = [
      entry(11001, "Pitcher A"),
      entry(11002, "Pitcher B", { positionAbbreviation: "RP" }),
    ];
    const stats = new Map<number, RosterStatsLite>([
      [11001, { gamesStarted: 0 }],
      [11002, { gamesStarted: 30 }],
    ]);
    const allTeamsMode = planBullpenSelections({
      roster,
      seasonStatsByPersonId: stats,
    });
    const slateMode = planBullpenSelections({
      roster,
      currentStarterMlbIds: new Set([11001]),
      seasonStatsByPersonId: stats,
    });
    check(
      "[R-15] all-teams mode selects both (no slate exclusion)",
      allTeamsMode.selected.length === 2
    );
    check(
      "[R-15] slate mode excludes tonight's starter",
      slateMode.selected.length === 1 &&
        slateMode.selected[0]?.personId === 11002
    );
  }

  section("Truncation helper — deterministic limit application");
  {
    const list = [1, 2, 3, 4, 5];
    check("[R-15] truncate undefined → full", truncateBullpenSelections(list, undefined).length === 5);
    check("[R-15] truncate 3 → first 3", JSON.stringify(truncateBullpenSelections(list, 3)) === "[1,2,3]");
    check("[R-15] truncate 0 → empty", truncateBullpenSelections(list, 0).length === 0);
    check("[R-15] truncate negative → empty", truncateBullpenSelections(list, -1).length === 0);
  }

  section("Skip counters — aggregate counts populated");
  {
    const res = planBullpenSelections({
      roster: [
        entry(12001, "Reg SP"),
        entry(12002, "Catcher", { positionAbbreviation: "C", positionType: "Catcher" }),
        entry(12003, "Tonight starter"),
      ],
      currentStarterMlbIds: new Set([12003]),
      seasonStatsByPersonId: new Map<number, RosterStatsLite>([
        [12001, { gamesStarted: 25 }],
        [12003, { gamesStarted: 25 }],
      ]),
    });
    check("[R-15] regular_starter counter == 1", res.skipCountsByReason.regular_starter === 1);
    check("[R-15] not_pitcher counter == 1", res.skipCountsByReason.not_pitcher === 1);
    check("[R-15] current_starter counter == 1", res.skipCountsByReason.current_starter === 1);
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:\n${failures.map((m) => `  ✗ ${m}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`\n✅ All bullpen-ingest-planner tests passed.`);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
