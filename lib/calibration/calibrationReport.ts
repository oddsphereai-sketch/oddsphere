/**
 * Phase 7A Stage 1 — Calibration report builder.
 *
 * Pure module. Takes a flat array of calibration input rows (one per
 * settled actionable pick) and returns a structured report covering:
 *
 *   • Overall
 *   • By sport / market / sport×market / confidence bucket / play grade
 *     / model version
 *   • Best Angle cut (best_angle = true)
 *   • Lean cut (play_grade = "lean")
 *
 * Each finding carries:
 *   • metrics — n, Brier, log-loss, ECE, mean predicted, observed,
 *     reliability bins
 *   • sample_class — insufficient / exploratory / confident
 *   • notes — plain-English explanation of what the numbers mean
 *
 * No DB. No I/O. No randomness. The operator script reads from the
 * prediction_records + prediction_grades tables and hands the joined
 * rows to buildCalibrationReport.
 *
 * Stage 2 (later) will extend this with shadow calibration proposals —
 * the same input rows, plus a per-bin recalibration curve and projected
 * Brier delta. The report shape here is built to accept that addition
 * additively (extra fields on each finding).
 */

import {
  computeCalibrationMetrics,
  type CalibrationSample,
  type CalibrationMetrics,
} from "./calibrationMath";
import { classifySampleSize, type SampleSizeClass } from "./sampleSize";

/** Dimension columns carried alongside each (probability, won) pair. */
export type CalibrationDimensionRow = {
  sport: string;
  market: string;
  play_grade: string | null;
  confidence_bucket: string;
  model_version: string | null;
  best_angle: boolean;
};

export type CalibrationInputRow = CalibrationDimensionRow & CalibrationSample;

export type CalibrationFinding = {
  label: string;
  /** Market name used to pick the sample-size threshold (or "default"). */
  market_for_sizing: string;
  metrics: CalibrationMetrics;
  sample_class: SampleSizeClass;
  /** Plain-English explanations of the finding. */
  notes: string[];
};

export type CalibrationReport = {
  generated_at: string;
  total_input_rows: number;
  total_settled_actionable: number;
  overall: CalibrationFinding;
  bySport: CalibrationFinding[];
  byMarket: CalibrationFinding[];
  bySportMarket: CalibrationFinding[];
  byConfidenceBucket: CalibrationFinding[];
  byPlayGrade: CalibrationFinding[];
  byModelVersion: CalibrationFinding[];
  bestAngles: CalibrationFinding;
  leans: CalibrationFinding;
};

function buildFinding(
  label: string,
  marketForSizing: string,
  rows: ReadonlyArray<CalibrationInputRow>,
): CalibrationFinding {
  const samples: CalibrationSample[] = rows.map((r) => ({
    probability: r.probability,
    won: r.won,
  }));
  const metrics = computeCalibrationMetrics(samples);
  const sampleClass = classifySampleSize(metrics.n, marketForSizing);
  return {
    label,
    market_for_sizing: marketForSizing,
    metrics,
    sample_class: sampleClass,
    notes: buildNotes(metrics, sampleClass),
  };
}

