/**
 * READ-ONLY: extract the four-market hold decision trace for tonight's
 * WC fixtures so we can answer Daniel's audit question about hold logic.
 *
 * No writes. Safe to run anytime.
 */
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select(
      "id, game_id, market, pick, side, line_value, odds_american, held, no_bet, play_grade, hold_reason, snapshot_json, locked_at, model_version",
    )
    .eq("sport", "soccer")
    .eq("slate_date", "2026-06-11");
  if (error !== null) {
    console.error(error);
    process.exit(1);
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  console.log(`Found ${rows.length} soccer prediction_records on 2026-06-11`);

  for (const r of rows) {
    const snap = (r.snapshot_json ?? {}) as Record<string, unknown>;
    console.log("\n────────────────────────────────────────────────");
    console.log(
      `id=${r.id} game_id=${r.game_id} market=${r.market} pick=${r.pick} side=${r.side} line=${r.line_value} odds=${r.odds_american}`,
    );
    console.log(
      `held=${r.held} no_bet=${r.no_bet} play_grade=${r.play_grade} hold_reason="${r.hold_reason}" model_version=${r.model_version}`,
    );

    const keys = [
      "model_probability",
      "model_p",
      "market_probability",
      "market_p",
      "market_implied_p",
      "edge_pp",
      "edge",
      "model_market_agreement",
      "is_far_from_market",
      "is_short_price_dc",
      "is_single_source",
      "is_stale_market",
      "confidence",
      "confidence_cap_default",
      "confidence_cap_effective",
      "confidence_reductions",
      "calibration_evidence_level",
      "reconciliation",
      "predicted_total",
      "listed_total_line",
      "lambda_home",
      "lambda_away",
      "total_lines_diverge",
      "splits_status",
      "hold_code",
      "hold_reason_code",
      "grade",
      "verdict",
    ];
    for (const k of keys) {
      const v = (snap as Record<string, unknown>)[k];
      if (v !== undefined && v !== null) {
        const s = typeof v === "object" ? JSON.stringify(v) : String(v);
        console.log(`  ${k}: ${s}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
