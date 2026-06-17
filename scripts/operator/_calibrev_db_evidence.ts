/**
 * READ-ONLY calibration data-volume probe. No writes.
 * Loads env from .env.local, queries:
 *   - calibration_buckets (count, by sport/market, sample sizes, is_displayable)
 *   - prediction_records.calibration_version by sport
 *   - graded-outcome volume per sport/market (prediction_results)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv() {
  try {
    const txt = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch (e) { console.error("no .env.local", e); }
}

async function main() {
  loadEnv();
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log("=== calibration_buckets ===");
  const { data: cb, error: cbErr, count: cbCount } = await sb
    .from("calibration_buckets")
    .select("sport, prediction_type, market, confidence_bucket_label, time_window, predictions_in_bucket, actual_hit_rate, is_displayable", { count: "exact" })
    .order("predictions_in_bucket", { ascending: false })
    .limit(60);
  if (cbErr) console.error("  ERR:", cbErr.message);
  console.log("  total rows:", cbCount);
  const disp = (cb ?? []).filter((r: any) => r.is_displayable).length;
  console.log("  is_displayable rows (in this top-60 sample):", disp);
  for (const r of (cb ?? []).slice(0, 30)) {
    const x = r as any;
    console.log(`  ${x.sport}/${x.prediction_type}/${x.market} ${x.confidence_bucket_label} win=${x.time_window} n=${x.predictions_in_bucket} hit=${x.actual_hit_rate} disp=${x.is_displayable}`);
  }

  console.log("\n=== prediction_records.calibration_version by sport ===");
  const { data: pr } = await sb
    .from("prediction_records")
    .select("sport, calibration_version")
    .limit(20000);
  const byVer: Record<string, number> = {};
  for (const r of (pr ?? []) as any[]) {
    const k = `${r.sport}::${r.calibration_version ?? "NULL"}`;
    byVer[k] = (byVer[k] ?? 0) + 1;
  }
  for (const k of Object.keys(byVer).sort()) console.log(`  ${k} = ${byVer[k]}`);

  console.log("\n=== prediction_results graded volume by sport/market/outcome ===");
  const { data: res, count: resCount } = await sb
    .from("prediction_results")
    .select("sport, market, prediction_type, outcome", { count: "exact" })
    .limit(20000);
  console.log("  total prediction_results rows:", resCount);
  const byMkt: Record<string, { win: number; loss: number; push: number; void: number; total: number }> = {};
  for (const r of (res ?? []) as any[]) {
    const k = `${r.sport}::${r.prediction_type}::${r.market}`;
    byMkt[k] = byMkt[k] ?? { win: 0, loss: 0, push: 0, void: 0, total: 0 };
    byMkt[k].total++;
    if (r.outcome in byMkt[k]) (byMkt[k] as any)[r.outcome]++;
  }
  for (const k of Object.keys(byMkt).sort()) {
    const v = byMkt[k];
    console.log(`  ${k}  total=${v.total} W=${v.win} L=${v.loss} P=${v.push} V=${v.void} (settled W+L=${v.win + v.loss})`);
  }

  console.log("\n=== prediction_results by sport only ===");
  const bySport: Record<string, number> = {};
  for (const r of (res ?? []) as any[]) bySport[r.sport] = (bySport[r.sport] ?? 0) + 1;
  for (const k of Object.keys(bySport).sort()) console.log(`  ${k} = ${bySport[k]}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
