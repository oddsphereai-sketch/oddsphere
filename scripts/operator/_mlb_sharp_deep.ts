/** READ-ONLY — deep sharp-money / public-betting examination for actionable
 * patterns. Clean splits (SharpAPI), not contaminated by blocked books. LODO. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14";
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
type R = { date: string; market: string; side: string | null; grade: string; ba: boolean; odds: number | null; p: number | null; edge: number | null; postDiff: number | null;
  pm: number | null; pb: number | null; om: number | null; ob: number | null; res: string };
function M(rows: R[]) { const g = rows.filter(r => r.res === "win" || r.res === "loss"); const w = g.filter(r => r.res === "win").length, l = g.length - w; let net = 0, n = 0; for (const r of g) { if (r.odds !== null) { n++; net += profit(r.odds, r.res === "win"); } } return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0 }; }
function lodo(rows: R[]): string { const dates = [...new Set(rows.map(r => r.date))]; let lo = 999, hi = -999; for (const d of dates) { const a = M(rows.filter(r => r.date !== d)); if (a.t >= 10) { lo = Math.min(lo, a.roi); hi = Math.max(hi, a.roi); } } return lo === 999 ? "LODO n/a" : `LODO[${lo.toFixed(0)},${hi.toFixed(0)}]`; }
function L(label: string, rows: R[], min = 8): void { const a = M(rows); if (a.t < min) { if (a.t > 0) console.log(`  ${label.padEnd(34)} n=${a.t} ⚠ small`); return; } const x = M(rows.filter(r => r.date !== SIX14)); console.log(`  ${label.padEnd(34)} ${`${a.w}-${a.l}(${a.pct.toFixed(0)}%)`.padEnd(12)} ${(a.units >= 0 ? "+" : "") + a.units.toFixed(1)}u/${a.roi.toFixed(0)}%  [exX ${x.pct.toFixed(0)}%/${x.roi.toFixed(0)}%] ${lodo(rows)}`); }

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records").select("slate_date, game_id, market, side, play_grade, best_angle, odds_american, model_probability, edge, launch_day, no_bet, snapshot_json, prediction_grades(result)").eq("sport", "mlb").gte("slate_date", START);
  const rows: R[] = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true).map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; const ps = r.snapshot_json?.public_splits ?? {}; return { date: String(r.slate_date), market: String(r.market), side: r.side, grade: String(r.play_grade ?? "").toLowerCase(), ba: r.best_angle === true, odds: r.odds_american, p: r.model_probability, edge: r.edge, postDiff: a.posterior_home_diff ?? null, pm: ps.picked_money_pct ?? null, pb: ps.picked_bets_pct ?? null, om: ps.opp_money_pct ?? null, ob: ps.opp_bets_pct ?? null, res: String(gr?.result ?? "").toLowerCase() }; });
  const withSplits = rows.filter(r => r.pm != null && r.pb != null);
  const onB = (r: R) => r.ba || r.grade === "lean";
  console.log(`\n###### DEEP SHARP/PUBLIC EXAM (splits coverage ${withSplits.length}/${rows.length}) ######`);

  console.log(`\n## A. Public MONEY% on picked side (fine buckets, ALL graded)`);
  for (const [lo, hi] of [[0, 35], [35, 50], [50, 60], [60, 70], [70, 80], [80, 101]]) L(`money ${lo}-${hi}%`, withSplits.filter(r => r.pm! >= lo && r.pm! < hi));
  console.log(`\n## B. Public BETS% (tickets) on picked side`);
  for (const [lo, hi] of [[0, 35], [35, 50], [50, 65], [65, 80], [80, 101]]) L(`bets ${lo}-${hi}%`, withSplits.filter(r => r.pb! >= lo && r.pb! < hi));

  console.log(`\n## C. MONEY−BETS divergence on picked side (sharp vs public-trap)`);
  for (const [lo, hi, nm] of [[-100, -25, "bets≫money ≥25 (deep trap)"], [-25, -15, "bets≫money 15-25 (trap)"], [-15, 15, "aligned ±15"], [15, 25, "money≫bets 15-25 (sharp)"], [25, 100, "money≫bets ≥25 (strong sharp)"]] as any[]) L(nm, withSplits.filter(r => (r.pm! - r.pb!) >= lo && (r.pm! - r.pb!) < hi), 6);

  console.log(`\n## D. PUBLIC-TRAP (bets≫money) — actionable demotion test (ON-BOARD only)`);
  const trap = (r: R) => r.pm != null && r.pb != null && (r.pb - r.pm) >= 15;
  L("board picks WITH public-trap", withSplits.filter(r => onB(r) && trap(r)));
  L("board picks WITHOUT trap", withSplits.filter(r => onB(r) && !trap(r)));
  L("  trap × Lean", withSplits.filter(r => r.grade === "lean" && !r.ba && trap(r)));
  L("  trap × BestAngle", withSplits.filter(r => r.ba && trap(r)));
  L("  trap × ML", withSplits.filter(r => onB(r) && r.market === "moneyline" && trap(r)));
  L("  trap × OU", withSplits.filter(r => onB(r) && r.market === "total" && trap(r)));

  console.log(`\n## E. Does public-trap ADD to the conviction/value gate? (independence)`);
  const ev = (r: R) => r.p != null && r.odds != null ? r.p * (r.odds > 0 ? r.odds / 100 : 100 / -r.odds) - (1 - r.p) : null;
  const gateBad = (r: R) => (ev(r) ?? 1) < 0 || (r.market === "moneyline" && r.odds != null && r.odds < 0 && r.postDiff != null && Math.abs(r.postDiff) < 0.5);
  L("board: trap ONLY (gate would keep)", withSplits.filter(r => onB(r) && trap(r) && !gateBad(r)));
  L("board: gate-bad ONLY (no trap)", withSplits.filter(r => onB(r) && !trap(r) && gateBad(r)));
  L("board: trap AND gate-bad", withSplits.filter(r => onB(r) && trap(r) && gateBad(r)));
  L("board: neither (clean keep)", withSplits.filter(r => onB(r) && !trap(r) && !gateBad(r)));

  console.log(`\n## F. POSITIVE check — any sharp config that reliably WINS?`);
  L("money≫bets +15 (sharp on pick)", withSplits.filter(r => onB(r) && (r.pm! - r.pb!) >= 15));
  L("contrarian: low bets <35% on pick", withSplits.filter(r => onB(r) && r.pb! < 35));
  L("opp public-heavy fade (opp money>65)", withSplits.filter(r => onB(r) && r.om != null && r.om > 65));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
