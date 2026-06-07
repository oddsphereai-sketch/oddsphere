/**
 * Phase 7A Stage 1 — Calibration Report operator (read-only).
 *
 * Joins prediction_records + prediction_grades, filters to settled
 * actionable rows, computes calibration metrics, prints a deterministic
 * report.
 *
 * STRICTLY read-only:
 *   • Refuses --apply.
 *   • Never writes to prediction_records, prediction_grades, games, or
 *     any other table.
 *   • Does NOT read prediction_records.calibration_version (column lives
 *     in the schema for Phase 7A Stage 3+, no consumer in this push).
 *   • No effect on Daily Edge, tracking, or grading.
 *
 * Filters applied (mirrors trackingAggregateService's tally semantics):
 *   • sport = mlb                — V1 scope; widen when other sports grade.
 *   • no_bet = false             — Toss-Up / Held / no-bet rows excluded
 *                                  (they were never bets the member could
 *                                  place; including them would invent
 *                                  picks).
 *   • launch_day = false         — standard tracking exclusion.
 *   • grade.win OR grade.loss    — only binary outcomes feed calibration.
 *                                  pushes / voids / pendings drop out.
 *   • model_probability ∈ (0, 1) — endpoints would explode log-loss and
 *                                  carry no calibration signal.
 *
 * Output: console table. Pass --json for machine-readable JSON dump.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/calibration-report.ts
 *   npx tsx --env-file=.env.local scripts/operator/calibration-report.ts --json > report.json
 */

import { createClient } from "@supabase/supabase-js";
import { bucketForConfidence } from "../../lib/types/domain/Tracking";
import {
  buildCalibrationReport,
  type CalibrationFinding,
  type CalibrationInputRow,
} from "../../lib/calibration/calibrationReport";

const APPLY_REQUESTED = process.argv.includes("--apply");
const JSON_OUT = process.argv.includes("--json");

