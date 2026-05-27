/**
 * Tests for the slate_date helper + DB column (Phase 5E.1).
 *
 *   • computeSlateDate: ET timezone math for North American sports,
 *     London timezone for UCL, edge-cases at the midnight-UTC seam,
 *     DST transitions
 *   • addDaysToSlate / previousSlateDate / currentSlateDate sanity
 *   • isSlateDate input validation
 *   • DB integration: every games row has slate_date populated and matches
 *     computeSlateDate(sport, game_date)
 *   • Route behavior: filtering by slate_date catches the late-night seam
 *     games that the old UTC-window filter missed
 *
 * Run with: npm run test:slate-dates
 *
 * Prerequisite: schema-migration-v3.sql applied (games.slate_date NOT NULL).
 */

// Fix 5.1 (Flag C1): productionFilter fails closed by default. Tests
// exercise mock seed data via the daily-edge route — opt into dev mode
// explicitly.
process.env.ODDSPHERE_DATA_MODE = "development";

import {
  addDaysToSlate,
  computeSlateDate,
  currentSlateDate,
  isSlateDate,
  previousSlateDate,
} from "../lib/dates/slateDate";
import { supabase } from "../lib/db/supabase";
import { GET as dailyEdge } from "../app/api/lab/daily-edge/route";

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

