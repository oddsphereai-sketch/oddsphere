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
  type ContextFlagAnalysis,
} from "../../lib/calibration/calibrationReport";
import { extractContextFlags } from "../../lib/calibration/contextFlags";
import type { ShadowMarketReport } from "../../lib/calibration/shadowCalibration";
import type { PredictionRecordRow } from "../../lib/types/domain/Tracking";

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
  // Stage 2 also pulls provisional + snapshot_json so the context-flag
  // extractor has the raw lock-time data it needs. snapshot_json is opaque
  // JSONB; the extractor is defensive about missing paths.
  const { data: recRows, error: recErr } = await sb
    .from("prediction_records")
    .select(
      "id, game_prediction_id, game_id, external_id, sport, slate_date, game_date, matchup, market, pick, side, line_value, odds_american, odds_decimal, model_used, model_version, prediction_source, confidence, model_probability, market_probability, edge, expected_value, play_grade, prediction_type, best_angle, no_bet, no_bet_reason, market_aligned, data_quality_tier, source_quality, provisional, held, hold_reason, launch_day, manual_outcome_expected, locked_at, published_at, snapshot_json",
    )
    .eq("sport", "mlb")
    .eq("no_bet", false)
    .eq("launch_day", false);
  if (recErr) {
    console.error("FATAL records fetch:", recErr.message);
    process.exit(1);
  }
  const records = (recRows ?? []) as PredictionRecordRow[];

  // ── 2. Join grades — chunk to keep .in() under URL limits. ──
  const recIds = records.map((r) => r.id).filter((x): x is number => typeof x === "number");
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
    if (r.id === undefined) {
      skippedNoGrade++;
      continue;
    }
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
      context_flags: extractContextFlags(r),
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

  // ── Stage 2: Context Flag Analysis ────────────────────────────────
  console.log("\n\n═══ Stage 2 — Context Flags (per-flag yes/no calibration split) ═══");
  if (report.byContextFlag.length === 0) {
    console.log("  (no in-scope rows to analyze)");
  } else {
    for (const flag of report.byContextFlag) printContextFlag(flag);
  }

  // ── Stage 2: Shadow Calibration per Market ────────────────────────
  console.log("\n\n═══ Stage 2 — Shadow Calibration Proposals (per market, no writes) ═══");
  if (report.shadowByMarket.length === 0) {
    console.log("  (no settled rows in any market)");
  } else {
    for (const sm of report.shadowByMarket) printShadowMarket(sm);
  }

  // ── Stage 2: Missing Dimensions ───────────────────────────────────
  console.log("\n\n═══ Stage 2 — Missing Dimensions (snapshot_json gaps) ═══");
  for (const md of report.missingDimensions) {
    console.log(`\n  ◯ ${md.label}  [${md.id}]`);
    console.log(`    ${md.reason}`);
  }

  console.log("\n─── Reminders ─────────────────────────────────────────────");
  console.log("  • This report is informational only.");
  console.log("  • No DB writes, no threshold changes, no model behavior changes.");
  console.log("  • Shadow proposals are evaluated against historical tracked data only.");
  console.log("  • Phase 7A Stages 3-4 will add operator-applied / guarded auto-apply.");
}

function printContextFlag(flag: ContextFlagAnalysis): void {
  console.log(`\n── ${flag.label}  [${flag.id}, scope=${flag.scope}] ──`);
  console.log(`  ${flag.description}`);
  console.log(
    `  yes=${flag.n_yes}  no=${flag.n_no}  unknown=${flag.n_unknown}  data_availability=${flag.data_availability_pct.toFixed(1)}%`,
  );
  console.log(`  ${flag.summary}`);
}

function printShadowMarket(sm: ShadowMarketReport): void {
  console.log(`\n── Market: ${sm.market} ── n=${sm.n} class=${sm.sample_class}`);
  console.log(`  ${sm.overall_recommendation}`);
  if (sm.n > 0) {
    const lbf = (v: number | null) => (v === null ? "—" : v.toFixed(4));
    const dl = (v: number | null) => (v === null ? "—" : (v >= 0 ? `+${v.toFixed(4)}` : v.toFixed(4)));
    console.log(`  Live  : Brier ${lbf(sm.live_brier)}  LogLoss ${lbf(sm.live_log_loss)}  ECE ${lbf(sm.live_ece)}`);
    console.log(`  Shadow: Brier ${lbf(sm.shadow_brier)}  LogLoss ${lbf(sm.shadow_log_loss)}  ECE ${lbf(sm.shadow_ece)}`);
    console.log(`  Delta : Brier ${dl(sm.brier_delta)}  LogLoss ${dl(sm.log_loss_delta)}  ECE ${dl(sm.ece_delta)}     (positive = shadow improves)`);
    const occupied = sm.buckets.filter((b) => b.n > 0);
    if (occupied.length > 0) {
      console.log("  per-bucket:");
      for (const b of occupied) {
        const lo = (b.bin_low * 100).toFixed(0).padStart(3);
        const hi = (b.bin_high * 100).toFixed(0).padStart(3);
        const proposed = b.proposed_probability === null ? "—" : `${(b.proposed_probability * 100).toFixed(1)}%`;
        const mp = ((b.mean_predicted ?? 0) * 100).toFixed(1).padStart(5);
        const of = ((b.observed_freq ?? 0) * 100).toFixed(1).padStart(5);
        console.log(`    [${lo}-${hi}%] n=${String(b.n).padStart(4)}  pred=${mp}%  obs=${of}%  class=${b.sample_class.padEnd(12)}  proposed=${proposed}`);
        console.log(`        ${b.recommendation}`);
      }
    }
  }
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
