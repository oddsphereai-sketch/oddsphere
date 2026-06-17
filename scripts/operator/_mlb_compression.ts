/** READ-ONLY — projection compression analysis. Are projected scores/totals/
 * margins too clustered vs actual + market? Uses v2_2_audit posterior + games actuals + line. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07";
function stats(a: number[]) { const n = a.length; if (!n) return { n: 0, mean: 0, sd: 0, min: 0, max: 0 }; const mean = a.reduce((x, y) => x + y, 0) / n; const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / n); return { n, mean, sd, min: Math.min(...a), max: Math.max(...a) }; }
const F = (s: ReturnType<typeof stats>) => `n=${s.n} mean=${s.mean.toFixed(2)} sd=${s.sd.toFixed(2)} range=[${s.min.toFixed(1)},${s.max.toFixed(1)}]`;

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("game_id, market, line_value, launch_day, no_bet, snapshot_json")
    .eq("sport", "mlb").gte("slate_date", START).eq("market", "total"); // 1 row/game for totals
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>();
  for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, home_score, away_score, total_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }

  const projHome: number[] = [], projAway: number[] = [], projTot: number[] = [], projDiff: number[] = [], line: number[] = [];
  const actHome: number[] = [], actAway: number[] = [], actTot: number[] = [], actMargin: number[] = [];
  for (const r of recs as any[]) {
    const a = r.snapshot_json?.v2_2_audit ?? {}; const g = gmap.get(r.game_id);
    if (a.posterior_home_runs == null || a.posterior_away_runs == null) continue;
    projHome.push(a.posterior_home_runs); projAway.push(a.posterior_away_runs);
    projTot.push(a.posterior_total ?? a.posterior_home_runs + a.posterior_away_runs);
    projDiff.push(a.posterior_home_diff ?? (a.posterior_home_runs - a.posterior_away_runs));
    const l = a.market_total ?? r.line_value; if (l != null) line.push(l);
    if (g && g.home_score != null && g.away_score != null) { actHome.push(g.home_score); actAway.push(g.away_score); actTot.push(g.total_runs ?? g.home_score + g.away_score); actMargin.push(g.home_score - g.away_score); }
  }

  console.log(`\n###### PROJECTION COMPRESSION ANALYSIS (totals games) ######`);
  console.log(`\n-- TEAM RUNS (per side) --`);
  console.log(`  projected home: ${F(stats(projHome))}`);
  console.log(`  projected away: ${F(stats(projAway))}`);
  console.log(`  ACTUAL home:    ${F(stats(actHome))}`);
  console.log(`  ACTUAL away:    ${F(stats(actAway))}`);
  const projTeam = [...projHome, ...projAway], actTeam = [...actHome, ...actAway];
  console.log(`  projected team-run SD: ${stats(projTeam).sd.toFixed(2)}  vs ACTUAL: ${stats(actTeam).sd.toFixed(2)}  ratio=${(stats(projTeam).sd / stats(actTeam).sd).toFixed(2)} (low=compressed)`);

  console.log(`\n-- TOTAL RUNS --`);
  console.log(`  projected total: ${F(stats(projTot))}`);
  console.log(`  market line:     ${F(stats(line))}`);
  console.log(`  ACTUAL total:    ${F(stats(actTot))}`);
  console.log(`  proj-total SD ${stats(projTot).sd.toFixed(2)} vs line SD ${stats(line).sd.toFixed(2)} vs actual SD ${stats(actTot).sd.toFixed(2)}`);
  console.log(`  ⇒ proj/actual SD ratio = ${(stats(projTot).sd / stats(actTot).sd).toFixed(2)}  | line/actual = ${(stats(line).sd / stats(actTot).sd).toFixed(2)}`);

  console.log(`\n-- RUN DIFFERENTIAL (margin) --`);
  console.log(`  projected run-diff: ${F(stats(projDiff))}`);
  console.log(`  ACTUAL margin:      ${F(stats(actMargin))}`);
  console.log(`  ⇒ proj-diff SD ${stats(projDiff).sd.toFixed(2)} vs actual-margin SD ${stats(actMargin).sd.toFixed(2)}  ratio=${(stats(projDiff).sd / stats(actMargin).sd).toFixed(2)}`);

  console.log(`\n-- BIAS (proj - actual) --`);
  const totBias = projTot.map((p, i) => actTot[i] != null ? p - actTot[i] : null).filter((x): x is number => x != null);
  console.log(`  total bias: ${F(stats(totBias))}  (negative mean = model under-projects scoring)`);

  console.log(`\n-- DISTRIBUTION of projected totals (clustering check) --`);
  const buckets: Record<string, number> = {};
  for (const t of projTot) { const k = (Math.floor(t * 2) / 2).toFixed(1); buckets[k] = (buckets[k] ?? 0) + 1; }
  for (const k of Object.keys(buckets).sort((a, b) => +a - +b)) console.log(`   ${k}: ${"#".repeat(buckets[k])} ${buckets[k]}`);
  console.log(`\n  (if projected totals pile in a narrow 8-9 band while actuals spread 2-16, the model is compressing)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
