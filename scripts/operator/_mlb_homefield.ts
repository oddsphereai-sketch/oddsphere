/** READ-ONLY — home-field hypothesis + re-run backtest. Add δ runs to home
 * projection, recompute P(home) via the REAL Poisson, re-pick ML, grade vs
 * actual scores. Side = raw argmax (regularization doesn't change the side). */
import { supabase } from "../../lib/db/supabase";
import { homeWinProbabilityPoisson } from "../../lib/automodel/runDistribution";
const START = "2026-06-07", SIX14 = "2026-06-14", OOS = "2026-06-15";
type R = { date: string; pHome: number | null; pAway: number | null; hs: number | null; as_: number | null; storedPick: string | null; res: string };

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, game_id, market, pick, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").eq("market", "moneyline").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>(); for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, home_score, away_score").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: R[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; const g = gmap.get(r.game_id) ?? {}; return { date: String(r.slate_date), pHome: a.posterior_home_runs ?? null, pAway: a.posterior_away_runs ?? null, hs: g.home_score ?? null, as_: g.away_score ?? null, storedPick: r.pick, res: String(gr?.result ?? "").toLowerCase() }; });
  const dec = rows.filter(r => r.pHome != null && r.pAway != null && r.hs != null && r.as_ != null && r.hs !== r.as_);

  // hypothesis: actual home win% vs model implied P(home)
  const homeWins = dec.filter(r => r.hs! > r.as_!).length;
  const avgPHome = dec.reduce((s, r) => s + homeWinProbabilityPoisson(r.pHome!, r.pAway!), 0) / dec.length;
  console.log(`\n###### HOME-FIELD ANALYSIS (n=${dec.length} decided ML) ######`);
  console.log(`actual home win rate: ${(100 * homeWins / dec.length).toFixed(1)}%`);
  console.log(`model avg P(home):    ${(100 * avgPHome).toFixed(1)}%   → gap = ${(100 * (homeWins / dec.length - avgPHome)).toFixed(1)}pp (model under-rates home if positive)`);
  const avgDiff = dec.reduce((s, r) => s + (r.pHome! - r.pAway!), 0) / dec.length;
  const actDiff = dec.reduce((s, r) => s + (r.hs! - r.as_!), 0) / dec.length;
  console.log(`projected home-away margin: ${avgDiff.toFixed(2)}  vs actual: ${actDiff.toFixed(2)}  → missing home-field ≈ ${(actDiff - avgDiff).toFixed(2)} runs`);

  console.log(`\n###### HOME-FIELD BUMP RE-RUN (δ runs added to home; re-pick ML; grade vs score) ######`);
  function pickWL(delta: number, subset: R[]) { let w = 0, l = 0, flips = 0; for (const r of subset) { const ph = homeWinProbabilityPoisson(r.pHome! + delta, r.pAway!); const pick = ph >= 0.5 ? "home" : "away"; if (pick !== r.storedPick) flips++; const win = pick === "home" ? r.hs! > r.as_! : r.as_! > r.hs!; if (win) w++; else l++; } return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, flips }; }
  function lodo(delta: number) { const ds = [...new Set(dec.map(r => r.date))]; let lo = 999, hi = -999; for (const d of ds) { const a = pickWL(delta, dec.filter(r => r.date !== d)); if (a.t >= 12) { lo = Math.min(lo, a.pct); hi = Math.max(hi, a.pct); } } return `[${lo.toFixed(0)},${hi.toFixed(0)}]`; }
  console.log(`delta | full record / win% | excl-6/14 | OOS(>=6/15) | flips | LODO win%`);
  for (const d of [0, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]) {
    const full = pickWL(d, dec), x = pickWL(d, dec.filter(r => r.date !== SIX14)), oos = pickWL(d, dec.filter(r => r.date >= OOS));
    const base = pickWL(0, dec);
    console.log(`${d.toFixed(2).padStart(5)} | ${`${full.w}-${full.l} (${full.pct.toFixed(0)}%)`.padEnd(16)} | ${`${x.pct.toFixed(0)}%`.padEnd(5)} | ${`${oos.w}-${oos.l}(${oos.pct.toFixed(0)}%) n${oos.t}`.padEnd(16)} | ${String(full.flips).padEnd(5)} | ${lodo(d)}  net vs δ0: ${full.w - base.w >= 0 ? "+" : ""}${full.w - base.w}W`);
  }
  console.log(`\n(net wins vs δ=0 = ML wins gained across the whole sample; ÷ ${new Set(dec.map(r=>r.date)).size} slates = per-slate)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
