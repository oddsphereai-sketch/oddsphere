/**
 * Phase 3A — Rule-seeded MLB auto-model V1.
 *
 * Pure function `runMlbAutoModelV1(snapshot, stage) → AutoModelOutput`.
 * No DB, no network, no provider calls, no service-layer orchestration.
 * The model consumes a fully-built GameSnapshot and produces the
 * Phase-2-compatible output shape.
 *
 * Six rule layers (see SHARP_SIGNAL_FRAMEWORK.md alignment):
 *   1. Pitcher suppression (season ERA + last-30 + pitch-type quality)
 *   2. Lineup OPS factor vs opposing handedness
 *   3. Bullpen ERA factor (weighted RP avg or league fallback)
 *   4. Park factor (park_factor_runs only in V1; handedness Phase 3.x)
 *   5. Weather adjustment (additive run delta; 0 in V1 since weather
 *      provider is mock)
 *   6. Injury sanity (starter scratch holds; top-3 hitter injury
 *      reduces offense)
 *
 * NRFI logic is blended per Daniel's correction:
 *   - First-inning ERA from BDL plays (Phase 3.x; null in V1)
 *   - Season-ERA × 0.7 proxy (V1 fallback)
 *   - Top-of-order (positions 1-3) OPS strength on opposing side
 *   - Lineup confirmation
 *   - Hold/no-play when inputs are thin (both fallback + no top order)
 *
 * Pick logic:
 *   - ML: winner = higher projected score; confidence from run_diff +
 *     era gap, stage-capped, floor 51
 *   - O/U: requires market line (snapshot.market.listed_total); side
 *     from comparison to that line (NEVER predicted_total as line);
 *     stage-capped, floor 51
 *   - NRFI: per blended NRFI logic above; cap 65, floor 51
 *
 * All output passes through `applyDeterministicGuards` (5 production-
 * blocking checks). The guards CANNOT be bypassed.
 *
 * V1 NOTE — confidence-edge proxy semantics:
 *   The Phase 2 framework consumes `ml_confidence` / `ou_confidence` /
 *   `nrfi_confidence` and computes `(confidence - 50)` as a temporary
 *   proxy for "model edge". This file does not rename the confidence
 *   fields, but the operator should know: in V1, these doubles as the
 *   model-edge inputs to gradeDerivationService's Phase 2 helpers.
 */

import type {
  AutoFactors,
  AutoModelOutput,
  AutoModelSportSpecific,
  BatterSnapshot,
  GameSnapshot,
  ModelStage,
  ParkSnapshot,
  StarterSnapshot,
  TeamSnapshot,
  WeatherSnapshot,
} from "./types";
import {
  EXPECTED_BULLPEN_INNINGS,
  EXPECTED_STARTER_INNINGS,
  HARD_CONFIDENCE_FLOOR,
  LEAGUE_CONSTANTS_V1,
  MODEL_VERSION,
  NRFI_CONFIDENCE_CAP,
  NRFI_CONFIDENCE_LEAN_MAX,
  NRFI_CONFIDENCE_LEAN_MIN,
  NRFI_CONFIDENCE_STRONG_MAX,
  NRFI_CONFIDENCE_STRONG_MIN,
  NRFI_CONFIDENCE_TOSS_UP,
  NRFI_FALLBACK_CONFIDENCE_CAP,
  NRFI_THRESHOLD_LEAN,
  NRFI_THRESHOLD_STRONG,
  NRFI_UNCONFIRMED_CONFIDENCE_PENALTY,
  YRFI_THRESHOLD_LEAN,
  YRFI_THRESHOLD_STRONG,
  type NrfiDecisionKind,
  type NrfiThresholdZone,
  PREDICTED_SCORE_MAX,
  PREDICTED_SCORE_MIN,
  STAGE_CONFIDENCE_CAPS,
  TOP3_HITTER_INJURY_REDUCTION_CAP,
  TOP3_HITTER_INJURY_REDUCTION_PER,
} from "./types";
import { applyDeterministicGuards } from "./aiSanityBoundary";

// ─────────────────────────────────────────────────────────────
// Math utilities
// ─────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─────────────────────────────────────────────────────────────
// Layer 1 — Pitcher suppression
// ─────────────────────────────────────────────────────────────

type PitcherFactorResult = {
  /** ERA factor relative to LEAGUE_AVG_ERA. 1.0 = league average. */
  factor: number;
  /** Blended ERA used to compute the factor. Null when starter is
   *  missing or has no season ERA. */
  effective_era: number | null;
  /** True when the model fell back to a 1.0 factor due to missing data. */
  used_fallback: boolean;
};

function pitcherEraFactor(starter: StarterSnapshot | null): PitcherFactorResult {
  if (starter === null || starter.season_era === null) {
    return { factor: 1.0, effective_era: null, used_fallback: true };
  }
  // Weighted blend of season ERA and last-30-day ERA. Last-30 is the
  // recency signal; season is the structural one.
  const blended_era =
    starter.last30_era !== null
      ? 0.7 * starter.season_era + 0.3 * starter.last30_era
      : starter.season_era;
  // Pitch-quality adjustment is multiplicative and tightly bounded so
  // a bad estimate can't dominate the factor.
  const pitch_adj =
    starter.pitch_quality_score !== null
      ? clamp(starter.pitch_quality_score, 0.92, 1.08)
      : 1.0;
  const factor = (blended_era / LEAGUE_CONSTANTS_V1.AVG_ERA) * pitch_adj;
  return { factor, effective_era: blended_era, used_fallback: false };
}

// ─────────────────────────────────────────────────────────────
// Layer 2 — Lineup OPS factor vs opposing handedness
// ─────────────────────────────────────────────────────────────

type LineupFactorResult = {
  /** OPS factor relative to LEAGUE_AVG_OPS. 1.0 = league average. */
  factor: number;
  /** Weighted average OPS used to compute the factor. Null when lineup
   *  is too sparse to score. */
  weighted_ops: number | null;
};

