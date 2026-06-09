/**
 * Phase 7C — NBA model calibration report (scaffold).
 *
 * For each confidence bucket (50-55, 55-60, 60-65, 65-70, 70-100),
 * computes:
 *   • predicted probability (bucket midpoint or actual average)
 *   • observed hit rate
 *   • count of samples in bucket
 *   • calibration error
 *
 * Status: SCAFFOLD ONLY. Insufficient settled NBA sample tonight.
 *
 * READ-ONLY. Admin/audit-only.
 */

import { supabase } from "../../../lib/db/supabase";

async function main(): Promise<void> {
  console.log("[calibration-report] scaffold");
  console.log("─".repeat(70));
  const { data: settled } = await supabase
    .from("games")
    .select("id")
    .eq("sport", "nba")
    .not("home_score", "is", null)
    .not("away_score", "is", null);
  const n = (settled ?? []).length;
  console.log(`Settled NBA games available: ${n}`);
  if (n < 30) {
    console.log("Insufficient sample. Calibration not run.");
    console.log("");
    console.log("Scaffold defines the report shape; once we have settled");
    console.log("predictions + outcomes, this script will produce:");
    console.log("  buckets: [50-55, 55-60, 60-65, 65-70, 70-100]");
    console.log("  per bucket: predicted_avg, observed_hit_rate, n, calibration_error");
    console.log("  separately for ML, spread, total");
    console.log("  separately for v0 and v1 (delta report)");
    console.log("");
    console.log("✓ scaffold OK");
    return;
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
