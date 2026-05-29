/**
 * Phase 4A — pure unit tests for T-60 game selection.
 *
 * No DB, no env. Runs via:
 *   npx tsx scripts/test-automodel-t60-selection.ts
 */

import {
  T60_WINDOW_MINUTES_DEFAULT,
  isInT60Window,
  selectGamesInT60Window,
  type T60Candidate,
} from "../lib/automodel/t60Selection";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
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

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

// Fixed reference time for all tests so they're deterministic.
const NOW = new Date("2026-05-29T18:00:00.000Z");
const minutesFromNow = (m: number) =>
  new Date(NOW.getTime() + m * 60 * 1000).toISOString();

// ─── Constants ─────────────────────────────────────────────────────────
section("T60_WINDOW_MINUTES_DEFAULT");

check(
  `T60_WINDOW_MINUTES_DEFAULT === 60 (Daniel's approved default)`,
  T60_WINDOW_MINUTES_DEFAULT === 60
);

// ─── isInT60Window — in/outside/boundary ──────────────────────────────
section("isInT60Window — window membership");

check(
  "30 minutes in future → in window (default 60)",
  isInT60Window(minutesFromNow(30), NOW) === true
);
check(
  "59 minutes in future → in window",
  isInT60Window(minutesFromNow(59), NOW) === true
);
check(
  "exactly 60 minutes in future → in window (boundary inclusive)",
  isInT60Window(minutesFromNow(60), NOW) === true
);
check(
  "61 minutes in future → outside window",
  isInT60Window(minutesFromNow(61), NOW) === false
);
check(
  "120 minutes in future → outside",
  isInT60Window(minutesFromNow(120), NOW) === false
);

// ─── isInT60Window — already-started handling ──────────────────────────
section("isInT60Window — already-started games default to excluded");

check(
  "10 minutes in PAST → excluded by default",
  isInT60Window(minutesFromNow(-10), NOW) === false
);
check(
  "10 minutes in past with include_started=true → included",
  isInT60Window(minutesFromNow(-10), NOW, 60, true) === true
);
check(
  "5 minutes in past with include_started=true → included",
  isInT60Window(minutesFromNow(-5), NOW, 60, true) === true
);
check(
  "1 minute in past with include_started=false → excluded",
  isInT60Window(minutesFromNow(-1), NOW, 60, false) === false
);

// ─── isInT60Window — null/invalid handling ────────────────────────────
section("isInT60Window — null/undefined/invalid → false");

check(
  "null start_time → false",
  isInT60Window(null, NOW) === false
);
check(
  "undefined start_time → false",
  isInT60Window(undefined, NOW) === false
);
check(
  "non-ISO garbage → false",
  isInT60Window("not a date", NOW) === false
);
check(
  "empty string → false",
  isInT60Window("", NOW) === false
);

// ─── isInT60Window — custom window length ──────────────────────────────
section("isInT60Window — custom window_minutes");

check(
  "75-minute window: 70 min ahead → in window",
  isInT60Window(minutesFromNow(70), NOW, 75) === true
);
check(
  "75-minute window: 76 min ahead → outside",
  isInT60Window(minutesFromNow(76), NOW, 75) === false
);
check(
  "30-minute window: 31 min ahead → outside",
  isInT60Window(minutesFromNow(31), NOW, 30) === false
);
check(
  "30-minute window: 29 min ahead → in",
  isInT60Window(minutesFromNow(29), NOW, 30) === true
);

// ─── isInT60Window — UTC / timezone safety ────────────────────────────
section("isInT60Window — UTC absolute timestamps (no local-tz drift)");

// 2026-05-29T18:30:00.000Z is 30 minutes after NOW (which is 18:00:00Z)
check(
  "explicit UTC ISO 30 min ahead → in window",
  isInT60Window("2026-05-29T18:30:00.000Z", NOW) === true
);

