/**
 * READ-ONLY — Gate 1 feature attribution. Every available factor vs outcome:
 * coverage, n, record, win%, units, ROI, avgP, obsHit, calib gap, excl-6/14,
 * wk1/wk2, classification. Side-level (validated). No writes.
 */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07", SIX14 = "2026-06-14";
type R = { date: string; market: string; side: string | null; odds: number | null; p: number | null; mkt: number | null; edge: number | null; res: string;
  tier: string; missing: number | null; postDiff: number | null; postTot: number | null; line: number | null;
  pm: number | null; pb: number | null; conflict: boolean | null; support: boolean | null; dir: string | null;
  starterConf: string | null; bullpenFb: string | null; weatherFb: string | null; lineupConf: string | null; };
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
function M(rows: R[]) { const g = rows.filter(r => r.res === "win" || r.res === "loss"); const w = g.filter(r => r.res === "win").length, l = g.length - w; let net = 0, n = 0, ps = 0, pn = 0; for (const r of g) { if (r.odds !== null) { n++; net += profit(r.odds, r.res === "win"); } if (r.p !== null) { ps += r.p; pn++; } } const obs = w + l ? 100 * w / (w + l) : 0; const avgP = pn ? 100 * ps / pn : 0; return { w, l, t: w + l, pct: obs, units: net, roi: n ? 100 * net / n : 0, avgP, gap: obs - avgP }; }
function line(label: string, rows: R[]): string { const a = M(rows); const x = M(rows.filter(r => r.date !== SIX14)); const w1 = M(rows.filter(r => r.date <= "2026-06-13")); const w2 = M(rows.filter(r => r.date >= "2026-06-14")); const warn = a.t < 12 ? " ⚠sb" : ""; return `  ${label.padEnd(30)} n=${String(a.t).padEnd(3)} ${`${a.w}-${a.l}(${a.t ? a.pct.toFixed(0) : "--"}%)`.padEnd(13)} ${(a.units >= 0 ? "+" : "") + a.units.toFixed(1)}u/${a.roi.toFixed(0)}%  calGap=${a.gap.toFixed(0)}  [exX ${x.t ? x.pct.toFixed(0) : "--"}%/${x.roi.toFixed(0)}%][w1 ${w1.t ? w1.pct.toFixed(0) : "--"}%|w2 ${w2.t ? w2.pct.toFixed(0) : "--"}%]${warn}`; }

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, market, side, odds_american, model_probability, market_probability, edge, line_value, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", START);
  const rows: R[] = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true).map((r: any) => { const gr = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const a = r.snapshot_json?.v2_2_audit ?? {}; const di = r.snapshot_json?.data_integrity ?? {}; const ps = r.snapshot_json?.public_splits ?? {}; const lm = r.snapshot_json?.line_movement ?? {}; return { date: String(r.slate_date), market: String(r.market), side: r.side, odds: r.odds_american, p: r.model_probability, mkt: r.market_probability, edge: r.edge, res: String(gr?.result ?? "").toLowerCase(), tier: String(a.data_quality_tier ?? ""), missing: a.feature_missing_count ?? null, postDiff: a.posterior_home_diff ?? null, postTot: a.posterior_total ?? null, line: a.market_total ?? r.line_value ?? null, pm: ps.picked_money_pct ?? null, pb: ps.picked_bets_pct ?? null, conflict: ps.conflict ?? null, support: ps.support ?? null, dir: lm.direction ?? null, starterConf: di.starter_confirmed ?? null, bullpenFb: di.bullpen_fallback ?? null, weatherFb: di.weather_fallback ?? null, lineupConf: di.lineup_confirmed ?? null }; });
  const mlou = rows.filter(r => r.market === "moneyline" || r.market === "total");
  const ml = rows.filter(r => r.market === "moneyline"), ou = rows.filter(r => r.market === "total");

  console.log(`\n###### GATE 1 ATTRIBUTION (n=${rows.length}; [exX]=excl6/14 [w1|w2]=weekly) ######`);

  console.log(`\n== STAT/MODEL FACTORS (variance check) ==`);
  const vc = (name: string, vals: (string | null)[]) => { const set = new Map<string, number>(); for (const v of vals) set.set(String(v), (set.get(String(v)) ?? 0) + 1); console.log(`  ${name.padEnd(20)} ${[...set.entries()].map(([k, n]) => `${k}:${n}`).join("  ")}`); };
  vc("starter_confirmed", rows.map(r => r.starterConf));
  vc("bullpen_fallback", rows.map(r => r.bullpenFb));
  vc("weather_fallback", rows.map(r => r.weatherFb));
  vc("lineup_confirmed", rows.map(r => r.lineupConf));
  console.log(`  -> starter/bullpen/weather/lineup: NO VARIANCE or always-unknown => DATA-BLOCKED for attribution (raw feature values not persisted)`);

  console.log(`\n  data_quality_tier:`);
  for (const t of ["high", "medium", "low", "fallback"]) { const a = mlou.filter(r => r.tier === t); if (a.length) console.log(line(`tier=${t}`, a)); }
  console.log(`  feature_missing_count:`);
  for (const [lo, hi, lbl] of [[0, 3, "0-2"], [3, 6, "3-5"], [6, 99, "6+"]] as any[]) { const a = mlou.filter(r => r.missing !== null && r.missing >= lo && r.missing < hi); if (a.length) console.log(line(`missing ${lbl}`, a)); }
  console.log(`  projected run gap |posterior_home_diff| (ML):`);
  for (const [lo, hi, lbl] of [[0, 0.5, "0-0.5"], [0.5, 1, "0.5-1"], [1, 99, "1+"]] as any[]) { const a = ml.filter(r => r.postDiff !== null && Math.abs(r.postDiff) >= lo && Math.abs(r.postDiff) < hi); if (a.length) console.log(line(`rungap ${lbl}`, a)); }
  console.log(`  projected total gap (posterior_total - line) (OU):`);
  for (const [lo, hi, lbl] of [[-99, -0.5, "<-0.5 (proj<<line)"], [-0.5, 0.5, "~line"], [0.5, 99, ">+0.5 (proj>>line)"]] as any[]) { const a = ou.filter(r => r.postTot !== null && r.line !== null && (r.postTot - r.line) >= lo && (r.postTot - r.line) < hi); if (a.length) console.log(line(`totgap ${lbl}`, a)); }
  console.log(`  model probability bucket:`);
  for (const [lo, hi] of [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.75], [0.75, 1.01]]) { const a = mlou.filter(r => r.p !== null && r.p >= lo && r.p < hi); if (a.length) console.log(line(`p[${lo},${hi})`, a)); }

  console.log(`\n== MARKET/VALUE FACTORS ==`);
  console.log(`  model-market disagreement (edge pp):`);
  for (const [lo, hi, lbl] of [[-99, 0, "neg"], [0, 2, "0-2"], [2, 5, "2-5"], [5, 10, "5-10"], [10, 99, "10+"]] as any[]) { const a = mlou.filter(r => r.edge !== null && r.edge >= lo && r.edge < hi); if (a.length) console.log(line(`edge ${lbl}pp`, a)); }
  const ev = (r: R) => r.p !== null && r.odds !== null ? r.p * (r.odds > 0 ? r.odds / 100 : 100 / -r.odds) - (1 - r.p) : null;
  console.log(line("EV>=0", mlou.filter(r => (ev(r) ?? -1) >= 0)));
  console.log(line("EV<0", mlou.filter(r => (ev(r) ?? 1) < 0)));
  console.log(line("favorite (odds<0)", ml.filter(r => r.odds !== null && r.odds < 0)));
  console.log(line("dog (odds>0)", ml.filter(r => r.odds !== null && r.odds > 0)));
  console.log(line("Over", ou.filter(r => r.side === "over")));
  console.log(line("Under", ou.filter(r => r.side === "under")));
  console.log(`  total line range:`);
  for (const [lo, hi, lbl] of [[0, 8, "<8"], [8, 9, "8-8.5"], [9, 99, "9+"]] as any[]) { const a = ou.filter(r => r.line !== null && r.line >= lo && r.line < hi); if (a.length) console.log(line(`line ${lbl}`, a)); }

  console.log(`\n== PUBLIC/SHARP FACTORS (coverage-limited) ==`);
  console.log(line("public money>65% on pick", mlou.filter(r => r.pm !== null && r.pm > 65)));
  console.log(line("public money<35% (contrarian)", mlou.filter(r => r.pm !== null && r.pm < 35)));
  console.log(line("bets>>money +15 (public tickets)", mlou.filter(r => r.pm !== null && r.pb !== null && r.pb - r.pm >= 15)));
  console.log(line("money>>bets +15 (sharp)", mlou.filter(r => r.pm !== null && r.pb !== null && r.pm - r.pb >= 15)));
  console.log(line("splits conflict", mlou.filter(r => r.conflict === true)));
  console.log(line("splits support", mlou.filter(r => r.support === true)));
  console.log(line("line toward_pick", mlou.filter(r => r.dir === "toward_pick")));
  console.log(line("line against_pick", mlou.filter(r => r.dir === "against_pick")));
  console.log(line("missing splits", mlou.filter(r => r.pm === null)));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
