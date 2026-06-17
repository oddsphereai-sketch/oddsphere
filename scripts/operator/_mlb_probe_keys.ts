import { supabase } from "../../lib/db/supabase";
async function main() {
  const { data: recent } = await supabase.from("games")
    .select("id, sport, game_date, slate_date, status").eq("sport","mlb")
    .order("game_date",{ascending:false}).limit(8);
  console.log("latest MLB games:");
  for (const r of (recent ?? []) as any[]) console.log(`  id=${r.id} ${r.game_date} slate=${r.slate_date} status=${r.status}`);
  // distinct sports
  const { data: sports } = await supabase.from("games").select("sport").limit(2000);
  const c = new Map<string,number>(); for (const r of (sports ?? []) as any[]) c.set(r.sport,(c.get(r.sport)??0)+1);
  console.log("\nsport distribution (sample):", JSON.stringify([...c.entries()]));
  // prediction_records mlb recent
  const { data: pr } = await supabase.from("prediction_records").select("slate_date").eq("sport","mlb").order("slate_date",{ascending:false}).limit(3);
  console.log("latest MLB prediction_records slate_date:", (pr??[]).map((r:any)=>r.slate_date));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
