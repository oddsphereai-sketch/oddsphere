import { supabase } from "../lib/db/supabase";
const DATE = process.argv[2] ?? "2026-06-06";

async function main() {
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, ballpark_id")
    .eq("slate_date", DATE)
    .eq("sport", "mlb");
  const ids = (games ?? []).map((g) => g.id as number);
  console.log(`\n━━━ Real coverage probe — ${DATE} (${ids.length} games) ━━━\n`);

  // weather_forecasts (correct table name)
  const { data: wx } = await supabase
    .from("weather_forecasts")
    .select("game_id, fetched_at, temperature_f, wind_speed_mph, conditions, is_notable")
    .in("game_id", ids);
  console.log(`weather_forecasts rows: ${wx?.length ?? 0}`);
  if (wx && wx.length > 0) {
    const recent = (wx[0].fetched_at as string)?.slice(0, 19);
    let withTemp = 0, withWind = 0, dome = 0, notable = 0;
    for (const w of wx) {
      if (w.temperature_f !== null) withTemp++;
      if (w.wind_speed_mph !== null) withWind++;
      if (w.conditions === "Dome") dome++;
      if (w.is_notable === true) notable++;
    }
    console.log(`  most-recent fetched_at: ${recent}`);
    console.log(`  temp non-null: ${withTemp}  wind non-null: ${withWind}  dome: ${dome}  notable: ${notable}`);
  }

  // lineups
  const { data: ls } = await supabase
    .from("lineups")
    .select("game_id, team_id, is_confirmed")
    .in("game_id", ids);
  console.log(`\nlineups rows: ${ls?.length ?? 0}`);
  if (ls && ls.length > 0) {
    let confirmed = 0;
    for (const l of ls) if (l.is_confirmed === true) confirmed++;
    console.log(`  confirmed: ${confirmed} of ${ls.length}`);
  }

  // bullpen + offense will be re-investigated via direct table reads
  // (player_season_stats + player roster)
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
