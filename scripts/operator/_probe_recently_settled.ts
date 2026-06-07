/**
 * Read-only probe — runs computeTrackingAggregate against prod DB and
 * dumps the recentlySettled feed shape so we can verify the 6B.21
 * surface is populated correctly.
 */
import { createClient } from "@supabase/supabase-js";
import { computeTrackingAggregate } from "../../lib/services/trackingAggregateService";

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const result = await computeTrackingAggregate({
    supabase: sb as any,
    sport: "mlb",
    includeLaunchDay: false,
  });
  console.log(`\nrowsConsidered=${result.rowsConsidered} rowsCounted=${result.rowsCounted}`);
  console.log(`\n── recentlySettled (${result.recentlySettled.length}/20) — ordered by graded_at DESC ──\n`);
  for (const p of result.recentlySettled) {
    console.log(
      `  ${p.graded_at?.slice(0, 19) ?? "—"} | slate=${p.slate_date} | ${p.matchup.padEnd(10)} | ${p.market.padEnd(13)} | pick=${(p.pick ?? "-").padEnd(8)} | ${p.result.toUpperCase().padEnd(4)} | conf=${p.confidence ?? "-"} | odds=${p.odds_american ?? "-"} | line=${p.line_value ?? "-"} | best_angle=${p.best_angle}${p.grade_notes ? ` | note="${p.grade_notes.slice(0, 50)}"` : ""}`,
    );
  }
  // Sanity invariants
  let pendingLeaked = 0, noBetLeaked = 0;
  for (const p of result.recentlySettled) {
    if ((p.result as string) === "pending") pendingLeaked++;
  }
  console.log(`\n  invariants: pending leaked=${pendingLeaked} no_bet leaked=${noBetLeaked}`);
  console.log(`  expected: 0 / 0`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
