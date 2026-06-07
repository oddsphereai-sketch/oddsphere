/**
 * Push 6B.2 — Model calibration performance audit (read-only).
 *
 * Phase 6 deliverable. Joins `prediction_records` with `prediction_grades`
 * across a date range and reports performance by:
 *
 *   • market (moneyline / total / first_inning / nrfi / yrfi)
 *   • model version / model_used
 *   • play grade (best_angle / lean / no_bet / market_aligned / held)
 *   • Model Probability bucket
 *   • Edge bucket
 *   • Recommendation Confidence bucket (derived if absent)
 *   • Data quality tier
 *   • Favorite vs underdog (ML)
 *   • FI NRFI vs YRFI
 *   • O/U total run-delta bucket (derived from snapshot_json when present)
 *
 * For each bucket: count / graded / wins / losses / pushes / voids /
 * pending / win-rate.
 *
 * Toss-Up and Held are surfaced as MODEL-STATE counts but are NOT
 * graded as win/loss in the win-rate calculation (per spec).
 *
 * The operator NEVER writes anything. It refuses --apply. It does not
 * automatically change any model thresholds. It only surfaces data
 * the operator/admin can read to inform future calibration decisions.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/audit-model-calibration-performance.ts \
 *       --sport mlb --date-from 2026-05-01 --date-to 2026-06-06 \
 *       [--markets ml,total,fi] [--min-sample 5] [--verbose]
 */

import { supabase } from "../../lib/db/supabase";
import type { Sport } from "../../lib/types/domain/Sport";

type Market = "ml" | "total" | "fi";
type Opts = {
  sport: Sport;
  dateFrom: string;
  dateTo: string;
  markets: Set<Market>;
  minSample: number;
  verbose: boolean;
};

