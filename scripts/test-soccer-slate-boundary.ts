/**
 * Deterministic regression guard for the midnight-ET slate-boundary fix
 * (2026-06-16).
 *
 * Bug: a World Cup fixture kicking off in the small hours of the NEXT ET
 * day (e.g. AUT vs JOR at 04:00 UTC = 00:00 ET) is assigned slate_date =
 * D+1 by the ET-anchored slate convention. The soccer Daily Edge adapter
 * read the board with `.eq("slate_date", requestedDate)`, so the game
 * silently vanished from the day-D board the night it was actually played.
 *
 * Fix: the adapter widens the read to include D+1 fixtures that kick off
 * before 5:00 AM ET (CARRYOVER_ET_MINUTES_CUTOFF) as "late tonight"
 * carryovers. slate_date / locking / tracking / grading of those rows are
 * UNCHANGED — only the read is widened.
 *
 * These assertions pin the pure eligibility predicate so the bug cannot
 * silently return. No DB is queried.
 *
 * Run: npx tsx scripts/test-soccer-slate-boundary.ts
 */

import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

let failures = 0;
function check(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.error(`✗ ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

async function main() {
  const { qualifiesForSoccerBoard } = await import(
    "../lib/services/soccer/buildSoccerDailyEdgeAdapted"
  );

  const D = "2026-06-16";
  const NEXT = "2026-06-17";

  // 1. Native: a game whose slate_date IS the requested day always shows,
  //    regardless of kickoff time.
  check("native slate, 3pm ET", qualifiesForSoccerBoard(D, { slate_date: D }, NEXT, 15 * 60), true);
  check("native slate, 9pm ET", qualifiesForSoccerBoard(D, { slate_date: D }, NEXT, 21 * 60), true);
  check("native slate, midnight ET", qualifiesForSoccerBoard(D, { slate_date: D }, NEXT, 0), true);

  // 2. THE BUG: next-day fixture kicking off at 00:00 ET (AUT vs JOR) is a
  //    "late tonight" carryover — it MUST appear on the day-D board.
  check("D+1 @ 00:00 ET (midnight) → carryover shows", qualifiesForSoccerBoard(D, { slate_date: NEXT }, NEXT, 0), true);
  check("D+1 @ 04:59 ET → carryover shows", qualifiesForSoccerBoard(D, { slate_date: NEXT }, NEXT, 4 * 60 + 59), true);

  // 3. Cutoff boundary: 5:00 AM ET is genuinely "next morning", NOT tonight.
  check("D+1 @ 05:00 ET → NOT carryover (boundary)", qualifiesForSoccerBoard(D, { slate_date: NEXT }, NEXT, 5 * 60), false);
  check("D+1 @ 12:00 ET (noon) → NOT carryover", qualifiesForSoccerBoard(D, { slate_date: NEXT }, NEXT, 12 * 60), false);
  check("D+1 @ 21:00 ET (evening) → NOT carryover", qualifiesForSoccerBoard(D, { slate_date: NEXT }, NEXT, 21 * 60), false);

  // 4. A game two days out never leaks onto today's board (slate != D and
  //    != NEXT). Predicate only knows D and NEXT; an unrelated slate_date
  //    fails both branches.
  check("D+2 slate → never shows on day D", qualifiesForSoccerBoard(D, { slate_date: "2026-06-18" }, NEXT, 0), false);

  // 5. Symmetry: when *viewing* D+1, the AUT vs JOR game is native there too
  //    (it appears on both the D carryover board and its own D+1 board — by
  //    design; they are separate API requests for separate dates).
  check("viewing D+1: AUT vs JOR native", qualifiesForSoccerBoard(NEXT, { slate_date: NEXT }, "2026-06-18", 0), true);

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
