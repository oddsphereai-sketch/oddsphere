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
  NRFI_THRESHOLD_HIGH,
  NRFI_THRESHOLD_LOW,
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

function parkMultiplier(park: ParkSnapshot | null): number {
  if (park === null || park.park_factor_runs === null) return 1.0;
  return park.park_factor_runs;
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
// NRFI / YRFI / no-play — blended logic
// ─────────────────────────────────────────────────────────────

type NrfiResult = {
  decision: boolean | null;
  confidence: number | null;
  expected_runs: number | null;
  used_fallback_era: boolean;
  used_top_of_order_data: boolean;
  hold_reason: string | null;
};

function topOfOrderOps(lineup: BatterSnapshot[]): number | null {
  const top3 = lineup.filter(
    (b) =>
      b.batting_position !== null &&
      b.batting_position >= 1 &&
      b.batting_position <= 3
  );
  if (top3.length < 2) return null;
  const opsValues = top3
    .map((b) => b.season_ops)
    .filter((v): v is number => v !== null);
  if (opsValues.length < 2) return null;
  return opsValues.reduce((sum, v) => sum + v, 0) / opsValues.length;
}

function computeNrfi(snapshot: GameSnapshot): NrfiResult {
  const home_starter = snapshot.home_starter;
  const away_starter = snapshot.away_starter;

  // Missing/scratched starter → hold
  if (home_starter === null || away_starter === null) {
    return {
      decision: null,
      confidence: null,
      expected_runs: null,
      used_fallback_era: false,
      used_top_of_order_data: false,
      hold_reason: "missing_starter_nrfi",
    };
  }
  if (home_starter.is_scratched || away_starter.is_scratched) {
    return {
      decision: null,
      confidence: null,
      expected_runs: null,
      used_fallback_era: false,
      used_top_of_order_data: false,
      hold_reason: "starter_scratch_nrfi",
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
      decision: null,
      confidence: null,
      expected_runs: null,
      used_fallback_era: false,
      used_top_of_order_data: false,
      hold_reason: "missing_starter_era_nrfi",
    };
  }

  // Top-of-order OPS strength per side
  const homeTopOps = topOfOrderOps(snapshot.home_lineup_top8);
  const awayTopOps = topOfOrderOps(snapshot.away_lineup_top8);
  const used_top_of_order_data = homeTopOps !== null || awayTopOps !== null;

  // Hold rule: if BOTH starters use fallback ERA AND no top-of-order
  // data → too thin to render an NRFI verdict.
  if (used_fallback && !used_top_of_order_data) {
    return {
      decision: null,
      confidence: null,
      expected_runs: null,
      used_fallback_era: true,
      used_top_of_order_data: false,
      hold_reason: "thin_nrfi_data",
    };
  }

  // Compute expected first-inning runs per side. Away scores against
  // home starter; home scores against away starter.
  const homeOffenseFactor =
    homeTopOps !== null ? homeTopOps / LEAGUE_CONSTANTS_V1.AVG_OPS : 1.0;
  const awayOffenseFactor =
    awayTopOps !== null ? awayTopOps / LEAGUE_CONSTANTS_V1.AVG_OPS : 1.0;

  // ERA is per 9 IP; first inning is 1/9.
  const expectedAwayRuns = (homeFirstInning / 9) * awayOffenseFactor;
  const expectedHomeRuns = (awayFirstInning / 9) * homeOffenseFactor;
  const expected_first_inning_runs = expectedAwayRuns + expectedHomeRuns;

  // Decision
  if (expected_first_inning_runs <= NRFI_THRESHOLD_LOW) {
    // NRFI
    const strength = (NRFI_THRESHOLD_LOW - expected_first_inning_runs) / 0.1;
    const confidence = clamp(
      50 + 15 * Math.min(strength, 1),
      50,
      NRFI_CONFIDENCE_CAP
    );
    return {
      decision: confidence >= HARD_CONFIDENCE_FLOOR ? true : null,
      confidence: confidence >= HARD_CONFIDENCE_FLOOR ? confidence : null,
      expected_runs: expected_first_inning_runs,
      used_fallback_era: used_fallback,
      used_top_of_order_data,
      hold_reason: null,
    };
  }

  if (expected_first_inning_runs >= NRFI_THRESHOLD_HIGH) {
    // YRFI
    const strength = (expected_first_inning_runs - NRFI_THRESHOLD_HIGH) / 0.1;
    const confidence = clamp(
      50 + 15 * Math.min(strength, 1),
      50,
      NRFI_CONFIDENCE_CAP
    );
    return {
      decision: confidence >= HARD_CONFIDENCE_FLOOR ? false : null,
      confidence: confidence >= HARD_CONFIDENCE_FLOOR ? confidence : null,
      expected_runs: expected_first_inning_runs,
      used_fallback_era: used_fallback,
      used_top_of_order_data,
      hold_reason: null,
    };
  }

  // In the no-play zone (between thresholds)
  return {
    decision: null,
    confidence: null,
    expected_runs: expected_first_inning_runs,
    used_fallback_era: used_fallback,
    used_top_of_order_data,
    hold_reason: null, // not held — just no-play
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
