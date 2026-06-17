import { supabase } from "../../lib/db/supabase";

async function main() {
  // Step 1: mark both NHL records as locked
  const lockedAt = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("prediction_records")
    .update({ locked_at: lockedAt })
    .eq("sport", "nhl")
    .eq("slate_date", "2026-06-09");
  if (upErr) { console.error("set locked_at:", upErr.message); process.exit(1); }
  console.log(`✓ marked NHL records locked_at=${lockedAt}`);

  // Step 2: snapshot current model_probability + confidence + play_grade for comparison
  const { data: before } = await supabase
    .from("prediction_records")
    .select("id, market, pick, side, line_value, odds_american, model_probability, confidence, play_grade, locked_at, snapshot_json")
    .eq("sport", "nhl")
    .eq("slate_date", "2026-06-09")
    .order("id");
  console.log("\nBefore re-run:");
  for (const r of before ?? []) {
    const sj = r.snapshot_json as any;
    console.log(`  id=${r.id} ${r.market} pick=${r.pick} prob=${r.model_probability} conf=${r.confidence} grade=${r.play_grade} locked_at=${r.locked_at} goalie_home=${sj?.goalie_assumption?.home?.player_name}`);
  }
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
