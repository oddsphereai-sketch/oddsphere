/**
 * READ-ONLY MLB model research report. Rerun after each slate to track what is
 * working / failing and whether candidate changes are ship/hold/reject.
 *
 *   npm run mlb:model-research-report -- --date 2026-06-15   (since date; default = public tracking start)
 *
 * No DB writes. No locked-row mutation. ROI shown only where real odds exist.
 * Anchors on STORED grades (actual tracking) — faithful by construction.
 */
import { supabase } from "../lib/db/supabase";

const TRACKING_START = "2026-06-07";
const arg = process.argv.find((a) => a.startsWith("--date"));
const SINCE = arg ? (arg.includes("=") ? arg.split("=")[1] : process.argv[process.argv.indexOf(arg) + 1]) : TRACKING_START;

type R = {
  date: string; market: string; side: string | null; pick: string | null; grade: string; ba: boolean;
  odds: number | null; p: number | null; edge: number | null; tier: string; line: number | null;
  postDiff: number | null; postTot: number | null; res: string; tot: number | null; temp: number | null; park: number | null;
};
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
function A(rows: R[]) {
  const g = rows.filter((r) => r.res === "win" || r.res === "loss");
  const w = g.filter((r) => r.res === "win").length, l = g.length - w;
  let net = 0, n = 0, ps = 0, pn = 0;
  for (const r of g) { if (r.odds !== null) { n++; net += profit(r.odds, r.res === "win"); } if (r.p !== null) { ps += r.p; pn++; } }
  const obs = w + l ? 100 * w / (w + l) : 0;
  return { w, l, t: w + l, pct: obs, units: net, roi: n ? 100 * net / n : 0, priced: n, avgP: pn ? 100 * ps / pn : 0, gap: pn ? obs - 100 * ps / pn : 0 };
}
function L(label: string, rows: R[], cal = false): void {
  const a = A(rows); if (!a.t) return;
  const roi = a.priced ? `${a.units >= 0 ? "+" : ""}${a.units.toFixed(1)}u/${a.roi.toFixed(0)}%` : "ROI n/a (unpriced)";
  const c = cal ? `  calGap=${a.gap.toFixed(0)}` : "";
  console.log(`  ${label.padEnd(30)} ${`${a.w}-${a.l} (${a.pct.toFixed(0)}%)`.padEnd(15)} ${roi}${c}`);
}
function brier(rows: R[]): string {
  const g = rows.filter((r) => (r.res === "win" || r.res === "loss") && r.p !== null);
  if (!g.length) return "n=0";
  let b = 0, ece = 0; const bins: Record<string, { p: number; y: number; n: number }> = {};
  for (const r of g) { const y = r.res === "win" ? 1 : 0; const p = Math.min(0.999, Math.max(0.001, r.p!)); b += (p - y) ** 2; const k = String(Math.floor(p * 10)); (bins[k] ??= { p: 0, y: 0, n: 0 }); bins[k].p += p; bins[k].y += y; bins[k].n++; }
  for (const k in bins) { const bb = bins[k]; ece += (bb.n / g.length) * Math.abs(bb.p / bb.n - bb.y / bb.n); }
  return `Brier=${(b / g.length).toFixed(3)} ECE=${ece.toFixed(3)} n=${g.length}`;
}

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, game_id, market, side, pick, play_grade, best_angle, odds_american, model_probability, edge, line_value, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", SINCE);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>(), homeTeam = new Map<number, number>();
  for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, home_team_id, total_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) { gmap.set(g.id, g); homeTeam.set(g.id, g.home_team_id); } }
  const { data: parks } = await supabase.from("ballparks").select("team_id, park_factor_runs");
  const parkBy = new Map<number, number>(); for (const p of (parks ?? []) as any[]) parkBy.set(p.team_id, p.park_factor_runs);
  const { data: wx } = await supabase.from("weather_forecasts").select("game_id, temperature_f, fetched_at").in("game_id", gids as number[]).order("fetched_at", { ascending: false });
  const wxBy = new Map<number, number>(); for (const w of (wx ?? []) as any[]) if (!wxBy.has(w.game_id)) wxBy.set(w.game_id, w.temperature_f);

  const rows: R[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; const home = homeTeam.get(r.game_id); return { date: String(r.slate_date), market: String(r.market), side: r.side, pick: r.pick, grade: String(r.play_grade ?? "").toLowerCase(), ba: r.best_angle === true, odds: r.odds_american, p: r.model_probability, edge: r.edge, tier: String(a.data_quality_tier ?? ""), line: a.market_total ?? r.line_value ?? null, postDiff: a.posterior_home_diff ?? null, postTot: a.posterior_total ?? null, res: String(gr?.result ?? "").toLowerCase(), tot: gmap.get(r.game_id)?.total_runs ?? null, temp: wxBy.get(r.game_id) ?? null, park: home != null ? parkBy.get(home) ?? null : null }; });
  const onBoard = (r: R) => r.ba || r.grade === "lean";
  const ml = rows.filter((r) => r.market === "moneyline"), ou = rows.filter((r) => r.market === "total"), fi = rows.filter((r) => r.market === "first_inning");

  console.log(`\n${"=".repeat(80)}\nMLB MODEL RESEARCH REPORT — since ${SINCE} (read-only, n=${rows.length})\n${"=".repeat(80)}`);
  console.log(`\n## PUBLIC BOARD`); L("Board (BA+Lean)", rows.filter(onBoard)); L("Best Angle", rows.filter((r) => r.ba)); L("Lean", rows.filter((r) => r.grade === "lean" && !r.ba));
  console.log(`\n## ML by cut`);
  L("ML board", ml.filter(onBoard), true); L("ML favorite", ml.filter((r) => onBoard(r) && r.odds != null && r.odds < 0)); L("ML dog", ml.filter((r) => onBoard(r) && r.odds != null && r.odds > 0)); L("ML home", ml.filter((r) => onBoard(r) && r.pick === "home")); L("ML away", ml.filter((r) => onBoard(r) && r.pick === "away"));
  console.log("  prob band:"); for (const [lo, hi] of [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 1.01]]) L(`   p[${lo},${hi})`, ml.filter((r) => r.p != null && r.p >= lo && r.p < hi), true);
  console.log("  edge band:"); for (const [lo, hi, nm] of [[-99, 0, "neg"], [0, 2, "0-2"], [2, 5, "2-5"], [5, 10, "5-10"], [10, 99, "10+"]] as any[]) L(`   edge ${nm}pp`, ml.filter((r) => r.edge != null && r.edge >= lo && r.edge < hi));
  console.log("  data-quality tier:"); for (const t of ["high", "medium", "low", "fallback"]) L(`   tier=${t}`, ml.filter((r) => r.tier === t));
  console.log(`\n## O/U by cut`);
  L("OU board", ou.filter(onBoard)); L("Over", ou.filter((r) => r.side === "over")); L("Under", ou.filter((r) => r.side === "under"));
  console.log("  projected-total gap (postTot - line):"); for (const [lo, hi, nm] of [[-99, -0.5, "<-0.5"], [-0.5, 0.5, "~line"], [0.5, 99, ">+0.5"]] as any[]) L(`   gap ${nm}`, ou.filter((r) => r.postTot != null && r.line != null && (r.postTot - r.line) >= lo && (r.postTot - r.line) < hi));
  console.log("  total line range:"); for (const [lo, hi, nm] of [[0, 8, "<8"], [8, 9, "8-8.5"], [9, 99, "9+"]] as any[]) L(`   line ${nm}`, ou.filter((r) => r.line != null && r.line >= lo && r.line < hi));
  console.log("  temp bucket:"); for (const [lo, hi, nm] of [[0, 65, "<65F"], [65, 80, "65-80F"], [80, 200, ">=80F"]] as any[]) L(`   ${nm}`, ou.filter((r) => r.temp != null && r.temp >= lo && r.temp < hi));
  console.log(`  park: ${rows.filter((r) => r.park != null).length}/${rows.length} have park factor (note: low variance in current data)`);
  console.log("  tier:"); for (const t of ["high", "low"]) L(`   tier=${t}`, ou.filter((r) => r.tier === t));
  console.log(`\n## FI (accuracy; ROI only where priced)`);
  L("FI all", fi); L("NRFI", fi.filter((r) => r.side === "under")); L("YRFI", fi.filter((r) => r.side === "over"));
  console.log(`  FI priced rows: ${fi.filter((r) => r.odds != null).length}/${fi.length} → FI ROI ${fi.filter((r) => r.odds != null).length ? "partial" : "NOT measurable (vendor FI-price gap)"}`);
  console.log(`\n## CALIBRATION`); console.log(`  ML:    ${brier(ml)}`); console.log(`  Total: ${brier(ou)}`); console.log(`  Board: ${brier(rows.filter(onBoard))}`);
  console.log(`\n## DAILY`); for (const d of [...new Set(rows.map((r) => r.date))].sort()) L(d, rows.filter((r) => r.date === d && onBoard(r)));
  console.log(`\n## CANDIDATE STATUS (vs research sprint; re-evaluate as data grows)`);
  console.log(`  EV-favorite gate ....... ship-eligible (coherence; doesn't empty board)`);
  console.log(`  R1 (Lean p>=.55) ....... HOLD (empties board)`);
  console.log(`  totals mean-correction . sample-blocked (need 2nd clean week + low-scoring env)`);
  console.log(`  weather/temp totals .... watchlist (hot-game signal, n too small)`);
  console.log(`  run-gap / low-line ..... sample-blocked (wk1-only)`);
  console.log(`  overdispersion ......... REJECT (wrong mechanism)`);
  console.log(`\n(reads stored grades = actual tracking; no DB writes performed)`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
