/** READ-ONLY — prediction/projection-layer audit: projection bias by bucket,
 * ML winner accuracy, and the decisive public-trap O/U side-FLIP test (checking
 * Over vs Under split to separate signal from high-scoring-week confound). */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14";
function mean(a: number[]) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function mae(a: number[]) { return a.length ? mean(a.map(Math.abs)) : 0; }
type R = { date: string; market: string; side: string | null; pick: string | null; odds: number | null; res: string;
  pHome: number | null; pAway: number | null; pTot: number | null; pDiff: number | null; line: number | null;
  pm: number | null; pb: number | null; hs: number | null; as_: number | null; tot: number | null };

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records").select("slate_date, game_id, market, side, pick, odds_american, launch_day, no_bet, line_value, snapshot_json, prediction_grades(result)").eq("sport", "mlb").gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>(); for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, home_score, away_score, total_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: R[] = recs.map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; const ps = r.snapshot_json?.public_splits ?? {}; const g = gmap.get(r.game_id) ?? {}; return { date: String(r.slate_date), market: String(r.market), side: r.side, pick: r.pick, odds: r.odds_american, res: String(gr?.result ?? "").toLowerCase(), pHome: a.posterior_home_runs ?? null, pAway: a.posterior_away_runs ?? null, pTot: a.posterior_total ?? null, pDiff: a.posterior_home_diff ?? null, line: a.market_total ?? r.line_value ?? null, pm: ps.picked_money_pct ?? null, pb: ps.picked_bets_pct ?? null, hs: g.home_score ?? null, as_: g.away_score ?? null, tot: g.total_runs ?? null }; });

  // one row per game for projection (use total rows; they carry posterior)
  const games = rows.filter(r => r.market === "total" && r.pHome != null && r.hs != null);

  console.log(`\n###### PROJECTION-ERROR AUDIT (n=${games.length} games w/ actuals) ######`);
  console.log(`\n## Signed bias (projected - actual): negative = under-projected`);
  console.log(`  home runs: bias=${mean(games.map(g => g.pHome! - g.hs!)).toFixed(2)} MAE=${mae(games.map(g => g.pHome! - g.hs!)).toFixed(2)}`);
  console.log(`  away runs: bias=${mean(games.map(g => g.pAway! - g.as_!)).toFixed(2)} MAE=${mae(games.map(g => g.pAway! - g.as_!)).toFixed(2)}`);
  console.log(`  total:     bias=${mean(games.map(g => g.pTot! - g.tot!)).toFixed(2)} MAE=${mae(games.map(g => g.pTot! - g.tot!)).toFixed(2)}`);
  console.log(`  margin(h-a): proj mean=${mean(games.map(g => g.pDiff!)).toFixed(2)} actual mean=${mean(games.map(g => g.hs! - g.as_!)).toFixed(2)}`);
  console.log(`  → home-field check: proj home-away diff ${mean(games.map(g => g.pHome! - g.pAway!)).toFixed(2)} vs actual ${mean(games.map(g => g.hs! - g.as_!)).toFixed(2)}`);

  // ML winner accuracy + home-field correction test
  const ml = rows.filter(r => r.market === "moneyline" && (r.res === "win" || r.res === "loss"));
  const mlHome = ml.filter(r => r.pick === "home"), mlAway = ml.filter(r => r.pick === "away");
  const acc = (a: R[]) => a.length ? (100 * a.filter(r => r.res === "win").length / a.length).toFixed(0) : "--";
  console.log(`\n## ML winner accuracy: home-pick ${acc(mlHome)}% (n=${mlHome.length})  away-pick ${acc(mlAway)}% (n=${mlAway.length})`);

  // DECISIVE: public-trap O/U side-flip test, SPLIT by Over/Under
  console.log(`\n## PUBLIC-TRAP O/U side-FLIP test (does flipping the trapped side win?)`);
  const totF = rows.filter(r => r.market === "total" && r.tot != null && r.line != null && r.tot !== r.line && r.pm != null && r.pb != null);
  const trap = (r: R) => (r.pb! - r.pm!) >= 15;
  const won = (side: string, r: R) => side === "over" ? r.tot! > r.line! : r.tot! < r.line!;
  function flipReport(label: string, subset: R[]) {
    if (subset.length < 5) { console.log(`  ${label}: n=${subset.length} ⚠ too small`); return; }
    let keepW = 0, flipW = 0; for (const r of subset) { if (won(r.side!, r)) keepW++; if (won(r.side === "over" ? "under" : "over", r)) flipW++; }
    const x = subset.filter(r => r.date !== SIX14);
    let kx = 0; for (const r of x) if (won(r.side!, r)) kx++;
    console.log(`  ${label.padEnd(30)} n=${subset.length}  KEEP ${keepW}-${subset.length - keepW} (${(100 * keepW / subset.length).toFixed(0)}%)  FLIP ${flipW}-${subset.length - flipW} (${(100 * flipW / subset.length).toFixed(0)}%)  [exX keep ${x.length ? (100 * kx / x.length).toFixed(0) : "--"}%]`);
  }
  flipReport("ALL trap O/U", totF.filter(trap));
  flipReport("  trap OVER picks", totF.filter(r => trap(r) && r.side === "over"));
  flipReport("  trap UNDER picks", totF.filter(r => trap(r) && r.side === "under"));
  flipReport("NON-trap O/U (control)", totF.filter(r => !trap(r)));
  flipReport("  non-trap OVER", totF.filter(r => !trap(r) && r.side === "over"));
  flipReport("  non-trap UNDER", totF.filter(r => !trap(r) && r.side === "under"));
  console.log(`\n  KEY: if trap flips win for BOTH Over+Under → real prediction signal. If only Under flips win → high-scoring-week confound (reject as prediction change).`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
