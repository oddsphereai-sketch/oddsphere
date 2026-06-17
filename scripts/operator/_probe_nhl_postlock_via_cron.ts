import { supabase } from "../../lib/db/supabase";
import { runTrackingRefresh } from "../../lib/services/trackingRefreshService";

async function main() {
  // Lock both records
  const ts = new Date().toISOString();
  await supabase.from("prediction_records")
    .update({ locked_at: ts })
    .eq("sport", "nhl").eq("slate_date", "2026-06-09");
  console.log(`locked_at set to ${ts}`);

  // Re-run tracking-refresh in apply mode (so we exercise the actual write path)
  // The writer's existing-row check happens whether apply or dry-run.
  const summary = await runTrackingRefresh({
    supabase, sport: "nhl", dates: ["2026-06-09"], apply: false,
  });
  console.log("\nDry-run on locked rows:");
  console.log("  records_created:", summary.perDate[0].records_created);
  console.log("  errors:", summary.perDate[0].errors.length);
  // restore
  await supabase.from("prediction_records")
    .update({ locked_at: null })
    .eq("sport", "nhl").eq("slate_date", "2026-06-09");
  console.log("\nRestored locked_at = null");
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
