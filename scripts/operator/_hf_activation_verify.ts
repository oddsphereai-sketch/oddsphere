import { supabase } from "../../lib/db/supabase";
async function main() {
  const { data } = await supabase.from("prediction_records")
    .select("matchup, market, pick, play_grade, best_angle, model_probability, edge, odds_american, locked_at, snapshot_json")
    .eq("sport", "mlb").eq("slate_date", "2026-06-16").order("matchup");
  const rows = (data ?? []) as any[];
  const ml = rows.filter(r => r.market === "moneyline");
  const ou = rows.filter(r => r.market === "total");
  // 1. new code check: audit_per_team.home_field should be ±0.11 (additive), not ~1.02 (old multiplier)
  const hfVals = new Set<string>();
  for (const r of ml) { const ht = r.snapshot_json?.v2_2_audit?.feature_capture?.factors?.home?.home_field ?? r.snapshot_json?.v2_2_audit; }
  // audit_per_team lives under feature_capture.factors (we wired indep.audit_per_team there)
  let newCode = 0, oldCode = 0;
  for (const r of ml) {
    const f = r.snapshot_json?.v2_2_audit?.feature_capture?.factors;
    const hf = f?.home?.home_field;
    if (hf == null) continue;
    if (Math.abs(hf - 0.11) < 0.001) newCode++; else oldCode++;
  }
  console.log(`=== HOME-FIELD ACTIVATION (today 2026-06-16, ${rows.length} MLB records) ===`);
  console.log(`audit home_field=+0.11 (new differential): ${newCode}  | old multiplier: ${oldCode}  ${newCode > 0 && oldCode === 0 ? "✅ new code live" : newCode === 0 ? "⚠ old code (deploy not live?)" : "mixed"}`);
  const locked = rows.filter(r => r.locked_at != null).length;
  console.log(`locked: ${locked}  unlocked: ${rows.length - locked}`);

  // 2. ML pick tilt + posterior margin
  const home = ml.filter(r => r.pick === "home").length, away = ml.filter(r => r.pick === "away").length;
  console.log(`\nML picks: home ${home} / away ${away}`);
  const diffs = ml.map(r => r.snapshot_json?.v2_2_audit?.posterior_home_diff).filter((x: any) => typeof x === "number");
  const avgDiff = diffs.length ? diffs.reduce((a: number, b: number) => a + b, 0) / diffs.length : null;
  console.log(`avg posterior_home_diff: ${avgDiff?.toFixed(3)} (home-field should push this positive)`);

  // 3. per-game: pick, margin, grade (coherence spot-check)
  console.log(`\nper-game ML (pick | posterior_diff | edge | play_grade | BA | locked):`);
  for (const r of ml) { const a = r.snapshot_json?.v2_2_audit ?? {}; console.log(`  ${String(r.matchup).padEnd(14)} ${String(r.pick).padEnd(5)} diff=${(a.posterior_home_diff ?? 0).toFixed(2)} edge=${r.edge?.toFixed?.(1) ?? "—"} ${String(r.play_grade).padEnd(14)} BA=${r.best_angle} ${r.locked_at ? "LOCKED" : "unlocked"}`); }

  // 4. totals neutrality: posterior_total should look normal (not inflated)
  const tots = ou.map(r => r.snapshot_json?.v2_2_audit?.posterior_total).filter((x: any) => typeof x === "number");
  console.log(`\nOU posterior_total: n=${tots.length} mean=${tots.length ? (tots.reduce((a: number, b: number) => a + b, 0) / tots.length).toFixed(2) : "—"} (should be ~8-9, not inflated)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
