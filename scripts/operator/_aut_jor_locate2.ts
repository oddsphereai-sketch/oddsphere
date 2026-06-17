/** READ-ONLY — direct game lookup by team ids + soccer games sanity. */
import { supabase } from "../../lib/db/supabase";
async function main() {
  // 1. ANY game involving Austria(1691) or Jordan(1692), any date
  console.log(`=== GAMES involving Austria(1691)/Jordan(1692) any date ===`);
  const { data: g } = await supabase.from("games")
    .select("id, external_id, sport, league, game_date, status, home_team_id, away_team_id, home_score, away_score")
    .or("home_team_id.in.(1691,1692),away_team_id.in.(1691,1692)").order("game_date");
  if (!(g ?? []).length) console.log("  (NONE — no games row exists for these teams at all)");
  for (const r of (g ?? []) as any[]) console.log(`  id=${r.id} ext=${r.external_id} ${r.game_date} status=${r.status} ${r.away_team_id}@${r.home_team_id} ${r.away_score ?? "-"}:${r.home_score ?? "-"}`);

  // 2. What soccer games exist right now (recent + upcoming), show raw game_date type
  console.log(`\n=== latest 25 soccer games by game_date ===`);
  const { data: s } = await supabase.from("games")
    .select("id, external_id, game_date, status, home_team_id, away_team_id")
    .eq("sport", "soccer").order("game_date", { ascending: false }).limit(25);
  const ids = [...new Set((s ?? []).flatMap((x: any) => [x.home_team_id, x.away_team_id]))];
  const tmap = new Map<number, string>();
  const { data: tt } = await supabase.from("teams").select("id, abbreviation").in("id", ids as number[]);
  for (const t of (tt ?? []) as any[]) tmap.set(t.id, t.abbreviation);
  for (const r of (s ?? []) as any[]) console.log(`  id=${r.id} ext=${r.external_id} ${r.game_date} status=${r.status} ${tmap.get(r.away_team_id) ?? r.away_team_id}@${tmap.get(r.home_team_id) ?? r.home_team_id}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
