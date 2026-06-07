/**
 * Phase 7A Stage 1 — tests for calibration math + report builder + sample-size
 * classification.
 *
 * Pure unit tests — no DB. All inputs are hand-built so failures point at a
 * specific math/binning/notes invariant.
 */

import {
  computeBrier,
  computeECE,
  computeLogLoss,
  computeReliabilityBins,
  computeCalibrationMetrics,
  DEFAULT_RELIABILITY_BINS,
  type CalibrationSample,
} from "../lib/calibration/calibrationMath";
import { classifySampleSize } from "../lib/calibration/sampleSize";
import {
  buildCalibrationReport,
  type CalibrationInputRow,
} from "../lib/calibration/calibrationReport";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function approx(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

// ── Brier ─────────────────────────────────────────────────────────────
console.log("━━━ Brier ━━━");
check("empty → null", computeBrier([]) === null);
{
  // (0.6-1)^2 + (0.6-0)^2 = 0.16 + 0.36 = 0.52 / 2 = 0.26
  const s: CalibrationSample[] = [
    { probability: 0.6, won: true },
    { probability: 0.6, won: false },
  ];
  check("Brier(.6 W, .6 L) = 0.26", approx(computeBrier(s)!, 0.26));
}
{
  const s: CalibrationSample[] = [
    { probability: 1.0, won: true },
    { probability: 0.0, won: false },
  ];
  check("Brier perfect predictor = 0", computeBrier(s) === 0);
}
{
  const s: CalibrationSample[] = [
    { probability: 1.0, won: false },
    { probability: 0.0, won: true },
  ];
  check("Brier worst predictor = 1.0", computeBrier(s) === 1);
}

// ── Log loss ──────────────────────────────────────────────────────────
console.log("\n━━━ Log loss ━━━");
check("empty → null", computeLogLoss([]) === null);
{
  const s: CalibrationSample[] = [{ probability: 0.5, won: true }];
  check("logLoss(.5 W) ≈ 0.693", approx(computeLogLoss(s)!, Math.log(2), 1e-6));
}
{
  const s: CalibrationSample[] = [{ probability: 0.9, won: true }];
  check("logLoss(.9 W) ≈ 0.105", approx(computeLogLoss(s)!, -Math.log(0.9), 1e-6));
}
{
  // p = 0 with a win would explode without clamping
  const s: CalibrationSample[] = [{ probability: 0, won: true }];
  const v = computeLogLoss(s);
  check(
    "logLoss(p=0, won=true) is finite (clamp to eps)",
    v !== null && Number.isFinite(v),
  );
}
{
  const s: CalibrationSample[] = [{ probability: 1, won: false }];
  const v = computeLogLoss(s);
  check(
    "logLoss(p=1, won=false) is finite (clamp to 1-eps)",
    v !== null && Number.isFinite(v),
  );
}

// ── Reliability bins ──────────────────────────────────────────────────
console.log("\n━━━ Reliability bins ━━━");
{
  const bins = computeReliabilityBins([], 10);
  check(
    "empty → 10 bins, all count=0",
    bins.length === 10 && bins.every((b) => b.count === 0 && b.mean_predicted === null),
  );
  check("default bin count constant = 10", DEFAULT_RELIABILITY_BINS === 10);
}
{
  const s: CalibrationSample[] = [
    { probability: 0.05, won: false },
    { probability: 0.55, won: true },
    { probability: 0.95, won: true },
  ];
  const bins = computeReliabilityBins(s, 10);
  check("3 samples → 3 occupied bins", bins.filter((b) => b.count > 0).length === 3);
  check("p=0.05 → bin 0", bins[0].count === 1);
  check("p=0.55 → bin 5", bins[5].count === 1);
  check("p=0.95 → bin 9", bins[9].count === 1);
}
{
  // p = 1.0 should land in the LAST bin (not bin 10 which doesn't exist)
  const s: CalibrationSample[] = [{ probability: 1.0, won: true }];
  const bins = computeReliabilityBins(s, 10);
  check("p=1.0 → last bin (index 9), not OOB", bins[9].count === 1);
}
{
  const s: CalibrationSample[] = [
    { probability: 0.55, won: true },
    { probability: 0.55, won: true },
    { probability: 0.55, won: false },
    { probability: 0.55, won: false },
  ];
  const bins = computeReliabilityBins(s, 10);
  const b = bins[5];
  check("4 samples in bin 5, mean_pred=.55", b.count === 4 && approx(b.mean_predicted!, 0.55));
  check("observed_freq = .5", approx(b.observed_freq!, 0.5));
  check("abs_gap = .05", approx(b.abs_gap!, 0.05));
}

// ── ECE ───────────────────────────────────────────────────────────────
console.log("\n━━━ ECE ━━━");
check("empty → null", computeECE([]) === null);
{
  // Perfect calibration: pred = obs = 0.5 in one bin → gap = 0 → ECE = 0
  const s: CalibrationSample[] = [
    { probability: 0.5, won: true },
    { probability: 0.5, won: false },
  ];
  const bins = computeReliabilityBins(s, 10);
  const ece = computeECE(bins);
  check("ECE perfectly calibrated single bin = 0", approx(ece!, 0));
}
{
  // 2 samples in bin 8 (p=0.8), both lose → gap = 0.8 → ECE = 0.8
  const s: CalibrationSample[] = [
    { probability: 0.8, won: false },
    { probability: 0.8, won: false },
  ];
  const bins = computeReliabilityBins(s, 10);
  const ece = computeECE(bins);
  check("ECE single bin overconfident = 0.8", approx(ece!, 0.8, 1e-6));
}
{
  // Two bins, weighted: 8 in bin 5 gap 0.1, 2 in bin 8 gap 0.5
  // ECE = (8/10)*0.1 + (2/10)*0.5 = 0.08 + 0.10 = 0.18
  const s: CalibrationSample[] = [];
  // bin 5: predicted ~0.55, 8 samples, observed 4/8 = 0.5 → gap 0.05? Let's
  // pick numbers that are exact.
  // bin 5 (0.5..0.6): all p=0.55. 8 samples, 4 wins → mean_pred=.55, observed=.5, gap=.05
  for (let i = 0; i < 4; i++) s.push({ probability: 0.55, won: true });
  for (let i = 0; i < 4; i++) s.push({ probability: 0.55, won: false });
  // bin 8 (0.8..0.9): p=0.85, 2 samples, observed 0 → gap=0.85
  s.push({ probability: 0.85, won: false }, { probability: 0.85, won: false });
  const bins = computeReliabilityBins(s, 10);
  const ece = computeECE(bins);
  // weights: 8/10 * 0.05 + 2/10 * 0.85 = 0.04 + 0.17 = 0.21
  check("ECE weighted by bin size", approx(ece!, 0.21, 1e-6));
}

// ── computeCalibrationMetrics ─────────────────────────────────────────
console.log("\n━━━ computeCalibrationMetrics ━━━");
{
  const m = computeCalibrationMetrics([]);
  check(
    "empty → n=0 + all metrics null",
    m.n === 0 &&
      m.brier === null &&
      m.log_loss === null &&
      m.ece === null &&
      m.mean_predicted === null &&
      m.observed_freq === null,
  );
  check("empty → 10 bins returned (chart continuity)", m.bins.length === 10);
}
{
  const m = computeCalibrationMetrics([
    { probability: 0.6, won: true },
    { probability: 0.6, won: false },
  ]);
  check("n = 2", m.n === 2);
  check("mean_predicted = .6", approx(m.mean_predicted!, 0.6));
  check("observed_freq = .5", approx(m.observed_freq!, 0.5));
  check("Brier = 0.26", approx(m.brier!, 0.26));
}

// ── Sample-size classifier ────────────────────────────────────────────
console.log("\n━━━ Sample-size classifier ━━━");
check("n=0 default → insufficient", classifySampleSize(0) === "insufficient");
check("n=99 moneyline → insufficient", classifySampleSize(99, "moneyline") === "insufficient");
check("n=100 moneyline → exploratory", classifySampleSize(100, "moneyline") === "exploratory");
check("n=399 moneyline → exploratory", classifySampleSize(399, "moneyline") === "exploratory");
check("n=400 moneyline → confident", classifySampleSize(400, "moneyline") === "confident");
check("n=199 total → insufficient", classifySampleSize(199, "total") === "insufficient");
check("n=200 total → exploratory", classifySampleSize(200, "total") === "exploratory");
check("n=800 total → confident", classifySampleSize(800, "total") === "confident");
check("n=399 first_inning → insufficient", classifySampleSize(399, "first_inning") === "insufficient");
check("n=400 first_inning → exploratory", classifySampleSize(400, "first_inning") === "exploratory");
check("n=1600 first_inning → confident", classifySampleSize(1600, "first_inning") === "confident");
check(
  "unknown market → default thresholds",
  classifySampleSize(150, "unknown_market") === "insufficient" &&
    classifySampleSize(200, "unknown_market") === "exploratory" &&
    classifySampleSize(800, "unknown_market") === "confident",
);

// ── buildCalibrationReport — empty ────────────────────────────────────
console.log("\n━━━ buildCalibrationReport empty ━━━");
{
  const report = buildCalibrationReport([]);
  check("overall.n = 0", report.overall.metrics.n === 0);
  check("bySport empty", report.bySport.length === 0);
  check("byMarket empty", report.byMarket.length === 0);
  check("bySportMarket empty", report.bySportMarket.length === 0);
  check("bestAngles.n = 0", report.bestAngles.metrics.n === 0);
  check("leans.n = 0", report.leans.metrics.n === 0);
  check(
    "empty input → notes mention no settled actionable",
    report.overall.notes.some((n) => /no settled actionable/i.test(n)),
  );
}

// ── buildCalibrationReport — small mixed ──────────────────────────────
console.log("\n━━━ buildCalibrationReport small mixed ━━━");
{
  const inputs: CalibrationInputRow[] = [
    {
      sport: "mlb",
      market: "moneyline",
      play_grade: "best_angle",
      confidence_bucket: "53_55",
      model_version: "v2_2",
      best_angle: true,
      probability: 0.55,
      won: true,
    },
    {
      sport: "mlb",
      market: "moneyline",
      play_grade: "best_angle",
      confidence_bucket: "53_55",
      model_version: "v2_2",
      best_angle: true,
      probability: 0.55,
      won: false,
    },
    {
      sport: "mlb",
      market: "first_inning",
      play_grade: "lean",
      confidence_bucket: "50_52",
      model_version: "fi_v2",
      best_angle: false,
      probability: 0.52,
      won: true,
    },
  ];
  const report = buildCalibrationReport(inputs);
  check("overall.n = 3", report.overall.metrics.n === 3);
  check("bySport has mlb only", report.bySport.length === 1 && report.bySport[0].label === "mlb");
  check("byMarket has 2 (moneyline, first_inning)", report.byMarket.length === 2);
  check("bySportMarket has 2", report.bySportMarket.length === 2);
  check("bestAngles.n = 2", report.bestAngles.metrics.n === 2);
  check("leans.n = 1", report.leans.metrics.n === 1);
  check("byModelVersion has v2_2 and fi_v2", report.byModelVersion.length === 2);
  // Insufficient classification fires
  const ml = report.byMarket.find((f) => f.label === "moneyline")!;
  check("moneyline n=2 → insufficient", ml.sample_class === "insufficient");
  check(
    "insufficient note mentions 'below minimum'",
    ml.notes.some((n) => /below minimum/i.test(n)),
  );
}

// ── Perfect calibration → ECE near 0 ──────────────────────────────────
console.log("\n━━━ Perfect calibration smoke ━━━");
{
  const inputs: CalibrationInputRow[] = [];
  for (let i = 0; i < 5; i++) {
    inputs.push({
      sport: "mlb",
      market: "moneyline",
      play_grade: "lean",
      confidence_bucket: "50_52",
      model_version: "v2_2",
      best_angle: false,
      probability: 0.5,
      won: true,
    });
  }
  for (let i = 0; i < 5; i++) {
    inputs.push({
      sport: "mlb",
      market: "moneyline",
      play_grade: "lean",
      confidence_bucket: "50_52",
      model_version: "v2_2",
      best_angle: false,
      probability: 0.5,
      won: false,
    });
  }
  const report = buildCalibrationReport(inputs);
  check("perfect bin → ECE ≈ 0", report.overall.metrics.ece! < 1e-6);
  check("mean_predicted = 0.5", approx(report.overall.metrics.mean_predicted!, 0.5));
  check("observed_freq = 0.5", approx(report.overall.metrics.observed_freq!, 0.5));
  check(
    "well-calibrated language in notes",
    report.overall.notes.some((n) => /well calibrated/i.test(n)),
  );
}

// ── Overconfident → notes flag direction ──────────────────────────────
console.log("\n━━━ Overconfident → notes call it out ━━━");
{
  const inputs: CalibrationInputRow[] = [];
  // 10 picks at predicted 0.8, only 5 actually win
  for (let i = 0; i < 5; i++) {
    inputs.push({
      sport: "mlb",
      market: "moneyline",
      play_grade: "best_angle",
      confidence_bucket: "59_62",
      model_version: "v2_2",
      best_angle: true,
      probability: 0.8,
      won: true,
    });
  }
  for (let i = 0; i < 5; i++) {
    inputs.push({
      sport: "mlb",
      market: "moneyline",
      play_grade: "best_angle",
      confidence_bucket: "59_62",
      model_version: "v2_2",
      best_angle: true,
      probability: 0.8,
      won: false,
    });
  }
  const report = buildCalibrationReport(inputs);
  check(
    "overconfident language in notes",
    report.overall.notes.some((n) => /overconfident/i.test(n)),
  );
  check(
    "worst-bin note fires when gap > 5pp",
    report.overall.notes.some((n) => /Largest gap/i.test(n)),
  );
}

// ── Underconfident → notes flag direction ─────────────────────────────
console.log("\n━━━ Underconfident → notes call it out ━━━");
{
  const inputs: CalibrationInputRow[] = [];
  for (let i = 0; i < 10; i++) {
    inputs.push({
      sport: "mlb",
      market: "moneyline",
      play_grade: "best_angle",
      confidence_bucket: "50_52",
      model_version: "v2_2",
      best_angle: false,
      probability: 0.3,
      won: i < 8, // 8/10 win, model said 30% → underconfident
    });
  }
  const report = buildCalibrationReport(inputs);
  check(
    "underconfident language in notes",
    report.overall.notes.some((n) => /underconfident/i.test(n)),
  );
}

// ── Operator-script hygiene (string grep) ─────────────────────────────
console.log("\n━━━ Operator-script hygiene ━━━");
{
  const fs = require("node:fs");
  const OP = fs.readFileSync("scripts/operator/calibration-report.ts", "utf8");
  check("operator refuses --apply", OP.includes("--apply not supported"));
  check("operator has require.main===module guard", OP.includes("require.main === module"));
  check(
    "operator does NOT call .insert() on supabase",
    !/supabase[^.]*\.from\([^)]+\)\s*\.insert\(/.test(OP) &&
      !/sb[^.]*\.from\([^)]+\)\s*\.insert\(/.test(OP),
  );
  check(
    "operator does NOT call .update() on supabase",
    !/supabase[^.]*\.from\([^)]+\)\s*\.update\(/.test(OP) &&
      !/sb[^.]*\.from\([^)]+\)\s*\.update\(/.test(OP),
  );
  check(
    "operator does NOT call .upsert() on supabase",
    !/supabase[^.]*\.from\([^)]+\)\s*\.upsert\(/.test(OP) &&
      !/sb[^.]*\.from\([^)]+\)\s*\.upsert\(/.test(OP),
  );
  check(
    "operator does NOT call .delete() on supabase",
    !/supabase[^.]*\.from\([^)]+\)\s*\.delete\(/.test(OP) &&
      !/sb[^.]*\.from\([^)]+\)\s*\.delete\(/.test(OP),
  );
  check(
    "operator does NOT select prediction_records.calibration_version",
    !/select\([^)]*calibration_version/.test(OP),
  );
  check(
    "operator does NOT write prediction_records.calibration_version",
    !/calibration_version\s*[:=]\s*[^\/\n]/.test(OP),
  );
  check("operator excludes no_bet=true", OP.includes('.eq("no_bet", false)'));
  check("operator excludes launch_day=true", OP.includes('.eq("launch_day", false)'));
  check(
    "operator only counts binary outcomes (win or loss)",
    /if\s*\(\s*!g\.win\s*&&\s*!g\.loss\s*\)/.test(OP),
  );
  check(
    "operator skips bad probabilities (<=0 or >=1)",
    /p\s*<=\s*0\s*\|\|\s*p\s*>=\s*1/.test(OP),
  );
}

// ── Wrap-up ───────────────────────────────────────────────────────────
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All calibration math/report tests passed.");
