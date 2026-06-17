/** READ-ONLY — validate home-field fix implementation choice:
 * (A) ML gain via DIFFERENTIAL bump (home +b/2, away -b/2 = total-neutral)
 * (B) totals impact of HOME-ONLY bump (total inflation) — to pick the safe impl. */
import { supabase } from "../../lib/db/supabase";
import { homeWinProbabilityPoisson, overProbabilityPoisson } from "../../lib/automodel/runDistribution";
const START = "2026-06-07", SIX14 = "2026-06-14";
type R = { date: string; market: string; side: string | null; pHome: number | null; pAway: number | null; line: number | null; storedPick: string | null; hs: number | null; as_: number | null; tot: number | null };

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, game_id, market, side, pick, line_value, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").in("market", ["moneyline", "total"]).gte("slate_date", START);
  const recs = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);
  const gids = [...new Set(recs.map((r: any) => r.game_id).filter(Boolean))];
  const gmap = new Map<number, any>(); for (let i = 0; i < gids.length; i += 200) { const { data: gs } = await supabase.from("games").select("id, home_score, away_score, total_runs").in("id", gids.slice(i, i + 200) as number[]); for (const g of (gs ?? []) as any[]) gmap.set(g.id, g); }
  const rows: R[] = recs.map((r: any) => { const a = r.snapshot_json?.v2_2_audit ?? {}; const g = gmap.get(r.game_id) ?? {}; return { date: String(r.slate_date), market: String(r.market), side: r.side, pHome: a.posterior_home_runs ?? null, pAway: a.posterior_away_runs ?? null, line: a.market_total ?? r.line_value ?? null, storedPick: r.pick, hs: g.home_score ?? null, as_: g.away_score ?? null, tot: g.total_runs ?? null }; });
  const ml = rows.filter(r => r.market === "moneyline" && r.pHome != null && r.hs != null && r.hs !== r.as_);
  const ou = rows.filter(r => r.market === "total" && r.pHome != null && r.line != null && r.tot != null && r.tot !== r.line);

  console.log(`\n###### (A) ML — DIFFERENTIAL home-field bump (total-neutral): home +b/2, away -b/2 ######`);
  function mlWL(b: number, subset: R[]) { let w = 0, l = 0, fl = 0; for (const r of subset) { const ph = homeWinProbabilityPoisson(r.pHome! + b / 2, Math.max(0.1, r.pAway! - b / 2)); const pick = ph >= 0.5 ? "home" : "away"; if (pick !== r.storedPick) fl++; const win = pick === "home" ? r.hs! > r.as_! : r.as_! > r.hs!; if (win) w++; else l++; } return { w, l, pct: w + l ? 100 * w / (w + l) : 0, fl }; }
  const base = mlWL(0, ml);
  for (const b of [0, 0.10, 0.15, 0.20, 0.25, 0.30]) { const f = mlWL(b, ml), x = mlWL(b, ml.filter(r => r.date !== SIX14)); console.log(`  b=${b.toFixed(2)} (total HF ~${(0.10 + b).toFixed(2)}): ${f.w}-${f.l} (${f.pct.toFixed(0)}%)  excl6/14 ${x.pct.toFixed(0)}%  flips ${f.fl}  net ${f.w - base.w >= 0 ? "+" : ""}${f.w - base.w}W`); }

  console.log(`\n###### (B) TOTALS impact — HOME-ONLY bump (raises projected total by b) vs DIFFERENTIAL (neutral) ######`);
  function ouWL(homeAdd: number, awayAdd: number, subset: R[]) { let w = 0, l = 0, fl = 0; for (const r of subset) { const over = overProbabilityPoisson(r.pAway! + awayAdd, r.pHome! + homeAdd, r.line!); const side = over >= 0.5 ? "over" : "under"; if (side !== r.side) fl++; const win = side === "over" ? r.tot! > r.line! : r.tot! < r.line!; if (win) w++; else l++; } return { w, l, pct: w + l ? 100 * w / (w + l) : 0, fl }; }
  const ouBase = ouWL(0, 0, ou);
  console.log(`  baseline OU:            ${ouBase.w}-${ouBase.l} (${ouBase.pct.toFixed(0)}%)`);
  for (const b of [0.15, 0.25]) {
    const ho = ouWL(b, 0, ou); // home-only (total +b) — inflates total
    const diff = ouWL(b / 2, -b / 2, ou); // differential (total neutral)
    console.log(`  b=${b}: HOME-ONLY ${ho.w}-${ho.l} (${ho.pct.toFixed(0)}%) flips ${ho.fl}  |  DIFFERENTIAL ${diff.w}-${diff.l} (${diff.pct.toFixed(0)}%) flips ${diff.fl}`);
  }
  console.log(`\n→ differential should leave totals ~unchanged (flips ~0); home-only shifts totals toward Over.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
