import { supabase } from "../../lib/db/supabase";
async function main() {
  // 1. snapshot.model — does it carry P(home)/P(draw)/P(away)?
  const { data } = await supabase.from("prediction_records")
    .select("matchup, side, pick, model_probability, snapshot_json")
    .eq("sport", "soccer").eq("market", "match_result").gte("slate_date", "2026-06-15").limit(6);
  for (const r of (data ?? []) as any[]) {
    const m = r.snapshot_json?.model ?? {};
    const drawish: Record<string, any> = {};
    for (const k of Object.keys(m)) if (/home|draw|away|prob|1x2|p_/i.test(k)) drawish[k] = m[k];
    console.log(`${r.matchup}: pick=${r.pick} p=${r.model_probability}`);
    console.log(`   model keys: ${Object.keys(m).join(", ").slice(0, 200)}`);
    console.log(`   1x2-ish: ${JSON.stringify(drawish).slice(0, 300)}`);
  }
  // 2. missing game 16347 details + its neighbors' slate_date mapping
  console.log(`\n=== game 16347 (missing) ===`);
  const { data: g } = await supabase.from("games").select("*").eq("id", 16347).limit(1);
  const gg: any = (g ?? [])[0];
  if (gg) console.log(`  external_id=${gg.external_id} game_date=${gg.game_date} status=${gg.status} season=${gg.season} home=${gg.home_team_id} away=${gg.away_team_id}`);
  // what slate_dates do nearby soccer prediction_records use for 02:00 UTC games?
  const { data: nearby } = await supabase.from("prediction_records").select("matchup, slate_date, game_date").eq("sport", "soccer").gte("slate_date", "2026-06-14").lte("slate_date", "2026-06-15").eq("market", "match_result").order("game_date").limit(20);
  console.log(`\n  nearby soccer records (matchup | slate_date | game_date):`);
  for (const r of (nearby ?? []) as any[]) console.log(`    ${String(r.matchup).padEnd(14)} slate=${r.slate_date} game=${r.game_date}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
