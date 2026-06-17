import { supabase } from "../../lib/db/supabase";
async function main() {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, matchup, market, side, play_grade, no_bet, held, launch_day, game_id, snapshot_json")
    .eq("sport", "soccer").gte("slate_date", "2026-06-13").order("slate_date").order("matchup");
  const rows = (data ?? []) as any[];
  console.log(`soccer rows since 6/13: ${rows.length}`);
  const mk: Record<string, number> = {}; for (const r of rows) mk[r.market] = (mk[r.market] ?? 0) + 1;
  console.log("by market:", JSON.stringify(mk));
  const byGame = new Map<string, any[]>();
  for (const r of rows) { const k = `${r.slate_date}|${r.matchup}`; (byGame.get(k) ?? byGame.set(k, []).get(k)!).push(r); }
  console.log(`\nper game (${byGame.size} games):`);
  for (const [k, rs] of byGame) {
    const markets = rs.map(r => r.market).sort();
    const hasDC = markets.includes("double_chance");
    console.log(`  ${k.padEnd(30)} [${markets.join(", ")}]${hasDC ? "" : "   <-- NO double_chance"}`);
  }
  // for games missing DC, show snapshot soccer keys to see if DC was computed
  console.log(`\n=== games WITHOUT double_chance — does snapshot have DC inputs? ===`);
  for (const [k, rs] of byGame) {
    if (rs.some(r => r.market === "double_chance")) continue;
    const sj = rs[0]?.snapshot_json ?? {};
    const ss = sj.soccer_audit ?? sj.v1_audit ?? {};
    const dcKeys = Object.keys(ss).filter(x => /double|dc_|1x|x2|12/i.test(x));
    console.log(`  ${k}: soccer_audit DC-ish keys = ${dcKeys.join(",") || "(none)"} | top keys: ${Object.keys(sj).slice(0, 10).join(",")}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
