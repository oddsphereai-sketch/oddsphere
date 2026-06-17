import { supabase } from "../../lib/db/supabase";
async function main() {
  const { data } = await supabase
    .from("prediction_records")
    .select("id, market, pick, side, line_value, odds_american, confidence, play_grade, model_probability, locked_at, created_at, snapshot_json")
    .eq("sport", "nhl")
    .eq("slate_date", "2026-06-09")
    .order("id");
  console.log("Total rows:", data?.length ?? 0);
  console.log();
  for (const r of data ?? []) {
    const sj = r.snapshot_json as any;
    console.log(`=== record id=${r.id} ===`);
    console.log(`  market:             ${r.market}`);
    console.log(`  pick:               ${r.pick}`);
    console.log(`  side:               ${r.side}`);
    console.log(`  confidence:         ${r.confidence}`);
    console.log(`  play_grade:         ${r.play_grade}`);
    console.log(`  model_probability:  ${r.model_probability}`);
    console.log(`  line_value:         ${r.line_value}`);
    console.log(`  odds_american:      ${r.odds_american}`);
    console.log(`  locked_at:          ${r.locked_at}`);
    console.log(`  created_at:         ${r.created_at}`);
    if (sj) {
      console.log(`  snapshot_json keys: ${Object.keys(sj).join(", ")}`);
      console.log(`    model_output.moneyline.verdict: ${sj.model_output?.moneyline?.verdict}`);
      console.log(`    model_output.total.verdict:     ${sj.model_output?.total?.verdict}`);
      console.log(`    model_output.expected_goal_diff: ${sj.model_output?.expected_goal_diff}`);
      console.log(`    market_at_lock.total_line:      ${sj.market_at_lock?.total_line}`);
      console.log(`    market_at_lock.ml_book_count:   ${sj.market_at_lock?.ml_book_count}`);
      console.log(`    market_at_lock.lines_snapshot:  ${sj.market_at_lock?.lines_snapshot?.length} rows`);
      console.log(`    goalie_assumption.home:         ${sj.goalie_assumption?.home?.player_name} (source=${sj.goalie_assumption?.home?.source})`);
      console.log(`    goalie_assumption.away:         ${sj.goalie_assumption?.away?.player_name} (source=${sj.goalie_assumption?.away?.source})`);
      console.log(`    lock_source:                    ${sj.lock_source}`);
    }
    console.log();
  }
  // Eligibility summary
  const unlocked = (data ?? []).filter((r: any) => r.locked_at === null);
  console.log(`Eligible to update (locked_at IS NULL): ${unlocked.length} / ${data?.length ?? 0}`);
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
