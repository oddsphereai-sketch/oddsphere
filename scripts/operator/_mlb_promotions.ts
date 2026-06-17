/** READ-ONLY — POSITIVE upgrade search: under-graded winners, promotion rules,
 * confidence underconfidence, with leave-one-day-out. No writes. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14";
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
type R = { date: string; market: string; side: string | null; pick: string | null; grade: string; ba: boolean; odds: number | null; p: number | null; edge: number | null; tier: string; line: number | null; postDiff: number | null; postTot: number | null; res: string };
function M(rows: R[]) { const g = rows.filter(r => r.res === "win" || r.res === "loss"); const w = g.filter(r => r.res === "win").length, l = g.length - w; let net = 0, n = 0, ps = 0, pn = 0; for (const r of g) { if (r.odds !== null) { n++; net += profit(r.odds, r.res === "win"); } if (r.p !== null) { ps += r.p; pn++; } } const obs = w + l ? 100 * w / (w + l) : 0; return { w, l, t: w + l, pct: obs, units: net, roi: n ? 100 * net / n : 0, avgP: pn ? 100 * ps / pn : 0, gap: pn ? obs - 100 * ps / pn : 0 }; }
function L(label: string, rows: R[], min = 5): void { const a = M(rows); if (a.t < min) { console.log(`  ${label.padEnd(34)} n=${a.t} ⚠ too small`); return; } const x = M(rows.filter(r => r.date !== SIX14)); console.log(`  ${label.padEnd(34)} ${`${a.w}-${a.l}(${a.pct.toFixed(0)}%)`.padEnd(12)} ${(a.units >= 0 ? "+" : "") + a.units.toFixed(1)}u/${a.roi.toFixed(0)}%  calGap=${a.gap.toFixed(0)}  [exX ${x.t ? x.pct.toFixed(0) : "--"}%/${x.roi.toFixed(0)}%]`); }
function lodo(rows: R[]): string { // leave-one-day-out: min daily ROI when each day removed
  const dates = [...new Set(rows.map(r => r.date))]; let worst = 999, best = -999;
  for (const d of dates) { const a = M(rows.filter(r => r.date !== d)); if (a.t >= 8) { worst = Math.min(worst, a.roi); best = Math.max(best, a.roi); } }
  return worst === 999 ? "n/a" : `LODO ROI range [${worst.toFixed(0)}%,${best.toFixed(0)}%]`;
}

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records").select("slate_date, game_id, market, side, pick, play_grade, best_angle, odds_american, model_probability, edge, line_value, launch_day, no_bet, snapshot_json, prediction_grades(result)").eq("sport", "mlb").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>(); for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, total_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: R[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; return { date: String(r.slate_date), market: String(r.market), side: r.side, pick: r.pick, grade: String(r.play_grade ?? "").toLowerCase(), ba: r.best_angle === true, odds: r.odds_american, p: r.model_probability, edge: r.edge, tier: String(a.data_quality_tier ?? ""), line: a.market_total ?? r.line_value ?? null, postDiff: a.posterior_home_diff ?? null, postTot: a.posterior_total ?? null, res: String(gr?.result ?? "").toLowerCase() }; });
  const ev = (r: R) => r.p != null && r.odds != null ? r.p * (r.odds > 0 ? r.odds / 100 : 100 / -r.odds) - (1 - r.p) : null;
  const ml = rows.filter(r => r.market === "moneyline"), ou = rows.filter(r => r.market === "total");

  console.log(`\n###### POSITIVE-UPGRADE SEARCH (n=${rows.length}) ######`);

  console.log(`\n## 1. OFF-BOARD cohorts — are we leaving winners ungraded?`);
  L("provisional (off-board)", rows.filter(r => r.grade === "provisional"));
  L("market_aligned (off-board)", rows.filter(r => r.grade === "market_aligned"));
  L("  market_aligned w/ |edge|>=1 but graded MA", rows.filter(r => r.grade === "market_aligned" && r.edge != null && Math.abs(r.edge) >= 1));

  console.log(`\n## 2. LEAN subsets that look BA-like (promotion candidates)`);
  const leansNotBA = rows.filter(r => r.grade === "lean" && !r.ba);
  L("all Lean (non-BA)", leansNotBA);
  L("Lean + EV>=0", leansNotBA.filter(r => (ev(r) ?? -1) >= 0));
  L("Lean ML + run-gap>=1", ml.filter(r => r.grade === "lean" && !r.ba && r.postDiff != null && Math.abs(r.postDiff) >= 1));
  L("Lean ML + EV>=0 + run-gap>=1", ml.filter(r => r.grade === "lean" && !r.ba && (ev(r) ?? -1) >= 0 && r.postDiff != null && Math.abs(r.postDiff) >= 1));
  L("Lean OU Over + edge>=3", ou.filter(r => r.grade === "lean" && !r.ba && r.side === "over" && r.edge != null && r.edge >= 3));

  console.log(`\n## 3. FAV conviction cohort by CURRENT grade (is it under-graded?)`);
  const favConv = ml.filter(r => r.odds != null && r.odds < 0 && r.postDiff != null && Math.abs(r.postDiff) >= 1 && (ev(r) ?? -1) >= 0);
  L("FAV EV>=0 run-gap>=1 — ALL", favConv);
  L("  of which already best_angle", favConv.filter(r => r.ba));
  L("  of which lean (promote candidate)", favConv.filter(r => r.grade === "lean" && !r.ba));
  L("  of which off-board (MA/prov)", favConv.filter(r => !r.ba && r.grade !== "lean"));
  console.log(`  ${lodo(favConv)}`);

  console.log(`\n## 4. CONFIDENCE underconfidence (observed > published?)`);
  for (const [lo, hi] of [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.75], [0.75, 1.01]]) {
    const b = rows.filter(r => r.p != null && r.p >= lo && r.p < hi); const a = M(b); if (a.t >= 8) console.log(`  p[${lo},${hi}) published~${((lo + hi) / 2 * 100).toFixed(0)}% observed ${a.pct.toFixed(0)}% gap ${a.gap >= 0 ? "+" : ""}${a.gap.toFixed(0)} ${a.gap > 5 ? "← UNDERconfident" : a.gap < -5 ? "← overconfident" : "(calibrated)"} n=${a.t}`);
  }

  console.log(`\n## 5. Over-promotion overfit check (Lean Over vs environment)`);
  L("Lean Over — full", ou.filter(r => r.grade === "lean" && !r.ba && r.side === "over"));
  console.log(`  ${lodo(ou.filter(r => r.grade === "lean" && r.side === "over"))}  ← if LODO range is wide, it's environment(=this week)-driven`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
