/** MLB calibration/profitability diagnostic — Sections 2-6. READ-ONLY. */
import { supabase } from "../../lib/db/supabase";

const TRACKING_START = "2026-06-07";
const D7 = "2026-06-09";   // last 7 days relative to ~6/16
const D3 = "2026-06-13";   // last 3 days

type Row = {
  date: string; market: string; grade: string; side: string | null;
  odds: number | null; p: number | null; edge: number | null; res: string;
  lineMoveDir: string | null; splitsPickedMoney: number | null; splitsConflict: boolean | null;
  splitsSupport: boolean | null;
};

function americanProfit(odds: number, win: boolean): number {
  if (win) return odds > 0 ? odds / 100 : 100 / -odds;
  return -1;
}
function roi(arr: Row[]): string {
  let net = 0, n = 0, missing = 0;
  for (const r of arr) {
    if (r.res !== "win" && r.res !== "loss") continue;
    if (r.odds === null) { missing++; continue; }
    n++; net += americanProfit(r.odds, r.res === "win");
  }
  if (n === 0) return `ROI n=0${missing ? ` (missing-price=${missing})` : ""}`;
  return `${net >= 0 ? "+" : ""}${net.toFixed(1)}u (${(100 * net / n).toFixed(0)}%, n=${n}${missing ? `, missing=${missing}` : ""})`;
}
function wl(arr: Row[]): string {
  const w = arr.filter(r => r.res === "win").length, l = arr.filter(r => r.res === "loss").length, t = w + l;
  const warn = t < 15 ? " ⚠small" : "";
  return `${w}-${l} (${t ? (100 * w / t).toFixed(0) : "--"}%, n=${t})${warn}`;
}
function avgP(arr: Row[]): string {
  const ps = arr.filter(r => r.p !== null).map(r => r.p as number);
  if (!ps.length) return "p=--";
  return `p=${(100 * ps.reduce((a, b) => a + b, 0) / ps.length).toFixed(0)}%`;
}
function line(label: string, arr: Row[]): string {
  return `  ${label.padEnd(22)} ${wl(arr).padEnd(22)} ${roi(arr).padEnd(28)} ${avgP(arr)}`;
}

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, market, play_grade, side, odds_american, model_probability, edge, launch_day, no_bet, snapshot_json, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", TRACKING_START);
  const rows: Row[] = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true).map((r: any) => {
    const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    const sj = r.snapshot_json ?? {};
    return {
      date: String(r.slate_date), market: String(r.market), grade: String(r.play_grade ?? "").toLowerCase(),
      side: r.side, odds: r.odds_american, p: r.model_probability, edge: r.edge, res: String(g?.result ?? "").toLowerCase(),
      lineMoveDir: sj.line_movement?.direction ?? null,
      splitsPickedMoney: sj.public_splits?.picked_money_pct ?? null,
      splitsConflict: sj.public_splits?.conflict ?? null,
      splitsSupport: sj.public_splits?.support ?? null,
    };
  });
  const cut = (f: (r: Row) => boolean) => rows.filter(f);
  const inWin = (r: Row, from: string) => r.date >= from;

  console.log(`\n${"=".repeat(80)}\nSECTION 2 — MLB TRUTH TABLE (since ${TRACKING_START}, launch_day/no_bet excluded)\n${"=".repeat(80)}`);
  console.log(`Total graded MLB rows: ${rows.filter(r => r.res === "win" || r.res === "loss").length}`);
  for (const [wl_, from] of [["FULL", TRACKING_START], ["7d", D7], ["3d", D3]] as const) {
    console.log(`\n--- Window: ${wl_} ---`);
    for (const m of ["moneyline", "total", "first_inning"]) {
      const mr = cut(r => r.market === m && inWin(r, from));
      if (mr.length === 0) continue;
      console.log(` ${m}:`);
      for (const g of ["best_angle", "lean", "watchlist", "market_aligned", "provisional"]) {
        const a = mr.filter(r => r.grade === g); if (!a.length) continue;
        console.log(line(`  ${g}`, a));
      }
      console.log(line(`  ALL ${m}`, mr));
    }
  }

  console.log(`\n${"=".repeat(80)}\nSECTION 2b — directional cuts (FULL window)\n${"=".repeat(80)}`);
  console.log(line("ML favorite (odds<0)", cut(r => r.market === "moneyline" && r.odds !== null && r.odds < 0)));
  console.log(line("ML underdog (odds>0)", cut(r => r.market === "moneyline" && r.odds !== null && r.odds > 0)));
  console.log(line("Total Over", cut(r => r.market === "total" && r.side === "over")));
  console.log(line("Total Under", cut(r => r.market === "total" && r.side === "under")));
  console.log(line("FI NRFI (under)", cut(r => r.market === "first_inning" && r.side === "under")));
  console.log(line("FI YRFI (over)", cut(r => r.market === "first_inning" && r.side === "over")));

  console.log(`\n${"=".repeat(80)}\nSECTION 3 — BEST ANGLE vs LEAN (sub-buckets)\n${"=".repeat(80)}`);
  for (const g of ["best_angle", "lean"]) {
    console.log(`\n${g.toUpperCase()}:`);
    console.log(line(" overall", cut(r => r.grade === g)));
    for (const m of ["moneyline", "total", "first_inning"]) console.log(line(`  ${m}`, cut(r => r.grade === g && r.market === m)));
    console.log("  by confidence:");
    for (const [lo, hi] of [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.75], [0.75, 1.01]]) {
      const a = cut(r => r.grade === g && r.p !== null && r.p >= lo && r.p < hi); if (!a.length) continue;
      console.log(line(`   p[${lo},${hi})`, a));
    }
    console.log("  by line-move vs pick:");
    for (const d of ["toward_pick", "against_pick", "neutral", "unknown"]) {
      const a = cut(r => r.grade === g && r.lineMoveDir === d); if (!a.length) continue;
      console.log(line(`   move ${d}`, a));
    }
    console.log("  by public money on pick:");
    console.log(line("   public-heavy(>65%)", cut(r => r.grade === g && r.splitsPickedMoney !== null && r.splitsPickedMoney > 65)));
    console.log(line("   contrarian(<35%)", cut(r => r.grade === g && r.splitsPickedMoney !== null && r.splitsPickedMoney < 35)));
    console.log(line("   splits-conflict", cut(r => r.grade === g && r.splitsConflict === true)));
    console.log(line("   splits-support", cut(r => r.grade === g && r.splitsSupport === true)));
  }

  console.log(`\n${"=".repeat(80)}\nSECTION 5 — CALIBRATION (model_probability vs actual; Brier/LogLoss)\n${"=".repeat(80)}`);
  function brierLogloss(arr: Row[]): string {
    const g = arr.filter(r => (r.res === "win" || r.res === "loss") && r.p !== null);
    if (!g.length) return "n=0";
    let brier = 0, ll = 0;
    for (const r of g) { const y = r.res === "win" ? 1 : 0; const p = Math.min(0.999, Math.max(0.001, r.p as number)); brier += (p - y) ** 2; ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); }
    return `Brier=${(brier / g.length).toFixed(3)} LogLoss=${(ll / g.length).toFixed(3)} n=${g.length}`;
  }
  console.log(" prob-bucket calibration (predicted ≈ actual is well-calibrated):");
  for (const [lo, hi] of [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.75], [0.75, 1.01]]) {
    const a = cut(r => r.p !== null && r.p >= lo && r.p < hi);
    const g = a.filter(r => r.res === "win" || r.res === "loss");
    const exp = (100 * (lo + hi) / 2).toFixed(0);
    console.log(`   p[${lo},${hi}) predicted~${exp}%  ${wl(g)}`);
  }
  console.log(` Overall: ${brierLogloss(rows)}`);
  console.log(` ML:      ${brierLogloss(cut(r => r.market === "moneyline"))}`);
  console.log(` Total:   ${brierLogloss(cut(r => r.market === "total"))}`);

  console.log(`\n${"=".repeat(80)}\nSECTION 6 — LINE MOVEMENT + SPLITS coverage & impact\n${"=".repeat(80)}`);
  const lmCov = rows.filter(r => r.lineMoveDir !== null && r.lineMoveDir !== "unknown").length;
  const spCov = rows.filter(r => r.splitsPickedMoney !== null).length;
  console.log(` line_movement direction coverage (non-unknown): ${lmCov}/${rows.length}`);
  console.log(` public_splits coverage: ${spCov}/${rows.length}`);
  console.log(line("move toward_pick", cut(r => r.lineMoveDir === "toward_pick")));
  console.log(line("move against_pick", cut(r => r.lineMoveDir === "against_pick")));
  console.log(line("splits-support", cut(r => r.splitsSupport === true)));
  console.log(line("splits-conflict", cut(r => r.splitsConflict === true)));
  console.log(line("public-heavy >65% money", cut(r => r.splitsPickedMoney !== null && r.splitsPickedMoney > 65)));
  console.log(line("contrarian <35% money", cut(r => r.splitsPickedMoney !== null && r.splitsPickedMoney < 35)));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
