/**
 * Read-only verification probe for 2026-06-10 NBA slate readiness.
 * Run after the seed + ratings + lines apply pipeline.
 */

import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const slateDate = "2026-06-10";

  // 1. games row
  const gamesRes = await supabase
    .from("games")
    .select("id, external_id, slate_date, game_date, status, home_team_id, away_team_id, season, season_type")
    .eq("sport", "nba")
    .eq("slate_date", slateDate);
  console.log("=== games (slate_date=2026-06-10) ===");
  console.log(JSON.stringify(gamesRes.data, null, 2));
  if (!gamesRes.data || gamesRes.data.length === 0) {
    console.error("FAIL: no games row found");
    process.exit(1);
  }
  const game = gamesRes.data[0]!;
  const teamIds = [game.home_team_id, game.away_team_id].filter((x): x is number => x !== null);

  // 2. teams
  const teamsRes = await supabase
    .from("teams")
    .select("id, abbreviation, display_name")
    .in("id", teamIds);
  console.log("\n=== teams ===");
  console.log(JSON.stringify(teamsRes.data, null, 2));

  // 3. nba_team_ratings — both teams, fresh fetched_at
  const ratingsRes = await supabase
    .from("nba_team_ratings")
    .select("team_id, season, season_type, off_rating, def_rating, net_rating, pace, fetched_at")
    .in("team_id", teamIds)
    .eq("season", 2026)
    .order("fetched_at", { ascending: false });
  console.log("\n=== nba_team_ratings (both teams, season=2026) ===");
  console.log(JSON.stringify(ratingsRes.data, null, 2));

  // 4. lines for this game
  const linesRes = await supabase
    .from("lines")
    .select("market_type, sportsbook, side, line_value, odds_american")
    .eq("game_id", game.id)
    .is("player_id", null)
    .order("market_type")
    .order("sportsbook")
    .order("side");
  console.log("\n=== lines for game ===");
  console.log(JSON.stringify(linesRes.data, null, 2));
  const byMarket: Record<string, number> = {};
  for (const r of linesRes.data ?? []) {
    byMarket[r.market_type] = (byMarket[r.market_type] ?? 0) + 1;
  }
  console.log(`\nMarket distribution: ${JSON.stringify(byMarket)}`);

  // 5. line_history
  const histRes = await supabase
    .from("line_history")
    .select("id")
    .eq("game_id", game.id)
    .is("player_id", null);
  console.log(`\n=== line_history rows: ${histRes.data?.length ?? 0} ===`);

  // Summary checks
  const hasML = (byMarket.moneyline ?? 0) > 0;
  const hasTotal = (byMarket.total ?? 0) > 0;
  console.log("\n=== READINESS SUMMARY ===");
  console.log(`  games row:             ${gamesRes.data.length > 0 ? "OK" : "MISSING"}`);
  console.log(`  slate_date correct:    ${game.slate_date === slateDate ? "OK" : "MISMATCH"}`);
  console.log(`  status:                ${game.status}`);
  console.log(`  ratings (both teams):  ${(ratingsRes.data?.length ?? 0) >= 2 ? "OK" : "INCOMPLETE"} (${ratingsRes.data?.length ?? 0} rows)`);
  console.log(`  moneyline lines:       ${hasML ? "OK" : "MISSING"} (${byMarket.moneyline ?? 0})`);
  console.log(`  total lines:           ${hasTotal ? "OK" : "MISSING"} (${byMarket.total ?? 0})`);
  console.log(`  line_history:          ${(histRes.data?.length ?? 0) > 0 ? "OK" : "MISSING"} (${histRes.data?.length ?? 0} rows)`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
