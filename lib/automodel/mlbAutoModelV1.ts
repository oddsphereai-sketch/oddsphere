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
  FI_WHIP_BASELINE,
  FI_WHIP_MODIFIER_CLAMP_MAX,
  FI_WHIP_MODIFIER_CLAMP_MIN,
  FI_WHIP_MODIFIER_SCALE,
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
  STAGE_CONFIDENCE_CAPS_V2,
  compressConfidence,
  dampenRawConfidence,
  type DampeningFlags,
  TOP3_HITTER_INJURY_REDUCTION_CAP,
  TOP3_HITTER_INJURY_REDUCTION_PER,
  // R-16J Step 1 — input shrinkage + FI baseline calibration
  SHRINKAGE_K_STARTER_ERA,
  SHRINKAGE_K_STARTER_WHIP,
  SHRINKAGE_K_FI_ERA,
  SHRINKAGE_K_FI_WHIP,
  SHRINKAGE_K_LINEUP_OPS,
  LEAGUE_BASELINE_WHIP,
  LEAGUE_BASELINE_FI_ERA,
  FI_BASELINE_CALIBRATION,
  // R-16J Step 1.6 — FI offense fallback hierarchy
  SHRINKAGE_K_TEAM_OPS,
  NRFI_PROJECTED_LINEUP_PENALTY,
  NRFI_TEAM_PROXY_PENALTY,
  NRFI_LEAGUE_AVG_PENALTY,
} from "./types";
import { applyDeterministicGuards } from "./aiSanityBoundary";

// Phase 3.x.1 — minimum first-inning starts required to trust the real
// FI ERA. Below the gate, real FI data is treated as too thin and the
// model falls back to the season-ERA × 0.7 proxy while emitting the
// `low_first_inning_sample` reason code so operators can distinguish
// "thin sample" from "no FI data at all" (`fallback_first_inning_era`).
const FIRST_INNING_SAMPLE_GATE = 3;

// Phase 3.x.3 — fallback multiplier applied to season ERA when real
// first-inning ERA is unavailable. Was 0.7 in Phase 3A–3.x.2 (an
// inverted heuristic that systematically underestimated FI damage).
// Real first-inning ERA averages ≈ 1.0× season ERA over large samples
// per MLB historical data, not 0.7×.
const FIRST_INNING_PROXY_MULTIPLIER = 1.0;

// ─────────────────────────────────────────────────────────────
// Math utilities
// ─────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * R-16J Step 1 — empirical-Bayes shrinkage toward a prior.
 *
 *   effective = (k * prior + n * raw) / (k + n)
 *   weight    = n / (k + n)         // 0 = full prior, 1 = full raw
 *
 * Used to regress noisy small-sample inputs (starter ERA, FI ERA, FI
 * WHIP, lineup OPS) toward league means. Pure; depends only on its
 * arguments. Null/zero-sample raw values return the prior with weight 0.
 *
 * Safe edge cases:
 *   • raw === null      → effective = prior, weight = 0
 *   • n === null         → effective = prior, weight = 0
 *   • n <= 0             → effective = prior, weight = 0
 *   • k === 0            → effective = raw,   weight = 1 (no shrinkage)
 */
function shrinkRate(
  raw: number | null,
  n: number | null,
  k: number,
  prior: number
): { effective: number; weight: number } {
  if (raw === null || n === null || n <= 0) {
    return { effective: prior, weight: 0 };
  }
  const weight = n / (k + n);
  const effective = (k * prior + n * raw) / (k + n);
  return { effective, weight };
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
  /**
   * R-16J Step 1 — raw season ERA (pre-shrinkage) for transparency.
   * Null when starter has no season ERA.
   */
  raw_era: number | null;
  /**
   * R-16J Step 1 — shrinkage weight on the raw season ERA (0..1).
   * 0 = full league prior; 1 = full raw value. Lets the breakdown UI
   * + reviewer surface how much the model trusted this pitcher's
   * actual sample.
   */
  shrinkage_weight: number;
};

