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
import { resolveRecordForGrading, shouldUpsertGrade } from "../lib/services/predictionGradingService";
import { resolveScoreIngestNextScores } from "../lib/services/scoreIngestService";
import { readFileSync } from "node:fs";

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
check("existing Toss-Up void + now-actionable FI pending → allowed", shouldUpsertGrade({
  existingResult: "void",
  existingNotes: "non-actionable: toss-up (no side) — FI-only, not tracked",
  newResult: "pending",
  record: { market: "first_inning", side: "under", no_bet: false } as never,
}));
check("existing win + new loss → allowed (re-grade)", shouldUpsertGrade({ existingResult: "win", newResult: "loss" }));
check("existing push + new push → allowed (no-op)", shouldUpsertGrade({ existingResult: "push", newResult: "push" }));
check("undefined existing → upsert allowed", shouldUpsertGrade({ existingResult: undefined, newResult: "win" }));

const gradingSource = readFileSync(new URL("../lib/services/predictionGradingService.ts", import.meta.url), "utf8");
const trackingCronSource = readFileSync(new URL("../app/api/cron/tracking-refresh/route.ts", import.meta.url), "utf8");
check(
  "MLB grading excludes records that never reached the persisted lock boundary",
  gradingSource.includes('if (sport === "mlb") recordsQuery = recordsQuery.not("locked_at", "is", null)'),
);
check(
  "successful grade writes immediately invalidate the member Tracking aggregate",
  trackingCronSource.includes('revalidateTag("member-tracking-aggregate", { expire: 0 })') &&
    trackingCronSource.includes("summary.totals.grades_upserted > 0"),
);

console.log("\n━━━ immutable FI grading substrate ━━━");
{
  const restored = resolveRecordForGrading({
    market: "first_inning",
    locked_at: "2026-07-17T21:07:21.995Z",
    pick: "Toss-Up",
    side: null,
    prediction_type: "toss_up",
    no_bet: true,
    held: true,
    play_grade: "held",
    best_angle: false,
    confidence: 52,
    line_value: 0.5,
    odds_american: null,
    snapshot_json: { member_facing_at_lock: {
      pick: "NRFI", side: "under", no_bet: false, play_grade: "best_angle",
      confidence: 59, line_value: 0.5, odds_american: -121,
    } },
  } as never);
  check(
    "locked actionable FI snapshot overrides a contradictory Toss-Up row",
    restored.pick === "NRFI" && restored.side === "under" && restored.no_bet === false &&
      restored.held === false && restored.play_grade === "best_angle" && restored.odds_american === -121,
  );
}
{
  const tossUp = {
    market: "first_inning", locked_at: "2026-07-17T21:07:21.995Z", pick: "Toss-Up",
    side: null, prediction_type: "toss_up", no_bet: true, held: true,
    snapshot_json: { member_facing_at_lock: { pick: "Toss-Up", side: null, no_bet: true } },
  } as never;
  check("genuine locked FI Toss-Up remains non-actionable", resolveRecordForGrading(tossUp) === tossUp);
}

// ── MLB final score preservation ─────────────────────────────────
console.log("\n━━━ score ingest MLB final-score preservation ━━━");
{
  const next = resolveScoreIngestNextScores({
    sport: "mlb",
    currentStatus: "STATUS_FINAL",
    currentHomeScore: 7,
    currentAwayScore: 6,
    providerHomeScore: 3,
    providerAwayScore: 2,
  });
  check(
    "MLB Stats final score already present → BDL cannot overwrite it",
    next.home_score === 7 && next.away_score === 6 && next.preservedMlbStatsFinalScore,
  );
}
{
  const next = resolveScoreIngestNextScores({
    sport: "mlb",
    currentStatus: "STATUS_IN_PROGRESS",
    currentHomeScore: null,
    currentAwayScore: null,
    providerHomeScore: 3,
    providerAwayScore: 2,
  });
  check(
    "MLB missing scores → provider can fill scores",
    next.home_score === 3 && next.away_score === 2 && !next.preservedMlbStatsFinalScore,
  );
}
{
  const next = resolveScoreIngestNextScores({
    sport: "nba",
    currentStatus: "STATUS_FINAL",
    currentHomeScore: 101,
    currentAwayScore: 99,
    providerHomeScore: 102,
    providerAwayScore: 98,
  });
  check(
    "non-MLB sports keep provider-driven final-score updates",
    next.home_score === 102 && next.away_score === 98 && !next.preservedMlbStatsFinalScore,
  );
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All tracking refresh helper tests passed.");
