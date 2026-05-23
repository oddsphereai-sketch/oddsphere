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
// Composite STRONG/CAUTION/neutral classification for sharp_signals rows.
//
// STRONG fires when there's asymmetric sharp signal:
//   (ev_pct ≥ 2.0 AND is_plus_ev) AND ≥1 of {steam ≥ 3 books, RLM, sharp money divergence ≥ 10pp}
//   OR a "stack" of ≥3 weak signals all confirming the same side.
//
// CAUTION fires when something looks fishy:
//   public-heavy (≥ 70%) AND no_steam AND no_RLM AND |money − betting| < 5pp
//     → public side without sharp confirmation
//   OR conflicting signals (steam vs RLM in opposite directions)
//   OR ev_pct < -2.0 (market believes the bet is mispriced)
//
// Re-tune in Phase 7 with backtested signal-to-outcome data.

export const SHARP_SIGNAL_THRESHOLDS = {
  // Primary STRONG components
  MIN_EV_FOR_PLUS_EV_SIGNAL: 2.0,           // below 2% is Pinnacle juice noise
  MIN_STEAM_BOOKS: 3,                        // need multi-book confirmation
  MIN_SHARP_MONEY_DIVERGENCE_PP: 10,        // money_pct − betting_pct ≥ 10
  // Weak signal stack (3+ stacked weak → STRONG)
  WEAK_SIGNAL_STACK_MIN: 3,
  LIGHT_EV_MIN: 0.5,                         // ≥ 0.5% but < MIN_EV_FOR_PLUS_EV_SIGNAL
  LIGHT_STEAM_BOOKS_MIN: 1,                  // 1-2 books = light steam confirmation
  LIGHT_SHARP_DIVERGENCE_PP: 5,              // 5pp-10pp = light divergence
  PINNACLE_FAIR_PROB_CONFIRM: 0.52,          // Pinnacle thinks side is > 52% likely
  // CAUTION conditions
  MIN_PUBLIC_HEAVY_PCT: 70,
  PUBLIC_MONEY_FLATNESS_PP: 5,               // |money − betting| < 5pp = no sharp $ flow
  NEGATIVE_EV_CAUTION_THRESHOLD: -2.0,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// CLV silence window
// ─────────────────────────────────────────────────────────────────────────
// Closing Line Value is computed for all picks but hidden from members for
// the first 30 days post-pick. Rationale: CLV is volatile in small samples,
// and presenting it too early would invite "you're not really beating the
// close" criticism before we have statistical power to refute it.

export const CLV_SILENCE_DAYS = 30;
