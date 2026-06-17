/**
 * READ-ONLY — MLB prediction-side accuracy + calibration + totals/favorite
 * root-cause (sections 4,5,8,9). Joins prediction_records -> games (actuals)
 * + prediction_grades(result). No writes.
 */
import { supabase } from "../../lib/db/supabase";

const START = "2026-06-07";
type R = {
  date: string; market: string; side: string | null; pick: string | null;
  odds: number | null; p: number | null; mkt: number | null; edge: number | null;
  grade: string; ba: boolean; conf: number | null; res: string;
  // actuals
  hs: number | null; as_: number | null; tot: number | null; fir: number | null;
  // projections
  pHome: number | null; pAway: number | null; pTot: number | null; listed: number | null;
};
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
function agg(rows: R[]) {
  const g = rows.filter(r => r.res === "win" || r.res === "loss");
  const w = g.filter(r => r.res === "win").length, l = g.filter(r => r.res === "loss").length;
  let net = 0, n = 0; for (const r of g) { if (r.odds === null) continue; n++; net += profit(r.odds, r.res === "win"); }
  return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, roi: n ? 100 * net / n : 0, roiN: n, units: net };
}
function L(label: string, rows: R[]): string {
  const a = agg(rows); const warn = a.t < 15 ? " ⚠" : "";
  return `  ${label.padEnd(30)} ${`${a.w}-${a.l} (${a.t ? a.pct.toFixed(0) : "--"}%)`.padEnd(15)} ROI ${a.roi.toFixed(0)}%${a.roiN < a.t ? `[${a.roiN}]` : ""} (n=${a.t})${warn}`;
}
function brier(rows: R[]): string {
  const g = rows.filter(r => (r.res === "win" || r.res === "loss") && r.p !== null);
  if (!g.length) return "n=0";
  let b = 0, ll = 0; for (const r of g) { const y = r.res === "win" ? 1 : 0; const p = Math.min(0.999, Math.max(0.001, r.p!)); b += (p - y) ** 2; ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); }
  return `Brier=${(b / g.length).toFixed(3)} LogLoss=${(ll / g.length).toFixed(3)} n=${g.length}`;
}

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, game_id, market, side, pick, odds_american, model_probability, market_probability, edge, play_grade, best_angle, confidence, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>();
  for (let i = 0; i < gids.length; i += 200) {
    const { data: gs } = await supabase.from("games").select("id, home_score, away_score, total_runs, first_inning_runs").in("id", gids.slice(i, i + 200) as number[]);
    for (const g of (gs ?? []) as any[]) gmap.set(g.id, g);
  }
  const rows: R[] = recs.map((r: any) => {
    const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    const a = r.snapshot_json?.v2_2_audit ?? {}; const g = gmap.get(r.game_id) ?? {};
    return {
      date: String(r.slate_date), market: String(r.market), side: r.side, pick: r.pick,
      odds: r.odds_american, p: r.model_probability, mkt: r.market_probability, edge: r.edge,
      grade: String(r.play_grade ?? "").toLowerCase(), ba: r.best_angle === true, conf: r.confidence,
      res: String(gr?.result ?? "").toLowerCase(),
      hs: g.home_score ?? null, as_: g.away_score ?? null, tot: g.total_runs ?? null, fir: g.first_inning_runs ?? null,
      pHome: a.posterior_home_runs ?? null, pAway: a.posterior_away_runs ?? null, pTot: a.posterior_total ?? null, listed: a.listed_total ?? a.market_total ?? null,
    };
  });
  const cut = (f: (r: R) => boolean) => rows.filter(f);
  const ml = cut(r => r.market === "moneyline"), tot = cut(r => r.market === "total"), fi = cut(r => r.market === "first_inning");

  console.log(`\n###### SECTION 4 — PREDICTION-SIDE ACCURACY (${rows.length} rows, graded join) ######`);
  console.log(`actuals coverage: games-with-score ${rows.filter(r => r.tot !== null).length}/${rows.length}`);

  console.log(`\n-- ML --`);
  console.log(L("ML overall", ml));
  console.log(L("ML model=favorite(odds<0)", ml.filter(r => r.odds !== null && r.odds < 0)));
  console.log(L("ML model=dog(odds>0)", ml.filter(r => r.odds !== null && r.odds > 0)));
  console.log(L("ML home pick", ml.filter(r => r.pick === "home")));
  console.log(L("ML away pick", ml.filter(r => r.pick === "away")));
  console.log(L("ML model AGREES market(edge>=0)", ml.filter(r => r.edge !== null && r.edge >= 0)));
  console.log(L("ML model DISAGREES(edge<0)", ml.filter(r => r.edge !== null && r.edge < 0)));
  console.log("  prob-bucket vs hit:");
  for (const [lo, hi] of [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.75], [0.75, 1.01]]) {
    const b = ml.filter(r => r.p !== null && r.p >= lo && r.p < hi); if (b.length) console.log(L(`   p[${lo},${hi}) exp~${((lo + hi) / 2 * 100).toFixed(0)}%`, b));
  }

  console.log(`\n-- TOTALS (projected vs actual) --`);
  const totA = tot.filter(r => r.tot !== null && r.pTot !== null);
  const bias = totA.map(r => r.pTot! - r.tot!); // + = over-projected
  const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const mae = totA.map(r => Math.abs(r.pTot! - r.tot!));
  console.log(`  projected-total bias (proj-actual): mean ${mean(bias).toFixed(2)} runs (n=${totA.length})  [+ = model too HIGH]`);
  console.log(`  projected-total MAE: ${mean(mae).toFixed(2)} runs`);
  console.log(`  vs market line bias (line-actual): mean ${mean(totA.filter(r => r.listed !== null).map(r => r.listed! - r.tot!)).toFixed(2)}`);
  console.log(L("Total Over", tot.filter(r => r.side === "over")));
  console.log(L("Total Under", tot.filter(r => r.side === "under")));
  console.log("  Under by proj-gap (line - projTotal, bigger=more conviction):");
  console.log(L("   Under gap>=0.5", tot.filter(r => r.side === "under" && r.listed !== null && r.pTot !== null && (r.listed - r.pTot) >= 0.5)));
  console.log(L("   Under gap<0.5 (marginal)", tot.filter(r => r.side === "under" && r.listed !== null && r.pTot !== null && (r.listed - r.pTot) < 0.5)));
  console.log("  Over/Under by prob bucket:");
  for (const side of ["over", "under"]) for (const [lo, hi] of [[0.5, 0.55], [0.55, 0.6], [0.6, 1.01]]) {
    const b = tot.filter(r => r.side === side && r.p !== null && r.p >= lo && r.p < hi); if (b.length) console.log(L(`   ${side} p[${lo},${hi})`, b));
  }

  console.log(`\n###### SECTION 5 — CALIBRATION (predicted vs observed) ######`);
  console.log("  ML/OU prob-bucket calibration:");
  for (const [lo, hi] of [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 1.01]]) {
    const b = cut(r => (r.market === "moneyline" || r.market === "total") && r.p !== null && r.p >= lo && r.p < hi);
    const a = agg(b); if (a.t) console.log(`   p[${lo},${hi}) pred~${((lo + hi) / 2 * 100).toFixed(0)}%  obs ${a.pct.toFixed(0)}%  gap ${(a.pct - (lo + hi) / 2 * 100).toFixed(0)}pp  n=${a.t}`);
  }
  console.log(`  ML:    ${brier(ml)}`);
  console.log(`  Total: ${brier(tot)}`);
  console.log(`  BA:    ${brier(cut(r => r.ba))}`);
  console.log(`  Lean:  ${brier(cut(r => r.grade === "lean"))}`);

  console.log(`\n###### SECTION 8 — TOTAL/UNDER ROOT CAUSE ######`);
  const uL = tot.filter(r => r.side === "under" && r.res === "loss" && r.tot !== null && r.listed !== null);
  const overshoot = uL.map(r => r.tot! - r.listed!); // how many runs over the line the game went
  console.log(`  Under losses n=${uL.length}; avg runs OVER the line on a loss: ${mean(overshoot).toFixed(2)}`);
  console.log(`  Under losses that were BLOWUPS (>=3 over line): ${overshoot.filter(x => x >= 3).length}; CLOSE (<=1 over): ${overshoot.filter(x => x <= 1).length}`);
  console.log(L("Under in BEST ANGLE", tot.filter(r => r.side === "under" && r.ba)));
  console.log(L("Under in LEAN", tot.filter(r => r.side === "under" && r.grade === "lean")));
  console.log(L("Over in BEST ANGLE", tot.filter(r => r.side === "over" && r.ba)));

  console.log(`\n###### SECTION 9 — FAVORITE LEAN ROOT CAUSE ######`);
  const favL = ml.filter(r => r.grade === "lean" && r.odds !== null && r.odds < 0);
  console.log(L("Favorite Lean", favL));
  console.log(L("Dog Lean", ml.filter(r => r.grade === "lean" && r.odds !== null && r.odds > 0)));
  console.log(L("Favorite Best Angle", ml.filter(r => r.ba && r.odds !== null && r.odds < 0)));
  console.log(`  Favorite Lean break-even check (does model prob clear vig?):`);
  let cleared = 0, ncheck = 0;
  for (const r of favL) { if (r.odds !== null && r.p !== null) { ncheck++; const be = -r.odds / (-r.odds + 100); if (r.p >= be) cleared++; } }
  console.log(`   fav Leans where model prob >= break-even: ${cleared}/${ncheck}`);
  console.log(L("Fav Lean home", favL.filter(r => r.pick === "home")));
  console.log(L("Fav Lean away", favL.filter(r => r.pick === "away")));

  console.log(`\n-- FI usability --`);
  console.log(L("FI overall (NRFI+YRFI)", fi));
  console.log(L("FI NRFI(under)", fi.filter(r => r.side === "under")));
  console.log(L("FI YRFI(over)", fi.filter(r => r.side === "over")));
  console.log(`  FI priced rows: ${fi.filter(r => r.odds !== null).length}/${fi.length}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
