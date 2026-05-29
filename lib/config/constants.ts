/**
 * App-wide constants for the statistical models.
 *
 * Anything here should be reviewable as a single source of truth. If you
 * tweak a coefficient, document the change with a comment + date.
 *
 * Re-tuning policy: V1 defaults reflect public sabermetric literature and
 * the Oddsphere brand's "conservative humility" stance. Phase 7 (Trial
 * Verification) backtest data will surface coefficients that need
 * recalibration — at that point, update with the empirical values.
 */

import type { PropMarketType } from "../types/domain/Lines";

// ─────────────────────────────────────────────────────────────────────────
// League averages (MLB, 2024-2025 baseline)
// ─────────────────────────────────────────────────────────────────────────
// These are PER-PA / PER-BFP rates used as the shrinkage target by Marcel.
// Values come from MLB league averages for the most recent two seasons.
//
// PA = batter plate appearance · BFP = batter faced by pitcher.

export const LEAGUE_AVERAGES = {
  // Batting (per PA unless noted)
  batter_avg: 0.245,           // BA = H/AB; we use a slight adjustment for PA
  batter_hits_per_pa: 0.224,   // H/PA ≈ AVG × (AB/PA) ≈ 0.245 × 0.916
  batter_hr_per_pa: 0.030,
  batter_tb_per_pa: 0.395,     // SLG-equivalent on PA scale
  batter_rbi_per_pa: 0.115,
  batter_k_per_pa: 0.225,
  batter_bb_per_pa: 0.085,

  // Pitching (per BFP — batters faced)
  pitcher_k_per_bfp: 0.225,    // ~9.0 K/9 league average
  pitcher_er_per_bfp: 0.108,   // ~4.30 ERA across the league
  pitcher_h_per_bfp: 0.245,    // Symmetric with batter_avg
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Marcel reliability constants (PA or BFP at which reliability = 0.5)
// ─────────────────────────────────────────────────────────────────────────
// Standard Tango/Marcel defaults from sabermetric literature. The
// reliability factor is computed as `r = denom / (denom + constant)` where
// denom is the weighted PA (or BFP for pitching markets).
//
// HR rate stabilizes faster (~700 PA) than BA (~1200 PA) because HR is a
// rare event with high per-hit signal-to-noise. Pitcher K rate stabilizes
// fastest (~150 BFP) because it's an identity-level skill.

export const RELIABILITY_CONSTANTS: Record<PropMarketType, number> = {
  batter_hits:           1200,  // PA — classic Marcel default for BA
  batter_total_bases:    1000,  // PA
  batter_home_runs:       700,  // PA
  batter_rbis:           1000,  // PA — heavily opportunity-dependent
  pitcher_strikeouts:     150,  // BFP — stabilizes fastest
  pitcher_earned_runs:    500,  // BFP
  pitcher_hits_allowed:   700,  // BFP
};

// ─────────────────────────────────────────────────────────────────────────
// Edge tier thresholds (percent points)
// ─────────────────────────────────────────────────────────────────────────
// Used by the tier classifier to bucket prop predictions. Below GOOD_MIN
// the prop is not surfaced ("skip" tier).

export const EDGE_TIERS = {
  PREMIUM_MIN: 8.0,  // 8%+ EV → surfaced with "verify lineup" caveat
  STRONG_MIN: 5.0,   // 5-8% EV
  GOOD_MIN: 3.0,     // 3-5% EV
  // SKIP < 3.0 (not surfaced)
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Confidence score factor weights (sum = 100)
// ─────────────────────────────────────────────────────────────────────────
// 6-factor weighted confidence (0-100 scale). Reliability is weighted
// highest because small-sample picks are dangerous. Calibration is second
// because it proves the model's predictions translate to real hit rates.
//
// All weights re-tunable in Phase 7 with backtest data.

export const CONFIDENCE_WEIGHTS = {
  reliability: 30,        // Sample-size based (Marcel denominator)
  calibration: 20,        // Historical hit-rate-vs-confidence-bucket alignment
  lineup: 15,             // Binary: confirmed lineup → 1.0, projected → 0.6
  market_liquidity: 15,   // More books quoting → higher confidence
  workload: 10,           // Pitcher rest / injury status
  weather: 10,            // OpenWeather is reliable; smaller weight
} as const;

// Verify weights sum to 100 at startup
const WEIGHTS_SUM = Object.values(CONFIDENCE_WEIGHTS).reduce((a, b) => a + b, 0);
if (WEIGHTS_SUM !== 100) {
  throw new Error(`CONFIDENCE_WEIGHTS sum to ${WEIGHTS_SUM}, expected 100`);
}

// ─────────────────────────────────────────────────────────────────────────
// Calibration default
// ─────────────────────────────────────────────────────────────────────────
// At launch we have no published-pick history, so the calibration factor
// in the confidence score has no empirical basis. Rather than default to
// 1.0 (which would inflate confidence at launch — counter to brand voice),
// we use 0.75 to bake humility into Day-1 scores. As tracking data
// accumulates and each (sport × market × tier) bucket crosses
// CALIBRATION_MIN_SAMPLES, the empirical value supersedes this default.
//
// Brand framing: "We don't claim perfect calibration until we've earned it."

export const CALIBRATION_DEFAULT = 0.75;
export const CALIBRATION_MIN_SAMPLES = 30;

// ─────────────────────────────────────────────────────────────────────────
// Expected PA by batting order slot (per 9-inning game)
// ─────────────────────────────────────────────────────────────────────────
// Standard sabermetric values, adjusted for the typical MLB game pace.
// Slot 1 sees the most PA (4.65), slot 9 the least (3.65). DH treated as
// a mid-order slot. Pitcher PA = 0 (universal DH since 2022).
//
// Source: Multiple sabermetric tables; values match Baseball-Reference's
// "Plate Appearance per Game" by batting order.

export const PA_BY_BATTING_ORDER: Record<number, number> = {
  1: 4.65,
  2: 4.50,
  3: 4.40,
  4: 4.30,
  5: 4.15,
  6: 4.05,
  7: 3.90,
  8: 3.75,
  9: 3.65,
};

export const PA_FOR_DH = 4.30;       // Treat DH like a slot-4 bat
export const PA_FOR_PITCHER = 0;     // Universal DH since 2022

// Expected BFP per pitcher start (used by pitcher-prop math)
export const BFP_PER_QUALITY_START = 25;     // ~6 IP × 4 BFP/IP
export const BFP_PER_AVERAGE_START = 22;     // ~5.5 IP

// ─────────────────────────────────────────────────────────────────────────
// Weather adjustment coefficients (HR only — V1)
// ─────────────────────────────────────────────────────────────────────────
// V1 DEFAULTS — conservative. Published research ranges:
//   • 10mph wind out ≈ 7-10% HR boost in the literature
//     (Greenhouse 2007; Adair 2002 "Physics of Baseball")
//   • Temperature: ~1% HR per 5F above ~70F baseline
//
// Our coefficients sit on the lower end of these ranges intentionally —
// conservative is safer than aggressive for a V1 model with zero
// real-game backtest data. RE-TUNE IN PHASE 7 using:
//   weighted_residual = (actual_HR_count - predicted_HR_count) regressed
//   against wind_speed_mph, wind_direction_relative, temp_f, humidity_pct.

export const WEATHER = {
  // Wind out (blowing OUT to LF/CF/RF): boost HR rate
  WIND_OUT_COEF: 0.005,           // per mph beyond baseline
  WIND_OUT_MAX_BOOST: 0.15,        // +15% cap
  // Wind in (blowing IN from LF/CF/RF): suppress HR rate
  WIND_IN_COEF: -0.005,            // per mph beyond baseline
  WIND_IN_MAX_SUPPRESS: -0.10,     // -10% cap (asymmetric: wind-in suppresses less than wind-out boosts)
  // Common baseline below which wind has no effect
  WIND_BASELINE_MPH: 5,
  // Temperature deviation from 75F
  TEMP_COEF: 0.002,                // per degree
  TEMP_BASELINE_F: 75,
  TEMP_MAX_EFFECT: 0.05,           // ±5% cap
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Sharp signal thresholds (Daily Edge verdict logic)
// ─────────────────────────────────────────────────────────────────────────
// SOURCE OF TRUTH: planning-docs/SHARP_SIGNAL_FRAMEWORK.md §"Threshold
// constants". The values below must match the framework table verbatim;
// scripts/test-threshold-constants.ts pins each one with a framework-
// reference assertion so silent drift surfaces immediately. If you tune
// a value here, update the framework first and the test will guide you
// through both sides.
//
// STRONG fires when there's asymmetric sharp signal:
//   (ev_pct ≥ 1.5 AND is_plus_ev) AND ≥1 of {steam ≥ 3 books, RLM, sharp money divergence ≥ 10pp}
//   OR a "stack" of ≥3 weak signals all confirming the same side.
//
// CAUTION fires when something looks fishy:
//   public-heavy (≥ 65%) AND no_steam AND no_RLM AND |money − betting| ≤ 8pp
//     → public side without sharp confirmation
//   OR conflicting signals (steam vs RLM in opposite directions)
//   OR ev_pct < -2.0 (market believes the bet is mispriced)
//
// V2.1.1 (Phase 6 framework conformance):
//   • MIN_EV_FOR_PLUS_EV_SIGNAL 2.0 → 1.5 (framework moderate tier starts at 1.5%)
//   • EV_STRONG_THRESHOLD / EV_VERY_STRONG_THRESHOLD added — constants only,
//     wiring lands in Session 2 (Gap-9 tier-aware grade engine).
//   • MIN_PUBLIC_HEAVY_PCT → PUBLIC_SMOKE_TICKET_THRESHOLD (renamed) and
//     value 70 → 65 per framework.
//   • PUBLIC_MONEY_FLATNESS_PP → PUBLIC_SMOKE_FLAT_GAP_MAX (renamed) and
//     value 5 → 8. Comparison operator changed from `<` to `≤` per
//     framework "MAX" semantics (gap of exactly 8pp counts as flat).

export const SHARP_SIGNAL_THRESHOLDS = {
  // Primary STRONG components — Pinnacle EV tiers (framework Signal 1)
  /** Moderate-tier EV floor. Below this is market noise. */
  MIN_EV_FOR_PLUS_EV_SIGNAL: 1.5,
  /** Strong-tier EV (framework Signal 1). Consumed by Fix 2.1's
   *  signalEvidenceClassifier for tier-aware Sharp Conflict bar enforcement. */
  EV_STRONG_THRESHOLD: 3.0,
  /** Very-strong-tier EV (framework Signal 1). Note: EV alone — even at
   *  very-strong tier — does NOT trigger Sharp Conflict per framework
   *  §"Sharp Conflict" carve-out. Used for tier classification only. */
  EV_VERY_STRONG_THRESHOLD: 5.0,
  // Steam tiers (framework Signal 2)
  /** Strong-tier steam — multi-book confirmation. */
  MIN_STEAM_BOOKS: 3,
  /** Very-strong-tier steam (framework Signal 2). Fix 2.1 (Gap-3): single
   *  very-strong opposing steam suffices alone for Sharp Conflict per
   *  framework §"Edge Case Handling — Single signal at 'very strong' tier". */
  STEAM_VERY_STRONG_BOOKS: 5,
  // RLM tiers (framework Signal 3)
  /** Public ticket % floor for RLM detection — weak-tier threshold.
   *  Below this, line drift isn't classified as RLM at all. Fix 2.1 (Gap-4). */
  RLM_PUBLIC_THRESHOLD: 60,
  /** Strong-tier RLM public ticket %. With sharp money confirming, this
   *  crosses into strong-tier RLM per framework. Fix 2.1 (Gap-4). */
  RLM_STRONG_PUBLIC_THRESHOLD: 65,
  // Sharp money divergence tiers (framework Signal 4)
  /** Moderate-tier sharp money divergence floor. */
  MIN_SHARP_MONEY_DIVERGENCE_PP: 10,
  /** Strong-tier sharp money divergence (framework Signal 4). Fix 2.1
   *  (Gap-5): used by Sharp Conflict bar as one of the three strong-tier
   *  opposing primary candidates. */
  SHARP_DIVERGENCE_STRONG: 15,
  /** Very-strong-tier sharp money divergence (framework Signal 4). Single
   *  very-strong opposing divergence suffices alone for Sharp Conflict per
   *  framework §"Edge Case Handling". Fix 2.1 (Gap-5). */
  SHARP_DIVERGENCE_VERY_STRONG: 25,
  // Weak signal stack (3+ stacked weak → STRONG) — legacy evaluator pipeline
  WEAK_SIGNAL_STACK_MIN: 3,
  LIGHT_EV_MIN: 0.5,                         // ≥ 0.5% but < MIN_EV_FOR_PLUS_EV_SIGNAL
  LIGHT_STEAM_BOOKS_MIN: 1,                  // 1-2 books = light steam confirmation
  LIGHT_SHARP_DIVERGENCE_PP: 5,              // 5pp-10pp = light divergence
  PINNACLE_FAIR_PROB_CONFIRM: 0.52,          // Pinnacle thinks side is > 52% likely
  // Public smoke (framework Signal 5)
  /** Public ticket % threshold for public_smoke detection. Framework
   *  rename: was MIN_PUBLIC_HEAVY_PCT (70). */
  PUBLIC_SMOKE_TICKET_THRESHOLD: 65,
  /** Max |money% − ticket%| gap that still counts as "flat". Framework
   *  rename: was PUBLIC_MONEY_FLATNESS_PP (5). Comparison is `≤`. */
  PUBLIC_SMOKE_FLAT_GAP_MAX: 8,
  NEGATIVE_EV_CAUTION_THRESHOLD: -2.0,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Grade engine thresholds (V2.1 6.2 — gradeDerivationService synthesis)
// ─────────────────────────────────────────────────────────────────────────
// gradeDerivationService blends Layer 1 (model edge) + Layer 3 (market
// signal) into the final 7-category grade. These knobs control the
// strict-vs-loose tradeoff for "Best Signal" and the "no model edge"
// fallback boundary.
//
// V2.1 6.2 explicitly: 5%+ edge for games, 10%+ for props, market alignment
// required, no artificial cap. SLATE_MONITOR_PCT triggers a console.warn
// when >25% of a slate qualifies as best_signal — signal that the bar may
// have drifted too loose for the current data.

export const GRADE_THRESHOLDS = {
  /** Pinnacle EV % on the primary pick required for game best_signal.
   *  Framework §"Best Signal": "Model edge ≥ +3%". Fix 3.1 (Flag A→A2):
   *  matched literally to framework — conservatism lives in the tier-
   *  counting bar (AT LEAST TWO strong aligned), not in the edge floor. */
  BEST_SIGNAL_GAME_EDGE: 3,
  /** prop_predictions.edge_pct required for prop best_signal. */
  BEST_SIGNAL_PROP_EDGE: 10,
  /** Below this, a game pick is treated as "no model edge". */
  MIN_GAME_EDGE: 1,
  /** Below this, a prop is treated as "no model edge" (matches tier=skip line). */
  MIN_PROP_EDGE: 3,
  /** Warn when best_signal share of slate exceeds this percentage. */
  BEST_SIGNAL_SLATE_MONITOR_PCT: 25,
  // ───────────────────────────────────────────────────────────────────────
  // Phase 2 — Daniel-approved EV-axis-only paths for best_signal and
  // market_led (Adjustments A and B).
  //
  // V1 NOTE — confidence-edge proxy, not final model edge:
  //   The Phase 3 rule-seeded auto-model does not yet exist, so a true
  //   model_edge metric is not available. For Phase 2, "model edge" is a
  //   TEMPORARY proxy derived from prediction confidence:
  //       confidenceEdgeProxy = modelConfidence - 50
  //   The proxy reuses the existing `game_predictions.*_confidence`
  //   columns as a stand-in. When Phase 3 lands, the rule-seeded model
  //   will provide a real per-pick edge metric and the *_CONFIDENCE_EDGE_*
  //   constants below SHOULD BE REVISITED to align with the real edge.
  // ───────────────────────────────────────────────────────────────────────
  /** Adjustment A guardrail 1: Pinnacle EV % floor for the EV-axis-alone
   *  path to best_signal. Matches SHARP_SIGNAL_THRESHOLDS.EV_VERY_STRONG_
   *  THRESHOLD (5.0%) by design — Adjustment A requires very-strong-tier
   *  EV. Hardcoded separately so operators can tune Phase 2 independently
   *  of the framework tier definitions. */
  BEST_SIGNAL_EV_ALONE_EV_FLOOR_PCT: 5,
  /** Adjustment A guardrail 2: confidence-edge proxy floor for best_signal
   *  EV-alone. "Model edge ≥ 3 points above neutral" maps to
   *  modelConfidence - 50 ≥ 3 → modelConfidence ≥ 53. */
  BEST_SIGNAL_EV_ALONE_CONFIDENCE_EDGE_PROXY_POINTS: 3,
  /** Adjustment A guardrail 6: confidence floor for best_signal EV-alone.
   *  When confidence is below this, the model isn't conviction-loud
   *  enough to back the very-strong EV signal alone. */
  BEST_SIGNAL_EV_ALONE_CONFIDENCE_FLOOR_PCT: 60,
  /** Adjustment B guardrail 1: Pinnacle EV % floor for the EV-axis-alone
   *  path to market_led. Matches SHARP_SIGNAL_THRESHOLDS.EV_STRONG_
   *  THRESHOLD (3.0%) — Adjustment B requires strong-tier or better EV. */
  MARKET_LED_EV_ALONE_EV_FLOOR_PCT: 3,
  /** Adjustment B guardrail 2 (boundary): confidence-edge proxy ceiling
   *  for "weak/neutral" model behavior. When confidence - 50 is BELOW this,
   *  the model has not asserted a meaningful conviction — market is
   *  leading. When confidence - 50 is at or above this, the model HAS
   *  conviction and the case routes to sharp_confirmed instead.
   *
   *  Boundary semantics: the EV-alone market_led path fires when
   *  (modelConfidence - 50) < this value. At exactly the value, fails. */
  MARKET_LED_EV_ALONE_CONFIDENCE_EDGE_PROXY_POINTS: 3,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// CLV silence window
// ─────────────────────────────────────────────────────────────────────────
// Closing Line Value is computed for all picks but hidden from members for
// the first 30 days post-pick. Rationale: CLV is volatile in small samples,
// and presenting it too early would invite "you're not really beating the
// close" criticism before we have statistical power to refute it.

export const CLV_SILENCE_DAYS = 30;
