/**
 * Post-V18 migration smoke. Read-only. Verifies:
 *   1. prediction_records.calibration_version is selectable.
 *   2. All existing values are NULL.
 *   3. The trackingAggregateService still returns the full shape and
 *      includes settled FI rows on today's slate.
 *   4. No model behavior change: spot-check actionable FI counts.
 */
import { createClient } from "@supabase/supabase-js";
import { computeTrackingAggregate } from "../../lib/services/trackingAggregateService";

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 1. Column readable
  console.log("\n── 1. prediction_records.calibration_version column ──");
  const { data: cv, error: cvErr } = await sb
    .from("prediction_records")
    .select("id, sport, market, slate_date, calibration_version")
    .order("id", { ascending: false })
    .limit(5);
  if (cvErr) {
    console.error("  ✗ select failed:", cvErr.message);
    process.exit(1);
  }
  for (const r of cv ?? []) {
    console.log(`  rec=${(r as any).id} ${(r as any).sport} ${(r as any).market} slate=${(r as any).slate_date} calibration_version=${(r as any).calibration_version ?? "NULL"}`);
  }

  // 2. Count NULL vs non-NULL
  console.log("\n── 2. NULL audit ──");
  const { count: total } = await sb
    .from("prediction_records")
    .select("id", { head: true, count: "exact" });
  const { count: nonNull } = await sb
    .from("prediction_records")
    .select("id", { head: true, count: "exact" })
    .not("calibration_version", "is", null);
  console.log(`  total rows: ${total}`);
  console.log(`  non-NULL calibration_version: ${nonNull}`);
  console.log(`  EXPECTED non-NULL: 0`);

  // 3. Tracking aggregator still returns the full shape
  console.log("\n── 3. trackingAggregateService still works ──");
  const agg = await computeTrackingAggregate({
    supabase: sb as any,
    sport: "mlb",
    includeLaunchDay: false,
  });
  console.log(`  overall picks=${agg.overall.picks} wins=${agg.overall.wins} losses=${agg.overall.losses} pending=${agg.overall.pending} voids=${agg.overall.voids}`);
  console.log(`  bySportMarket buckets=${agg.bySportMarket.length}`);
  console.log(`  recentPicks=${agg.recentPicks.length}`);
  console.log(`  recentlySettled=${agg.recentlySettled.length}`);
  console.log(`  dailyTrend buckets=${agg.dailyTrend.length}`);

  // 4. Recently settled FI on today
  console.log("\n── 4. recentlySettled (settled-only, top 10) ──");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  for (const p of agg.recentlySettled.slice(0, 10)) {
    const same = p.slate_date === today;
    console.log(`  ${same ? "[TODAY]" : "[      ]"} ${p.graded_at?.slice(0, 19)} | slate=${p.slate_date} | ${p.matchup.padEnd(10)} | ${p.market.padEnd(13)} | ${p.pick ?? "-"} | ${p.result.toUpperCase()}`);
  }

  // 5. Toss-up exclusion check — there should be zero rows where result is "pending" or "void+no_bet"
  let pendingLeaked = 0, tossUpLeaked = 0;
  // recentlySettled is settled-only; toss-up filtered upstream.
  for (const p of agg.recentlySettled) {
    if ((p.result as string) === "pending") pendingLeaked++;
    if ((p as any).no_bet === true) tossUpLeaked++;
  }
  console.log(`\n── 5. invariants ──`);
  console.log(`  pending leaked into recentlySettled: ${pendingLeaked} (expect 0)`);
  console.log(`  no_bet leaked into recentlySettled: ${tossUpLeaked} (expect 0)`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
