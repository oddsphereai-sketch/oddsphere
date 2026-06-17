/** READ-ONLY — "remove noisy games" analysis. (A) DEPLOYABLE: split by pre-game
 * market LINE range. (B) DIAGNOSTIC: split by actual total (blowout removal,
 * lookahead — understanding only). Find if model is clean on regular games. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14";
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
type R = { date: string; market: string; side: string | null; pick: string | null; grade: string; ba: boolean; odds: number | null; res: string; line: number | null; pHome: number | null; pAway: number | null; pTot: number | null; tot: number | null; hs: number | null; as_: number | null };
function M(rows: R[]) { const g = rows.filter(r => r.res === "win" || r.res === "loss"); const w = g.filter(r => r.res === "win").length, l = g.length - w; let net = 0, n = 0; for (const r of g) { if (r.odds !== null) { n++; net += profit(r.odds, r.res === "win"); } } return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0 }; }
function lodo(rows: R[]): string { const ds = [...new Set(rows.map(r => r.date))]; let lo = 999, hi = -999; for (const d of ds) { const a = M(rows.filter(r => r.date !== d)); if (a.t >= 10) { lo = Math.min(lo, a.roi); hi = Math.max(hi, a.roi); } } return lo === 999 ? "" : ` LODO[${lo.toFixed(0)},${hi.toFixed(0)}]`; }
function L(label: string, rows: R[], min = 8): void { const a = M(rows); if (a.t < min) { if (a.t) console.log(`  ${label.padEnd(30)} n=${a.t} ⚠`); return; } const x = M(rows.filter(r => r.date !== SIX14)); console.log(`  ${label.padEnd(30)} ${`${a.w}-${a.l}(${a.pct.toFixed(0)}%)`.padEnd(12)} ${(a.units >= 0 ? "+" : "") + a.units.toFixed(1)}u/${a.roi.toFixed(0)}%  [exX ${x.pct.toFixed(0)}%/${x.roi.toFixed(0)}%]${lodo(rows)}`); }
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const mae = (a: number[]) => mean(a.map(Math.abs));

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records").select("slate_date, game_id, market, side, pick, play_grade, best_angle, odds_american, line_value, launch_day, no_bet, snapshot_json, prediction_grades(result)").eq("sport", "mlb").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>(); for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, home_score, away_score, total_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: R[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; const g = gmap.get(r.game_id) ?? {}; return { date: String(r.slate_date), market: String(r.market), side: r.side, pick: r.pick, grade: String(r.play_grade ?? "").toLowerCase(), ba: r.best_angle === true, odds: r.odds_american, res: String(gr?.result ?? "").toLowerCase(), line: a.market_total ?? r.line_value ?? null, pHome: a.posterior_home_runs ?? null, pAway: a.posterior_away_runs ?? null, pTot: a.posterior_total ?? null, tot: g.total_runs ?? null, hs: g.home_score ?? null, as_: g.away_score ?? null }; });
  const onB = (r: R) => r.ba || r.grade === "lean";
  const ml = rows.filter(r => r.market === "moneyline"), ou = rows.filter(r => r.market === "total");

  console.log(`\n###### (A) DEPLOYABLE — split by PRE-GAME market LINE range ######`);
  for (const [lo, hi, nm] of [[0, 8, "extreme-low line <8"], [8, 9.5, "REGULAR line 8-9"], [9.5, 99, "high line 9.5+"]] as any[]) {
    const seg = (arr: R[]) => arr.filter(r => r.line != null && r.line >= lo && r.line < hi);
    console.log(`\n-- ${nm} --`);
    L("OU board", seg(ou).filter(onB)); L("Over", seg(ou).filter(r => r.side === "over")); L("Under", seg(ou).filter(r => r.side === "under"));
  }

  console.log(`\n###### (B) DIAGNOSTIC — remove blowouts by ACTUAL total (lookahead; understanding only) ######`);
  for (const [lo, hi, nm] of [[0, 6, "low-scoring <6"], [6, 11, "REGULAR 6-10"], [11, 99, "blowout 11+"]] as any[]) {
    const segG = rows.filter(r => r.tot != null && r.tot >= lo && r.tot < hi);
    const segGames = ou.filter(r => r.tot != null && r.tot >= lo && r.tot < hi && r.pTot != null);
    console.log(`\n-- actual total ${nm} (games=${segGames.length}) --`);
    L("OU board", segG.filter(r => r.market === "total" && onB(r))); L("Over", segG.filter(r => r.market === "total" && r.side === "over")); L("Under", segG.filter(r => r.market === "total" && r.side === "under"));
    L("ML board", segG.filter(r => r.market === "moneyline" && onB(r)));
    if (segGames.length) console.log(`     proj-total bias=${mean(segGames.map(r => r.pTot! - r.tot!)).toFixed(2)} MAE=${mae(segGames.map(r => r.pTot! - r.tot!)).toFixed(2)}`);
  }

  console.log(`\n###### (C) is the model GOOD on regular games? overall on regular-line(8-9) AND non-blowout(<11) ######`);
  const regular = rows.filter(r => r.line != null && r.line >= 8 && r.line < 9.5 && r.tot != null && r.tot < 11);
  L("regular: OU board", regular.filter(r => r.market === "total" && onB(r)));
  L("regular: Over", regular.filter(r => r.market === "total" && r.side === "over"));
  L("regular: Under", regular.filter(r => r.market === "total" && r.side === "under"));
  L("regular: ML board", regular.filter(r => r.market === "moneyline" && onB(r)));
  const rg = ou.filter(r => r.line != null && r.line >= 8 && r.line < 9.5 && r.tot != null && r.tot < 11 && r.pTot != null);
  if (rg.length) console.log(`     regular proj-total bias=${mean(rg.map(r => r.pTot! - r.tot!)).toFixed(2)} MAE=${mae(rg.map(r => r.pTot! - r.tot!)).toFixed(2)} (vs all-games bias −0.72 MAE 3.32)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
