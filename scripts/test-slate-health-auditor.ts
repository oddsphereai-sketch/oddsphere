/**
 * Unit tests for the slate-health auditor's pure classification logic.
 * The DB-coupled checks are validated by the prod dry-run; this covers the
 * branching that decides severity + autofix class + lookahead windows.
 */

import { __TEST__ } from "../lib/services/audit/slateHealthAuditor";

const { classifyNoPredictionReason, slatesForSport, addDays, corePredictionSubstrateIssues } = __TEST__;

let pass = 0, fail = 0;
function assert(c: boolean, m?: string): void { if (!c) throw new Error(`Assertion failed: ${m ?? ""}`); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-slate-health-auditor.ts");
console.log("─".repeat(60));

const now = 1_000_000_000_000;

test("upcoming soccer game with odds + 0 preds → error, auto_safe (rerun writer)", () => {
  const r = classifyNoPredictionReason({ status: "scheduled", kickoffMs: now + 3_600_000, nowMs: now, slateDate: "2026-06-14", gameSport: "soccer" });
  assert(r.severity === "error", r.severity);
  assert(r.autofix === "auto_safe", r.autofix);
  assert((r.action ?? "").includes("writeSoccerPredictionRecords"), r.action ?? "");
});

test("upcoming NBA game with odds + 0 preds → error, hold (no auto-fix wired)", () => {
  const r = classifyNoPredictionReason({ status: "scheduled", kickoffMs: now + 3_600_000, nowMs: now, slateDate: "2026-06-14", gameSport: "nba" });
  assert(r.severity === "error", r.severity);
  assert(r.autofix === "hold", r.autofix);
});

test("already-kicked-off game → error, manual (too late)", () => {
  const r = classifyNoPredictionReason({ status: "scheduled", kickoffMs: now - 60_000, nowMs: now, slateDate: "2026-06-14", gameSport: "soccer" });
  assert(r.severity === "error", r.severity);
  assert(r.autofix === "manual", r.autofix);
  assert((r.reason).includes("kickoff already passed"), r.reason);
});

test("final game → error, manual, reason notes final", () => {
  const r = classifyNoPredictionReason({ status: "STATUS_FINAL", kickoffMs: now - 1, nowMs: now, slateDate: "2026-06-14", gameSport: "soccer" });
  assert(r.autofix === "manual" && r.reason.includes("final"), JSON.stringify(r));
});

test("soccer gets a 3-day lookahead window (yesterday, today, tomorrow)", () => {
  const s = slatesForSport("soccer", "2026-06-14");
  assert(s.length === 3 && s[0] === "2026-06-13" && s[1] === "2026-06-14" && s[2] === "2026-06-15", s.join(","));
});

test("non-soccer sports audit yesterday + today only", () => {
  const s = slatesForSport("mlb", "2026-06-14");
  assert(s.length === 2 && s[0] === "2026-06-13" && s[1] === "2026-06-14", s.join(","));
});

test("addDays handles month boundary", () => {
  assert(addDays("2026-06-30", 1) === "2026-07-01", addDays("2026-06-30", 1));
  assert(addDays("2026-06-14", -1) === "2026-06-13", addDays("2026-06-14", -1));
});

test("MLB moneyline core substrate flags missing price/probability/edge", () => {
  const issues = corePredictionSubstrateIssues({
    sport: "mlb",
    market: "moneyline",
    pick: "BOS",
    held: false,
    odds_american: null,
    model_probability: null,
    market_probability: null,
    edge: null,
  });
  assert(issues.includes("odds_american missing/non-finite"), issues.join(","));
  assert(issues.includes("model_probability missing/non-finite"), issues.join(","));
  assert(issues.includes("market_probability missing/non-finite"), issues.join(","));
  assert(issues.includes("edge missing/non-finite"), issues.join(","));
});

test("MLB total core substrate passes when price/probability/edge are present", () => {
  const issues = corePredictionSubstrateIssues({
    sport: "mlb",
    market: "total",
    pick: "Over",
    held: false,
    odds_american: -110,
    model_probability: 0.57,
    market_probability: 0.524,
    edge: 4.6,
  });
  assert(issues.length === 0, issues.join(","));
});

test("core substrate check ignores held rows and FI rows", () => {
  const heldIssues = corePredictionSubstrateIssues({
    sport: "mlb",
    market: "moneyline",
    pick: "BOS",
    held: true,
    odds_american: null,
    model_probability: null,
    market_probability: null,
    edge: null,
  });
  const fiIssues = corePredictionSubstrateIssues({
    sport: "mlb",
    market: "first_inning",
    pick: "Toss-Up",
    held: false,
    odds_american: null,
    model_probability: null,
    market_probability: null,
    edge: null,
  });
  assert(heldIssues.length === 0, heldIssues.join(","));
  assert(fiIssues.length === 0, fiIssues.join(","));
});

console.log("─".repeat(60));
console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
