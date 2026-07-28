/** READ-ONLY — replay feasibility: which model intermediate values are frozen
 * in snapshot v2_2_audit / fi_v2_audit, with coverage. Determines exact-vs-
 * approximate re-run. No writes. */
import { supabase } from "../../lib/db/supabase";
const START = "2026-06-07";
const END = "2026-07-27";

async function main(): Promise<void> {
  const data: any[] = [];
  const pageSize = 250;
  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase.from("prediction_records")
      .select("market,slate_date,locked_at,snapshot_json,launch_day,no_bet")
      .eq("sport", "mlb")
      .in("market", ["moneyline", "total", "first_inning"])
      .gte("slate_date", START)
      .lte("slate_date", END)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    data.push(...(page ?? []));
    if ((page ?? []).length < pageSize) break;
  }
  const rows = data.filter((r: any) => r.launch_day !== true && r.locked_at !== null);
  const ml = rows.filter((r: any) => r.market === "moneyline");
  const tot = rows.filter((r: any) => r.market === "total");
  const fi = rows.filter((r: any) => r.market === "first_inning");

  // dump all v2_2_audit keys present anywhere
  const v22keys = new Set<string>(), fikeys = new Set<string>();
  for (const r of rows as any[]) { for (const k of Object.keys(r.snapshot_json?.v2_2_audit ?? {})) v22keys.add(k); for (const k of Object.keys(r.snapshot_json?.fi_v2_audit ?? {})) fikeys.add(k); }
  console.log("=== ALL v2_2_audit keys present ===\n" + [...v22keys].sort().join(", "));
  console.log("\n=== ALL fi_v2_audit keys present ===\n" + [...fikeys].sort().join(", "));

  // coverage of the fields the re-run harness NEEDS
  const cov = (arr: any[], path: (a: any) => any) => arr.filter((r: any) => { const v = path(r.snapshot_json?.v2_2_audit ?? {}); return v !== undefined && v !== null; }).length;
  const covfi = (arr: any[], path: (a: any) => any) => arr.filter((r: any) => { const v = path(r.snapshot_json?.fi_v2_audit ?? {}); return v !== undefined && v !== null; }).length;

  console.log(`\n=== RE-RUN INPUT COVERAGE (ML n=${ml.length}, TOT n=${tot.length}, FI n=${fi.length}) ===`);
  const fields: [string, (a: any) => any, "ml" | "tot" | "both"][] = [
    ["independent_home_runs", a => a.independent_home_runs, "both"],
    ["independent_away_runs", a => a.independent_away_runs, "both"],
    ["independent_total", a => a.independent_total, "tot"],
    ["independent_home_diff", a => a.independent_home_diff, "ml"],
    ["posterior_home_runs", a => a.posterior_home_runs, "both"],
    ["posterior_away_runs", a => a.posterior_away_runs, "both"],
    ["posterior_total", a => a.posterior_total, "tot"],
    ["posterior_home_diff", a => a.posterior_home_diff, "ml"],
    ["trust_independent", a => a.trust_independent, "both"],
    ["data_quality_tier", a => a.data_quality_tier, "both"],
    ["ml_model_prob", a => a.ml_model_prob, "ml"],
    ["ml_market_prob", a => a.ml_market_prob, "ml"],
    ["ml_raw_model_prob", a => a.ml_raw_model_prob, "ml"],
    ["ml_raw_edge_pct", a => a.ml_raw_edge_pct, "ml"],
    ["ml_regularized_edge_pct", a => a.ml_regularized_edge_pct, "ml"],
    ["ml_shrink_factor", a => a.ml_shrink_factor, "ml"],
    ["ou_model_prob", a => a.ou_model_prob, "tot"],
    ["ou_market_prob", a => a.ou_market_prob, "tot"],
    ["ou_raw_model_prob", a => a.ou_raw_model_prob, "tot"],
    ["ou_raw_edge_pct", a => a.ou_raw_edge_pct, "tot"],
    ["over_odds_american", a => a.over_odds_american, "tot"],
    ["under_odds_american", a => a.under_odds_american, "tot"],
    ["market_home_win_prob", a => a.market_home_win_prob, "ml"],
    ["market_away_win_prob", a => a.market_away_win_prob, "ml"],
  ];
  for (const [name, path, which] of fields) {
    const arr = which === "ml" ? ml : which === "tot" ? tot : [...ml, ...tot];
    const n = arr.length, c = cov(arr, path);
    console.log(`  ${name.padEnd(26)} ${c}/${n} (${n ? (100 * c / n).toFixed(0) : "0"}%)`);
  }
  console.log(`\n=== FI re-run input coverage (n=${fi.length}) ===`);
  for (const [name, path] of [["posterior_p_nrfi", (a: any) => a.posterior_p_nrfi ?? a.posterior_nrfi], ["p_nrfi(independent)", (a: any) => a.p_nrfi ?? a.independent_p_nrfi], ["nrfi_market_prob", (a: any) => a.nrfi_market_prob ?? a.market_nrfi_prob], ["away_lambda", (a: any) => a.away_lambda], ["home_lambda", (a: any) => a.home_lambda], ["data_quality_tier", (a: any) => a.data_quality_tier]] as any[]) {
    console.log(`  ${name.padEnd(26)} ${covfi(fi, path)}/${fi.length}`);
  }
  const snapshotCoverage = (arr: any[], test: (snapshot: any) => boolean) =>
    arr.filter((r: any) => test(r.snapshot_json ?? {})).length;
  console.log(`\n=== FULL-RUNTIME / DECISION-REPLAY SUBSTRATE ===`);
  for (const [name, arr] of [["ML", ml], ["TOT", tot], ["FI", fi]] as const) {
    console.log(`  ${name} n=${arr.length}`);
    console.log(`    v2 feature_capture:       ${snapshotCoverage(arr, s => s.v2_2_audit?.feature_capture != null)}/${arr.length}`);
    console.log(`    FI feature capture:       ${snapshotCoverage(arr, s => s.fi_v2_audit?.feature_capture != null)}/${arr.length}`);
    console.log(`    locked lines:             ${snapshotCoverage(arr, s => Array.isArray(s.lines_at_lock) && s.lines_at_lock.length > 0)}/${arr.length}`);
    console.log(`    locked signals:           ${snapshotCoverage(arr, s => Array.isArray(s.signal_rows_at_lock) && s.signal_rows_at_lock.length > 0)}/${arr.length}`);
    console.log(`    locked member read:       ${snapshotCoverage(arr, s => s.member_facing_at_lock?.schema_version != null)}/${arr.length}`);
    console.log(`    model layer stamp:        ${snapshotCoverage(arr, s => s.model_layer_versions?.active_probability_head != null)}/${arr.length}`);
  }
  // sample one full v2_2_audit to eyeball
  const sampleTot: any = tot.find((r: any) => r.snapshot_json?.v2_2_audit);
  console.log(`\n=== sample TOTAL v2_2_audit (truncated) ===`);
  const a = sampleTot?.snapshot_json?.v2_2_audit ?? {};
  console.log(JSON.stringify({ independent_home_runs: a.independent_home_runs, independent_away_runs: a.independent_away_runs, posterior_home_runs: a.posterior_home_runs, posterior_away_runs: a.posterior_away_runs, posterior_total: a.posterior_total, ou_model_prob: a.ou_model_prob, ou_market_prob: a.ou_market_prob, ou_raw_model_prob: a.ou_raw_model_prob, trust_independent: a.trust_independent, data_quality_tier: a.data_quality_tier }, null, 1));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
