/** READ-ONLY — 2-way FACET INTERACTION backtest. Finds actionable cells single-
 * factor cuts miss. Robustness = excl-6/14 + wk split. No writes. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14";
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
type R = { date: string; market: string; side: string | null; grade: string; ba: boolean; odds: number | null; p: number | null; edge: number | null; tier: string; line: number | null; postDiff: number | null; postTot: number | null; temp: number | null; res: string };
function M(rows: R[]) { const g = rows.filter(r => r.res === "win" || r.res === "loss"); const w = g.filter(r => r.res === "win").length, l = g.length - w; let net = 0, n = 0; for (const r of g) { if (r.odds !== null) { n++; net += profit(r.odds, r.res === "win"); } } return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0 }; }
function L(label: string, rows: R[], min = 6): void { const a = M(rows); if (a.t < min) return; const x = M(rows.filter(r => r.date !== SIX14)); const robust = (a.roi > 0) === (x.roi > 0) && a.t >= 12 ? "" : " (thin/unstable)"; console.log(`  ${label.padEnd(34)} ${`${a.w}-${a.l}(${a.pct.toFixed(0)}%)`.padEnd(12)} ${(a.units >= 0 ? "+" : "") + a.units.toFixed(1)}u/${a.roi.toFixed(0)}%  [exX ${x.t ? x.pct.toFixed(0) : "--"}%/${x.roi.toFixed(0)}%]${robust}`); }

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records").select("slate_date, game_id, market, side, play_grade, best_angle, odds_american, model_probability, edge, line_value, launch_day, no_bet, snapshot_json, prediction_grades(result)").eq("sport", "mlb").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>(); for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, total_runs, home_team_id").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const { data: wx } = await supabase.from("weather_forecasts").select("game_id, temperature_f, fetched_at").in("game_id", gids as number[]).order("fetched_at", { ascending: false });
  const wxBy = new Map<number, number>(); for (const w of (wx ?? []) as any[]) if (!wxBy.has(w.game_id)) wxBy.set(w.game_id, w.temperature_f);
  const rows: R[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; return { date: String(r.slate_date), market: String(r.market), side: r.side, grade: String(r.play_grade ?? "").toLowerCase(), ba: r.best_angle === true, odds: r.odds_american, p: r.model_probability, edge: r.edge, tier: String(a.data_quality_tier ?? ""), line: a.market_total ?? r.line_value ?? null, postDiff: a.posterior_home_diff ?? null, postTot: a.posterior_total ?? null, temp: wxBy.get(r.game_id) ?? null, res: String(gr?.result ?? "").toLowerCase() }; });
  const onB = (r: R) => r.ba || r.grade === "lean";
  const ml = rows.filter(r => r.market === "moneyline"), ou = rows.filter(r => r.market === "total");
  const fav = (r: R) => r.odds != null && r.odds < 0, dog = (r: R) => r.odds != null && r.odds > 0;

  console.log(`\n###### FACET INTERACTIONS (board picks; min n shown; [exX]=excl6/14) ######`);

  console.log(`\n-- edge-band × data-quality tier (ML+OU board) --`);
  for (const t of ["high", "low"]) for (const [lo, hi, nm] of [[2, 5, "2-5pp"], [5, 10, "5-10pp"], [10, 99, "10+pp"]] as any[]) L(`tier=${t} edge ${nm}`, rows.filter(r => onB(r) && r.tier === t && r.edge != null && r.edge >= lo && r.edge < hi));

  console.log(`\n-- favorite/dog × projected run-gap (ML board) --`);
  for (const [lo, hi, nm] of [[0, 0.5, "gap<0.5"], [0.5, 1, "gap0.5-1"], [1, 99, "gap1+"]] as any[]) { L(`FAV ${nm}`, ml.filter(r => onB(r) && fav(r) && r.postDiff != null && Math.abs(r.postDiff) >= lo && Math.abs(r.postDiff) < hi)); L(`DOG ${nm}`, ml.filter(r => onB(r) && dog(r) && r.postDiff != null && Math.abs(r.postDiff) >= lo && Math.abs(r.postDiff) < hi)); }

  console.log(`\n-- Over/Under × line-range (OU board) --`);
  for (const side of ["over", "under"]) for (const [lo, hi, nm] of [[0, 8, "<8"], [8, 9, "8-8.5"], [9, 99, "9+"]] as any[]) L(`${side} line ${nm}`, ou.filter(r => onB(r) && r.side === side && r.line != null && r.line >= lo && r.line < hi));

  console.log(`\n-- Over/Under × temp (OU board) --`);
  for (const side of ["over", "under"]) for (const [lo, hi, nm] of [[0, 70, "<70F"], [70, 80, "70-80F"], [80, 200, ">=80F"]] as any[]) L(`${side} ${nm}`, ou.filter(r => onB(r) && r.side === side && r.temp != null && r.temp >= lo && r.temp < hi));

  console.log(`\n-- Over/Under × projected-gap (OU board) --`);
  for (const side of ["over", "under"]) for (const [lo, hi, nm] of [[-99, -0.25, "proj<line"], [-0.25, 0.25, "~line"], [0.25, 99, "proj>line"]] as any[]) L(`${side} ${nm}`, ou.filter(r => onB(r) && r.side === side && r.postTot != null && r.line != null && (r.postTot - r.line) >= lo && (r.postTot - r.line) < hi));

  console.log(`\n-- grade × market × side: PROFITABILITY of each public cell --`);
  for (const g of ["best_angle", "lean"]) for (const m of ["moneyline", "total"]) for (const s of (m === "moneyline" ? ["home", "away"] : ["over", "under"])) L(`${g} ${m} ${s}`, rows.filter(r => (g === "best_angle" ? r.ba : (r.grade === "lean" && !r.ba)) && r.market === m && r.side === s));

  console.log(`\n-- EV-sign × favorite/dog (board) --`);
  const ev = (r: R) => r.p != null && r.odds != null ? r.p * (r.odds > 0 ? r.odds / 100 : 100 / -r.odds) - (1 - r.p) : null;
  L("FAV EV>=0", ml.filter(r => onB(r) && fav(r) && (ev(r) ?? -1) >= 0)); L("FAV EV<0", ml.filter(r => onB(r) && fav(r) && (ev(r) ?? 1) < 0));
  L("DOG EV>=0", ml.filter(r => onB(r) && dog(r) && (ev(r) ?? -1) >= 0)); L("DOG EV<0", ml.filter(r => onB(r) && dog(r) && (ev(r) ?? 1) < 0));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
