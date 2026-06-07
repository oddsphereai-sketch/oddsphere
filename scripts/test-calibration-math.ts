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
import { extractContextFlags, CONTEXT_FLAG_DEFINITIONS, MISSING_DIMENSIONS } from "../lib/calibration/contextFlags";
import {
  buildShadowMarketReport,
  MATERIAL_BRIER_DELTA,
  MATERIAL_GAP,
} from "../lib/calibration/shadowCalibration";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";

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
      context_flags: {},
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
      context_flags: {},
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
      context_flags: {},
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
      context_flags: {},
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
      context_flags: {},
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
      context_flags: {},
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
      context_flags: {},
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
      context_flags: {},
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

// ── Stage 2: contextFlags extractor ───────────────────────────────────
console.log("\n━━━ Stage 2 — contextFlags ━━━");

function fakeRecord(snapshot: Record<string, unknown>, overrides: Partial<PredictionRecordRow> = {}): PredictionRecordRow {
  return {
    game_prediction_id: 0,
    game_id: 0,
    external_id: 0,
    sport: "mlb",
    slate_date: "2026-06-07",
    game_date: null,
    matchup: "X@Y",
    market: "moneyline",
    pick: "home",
    side: null,
    line_value: null,
    odds_american: null,
    odds_decimal: null,
    model_used: null,
    model_version: null,
    prediction_source: null,
    confidence: 55,
    model_probability: 0.55,
    market_probability: null,
    edge: null,
    expected_value: null,
    play_grade: null,
    prediction_type: null,
    best_angle: false,
    no_bet: false,
    no_bet_reason: null,
    market_aligned: false,
    data_quality_tier: null,
    source_quality: null,
    provisional: false,
    held: false,
    hold_reason: null,
    launch_day: false,
    manual_outcome_expected: false,
    locked_at: null,
    published_at: null,
    snapshot_json: snapshot,
    ...overrides,
  } as PredictionRecordRow;
}

{
  // Empty snapshot → every snapshot-derived flag is "unknown".
  // provisional_pick is the one exception because PredictionRecordRow.provisional
  // is a non-null boolean column (not snapshot-derived), so the extractor
  // always resolves it from the top-level value.
  const flags = extractContextFlags(fakeRecord({}));
  const snapshotOnlyFlags = CONTEXT_FLAG_DEFINITIONS.filter((d) => d.id !== "provisional_pick");
  const allUnknown = snapshotOnlyFlags.every((d) => flags[d.id] === "unknown");
  check("empty snapshot → every snapshot-derived flag = unknown", allUnknown);
  check("provisional_pick resolved from top-level column (always known)", flags["provisional_pick"] !== "unknown");
}
{
  // starter_confirmed=true → starter_unconfirmed=no
  const flags = extractContextFlags(fakeRecord({ starter_confirmed: true }));
  check("starter_confirmed=true → starter_unconfirmed=no", flags["starter_unconfirmed"] === "no");
}
{
  const flags = extractContextFlags(fakeRecord({ starter_confirmed: false }));
  check("starter_confirmed=false → starter_unconfirmed=yes", flags["starter_unconfirmed"] === "yes");
}
{
  // Provisional: top-level provisional column wins over snapshot v2_provisional.
  const flags = extractContextFlags(fakeRecord({ v2_provisional: true }, { provisional: false }));
  check("top-level provisional=false beats snapshot v2_provisional=true", flags["provisional_pick"] === "no");
}
{
  const flags = extractContextFlags(fakeRecord({ v2_provisional: true }, { provisional: null as unknown as boolean }));
  check("top-level provisional=null → fall back to v2_provisional=true → yes", flags["provisional_pick"] === "yes");
}
{
  // data_quality_low / high mutual exclusion via separate paths
  const flagsLow = extractContextFlags(fakeRecord({ v2_data_quality_tier: "low" }));
  check("v2_data_quality_tier=low → data_quality_low=yes", flagsLow["data_quality_low"] === "yes");
  check("v2_data_quality_tier=low → data_quality_high=no", flagsLow["data_quality_high"] === "no");
}
{
  // ML dampening present
  const flags = extractContextFlags(fakeRecord({ auto_factors: { ml_dampening_penalty: 5 } }));
  check("auto_factors.ml_dampening_penalty > 0 → ml_dampening_applied=yes", flags["ml_dampening_applied"] === "yes");
}
{
  const flags = extractContextFlags(fakeRecord({ auto_factors: { ml_dampening_penalty: 0 } }));
  check("auto_factors.ml_dampening_penalty = 0 → ml_dampening_applied=no", flags["ml_dampening_applied"] === "no");
}
{
  // FI-specific flag
  const flags = extractContextFlags(fakeRecord({ auto_factors: { nrfi_used_fallback_era: true } }));
  check("auto_factors.nrfi_used_fallback_era=true → yes", flags["nrfi_used_fallback_era"] === "yes");
}
{
  // trust_independent — fi_v2_audit takes precedence only if v2_2_audit absent
  const flags = extractContextFlags(fakeRecord({ v2_2_audit: { trust_independent: true } }));
  check("v2_2_audit.trust_independent=true → yes", flags["trust_independent"] === "yes");
}
{
  const flags = extractContextFlags(fakeRecord({ fi_v2_audit: { trust_independent: false } }));
  check("fi_v2_audit.trust_independent=false (no v2_2_audit) → no", flags["trust_independent"] === "no");
}
check(
  "MISSING_DIMENSIONS includes public_money_pct",
  MISSING_DIMENSIONS.some((m) => m.id === "public_money_pct"),
);
check(
  "MISSING_DIMENSIONS includes line_movement_direction",
  MISSING_DIMENSIONS.some((m) => m.id === "line_movement_direction"),
);
check(
  "MISSING_DIMENSIONS includes bullpen_fallback",
  MISSING_DIMENSIONS.some((m) => m.id === "bullpen_fallback"),
);

