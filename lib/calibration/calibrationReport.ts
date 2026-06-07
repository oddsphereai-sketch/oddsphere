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
import {
  CONTEXT_FLAG_DEFINITIONS,
  MISSING_DIMENSIONS,
  type ContextFlagState,
  type ContextFlagScope,
} from "./contextFlags";
import {
  buildShadowMarketReport,
  type ShadowMarketReport,
} from "./shadowCalibration";

/** Dimension columns carried alongside each (probability, won) pair. */
export type CalibrationDimensionRow = {
  sport: string;
  market: string;
  play_grade: string | null;
  confidence_bucket: string;
  model_version: string | null;
  best_angle: boolean;
  /**
   * Per-flag tri-state (yes / no / unknown). Stage 2 — added so the report
   * can split rows by each context flag and compute calibration on each
   * branch independently. "unknown" rows are excluded from that flag's
   * branches but still count in market / overall buckets.
   */
  context_flags: Record<string, ContextFlagState>;
};

export type CalibrationInputRow = CalibrationDimensionRow & CalibrationSample;

/**
 * Stage 2 — per-context-flag analysis. Splits the sample into "flag=yes"
 * and "flag=no" branches and computes calibration metrics for each. The
 * "unknown" count is surfaced separately as data-availability signal.
 */
export type ContextFlagAnalysis = {
  id: string;
  label: string;
  scope: ContextFlagScope;
  description: string;
  n_yes: number;
  n_no: number;
  n_unknown: number;
  data_availability_pct: number;
  yes_finding: CalibrationFinding;
  no_finding: CalibrationFinding;
  /**
   * Plain-English summary highlighting whether the flag appears informative
   * (when both branches have enough sample for a meaningful comparison).
   */
  summary: string;
};

/** Stage 2 — explicit list of dimensions the user asked for that the snapshot doesn't yet expose. */
export type MissingDimension = { id: string; label: string; reason: string };

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
  /**
   * Stage 2 — per-context-flag analysis (yes/no/unknown breakdown +
   * calibration on each branch). One entry per known flag whose scope
   * matches at least one sample. Flags with scope="all" are always
   * included; market-scoped flags only when relevant rows exist.
   */
  byContextFlag: ContextFlagAnalysis[];
  /**
   * Stage 2 — per-market shadow recommendations. No DB writes, no
   * thresholds changed. Each market shows what a calibrated remap
   * would have done on its historical sample.
   */
  shadowByMarket: ShadowMarketReport[];
  /**
   * Stage 2 — dimensions the user requested that aren't captured in
   * snapshot_json yet. The report calls them out so we know what to
   * extend the lock-time snapshot with before those dimensions can
   * inform calibration.
   */
  missingDimensions: MissingDimension[];
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
    byContextFlag: [],
    shadowByMarket: [],
    missingDimensions: MISSING_DIMENSIONS,
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

  // ── Stage 2: per-context-flag analysis ────────────────────────────
  for (const def of CONTEXT_FLAG_DEFINITIONS) {
    const inScope = (r: CalibrationInputRow): boolean => {
      if (def.scope === "all") return true;
      return r.market === def.scope;
    };
    const scoped = rows.filter(inScope);
    if (scoped.length === 0) continue;
    const yesRows = scoped.filter((r) => r.context_flags[def.id] === "yes");
    const noRows = scoped.filter((r) => r.context_flags[def.id] === "no");
    const unknownN = scoped.filter((r) => r.context_flags[def.id] === "unknown").length;
    const known = yesRows.length + noRows.length;
    const dataAvailabilityPct = scoped.length > 0 ? (known / scoped.length) * 100 : 0;

    const yesFinding = buildFinding(`${def.label} = YES`, "default", yesRows);
    const noFinding = buildFinding(`${def.label} = NO`, "default", noRows);

    const summary = summarizeFlag(def.label, yesFinding, noFinding, unknownN, scoped.length);

    report.byContextFlag.push({
      id: def.id,
      label: def.label,
      scope: def.scope,
      description: def.description,
      n_yes: yesRows.length,
      n_no: noRows.length,
      n_unknown: unknownN,
      data_availability_pct: dataAvailabilityPct,
      yes_finding: yesFinding,
      no_finding: noFinding,
      summary,
    });
  }
  report.byContextFlag.sort((a, b) => a.label.localeCompare(b.label));

  // ── Stage 2: per-market shadow proposals ──────────────────────────
  const byMarketForShadow = groupBy(rows, (r) => r.market);
  for (const [marketName, rs] of byMarketForShadow) {
    const samples: CalibrationSample[] = rs.map((r) => ({
      probability: r.probability,
      won: r.won,
    }));
    report.shadowByMarket.push(buildShadowMarketReport(samples, marketName));
  }
  report.shadowByMarket.sort((a, b) => a.market.localeCompare(b.market));

  return report;
}

function summarizeFlag(
  flagLabel: string,
  yes: CalibrationFinding,
  no: CalibrationFinding,
  unknownN: number,
  totalScoped: number,
): string {
  // Data availability gate
  if (yes.metrics.n + no.metrics.n === 0) {
    return `No samples have a confirmed value for "${flagLabel}". All ${unknownN}/${totalScoped} scoped rows are unknown.`;
  }
  // Both branches sufficient?
  if (yes.sample_class === "insufficient" && no.sample_class === "insufficient") {
    return `Both branches insufficient (yes=${yes.metrics.n}, no=${no.metrics.n}, unknown=${unknownN}). Monitor only.`;
  }
  if (yes.metrics.n === 0) {
    return `Flag never observed YES (no=${no.metrics.n}, unknown=${unknownN}). Cannot evaluate impact.`;
  }
  if (no.metrics.n === 0) {
    return `Flag never observed NO (yes=${yes.metrics.n}, unknown=${unknownN}). Cannot evaluate impact.`;
  }
  // Both have some sample — describe the delta if both have observed frequencies.
  if (yes.metrics.observed_freq !== null && no.metrics.observed_freq !== null) {
    const yesPct = (yes.metrics.observed_freq * 100).toFixed(1);
    const noPct = (no.metrics.observed_freq * 100).toFixed(1);
    const delta = (yes.metrics.observed_freq - no.metrics.observed_freq) * 100;
    const yesBrier = yes.metrics.brier !== null ? yes.metrics.brier.toFixed(4) : "—";
    const noBrier = no.metrics.brier !== null ? no.metrics.brier.toFixed(4) : "—";
    let actionability: string;
    if (yes.sample_class === "confident" && no.sample_class === "confident") {
      actionability = Math.abs(delta) >= 5
        ? "INFORMATIVE — large win-rate gap with confident samples on both sides."
        : "Both samples confident but gap is small — likely not predictive.";
    } else {
      actionability = "At least one branch is below confident threshold. Monitor only.";
    }
    return `yes n=${yes.metrics.n} obs=${yesPct}% Brier=${yesBrier} | no n=${no.metrics.n} obs=${noPct}% Brier=${noBrier} | gap=${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp | unknown=${unknownN}/${totalScoped} | ${actionability}`;
  }
  return `yes n=${yes.metrics.n}, no n=${no.metrics.n}, unknown=${unknownN}/${totalScoped} — monitor only.`;
}
