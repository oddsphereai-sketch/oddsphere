import { assessMlbLockCoherence } from "../lib/services/mlbLockCoherence";

const expected = [{
  game_id: 31215,
  market: "moneyline",
  pick: "away",
  side: "away",
  odds_american: 104,
  confidence: 56,
  play_grade: "market_aligned",
  best_angle: false,
  no_bet: false,
}];

const coherent = assessMlbLockCoherence({ gameIds: [31215], expectedRows: expected, storedRows: expected });
if (coherent.coherentGameIds[0] !== 31215 || coherent.errors.length !== 0) {
  throw new Error("FAIL: matching model/member rows should pass the lock gate");
}

const stale = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: expected,
  storedRows: [{ ...expected[0], pick: "home", side: "home", odds_american: -125, no_bet: true }],
});
if (stale.blockedGameIds[0] !== 31215 || stale.errors.length < 3) {
  throw new Error("FAIL: stale member row should block the game from locking");
}

const missing = assessMlbLockCoherence({ gameIds: [31215], expectedRows: expected, storedRows: [] });
if (missing.blockedGameIds[0] !== 31215 || !missing.errors.some((error) => error.includes("missing stored markets"))) {
  throw new Error("FAIL: missing member rows should block the game from locking");
}

const heldFirstInning = {
  ...expected[0],
  market: "first_inning",
  pick: "Toss-Up",
  side: null,
  odds_american: null,
  confidence: null,
  play_grade: null,
  best_angle: false,
  no_bet: true,
};
const safeHeldExtra = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: expected,
  storedRows: [...expected, heldFirstInning],
});
if (safeHeldExtra.coherentGameIds[0] !== 31215 || safeHeldExtra.errors.length !== 0) {
  throw new Error("FAIL: a held first-inning Toss-Up should not block coherent ML/total rows from locking");
}

const actionableExtra = assessMlbLockCoherence({
  gameIds: [31215],
  expectedRows: expected,
  storedRows: [...expected, { ...heldFirstInning, pick: "NRFI", side: "nrfi", no_bet: false }],
});
if (actionableExtra.blockedGameIds[0] !== 31215 || !actionableExtra.errors.some((error) => error.includes("unexpected stored market"))) {
  throw new Error("FAIL: an extra actionable first-inning row must still block the lock");
}

console.log("  ✓ matching final model/member rows may lock");
console.log("  ✓ stale pick, price, or actionability blocks lock");
console.log("  ✓ missing member records block lock");
console.log("  ✓ held first-inning Toss-Up does not block coherent ML/total locks");
console.log("  ✓ extra actionable first-inning records remain fail-closed");
