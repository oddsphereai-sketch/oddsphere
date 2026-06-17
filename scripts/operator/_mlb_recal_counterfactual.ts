/**
 * READ-ONLY — Section 6 (recalibration dry-run) + Section 7 (counterfactual
 * probability/weight sims). All SIMULATED on stored model_probability/edge;
 * no model re-run, no writes. Probability remaps do NOT change pick side
 * unless explicitly stated (totals flip test). Labels sims clearly.
 */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07";
type R = { date: string; market: string; side: string | null; odds: number | null; p: number | null; mkt: number | null; edge: number | null; grade: string; ba: boolean; res: string; tot: number | null; listed: number | null; };
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
function metrics(rows: { p: number | null; res: string; odds: number | null }[]) {
  const g = rows.filter(r => r.res === "win" || r.res === "loss");
  if (!g.length) return { brier: 0, ll: 0, ece: 0, n: 0, w: 0, roi: 0 };
  let b = 0, ll = 0; const bins: Record<string, { p: number; y: number; n: number }> = {};
  for (const r of g) { const y = r.res === "win" ? 1 : 0; const p = Math.min(0.999, Math.max(0.001, r.p!)); b += (p - y) ** 2; ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); const k = String(Math.floor(p * 10)); (bins[k] ??= { p: 0, y: 0, n: 0 }); bins[k].p += p; bins[k].y += y; bins[k].n++; }
  let ece = 0; for (const k in bins) { const bb = bins[k]; ece += (bb.n / g.length) * Math.abs(bb.p / bb.n - bb.y / bb.n); }
  let net = 0, n = 0, w = 0; for (const r of g) { if (r.res === "win") w++; if (r.odds === null) continue; n++; net += profit(r.odds, r.res === "win"); }
  return { brier: b / g.length, ll: ll / g.length, ece, n: g.length, w, roi: n ? 100 * net / n : 0 };
}
function showCal(label: string, rows: R[], remap: (r: R) => number | null): void {
  const mapped = rows.map(r => ({ p: remap(r), res: r.res, odds: r.odds }));
  const m0 = metrics(rows.map(r => ({ p: r.p, res: r.res, odds: r.odds }))); const m1 = metrics(mapped);
  console.log(`  ${label.padEnd(34)} Brier ${m0.brier.toFixed(3)}→${m1.brier.toFixed(3)}  LogLoss ${m0.ll.toFixed(3)}→${m1.ll.toFixed(3)}  ECE ${m0.ece.toFixed(3)}→${m1.ece.toFixed(3)}  (n=${m1.n})`);
}

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, game_id, market, side, line_value, odds_american, model_probability, market_probability, edge, play_grade, best_angle, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>();
  for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, total_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: R[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; return { date: String(r.slate_date), market: String(r.market), side: r.side, odds: r.odds_american, p: r.model_probability, mkt: r.market_probability, edge: r.edge, grade: String(r.play_grade ?? "").toLowerCase(), ba: r.best_angle === true, res: String(gr?.result ?? "").toLowerCase(), tot: gmap.get(r.game_id)?.total_runs ?? null, listed: r.line_value ?? a.listed_total ?? null }; });
  const mlou = rows.filter(r => (r.market === "moneyline" || r.market === "total") && r.p !== null);

  console.log(`\n###### SECTION 6 — RECALIBRATION DRY-RUN (ML/OU, n=${mlou.length}) — SIMULATED ######`);
  console.log("  (probability remap; side unchanged; lower=better Brier/LogLoss/ECE)");
  // global per-bucket isotonic-ish: map each 0.05 bucket to its observed hit-rate
  const buck = (p: number) => Math.floor(p / 0.05);
  const obs: Record<number, { w: number; n: number }> = {};
  for (const r of mlou) if (r.res === "win" || r.res === "loss") { const k = buck(r.p!); (obs[k] ??= { w: 0, n: 0 }); obs[k].w += r.res === "win" ? 1 : 0; obs[k].n++; }
  const isoMap = (r: R) => { const k = buck(r.p!); const b = obs[k]; return b && b.n >= 8 ? b.w / b.n : r.p; };
  showCal("simple bucket remap (n>=8)", mlou, isoMap);
  showCal("shrink-to-market f=0.5", mlou, r => r.mkt !== null ? r.mkt + 0.5 * (r.p! - r.mkt) : r.p);
  showCal("shrink-to-market f=0.25", mlou, r => r.mkt !== null ? r.mkt + 0.25 * (r.p! - r.mkt) : r.p);
  showCal("shrink 55-65 band only (f=0.4)", mlou, r => (r.p! >= 0.55 && r.p! < 0.65 && r.mkt !== null) ? r.mkt + 0.4 * (r.p! - r.mkt) : r.p);
  showCal("shrink 60-70 band only (f=0.4)", mlou, r => (r.p! >= 0.6 && r.p! < 0.7 && r.mkt !== null) ? r.mkt + 0.4 * (r.p! - r.mkt) : r.p);
  showCal("shrink favorites (ML odds<0, -3pp)", mlou, r => (r.market === "moneyline" && r.odds !== null && r.odds < 0) ? Math.max(0.5, r.p! - 0.03) : r.p);
  showCal("shrink total Unders (-4pp)", mlou, r => (r.market === "total" && r.side === "under") ? Math.max(0.5, r.p! - 0.04) : r.p);
  console.log("  per-MARKET bucket remap:");
  for (const m of ["moneyline", "total"]) { const sub = mlou.filter(r => r.market === m); const o2: Record<number, { w: number; n: number }> = {}; for (const r of sub) if (r.res === "win" || r.res === "loss") { const k = buck(r.p!); (o2[k] ??= { w: 0, n: 0 }); o2[k].w += r.res === "win" ? 1 : 0; o2[k].n++; } showCal(`   ${m} bucket remap (n>=8)`, sub, r => { const b = o2[buck(r.p!)]; return b && b.n >= 8 ? b.w / b.n : r.p; }); }

  console.log(`\n###### SECTION 7 — COUNTERFACTUAL SIMS (grade/ROI impact) ######`);
  // Board = BA+lean. Recompute board ROI under each transform of grade.
  const board = (f: (r: R) => string) => { const b = rows.filter(r => { const g = f(r); return g === "best_angle" || g === "lean"; }); return metrics(b.map(r => ({ p: r.p, res: r.res, odds: r.odds }))); };
  const base = board(r => r.grade);
  const fmt = (m: ReturnType<typeof metrics>) => `${m.w}-${m.n - m.w} (${m.n ? (100 * m.w / m.n).toFixed(0) : "--"}%) ROI ${m.roi.toFixed(0)}% n=${m.n}`;
  console.log(`  BASELINE board: ${fmt(base)}`);

  // C1 — EV>=0 Lean gate (grade-ladder; demote Leans with negative vig-inclusive EV)
  const evPos = (r: R) => { if (r.odds === null || r.p === null) return true; const ev = r.odds > 0 ? r.p * (r.odds / 100) - (1 - r.p) : r.p * (100 / -r.odds) - (1 - r.p); return ev >= 0; };
  console.log(`  C1 EV>=0 Lean gate:        ${fmt(board(r => (r.grade === "lean" && !evPos(r)) ? "market_aligned" : r.grade))}`);
  // C2 — fade modest disagreement: edge in 2-10pp -> demote lean to market_aligned
  console.log(`  C2 fade 2-10pp Lean:       ${fmt(board(r => (r.grade === "lean" && r.edge !== null && Math.abs(r.edge) >= 2 && Math.abs(r.edge) < 10) ? "market_aligned" : r.grade))}`);
  // C3 — R1 prob>=0.55
  console.log(`  C3 R1 (p>=0.55 Lean):      ${fmt(board(r => (r.grade === "lean" && r.p !== null && r.p < 0.55) ? "market_aligned" : r.grade))}`);
  // C4 — EV gate + R1 combined
  console.log(`  C4 EV>=0 + R1:             ${fmt(board(r => (r.grade === "lean" && (r.p === null || r.p < 0.55 || !evPos(r))) ? "market_aligned" : r.grade))}`);
  // C5 — EV gate applied to ALL grades (incl Best Angle)
  console.log(`  C5 EV>=0 ALL grades:       ${fmt(board(r => (!evPos(r)) ? "market_aligned" : r.grade))}`);

  console.log(`\n  --- Poisson-tail / Under-flip test (totals only, computed from actual total vs line) ---`);
  const totF = rows.filter(r => r.market === "total" && r.tot !== null && r.listed !== null && r.tot !== r.listed);
  const won = (side: string, r: R) => side === "over" ? r.tot! > r.listed! : r.tot! < r.listed!;
  let uW = 0, uL = 0, flipW = 0, flipL = 0;
  for (const r of totF.filter(r => r.side === "under")) { if (won("under", r)) uW++; else uL++; if (won("over", r)) flipW++; else flipL++; }
  console.log(`  Current Under picks:  ${uW}-${uL} (${(100 * uW / (uW + uL)).toFixed(0)}%)`);
  console.log(`  If those FLIPPED to Over: ${flipW}-${flipL} (${(100 * flipW / (flipW + flipL)).toFixed(0)}%)  [tests "model on wrong side of totals"]`);
  let oW = 0, oL = 0; for (const r of totF.filter(r => r.side === "over")) { if (won("over", r)) oW++; else oL++; }
  console.log(`  Current Over picks:   ${oW}-${oL} (${(100 * oW / (oW + oL)).toFixed(0)}%)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
