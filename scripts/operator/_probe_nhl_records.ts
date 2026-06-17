import { supabase } from "../../lib/db/supabase";
async function main() {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id, sport, market, pick, side, line_value, odds_american, model_probability, confidence, play_grade, locked_at, snapshot_json, model_version, slate_date")
    .eq("sport", "nhl")
    .eq("slate_date", "2026-06-09")
    .order("id", { ascending: false });
  if (error) { console.error(error.message); process.exit(1); }
  for (const r of data ?? []) {
    console.log(`\n=== record id=${r.id} ${r.market} ===`);
    console.log(`  pick=${r.pick} side=${r.side} line=${r.line_value} odds=${r.odds_american}`);
    console.log(`  model_prob=${r.model_probability} confidence=${r.confidence} grade=${r.play_grade}`);
    console.log(`  locked_at=${r.locked_at} model_version=${r.model_version}`);
    const s = r.snapshot_json as any;
    if (s) {
      console.log(`  snapshot keys:    ${Object.keys(s).join(", ")}`);
      console.log(`  goalie_assumption.home: ${JSON.stringify(s.goalie_assumption?.home)}`);
      console.log(`  goalie_assumption.away: ${JSON.stringify(s.goalie_assumption?.away)}`);
      console.log(`  market_at_lock.total_line: ${s.market_at_lock?.total_line}`);
      console.log(`  market_at_lock.ml_book_count: ${s.market_at_lock?.ml_book_count}`);
      console.log(`  market_at_lock.lines_snapshot count: ${(s.market_at_lock?.lines_snapshot || []).length}`);
      console.log(`  model_output.moneyline.verdict: ${s.model_output?.moneyline?.verdict}`);
      console.log(`  model_output.total.verdict: ${s.model_output?.total?.verdict}`);
      console.log(`  model_output.expected_goal_diff: ${s.model_output?.expected_goal_diff}`);
      console.log(`  lock_source: ${s.lock_source}`);
    }
  }
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
