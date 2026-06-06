import { supabase } from "../lib/db/supabase";
const DATE = "2026-06-06";
async function main() {
  const { data: games } = await supabase.from("games").select("id, external_id, home_team_id, away_team_id").eq("slate_date", DATE).eq("sport", "mlb");
  const ids = (games ?? []).map((g) => g.id as number);
  const { data: ls } = await supabase.from("lineups").select("game_id, team_id, player_id, batting_position, is_confirmed, starting_position").in("game_id", ids);
  console.log(`Total lineup rows for ${DATE}: ${ls?.length ?? 0}`);
  // Group by game_id + team_id
  const byGameTeam = new Map<string, number>();
  for (const r of ls ?? []) {
    const k = `${r.game_id}|${r.team_id}`;
    byGameTeam.set(k, (byGameTeam.get(k) ?? 0) + 1);
  }
  let pairsFull = 0, pairsPartial = 0, pairsEmpty = 0;
  for (const g of games ?? []) {
    const ch = byGameTeam.get(`${g.id}|${g.home_team_id}`) ?? 0;
    const ca = byGameTeam.get(`${g.id}|${g.away_team_id}`) ?? 0;
    if (ch >= 9 && ca >= 9) pairsFull++;
    else if (ch > 0 || ca > 0) pairsPartial++;
    else pairsEmpty++;
  }
  console.log(`Games with both sides ≥9 batters:  ${pairsFull}`);
  console.log(`Games with some lineup data:         ${pairsPartial}`);
  console.log(`Games with NO lineup data:           ${pairsEmpty}`);
  if (ls && ls.length > 0) {
    const sample = ls.slice(0, 3);
    console.log(`Sample rows:`, sample);
  }
  // Now exclude pitchers
  const batterOnly = (ls ?? []).filter((r) => r.starting_position !== "P" && r.starting_position !== "SP" && r.starting_position !== "RP");
  const byGameTeamBatters = new Map<string, number>();
  for (const r of batterOnly) {
    const k = `${r.game_id}|${r.team_id}`;
    byGameTeamBatters.set(k, (byGameTeamBatters.get(k) ?? 0) + 1);
  }
  let bPairsFull = 0, bPairsPartial = 0, bPairsEmpty = 0;
  for (const g of games ?? []) {
    const ch = byGameTeamBatters.get(`${g.id}|${g.home_team_id}`) ?? 0;
    const ca = byGameTeamBatters.get(`${g.id}|${g.away_team_id}`) ?? 0;
    if (ch >= 8 && ca >= 8) bPairsFull++;
    else if (ch > 0 || ca > 0) bPairsPartial++;
    else bPairsEmpty++;
  }
  console.log(`\nBATTERS-ONLY (excl P/SP/RP):`);
  console.log(`Games with both sides ≥8 batters:  ${bPairsFull}`);
  console.log(`Games with some batter data:        ${bPairsPartial}`);
  console.log(`Games with NO batter data:          ${bPairsEmpty}`);
}
main();
