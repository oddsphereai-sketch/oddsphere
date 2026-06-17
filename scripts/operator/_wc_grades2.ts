import { supabase } from "../../lib/db/supabase";
async function main(){
  // 1. prediction_grades columns
  const { data: one } = await supabase.from("prediction_grades").select("*").limit(1);
  console.log("prediction_grades cols:", one && one[0] ? Object.keys(one[0]).join(", ") : "(empty)");
  // 2. soccer grades by market (join via prediction_record)
  const { data, error } = await supabase.from("prediction_grades")
    .select("result, prediction_records!inner(sport, market, matchup, slate_date)")
    .eq("prediction_records.sport","soccer").gte("prediction_records.slate_date","2026-06-13");
  if (error) { console.log("ERR:", error.message); }
  const rows = (data ?? []) as any[];
  console.log(`\nsoccer prediction_grades since 6/13: ${rows.length}`);
  const mk: Record<string,number> = {}; for (const r of rows){ const m=(Array.isArray(r.prediction_records)?r.prediction_records[0]:r.prediction_records)?.market; mk[m]=(mk[m]??0)+1; }
  console.log("graded by market:", JSON.stringify(mk));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
