/**
 * Context adjustments applied multiplicatively to a Marcel + log5 base rate.
 *
 * Three independent factors:
 *   • Park   — 3-yr rolling park factor (100 = neutral; 110 = +10% boost)
 *   • Weather — V1 applies to HR markets only (wind + temperature)
 *   • Platoon — Batter-vs-pitcher handedness; uses empirical split if
 *               available, falls back to ±5% generic multiplier
 *
 * These are applied in order: park → weather → platoon. The order doesn't
 * actually matter mathematically (multiplication is commutative) but the
 * convention helps when reasoning about prediction_breakdowns rows.
 */

import type { PropMarketType } from "../../types/domain/Lines";
import type { BatsHand, ThrowsHand } from "../../types/domain/Player";
import { WEATHER } from "../../config/constants";
import { clamp } from "../../utils/stats";

// ─────────────────────────────────────────────────────────────────────────
// Park factor
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apply a 3-yr rolling park factor multiplicatively.
 *
 * Park factor convention: 100 = league neutral. Coors Field at
 * park_factor_runs = 115 means runs are scored at +15% above neutral;
 * Oracle Park at 92 means -8% suppression.
 *
 * @param rate         Pre-adjustment rate (e.g., hits per PA).
 * @param parkFactor   Integer park factor on the 100-scale (e.g., 103).
 */
export function applyParkFactor(rate: number, parkFactor: number): number {
  if (parkFactor <= 0) {
    throw new Error(`applyParkFactor: parkFactor must be > 0, got ${parkFactor}`);
  }
  return rate * (parkFactor / 100);
}

// ─────────────────────────────────────────────────────────────────────────
// Weather (HR markets only)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compass-relative wind direction from the catcher's POV at home plate.
 * `out_*` directions push fly balls toward the fence; `in_*` directions
 * push them back. Mock fixtures use this string convention.
 */
export type WindRelative =
  | "out_to_lf"
  | "out_to_cf"
  | "out_to_rf"
  | "in_from_lf"
  | "in_from_cf"
  | "in_from_rf"
  | "crossing_lf_to_rf"
  | "crossing_rf_to_lf"
  | null;

export type WeatherInput = {
  wind_speed_mph: number;
  wind_direction_relative: WindRelative;
  temperature_f: number;
};

/**
 * Apply weather adjustment. V1 only adjusts HR markets — hits/K/etc. are
 * not significantly weather-affected per the research literature.
 *
 * Coefficients live in constants.ts WEATHER block. Recap:
 *   • Wind ≥ 5 mph blowing OUT: +0.5% per excess mph, cap +15%
 *   • Wind ≥ 5 mph blowing IN: −0.5% per excess mph, cap −10%
 *   • Temperature: ±0.2% per °F deviation from 75°F, cap ±5%
 *   • Crossing wind: no effect in V1 (averages out)
 */
export function applyWeatherAdjustment(
  rate: number,
  propMarket: PropMarketType,
  weather: WeatherInput
): number {
  if (propMarket !== "batter_home_runs") return rate;

  let multiplier = 1.0;

  const dir = weather.wind_direction_relative;
  const mph = weather.wind_speed_mph;
  if (dir && mph > WEATHER.WIND_BASELINE_MPH) {
    const excess = mph - WEATHER.WIND_BASELINE_MPH;
    if (dir.startsWith("out_")) {
      const boost = excess * WEATHER.WIND_OUT_COEF;
      multiplier *= 1 + Math.min(boost, WEATHER.WIND_OUT_MAX_BOOST);
    } else if (dir.startsWith("in_")) {
      const suppress = excess * WEATHER.WIND_IN_COEF; // negative
      multiplier *= 1 + Math.max(suppress, WEATHER.WIND_IN_MAX_SUPPRESS);
    }
    // crossing_* — no effect in V1
  }

  const tempDeviation = weather.temperature_f - WEATHER.TEMP_BASELINE_F;
  const tempEffect = clamp(
    tempDeviation * WEATHER.TEMP_COEF,
    -WEATHER.TEMP_MAX_EFFECT,
    WEATHER.TEMP_MAX_EFFECT
  );
  multiplier *= 1 + tempEffect;

  return rate * multiplier;
}

// ─────────────────────────────────────────────────────────────────────────
// Platoon
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apply platoon adjustment based on batter-vs-pitcher handedness.
 *
 * Strategy:
 *   1. Switch hitters bat opposite-handed → no platoon adjustment needed.
 *   2. If empirical split data is available (and the player has enough
 *      sample), compute multiplier = splitRate / overallRate. This lets
 *      the player's actual platoon split drive the adjustment.
 *   3. Otherwise apply a generic ±5% multiplier:
 *        • Opposite hand (e.g., L vs R): +5%
 *        • Same hand (e.g., L vs L):    −5%
 *
 * Caps the empirical multiplier to [0.80, 1.25] to avoid wild swings
 * from small-sample splits.
 *
 * @param rate          Post-park/weather rate.
 * @param batterHand    Batter's bats hand ('L', 'R', 'S').
 * @param pitcherHand   Pitcher's throws hand ('L', 'R').
 * @param splitRate     Optional: batter's empirical rate vs the pitcher's hand.
 * @param overallRate   Optional: batter's overall rate (denominator for ratio).
 */
export function applyPlatoonAdjustment(
  rate: number,
  batterHand: BatsHand | null,
  pitcherHand: ThrowsHand | null,
  splitRate?: number,
  overallRate?: number
): number {
  if (!batterHand || !pitcherHand) return rate;
  if (batterHand === "S") return rate; // switch hitters neutralize

  if (
    splitRate !== undefined &&
    overallRate !== undefined &&
    overallRate > 0 &&
    splitRate > 0
  ) {
    const platoonMultiplier = clamp(splitRate / overallRate, 0.80, 1.25);
    return rate * platoonMultiplier;
  }

  const sameHanded = batterHand === pitcherHand;
  return rate * (sameHanded ? 0.95 : 1.05);
}
