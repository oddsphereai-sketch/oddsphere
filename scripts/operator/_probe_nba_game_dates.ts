import { supabase } from "../../lib/db/supabase";

async function main() {
  const { data, error } = await supabase
    .from("games")
    .select("id, external_id, sport, game_date, slate_date, status, home_team_id, away_team_id")
    .eq("sport", "nba")
    .order("game_date", { ascending: false })
    .limit(5);
  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }
  console.log(`latest ${data?.length ?? 0} NBA games:`);
  for (const r of data ?? []) {
    console.log(JSON.stringify(r, null, 2));
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
