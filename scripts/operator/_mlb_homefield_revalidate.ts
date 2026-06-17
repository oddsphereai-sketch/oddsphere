/** READ-ONLY — faithful re-validation of the INDEPENDENT-level home-field
 * differential through the blend. Pick is on posterior; an independent margin
 * shift Δ propagates to posterior as w·Δ (w=trust_independent, market side fixed).
 * Tests independent-level 0.22 vs post-blend 0.22. */
import { supabase } from "../../lib/db/supabase";
import { homeWinProbabilityPoisson } from "../../lib/automodel/runDistribution";
const START = "2026-06-07", SIX14 = "2026-06-14", OOS = "2026-06-15";
type R = { date: string; pHome: number; pAway: number; w: number; storedPick: string | null; hs: number; as_: number };

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, game_id, pick, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").eq("market", "moneyline").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>(); for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, home_score, away_score").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: R[] = recs.map((r: any) => { const a = r.snapshot_json?.v2_2_audit ?? {}; const g = gmap.get(r.game_id) ?? {}; return { date: String(r.slate_date), pHome: a.posterior_home_runs, pAway: a.posterior_away_runs, w: typeof a.trust_independent === "number" ? a.trust_independent : 1, storedPick: r.pick, hs: g.home_score, as_: g.away_score }; })
    .filter((r: any) => r.pHome != null && r.pAway != null && r.hs != null && r.as_ != null && r.hs !== r.as_);

  function wl(shiftFn: (r: R) => number) { // shiftFn returns posterior margin half-shift applied (+to home, -to away)
    let w = 0, l = 0, fl = 0; const per = (sub: R[]) => { let ww = 0, ll = 0; for (const r of sub) { const s = shiftFn(r); const ph = homeWinProbabilityPoisson(r.pHome + s, Math.max(0.1, r.pAway - s)); const pick = ph >= 0.5 ? "home" : "away"; const win = pick === "home" ? r.hs > r.as_ : r.as_ > r.hs; if (win) ww++; else ll++; } return { w: ww, l: ll, pct: ww + ll ? 100 * ww / (ww + ll) : 0 }; };
    for (const r of rows) { const s = shiftFn(r); const ph = homeWinProbabilityPoisson(r.pHome + s, Math.max(0.1, r.pAway - s)); const pick = ph >= 0.5 ? "home" : "away"; if (pick !== r.storedPick) fl++; const win = pick === "home" ? r.hs > r.as_ : r.as_ > r.hs; if (win) w++; else l++; }
    return { full: per(rows), x: per(rows.filter(r => r.date !== SIX14)), oos: per(rows.filter(r => r.date >= OOS)), fl };
  }
  const base = wl(() => 0);
  console.log(`\n###### HOME-FIELD IMPL RE-VALIDATION (pick on posterior) ######`);
  console.log(`baseline: ${base.full.w}-${base.full.l} (${base.full.pct.toFixed(0)}%)  excl6/14 ${base.x.pct.toFixed(0)}%  OOS ${base.oos.w}-${base.oos.l}\n`);
  console.log(`avg trust_independent (w): ${(rows.reduce((s, r) => s + r.w, 0) / rows.length).toFixed(2)}\n`);

  console.log(`A) INDEPENDENT-level 0.22 differential (posterior shift = w * 0.11 per side):`);
  for (const D of [0.22, 0.30, 0.40]) {
    const r = wl((row) => row.w * (D / 2));
    console.log(`   indep Δ=${D.toFixed(2)}: ${r.full.w}-${r.full.l} (${r.full.pct.toFixed(0)}%)  excl6/14 ${r.x.pct.toFixed(0)}%  OOS ${r.oos.w}-${r.oos.l}(${r.oos.pct.toFixed(0)}%)  flips ${r.fl}  net ${r.full.w - base.full.w >= 0 ? "+" : ""}${r.full.w - base.full.w}W`);
  }
  console.log(`\nB) POST-BLEND 0.22 differential (full 0.11 per side on posterior — undampened):`);
  for (const D of [0.22, 0.30]) {
    const r = wl(() => D / 2);
    console.log(`   posterior Δ=${D.toFixed(2)}: ${r.full.w}-${r.full.l} (${r.full.pct.toFixed(0)}%)  excl6/14 ${r.x.pct.toFixed(0)}%  OOS ${r.oos.w}-${r.oos.l}(${r.oos.pct.toFixed(0)}%)  flips ${r.fl}  net ${r.full.w - base.full.w >= 0 ? "+" : ""}${r.full.w - base.full.w}W`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