function pitcherEraFactor(starter: StarterSnapshot | null): PitcherFactorResult {
  if (starter === null || starter.season_era === null) {
    return {
      factor: 1.0,
      effective_era: null,
      used_fallback: true,
      raw_era: null,
      shrinkage_weight: 0,
    };
  }
  // R-16J Step 1 — shrink season ERA toward league prior before any
  // downstream blending. Small samples (Jared Jones 1-start scenarios)
  // collapse toward league mean; established starters retain ~75% raw
  // weight at 270 IP. Single-line change at the input boundary; the
  // rest of the formula is unchanged.
  const seasonIp = starter.season_innings_pitched ?? null;
  const { effective: shrunk_season_era, weight: shrinkage_weight } = shrinkRate(
    starter.season_era,
    seasonIp,
    SHRINKAGE_K_STARTER_ERA,
    LEAGUE_CONSTANTS_V1.AVG_ERA
  );
  // Weighted blend of (shrunken) season ERA and last-30-day ERA.
  // last30 stays UN-shrunk on purpose — it's a recency signal designed
  // to react fast; shrinking it would erase its job. The 0.7/0.3 blend
  // already gives it bounded weight.
  const blended_era =
    starter.last30_era !== null
      ? 0.7 * shrunk_season_era + 0.3 * starter.last30_era
      : shrunk_season_era;
  // Pitch-quality adjustment is multiplicative and tightly bounded so
  // a bad estimate can't dominate the factor.
  const pitch_adj =
    starter.pitch_quality_score !== null
      ? clamp(starter.pitch_quality_score, 0.92, 1.08)
      : 1.0;
  const factor = (blended_era / LEAGUE_CONSTANTS_V1.AVG_ERA) * pitch_adj;
  return {
    factor,
    effective_era: blended_era,
    used_fallback: false,
    raw_era: starter.season_era,
    shrinkage_weight,
  };
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
      // R-16J Step 1 — per-batter OPS shrinkage by season PA. Protects
      // against hot-streak debut hitters dominating the lineup factor
      // (a 50-PA debutant with .950 OPS shrinks ~25% toward league
      // baseline before being position-weighted). season_pa is optional
      // on the snapshot for pre-R-16J fixture back-compat; missing PA
      // is treated as `n = 0` → effective_ops = league baseline (the
      // honest answer when we don't know how much to trust the OPS).
      const pa = b.season_pa ?? null;
      const { effective: effective_ops } = shrinkRate(
        ops,
        pa,
        SHRINKAGE_K_LINEUP_OPS,
        LEAGUE_CONSTANTS_V1.AVG_OPS
      );
      const weight = positionWeight(b.batting_position);
      totalWeightedOps += effective_ops * weight;
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
  /** Expected first-inning runs (both teams summed). R-16J Step 1:
   *  this is the CALIBRATED λ (after FI_BASELINE_CALIBRATION).
   *  See `lambda_raw` for the pre-calibration value. */
  expected_runs: number | null;
  /** Whether the starter ERA fallback (`season_era × 0.7`) was used. */
  used_fallback_era: boolean;
  /** Whether either side's top-of-order OPS data was used. */
  used_top_of_order_data: boolean;
  /** Hold reason — ONLY set when decision_kind="held". Null on Toss-Up. */
  hold_reason: string | null;
  /** Audit tags. Minimal in 4D.1; expands in 4D.3. */
  reason_codes: string[];
  /** R-16J Step 1 — raw λ BEFORE empirical calibration. Used by
   *  buildAutoFactors to surface lambda_raw alongside the calibrated value. */
  lambda_raw?: number | null;
  /** R-16J Step 1 — Poisson NRFI probability from the calibrated λ. */
  p_nrfi?: number | null;
  /** R-16J Step 1 — Poisson YRFI probability = 1 - p_nrfi. */
  p_yrfi?: number | null;
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

// ─── R-16J Step 1.6 — FI offense fallback hierarchy ─────────────────
//
// The classification chain consumed by computeNrfi:
//   Tier 1 — confirmed top-of-order OPS via handednessAwareTopOps
//   Tier 2 — projected top-of-order OPS via the same helper
//   Tier 3 — team-OPS aggregate proxy shrunken by SHRINKAGE_K_TEAM_OPS
//   Tier 4 — league average OPS (always available, last-resort)
//
// Every call returns a non-null `value` (tier 4 is the floor), which
// shifts the historical "homeTopOps === null" signal into the explicit
// `tier === "league_avg"` check. Callers use the tier to (a) emit per-
// tier reason codes, (b) apply confidence-cap penalties, and (c) gate
// the `thin_top_order_downgraded` safety floor (only fires when BOTH
// sides land at tier 4 AND the FI ERA path is also on fallback).

export type OffenseFallbackTier =
  | "confirmed"
  | "projected"
  | "team_proxy"
  | "league_avg";

type TopOrderOpsFallback = {
  value: number;
  tier: OffenseFallbackTier;
  /** True iff handednessAwareTopOps actually used a vs_*_ops value
   *  (only meaningful at tiers 1 + 2). */
  usedHandedness: boolean;
  /** Number of batters contributing to the top-3 average (tiers 1 + 2). */
  count: number;
};

function topOrderOpsWithFallback(
  lineup: BatterSnapshot[],
  opposingThrows: "L" | "R" | null,
  team: TeamSnapshot
): TopOrderOpsFallback {
  // Tier 1 — confirmed batters. Pre-R-16J fixtures omit `lineup_source`;
  // treat undefined as "confirmed" so existing tests retain their
  // historical tier 1 behavior (the field is new in Step 1.6).
  const confirmedBatters = lineup.filter(
    (b) => b.lineup_source !== "projected"
  );
  if (confirmedBatters.length > 0) {
    const r = handednessAwareTopOps(confirmedBatters, opposingThrows);
    if (r.value !== null) {
      return {
        value: r.value,
        tier: "confirmed",
        usedHandedness: r.usedHandedness,
        count: r.count,
      };
    }
  }

  // Tier 2 — projected batters. Same helper, different rows. BDL
  // projections are trusted enough for a directional read so no cap
  // penalty is applied — a flag-only reason code surfaces the source.
  const projectedBatters = lineup.filter(
    (b) => b.lineup_source === "projected"
  );
  if (projectedBatters.length > 0) {
    const r = handednessAwareTopOps(projectedBatters, opposingThrows);
    if (r.value !== null) {
      return {
        value: r.value,
        tier: "projected",
        usedHandedness: r.usedHandedness,
        count: r.count,
      };
    }
  }

  // Tier 3 — team-level OPS aggregate, shrunken toward league mean by
  // the team's qualifying-batter PA sample. Conservative-by-design:
  // light shrinkage (k=300) is large enough to keep thin-roster
  // aggregates honest. Carries a −3pp confidence cap penalty at the
  // call site.
  if (
    team.team_avg_batter_ops !== null &&
    team.team_avg_batter_ops !== undefined
  ) {
    const sample = team.team_avg_batter_ops_sample ?? null;
    const { effective } = shrinkRate(
      team.team_avg_batter_ops,
      sample,
      SHRINKAGE_K_TEAM_OPS,
      LEAGUE_CONSTANTS_V1.AVG_OPS
    );
    return {
      value: effective,
      tier: "team_proxy",
      usedHandedness: false,
      count: 0,
    };
  }

  // Tier 4 — league average. Always available; carries a −5pp cap
  // penalty + flags the `thin_top_order_downgraded` safety floor when
  // both sides land here AND FI ERA is also on fallback.
  return {
    value: LEAGUE_CONSTANTS_V1.AVG_OPS,
    tier: "league_avg",
    usedHandedness: false,
    count: 0,
  };
}

/** Confidence-cap penalty (in points) per FI offense fallback tier. */
function offenseTierPenalty(tier: OffenseFallbackTier): number {
  switch (tier) {
    case "confirmed":
      return 0;
    case "projected":
      return NRFI_PROJECTED_LINEUP_PENALTY;
    case "team_proxy":
      return NRFI_TEAM_PROXY_PENALTY;
    case "league_avg":
      return NRFI_LEAGUE_AVG_PENALTY;
  }
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
 * Per-starter first-inning WHIP secondary modifier.
 *
 * Applied as a small multiplicative factor on a starter's expected
 * first-inning runs (alongside the FI ERA + pitch quality + offense
 * factors that drive the primary computation). Captures baserunner
 * risk that FI ERA alone misses — a pitcher with low FI ERA but high
 * FI WHIP has been getting lucky stranding runners.
 *
 * Conservative-by-design:
 *   • Sample-size gate (same FIRST_INNING_SAMPLE_GATE as FI ERA).
 *     Below the gate, returns 1.0 (no-op) and emits a `low_sample`
 *     reason hint to the caller.
 *   • Scale factor (FI_WHIP_MODIFIER_SCALE = 0.35) under-weights
 *     because FI WHIP and FI ERA are ~0.81 correlated in V1 data —
 *     most of the signal is already captured by the ERA path. The
 *     scale limits the modifier's natural effect to roughly one-third
 *     of the raw deviation from baseline.
 *   • Hard clamp (FI_WHIP_MODIFIER_CLAMP_MIN/MAX = 0.96/1.04) caps
 *     the modifier at ±4% so a single outlier sample cannot swing
 *     expected_runs by more than that.
 *
 * Returns the multiplier + a "kind" tag the caller can map to a
 * reason code (`unavailable` / `low_sample` / `supports_nrfi` /
 * `yrfi_risk` / `neutral`).
 */
type FiWhipModifier = {
  mult: number;
  kind: "unavailable" | "low_sample" | "supports_nrfi" | "yrfi_risk" | "neutral";
};

function nrfiWhipFactor(starter: StarterSnapshot): FiWhipModifier {
  if (starter.first_inning_whip === null) {
    return { mult: 1.0, kind: "unavailable" };
  }
  const starts = starter.first_inning_starts ?? 0;
  // R-16J Step 1 — preserve the FIRST_INNING_SAMPLE_GATE (3) for the
  // "low_sample" classification, but apply shrinkage to the value
  // when it IS trusted. A pitcher with 3 FI starts gets the shrunken
  // WHIP (~17% raw weight under k=15); 30 starts gets ~67%.
  if (starts < FIRST_INNING_SAMPLE_GATE) {
    return { mult: 1.0, kind: "low_sample" };
  }
  // R-16J Step 1 — FI WHIP shrinkage uses FI_WHIP_BASELINE (1.225) as
  // the prior, NOT the general LEAGUE_BASELINE_WHIP. The two priors
  // serve different baselines: full-game WHIP averages ~1.30, while
  // first-inning WHIP centers at FI_WHIP_BASELINE (1.225) per the
  // existing deviation formula below. Mismatched priors would inject
  // a tiny systematic bias on a stat designed to be neutral at 1.225.
  const { effective: shrunk_whip } = shrinkRate(
    starter.first_inning_whip,
    starts,
    SHRINKAGE_K_FI_WHIP,
    FI_WHIP_BASELINE
  );
  const deviation = (shrunk_whip - FI_WHIP_BASELINE) / FI_WHIP_BASELINE;
  const natural = 1 + deviation * FI_WHIP_MODIFIER_SCALE;
  const mult = clamp(natural, FI_WHIP_MODIFIER_CLAMP_MIN, FI_WHIP_MODIFIER_CLAMP_MAX);
  // Threshold for emitting a directional reason code — must be a
  // meaningful nudge, not just float noise around 1.0.
  if (mult <= 0.99) return { mult, kind: "supports_nrfi" };
  if (mult >= 1.01) return { mult, kind: "yrfi_risk" };
  return { mult, kind: "neutral" };
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

function computeNrfi(snapshot: GameSnapshot, stage: ModelStage): NrfiResult {
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

  // First-inning ERA: prefer real FI data when sample is ≥ FIRST_INNING_SAMPLE_GATE.
  // Phase 3.x.1 sources (in priority order):
  //   "real"       — real FI ERA from MLB Stats API, starts ≥ gate
  //   "low_sample" — real FI ERA present but starts < gate; falls back
  //                  to season-ERA × FIRST_INNING_PROXY_MULTIPLIER and
  //                  flags low_first_inning_sample. Phase 4.2.C.1.H-6.1
  //                  generalized this to also cover MLB-only pitchers
  //                  (real FI exists, sample < gate, season_era is null):
  //                  use the real FI ERA directly rather than dropping
  //                  real data — discarding observed FI when no season
  //                  anchor exists was the bug that held every NRFI on
  //                  slates dominated by MLB-only-ingested starters.
  //   "proxy"      — no FI ERA; falls back to season-ERA ×
  //                  FIRST_INNING_PROXY_MULTIPLIER and flags
  //                  fallback_first_inning_era (the pre-3.x.1 behavior)
  //   "missing"    — no FI ERA and no season ERA; existing hold path
  type FirstInningSource = "real" | "low_sample" | "proxy" | "missing";
  function effectiveFirstInningEra(s: StarterSnapshot): {
    value: number | null;
    source: FirstInningSource;
    raw: number | null;
    shrinkage_weight: number;
  } {
    const era = s.first_inning_era;
    const starts = s.first_inning_starts ?? 0;
    // R-16J Step 1 — apply shrinkage to FI ERA toward league baseline.
    // The "real" vs "low_sample" classification preserves the original
    // FIRST_INNING_SAMPLE_GATE (3) gate so the downstream
    // `hasAnyRealFI` cap fires identically to pre-R-16J behavior.
    // Shrinkage is layered ON TOP: even "real" FI ERAs are regressed
    // toward league mean by FI start count.
    if (era !== null && starts >= FIRST_INNING_SAMPLE_GATE) {
      const { effective, weight } = shrinkRate(
        era,
        starts,
        SHRINKAGE_K_FI_ERA,
        LEAGUE_BASELINE_FI_ERA
      );
      return { value: effective, source: "real", raw: era, shrinkage_weight: weight };
    }
    if (era !== null) {
      // Thin FI sample (1-2 starts). Treat as low_sample like pre-R-16J,
      // but use the SHRUNKEN value rather than dropping to season ERA.
      // The shrunken FI ERA with 1 start is ~93% league baseline; this
      // is the honest representation of "we have a tiny signal."
      const { effective, weight } = shrinkRate(
        era,
        starts,
        SHRINKAGE_K_FI_ERA,
        LEAGUE_BASELINE_FI_ERA
      );
      return { value: effective, source: "low_sample", raw: era, shrinkage_weight: weight };
    }
    if (s.season_era !== null) {
      // No FI ERA data at all. Fall back to shrunken season ERA ×
      // proxy multiplier. Pre-R-16J this used raw season ERA; R-16J
      // applies STARTER_ERA shrinkage so a tiny-sample season ERA
      // doesn't drive a fake FI projection.
      const { effective: shrunk_season, weight } = shrinkRate(
        s.season_era,
        s.season_innings_pitched ?? null,
        SHRINKAGE_K_STARTER_ERA,
        LEAGUE_CONSTANTS_V1.AVG_ERA
      );
      return {
        value: shrunk_season * FIRST_INNING_PROXY_MULTIPLIER,
        source: "proxy",
        raw: null,
        shrinkage_weight: weight,
      };
    }
    return { value: null, source: "missing", raw: null, shrinkage_weight: 0 };
  }
  const homeFirst = effectiveFirstInningEra(home_starter);
  const awayFirst = effectiveFirstInningEra(away_starter);
  const homeFirstInning = homeFirst.value;
  const awayFirstInning = awayFirst.value;
  const fiSources: FirstInningSource[] = [homeFirst.source, awayFirst.source];
  const used_fallback =
    fiSources.includes("proxy") || fiSources.includes("low_sample");

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
  if (fiSources.includes("real")) reason_codes.push("first_inning_data_used");
  if (fiSources.includes("low_sample")) reason_codes.push("low_first_inning_sample");
  if (fiSources.includes("proxy")) reason_codes.push("fallback_first_inning_era");

  // Top-of-order OPS strength per side — Phase 4D.2 handedness-aware,
  // extended with R-16J Step 1.6's 4-tier fallback so projected-lineup
  // and team-OPS-aggregate paths fill in when the confirmed top-of-
  // order isn't posted yet. Home batters face the AWAY starter (and
  // vice versa), so we pass the opposing starter's `throws` for
  // matchup-aware OPS lookup.
  const homeTopOpsFallback = topOrderOpsWithFallback(
    snapshot.home_lineup_top8,
    away_starter.throws,
    snapshot.home_team
  );
  const awayTopOpsFallback = topOrderOpsWithFallback(
    snapshot.away_lineup_top8,
    home_starter.throws,
    snapshot.away_team
  );
  const homeTopOps = homeTopOpsFallback.value;
  const awayTopOps = awayTopOpsFallback.value;
  // `used_top_of_order_data` now means "at least one side has actual
  // lineup or team-proxy data" (NOT just league mean). The audit field
  // downstream (`auto_factors.nrfi_used_top_of_order_data`) keeps this
  // meaning so consumers reading older rows stay coherent.
  const bothSidesAtLeagueAvg =
    homeTopOpsFallback.tier === "league_avg" &&
    awayTopOpsFallback.tier === "league_avg";
  const used_top_of_order_data = !bothSidesAtLeagueAvg;

  // R-16J Step 1.6 — per-tier reason codes. Fire once per tier when
  // either side used it. Tier 1 ("confirmed") emits no code (it's the
  // default path).
  const tiersUsed = new Set<OffenseFallbackTier>([
    homeTopOpsFallback.tier,
    awayTopOpsFallback.tier,
  ]);
  if (tiersUsed.has("projected")) reason_codes.push("top_order_projected_used");
  if (tiersUsed.has("team_proxy")) reason_codes.push("top_order_team_proxy_used");
  if (tiersUsed.has("league_avg")) reason_codes.push("top_order_league_avg_used");

  // Phase 4.2.C.1.H-6.2 — thin top-order Toss-Up downgrade.
  //
  // Pre-R-16J Step 1.6 this fired when ANY starter used fallback FI
  // ERA AND there was no top-of-order data on either side. Step 1.6
  // narrows the condition: it now only fires when BOTH sides land at
  // tier 4 (league average) — i.e. we truly have no offense data on
  // either team. Games with projected lineups or team-OPS aggregates
  // are no longer routed here; the model can pick directionally and
  // accept the per-tier cap penalty instead.
  //
  // Toss-Up is reserved for the First Inning market only; ML/OU paths
  // continue to use winner/held language elsewhere in the model.
  if (used_fallback && bothSidesAtLeagueAvg) {
    // Basic ERA-only expected runs as a transparency signal on the
    // Toss-Up payload. The full modifier chain (park/weather/market/
    // pitch quality/offense factor/FI WHIP) runs further down and isn't
    // available at this branch — that's fine, the displayed Toss-Up
    // value is a flat constant anyway.
    const tossUpExpectedRuns = (homeFirstInning + awayFirstInning) / 9;
    return {
      decision_kind: "toss_up",
      threshold_zone: "below_floor",
      decision: null,
      confidence: NRFI_CONFIDENCE_TOSS_UP,
      expected_runs: tossUpExpectedRuns,
      used_fallback_era: true,
      used_top_of_order_data: false,
      hold_reason: null,
      reason_codes: [...reason_codes, "thin_top_order_downgraded"],
    };
  }

  // ── Phase 4D.2 — platoon advantage detection ──────────────────────
  // Compare handedness-aware top-OPS against the season-only equivalent.
  // If the handedness-aware value materially exceeds the season-only
  // value, the home/away side has a top-order platoon edge worth
  // surfacing as a reason code. Only meaningful at tiers 1 + 2, where
  // an actual lineup feeds handednessAwareTopOps.
  if (homeTopOpsFallback.usedHandedness && homeTopOps !== null) {
    const seasonOnly = handednessAwareTopOps(snapshot.home_lineup_top8, null);
    if (
      seasonOnly.value !== null &&
      homeTopOps > seasonOnly.value + 0.03
    ) {
      reason_codes.push("platoon_advantage_home");
    }
  }
  if (awayTopOpsFallback.usedHandedness && awayTopOps !== null) {
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
  // R-16J Step 1.6: `topOrderOpsWithFallback` always returns a non-null
  // value (tier 4 falls back to league mean), so the null-guard from
  // pre-1.6 is no longer needed. League-mean inputs at tier 4 produce
  // factor 1.0 naturally — the original null→1.0 semantics are preserved.
  const homeOffenseFactor = clamp(
    homeTopOps / LEAGUE_CONSTANTS_V1.AVG_OPS,
    0.8,
    1.2
  );
  const awayOffenseFactor = clamp(
    awayTopOps / LEAGUE_CONSTANTS_V1.AVG_OPS,
    0.8,
    1.2
  );

  // FI WHIP secondary modifier (2026-06-02). Per-starter, conservative,
  // tightly clamped. See nrfiWhipFactor() for the formula. Each side's
  // run contribution comes from the OPPOSING starter, so the AWAY runs
  // get the HOME starter's WHIP modifier (and vice versa).
  const homeWhipMod = nrfiWhipFactor(home_starter);
  const awayWhipMod = nrfiWhipFactor(away_starter);
  if (homeWhipMod.kind === "unavailable") reason_codes.push("fi_whip_unavailable_home");
  else if (homeWhipMod.kind === "low_sample") reason_codes.push("low_fi_whip_sample_home");
  if (awayWhipMod.kind === "unavailable") reason_codes.push("fi_whip_unavailable_away");
  else if (awayWhipMod.kind === "low_sample") reason_codes.push("low_fi_whip_sample_away");
  // Combined directional reason code — only emit once per side,
  // regardless of which starter triggered it.
  if (homeWhipMod.kind === "supports_nrfi" || awayWhipMod.kind === "supports_nrfi") {
    reason_codes.push("fi_whip_supports_nrfi");
  }
  if (homeWhipMod.kind === "yrfi_risk" || awayWhipMod.kind === "yrfi_risk") {
    reason_codes.push("fi_whip_yrfi_risk");
  }

  // Per-side expected runs (away scores against home starter; home
  // scores against away starter). ERA is per 9 IP; first inning is 1/9.
  // Pitch quality multiplies the starter's effective FI ERA; WHIP
  // modifier is applied as a tightly-clamped secondary nudge.
  const expectedAwayRuns =
    ((homeFirstInning * homePitchFactor) / 9) * awayOffenseFactor * homeWhipMod.mult;
  const expectedHomeRuns =
    ((awayFirstInning * awayPitchFactor) / 9) * homeOffenseFactor * awayWhipMod.mult;
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

  // ── R-16J Step 1 — raw λ + empirical baseline calibration ───────
  // The `(FI_ERA / 9)` conversion above produces ~0.88 combined runs at
  // all-league-average inputs, but empirical MLB combined first-inning
  // runs average ~0.55 (NRFI rate 55-58%). FI_BASELINE_CALIBRATION
  // anchors the model's output to empirical reality. See its docstring
  // in types.ts for the derivation.
  const lambda_raw = per_side_subtotal * parkMod * weatherMult * marketMod;
  const expected_first_inning_runs = lambda_raw * FI_BASELINE_CALIBRATION;

  // ── R-16J Step 1 — Poisson conversion to NRFI/YRFI probabilities ─
  //   P(NRFI) = e^(-λ) — probability of 0 runs given expected λ
  //   P(YRFI) = 1 - P(NRFI)
  const p_nrfi = Math.exp(-expected_first_inning_runs);
  const p_yrfi = 1 - p_nrfi;

  // Both-sides-fallback guardrail (preserved from Phase 3.x.3). When
  // NEITHER starter has real first-inning data (weight < 0.5 on both),
  // cap to toss_up regardless of probability — the model has no real
  // FI evidence on either side, so a confident NRFI/YRFI would be noise.
  const hasAnyRealFI = fiSources.includes("real");

  // ── R-16J Step 1 — pick decision via probability thresholds ─────
  // NRFI when P(NRFI) ≥ 0.55, YRFI when P(NRFI) ≤ 0.45, Toss-Up
  // between (10pp band around 50/50). With the empirical calibration,
  // these thresholds land where they SHOULD relative to true MLB rates.
  type Decision = "nrfi" | "yrfi" | "toss_up";
  let decisionKind: Decision;
  if (!hasAnyRealFI) {
    decisionKind = "toss_up";
    reason_codes.push("both_starters_fallback_capped_to_toss_up");
  } else if (p_nrfi >= 0.55) {
    decisionKind = "nrfi";
  } else if (p_nrfi <= 0.45) {
    decisionKind = "yrfi";
  } else {
    decisionKind = "toss_up";
  }

  // Reason code for picks (audit transparency).
  if (decisionKind !== "toss_up") {
    reason_codes.push(
      `expected_first_inning_runs_${expected_first_inning_runs.toFixed(2)}`
    );
  }

  // ── Toss-Up branch (no caps applied) ─────────────────────────────
  if (decisionKind === "toss_up") {
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
      lambda_raw,
      p_nrfi,
      p_yrfi,
    };
  }

  // ── NRFI / YRFI branch — confidence from probability extremity ─
  // Confidence = 50 + |P - 0.5| × 100, clamped to NRFI_CONFIDENCE_CAP.
  //   P = 0.55 → 55%   (just over the pick threshold)
  //   P = 0.65 → 65%   (close to cap)
  //   P = 0.80 → 80% → clamped to NRFI_CONFIDENCE_CAP (typically 65)
  const distance_from_neutral = Math.abs(p_nrfi - 0.5);
  let natural_confidence = Math.min(
    NRFI_CONFIDENCE_CAP,
    50 + distance_from_neutral * 100
  );

  // Build the confidence cap from data-quality signals (existing logic
  // preserved). Fallback-driven picks already had a tighter ceiling;
  // unconfirmed-lineup/starter penalties still apply at t60_locked.
  let cap = NRFI_CONFIDENCE_CAP;
  if (used_fallback) {
    cap = Math.min(cap, NRFI_FALLBACK_CONFIDENCE_CAP);
  }
  // R-16J Step 1.6 — offense-tier cap penalty. Acknowledges fallback-
  // hierarchy data quality without forcing a pick: the WORSE of the
  // two sides' tiers governs (max penalty). Tier 1 and tier 2 contribute
  // 0 — only tier 3 / tier 4 actually pull the cap down.
  const offensePenalty = Math.max(
    offenseTierPenalty(homeTopOpsFallback.tier),
    offenseTierPenalty(awayTopOpsFallback.tier)
  );
  if (offensePenalty > 0) {
    cap -= offensePenalty;
  }
  const applyUnconfirmedPenalty = stage === "t60_locked";
  if (snapshot.data_quality.lineup_confirmed === false) {
    if (applyUnconfirmedPenalty) cap -= NRFI_UNCONFIRMED_CONFIDENCE_PENALTY;
    reason_codes.push("lineup_unconfirmed");
  }
  if (snapshot.data_quality.starter_confirmed === false) {
    if (applyUnconfirmedPenalty) cap -= NRFI_UNCONFIRMED_CONFIDENCE_PENALTY;
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
      lambda_raw,
      p_nrfi,
      p_yrfi,
    };
  }

  // Round confidence to 1 decimal for downstream display consistency.
  const rounded_confidence = Math.round(effective_confidence * 10) / 10;

  // R-16J Step 1 — back-compat: derive a threshold_zone label so
  // pre-R-16J consumers of `NrfiResult.threshold_zone` continue to
  // read a sensible value. Maps probability extremity to the old
  // strong/lean zone labels (strong = high confidence, lean = lower).
  const tz: NrfiThresholdZone =
    decisionKind === "nrfi"
      ? p_nrfi >= 0.65
        ? "strong_nrfi"
        : "lean_nrfi"
      : p_nrfi <= 0.35
        ? "strong_yrfi"
        : "lean_yrfi";
  const decisionBool = decisionKind === "nrfi" ? true : false;

  return {
    decision_kind: decisionKind,
    threshold_zone: tz,
    decision: decisionBool,
    confidence: rounded_confidence,
    expected_runs: expected_first_inning_runs,
    used_fallback_era: used_fallback,
    used_top_of_order_data,
    hold_reason: null,
    reason_codes,
    lambda_raw,
    p_nrfi,
    p_yrfi,
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
  const clampedHomeRaw = clamp(homeRunsRaw, PREDICTED_SCORE_MIN, PREDICTED_SCORE_MAX);
  const clampedAwayRaw = clamp(awayRunsRaw, PREDICTED_SCORE_MIN, PREDICTED_SCORE_MAX);
  const predicted_home_score = round1(clampedHomeRaw);
  const predicted_away_score = round1(clampedAwayRaw);
  const predicted_total = round1(predicted_home_score + predicted_away_score);

  // ── Pick logic ──────────────────────────────────────────────────
  //
  // Phase 4.2.C.1.R-4 — separation of raw-prediction layer from play-grade
  // layer. ML/O/U picks are now populated whenever data exists (starters
  // present, market line present for OU). Confidence keeps its baseline-50
  // lower bound from clamp(rawConfidence, 50, stageCap), and we no longer
  // null the side when confidence sits below HARD_CONFIDENCE_FLOOR.
  //
  // The HARD_CONFIDENCE_FLOOR check used to live HERE (it nulled both
  // picks below 51); after R-4 it lives only at the play-grade /
  // verdict layer (verdictDerivation.PLAYABLE_CONFIDENCE_FLOOR = 0.53),
  // which converts low-confidence picks to verdict=no_play without
  // erasing the underlying lean. NRFI's own toss-up architecture
  // remains untouched — it has its own zone-based handling.

  // Whether the ML/OU picks are eligible at all. Missing or scratched
  // starter → both picks held; NRFI is handled separately by
  // computeNrfi.
  const mlHeldByStarter =
    snapshot.home_starter === null ||
    snapshot.away_starter === null ||
    (snapshot.home_starter !== null && snapshot.home_starter.is_scratched) ||
    (snapshot.away_starter !== null && snapshot.away_starter.is_scratched);

  // ── R-14B — pre-compute dampening signals shared by ML and OU ──
  // These flags are evaluated once and reused for both branches. Each
  // flag defaults to false when the underlying data is missing.
  const market_line_available_for_flags =
    snapshot.market.listed_total !== null;
  const bullpenFallbackActive =
    snapshot.home_team.bullpen_era_proxy === null ||
    snapshot.away_team.bullpen_era_proxy === null;
  const morningUnconfirmed =
    stage === "morning_draft" || !snapshot.data_quality.lineup_confirmed;
  const lowGsThreshold = 5;
  const lowIpThreshold = 20;
  const relieverGpMin = 10;
  const relieverGsMax = 2;
  const homeGs = snapshot.home_starter?.season_games_started ?? null;
  const awayGs = snapshot.away_starter?.season_games_started ?? null;
  const homeIp = snapshot.home_starter?.season_innings_pitched ?? null;
  const awayIp = snapshot.away_starter?.season_innings_pitched ?? null;
  const homeGp = snapshot.home_starter?.season_games_pitched ?? null;
  const awayGp = snapshot.away_starter?.season_games_pitched ?? null;
  const homeLowGs = homeGs !== null && homeGs < lowGsThreshold;
  const awayLowGs = awayGs !== null && awayGs < lowGsThreshold;
  const homeLowIp = homeIp !== null && homeIp < lowIpThreshold;
  const awayLowIp = awayIp !== null && awayIp < lowIpThreshold;
  const homeRpAsSp =
    homeGp !== null &&
    homeGs !== null &&
    homeGp >= relieverGpMin &&
    homeGs <= relieverGsMax;
  const awayRpAsSp =
    awayGp !== null &&
    awayGs !== null &&
    awayGp >= relieverGpMin &&
    awayGs <= relieverGsMax;

  // Public-smoke alignment: heavy public tickets on a side AND tickets ~
  // money (flat split) AND model's pick is that same side. Threshold
  // mirrors the constants used by gradeDerivationService so the dampening
  // and the grade pipeline agree on what "smoke" looks like.
  const PUBLIC_SMOKE_BETS_THRESHOLD = 65;
  const PUBLIC_SMOKE_FLAT_GAP_MAX = 8;
  const sharp = snapshot.sharp;
  const homeIsPublicHeavySmoke =
    sharp !== null &&
    sharp.public_betting_pct_home !== null &&
    sharp.public_money_pct_home !== null &&
    sharp.public_betting_pct_home >= PUBLIC_SMOKE_BETS_THRESHOLD &&
    Math.abs(
      sharp.public_betting_pct_home - sharp.public_money_pct_home
    ) <= PUBLIC_SMOKE_FLAT_GAP_MAX;
  const awayIsPublicHeavySmoke =
    sharp !== null &&
    sharp.public_betting_pct_home !== null &&
    sharp.public_money_pct_home !== null &&
    // away splits derive from 100 - home for /splits data
    100 - sharp.public_betting_pct_home >= PUBLIC_SMOKE_BETS_THRESHOLD &&
    Math.abs(
      sharp.public_betting_pct_home - sharp.public_money_pct_home
    ) <= PUBLIC_SMOKE_FLAT_GAP_MAX;
  const noMlSplitData =
    sharp === null || sharp.public_betting_pct_home === null;
  const noTotalSplitData =
    sharp === null || sharp.public_betting_pct_over === null;
  const partialMarketCoverage = !market_line_available_for_flags;

  // ── ML ──────────────────────────────────────────────────────────
  let predicted_ml_winner: "home" | "away" | null = null;
  let ml_confidence: number | null = null;
  let ml_raw_confidence: number | null = null;
  let ml_dampening_penalty = 0;
  let ml_dampening_reasons: string[] = [];

  if (!mlHeldByStarter) {
    const runDiff = Math.abs(predicted_home_score - predicted_away_score);
    const eraGap = Math.abs(
      homeStarterFactor.factor - awayStarterFactor.factor
    );
    // Confidence formula: baseline 50 + run-difference bonus + ERA-gap
    // bonus. Pre-R-14 this was clamped to [50, stageCap]; R-14
    // replaced that flat clamp with soft/hard cap + linear compression.
    // R-14B adds a pre-compression dampening step that subtracts a
    // small per-flag penalty for low data quality and weak/conflicting
    // market context. Penalty defaults to 0 when no flag fires.
    const rawConfidence = 50 + 10 * runDiff + 5 * eraGap * 10;
    ml_raw_confidence = round1(rawConfidence);

    // Side selection uses the UNROUNDED clamped scores so that two games
    // displaying as "4.5–4.5" (rounded tie, true differential ~0.04)
    // still get a deterministic lean. True floating-point equality is
    // astronomically rare with continuous-factor pipelines; if it does
    // occur we fall back to "home" (homefield convention) so the
    // prediction layer never holds for an arithmetic coincidence.
    if (clampedHomeRaw > clampedAwayRaw) {
      predicted_ml_winner = "home";
    } else if (clampedAwayRaw > clampedHomeRaw) {
      predicted_ml_winner = "away";
    } else {
      predicted_ml_winner = "home"; // exact-tie tiebreak
    }

    // Build ML-specific flags now that the pick side is known.
    const publicSmokeAlignedWithPick =
      (predicted_ml_winner === "home" && homeIsPublicHeavySmoke) ||
      (predicted_ml_winner === "away" && awayIsPublicHeavySmoke);

    const mlFlags: DampeningFlags = {
      home_starter_low_gs: homeLowGs,
      away_starter_low_gs: awayLowGs,
      home_starter_low_ip: homeLowIp,
      away_starter_low_ip: awayLowIp,
      home_starter_reliever_as_starter: homeRpAsSp,
      away_starter_reliever_as_starter: awayRpAsSp,
      bullpen_fallback: bullpenFallbackActive,
      morning_unconfirmed: morningUnconfirmed,
      public_smoke_aligned_with_pick: publicSmokeAlignedWithPick,
      no_ml_split_data: noMlSplitData,
      partial_market_coverage: partialMarketCoverage,
      // OU-only flags — irrelevant for ML but must be defined.
      sharp_plus_ev_opposes_ou: false,
      no_total_split_data: false,
    };
    const damp = dampenRawConfidence(rawConfidence, mlFlags, "ml");
    ml_dampening_penalty = damp.penalty;
    ml_dampening_reasons = damp.reasons;
    const cappedConfidence = Math.max(
      50,
      compressConfidence(damp.dampened, STAGE_CONFIDENCE_CAPS_V2[stage])
    );
    ml_confidence = round1(cappedConfidence);
  }

  // ── O/U ─────────────────────────────────────────────────────────
  const market_line_available = snapshot.market.listed_total !== null;
  let predicted_ou_side: "over" | "under" | null = null;
  let ou_confidence: number | null = null;
  let ou_raw_confidence: number | null = null;
  let ou_dampening_penalty = 0;
  let ou_dampening_reasons: string[] = [];

  if (market_line_available && !mlHeldByStarter) {
    const marketLine = snapshot.market.listed_total!;
    // Side selection uses the UNROUNDED total (sum of clamped raw
    // scores) so a rounded-equal predicted_total vs market_line still
    // gets a deterministic lean. Exact equality is rare in practice
    // (line values are typically .5 or .0; raw totals carry decimals);
    // when it does occur the convention is to lean "under" (the safer
    // side on a true push).
    const totalRaw = clampedHomeRaw + clampedAwayRaw;
    if (totalRaw > marketLine) {
      predicted_ou_side = "over";
    } else if (totalRaw < marketLine) {
      predicted_ou_side = "under";
    } else {
      predicted_ou_side = "under"; // exact-tie tiebreak
    }
    const ouDiff = Math.abs(predicted_total - marketLine);
    // R-14: same compression treatment as ML. OU's natural raw range
    // is tighter (max ~85 even at 4-run total gaps), so the same
    // soft/slope/hard config works without overcompressing.
    const rawConfidence = 50 + 8 * ouDiff;
    ou_raw_confidence = round1(rawConfidence);

    const sharpEvOpposes =
      sharp !== null &&
      sharp.total_plus_ev_side !== null &&
      sharp.total_plus_ev_side !== predicted_ou_side;

    const ouFlags: DampeningFlags = {
      // ML-only flags must be defined but don't apply.
      home_starter_low_gs: false,
      away_starter_low_gs: false,
      home_starter_low_ip: false,
      away_starter_low_ip: false,
      home_starter_reliever_as_starter: false,
      away_starter_reliever_as_starter: false,
      bullpen_fallback: bullpenFallbackActive,
      morning_unconfirmed: morningUnconfirmed,
      public_smoke_aligned_with_pick: false,
      no_ml_split_data: false,
      partial_market_coverage: false,
      sharp_plus_ev_opposes_ou: sharpEvOpposes,
      no_total_split_data: noTotalSplitData,
    };
    const damp = dampenRawConfidence(rawConfidence, ouFlags, "ou");
    ou_dampening_penalty = damp.penalty;
    ou_dampening_reasons = damp.reasons;
    const cappedConfidence = Math.max(
      50,
      compressConfidence(damp.dampened, STAGE_CONFIDENCE_CAPS_V2[stage])
    );
    ou_confidence = round1(cappedConfidence);
  }

  // ── NRFI ────────────────────────────────────────────────────────
  const nrfi = computeNrfi(snapshot, stage);
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
  //
  // Phase 4.2.C.1.R-4 — `hold_picks` now reflects data-missing holds
  // only (not low-confidence holds). NRFI keeps its existing zone-based
  // hold semantics (`predicted_nrfi === null` covers both "thin data"
  // and the Toss-Up zone — see Phase 4D.1).
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
    else if (!market_line_available) hold_reason = "no_market_line";
    else if (nrfi.hold_reason !== null) hold_reason = nrfi.hold_reason;
    else hold_reason = "data_incomplete";
  }

  // First-inning + top-order detail persisted for FI Key Stats UI
  // (added 2026-06-02). The model already loads these into the
  // StarterSnapshot and uses them inside nrfiPick; we just expose them
  // so the formatter can render real FI-specific Key Stats instead of
  // the full-season ERA fallback. Top-of-order OPS is recomputed here
  // using the same handednessAwareTopOps() helper nrfiPick uses, so the
  // displayed value matches what the model actually consumed (home
  // batters face the AWAY starter's throws, and vice versa).
  const homeTopOrderForAuto = snapshot.home_starter && snapshot.away_starter
    ? handednessAwareTopOps(
        snapshot.home_lineup_top8,
        snapshot.away_starter.throws
      ).value
    : null;
  const awayTopOrderForAuto = snapshot.home_starter && snapshot.away_starter
    ? handednessAwareTopOps(
        snapshot.away_lineup_top8,
        snapshot.home_starter.throws
      ).value
    : null;

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
    // ── New FI Key Stats fields (additive, all optional) ──────────
    home_first_inning_era: snapshot.home_starter?.first_inning_era ?? null,
    away_first_inning_era: snapshot.away_starter?.first_inning_era ?? null,
    home_first_inning_starts: snapshot.home_starter?.first_inning_starts ?? null,
    away_first_inning_starts: snapshot.away_starter?.first_inning_starts ?? null,
    home_first_inning_whip: snapshot.home_starter?.first_inning_whip ?? null,
    away_first_inning_whip: snapshot.away_starter?.first_inning_whip ?? null,
    home_top_order_ops:
      homeTopOrderForAuto !== null
        ? round1(homeTopOrderForAuto * 1000) / 1000
        : null,
    away_top_order_ops:
      awayTopOrderForAuto !== null
        ? round1(awayTopOrderForAuto * 1000) / 1000
        : null,
    home_starter_throws: snapshot.home_starter?.throws ?? null,
    away_starter_throws: snapshot.away_starter?.throws ?? null,
    // ── R-14B dampening diagnostics ──────────────────────────────
    ml_raw_confidence,
    ml_dampening_penalty,
    ml_dampening_reasons,
    ou_raw_confidence,
    ou_dampening_penalty,
    ou_dampening_reasons,
    // ── R-16J Step 1 — input shrinkage + FI calibration ─────────
    home_starter_era_shrinkage_weight:
      Math.round(homeStarterFactor.shrinkage_weight * 1000) / 1000,
    away_starter_era_shrinkage_weight:
      Math.round(awayStarterFactor.shrinkage_weight * 1000) / 1000,
    nrfi_lambda_raw:
      nrfi.lambda_raw !== null && nrfi.lambda_raw !== undefined
        ? round1(nrfi.lambda_raw * 100) / 100
        : null,
    nrfi_baseline_calibration: FI_BASELINE_CALIBRATION,
    nrfi_probability:
      nrfi.p_nrfi !== null && nrfi.p_nrfi !== undefined
        ? Math.round(nrfi.p_nrfi * 1000) / 1000
        : null,
    yrfi_probability:
      nrfi.p_yrfi !== null && nrfi.p_yrfi !== undefined
        ? Math.round(nrfi.p_yrfi * 1000) / 1000
        : null,
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
