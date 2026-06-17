import { supabase } from "../../lib/db/supabase";
async function main(){
  const { data: t } = await supabase.from("teams").select("id, abbreviation, name").in("id",[957,958]);
  console.log("teams:", JSON.stringify(t));
  // any other game at 02:00 UTC 6/15 (dup check)?
  const { data: same } = await supabase.from("games").select("id, external_id, home_team_id, away_team_id, status, home_score, away_score").eq("sport","soccer").gte("game_date","2026-06-15T01:00:00+00:00").lte("game_date","2026-06-15T03:00:00+00:00");
  console.log("\ngames near 02:00 UTC 6/15:"); for (const g of (same??[]) as any[]) console.log(`  id=${g.id} ext=${g.external_id} ${g.home_team_id}v${g.away_team_id} ${g.status} ${g.home_score}-${g.away_score}`);
  // does 16347 have a prediction under ANY slate_date?
  const { data: anyPred } = await supabase.from("prediction_records").select("slate_date, market, matchup").eq("game_id",16347);
  console.log(`\n16347 predictions (any slate): ${(anyPred??[]).length}`, JSON.stringify((anyPred??[]).slice(0,4)));
  // 16347 score
  const { data: g } = await supabase.from("games").select("home_score, away_score, season_type, postseason").eq("id",16347);
  console.log("16347 result:", JSON.stringify(g));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
