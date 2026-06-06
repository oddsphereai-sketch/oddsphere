/**
 * Push 4c — tests for tracking-refresh service helpers.
 *
 * Pure / fixture-only — no DB, no network. Covers:
 *   - computeRefreshDates (date math)
 *   - shouldUpsertGrade (regression guard)
 *
 * The full runTrackingRefresh flow is integration-tested by the
 * live cron dry-run after deploy.
 */

import { computeRefreshDates } from "../lib/services/trackingRefreshService";
import { shouldUpsertGrade } from "../lib/services/predictionGradingService";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── computeRefreshDates ──────────────────────────────────────────
console.log("━━━ computeRefreshDates (yesterday/today/tomorrow) ━━━");
{
  const now = new Date("2026-06-06T18:00:00Z");
  const dates = computeRefreshDates(now);
  check("returns 3 dates", dates.length === 3);
  check("dates[0] = yesterday 2026-06-05", dates[0] === "2026-06-05");
  check("dates[1] = today 2026-06-06", dates[1] === "2026-06-06");
  check("dates[2] = tomorrow 2026-06-07", dates[2] === "2026-06-07");
}
{
  // Month boundary
  const now = new Date("2026-07-01T01:00:00Z");
  const dates = computeRefreshDates(now);
  check("month boundary: 06-30 / 07-01 / 07-02", dates[0] === "2026-06-30" && dates[1] === "2026-07-01" && dates[2] === "2026-07-02");
}
{
  // Year boundary
  const now = new Date("2027-01-01T00:30:00Z");
  const dates = computeRefreshDates(now);
  check("year boundary: 2026-12-31 / 2027-01-01 / 2027-01-02", dates[0] === "2026-12-31" && dates[1] === "2027-01-01" && dates[2] === "2027-01-02");
}
{
  // Lookback/lookahead overrides
  const now = new Date("2026-06-06T18:00:00Z");
  const dates = computeRefreshDates(now, { lookbackDays: 0, lookaheadDays: 0 });
  check("lookback=0 lookahead=0 → single date (today only)", dates.length === 1 && dates[0] === "2026-06-06");
}
{
  const now = new Date("2026-06-06T18:00:00Z");
  const dates = computeRefreshDates(now, { lookbackDays: 2, lookaheadDays: 0 });
  check("lookback=2 lookahead=0 → 3 dates (no future)", dates.length === 3 && dates[2] === "2026-06-06");
}

// ── shouldUpsertGrade (regression guard) ─────────────────────────
console.log("\n━━━ shouldUpsertGrade ━━━");
check("no existing grade → upsert allowed", shouldUpsertGrade({ existingResult: null, newResult: "pending" }));
check("no existing grade → upsert allowed (win)", shouldUpsertGrade({ existingResult: null, newResult: "win" }));
check("existing pending → upsert allowed (pending)", shouldUpsertGrade({ existingResult: "pending", newResult: "pending" }));
check("existing pending → upsert allowed (win)", shouldUpsertGrade({ existingResult: "pending", newResult: "win" }));
check("existing win + new pending → REJECTED (regression guard)", !shouldUpsertGrade({ existingResult: "win", newResult: "pending" }));
check("existing loss + new pending → REJECTED", !shouldUpsertGrade({ existingResult: "loss", newResult: "pending" }));
check("existing void + new pending → REJECTED", !shouldUpsertGrade({ existingResult: "void", newResult: "pending" }));
check("existing win + new loss → allowed (re-grade)", shouldUpsertGrade({ existingResult: "win", newResult: "loss" }));
check("existing push + new push → allowed (no-op)", shouldUpsertGrade({ existingResult: "push", newResult: "push" }));
check("undefined existing → upsert allowed", shouldUpsertGrade({ existingResult: undefined, newResult: "win" }));

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All tracking refresh helper tests passed.");
