import { supabase } from "../../lib/db/supabase";
async function main() {
  const { data } = await supabase
    .from("nhl_team_stats")
    .select("team_id, season_type, situation, games_played, xgoals_pct, corsi_pct, x_goals_for, x_goals_against, goals_for, goals_against, ice_time")
    .in("team_id", [781, 782])
    .eq("season", 2025)
    .order("team_id")
    .order("season_type", { ascending: false })
    .order("situation");
  console.log("NHL team stats (team_id 781=VGK, 782=CAR):");
  for (const r of data ?? []) {
    console.log(`  team=${r.team_id} ${r.season_type.padEnd(9)} ${r.situation.padEnd(5)} GP=${r.games_played} xG%=${r.xgoals_pct} Corsi%=${r.corsi_pct} xGF=${r.x_goals_for} xGA=${r.x_goals_against} GF=${r.goals_for} GA=${r.goals_against}`);
  }
  console.log("");
  const { data: goalies } = await supabase
    .from("nhl_goalie_stats")
    .select("player_name, team_abbr, season_type, situation, games_played, ice_time, x_goals, goals")
    .in("team_abbr", ["CAR", "VGK"])
    .eq("season", 2025)
    .eq("situation", "all")
    .order("team_abbr")
    .order("season_type", { ascending: false })
    .order("games_played", { ascending: false });
  console.log("NHL goalies all-situations:");
  for (const g of goalies ?? []) {
    const xgsaa = g.x_goals !== null && g.goals !== null ? (g.x_goals - g.goals) : null;
    const per60 = xgsaa !== null && g.ice_time !== null && g.ice_time > 0 ? (xgsaa / (g.ice_time / 3600)).toFixed(3) : "n/a";
    console.log(`  ${g.team_abbr} ${g.season_type.padEnd(9)} ${g.player_name.padEnd(22)} GP=${g.games_played} ice=${g.ice_time?.toFixed(0)}s xG=${g.x_goals?.toFixed(2)} GA=${g.goals} xGSAA=${xgsaa?.toFixed(2)} /60=${per60}`);
  }
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