// ── Stage 2: shadow calibration ───────────────────────────────────────
console.log("\n━━━ Stage 2 — shadowCalibration ━━━");
{
  // Empty samples
  const sm = buildShadowMarketReport([], "moneyline");
  check("empty market → n=0", sm.n === 0);
  check("empty market → no material proposal", sm.has_material_proposal === false);
  check("empty market → all metrics null", sm.live_brier === null && sm.shadow_brier === null);
  check("empty market → recommendation mentions no samples", /no samples/i.test(sm.overall_recommendation));
}
{
  // Tiny sample (insufficient) — should NOT propose anything
  const samples = [
    { probability: 0.55, won: true },
    { probability: 0.55, won: false },
    { probability: 0.55, won: true },
  ];
  const sm = buildShadowMarketReport(samples, "moneyline");
  check("tiny ML sample → sample_class=insufficient", sm.sample_class === "insufficient");
  check("tiny sample → no material proposal", sm.has_material_proposal === false);
  check("tiny sample → all buckets recommend monitor-only", sm.buckets.every((b) => b.proposed_probability === null));
  check("tiny sample → overall recommendation mentions monitor", /monitor only/i.test(sm.overall_recommendation));
}
{
  // Confident-sized sample with calibrated probabilities → no material gap → no proposal
  const samples: { probability: number; won: boolean }[] = [];
  // bin 5 (0.5-0.6): 500 samples at p=0.55, half win → mean=0.55, observed=0.5, gap=0.05 = MATERIAL_GAP
  for (let i = 0; i < 250; i++) samples.push({ probability: 0.55, won: true });
  for (let i = 0; i < 250; i++) samples.push({ probability: 0.55, won: false });
  const sm = buildShadowMarketReport(samples, "moneyline");
  check("confident ML sample → sample_class=confident", sm.sample_class === "confident");
  // gap = 0.05 which is exactly MATERIAL_GAP (>= threshold), so proposal should fire
  check("confident sample with gap >= material → has material proposal", sm.has_material_proposal === true);
  const b5 = sm.buckets[5];
  check("bucket 5 has proposed probability ≈ 0.5", b5.proposed_probability !== null && Math.abs(b5.proposed_probability - 0.5) < 1e-6);
}
{
  // Confident sample, gap < MATERIAL_GAP (0.02) → no proposal
  // 500 at p=0.55, exactly 275 wins → observed 0.55, gap = 0.0
  const samples: { probability: number; won: boolean }[] = [];
  for (let i = 0; i < 275; i++) samples.push({ probability: 0.55, won: true });
  for (let i = 0; i < 225; i++) samples.push({ probability: 0.55, won: false });
  const sm = buildShadowMarketReport(samples, "moneyline");
  check("confident sample, gap < material → no proposal", sm.has_material_proposal === false);
  check("confident sample, gap < material → recommendation mentions no change", /material threshold|No calibration change|no bucket shows a material gap/i.test(sm.overall_recommendation));
}
{
  // Confident sample, well-separated buckets, shadow improves Brier
  const samples: { probability: number; won: boolean }[] = [];
  // bin 5 (0.5-0.6) all p=0.55, 70% win → observed 0.7, gap = 0.15
  for (let i = 0; i < 350; i++) samples.push({ probability: 0.55, won: true });
  for (let i = 0; i < 150; i++) samples.push({ probability: 0.55, won: false });
  const sm = buildShadowMarketReport(samples, "moneyline");
  check("shadow_brier <= live_brier when remap fits observed", sm.shadow_brier !== null && sm.live_brier !== null && sm.shadow_brier <= sm.live_brier);
  check("brier_delta >= 0 (positive = shadow improves)", sm.brier_delta !== null && sm.brier_delta >= 0);
  check("recommendation calls out Stage 3 eligibility when delta material", sm.brier_delta! >= MATERIAL_BRIER_DELTA && /Stage 3/i.test(sm.overall_recommendation));
}
{
  // Sanity: MATERIAL_GAP and MATERIAL_BRIER_DELTA are exported
  check("MATERIAL_GAP exported", typeof MATERIAL_GAP === "number" && MATERIAL_GAP === 0.02);
  check("MATERIAL_BRIER_DELTA exported", typeof MATERIAL_BRIER_DELTA === "number" && MATERIAL_BRIER_DELTA === 0.001);
}

