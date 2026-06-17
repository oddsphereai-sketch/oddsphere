/** READ-ONLY — dump market/sharp signal field structure + coverage by market. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07";
async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("market, snapshot_json, launch_day, no_bet")
    .eq("sport", "mlb").gte("slate_date", START);
  const rows = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  // dump keys from first row that has each object
  const ex: any = {};
  for (const r of rows as any[]) { const sj = r.snapshot_json ?? {}; if (sj.public_splits && !ex.ps) ex.ps = sj.public_splits; if (sj.line_movement && !ex.lm) ex.lm = sj.line_movement; if (sj.data_integrity && !ex.di) ex.di = sj.data_integrity; if (ex.ps && ex.lm && ex.di) break; }
  console.log("=== public_splits example keys ==="); console.log(JSON.stringify(ex.ps ?? {}, null, 1));
  console.log("\n=== line_movement example keys ==="); console.log(JSON.stringify(ex.lm ?? {}, null, 1));
  console.log("\n=== data_integrity example keys ==="); console.log(JSON.stringify(ex.di ?? {}, null, 1));

  // coverage by market
  const markets = ["moneyline", "total", "first_inning"];
  console.log("\n=== COVERAGE by market (non-null counts) ===");
  for (const m of markets) {
    const mr = rows.filter((r: any) => r.market === m);
    const n = mr.length;
    const c = (f: (sj: any) => boolean) => mr.filter((r: any) => f(r.snapshot_json ?? {})).length;
    console.log(`\n${m} (n=${n}):`);
    console.log(`  public_splits present:        ${c(sj => !!sj.public_splits)} (${(100 * c(sj => !!sj.public_splits) / n).toFixed(0)}%)`);
    console.log(`  picked_money_pct non-null:    ${c(sj => sj.public_splits?.picked_money_pct != null)}`);
    console.log(`  picked_bets_pct non-null:     ${c(sj => sj.public_splits?.picked_bets_pct != null)}`);
    console.log(`  splits conflict==true:        ${c(sj => sj.public_splits?.conflict === true)}`);
    console.log(`  splits support==true:         ${c(sj => sj.public_splits?.support === true)}`);
    console.log(`  line_movement present:        ${c(sj => !!sj.line_movement)} (${(100 * c(sj => !!sj.line_movement) / n).toFixed(0)}%)`);
    console.log(`  lm.direction != unknown/null: ${c(sj => sj.line_movement?.direction && sj.line_movement.direction !== "unknown")}`);
    console.log(`  lm.has_reverse_line_movement: ${c(sj => sj.line_movement?.has_reverse_line_movement === true)}`);
    console.log(`  lm.has_steam_move==true:      ${c(sj => sj.line_movement?.has_steam_move === true)}`);
    console.log(`  lm.open_odds present:         ${c(sj => sj.line_movement?.open_odds_american != null)}`);
    console.log(`  lm.current_odds present:      ${c(sj => sj.line_movement?.current_odds_american != null)}`);
    console.log(`  di present:                   ${c(sj => !!sj.data_integrity)}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