function positionWeight(pos: number | null): number {
  if (pos === null) return 0.7;
  if (pos <= 3) return 1.0; // top of the order
  if (pos <= 6) return 0.9; // middle
  return 0.7; // bottom
}

function lineupOpsFactor(
  lineup: BatterSnapshot[],
  opposingThrows: "L" | "R" | null
): LineupFactorResult {
  if (lineup.length === 0) {
    return { factor: 1.0, weighted_ops: null };
  }
  const top8 = lineup.slice(0, 8);

  let totalWeightedOps = 0;
  let totalWeight = 0;

  for (const b of top8) {
    let ops: number | null = null;
    if (opposingThrows === "L" && b.vs_lhp_ops !== null) ops = b.vs_lhp_ops;
    else if (opposingThrows === "R" && b.vs_rhp_ops !== null) ops = b.vs_rhp_ops;
    else if (b.season_ops !== null) ops = b.season_ops;

    if (ops !== null) {
      const weight = positionWeight(b.batting_position);
      totalWeightedOps += ops * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) {
    return { factor: 1.0, weighted_ops: null };
  }

  const weighted_ops = totalWeightedOps / totalWeight;
  const factor = weighted_ops / LEAGUE_CONSTANTS_V1.AVG_OPS;
  return { factor, weighted_ops };
}

// ─────────────────────────────────────────────────────────────
// Layer 3 — Bullpen ERA factor
// ─────────────────────────────────────────────────────────────

function bullpenFactor(team: TeamSnapshot): { factor: number } {
  if (team.bullpen_era_proxy === null) {
    // No RP data — fall back to league average. Bullpen quality is a
    // soft modifier; not enough confidence to penalize/credit without
    // data.
    return { factor: 1.0 };
  }
  return { factor: team.bullpen_era_proxy / LEAGUE_CONSTANTS_V1.AVG_ERA };
}

// ─────────────────────────────────────────────────────────────
// Layer 4 — Park factor
// ─────────────────────────────────────────────────────────────

/**
 * Park factor convention: `park_factor_runs` is an INDEX where 100 = league
 * neutral (standard MLB statistical convention — Coors ≈ 112, Petco ≈ 94).
 * The DB column `ballparks.park_factor_runs` (DECIMAL(5,2), schema.sql:115)
 * stores values in this convention; featureSnapshot passes them through
 * unchanged. The score formula needs a MULTIPLIER (1.0 = neutral), so we
 * divide by 100 here.
 *
 * Phase 4D.0 fix: pre-fix code returned the index value as-is, which
 * multiplied raw runs by ~100 and saturated every prediction at
 * PREDICTED_SCORE_MAX (15.0). The 2026-05-30 launch-readiness
 * investigation pinpointed this; regression test in
 * `test-mlb-automodel-v1.ts` pins the convention.
 */
function parkMultiplier(park: ParkSnapshot | null): number {
  if (park === null || park.park_factor_runs === null) return 1.0;
  return park.park_factor_runs / 100;
}

// ─────────────────────────────────────────────────────────────
// Layer 5 — Weather adjustment (additive run delta)
// ─────────────────────────────────────────────────────────────

function weatherDelta(
  weather: WeatherSnapshot | null,
  park: ParkSnapshot | null
): number {
  if (park?.is_dome) return 0.0;
  if (weather === null) return 0.0;

  let delta = 0.0;

  if (
    weather.wind_speed_mph !== null &&
    weather.wind_speed_mph >= 10 &&
    weather.wind_direction_degrees !== null
  ) {
    const dir = weather.wind_direction_degrees;
    // Convention: 0-180° wind blows OUT (toward outfield); 180-360°
    // blows IN. This is a V1 simplification; real ballpark orientation
    // varies and is a Phase 3.x refinement.
    if (dir >= 0 && dir <= 180) delta += 0.3;
    else delta -= 0.2;
  }

  if (weather.temperature_f !== null) {
    if (weather.temperature_f > 90) delta += 0.1;
    else if (weather.temperature_f < 50) delta -= 0.2;
  }

  if (weather.humidity_pct !== null && weather.humidity_pct > 70) {
    delta += 0.05;
  }

  return delta;
}

// ─────────────────────────────────────────────────────────────
// Layer 6 — Injury offense reduction
// ─────────────────────────────────────────────────────────────

function injuryOffenseReduction(injuredCount: number): number {
  if (injuredCount <= 0) return 0;
  return Math.min(
    injuredCount * TOP3_HITTER_INJURY_REDUCTION_PER,
    TOP3_HITTER_INJURY_REDUCTION_CAP
  );
}

// ─────────────────────────────────────────────────────────────
// NRFI / YRFI / Toss-Up — Phase 4D.1 5-zone framework
// ─────────────────────────────────────────────────────────────

type NrfiResult = {
  /** Decision kind — explicit Toss-Up vs Held distinction. */
  decision_kind: NrfiDecisionKind;
  /** Zone the expected_first_inning_runs landed in. */
  threshold_zone: NrfiThresholdZone;
  /** Boolean view for the legacy DB column. true=NRFI, false=YRFI,
   *  null=Toss-Up OR held. */
  decision: boolean | null;
  /** Display confidence. Toss-Up: 52. Lean: 53-56. Strong: 57-62.
   *  Null only when decision_kind="held". */
  confidence: number | null;
  /** Expected first-inning runs (both teams summed). */
  expected_runs: number | null;
  /** Whether the starter ERA fallback (`season_era × 0.7`) was used. */
  used_fallback_era: boolean;
  /** Whether either side's top-of-order OPS data was used. */
  used_top_of_order_data: boolean;
  /** Hold reason — ONLY set when decision_kind="held". Null on Toss-Up. */
  hold_reason: string | null;
  /** Audit tags. Minimal in 4D.1; expands in 4D.3. */
  reason_codes: string[];
};

// ─── Phase 4D.2 — top-order helpers (handedness-aware) ──────────────
//
// Replaces the Phase 3A `topOfOrderOps()` helper, which used only
// `season_ops` and required ≥2 batters at positions 1-3. Daniel's
// Phase 4D.2 approval (decision #3): prefer handedness-split OPS when
// the starter's `throws` is known; fall back to `season_ops`; allow
// single-batter fallback for V1 (was ≥2 in 4D.1).
//
// The richer return shape carries:
//   • value           — weighted top-3 OPS (or null when no data at all)
//   • usedHandedness  — true when ANY batter contributed a vs_*_ops value
//   • count           — how many batters contributed
//
// Used by computeNrfi for both the offense factor AND the platoon-
// advantage reason code detection (compare handedness-aware vs season-
// only outputs).

type TopOrderOpsResult = {
  value: number | null;
  usedHandedness: boolean;
  count: number;
};

function handednessAwareTopOps(
  lineup: BatterSnapshot[],
  opposingThrows: "L" | "R" | null
): TopOrderOpsResult {
  const top3 = lineup.filter(
    (b) =>
      b.batting_position !== null &&
      b.batting_position >= 1 &&
      b.batting_position <= 3
  );
  const collected: number[] = [];
  let usedAnyHandedness = false;
  for (const b of top3) {
    let ops: number | null = null;
    if (opposingThrows === "L" && b.vs_lhp_ops !== null) {
      ops = b.vs_lhp_ops;
      usedAnyHandedness = true;
    } else if (opposingThrows === "R" && b.vs_rhp_ops !== null) {
      ops = b.vs_rhp_ops;
      usedAnyHandedness = true;
    } else if (b.season_ops !== null) {
      ops = b.season_ops;
    }
    if (ops !== null) collected.push(ops);
  }
  if (collected.length === 0) {
    return { value: null, usedHandedness: false, count: 0 };
  }
  // Phase 4D.2 single-batter fallback approved by Daniel (decision #3) —
  // 4D.1 required ≥2; 4D.2 accepts 1 because sparse lineups are common
  // on morning slates before lineups are confirmed.
  const avg = collected.reduce((s, v) => s + v, 0) / collected.length;
  return {
    value: avg,
    usedHandedness: usedAnyHandedness,
    count: collected.length,
  };
}

/**
 * Pure top-3 average for the named stat. Used for reason-code triggers
 * (`top_order_power_risk` for SLG, `top_order_obp_risk` for OBP).
 * Returns null when no batters at positions 1-3 have the stat populated.
 */
function topOrderStatAvg(
  lineup: BatterSnapshot[],
  picker: (b: BatterSnapshot) => number | null
): number | null {
  const top3 = lineup.filter(
    (b) =>
      b.batting_position !== null &&
      b.batting_position >= 1 &&
      b.batting_position <= 3
  );
  const values = top3
    .map(picker)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ─── Phase 4D.2 — per-side and global modifiers ─────────────────────
//
// Layer A (per-side): pitch quality, handedness-aware top-order OPS
// Layer B (global):   park (tighter than full-game), weather (FI share),
//                     market total (tiny guardrail)
//
// All modifiers default to 1.0 (no effect) when data is missing —
// progressive enhancement, no crashes on sparse data.

/**
 * Pitch-quality factor for first-inning runs.
 *
 * `pitch_quality_score` is whiff-derived: lower = whiffier = pitcher-
 * friendly. Range [0.92, 1.08] (clamped by the source helper). Direction:
 *
 *   score ≤ 1.0 → factor < 1.0 (SUPPRESSES expected runs)
 *   score ≥ 1.0 → factor > 1.0 (BOOSTS expected runs)
 *
 * Linear remap [0.92, 1.08] → [0.95, 1.05] (Phase 4D.2 §6 decision —
 * NRFI is more sensitive than full-game, so tighter clamp).
 *
 * Symmetric around 1.0: 0.92 → 0.95, 1.0 → 1.0, 1.08 → 1.05.
 * Missing → 1.0 (neutral).
 */
function nrfiPitchQualityFactor(score: number | null): number {
  if (score === null) return 1.0;
  const clamped = clamp(score, 0.92, 1.08);
  // (clamped - 1.0) is in [-0.08, 0.08]; we want output in [0.95, 1.05]
  // → multiply by 0.05/0.08 = 0.625
  return 1.0 + (clamped - 1.0) * (0.05 / 0.08);
}

/**
 * NRFI-specific park modifier. Tighter clamp than the full-game
 * parkMultiplier (which uses [0.92, 1.15]). One-inning effect is
 * smaller than nine-inning effect, so we clamp to [0.95, 1.05].
 *
 * Missing park or park_factor_runs → 1.0 (neutral).
 */
function nrfiParkMod(park: ParkSnapshot | null): number {
  if (park === null || park.park_factor_runs === null) return 1.0;
  return clamp(park.park_factor_runs / 100, 0.95, 1.05);
}

/**
 * NRFI-specific weather multiplier. Reuses full-game `weatherDelta`
 * but scales down to first-inning share and clamps tightly.
 *
 *   delta (full game, ±0.45 max) → /9 (first-inning share)
 *                                → /4.5 (express as multiplier % around
 *                                        a typical 0.5 expected runs)
 *
 * Result clamped to [0.95, 1.05]. Dome / null weather → 1.0 (dome
 * suppression preserved via existing weatherDelta returning 0).
 */
function nrfiWeatherMult(
  weather: WeatherSnapshot | null,
  park: ParkSnapshot | null
): number {
  const delta = weatherDelta(weather, park);
  if (delta === 0) return 1.0;
  return clamp(1.0 + delta / 9 / 4.5, 0.95, 1.05);
}

/**
 * Market total guardrail. Full-game listed_total as a tiny context
 * nudge for first-inning expectations. Daniel's Phase 4D.2 spec (§7):
 *
 *   listed_total ≥ 9.5 → 1.02 (high run env hint)
 *   listed_total ≤ 7.5 → 0.98 (low run env hint)
 *   else / null        → 1.00 (no nudge)
 *
 * Deliberately tertiary — full-game expectations should NOT dominate a
 * first-inning model.
 */
function marketTotalMod(listed_total: number | null): number {
  if (listed_total === null) return 1.0;
  if (listed_total >= 9.5) return 1.02;
  if (listed_total <= 7.5) return 0.98;
  return 1.0;
}

/** Map expected_first_inning_runs to one of the 5 zones. */
function classifyZone(expected_runs: number): NrfiThresholdZone {
  if (expected_runs <= NRFI_THRESHOLD_STRONG) return "strong_nrfi";
  if (expected_runs <= NRFI_THRESHOLD_LEAN) return "lean_nrfi";
  if (expected_runs >= YRFI_THRESHOLD_STRONG) return "strong_yrfi";
  if (expected_runs >= YRFI_THRESHOLD_LEAN) return "lean_yrfi";
  return "toss_up";
}

/**
 * Natural confidence for a NRFI/YRFI zone, linearly interpolated within
 * the zone's band by distance from the boundary. Toss-Up always
 * returns NRFI_CONFIDENCE_TOSS_UP regardless of expected_runs.
 */
function naturalConfidenceForZone(
  zone: NrfiThresholdZone,
  expected_runs: number
): number {
  switch (zone) {
    case "strong_nrfi": {
      // expected ≤ 0.40. Boundary at 0.40 → low end (57). Lower runs
      // → high end (62). Use a span of 0.40 (0 → far edge).
      const distance = Math.max(0, NRFI_THRESHOLD_STRONG - expected_runs);
      const t = Math.min(1, distance / NRFI_THRESHOLD_STRONG);
      return (
        NRFI_CONFIDENCE_STRONG_MIN +
        (NRFI_CONFIDENCE_STRONG_MAX - NRFI_CONFIDENCE_STRONG_MIN) * t
      );
    }
    case "lean_nrfi": {
      // 0.40 < expected ≤ 0.50. Span 0.10. Boundary at 0.50 → low end (53),
      // boundary at 0.40 → high end (56).
      const distance = NRFI_THRESHOLD_LEAN - expected_runs;
      const t = Math.min(
        1,
        Math.max(0, distance / (NRFI_THRESHOLD_LEAN - NRFI_THRESHOLD_STRONG))
      );
      return (
        NRFI_CONFIDENCE_LEAN_MIN +
        (NRFI_CONFIDENCE_LEAN_MAX - NRFI_CONFIDENCE_LEAN_MIN) * t
      );
    }
    case "lean_yrfi": {
      // 0.62 ≤ expected < 0.72. Boundary at 0.62 → low end (53),
      // boundary at 0.72 → high end (56).
      const distance = expected_runs - YRFI_THRESHOLD_LEAN;
      const t = Math.min(
        1,
        Math.max(0, distance / (YRFI_THRESHOLD_STRONG - YRFI_THRESHOLD_LEAN))
      );
      return (
        NRFI_CONFIDENCE_LEAN_MIN +
        (NRFI_CONFIDENCE_LEAN_MAX - NRFI_CONFIDENCE_LEAN_MIN) * t
      );
    }
    case "strong_yrfi": {
      // expected ≥ 0.72. Boundary at 0.72 → low end (57). Higher runs
      // → high end (62). Span of 0.40 above the boundary.
      const distance = Math.max(0, expected_runs - YRFI_THRESHOLD_STRONG);
      const t = Math.min(1, distance / NRFI_THRESHOLD_STRONG);
      return (
        NRFI_CONFIDENCE_STRONG_MIN +
        (NRFI_CONFIDENCE_STRONG_MAX - NRFI_CONFIDENCE_STRONG_MIN) * t
      );
    }
    case "toss_up":
    case "below_floor":
      return NRFI_CONFIDENCE_TOSS_UP;
  }
}

/** Map zone → boolean predicted_nrfi for legacy DB column. */
function zoneToDecision(zone: NrfiThresholdZone): boolean | null {
  switch (zone) {
    case "strong_nrfi":
    case "lean_nrfi":
      return true;
    case "lean_yrfi":
    case "strong_yrfi":
      return false;
    case "toss_up":
    case "below_floor":
      return null;
  }
}

function computeNrfi(snapshot: GameSnapshot): NrfiResult {
  const home_starter = snapshot.home_starter;
  const away_starter = snapshot.away_starter;
  const reason_codes: string[] = [];

  // ── Hard holds (data unavailable; not Toss-Ups) ──────────────────
  if (home_starter === null || away_starter === null) {
    return {
      decision_kind: "held",
      threshold_zone: "below_floor",
      decision: null,
      confidence: null,
      expected_runs: null,
      used_fallback_era: false,
      used_top_of_order_data: false,
      hold_reason: "missing_starter_nrfi",
      reason_codes: ["missing_starter"],
    };
  }
  if (home_starter.is_scratched || away_starter.is_scratched) {
    return {
      decision_kind: "held",
      threshold_zone: "below_floor",
      decision: null,
      confidence: null,
      expected_runs: null,
      used_fallback_era: false,
      used_top_of_order_data: false,
      hold_reason: "starter_scratch_nrfi",
      reason_codes: ["starter_scratched"],
    };
  }

  // First-inning ERA: prefer real first-inning data (Phase 3.x), fall
  // back to season-ERA × 0.7 proxy.
  let used_fallback = false;
  function effectiveFirstInningEra(s: StarterSnapshot): number | null {
    if (s.first_inning_era !== null) return s.first_inning_era;
    if (s.season_era !== null) {
      used_fallback = true;
      return s.season_era * 0.7;
    }
    return null;
  }
  const homeFirstInning = effectiveFirstInningEra(home_starter);
  const awayFirstInning = effectiveFirstInningEra(away_starter);

  if (homeFirstInning === null || awayFirstInning === null) {
    return {
      decision_kind: "held",
      threshold_zone: "below_floor",
      decision: null,
      confidence: null,
      expected_runs: null,
      used_fallback_era: false,
      used_top_of_order_data: false,
      hold_reason: "missing_starter_era_nrfi",
      reason_codes: ["starter_era_unavailable"],
    };
  }
  if (used_fallback) reason_codes.push("fallback_first_inning_era");

  // Top-of-order OPS strength per side — Phase 4D.2 handedness-aware.
  // Home batters face the AWAY starter (and vice versa), so we pass the
  // opposing starter's `throws` for matchup-aware OPS lookup.
  const homeTopOpsResult = handednessAwareTopOps(
    snapshot.home_lineup_top8,
    away_starter.throws
  );
  const awayTopOpsResult = handednessAwareTopOps(
    snapshot.away_lineup_top8,
    home_starter.throws
  );
  const homeTopOps = homeTopOpsResult.value;
  const awayTopOps = awayTopOpsResult.value;
  const used_top_of_order_data = homeTopOps !== null || awayTopOps !== null;
  if (homeTopOps === null) reason_codes.push("top_order_missing_home");
  if (awayTopOps === null) reason_codes.push("top_order_missing_away");

  // Hold: BOTH starters use fallback ERA AND no top-of-order data → too
  // thin. (Preserves pre-4D.1 "thin_nrfi_data" hold semantic.)
  if (used_fallback && !used_top_of_order_data) {
    return {
      decision_kind: "held",
      threshold_zone: "below_floor",
      decision: null,
      confidence: null,
      expected_runs: null,
      used_fallback_era: true,
      used_top_of_order_data: false,
      hold_reason: "thin_nrfi_data",
      reason_codes: [...reason_codes, "thin_top_order"],
    };
  }

  // ── Phase 4D.2 — platoon advantage detection ──────────────────────
  // Compare handedness-aware top-OPS against the season-only equivalent.
  // If the handedness-aware value materially exceeds the season-only
  // value, the home/away side has a top-order platoon edge worth
  // surfacing as a reason code.
  if (homeTopOpsResult.usedHandedness && homeTopOps !== null) {
    const seasonOnly = handednessAwareTopOps(snapshot.home_lineup_top8, null);
    if (
      seasonOnly.value !== null &&
      homeTopOps > seasonOnly.value + 0.03
    ) {
      reason_codes.push("platoon_advantage_home");
    }
  }
  if (awayTopOpsResult.usedHandedness && awayTopOps !== null) {
    const seasonOnly = handednessAwareTopOps(snapshot.away_lineup_top8, null);
    if (
      seasonOnly.value !== null &&
      awayTopOps > seasonOnly.value + 0.03
    ) {
      reason_codes.push("platoon_advantage_away");
    }
  }

  // ── Phase 4D.2 — top-order SLG/OBP risk reason codes ─────────────
  const homeSlg = topOrderStatAvg(snapshot.home_lineup_top8, (b) => b.season_slg);
  const awaySlg = topOrderStatAvg(snapshot.away_lineup_top8, (b) => b.season_slg);
  if (
    (homeSlg !== null && homeSlg >= 0.48) ||
    (awaySlg !== null && awaySlg >= 0.48)
  ) {
    reason_codes.push("top_order_power_risk");
  }
  const homeObp = topOrderStatAvg(snapshot.home_lineup_top8, (b) => b.season_obp);
  const awayObp = topOrderStatAvg(snapshot.away_lineup_top8, (b) => b.season_obp);
  if (
    (homeObp !== null && homeObp >= 0.36) ||
    (awayObp !== null && awayObp >= 0.36)
  ) {
    reason_codes.push("top_order_obp_risk");
  }

  // ── Phase 4D.2 — Layer A: per-side modifiers ──────────────────────
  // Pitch-quality factor: whiffy pitchers suppress runs, contact-friendly
  // pitchers boost runs. Clamp [0.95, 1.05] per Phase 4D.2 §6.
  const homePitchFactor = nrfiPitchQualityFactor(home_starter.pitch_quality_score);
  const awayPitchFactor = nrfiPitchQualityFactor(away_starter.pitch_quality_score);

  if (
    (home_starter.pitch_quality_score !== null &&
      home_starter.pitch_quality_score <= 0.96) ||
    (away_starter.pitch_quality_score !== null &&
      away_starter.pitch_quality_score <= 0.96)
  ) {
    reason_codes.push("pitcher_quality_supports_nrfi");
  }
  if (
    (home_starter.pitch_quality_score !== null &&
      home_starter.pitch_quality_score >= 1.04) ||
    (away_starter.pitch_quality_score !== null &&
      away_starter.pitch_quality_score >= 1.04)
  ) {
    reason_codes.push("pitcher_quality_risk");
  }

  // Offense factor — clamp [0.80, 1.20] per Phase 4D.2 §3.
  const homeOffenseFactor =
    homeTopOps !== null
      ? clamp(homeTopOps / LEAGUE_CONSTANTS_V1.AVG_OPS, 0.8, 1.2)
      : 1.0;
  const awayOffenseFactor =
    awayTopOps !== null
      ? clamp(awayTopOps / LEAGUE_CONSTANTS_V1.AVG_OPS, 0.8, 1.2)
      : 1.0;

  // Per-side expected runs (away scores against home starter; home
  // scores against away starter). ERA is per 9 IP; first inning is 1/9.
  // Pitch quality multiplies the starter's effective FI ERA.
  const expectedAwayRuns =
    ((homeFirstInning * homePitchFactor) / 9) * awayOffenseFactor;
  const expectedHomeRuns =
    ((awayFirstInning * awayPitchFactor) / 9) * homeOffenseFactor;
  const per_side_subtotal = expectedAwayRuns + expectedHomeRuns;

  // ── Phase 4D.2 — Layer B: global modifiers ───────────────────────
  // park (tight clamp), weather (FI-share scaled-down), market total
  // (tiny guardrail). Each defaults to 1.0 on missing data.
  const parkMod = nrfiParkMod(snapshot.ballpark);
  const weatherMult = nrfiWeatherMult(snapshot.weather, snapshot.ballpark);
  const marketMod = marketTotalMod(snapshot.market.listed_total);

  // Reason codes from RAW underlying values (not clamped multipliers)
  // so the threshold reflects actual park/weather/market presence.
  if (
    snapshot.ballpark !== null &&
    snapshot.ballpark.park_factor_runs !== null
  ) {
    if (snapshot.ballpark.park_factor_runs >= 105)
      reason_codes.push("park_boosts_runs");
    if (snapshot.ballpark.park_factor_runs <= 95)
      reason_codes.push("park_suppresses_runs");
  }
  const rawWeatherDelta = weatherDelta(snapshot.weather, snapshot.ballpark);
  if (rawWeatherDelta > 0.2) reason_codes.push("weather_boosts_runs");
  if (rawWeatherDelta < -0.2) reason_codes.push("weather_suppresses_runs");
  if (snapshot.market.listed_total !== null) {
    if (snapshot.market.listed_total >= 9.5)
      reason_codes.push("market_total_high");
    if (snapshot.market.listed_total <= 7.5)
      reason_codes.push("market_total_low");
  }

  const expected_first_inning_runs =
    per_side_subtotal * parkMod * weatherMult * marketMod;

  // ── Classify zone ────────────────────────────────────────────────
  const naturalZone = classifyZone(expected_first_inning_runs);

  // Reason codes for picks (lightweight, 4D.1-minimal).
  if (naturalZone === "strong_nrfi" || naturalZone === "lean_nrfi") {
    reason_codes.push(
      `expected_first_inning_runs_${expected_first_inning_runs.toFixed(2)}`
    );
  }
  if (naturalZone === "strong_yrfi" || naturalZone === "lean_yrfi") {
    reason_codes.push(
      `expected_first_inning_runs_${expected_first_inning_runs.toFixed(2)}`
    );
  }

  // ── Toss-Up branch (no caps applied) ─────────────────────────────
  if (naturalZone === "toss_up") {
    return {
      decision_kind: "toss_up",
      threshold_zone: "toss_up",
      decision: null,
      confidence: NRFI_CONFIDENCE_TOSS_UP,
      expected_runs: expected_first_inning_runs,
      used_fallback_era: used_fallback,
      used_top_of_order_data,
      hold_reason: null,
      reason_codes,
    };
  }

  // ── NRFI / YRFI branch — natural confidence + data-quality caps ─
  let natural_confidence = naturalConfidenceForZone(
    naturalZone,
    expected_first_inning_runs
  );

  // Build the confidence cap from data-quality signals.
  let cap = NRFI_CONFIDENCE_CAP; // hard ceiling (65) — rarely reached
  if (used_fallback) {
    cap = Math.min(cap, NRFI_FALLBACK_CONFIDENCE_CAP);
  }
  if (snapshot.data_quality.lineup_confirmed === false) {
    cap -= NRFI_UNCONFIRMED_CONFIDENCE_PENALTY;
    reason_codes.push("lineup_unconfirmed");
  }
  if (snapshot.data_quality.starter_confirmed === false) {
    cap -= NRFI_UNCONFIRMED_CONFIDENCE_PENALTY;
    reason_codes.push("starter_unconfirmed");
  }

  const effective_confidence = Math.min(natural_confidence, cap);

  // ── Downgrade to Toss-Up when caps push confidence below floor ──
  if (effective_confidence < HARD_CONFIDENCE_FLOOR) {
    return {
      decision_kind: "toss_up",
      threshold_zone: "below_floor",
      decision: null,
      confidence: NRFI_CONFIDENCE_TOSS_UP,
      expected_runs: expected_first_inning_runs,
      used_fallback_era: used_fallback,
      used_top_of_order_data,
      hold_reason: null,
      reason_codes: [...reason_codes, "data_quality_downgrade"],
    };
  }

  // Round confidence to 1 decimal for downstream display consistency.
  const rounded_confidence = Math.round(effective_confidence * 10) / 10;

  return {
    decision_kind: naturalZone.startsWith("strong_nrfi") || naturalZone === "lean_nrfi"
      ? "nrfi"
      : "yrfi",
    threshold_zone: naturalZone,
    decision: zoneToDecision(naturalZone),
    confidence: rounded_confidence,
    expected_runs: expected_first_inning_runs,
    used_fallback_era: used_fallback,
    used_top_of_order_data,
    hold_reason: null,
    reason_codes,
  };
}

// ─────────────────────────────────────────────────────────────
// Opposing deterministic warning computation
// ─────────────────────────────────────────────────────────────

function computeOpposingDeterministicWarning(
  snapshot: GameSnapshot,
  predicted_ml_winner: "home" | "away" | null,
  predicted_ou_side: "over" | "under" | null
): boolean {
  const a = snapshot.active_injuries;

  // A top-3 hitter on the model's ML pick side is injured
  if (predicted_ml_winner === "home" && a.home_top3_hitters_injured_count > 0) {
    return true;
  }
  if (predicted_ml_winner === "away" && a.away_top3_hitters_injured_count > 0) {
    return true;
  }

  // Weather opposes the model's O/U pick
  if (
    snapshot.weather !== null &&
    snapshot.weather.is_notable &&
    predicted_ou_side !== null
  ) {
    const reason = (snapshot.weather.notable_reason ?? "").toLowerCase();
    if (
      predicted_ou_side === "under" &&
      (reason.includes("wind out") || reason.includes("high temp"))
    ) {
      return true;
    }
    if (predicted_ou_side === "over" && reason.includes("wind in")) {
      return true;
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────
// Main entry — runMlbAutoModelV1
// ─────────────────────────────────────────────────────────────

/**
 * Pure rule-seeded MLB auto-model entry point.
 *
 * Builds projected scores from 6 layers, derives ML/OU/NRFI picks
 * with stage-aware confidence caps + hard floor of 51, computes the
 * Phase 2 framework hint fields, applies deterministic guards, and
 * returns the Phase-3-compatible output shape.
 *
 * NO DB. NO NETWORK. NO SERVICE CALLS.
 */
export function runMlbAutoModelV1(
  snapshot: GameSnapshot,
  stage: ModelStage
): AutoModelOutput {
  const stageCap = STAGE_CONFIDENCE_CAPS[stage];

  // ── Layer 1 — Pitcher suppression
  const homeStarterFactor = pitcherEraFactor(snapshot.home_starter);
  const awayStarterFactor = pitcherEraFactor(snapshot.away_starter);

  // ── Layer 2 — Offense vs opposing handedness
  const homeLineupFactor = lineupOpsFactor(
    snapshot.home_lineup_top8,
    snapshot.away_starter?.throws ?? null
  );
  const awayLineupFactor = lineupOpsFactor(
    snapshot.away_lineup_top8,
    snapshot.home_starter?.throws ?? null
  );

  // ── Layer 6 (applied to Layer 2 output) — injury offense reduction
  const homeOffenseReduction = injuryOffenseReduction(
    snapshot.active_injuries.home_top3_hitters_injured_count
  );
  const awayOffenseReduction = injuryOffenseReduction(
    snapshot.active_injuries.away_top3_hitters_injured_count
  );
  const homeLineupAdjusted = homeLineupFactor.factor * (1 - homeOffenseReduction);
  const awayLineupAdjusted = awayLineupFactor.factor * (1 - awayOffenseReduction);

  // ── Layer 3 — Bullpen
  const homeBullpenFactor = bullpenFactor(snapshot.home_team);
  const awayBullpenFactor = bullpenFactor(snapshot.away_team);

  // ── Layer 4 — Park
  const parkMult = parkMultiplier(snapshot.ballpark);

  // ── Layer 5 — Weather
  const weatherDeltaTotal = weatherDelta(snapshot.weather, snapshot.ballpark);

  // ── Combine: runs SCORED by each team = runs ALLOWED by opposing
  // pitching staff × that team's offensive strength × park × weather.
  const homePitchingComposite =
    homeStarterFactor.factor * (EXPECTED_STARTER_INNINGS / 9) +
    homeBullpenFactor.factor * (EXPECTED_BULLPEN_INNINGS / 9);
  const awayPitchingComposite =
    awayStarterFactor.factor * (EXPECTED_STARTER_INNINGS / 9) +
    awayBullpenFactor.factor * (EXPECTED_BULLPEN_INNINGS / 9);

  const awayRunsRaw =
    LEAGUE_CONSTANTS_V1.AVG_RUNS_PER_GAME *
      homePitchingComposite *
      awayLineupAdjusted *
      parkMult +
    weatherDeltaTotal / 2;

  const homeRunsRaw =
    LEAGUE_CONSTANTS_V1.AVG_RUNS_PER_GAME *
      awayPitchingComposite *
      homeLineupAdjusted *
      parkMult +
    weatherDeltaTotal / 2;

  // Clamp to plausible bounds before rounding.
  const predicted_home_score = round1(
    clamp(homeRunsRaw, PREDICTED_SCORE_MIN, PREDICTED_SCORE_MAX)
  );
  const predicted_away_score = round1(
    clamp(awayRunsRaw, PREDICTED_SCORE_MIN, PREDICTED_SCORE_MAX)
  );
  const predicted_total = round1(predicted_home_score + predicted_away_score);

  // ── Pick logic ──────────────────────────────────────────────────

  // Whether the ML/OU picks are eligible at all. Missing or scratched
  // starter → both picks held; NRFI is handled separately by
  // computeNrfi.
  const mlHeldByStarter =
    snapshot.home_starter === null ||
    snapshot.away_starter === null ||
    (snapshot.home_starter !== null && snapshot.home_starter.is_scratched) ||
    (snapshot.away_starter !== null && snapshot.away_starter.is_scratched);

  // ── ML ──────────────────────────────────────────────────────────
  let predicted_ml_winner: "home" | "away" | null = null;
  let ml_confidence: number | null = null;

  if (!mlHeldByStarter) {
    const runDiff = Math.abs(predicted_home_score - predicted_away_score);
    const eraGap = Math.abs(
      homeStarterFactor.factor - awayStarterFactor.factor
    );
    // Confidence formula: baseline 50 + run-difference bonus + ERA-gap
    // bonus, clamped to [50, stageCap]. ERA gap scaled × 10 to give it
    // similar magnitude to runDiff in the linear sum.
    const rawConfidence = 50 + 10 * runDiff + 5 * eraGap * 10;
    const cappedConfidence = clamp(rawConfidence, 50, stageCap);
    if (cappedConfidence >= HARD_CONFIDENCE_FLOOR) {
      // Avoid pathological ties (Layer 0 invariant; deterministic
      // guard #2 also defends against this).
      if (predicted_home_score !== predicted_away_score) {
        predicted_ml_winner =
          predicted_home_score > predicted_away_score ? "home" : "away";
        ml_confidence = round1(cappedConfidence);
      }
    }
  }

  // ── O/U ─────────────────────────────────────────────────────────
  const market_line_available = snapshot.market.listed_total !== null;
  let predicted_ou_side: "over" | "under" | null = null;
  let ou_confidence: number | null = null;

  if (market_line_available && !mlHeldByStarter) {
    const marketLine = snapshot.market.listed_total!;
    const ouSide: "over" | "under" =
      predicted_total > marketLine ? "over" : "under";
    const ouDiff = Math.abs(predicted_total - marketLine);
    const rawConfidence = 50 + 8 * ouDiff;
    const cappedConfidence = clamp(rawConfidence, 50, stageCap);
    if (cappedConfidence >= HARD_CONFIDENCE_FLOOR) {
      predicted_ou_side = ouSide;
      ou_confidence = round1(cappedConfidence);
    }
  }

  // ── NRFI ────────────────────────────────────────────────────────
  const nrfi = computeNrfi(snapshot);
  const predicted_nrfi = nrfi.decision;
  const nrfi_confidence = nrfi.confidence !== null ? round1(nrfi.confidence) : null;

  // ── Safety / framework hint fields ──────────────────────────────
  const starter_confirmed = snapshot.data_quality.starter_confirmed;
  const lineup_confirmed = snapshot.data_quality.lineup_confirmed;

  const opposing_deterministic_warning = computeOpposingDeterministicWarning(
    snapshot,
    predicted_ml_winner,
    predicted_ou_side
  );

  // ── Hold tracking ───────────────────────────────────────────────
  const hold_picks: Array<"ml" | "ou" | "nrfi"> = [];
  if (predicted_ml_winner === null) hold_picks.push("ml");
  if (predicted_ou_side === null) hold_picks.push("ou");
  if (predicted_nrfi === null) hold_picks.push("nrfi");
  const held = hold_picks.length === 3;

  let hold_reason: string | null = null;
  if (held) {
    if (mlHeldByStarter) hold_reason = "missing_or_scratched_starter";
    else if (!market_line_available && nrfi.hold_reason !== null)
      hold_reason = `${nrfi.hold_reason}_and_no_market_line`;
    else if (!market_line_available) hold_reason = "no_market_line_and_low_confidence";
    else if (nrfi.hold_reason !== null) hold_reason = nrfi.hold_reason;
    else hold_reason = "all_picks_below_floor";
  }

  // ── Debug audit factors ─────────────────────────────────────────
  const auto_factors: AutoFactors = {
    home_starter_id: snapshot.home_starter?.player_external_id ?? null,
    away_starter_id: snapshot.away_starter?.player_external_id ?? null,
    home_starter_era: snapshot.home_starter?.season_era ?? null,
    away_starter_era: snapshot.away_starter?.season_era ?? null,
    home_starter_era_factor: round1(homeStarterFactor.factor * 100) / 100,
    away_starter_era_factor: round1(awayStarterFactor.factor * 100) / 100,
    home_lineup_weighted_ops:
      homeLineupFactor.weighted_ops !== null
        ? round1(homeLineupFactor.weighted_ops * 1000) / 1000
        : null,
    away_lineup_weighted_ops:
      awayLineupFactor.weighted_ops !== null
        ? round1(awayLineupFactor.weighted_ops * 1000) / 1000
        : null,
    home_lineup_ops_factor_adjusted: round1(homeLineupAdjusted * 100) / 100,
    away_lineup_ops_factor_adjusted: round1(awayLineupAdjusted * 100) / 100,
    home_bullpen_factor: round1(homeBullpenFactor.factor * 100) / 100,
    away_bullpen_factor: round1(awayBullpenFactor.factor * 100) / 100,
    park_factor_runs: snapshot.ballpark?.park_factor_runs ?? null,
    weather_total_adjust: weatherDeltaTotal,
    league_avg_runs_used: LEAGUE_CONSTANTS_V1.AVG_RUNS_PER_GAME,
    league_avg_era_used: LEAGUE_CONSTANTS_V1.AVG_ERA,
    league_avg_ops_used: LEAGUE_CONSTANTS_V1.AVG_OPS,
    stage_confidence_cap: stageCap,
    nrfi_expected_runs:
      nrfi.expected_runs !== null
        ? round1(nrfi.expected_runs * 100) / 100
        : null,
    nrfi_used_fallback_era: nrfi.used_fallback_era,
    nrfi_used_top_of_order_data: nrfi.used_top_of_order_data,
  };

  // ── Assemble sport_specific output ──────────────────────────────
  // Phase 4D.1: nrfi_decision_kind / nrfi_threshold_zone / nrfi_reason_codes /
  // nrfi_hold_reason expose the 5-zone classification so consumers can
  // distinguish Toss-Up from data-thin holds. The legacy predicted_nrfi
  // boolean stays for DB compat (true=NRFI, false=YRFI, null=Toss-Up OR
  // held). On Toss-Up rows nrfi_confidence is non-null (52) even though
  // predicted_nrfi is null — the orphan-check tests are aware of this
  // exception.
  const sport_specific: AutoModelSportSpecific = {
    model_version: MODEL_VERSION,
    stage,
    starter_confirmed,
    lineup_confirmed,
    market_line_available,
    opposing_deterministic_warning,
    listed_line: snapshot.market.listed_total,
    held,
    hold_reason,
    hold_picks,
    stale: false, // T-60 stale detection is a Phase 3B service concern
    stale_reason: null,
    predicted_nrfi,
    nrfi_confidence,
    auto_factors,
    ai_sanity: {
      action: "approve",
      reasoning: "V1 stub",
      applied_confidence_delta: 0,
      applied_score_delta_home: 0,
      applied_score_delta_away: 0,
      warnings: [],
      deterministic_corrections: [], // populated by applyDeterministicGuards
    },
    // Phase 4D.1 NRFI audit fields
    nrfi_decision_kind: nrfi.decision_kind,
    nrfi_threshold_zone: nrfi.threshold_zone,
    nrfi_reason_codes: nrfi.reason_codes,
    nrfi_hold_reason: nrfi.hold_reason,
  };

  // ── Build raw output. When held, top-level score columns stay
  // populated for diagnostic purposes (the model still has a projection
  // even when the picks are held). Daily Edge renders them as the
  // "projected final" hero stat regardless of pick state.
  const rawOutput: AutoModelOutput = {
    game_external_id: snapshot.game_external_id,
    prediction_source: "auto_v1_mlb_rules",
    predicted_home_score,
    predicted_away_score,
    predicted_total,
    predicted_ml_winner,
    ml_confidence,
    predicted_ou_side,
    ou_confidence,
    predicted_nrfi,
    nrfi_confidence,
    sport_specific,
  };

  // ── Apply deterministic guards. Returns guarded output; corrections
  // are recorded in sport_specific.ai_sanity.deterministic_corrections.
  const { guarded } = applyDeterministicGuards(rawOutput, snapshot, stage);
  return guarded;
}
