import { supabase } from "../../lib/db/supabase";

async function main() {
  for (const team of ["CAR", "VGK"]) {
    const { data, error } = await supabase
      .from("nhl_goalie_stats")
      .select("player_external_id, player_name, team_abbr, season_type, situation, games_played, ice_time, x_goals, goals, saves")
      .eq("team_abbr", team)
      .eq("season", 2025)
      .eq("situation", "all")
      .order("season_type", { ascending: false })  // playoffs first
      .order("games_played", { ascending: false });
    if (error) {
      console.error(`query ${team}:`, error.message);
      continue;
    }
    console.log(`\n=== ${team} goalies (season 2025, situation=all) ===`);
    for (const g of data ?? []) {
      const xGSAA = g.x_goals !== null && g.goals !== null ? (g.x_goals - g.goals) : null;
      console.log(`  ${g.season_type.padEnd(8)} id=${g.player_external_id}  ${g.player_name.padEnd(22)}  GP=${g.games_played}  xG=${g.x_goals}  GA=${g.goals}  saves=${g.saves}  xGSAA=${xGSAA?.toFixed(2) ?? "n/a"}`);
    }
  }
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
