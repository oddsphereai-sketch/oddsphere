/**
 * Phase 4.2.B — Pure unit tests for lib/automodel/lockState.ts.
 *
 * No DB, no env reads. Pure function tests with handcrafted candidates
 * and an injected `now`.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-lock-state.ts
 */

import {
  classifyLockState,
  isLocked,
  computeLocksAt,
  partitionByLockState,
  type LockCandidate,
} from "../lib/automodel/lockState";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(label: string): void {
  console.log(`\n━━━ ${label} ━━━`);
}

// Reference `now` for deterministic tests: 2026-06-03 18:00 UTC (1 PM ET)
const NOW = new Date("2026-06-03T18:00:00.000Z");

// ──────────────────────────────────────────────────────────────────────
// classifyLockState
// ──────────────────────────────────────────────────────────────────────

async function testClassify() {
  section("classifyLockState — terminal states (locked_at present)");
  check(
    "locked_at set + future game_date → 'locked'",
    classifyLockState(
      { locked_at: "2026-06-03T17:55:00.000Z", game_date: "2026-06-03T19:00:00.000Z" },
      NOW
    ) === "locked"
  );
  check(
    "locked_at set + past game_date → 'locked' (terminal)",
    classifyLockState(
      { locked_at: "2026-06-02T22:00:00.000Z", game_date: "2026-06-02T23:00:00.000Z" },
      NOW
    ) === "locked"
  );
  check(
    "locked_at set + null game_date → 'locked' (terminal, game_date irrelevant)",
    classifyLockState({ locked_at: "2026-06-03T17:00:00.000Z", game_date: null }, NOW) === "locked"
  );
  check(
    "locked_at is Date object (not string) → 'locked'",
    classifyLockState(
      { locked_at: new Date("2026-06-03T17:00:00.000Z"), game_date: "2026-06-03T19:00:00.000Z" },
      NOW
    ) === "locked"
  );

  section("classifyLockState — null/invalid game_date");
  check(
    "null locked_at + null game_date → 'still_unlocked'",
    classifyLockState({ locked_at: null, game_date: null }, NOW) === "still_unlocked"
  );
  check(
    "null locked_at + undefined game_date → 'still_unlocked'",
    classifyLockState({ locked_at: null, game_date: undefined }, NOW) === "still_unlocked"
  );
  check(
    "null locked_at + garbage game_date string → 'still_unlocked'",
    classifyLockState({ locked_at: null, game_date: "not-a-date" }, NOW) === "still_unlocked"
  );

  section("classifyLockState — past game_date (already started)");
  check(
    "game_date 5 min in the past → 'already_started'",
    classifyLockState({ locked_at: null, game_date: "2026-06-03T17:55:00.000Z" }, NOW) === "already_started"
  );
  check(
    "game_date 1 hour in the past → 'already_started'",
    classifyLockState({ locked_at: null, game_date: "2026-06-03T17:00:00.000Z" }, NOW) === "already_started"
  );

  section("classifyLockState — entering_lock window (0 < delta <= 60 min)");
  check(
    "game_date exactly at now → 'entering_lock' (delta=0)",
    classifyLockState({ locked_at: null, game_date: "2026-06-03T18:00:00.000Z" }, NOW) === "entering_lock"
  );
  check(
    "game_date in 30 min → 'entering_lock'",
    classifyLockState({ locked_at: null, game_date: "2026-06-03T18:30:00.000Z" }, NOW) === "entering_lock"
  );
  check(
    "game_date in exactly 60 min → 'entering_lock' (inclusive upper bound)",
    classifyLockState({ locked_at: null, game_date: "2026-06-03T19:00:00.000Z" }, NOW) === "entering_lock"
  );
  check(
    "game_date in 60 min, custom window=30 → 'still_unlocked' (outside)",
    classifyLockState(
      { locked_at: null, game_date: "2026-06-03T19:00:00.000Z" },
      NOW,
      30
    ) === "still_unlocked"
  );

  section("classifyLockState — still_unlocked (far future)");
  check(
    "game_date in 61 min (just outside window) → 'still_unlocked'",
    classifyLockState({ locked_at: null, game_date: "2026-06-03T19:01:00.000Z" }, NOW) === "still_unlocked"
  );
  check(
    "game_date in 5 hours → 'still_unlocked'",
    classifyLockState({ locked_at: null, game_date: "2026-06-03T23:00:00.000Z" }, NOW) === "still_unlocked"
  );
  check(
    "game_date tomorrow → 'still_unlocked'",
    classifyLockState({ locked_at: null, game_date: "2026-06-04T01:00:00.000Z" }, NOW) === "still_unlocked"
  );
}

