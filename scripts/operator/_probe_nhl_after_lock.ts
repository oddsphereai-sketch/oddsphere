import { supabase } from "../../lib/db/supabase";
async function main() {
  const { data } = await supabase
    .from("prediction_records")
    .select("id, market, pick, side, line_value, odds_american, model_probability, confidence, play_grade, locked_at, snapshot_json")
    .eq("sport", "nhl")
    .eq("slate_date", "2026-06-09")
    .order("id");
  for (const r of data ?? []) {
    const sj = r.snapshot_json as any;
    console.log(`  id=${r.id} ${r.market} pick=${r.pick} prob=${r.model_probability} conf=${r.confidence} grade=${r.play_grade} locked_at=${r.locked_at} goalie_home=${sj?.goalie_assumption?.home?.player_name} lock_source=${sj?.lock_source}`);
  }
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