async function main() {
  if (APPLY_REQUESTED) {
    console.error("ERROR: --apply not supported. This operator is read-only.");
    process.exit(1);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // ── 1. Load MLB prediction_records that are not no_bet / launch_day. ──
  const { data: recRows, error: recErr } = await sb
    .from("prediction_records")
    .select(
      "id, sport, market, play_grade, confidence, model_probability, model_version, best_angle, no_bet, launch_day",
    )
    .eq("sport", "mlb")
    .eq("no_bet", false)
    .eq("launch_day", false);
  if (recErr) {
    console.error("FATAL records fetch:", recErr.message);
    process.exit(1);
  }
  const records = (recRows ?? []) as Array<{
    id: number;
    sport: string;
    market: string;
    play_grade: string | null;
    confidence: number | null;
    model_probability: number | null;
    model_version: string | null;
    best_angle: boolean;
    no_bet: boolean;
    launch_day: boolean;
  }>;

  // ── 2. Join grades — chunk to keep .in() under URL limits. ──
  const recIds = records.map((r) => r.id);
  const grades = new Map<number, { result: string; win: boolean; loss: boolean }>();
  for (let i = 0; i < recIds.length; i += 500) {
    const chunk = recIds.slice(i, i + 500);
    const { data: gRows, error: gErr } = await sb
      .from("prediction_grades")
      .select("prediction_record_id, result, win, loss")
      .in("prediction_record_id", chunk);
    if (gErr) {
      console.error("FATAL grades fetch:", gErr.message);
      process.exit(1);
    }
    for (const g of (gRows ?? []) as Array<{
      prediction_record_id: number;
      result: string;
      win: boolean;
      loss: boolean;
    }>) {
      grades.set(g.prediction_record_id, { result: g.result, win: g.win, loss: g.loss });
    }
  }

  // ── 3. Build calibration samples — binary outcomes only. ──
  const inputs: CalibrationInputRow[] = [];
  let skippedNoGrade = 0;
  let skippedNotBinary = 0;
  let skippedBadProb = 0;
  for (const r of records) {
    const g = grades.get(r.id);
    if (g === undefined) {
      skippedNoGrade++;
      continue;
    }
    if (!g.win && !g.loss) {
      skippedNotBinary++;
      continue;
    }
    const p = r.model_probability;
    if (typeof p !== "number" || !Number.isFinite(p) || p <= 0 || p >= 1) {
      skippedBadProb++;
      continue;
    }
    inputs.push({
      sport: r.sport,
      market: r.market,
      play_grade: r.play_grade,
      confidence_bucket: bucketForConfidence(r.confidence),
      model_version: r.model_version,
      best_angle: r.best_angle === true,
      probability: p,
      won: g.win === true,
    });
  }

  const report = buildCalibrationReport(inputs);

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          ...report,
          _audit: {
            records_loaded: records.length,
            grades_loaded: grades.size,
            skipped_no_grade: skippedNoGrade,
            skipped_not_binary: skippedNotBinary,
            skipped_bad_prob: skippedBadProb,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  // ── Pretty console output. ──
  console.log("\n═══ Phase 7A Stage 1 — Calibration Report (read-only) ═══");
  console.log(`Generated at: ${report.generated_at}`);
  console.log(`Records loaded:           ${records.length}`);
  console.log(`Grades joined:            ${grades.size}`);
  console.log(`Skipped — no grade row:   ${skippedNoGrade}`);
  console.log(`Skipped — not win/loss:   ${skippedNotBinary}`);
  console.log(`Skipped — bad/missing p:  ${skippedBadProb}`);
  console.log(`Final calibration sample: ${report.total_settled_actionable}`);

  if (report.total_settled_actionable === 0) {
    console.log("\nNo settled actionable rows available yet. Re-run after slates begin to grade.");
    return;
  }

  printFinding("OVERALL", report.overall);
  printGroup("By Sport", report.bySport);
  printGroup("By Market", report.byMarket);
  printGroup("By Sport × Market", report.bySportMarket);
  printGroup("By Confidence Bucket", report.byConfidenceBucket);
  printGroup("By Play Grade", report.byPlayGrade);
  printGroup("By Model Version", report.byModelVersion);
  printFinding("BEST ANGLES (best_angle=true)", report.bestAngles);
  printFinding("LEANS (play_grade=lean)", report.leans);

  console.log("\n─── Reminders ─────────────────────────────────────────────");
  console.log("  • This report is informational only.");
  console.log("  • No DB writes, no threshold changes, no model behavior changes.");
  console.log("  • Phase 7A Stages 2-4 will add shadow / operator-applied / guarded auto-apply.");
}

function printFinding(label: string, f: CalibrationFinding): void {
  console.log(`\n── ${label} ── sample=${f.metrics.n} class=${f.sample_class}`);
  for (const note of f.notes) console.log(`  • ${note}`);
  if (f.metrics.n === 0) return;
  const occupied = f.metrics.bins.filter((b) => b.count > 0);
  if (occupied.length === 0) return;
  console.log("  reliability bins (count, mean predicted, observed, |gap|):");
  for (const b of occupied) {
    const lo = (b.bin_low * 100).toFixed(0).padStart(3);
    const hi = (b.bin_high * 100).toFixed(0).padStart(3);
    const mp = ((b.mean_predicted ?? 0) * 100).toFixed(1).padStart(5);
    const of = ((b.observed_freq ?? 0) * 100).toFixed(1).padStart(5);
    const gap = ((b.abs_gap ?? 0) * 100).toFixed(1).padStart(4);
    console.log(
      `    [${lo}-${hi}%] n=${String(b.count).padStart(4)}  pred=${mp}%  obs=${of}%  |gap|=${gap}pp`,
    );
  }
}

function printGroup(label: string, findings: CalibrationFinding[]): void {
  console.log(`\n═══ ${label} ═══`);
  if (findings.length === 0) {
    console.log("  (no data)");
    return;
  }
  for (const f of findings) printFinding(f.label, f);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("FATAL:", e?.message ?? e);
    process.exit(1);
  });
}
