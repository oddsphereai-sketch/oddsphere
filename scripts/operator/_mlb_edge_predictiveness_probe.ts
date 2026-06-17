/** READ-ONLY — is stored ML/OU edge (pp) predictive of win/ROI? Decile + sign cuts. */
import { supabase } from "../../lib/db/supabase";

function profit(o: number, win: boolean): number { return win ? (o > 0 ? o / 100 : 100 / -o) : -1; }

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("market, play_grade, odds_american, model_probability, edge, launch_day, no_bet, prediction_grades(result)")
    .eq("sport", "mlb").gte("slate_date", "2026-06-07");
  const rows = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true).map((r: any) => {
    const g = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    return { market: String(r.market), grade: String(r.play_grade ?? "").toLowerCase(), odds: r.odds_american, p: r.model_probability, edge: r.edge, res: String(g?.result ?? "").toLowerCase() };
  }).filter((r: any) => (r.res === "win" || r.res === "loss"));
  // only ML/OU (pp edge); FI excluded (fraction + no price)
  const ml_ou = rows.filter((r: any) => (r.market === "moneyline" || r.market === "total") && r.edge !== null);

  function stat(arr: any[], label: string): void {
    const w = arr.filter(r => r.res === "win").length, l = arr.length - w;
    let net = 0, n = 0; for (const r of arr) { if (r.odds === null) continue; n++; net += profit(r.odds, r.res === "win"); }
    const roi = n ? (100 * net / n).toFixed(0) : "--";
    console.log(`  ${label.padEnd(28)} ${`${w}-${l} (${arr.length ? (100 * w / arr.length).toFixed(0) : "--"}%)`.padEnd(16)} ROI ${roi}% (n=${n})`);
  }

  console.log("=== ML/OU by EDGE bucket (pp) — does more edge = more win/ROI? ===");
  for (const [lo, hi, lbl] of [[-100, 0, "edge<0 (neg)"], [0, 2, "0-2pp"], [2, 5, "2-5pp"], [5, 10, "5-10pp"], [10, 100, "10pp+"]] as any[]) {
    stat(ml_ou.filter(r => r.edge >= lo && r.edge < hi), lbl);
  }
  console.log("\n=== Within current LEANS, by edge bucket ===");
  const leans = ml_ou.filter(r => r.grade === "lean");
  for (const [lo, hi, lbl] of [[-100, 2, "<2pp"], [2, 5, "2-5pp"], [5, 100, "5pp+"]] as any[]) {
    stat(leans.filter(r => r.edge >= lo && r.edge < hi), lbl);
  }
  console.log("\n=== Within BEST ANGLES, by edge bucket ===");
  const ba = ml_ou.filter(r => r.grade === "best_angle");
  for (const [lo, hi, lbl] of [[-100, 5, "<5pp"], [5, 10, "5-10pp"], [10, 100, "10pp+"]] as any[]) {
    stat(ba.filter(r => r.edge >= lo && r.edge < hi), lbl);
  }
  console.log("\n=== Combined gate test: prob>=0.55 AND edge>=2pp (candidate value-Lean rule) ===");
  stat(ml_ou.filter(r => r.grade === "lean"), "all current ML/OU Leans");
  stat(ml_ou.filter(r => r.grade === "lean" && r.p !== null && r.p >= 0.55 && r.edge >= 2), "Lean & p>=.55 & edge>=2pp");
  stat(ml_ou.filter(r => r.grade === "lean" && r.p !== null && r.p >= 0.55), "Lean & p>=.55 (R1 only)");
  stat(ml_ou.filter(r => r.grade === "lean" && r.edge >= 2), "Lean & edge>=2pp (value only)");
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