// Same instant expressed with a +02:00 offset (Berlin DST) — equivalent.
check(
  "same instant via +02:00 offset → in window (timezone-agnostic)",
  isInT60Window("2026-05-29T20:30:00.000+02:00", NOW) === true
);

// ─── selectGamesInT60Window — partitioning ────────────────────────────
section("selectGamesInT60Window — partition + skip reasons");

const candidates: T60Candidate[] = [
  { game_external_id: 1, start_time: minutesFromNow(30) },   // in window
  { game_external_id: 2, start_time: minutesFromNow(120) },  // outside
  { game_external_id: 3, start_time: minutesFromNow(-10) },  // already started
  { game_external_id: 4, start_time: null },                 // missing
  { game_external_id: 5, start_time: "garbage" },            // invalid
  { game_external_id: 6, start_time: minutesFromNow(59) },   // in window
];

const result = selectGamesInT60Window(candidates, NOW);

check(
  `selected has 2 games (game 1 + game 6) — got ${result.selected.length}`,
  result.selected.length === 2
);
check(
  "selected[0].game_external_id === 1 (input order preserved)",
  result.selected[0]?.game_external_id === 1
);
check(
  "selected[1].game_external_id === 6",
  result.selected[1]?.game_external_id === 6
);
check(
  "selected start_time is non-null string",
  typeof result.selected[0]?.start_time === "string"
);

check(
  `skipped has 4 games (2, 3, 4, 5) — got ${result.skipped.length}`,
  result.skipped.length === 4
);

const skipByGame = new Map(result.skipped.map((s) => [s.game_external_id, s.reason]));
check(
  "game 2 skipped: 'outside window'",
  skipByGame.get(2) === "outside window"
);
check(
  "game 3 skipped: 'already started'",
  skipByGame.get(3) === "already started"
);
check(
  "game 4 skipped: 'missing start_time'",
  skipByGame.get(4) === "missing start_time"
);
check(
  "game 5 skipped: 'invalid start_time'",
  skipByGame.get(5) === "invalid start_time"
);

// ─── selectGamesInT60Window — include_started escape hatch ────────────
section("selectGamesInT60Window — include_started=true");

const startedCandidates: T60Candidate[] = [
  { game_external_id: 10, start_time: minutesFromNow(-5) },   // started 5 min ago
  { game_external_id: 11, start_time: minutesFromNow(30) },   // in window
  { game_external_id: 12, start_time: minutesFromNow(120) },  // outside
];

const includeStartedResult = selectGamesInT60Window(
  startedCandidates,
  NOW,
  60,
  true
);

check(
  `include_started=true: selected has 2 games (10 + 11) — got ${includeStartedResult.selected.length}`,
  includeStartedResult.selected.length === 2
);
check(
  "include_started=true: game 12 still skipped (outside window)",
  includeStartedResult.skipped.length === 1 &&
    includeStartedResult.skipped[0]?.game_external_id === 12
);

// ─── selectGamesInT60Window — empty input ──────────────────────────────
section("selectGamesInT60Window — empty input → empty output");

const emptyResult = selectGamesInT60Window([], NOW);
check(
  "empty candidates: selected.length === 0",
  emptyResult.selected.length === 0
);
check(
  "empty candidates: skipped.length === 0",
  emptyResult.skipped.length === 0
);

// ─── selectGamesInT60Window — custom window ────────────────────────────
section("selectGamesInT60Window — custom window length");

const customCandidates: T60Candidate[] = [
  { game_external_id: 20, start_time: minutesFromNow(45) },
  { game_external_id: 21, start_time: minutesFromNow(80) },
];
const customResult = selectGamesInT60Window(customCandidates, NOW, 90);

check(
  "90-min window: both games selected",
  customResult.selected.length === 2 && customResult.skipped.length === 0
);

const tightResult = selectGamesInT60Window(customCandidates, NOW, 30);
check(
  "30-min window: only game 20 (45 min) skipped, game 21 (80 min) skipped",
  tightResult.selected.length === 0 && tightResult.skipped.length === 2
);

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All T-60 selection tests passed.`);
