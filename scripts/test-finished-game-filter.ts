/**
 * Unit test for isFinishedGame — the Daily Edge "drop completed games" guard.
 * Run: npx tsx scripts/test-finished-game-filter.ts
 */
import { isFinishedGame } from "../lib/games/gameStatus";

let failed = 0;
function check(input: string | null | undefined, expected: boolean) {
  const got = isFinishedGame(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} isFinishedGame(${JSON.stringify(input)}) = ${got} (want ${expected})`);
}

// FINISHED — must be dropped from the Daily Edge.
check("final", true);
check("STATUS_FINAL", true);
check("Final", true);
check("completed", true);
check("STATUS_COMPLETED", true);
check("closed", true);
check("full-time", true);
check("full_time", true);
check("fulltime", true);
check("FT", true);

// NOT finished — must stay on the card.
check("scheduled", false);
check("STATUS_SCHEDULED", false);
check("in_progress", false);
check("STATUS_IN_PROGRESS", false);
check("live", false);
check("suspended", false); // SF@ATL resumes today — still actionable
check("postponed", false);
check("delayed", false);
check(null, false);
check(undefined, false);
check("", false);

if (failed > 0) {
  console.error(`\n❌ ${failed} case(s) failed.`);
  process.exit(1);
}
console.log("\n✅ All isFinishedGame tests passed.");
