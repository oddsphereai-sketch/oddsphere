/**
 * One-shot: run runTrackingRefresh from local (same code as the cron
 * route). Uses local 0ffeaaf code; production cron will pick this up
 * on its next scheduled run regardless.
 *
 * Safety contract (same as the cron route):
 *   • Never writes game_predictions
 *   • Never writes slate_status
 *   • Never writes locked_at
 *   • Idempotent (re-running is safe)
 *
 * Apply by default. Pass --dry-run to skip writes.
 */
import { createClient } from "@supabase/supabase-js";
import { runTrackingRefresh, computeRefreshDates } from "../../lib/services/trackingRefreshService";

async function main() {
  const apply = !process.argv.includes("--dry-run");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const dates = computeRefreshDates(new Date());
  console.log(`\n=== runTrackingRefresh apply=${apply} dates=${dates.join(",")} ===\n`);

  const summary = await runTrackingRefresh({
    dates,
    apply,
    supabase: sb as any,
  });

  console.log("totals:", summary.totals);
  console.log("perDate:");
  for (const p of summary.perDate) {
    console.log(`  ${p.date} records_created=${p.records_created} linescores_updated=${p.linescores_updated} final_scores_updated=${p.final_scores_updated} grades_upserted=${p.grades_upserted} errors=${p.errors.length}`);
    for (const e of p.errors.slice(0, 5)) console.log(`    err: ${JSON.stringify(e)}`);
  }
  console.log(`duration: ${summary.durationMs}ms`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