// ──────────────────────────────────────────────────────────────────────
// isLocked
// ──────────────────────────────────────────────────────────────────────

async function testIsLocked() {
  section("isLocked");
  check("locked_at non-null → true", isLocked({ locked_at: "2026-06-03T17:00:00.000Z" }));
  check("locked_at null → false", !isLocked({ locked_at: null }));
  check("locked_at undefined → false", !isLocked({ locked_at: undefined }));
}

// ──────────────────────────────────────────────────────────────────────
// computeLocksAt
// ──────────────────────────────────────────────────────────────────────

async function testComputeLocksAt() {
  section("computeLocksAt");
  check(
    "subtracts 60 min from game_date (default window)",
    computeLocksAt("2026-06-03T19:00:00.000Z") === "2026-06-03T18:00:00.000Z"
  );
  check(
    "subtracts custom window when provided",
    computeLocksAt("2026-06-03T19:00:00.000Z", 30) === "2026-06-03T18:30:00.000Z"
  );
  check("null game_date → null", computeLocksAt(null) === null);
  check("undefined game_date → null", computeLocksAt(undefined) === null);
  check("invalid game_date string → null", computeLocksAt("not-a-date") === null);
  check(
    "round-trip via Date — returns ISO 8601 UTC",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
      computeLocksAt("2026-06-03T19:00:00.000Z") ?? ""
    )
  );
}

// ──────────────────────────────────────────────────────────────────────
// partitionByLockState
// ──────────────────────────────────────────────────────────────────────

async function testPartition() {
  section("partitionByLockState — mixed slate");
  type Game = LockCandidate & { id: number };
  const games: Game[] = [
    { id: 1, locked_at: "2026-06-03T17:00:00.000Z", game_date: "2026-06-03T19:00:00.000Z" }, // locked
    { id: 2, locked_at: null, game_date: "2026-06-03T18:30:00.000Z" }, // entering_lock
    { id: 3, locked_at: null, game_date: "2026-06-04T02:00:00.000Z" }, // still_unlocked
    { id: 4, locked_at: null, game_date: "2026-06-03T17:00:00.000Z" }, // already_started
    { id: 5, locked_at: null, game_date: "2026-06-03T18:45:00.000Z" }, // entering_lock
    { id: 6, locked_at: null, game_date: null }, // still_unlocked (no game_date)
  ];
  const result = partitionByLockState(games, NOW);

  check("partition includes 1 locked game", result.locked.length === 1);
  check("locked game is id=1", result.locked[0]?.id === 1);

  check("partition includes 2 entering_lock games", result.entering_lock.length === 2);
  check(
    "entering_lock preserves input order (id=2 then id=5)",
    result.entering_lock[0]?.id === 2 && result.entering_lock[1]?.id === 5
  );

  check("partition includes 2 still_unlocked games", result.still_unlocked.length === 2);
  check(
    "still_unlocked preserves input order (id=3 then id=6)",
    result.still_unlocked[0]?.id === 3 && result.still_unlocked[1]?.id === 6
  );

  check("partition includes 1 already_started game", result.already_started.length === 1);
  check("already_started game is id=4", result.already_started[0]?.id === 4);

  check(
    "all input games appear exactly once across partitions (no duplicates, no drops)",
    result.locked.length +
      result.entering_lock.length +
      result.still_unlocked.length +
      result.already_started.length === games.length
  );
}

// ──────────────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase 4.2.B — lockState pure unit tests");
  console.log("=======================================");

  await testClassify();
  await testIsLocked();
  await testComputeLocksAt();
  await testPartition();

  console.log();
  console.log("=======================================");
  console.log(`Total: ${pass + fail}  pass: ${pass}  fail: ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