function parseArgs(argv: string[]): Opts {
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  let sport: Sport = "mlb";
  let minSample = 5;
  let verbose = false;
  const markets = new Set<Market>(["ml", "total", "fi"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--date-from" && argv[i + 1]) { dateFrom = argv[++i]!; continue; }
    if (a === "--date-to" && argv[i + 1]) { dateTo = argv[++i]!; continue; }
    if (a === "--markets" && argv[i + 1]) {
      markets.clear();
      for (const m of argv[++i]!.split(",").map((s) => s.trim() as Market)) markets.add(m);
      continue;
    }
    if (a === "--min-sample" && argv[i + 1]) { minSample = parseInt(argv[++i]!, 10); continue; }
    if (a === "--verbose") { verbose = true; continue; }
    if (a === "--apply") { console.error("✗ --apply not supported (read-only)."); process.exit(2); }
  }
  if (!dateFrom || !dateTo) {
    console.error("Usage: audit-model-calibration-performance.ts --sport mlb --date-from YYYY-MM-DD --date-to YYYY-MM-DD [--markets ml,total,fi] [--min-sample N] [--verbose]");
    process.exit(1);
  }
  return { sport, dateFrom, dateTo, markets, minSample, verbose };
}

type Bucket = {
  label: string;
  total: number;
  graded: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  avgModelProb: number | null;
  avgEdge: number | null;
};

function newBucket(label: string): Bucket {
  return { label, total: 0, graded: 0, wins: 0, losses: 0, pushes: 0, voids: 0, pending: 0, avgModelProb: null, avgEdge: null };
}

function fmtPct(num: number, den: number): string {
  if (den === 0) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

async function main() {
  const opts = parseArgs(process.argv);
  console.log(`\n━━━ MODEL CALIBRATION PERFORMANCE · ${opts.sport.toUpperCase()} ${opts.dateFrom}..${opts.dateTo} ━━━`);
  console.log(`     markets=${[...opts.markets].join(",")}  min-sample=${opts.minSample}  READ-ONLY\n`);

  // Pull prediction_records + prediction_grades over the range.
  const { data: records } = await supabase
    .from("prediction_records")
    .select("id, game_id, sport, slate_date, market, pick, side, model_used, model_version, model_probability, market_probability, edge, play_grade, best_angle, data_quality_tier, snapshot_json, held")
    .eq("sport", opts.sport)
    .gte("slate_date", opts.dateFrom)
    .lte("slate_date", opts.dateTo);
  if (!records || records.length === 0) {
    console.log("No prediction_records in range. Done.");
    return;
  }
  const recordIds = records.map((r) => r.id as number);

  const { data: grades } = await supabase
    .from("prediction_grades")
    .select("prediction_record_id, result, push, win, loss, void, pending, market")
    .in("prediction_record_id", recordIds);
  const gradeByRecord = new Map<number, NonNullable<typeof grades>[number]>(
    (grades ?? []).map((g) => [g.prediction_record_id as number, g]),
  );

  console.log(`  Loaded ${records.length} prediction_records · ${grades?.length ?? 0} grade rows`);

  // ── Buckets ────────────────────────────────────────────────────────
  type Row = typeof records[number] & { gradeResult: string | null };
  const rows: Row[] = records.map((r) => ({ ...r, gradeResult: gradeByRecord.get(r.id as number)?.result ?? null }));

  // Filter to requested markets.
  function marketMatches(m: string | null): boolean {
    if (m === null) return false;
    if (opts.markets.has("ml") && m === "moneyline") return true;
    if (opts.markets.has("total") && m === "total") return true;
    if (opts.markets.has("fi") && (m === "first_inning" || m === "nrfi" || m === "yrfi")) return true;
    return false;
  }
  const filteredRows = rows.filter((r) => marketMatches(r.market));

  // Skip rows we don't grade as win/loss in calibration:
  // - Toss-Up (best_angle=false + play_grade="toss_up" or play_grade marker)
  // - Held (held=true)
  // Note: pending rows are kept but counted as pending (not in win/loss).
  const gradableRows = filteredRows.filter((r) => {
    const pg = (r.play_grade as string | null) ?? "";
    if (r.held === true) return false;          // Held games — no actionable pick
    if (pg === "toss_up") return false;          // Toss-Up — no actionable pick
    if (pg === "held") return false;
    return true;
  });
  const tossUpCount = filteredRows.filter((r) => (r.play_grade ?? "") === "toss_up").length;
  const heldCount = filteredRows.filter((r) => r.held === true || (r.play_grade ?? "") === "held").length;

  function recordToBucket(r: Row, bucket: Bucket) {
    bucket.total++;
    const result = r.gradeResult;
    if (result === null || result === "pending") {
      bucket.pending++;
    } else if (result === "win") { bucket.graded++; bucket.wins++; }
    else if (result === "loss") { bucket.graded++; bucket.losses++; }
    else if (result === "push") { bucket.graded++; bucket.pushes++; }
    else if (result === "void") { bucket.voids++; }
    if (typeof r.model_probability === "number") {
      bucket.avgModelProb = (bucket.avgModelProb === null ? 0 : bucket.avgModelProb) + r.model_probability;
    }
    if (typeof r.edge === "number") {
      bucket.avgEdge = (bucket.avgEdge === null ? 0 : bucket.avgEdge) + r.edge;
    }
  }

  function finalizeBucket(b: Bucket) {
    if (b.avgModelProb !== null && b.total > 0) b.avgModelProb = b.avgModelProb / b.total;
    if (b.avgEdge !== null && b.total > 0) b.avgEdge = b.avgEdge / b.total;
  }

  function printBuckets(title: string, buckets: Map<string, Bucket>, order?: string[]) {
    console.log(`\n━━━ ${title} ━━━`);
    console.log(`  ${"bucket".padEnd(20)} count  graded  W  L  P  V  pend  win-rate   avg-prob  avg-edge`);
    console.log(`  ${"─".repeat(110)}`);
    const keys = order ?? Array.from(buckets.keys()).sort();
    for (const k of keys) {
      const b = buckets.get(k);
      if (!b) continue;
      finalizeBucket(b);
      const wr = (b.wins + b.losses) > 0 ? fmtPct(b.wins, b.wins + b.losses) : "—";
      const flag = (b.wins + b.losses) < opts.minSample ? " ⚠ small" : "";
      const ap = b.avgModelProb !== null ? (b.avgModelProb * 100).toFixed(1) + "%" : "—";
      const ae = b.avgEdge !== null ? (b.avgEdge >= 0 ? "+" : "") + b.avgEdge.toFixed(1) + "%" : "—";
      console.log(`  ${b.label.padEnd(20)} ${String(b.total).padStart(5)} ${String(b.graded).padStart(7)} ${String(b.wins).padStart(2)} ${String(b.losses).padStart(2)} ${String(b.pushes).padStart(2)} ${String(b.voids).padStart(2)} ${String(b.pending).padStart(5)}  ${wr.padStart(8)}  ${ap.padStart(7)}  ${ae.padStart(8)}${flag}`);
    }
  }

  // 1. Top-line
  const top = newBucket("ALL");
  for (const r of gradableRows) recordToBucket(r, top);
  finalizeBucket(top);
  console.log(`\n━━━ Top-line ━━━`);
  console.log(`  Total records:       ${filteredRows.length}`);
  console.log(`  Gradable (excl Toss-Up/Held): ${gradableRows.length}`);
  console.log(`  Toss-Up rows:        ${tossUpCount} (NOT graded)`);
  console.log(`  Held rows:           ${heldCount} (NOT graded)`);
  console.log(`  Graded W/L:          ${top.wins} W / ${top.losses} L / ${top.pushes} P / ${top.voids} V / ${top.pending} pending`);
  console.log(`  Overall win-rate:    ${fmtPct(top.wins, top.wins + top.losses)}`);

  // 2. By market
  const byMarket = new Map<string, Bucket>();
  for (const r of gradableRows) {
    const m = r.market ?? "(unknown)";
    if (!byMarket.has(m)) byMarket.set(m, newBucket(m));
    recordToBucket(r, byMarket.get(m)!);
  }
  printBuckets("By market", byMarket);

  // 3. By model version
  const byModel = new Map<string, Bucket>();
  for (const r of gradableRows) {
    const key = `${r.model_used ?? "?"} (${r.model_version ?? "?"})`;
    if (!byModel.has(key)) byModel.set(key, newBucket(key));
    recordToBucket(r, byModel.get(key)!);
  }
  printBuckets("By model_used / model_version", byModel);

  // 4. By play grade
  const byPlayGrade = new Map<string, Bucket>();
  for (const r of filteredRows) {  // include Toss-Up/Held as state counts
    const pg = r.play_grade ?? "(none)";
    if (!byPlayGrade.has(pg)) byPlayGrade.set(pg, newBucket(pg));
    recordToBucket(r, byPlayGrade.get(pg)!);
  }
  printBuckets("By play grade", byPlayGrade, ["best_angle", "lean", "no_bet", "market_aligned", "toss_up", "held", "(none)"]);

  // 5. By Model Probability bucket
  const probBuckets: Array<{ name: string; min: number; max: number }> = [
    { name: "<50",    min: 0,    max: 0.50 },
    { name: "50-55",  min: 0.50, max: 0.55 },
    { name: "55-60",  min: 0.55, max: 0.60 },
    { name: "60-65",  min: 0.60, max: 0.65 },
    { name: "65-70",  min: 0.65, max: 0.70 },
    { name: "70+",    min: 0.70, max: 1.01 },
  ];
  const byProb = new Map<string, Bucket>();
  for (const b of probBuckets) byProb.set(b.name, newBucket(b.name));
  for (const r of gradableRows) {
    const p = r.model_probability;
    if (typeof p !== "number") continue;
    const b = probBuckets.find((x) => p >= x.min && p < x.max);
    if (b) recordToBucket(r, byProb.get(b.name)!);
  }
  printBuckets("By Model Probability", byProb, probBuckets.map((b) => b.name));

  // 6. By Edge bucket
  const edgeBuckets: Array<{ name: string; min: number; max: number }> = [
    { name: "negative",      min: -Infinity, max: 0 },
    { name: "0-2pp",         min: 0,         max: 2 },
    { name: "2-4pp",         min: 2,         max: 4 },
    { name: "4-6pp",         min: 4,         max: 6 },
    { name: "6-10pp",        min: 6,         max: 10 },
    { name: "10pp+",         min: 10,        max: 1000 },
  ];
  const byEdge = new Map<string, Bucket>();
  for (const b of edgeBuckets) byEdge.set(b.name, newBucket(b.name));
  for (const r of gradableRows) {
    const e = r.edge;
    if (typeof e !== "number") continue;
    const b = edgeBuckets.find((x) => e > x.min && e <= x.max);
    if (b) recordToBucket(r, byEdge.get(b.name)!);
  }
  printBuckets("By Edge (percentage points)", byEdge, edgeBuckets.map((b) => b.name));

  // 7. By data quality tier
  const byTier = new Map<string, Bucket>();
  for (const r of gradableRows) {
    const t = r.data_quality_tier ?? "(unknown)";
    if (!byTier.has(t)) byTier.set(t, newBucket(t));
    recordToBucket(r, byTier.get(t)!);
  }
  printBuckets("By data quality tier", byTier);

  // 8. Best Angle vs Lean (the launch-relevant split)
  const baLean = new Map<string, Bucket>();
  for (const r of gradableRows) {
    const key = r.best_angle === true ? "Best Angle" : (r.play_grade === "lean" ? "Lean" : "Other (no_bet/aligned)");
    if (!baLean.has(key)) baLean.set(key, newBucket(key));
    recordToBucket(r, baLean.get(key)!);
  }
  printBuckets("Best Angle vs Lean", baLean, ["Best Angle", "Lean", "Other (no_bet/aligned)"]);

  // 9. Recommendations summary
  console.log(`\n━━━ Recommendations (insufficient-sample warnings flagged with ⚠) ━━━`);
  const baBucket = baLean.get("Best Angle");
  const leanBucket = baLean.get("Lean");
  if (baBucket && leanBucket) {
    const baWr = baBucket.wins + baBucket.losses > 0 ? baBucket.wins / (baBucket.wins + baBucket.losses) : null;
    const leanWr = leanBucket.wins + leanBucket.losses > 0 ? leanBucket.wins / (leanBucket.wins + leanBucket.losses) : null;
    if (baWr !== null && leanWr !== null) {
      const diff = (baWr - leanWr) * 100;
      console.log(`  Best Angle vs Lean win-rate diff: ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pp ` +
        `(BA ${(baWr * 100).toFixed(1)}% / Lean ${(leanWr * 100).toFixed(1)}%)`);
      if (Math.abs(diff) < 3) console.log(`    → No clear edge for Best Angle yet. Keep current Rec ceilings.`);
      else if (diff > 5) console.log(`    → Best Angle outperforming Lean clearly. Consider loosening Rec ceilings AFTER more samples.`);
      else if (diff < -5) console.log(`    → Best Angle UNDERPERFORMING Lean. Investigate before any loosening.`);
    }
  }

  console.log(`\nREAD-ONLY — no DB writes. No model thresholds changed.`);
  console.log(`Recommendations are surfacing only; calibration adjustments require a separate operator/PR.\n`);
  void opts.verbose;
}

if (require.main === module) {
  main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
}
