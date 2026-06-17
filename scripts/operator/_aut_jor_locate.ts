/** READ-ONLY — locate Austria/Jordan WC fixture across all source tables. */
import { supabase } from "../../lib/db/supabase";

async function main() {
  const now = new Date();
  // 1. games table — search by team name fragments + recent soccer
  console.log(`=== GAMES table: soccer, game_date >= 2026-06-15 ===`);
  const { data: games } = await supabase.from("games")
    .select("id, external_id, sport, league, game_date, status, home_team_id, away_team_id, home_score, away_score, season")
    .eq("sport", "soccer").gte("game_date", "2026-06-15T00:00:00Z").lte("game_date", "2026-06-18T00:00:00Z")
    .order("game_date");
  const grows = (games ?? []) as any[];
  // resolve team names
  const teamIds = [...new Set(grows.flatMap(g => [g.home_team_id, g.away_team_id]).filter(Boolean))];
  const tmap = new Map<number, string>();
  if (teamIds.length) {
    const { data: teams } = await supabase.from("teams").select("id, name, abbreviation, external_id").in("id", teamIds as number[]);
    for (const t of (teams ?? []) as any[]) tmap.set(t.id, `${t.name}(${t.abbreviation})`);
  }
  for (const g of grows) {
    const h = tmap.get(g.home_team_id) ?? `#${g.home_team_id}`, a = tmap.get(g.away_team_id) ?? `#${g.away_team_id}`;
    const isAJ = /austr|jordan/i.test(`${h} ${a}`);
    console.log(`  ${isAJ ? ">>> " : "    "}id=${g.id} ext=${g.external_id} ${g.game_date} status=${g.status} league=${g.league} ${a} @ ${h} score=${g.away_score ?? "-"}:${g.home_score ?? "-"}`);
  }

  // 2. teams table — find Austria & Jordan ids regardless of game
  console.log(`\n=== TEAMS matching austria/jordan ===`);
  const { data: at } = await supabase.from("teams").select("id, name, abbreviation, external_id, sport").or("name.ilike.%austria%,name.ilike.%jordan%");
  for (const t of (at ?? []) as any[]) console.log(`  id=${t.id} ${t.name} (${t.abbreviation}) ext=${t.external_id} sport=${t.sport}`);

  // 3. prediction_records — any soccer rows mentioning austria/jordan
  console.log(`\n=== PREDICTION_RECORDS soccer matchup ~ austria/jordan ===`);
  const { data: pr } = await supabase.from("prediction_records")
    .select("game_id, matchup, market, slate_date, game_date, pick, locked_at, no_bet, odds_american")
    .eq("sport", "soccer").or("matchup.ilike.%austr%,matchup.ilike.%jordan%");
  if (!(pr ?? []).length) console.log("  (none)");
  for (const r of (pr ?? []) as any[]) console.log(`  game=${r.game_id} ${r.matchup} ${r.market} slate=${r.slate_date} locked=${r.locked_at ? "Y" : "N"} odds=${r.odds_american}`);

  console.log(`\nnow=${now.toISOString()}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
