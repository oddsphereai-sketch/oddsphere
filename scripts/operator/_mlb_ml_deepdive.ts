/** READ-ONLY — ML deep dive for loss→win flips. ML side flips ARE gradable from
 * final scores. Tests reliably-WRONG cohorts (flip candidates) + home-field +
 * sharp. Larger sample (through today) + out-of-sample (>=6/15) + LODO. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14", OOS = "2026-06-15";
type R = { date: string; matchup: string; pick: string | null; odds: number | null; p: number | null; mkt: number | null; edge: number | null; runGap: number | null; dir: string | null; pm: number | null; pb: number | null; hs: number | null; as_: number | null; res: string; fc: boolean };
function wl(arr: { win: boolean }[]) { const w = arr.filter(x => x.win).length, l = arr.length - w; return { w, l, t: arr.length, pct: arr.length ? 100 * w / arr.length : 0 }; }
const won = (pick: string, r: R) => pick === "home" ? r.hs! > r.as_! : r.as_! > r.hs!;

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, matchup, game_id, market, pick, odds_american, model_probability, market_probability, edge, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").eq("market", "moneyline").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>(); for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, home_score, away_score").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: R[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; const ps = r.snapshot_json?.public_splits ?? {}; const g = gmap.get(r.game_id) ?? {}; return { date: String(r.slate_date), matchup: String(r.matchup ?? ""), pick: r.pick, odds: r.odds_american, p: r.model_probability, mkt: a.market_home_win_prob ?? null, edge: r.edge, runGap: typeof a.posterior_home_diff === "number" ? Math.abs(a.posterior_home_diff) : null, dir: r.snapshot_json?.line_movement?.direction ?? null, pm: ps.picked_money_pct ?? null, pb: ps.picked_bets_pct ?? null, hs: g.home_score ?? null, as_: g.away_score ?? null, res: String(gr?.result ?? "").toLowerCase(), fc: a.feature_capture != null }; });
  const dec = rows.filter(r => r.hs != null && r.as_ != null && (r.res === "win" || r.res === "loss"));
  console.log(`\n###### ML DEEP DIVE — ${dec.length} decided ML (since ${START}); feature_capture rows: ${rows.filter(r => r.fc).length} ######`);

  const cur = wl(dec.map(r => ({ win: r.res === "win" })));
  console.log(`Overall ML: ${cur.w}-${cur.l} (${cur.pct.toFixed(0)}%)`);
  const slates = new Set(dec.map(r => r.date)).size;
  console.log(`slates: ${slates}  → flips that net +N wins overall = +${(1).toFixed(0)} per ~${(slates).toFixed(0)} slates each\n`);

  // ===== FLIP candidates: cohorts where the model is reliably WRONG (flip → win) =====
  console.log(`## FLIP BACKTEST — current vs FLIPPED (take other side), graded from final score`);
  function flip(label: string, subset: R[]) {
    if (subset.length < 6) { console.log(`  ${label.padEnd(40)} n=${subset.length} ⚠`); return; }
    const curW = wl(subset.map(r => ({ win: r.res === "win" })));
    const flW = wl(subset.map(r => ({ win: won(r.pick === "home" ? "away" : "home", r) })));
    const x = subset.filter(r => r.date !== SIX14); const xCur = wl(x.map(r => ({ win: r.res === "win" }))); const xFl = wl(x.map(r => ({ win: won(r.pick === "home" ? "away" : "home", r) })));
    const oos = subset.filter(r => r.date >= OOS); const oCur = wl(oos.map(r => ({ win: r.res === "win" }))); const oFl = wl(oos.map(r => ({ win: won(r.pick === "home" ? "away" : "home", r) })));
    const net = flW.w - curW.w;
    console.log(`  ${label.padEnd(40)} cur ${curW.w}-${curW.l}(${curW.pct.toFixed(0)}%) → FLIP ${flW.w}-${flW.l}(${flW.pct.toFixed(0)}%)  net ${net >= 0 ? "+" : ""}${net}W  [exX flip ${xFl.t ? xFl.pct.toFixed(0) : "--"}%][OOS≥6/15 cur ${oCur.t ? oCur.pct.toFixed(0) : "--"}%→fl ${oFl.t ? oFl.pct.toFixed(0) : "--"}% n${oos.length}]`);
  }
  const fav = (r: R) => r.odds != null && r.odds < 0, dog = (r: R) => r.odds != null && r.odds > 0;
  flip("low-conviction FAV (run-gap<0.5)", dec.filter(r => fav(r) && r.runGap != null && r.runGap < 0.5));
  flip("modest disagreement edge 2-5pp", dec.filter(r => r.edge != null && r.edge >= 2 && r.edge < 5));
  flip("modest disagreement edge 2-10pp", dec.filter(r => r.edge != null && r.edge >= 2 && r.edge < 10));
  flip("AWAY picks (home-field test)", dec.filter(r => r.pick === "away"));
  flip("AWAY + low run-gap<0.5", dec.filter(r => r.pick === "away" && r.runGap != null && r.runGap < 0.5));
  flip("model picks DOG (vs market fav)", dec.filter(r => dog(r)));
  flip("line moved AGAINST pick", dec.filter(r => r.dir === "against_pick"));
  flip("public tickets heavy on pick (bets-money>=15)", dec.filter(r => r.pm != null && r.pb != null && r.pb - r.pm >= 15));
  flip("low-conviction fav + line against", dec.filter(r => fav(r) && r.runGap != null && r.runGap < 0.5 && r.dir === "against_pick"));

  // ===== reference: cohorts the model gets RIGHT (do NOT flip) =====
  console.log(`\n## KEEP cohorts (model right — flipping would LOSE wins):`);
  const keep = (label: string, subset: R[]) => { if (subset.length < 6) return; const c = wl(subset.map(r => ({ win: r.res === "win" }))); console.log(`  ${label.padEnd(40)} ${c.w}-${c.l} (${c.pct.toFixed(0)}%)`); };
  keep("high-conviction FAV (run-gap>=1)", dec.filter(r => fav(r) && r.runGap != null && r.runGap >= 1));
  keep("HOME picks", dec.filter(r => r.pick === "home"));
  keep("DOG picks", dec.filter(r => dog(r)));
  keep("edge 10pp+", dec.filter(r => r.edge != null && r.edge >= 10));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
