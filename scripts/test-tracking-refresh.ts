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
import {
  selectStalePendingRepairDates,
  TRACKING_SETTLEMENT_CONTRACT_VERSION,
} from "../lib/services/trackingSettlementRepairService";
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

check(
  "settlement repair contract is versioned",
  TRACKING_SETTLEMENT_CONTRACT_VERSION ===
    "tracking_settlement_v2_bounded_stale_pending_repair_2026_08_16",
);

{
  const selected = selectStalePendingRepairDates({
    beforeDate: "2026-08-15",
    records: [
      { id: 1, game_id: 11, slate_date: "2026-07-01", market: "spread" },
      { id: 2, game_id: 12, slate_date: "2026-07-02", market: "total" },
      { id: 3, game_id: 13, slate_date: "2026-08-15", market: "moneyline" },
      { id: 4, game_id: 14, slate_date: "2026-07-03", market: "first_inning" },
    ],
    games: [
      { id: 11, status: "final", home_score: 85, away_score: 80, first_inning_runs: null },
      { id: 12, status: "scheduled", home_score: null, away_score: null, first_inning_runs: null },
      { id: 13, status: "final", home_score: 5, away_score: 3, first_inning_runs: null },
      { id: 14, status: "final", home_score: 4, away_score: 2, first_inning_runs: null },
    ],
  });
  check("only historical terminal candidates are selected", JSON.stringify(selected.dates) === JSON.stringify(["2026-07-01"]));
  check("final first-inning rows wait for inning data", selected.eligibleRecords === 1);
}

{
  const selected = selectStalePendingRepairDates({
    beforeDate: "2026-08-15",
    maxDates: 3,
    records: [1, 2, 3, 4].map((day) => ({
      id: day,
      game_id: day,
      slate_date: `2026-07-0${day}`,
      market: "moneyline",
    })),
    games: [1, 2, 3, 4].map((id) => ({
      id,
      status: "STATUS_FINAL",
      home_score: 1,
      away_score: 0,
      first_inning_runs: null,
    })),
  });
  check("repair work is capped and oldest-first", JSON.stringify(selected.dates) === JSON.stringify(["2026-07-01", "2026-07-02", "2026-07-03"]));
}
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
const healthCronSource = readFileSync(new URL("../app/api/cron/daily-edge-data-health/route.ts", import.meta.url), "utf8");
const soccerCronSource = readFileSync(new URL("../app/api/cron/soccer-daily-refresh/route.ts", import.meta.url), "utf8");
const dailyEdgeShellSource = readFileSync(new URL("../app/lab/components/daily-edge/DailyEdgeShell.tsx", import.meta.url), "utf8");
const vercelConfig = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
  crons?: Array<{ path?: string; schedule?: string }>;
};
check(
  "MLB grading excludes records that never reached the persisted lock boundary",
  gradingSource.includes('if (sport === "mlb") recordsQuery = recordsQuery.not("locked_at", "is", null)'),
);
check(
  "successful grade writes immediately invalidate the member Tracking aggregate",
  trackingCronSource.includes('revalidateTag("member-tracking-aggregate", { expire: 0 })') &&
    trackingCronSource.includes("summary.totals.grades_upserted > 0"),
);
check(
  "World Cup provider/model refresh is unscheduled during offseason",
  !(vercelConfig.crons ?? []).some((cron) => cron.path === "/api/cron/soccer-daily-refresh"),
);
check(
  "World Cup route is preserved behind its gate for future reactivation",
  soccerCronSource.includes('const CRON_ENV = "SOCCER_CRON_ENABLED"') &&
    soccerCronSource.includes("OFF-SEASON (2026-07-20)"),
);
check(
  "hourly tracking excludes soccer by default but keeps the manual override",
  trackingCronSource.includes('const DEFAULT_SPORTS: Sport[] = ["mlb", "nba", "nhl", "wnba"]') &&
    trackingCronSource.includes("overrideSport") && trackingCronSource.includes("[overrideSport]"),
);
check(
  "hourly tracking runs outside the :05 slate-cycle and :13 lineup-watch lease windows",
  (vercelConfig.crons ?? []).some(
    (cron) =>
      cron.path === "/api/cron/tracking-refresh" &&
      cron.schedule === "33 * * * *",
  ),
);
check(
  "daily health excludes soccer by default but keeps explicit sports override",
  healthCronSource.includes('if (!raw) return ["mlb", "wnba"]') &&
    healthCronSource.includes('url.searchParams.get("sports")'),
);
check(
  "Daily Edge labels World Cup as offseason while keeping history accessible",
  dailyEdgeShellSource.includes('{ key: "soccer", label: "World Cup", live: true, inSeason: false }') &&
    dailyEdgeShellSource.includes("const isActiveInSeason = isActive && s.inSeason === true") &&
    dailyEdgeShellSource.includes('s.live && !s.inSeason ? "offseason model"'),
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
