/** MLB deep calibration/profitability backtest — Sections 2,3,4,5,8. READ-ONLY. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07";

type Row = {
  date: string; market: string; grade: string; side: string | null; odds: number | null;
  p: number | null; res: string; lineMoveDir: string | null; money: number | null; bets: number | null;
  conflict: boolean | null; support: boolean | null; line: number | null; proj: number | null;
  weather: number | null; starterConfirmed: boolean | null; bullpenFallback: boolean | null;
};
function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }
type S = { w: number; l: number; t: number; pct: number; units: number; roi: number; roiN: number };
function stats(arr: Row[]): S {
  const g = arr.filter(r => r.res === "win" || r.res === "loss");
  const w = g.filter(r => r.res === "win").length, l = g.filter(r => r.res === "loss").length;
  let net = 0, n = 0; for (const r of g) { if (r.odds === null) continue; n++; net += profit(r.odds, r.res === "win"); }
  return { w, l, t: w + l, pct: w + l ? 100 * w / (w + l) : 0, units: net, roi: n ? 100 * net / n : 0, roiN: n };
}
function f(s: S): string { return `${s.w}-${s.l}(${s.pct.toFixed(0)}%) ${s.units >= 0 ? "+" : ""}${s.units.toFixed(1)}u/${s.roi.toFixed(0)}%`; }
function warn(s: S): string { return s.t < 15 ? " ⚠" : ""; }

async function load(): Promise<Row[]> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, market, play_grade, side, odds_american, model_probability, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", START);
  return (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true).map((r: any) => {
    const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades; const sj = r.snapshot_json ?? {}; const v = sj.v2_2_audit ?? {};
    return {
      date: String(r.slate_date), market: String(r.market), grade: String(r.play_grade ?? "").toLowerCase(), side: r.side, odds: r.odds_american,
      p: r.model_probability, res: String(g?.result ?? "").toLowerCase(),
      lineMoveDir: sj.line_movement?.direction ?? null, money: sj.public_splits?.picked_money_pct ?? null, bets: sj.public_splits?.picked_bets_pct ?? null,
      conflict: sj.public_splits?.conflict ?? null, support: sj.public_splits?.support ?? null,
      line: v.market_total ?? null, proj: v.posterior_total ?? v.independent_total ?? null,
      weather: sj.auto_factors?.weather_total_adjust ?? null, starterConfirmed: sj.data_integrity?.starter_confirmed ?? null, bullpenFallback: sj.data_integrity?.bullpen_fallback ?? null,
    };
  });
}

async function main(): Promise<void> {
  const rows = await load();
  const cut = (f: (r: Row) => boolean) => rows.filter(f);
  const leans = cut(r => r.grade === "lean");
  const no614 = (arr: Row[]) => arr.filter(r => r.date !== "2026-06-14");

  console.log(`\n###### SECTION 2 — LEAN CONFIDENCE FLOOR SWEEP (with 6/14-excluded robustness) ######`);
  console.log(`baseline Leans: ${f(stats(leans))} | excl-6/14: ${f(stats(no614(leans)))}`);
  console.log(`floor| removed W/L/push | KEPT all      | KEPT excl6/14 | ML kept     | OU kept     | FI kept`);
  for (const fl of [0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.60]) {
    const rm = leans.filter(r => r.p !== null && r.p < fl), kp = leans.filter(r => !(r.p !== null && r.p < fl));
    const rmPush = rm.filter(r => r.res === "push" || r.res === "void").length;
    console.log(`${(fl * 100).toFixed(0)}%  | ${`${stats(rm).t}/${rmPush}p (${stats(rm).w}W/${stats(rm).l}L)`.padEnd(16)}| ${f(stats(kp)).padEnd(14)}| ${f(stats(no614(kp))).padEnd(14)}| ${(f(stats(kp.filter(r => r.market === "moneyline"))) + warn(stats(kp.filter(r => r.market === "moneyline")))).padEnd(12)}| ${(f(stats(kp.filter(r => r.market === "total"))) + warn(stats(kp.filter(r => r.market === "total")))).padEnd(12)}| ${f(stats(kp.filter(r => r.market === "first_inning")))}`);
  }

  console.log(`\n###### BEST ANGLE CONFIDENCE FLOOR SWEEP (BA only) ######`);
  const ba = cut(r => r.grade === "best_angle");
  console.log(`baseline BA: ${f(stats(ba))} | excl-6/14: ${f(stats(no614(ba)))}`);
  for (const fl of [0, 0.60, 0.65, 0.70, 0.75]) {
    const kp = ba.filter(r => !(r.p !== null && r.p < fl)); const rm = ba.filter(r => r.p !== null && r.p < fl);
    console.log(` BA≥${(fl * 100).toFixed(0)}%: kept ${f(stats(kp))}${warn(stats(kp))} (removed ${stats(rm).t}: ${stats(rm).w}W/${stats(rm).l}L)`);
  }

  console.log(`\n###### MARKET-SPECIFIC LEAN FLOORS ######`);
  for (const m of ["moneyline", "total", "first_inning"]) {
    const ml = leans.filter(r => r.market === m);
    console.log(` ${m} Leans baseline: ${f(stats(ml))}${warn(stats(ml))}`);
    for (const fl of [0.55, 0.57, 0.60]) { const kp = ml.filter(r => !(r.p !== null && r.p < fl)); console.log(`   ≥${(fl * 100).toFixed(0)}%: ${f(stats(kp))}${warn(stats(kp))} (kept ${stats(kp).t})`); }
  }

  console.log(`\n###### SECTION 3 — WHY LEANS FAIL (loss breakdown) ######`);
  const lc = (lbl: string, a: Row[]) => console.log(`  ${lbl.padEnd(26)} ${f(stats(a))}${warn(stats(a))} avgP=${a.filter(r => r.p !== null).length ? (100 * a.filter(r => r.p !== null).reduce((s, r) => s + (r.p as number), 0) / a.filter(r => r.p !== null).length).toFixed(0) : "--"}%`);
  lc("ML fav (odds<0)", leans.filter(r => r.market === "moneyline" && r.odds !== null && r.odds < 0));
  lc("ML dog (odds>0)", leans.filter(r => r.market === "moneyline" && r.odds !== null && r.odds > 0));
  lc("total Over", leans.filter(r => r.market === "total" && r.side === "over"));
  lc("total Under", leans.filter(r => r.market === "total" && r.side === "under"));
  lc("p<0.55", leans.filter(r => r.p !== null && r.p < 0.55));
  lc("p>=0.55", leans.filter(r => r.p !== null && r.p >= 0.55));
  lc("public-heavy money>65%", leans.filter(r => r.money !== null && r.money > 65));
  lc("contrarian money<35%", leans.filter(r => r.money !== null && r.money < 35));
  lc("splits-conflict", leans.filter(r => r.conflict === true));
  lc("handle>bets+15 (sharp)", leans.filter(r => r.money !== null && r.bets !== null && r.money - r.bets > 15));
  lc("bets>handle+15 (public)", leans.filter(r => r.money !== null && r.bets !== null && r.bets - r.money > 15));
  lc("starter NOT confirmed", leans.filter(r => r.starterConfirmed === false));
  lc("bullpen fallback", leans.filter(r => r.bullpenFallback === true));

  console.log(`\n###### SECTION 4 — TOTAL UNDER DEEP DIVE ######`);
  const tu = cut(r => r.market === "total" && r.side === "under");
  const to = cut(r => r.market === "total" && r.side === "over");
  console.log(` All total Under: ${f(stats(tu))} | All total Over: ${f(stats(to))}`);
  const tug = (lbl: string, a: Row[]) => console.log(`  U ${lbl.padEnd(24)} ${f(stats(a))}${warn(stats(a))}`);
  tug("line >= 9", tu.filter(r => r.line !== null && r.line >= 9));
  tug("line < 9", tu.filter(r => r.line !== null && r.line < 9));
  tug("model gap >0.75 (proj<<line)", tu.filter(r => r.line !== null && r.proj !== null && r.line - r.proj > 0.75));
  tug("model gap <=0.75 (proj~line)", tu.filter(r => r.line !== null && r.proj !== null && r.line - r.proj <= 0.75));
  tug("public money on Under >50%", tu.filter(r => r.money !== null && r.money > 50));
  tug("public money on Under <=50%", tu.filter(r => r.money !== null && r.money <= 50));
  tug("weather adj negative (suppress)", tu.filter(r => r.weather !== null && r.weather < 0));
  tug("starter NOT confirmed", tu.filter(r => r.starterConfirmed === false));
  tug("bullpen fallback", tu.filter(r => r.bullpenFallback === true));
  // loss profile: of the Under LOSSES, how many were blowout-ish (proj way under but went over)
  const tuLoss = tu.filter(r => r.res === "loss");
  console.log(`  Under losses: ${tuLoss.length}; of those, model projected total ≥1 run under line: ${tuLoss.filter(r => r.line !== null && r.proj !== null && r.line - r.proj >= 1).length} (model badly over-projected run prevention)`);

  console.log(`\n###### SECTION 8 — PACKAGE BACKTESTS (public board = BA + Lean) ######`);
  const pubBase = cut(r => r.grade === "best_angle" || r.grade === "lean");
  const pkg = (name: string, demote: (r: Row) => boolean) => {
    // demote() = a Lean that gets removed from the public board
    const board = pubBase.filter(r => !(r.grade === "lean" && demote(r)));
    const ba_ = board.filter(r => r.grade === "best_angle"), ln_ = board.filter(r => r.grade === "lean");
    console.log(` ${name}`);
    console.log(`   board ${f(stats(board))}${warn(stats(board))} | BA ${stats(ba_).t} ${f(stats(ba_))} | Lean ${stats(ln_).t} ${f(stats(ln_))} | excl6/14 board ${f(stats(no614(board)))}`);
  };
  pkg("A: R1 (Lean<55→demote)", r => r.p !== null && r.p < 0.55);
  pkg("B: R1 + total-Under Lean demote", r => (r.p !== null && r.p < 0.55) || (r.market === "total" && r.side === "under"));
  pkg("C: R1 + public-heavy(>65%) Lean demote", r => (r.p !== null && r.p < 0.55) || (r.money !== null && r.money > 65));
  pkg("D: R1 + splits-conflict Lean demote", r => (r.p !== null && r.p < 0.55) || r.conflict === true);
  pkg("E: total Leans need ≥0.58 (ML/FI keep 0.55)", r => (r.market === "total" ? (r.p !== null && r.p < 0.58) : (r.p !== null && r.p < 0.55)));
  pkg("BASELINE (no demotion)", () => false);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
