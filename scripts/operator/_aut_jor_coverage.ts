/** READ-ONLY — prediction coverage for upcoming soccer games + slate_date mapping. */
import { supabase } from "../../lib/db/supabase";
function etParts(iso: string) {
  const d = new Date(iso);
  // ET = UTC-4 (EDT in June)
  const et = new Date(d.getTime() - 4 * 3600 * 1000);
  return { etDate: et.toISOString().slice(0, 10), etTime: et.toISOString().slice(11, 16) };
}
async function main() {
  const { data: g } = await supabase.from("games")
    .select("id, external_id, game_date, status, home_team_id, away_team_id")
    .eq("sport", "soccer").gte("game_date", "2026-06-16T00:00:00Z").order("game_date");
  const games = (g ?? []) as any[];
  const gids = games.map(x => x.id);
  const { data: pr } = await supabase.from("prediction_records")
    .select("game_id, market, slate_date, locked_at, odds_american, no_bet")
    .eq("sport", "soccer").in("game_id", gids as number[]);
  const byGame = new Map<number, any[]>();
  for (const r of (pr ?? []) as any[]) { if (!byGame.has(r.game_id)) byGame.set(r.game_id, []); byGame.get(r.game_id)!.push(r); }
  const ids = [...new Set(games.flatMap(x => [x.home_team_id, x.away_team_id]))];
  const tmap = new Map<number, string>();
  const { data: tt } = await supabase.from("teams").select("id, abbreviation").in("id", ids as number[]);
  for (const t of (tt ?? []) as any[]) tmap.set(t.id, t.abbreviation);
  console.log(`now=${new Date().toISOString()} (ET ${etParts(new Date().toISOString()).etDate} ${etParts(new Date().toISOString()).etTime})\n`);
  for (const g of games) {
    const et = etParts(g.game_date);
    const preds = byGame.get(g.id) ?? [];
    const markets = [...new Set(preds.map(p => p.market))].sort();
    const slates = [...new Set(preds.map(p => p.slate_date))];
    const tag = preds.length ? `predicted [${markets.join(",")}] slate=${slates.join(",")}` : ">>> NO PREDICTIONS <<<";
    console.log(`  id=${g.id} ext=${g.external_id} ${tmap.get(g.away_team_id)}@${tmap.get(g.home_team_id)}  UTC ${g.game_date.slice(5,16)}  ET ${et.etDate} ${et.etTime}  status=${g.status}  ${tag}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
