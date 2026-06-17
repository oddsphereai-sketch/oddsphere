import { supabase } from "../../lib/db/supabase";
async function main() {
  const { data: teams } = await supabase
    .from("teams")
    .select("id, abbreviation, display_name")
    .eq("sport", "nhl")
    .in("abbreviation", ["CAR", "VGK"]);
  console.log("NHL teams:");
  for (const t of teams ?? []) {
    console.log(`  id=${t.id} ${t.abbreviation} ${t.display_name}`);
  }

  const ids = (teams ?? []).map(t => t.id);
  const { data: stats } = await supabase
    .from("nhl_team_stats")
    .select("team_id, season_type, situation, games_played, xgoals_pct, corsi_pct, x_goals_for, x_goals_against, goals_for, goals_against, ice_time")
    .in("team_id", ids)
    .eq("season", 2025)
    .order("team_id")
    .order("season_type", { ascending: false })
    .order("situation");
  console.log("\nNHL team stats:");
  for (const r of stats ?? []) {
    console.log(`  team=${r.team_id} ${r.season_type.padEnd(9)} ${r.situation.padEnd(5)} GP=${r.games_played} xG%=${r.xgoals_pct} Corsi%=${r.corsi_pct} xGF=${r.x_goals_for} xGA=${r.x_goals_against}`);
  }
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
