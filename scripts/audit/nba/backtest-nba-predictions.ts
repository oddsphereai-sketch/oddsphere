/**
 * Phase 7C — NBA backtest scaffold.
 *
 * Reads settled NBA game outcomes (from `games` table, scored rows) and
 * compares model predictions (v0 + v1) against actual results. Computes:
 *
 *   • ML Brier score
 *   • Spread cover accuracy (ATS)
 *   • Total over/under accuracy
 *   • Average closing-line value (when we have closing-line snapshots)
 *   • Calibration buckets by confidence (10-pt bins)
 *
 * Status: SCAFFOLD ONLY. NBA v1 calibration requires a settled-results
 * sample we do not yet have (target: ≥30 games). Tonight this prints
 * "Insufficient sample" and exits 0.
 *
 * READ-ONLY. No DB writes. Admin/audit-only.
 */

import { supabase } from "../../../lib/db/supabase";

async function main(): Promise<void> {
  console.log("[backtest-nba-predictions] scaffold");
  console.log("─".repeat(70));

  const { data: settled, error } = await supabase
    .from("games")
    .select("id, external_id, game_date, home_score, away_score")
    .eq("sport", "nba")
    .not("home_score", "is", null)
    .not("away_score", "is", null);
  if (error !== null) {
    console.error(`✗ query failed: ${error.message}`);
    process.exit(1);
  }
  const n = (settled ?? []).length;
  console.log(`Settled NBA games in DB: ${n}`);

  // Calibration target threshold for v1 backtest: 30 graded games.
  const MIN_FOR_CALIBRATION = 30;
  if (n < MIN_FOR_CALIBRATION) {
    console.log(
      `Insufficient sample (n=${n} < ${MIN_FOR_CALIBRATION}). Backtest results not statistically meaningful.`,
    );
    console.log("");
    console.log("This script is a scaffold. Once we have >=30 settled NBA games:");
    console.log("  • Pull settled rows + matched v0/v1 predictions");
    console.log("  • Compute Brier(ML), ATS hit-rate, O/U hit-rate");
    console.log("  • Bucket by predicted confidence and report calibration");
    console.log("  • Compare v0 vs v1 deltas in each bucket");
    console.log("  • Compute CLV if closing-line snapshots are available");
    console.log("");
    console.log("✓ scaffold OK");
    return;
  }

  console.log("(NBA v1 not calibrated yet — running scaffold path)");
  // Future: implement once sample is sufficient.
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