function buildNotes(m: CalibrationMetrics, cls: SampleSizeClass): string[] {
  const notes: string[] = [];
  if (m.n === 0) {
    notes.push("No settled actionable picks yet.");
    return notes;
  }
  if (cls === "insufficient") {
    notes.push(
      `Sample size ${m.n} — below minimum for actionable calibration. Numbers are exploratory only and may shift dramatically with more grades.`,
    );
  } else if (cls === "exploratory") {
    notes.push(
      `Sample size ${m.n} — directionally meaningful, not yet a confident read.`,
    );
  } else {
    notes.push(`Sample size ${m.n} — confident threshold reached.`);
  }
  if (m.mean_predicted !== null && m.observed_freq !== null) {
    const predPct = (m.mean_predicted * 100).toFixed(1);
    const obsPct = (m.observed_freq * 100).toFixed(1);
    const gapPp = (m.mean_predicted - m.observed_freq) * 100;
    const absGapPp = Math.abs(gapPp);
    let direction: string;
    if (absGapPp < 0.5) direction = "well calibrated";
    else if (gapPp > 0) direction = "overconfident";
    else direction = "underconfident";
    notes.push(
      `Model predicts ${predPct}% on average; observed ${obsPct}% — ${direction} by ${absGapPp.toFixed(1)} pp.`,
    );
  }
  if (m.brier !== null) {
    notes.push(
      `Brier ${m.brier.toFixed(4)} (random ≈ 0.25; perfect = 0; lower is better).`,
    );
  }
  if (m.ece !== null) {
    notes.push(
      `ECE ${m.ece.toFixed(4)} (mean per-bin miscalibration; lower is better).`,
    );
  }
  // Worst bin highlight — only when there's a meaningful gap to report.
  let worstBin = m.bins[0];
  let worstGap = 0;
  for (const b of m.bins) {
    if (b.abs_gap !== null && b.count > 0 && b.abs_gap > worstGap) {
      worstGap = b.abs_gap;
      worstBin = b;
    }
  }
  if (worstGap > 0.05 && worstBin.count > 0) {
    const lo = (worstBin.bin_low * 100).toFixed(0);
    const hi = (worstBin.bin_high * 100).toFixed(0);
    const pred = ((worstBin.mean_predicted ?? 0) * 100).toFixed(1);
    const obs = ((worstBin.observed_freq ?? 0) * 100).toFixed(1);
    notes.push(
      `Largest gap in the ${lo}-${hi}% bin: predicted ${pred}%, observed ${obs}% (n=${worstBin.count}).`,
    );
  }
  return notes;
}

function groupBy<K extends string>(
  rows: ReadonlyArray<CalibrationInputRow>,
  keyFn: (r: CalibrationInputRow) => K | null,
): Map<K, CalibrationInputRow[]> {
  const out = new Map<K, CalibrationInputRow[]>();
  for (const r of rows) {
    const k = keyFn(r);
    if (k === null) continue;
    let arr = out.get(k);
    if (arr === undefined) {
      arr = [];
      out.set(k, arr);
    }
    arr.push(r);
  }
  return out;
}

export function buildCalibrationReport(
  rows: ReadonlyArray<CalibrationInputRow>,
): CalibrationReport {
  const report: CalibrationReport = {
    generated_at: new Date().toISOString(),
    total_input_rows: rows.length,
    total_settled_actionable: rows.length,
    overall: buildFinding("overall", "default", rows),
    bySport: [],
    byMarket: [],
    bySportMarket: [],
    byConfidenceBucket: [],
    byPlayGrade: [],
    byModelVersion: [],
    bestAngles: buildFinding(
      "Best Angle",
      "default",
      rows.filter((r) => r.best_angle === true),
    ),
    leans: buildFinding(
      "Lean",
      "default",
      rows.filter((r) => r.play_grade === "lean"),
    ),
  };

  const bySport = groupBy(rows, (r) => r.sport);
  for (const [k, rs] of bySport) report.bySport.push(buildFinding(k, "default", rs));
  report.bySport.sort((a, b) => a.label.localeCompare(b.label));

  const byMarket = groupBy(rows, (r) => r.market);
  for (const [k, rs] of byMarket) report.byMarket.push(buildFinding(k, k, rs));
  report.byMarket.sort((a, b) => a.label.localeCompare(b.label));

  const bySportMarket = groupBy(rows, (r) => `${r.sport}::${r.market}` as string);
  for (const [k, rs] of bySportMarket) {
    const market = k.split("::")[1] ?? "default";
    report.bySportMarket.push(buildFinding(k, market, rs));
  }
  report.bySportMarket.sort((a, b) => a.label.localeCompare(b.label));

  const byBucket = groupBy(rows, (r) => r.confidence_bucket);
  for (const [k, rs] of byBucket) report.byConfidenceBucket.push(buildFinding(k, "default", rs));
  report.byConfidenceBucket.sort((a, b) => a.label.localeCompare(b.label));

  const byGrade = groupBy(rows, (r) => r.play_grade ?? "(none)");
  for (const [k, rs] of byGrade) report.byPlayGrade.push(buildFinding(k, "default", rs));
  report.byPlayGrade.sort((a, b) => a.label.localeCompare(b.label));

  const byVersion = groupBy(rows, (r) => r.model_version ?? "(unknown)");
  for (const [k, rs] of byVersion) report.byModelVersion.push(buildFinding(k, "default", rs));
  report.byModelVersion.sort((a, b) => a.label.localeCompare(b.label));

  return report;
}
