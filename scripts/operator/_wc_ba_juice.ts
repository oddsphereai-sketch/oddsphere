import { supabase } from "../../lib/db/supabase";
async function main(){
  const { data } = await supabase.from("prediction_records")
    .select("matchup, market, side, play_grade, best_angle, odds_american, model_probability, slate_date")
    .eq("sport","soccer").gte("slate_date","2026-06-13").or("best_angle.eq.true,play_grade.eq.lean").order("slate_date");
  const rows=(data??[]) as any[];
  const ba=rows.filter(r=>r.best_angle===true);
  const lean=rows.filter(r=>r.play_grade==="lean");
  console.log(`WC Best Angles: ${ba.length}, Leans: ${lean.length}`);
  console.log(`\nBest Angles by market + juice:`);
  for (const r of ba) console.log(`  ${r.matchup.padEnd(12)} ${r.market.padEnd(14)} ${String(r.side).padEnd(14)} odds=${r.odds_american} p=${r.model_probability?.toFixed?.(2)}`);
  // DC best angles at short prices?
  const dcBA=ba.filter(r=>r.market==="double_chance");
  const juiced=dcBA.filter(r=>r.odds_american!=null && r.odds_american < -200);
  console.log(`\nDC Best Angles: ${dcBA.length}; of which juiced (< -200): ${juiced.length}`);
  // market by side across all soccer (juice distribution on DC)
  const { data: dc } = await supabase.from("prediction_records").select("odds_american, play_grade, best_angle").eq("sport","soccer").eq("market","double_chance").gte("slate_date","2026-06-13");
  const priced=(dc??[]).filter((r:any)=>r.odds_american!=null);
  console.log(`\nDC priced rows: ${priced.length}/${(dc??[]).length}; odds range: ${priced.length?Math.min(...priced.map((r:any)=>r.odds_american)):"—"} to ${priced.length?Math.max(...priced.map((r:any)=>r.odds_american)):"—"}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
