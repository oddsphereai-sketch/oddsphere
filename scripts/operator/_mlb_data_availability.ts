/** READ-ONLY — what fields exist for prediction-side analysis (proj vs actual). */
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("market, side, model_probability, edge, odds_american, snapshot_json, prediction_grades(result, actual_outcome, final_score_home, final_score_away, game_total)")
    .eq("sport", "mlb").gte("slate_date", "2026-06-07").limit(1).eq("market", "total");
  const r: any = (data ?? [])[0];
  if (!r) { console.log("no row"); return; }
  console.log("=== prediction_grades fields on a total row ===");
  console.log(JSON.stringify(r.prediction_grades, null, 2));
  const sj = r.snapshot_json ?? {};
  console.log("\n=== snapshot_json TOP-LEVEL keys ===");
  console.log(Object.keys(sj).join(", "));
  console.log("\n=== v2_2_audit keys (posterior/projection fields) ===");
  console.log(Object.keys(sj.v2_2_audit ?? {}).join(", "));
  console.log("\n=== sample v2_2_audit projection values ===");
  const a = sj.v2_2_audit ?? {};
  for (const k of ["posterior_away_runs", "posterior_home_runs", "posterior_total", "posterior_home_diff", "ou_model_prob", "ou_market_prob", "ml_model_prob", "ml_market_prob", "independent_total", "listed_total"]) {
    if (a[k] !== undefined) console.log(`  ${k} = ${a[k]}`);
  }
  console.log("\n=== data_integrity keys ===");
  console.log(Object.keys(sj.data_integrity ?? {}).join(", "));
  console.log("\n=== line_movement keys ===");
  console.log(Object.keys(sj.line_movement ?? {}).join(", "));
  console.log("\n=== public_splits keys ===");
  console.log(Object.keys(sj.public_splits ?? {}).join(", "));

  // Check actual-score availability across grades table
  const { data: grades } = await supabase.from("prediction_grades")
    .select("final_score_home, final_score_away, game_total, actual_outcome")
    .limit(500);
  const g = (grades ?? []) as any[];
  const withScore = g.filter(x => x.final_score_home !== null && x.final_score_away !== null).length;
  console.log(`\n=== prediction_grades actual-score coverage: ${withScore}/${g.length} have final_score_home/away ===`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
