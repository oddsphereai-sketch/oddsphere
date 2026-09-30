import { writeNhlPredictionRecords } from "../../lib/services/nhl/buildNhlPredictionRecords";
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const result = await writeNhlPredictionRecords({
    slateDate: "2026-09-30",
    apply: false,
    deferLock: true,
    logger: (message) => console.log(message),
  });
  const { data } = await supabase
    .from("prediction_records")
    .select("game_id, market, snapshot_json")
    .eq("sport", "nhl")
    .eq("slate_date", "2026-09-30")
    .eq("market", "moneyline")
    .is("locked_at", null);
  console.log(JSON.stringify((data ?? []).map((row) => {
    const snapshot = row.snapshot_json as any;
    return {
      game_id: row.game_id,
      home: snapshot?.feature_inputs?.home?.abbreviation,
      away: snapshot?.feature_inputs?.away?.abbreviation,
      feature_season: snapshot?.feature_inputs?.feature_season,
      provider_feature_season: snapshot?.feature_inputs?.provider_feature_season,
      opponent_adjusted: snapshot?.feature_inputs?.home?.opponent_adjusted_attack,
      market: snapshot?.feature_inputs?.market,
      independent_goal_diff: snapshot?.model_output?.independent_goal_diff,
      arbitration_weight: snapshot?.model_output?.layers?.market_arbitration_weight,
    };
  }), null, 2));
  console.log(JSON.stringify({ audit: "nhl_early_market_arbitration_r11", writes: 0, result }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