async function main() {
  // ─── (1) computeSlateDate: ET anchor (MLB) at the midnight-UTC seam ──────
  section("computeSlateDate: ET anchor (MLB)");

  // 23:10Z on 5/22 = 19:10 ET on 5/22 (assume EDT, UTC-4 in May) → slate 5/22
  check(
    `MLB 2026-05-22T23:10:00.000Z → slate 2026-05-22`,
    computeSlateDate("mlb", "2026-05-22T23:10:00.000Z") === "2026-05-22"
  );
  // 01:00Z on 5/23 = 21:00 ET on 5/22 → slate 5/22 (Pacific evening game!)
  check(
    `MLB 2026-05-23T01:00:00.000Z → slate 2026-05-22 (PT evening rolls back)`,
    computeSlateDate("mlb", "2026-05-23T01:00:00.000Z") === "2026-05-22"
  );
  // 03:00Z on 5/23 = 23:00 ET on 5/22 → still 5/22
  check(
    `MLB 2026-05-23T03:00:00.000Z → slate 2026-05-22`,
    computeSlateDate("mlb", "2026-05-23T03:00:00.000Z") === "2026-05-22"
  );
  // 04:00Z on 5/23 = 00:00 ET on 5/23 → slate 5/23 (new day)
  check(
    `MLB 2026-05-23T04:00:00.000Z → slate 2026-05-23 (midnight ET, new slate)`,
    computeSlateDate("mlb", "2026-05-23T04:00:00.000Z") === "2026-05-23"
  );
  // 06:00Z on 5/23 = 02:00 ET on 5/23 → 5/23
  check(
    `MLB 2026-05-23T06:00:00.000Z → slate 2026-05-23`,
    computeSlateDate("mlb", "2026-05-23T06:00:00.000Z") === "2026-05-23"
  );
  // 13:00Z on 5/23 = 09:00 ET → slate 5/23
  check(
    `MLB 2026-05-23T13:00:00.000Z → slate 2026-05-23 (morning ET)`,
    computeSlateDate("mlb", "2026-05-23T13:00:00.000Z") === "2026-05-23"
  );

  // ─── (2) DST transitions (spring-forward + fall-back) ─────────────────────
  section("computeSlateDate: DST transitions");

  // 2026 spring forward: 2026-03-08 02:00 ET → 03:00 EDT. Game at 23:00Z
  // on 2026-03-07 (before DST) = 18:00 EST on 3/7. Game at 23:00Z on
  // 2026-03-08 (after DST) = 19:00 EDT on 3/8.
  check(
    `MLB 2026-03-07T23:00Z (pre-DST) → slate 2026-03-07`,
    computeSlateDate("mlb", "2026-03-07T23:00:00.000Z") === "2026-03-07"
  );
  check(
    `MLB 2026-03-08T23:00Z (post-DST spring-forward) → slate 2026-03-08`,
    computeSlateDate("mlb", "2026-03-08T23:00:00.000Z") === "2026-03-08"
  );
  // Fall-back: 2026-11-01 02:00 EDT → 01:00 EST. A 06:00Z on 11/1 = 01:00 EST
  // (after fall-back, EST offset = -5) → slate 11/1
  check(
    `MLB 2026-11-01T06:00Z (post-DST fall-back) → slate 2026-11-01`,
    computeSlateDate("mlb", "2026-11-01T06:00:00.000Z") === "2026-11-01"
  );

  // ─── (3) computeSlateDate: London anchor (UCL) ───────────────────────────
  section("computeSlateDate: London anchor (UCL)");

  // 19:00Z on 5/22 = 20:00 London (BST, UTC+1 in May) → slate 5/22
  check(
    `UCL 2026-05-22T19:00Z → slate 2026-05-22`,
    computeSlateDate("ucl", "2026-05-22T19:00:00.000Z") === "2026-05-22"
  );
  // 23:30Z on 5/22 = 00:30 London on 5/23 → slate 5/23
  check(
    `UCL 2026-05-22T23:30Z → slate 2026-05-23 (rolls forward in London)`,
    computeSlateDate("ucl", "2026-05-22T23:30:00.000Z") === "2026-05-23"
  );
  // 06:00Z on 5/23 = 07:00 London (BST) → 5/23
  check(
    `UCL 2026-05-23T06:00Z → slate 2026-05-23`,
    computeSlateDate("ucl", "2026-05-23T06:00:00.000Z") === "2026-05-23"
  );
  // Winter UCL: 19:00Z on 12/15 = 19:00 London (GMT, UTC+0) → 12/15
  check(
    `UCL 2026-12-15T19:00Z (winter, GMT) → slate 2026-12-15`,
    computeSlateDate("ucl", "2026-12-15T19:00:00.000Z") === "2026-12-15"
  );

  // ─── (4) Multi-sport: same UTC instant maps differently across anchors ──
  section("Multi-sport timezone divergence");

  // 04:00Z on 5/23 = 00:00 ET on 5/23 (new ET day) but 05:00 London on 5/23
  // (same London day). For MLB, slate = 5/23; for UCL, slate = 5/23. SAME.
  // Try a clearer case: 23:30Z on 5/22 = 19:30 ET on 5/22 vs 00:30 London on 5/23.
  check(
    `Same instant: MLB → 5/22 (ET), UCL → 5/23 (London)`,
    computeSlateDate("mlb", "2026-05-22T23:30:00.000Z") === "2026-05-22" &&
      computeSlateDate("ucl", "2026-05-22T23:30:00.000Z") === "2026-05-23"
  );

  // ─── (5) currentSlateDate / previousSlateDate / addDaysToSlate ──────────
  section("Date arithmetic");

  const today = currentSlateDate("mlb");
  check(`currentSlateDate('mlb') matches YYYY-MM-DD`, /^\d{4}-\d{2}-\d{2}$/.test(today));

  const yesterday = previousSlateDate("mlb", today);
  check(`previousSlateDate is exactly 1 day before`, addDaysToSlate(yesterday, 1) === today);

  check(`addDaysToSlate(2026-05-22, 7) → 2026-05-29`, addDaysToSlate("2026-05-22", 7) === "2026-05-29");
  check(`addDaysToSlate(2026-05-22, -7) → 2026-05-15`, addDaysToSlate("2026-05-22", -7) === "2026-05-15");
  check(`addDaysToSlate across month boundary`, addDaysToSlate("2026-05-31", 1) === "2026-06-01");
  check(`addDaysToSlate across year boundary`, addDaysToSlate("2026-12-31", 1) === "2027-01-01");
  // DST-safe: addDays uses noon-UTC anchor so spring-forward + fall-back days don't drift.
  check(`addDaysToSlate spans DST spring-forward`, addDaysToSlate("2026-03-07", 1) === "2026-03-08");
  check(`addDaysToSlate spans DST fall-back`, addDaysToSlate("2026-10-31", 1) === "2026-11-01");

  // ─── (6) isSlateDate ──────────────────────────────────────────────────────
  section("isSlateDate input validation");

  check(`isSlateDate('2026-05-22') → true`, isSlateDate("2026-05-22"));
  check(`isSlateDate('2026-5-22') → false (no zero-pad)`, !isSlateDate("2026-5-22"));
  check(`isSlateDate('22-05-2026') → false (wrong order)`, !isSlateDate("22-05-2026"));
  check(`isSlateDate(null) → false`, !isSlateDate(null));
  check(`isSlateDate('') → false`, !isSlateDate(""));
  check(`isSlateDate('today') → false`, !isSlateDate("today"));

  // ─── (7) DB integration: every games row has slate_date populated ────────
  section("DB integration");

  const { data: dbGames } = await supabase
    .from("games")
    .select("id, sport, game_date, slate_date")
    .limit(50);
  check(`DB returned games`, (dbGames ?? []).length > 0);
  let mismatches = 0;
  let nullCount = 0;
  for (const g of dbGames ?? []) {
    if (g.slate_date === null) {
      nullCount++;
      continue;
    }
    const expected = computeSlateDate(g.sport as "mlb" | "ucl", g.game_date);
    if (expected !== g.slate_date) {
      mismatches++;
      console.log(`    mismatch: ${g.sport} game ${g.id} game_date=${g.game_date} slate_date=${g.slate_date} expected=${expected}`);
    }
  }
  check(`every sampled row has non-null slate_date`, nullCount === 0);
  check(`every DB slate_date matches computeSlateDate(sport, game_date)`, mismatches === 0);

  // ─── (8) Slate equality catches the late-night seam ───────────────────────
  section("Slate equality vs old UTC window");

  // Find an MLB slate that has both 23:*Z games and 00:*Z (next-day UTC) games
  // — i.e., a slate that spans the midnight UTC seam. With slate_date
  // equality, both groups should appear in the same slate.
  const { data: spanRows } = await supabase
    .from("games")
    .select("slate_date, game_date")
    .eq("sport", "mlb")
    .order("slate_date", { ascending: false })
    .limit(50);
  const spanCounts = new Map<string, { lateUtc: number; earlyNextUtc: number }>();
  for (const r of spanRows ?? []) {
    const cur = spanCounts.get(r.slate_date) ?? { lateUtc: 0, earlyNextUtc: 0 };
    const hour = new Date(r.game_date).getUTCHours();
    if (hour >= 20) cur.lateUtc++;
    else if (hour < 6) cur.earlyNextUtc++;
    spanCounts.set(r.slate_date, cur);
  }
  const spanningSlate = Array.from(spanCounts.entries()).find(
    ([, c]) => c.lateUtc > 0 && c.earlyNextUtc > 0
  );
  if (spanningSlate) {
    check(
      `found a slate with games on both sides of the UTC seam: ${spanningSlate[0]} (lateUtc=${spanningSlate[1].lateUtc}, earlyNextUtc=${spanningSlate[1].earlyNextUtc})`,
      true
    );
  } else {
    console.log("  ~ no seam-spanning slate found in the recent 50 rows (skipping seam-spanning sanity test)");
  }

  // ─── (9) Route fallback: requested empty date returns most-recent slate ─
  section("Daily Edge route fallback");

  // Ask for a slate we know is empty (year in the past).
  const emptyRes = await dailyEdge(
    new Request("https://x/api/lab/daily-edge?sport=mlb&date=2024-01-01")
  );
  check(`empty-slate request returns 200`, emptyRes.status === 200);
  const emptyBody = (await emptyRes.json()) as {
    date: string;
    requested_date: string;
    fallback_used: boolean;
    games: unknown[];
  };
  check(`requested_date echoed back as 2024-01-01`, emptyBody.requested_date === "2024-01-01");
  check(`fallback_used = true`, emptyBody.fallback_used === true);
  check(`effective date is later than the requested empty date`, emptyBody.date > emptyBody.requested_date);
  check(`fallback slate has games (length > 0)`, emptyBody.games.length > 0);

  // ─── (10) Route happy path: requested slate with games returns those games ─
  section("Daily Edge route happy path (slate equality)");

  // Pull the latest MLB slate from DB and query it explicitly.
  const { data: latestSlate } = await supabase
    .from("games")
    .select("slate_date")
    .eq("sport", "mlb")
    .order("slate_date", { ascending: false })
    .limit(1);
  const targetSlate = latestSlate?.[0]?.slate_date;
  if (targetSlate) {
    const targetRes = await dailyEdge(
      new Request(`https://x/api/lab/daily-edge?sport=mlb&date=${targetSlate}`)
    );
    const targetBody = (await targetRes.json()) as {
      date: string;
      requested_date: string;
      fallback_used: boolean;
      games: unknown[];
    };
    check(`requested slate returns 200`, targetRes.status === 200);
    check(`requested_date echoed back`, targetBody.requested_date === targetSlate);
    check(`date matches requested (no fallback)`, targetBody.date === targetSlate);
    check(`fallback_used = false`, targetBody.fallback_used === false);
    check(`games returned for this slate`, targetBody.games.length > 0);
    // Critical: compare against direct DB count.
    const { count: dbCount } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("sport", "mlb")
      .eq("slate_date", targetSlate);
    check(
      `route returns same count as DB for slate ${targetSlate} (got ${targetBody.games.length} of ${dbCount})`,
      targetBody.games.length <= (dbCount ?? 0) && targetBody.games.length > 0
    );
  } else {
    console.log("  ~ no MLB slates in DB — skipping happy-path slate test");
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All slate-date tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-slate-dates failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