// ── Stage 2: report integration ───────────────────────────────────────
console.log("\n━━━ Stage 2 — buildCalibrationReport integration ━━━");
{
  const rows: CalibrationInputRow[] = [
    {
      sport: "mlb",
      market: "moneyline",
      play_grade: null,
      confidence_bucket: "53_55",
      model_version: "v2_2",
      best_angle: true,
      context_flags: { starter_unconfirmed: "yes", data_quality_low: "no" },
      probability: 0.55,
      won: true,
    },
    {
      sport: "mlb",
      market: "moneyline",
      play_grade: null,
      confidence_bucket: "53_55",
      model_version: "v2_2",
      best_angle: true,
      context_flags: { starter_unconfirmed: "no", data_quality_low: "yes" },
      probability: 0.55,
      won: false,
    },
  ];
  const report = buildCalibrationReport(rows);
  check("byContextFlag populated for in-scope flags", report.byContextFlag.length > 0);
  const starter = report.byContextFlag.find((f) => f.id === "starter_unconfirmed");
  check("byContextFlag has starter_unconfirmed entry", starter !== undefined);
  check("starter_unconfirmed n_yes=1 n_no=1", starter !== undefined && starter.n_yes === 1 && starter.n_no === 1);
  check("byContextFlag handles unknown count too", starter !== undefined && starter.data_availability_pct === 100);
  check("shadowByMarket has moneyline entry", report.shadowByMarket.some((sm) => sm.market === "moneyline"));
  check("missingDimensions is non-empty", report.missingDimensions.length >= 3);
  check(
    "missingDimensions explains why (mentions snapshot)",
    report.missingDimensions.every((m) => /snapshot|captured|carries/i.test(m.reason)),
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
