import { supabase } from "../../lib/db/supabase";
async function main(): Promise<void> {
  const { data } = await supabase
    .from("prediction_records")
    .select("id, market, pick, model_probability, market_probability, odds_american, line_value, edge, confidence, play_grade, held, no_bet, locked_at")
    .eq("game_id", 15619);
  const list = (data ?? []) as Array<Record<string, unknown>>;
  console.log(`CWS now has ${list.length} prediction_records:`);
  for (const r of list) console.log("  ", JSON.stringify(r));
}
main().catch((e) => { console.error(e); process.exit(1); });
