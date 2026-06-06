/**
 * Phase 6B V2.1 — Layered prediction-integrity model.
 *
 * Replaces V2's run-share-inverse heuristic with a real probability engine
 * and separates the four conceptual layers:
 *
 *   Layer 1 — Market Baseline       (computeMarketBaseline)
 *   Layer 2 — Independent Projection (V1's per-team scores as today's
 *             interim; documented upgrade path to wRC+ / FIP / xFIP /
 *             SIERA-style projection in Phase V2.2)
 *   Layer 3 — Posterior Blend        (adaptive trust coefficient by tier)
 *   Layer 4 — Market Read            (snapshot.sharp data — pinnacle EV,
 *             public splits; full line-history reader in Phase V2.3)
 *
 * Probability Engine: Poisson on unrounded posterior expected runs.
 * Eliminates the V2.0 issue where 1-decimal score rounding produced
 * spurious ML ties.
 *
 * Output Integrity:
 *   - ML pick produced whenever ML market baseline (no-vig prob) exists.
 *   - O/U pick produced whenever listed_total exists.
 *   - Holds reserved for missing/unsafe market data.
 *   - Provisional flag + capped confidence for data-limited games.
 *   - Play Grade separate from prediction confidence.
 *
 * Pure module: no DB, no env reads. All knobs are exported constants.
 */

import type { GameSnapshot, AutoModelOutput, ModelStage } from "./types";
import { computeMarketBaseline, type MarketBaseline } from "./marketPrior";
import {
  homeWinProbabilityPoisson,
  overProbabilityPoisson,
  homeMinus1_5Probability,
  awayPlus1_5Probability,
  expectedValuePerDollar,
} from "./runDistribution";
import {
  computePlayGrade,
  type PlayGrade,
  type PredictionType,
  BEST_ANGLE_MIN_EDGE_PCT_ML,
  BEST_ANGLE_MIN_EDGE_PCT_OU,
  BEST_ANGLE_MIN_CONFIDENCE_PCT,
} from "./playGrade";

// ─── V2.1 tunable knobs ──────────────────────────────────────────────────

/**
 * Adaptive trust coefficient by data-quality tier. Replaces V2's single
 * RESIDUAL_TRUST_COEF=0.6.
 *
 * Rationale:
 *   - High tier: confirmed starter + lineup + market complete → trust V1
 *     residual more (still partial — V1 itself has compression).
 *   - Medium: missing starter or weak market → shrink toward market prior.
 *   - Low: both starters missing → mostly market prior.
 *   - Fallback: market data missing entirely → independent only, marked
 *     provisional.
 *
 * V2.2 will replace this constant table with backtest-tuned weights per
 * feature-missingness pattern. For V2.1 launch, conservative starts:
 */
export const V21_TRUST_COEF_HIGH = 0.55;
export const V21_TRUST_COEF_MEDIUM = 0.35;
export const V21_TRUST_COEF_LOW = 0.25;
export const V21_TRUST_COEF_FALLBACK = 1.0; // no market → all independent

/**
 * Cap on per-team residual movement from market baseline. Wider than V2's
 * 2.5r because the residual itself is being trusted more — but in practice
 * still rarely binds.
 */
export const V21_RESIDUAL_CAP_RUNS = 3.0;

/**
 * Confidence ceilings by data-quality tier.
 */
export const V21_CONF_FLOOR = 50;
export const V21_CONF_CEIL_HIGH = 78;
export const V21_CONF_CEIL_MEDIUM = 60;
export const V21_CONF_CEIL_LOW = 56;
export const V21_CONF_CEIL_FALLBACK = 54;

// ─── V2.1 output ─────────────────────────────────────────────────────────

export interface V21Output {
  game_external_id: number;
  prediction_source: "auto_v2_1_mlb_layered";
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  predicted_ml_winner: "home" | "away" | null;
  ml_confidence: number | null;
  predicted_ou_side: "over" | "under" | null;
  ou_confidence: number | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  v21Audit: V21Audit;
}

export interface V21Audit {
  // Layer 1 — Market Baseline
  marketBaseline: MarketBaseline;
  market_home_runs: number | null;
  market_away_runs: number | null;
  market_total: number | null;
  market_home_win_prob: number | null;
  market_away_win_prob: number | null;
  market_source_quality: "ok" | "degraded" | "missing";
  market_baseline_valid: boolean;
  // Layer 2 — Independent Baseball
  independent_home_runs: number | null;
  independent_away_runs: number | null;
  independent_total: number | null;
  independent_data_quality: "high" | "medium" | "low" | "fallback";
  feature_missingness: string[];
  independent_reason_codes: string[];
  // Layer 3 — Posterior Blend
  trust_coef: number;
  residual_home_raw: number | null;
  residual_away_raw: number | null;
  residual_home_applied: number | null;
  residual_away_applied: number | null;
  cap_active_home: boolean;
  cap_active_away: boolean;
  posterior_home_runs: number | null;
  posterior_away_runs: number | null;
  // Layer 4 — Market Read (Phase V2.1 minimal — uses snapshot.sharp)
  market_read_summary: MarketReadSummary;
  // Probability Engine
  ml_model_prob: number | null;
  ml_market_prob: number | null;
  ml_edge_pct: number | null;
  ou_model_prob: number | null;
  ou_edge_runs: number | null;
  home_minus_1_5_prob: number | null;
  away_plus_1_5_prob: number | null;
  // Decision artifacts
  data_quality_tier: "high" | "medium" | "low" | "fallback";
  provisional: boolean;
  ml_play_grade: PlayGrade;
  ou_play_grade: PlayGrade;
  ml_prediction_type: PredictionType;
  ou_prediction_type: PredictionType;
  ml_ev_pct: number | null;
  ou_ev_pct: number | null;
  best_angle_eligible_ml: boolean;
  best_angle_eligible_ou: boolean;
  ml_best_angle_reason: string | null;
  ou_best_angle_reason: string | null;
  ml_no_bet_reason: string | null;
  ou_no_bet_reason: string | null;
  ml_market_aligned: boolean;
  ou_market_aligned: boolean;
  model_integrity_notes: string[];
}

export interface MarketReadSummary {
  pinnacle_ml_ev_pct: number | null;
  pinnacle_total_ev_pct: number | null;
  public_betting_pct_home: number | null;
  public_money_pct_over: number | null;
  market_read_ml_side: "home" | "away" | "neutral";
  market_read_ou_side: "over" | "under" | "neutral";
  market_disagreement_ml: boolean;
  market_disagreement_ou: boolean;
}

// ─── Entry point ─────────────────────────────────────────────────────────

export function runMlbAutoModelV2_1(
  snapshot: GameSnapshot,
  v1Output: AutoModelOutput,
  _stage: ModelStage,
): V21Output {
  const integrityNotes: string[] = [];
  const baseline = computeMarketBaseline(snapshot.market, snapshot.sharp);

  // ── Layer 1: Market Baseline ────────────────────────────────────────
  const market_baseline_valid =
    baseline.dataQuality !== "missing" && baseline.listedTotal !== null;
  const market_home_runs = baseline.homeImpliedTotal;
  const market_away_runs = baseline.awayImpliedTotal;
  const market_total = baseline.listedTotal;
  const market_home_win_prob = baseline.homeNoVigProb;
  const market_away_win_prob = baseline.awayNoVigProb;
  const market_source_quality = baseline.dataQuality;

  // ── Layer 2: Independent Baseball Projection ────────────────────────
  // V2.1 bridge: V1's per-team scores act as the independent projection.
  // Documented in module header; V2.2 replaces this with rich-feature model.
  const featureMissingness: string[] = [];
  const independentReasonCodes: string[] = ["v1_independent_projection_bridge"];
  if (snapshot.home_starter === null) featureMissingness.push("home_starter");
  if (snapshot.away_starter === null) featureMissingness.push("away_starter");
  if (!snapshot.data_quality.lineup_confirmed) featureMissingness.push("lineup_not_confirmed");
  if (!snapshot.data_quality.season_stats_present) featureMissingness.push("season_stats_partial");
  if (!snapshot.data_quality.weather_available) featureMissingness.push("weather_unavailable");

  const independent_home_runs = v1Output.predicted_home_score;
  const independent_away_runs = v1Output.predicted_away_score;
  const independent_total = v1Output.predicted_total;

  // ── Data-quality tier ───────────────────────────────────────────────
  const dq = assessV21DataQuality(snapshot, baseline);
  const independent_data_quality = dq.tier;

  // ── Layer 3: Posterior Blend (adaptive trust) ───────────────────────
  const trustCoef = trustCoefForTier(dq.tier);

  let posteriorHomeUnrounded: number | null = null;
  let posteriorAwayUnrounded: number | null = null;
  let residual_home_raw: number | null = null;
  let residual_away_raw: number | null = null;
  let residual_home_applied: number | null = null;
  let residual_away_applied: number | null = null;
  let cap_active_home = false;
  let cap_active_away = false;

  if (dq.tier === "fallback") {
    // No market baseline. Independent projection IS the prediction.
    posteriorHomeUnrounded = independent_home_runs;
    posteriorAwayUnrounded = independent_away_runs;
    integrityNotes.push("Fallback path: no market baseline. Predictions = V1 independent. Provisional.");
  } else if (market_home_runs !== null && market_away_runs !== null) {
    // Normal path: posterior = market + trust * (independent - market)
    if (independent_home_runs !== null && independent_away_runs !== null) {
      residual_home_raw = independent_home_runs - market_home_runs;
      residual_away_raw = independent_away_runs - market_away_runs;
      const scaledHome = residual_home_raw * trustCoef;
      const scaledAway = residual_away_raw * trustCoef;
      residual_home_applied = clamp(scaledHome, -V21_RESIDUAL_CAP_RUNS, V21_RESIDUAL_CAP_RUNS);
      residual_away_applied = clamp(scaledAway, -V21_RESIDUAL_CAP_RUNS, V21_RESIDUAL_CAP_RUNS);
      cap_active_home = Math.abs(scaledHome) > V21_RESIDUAL_CAP_RUNS;
      cap_active_away = Math.abs(scaledAway) > V21_RESIDUAL_CAP_RUNS;
      posteriorHomeUnrounded = market_home_runs + residual_home_applied;
      posteriorAwayUnrounded = market_away_runs + residual_away_applied;
      if (cap_active_home) integrityNotes.push(`Cap active: home residual ${scaledHome.toFixed(2)} clamped to ±${V21_RESIDUAL_CAP_RUNS}r.`);
      if (cap_active_away) integrityNotes.push(`Cap active: away residual ${scaledAway.toFixed(2)} clamped to ±${V21_RESIDUAL_CAP_RUNS}r.`);
    } else {
      // V1 produced null scores (rare): use market baseline directly.
      posteriorHomeUnrounded = market_home_runs;
      posteriorAwayUnrounded = market_away_runs;
      integrityNotes.push("V1 null scores; posterior = market_baseline (residual=0).");
    }
  }

  // ── Layer 4: Market Read (minimal V2.1) ─────────────────────────────
  const marketRead = summarizeMarketRead(snapshot);

  // ── Probability Engine: Poisson on unrounded posteriors ─────────────
  let mlModelProb: number | null = null;
  let mlMarketProb: number | null = null;
  let mlEdgePct: number | null = null;
  let ouModelProb: number | null = null;
  let ouEdgeRuns: number | null = null;
  let homeMinus1_5Prob: number | null = null;
  let awayPlus1_5Prob: number | null = null;

  if (posteriorHomeUnrounded !== null && posteriorAwayUnrounded !== null) {
    mlModelProb = homeWinProbabilityPoisson(posteriorHomeUnrounded, posteriorAwayUnrounded);
    if (market_home_win_prob !== null) {
      mlMarketProb = market_home_win_prob;
      // Edge expressed against HOME side; for picking the side, we'll flip.
    }
    if (market_total !== null) {
      ouModelProb = overProbabilityPoisson(posteriorHomeUnrounded, posteriorAwayUnrounded, market_total);
      ouEdgeRuns = round1((posteriorHomeUnrounded + posteriorAwayUnrounded) - market_total);
    }
    homeMinus1_5Prob = homeMinus1_5Probability(posteriorHomeUnrounded, posteriorAwayUnrounded);
    awayPlus1_5Prob = awayPlus1_5Probability(posteriorHomeUnrounded, posteriorAwayUnrounded);
  }

  // ── ML pick decision: from probabilities, NOT from rounded scores ───
  let predicted_ml_winner: "home" | "away" | null = null;
  let ml_confidence: number | null = null;
  let ml_play_grade: PlayGrade = "hold";
  let ml_prediction_type: PredictionType = null;
  let ml_ev_pct: number | null = null;
  let best_angle_eligible_ml = false;
  let ml_best_angle_reason: string | null = null;
  let ml_no_bet_reason: string | null = null;
  let ml_market_aligned = false;
  if (mlModelProb !== null && market_baseline_valid && market_home_win_prob !== null) {
    predicted_ml_winner = mlModelProb >= 0.5 ? "home" : "away";
    const pickModelProb = predicted_ml_winner === "home" ? mlModelProb : 1 - mlModelProb;
    const pickMarketProb = predicted_ml_winner === "home" ? market_home_win_prob : (1 - market_home_win_prob);
    mlEdgePct = round1((pickModelProb - pickMarketProb) * 100);
    const pickOdds = predicted_ml_winner === "home"
      ? snapshot.market.home_ml_odds_american
      : snapshot.market.away_ml_odds_american;
    if (pickOdds !== null) {
      ml_ev_pct = round1(expectedValuePerDollar(pickModelProb, pickOdds) * 100);
    }
    // Confidence = model probability as a percentage (capped by tier).
    const confCeil = confCeilForTier(dq.tier);
    ml_confidence = round1(clamp(pickModelProb * 100, V21_CONF_FLOOR, confCeil));
    const gradeRes = computePlayGrade({
      modelProb: pickModelProb,
      marketProb: pickMarketProb,
      americanOdds: pickOdds,
      dataQualityTier: dq.tier,
      provisional: dq.provisional,
      isHeld: false,
      minBestAngleEdgePct: BEST_ANGLE_MIN_EDGE_PCT_ML,
      minBestAngleConfidencePct: BEST_ANGLE_MIN_CONFIDENCE_PCT,
      sharpAgreement: sharpAgreementForMl(marketRead, predicted_ml_winner),
    });
    ml_play_grade = gradeRes.grade;
    ml_prediction_type = gradeRes.predictionType;
    best_angle_eligible_ml = gradeRes.grade === "best_angle";
    ml_best_angle_reason = gradeRes.bestAngleReason;
    ml_no_bet_reason = gradeRes.noBetReason;
    ml_market_aligned = gradeRes.marketAligned;
  } else if (!market_baseline_valid) {
    ml_play_grade = "hold";
    ml_no_bet_reason = "ML market baseline missing or invalid.";
    integrityNotes.push("ML held: market baseline missing or invalid.");
  }

  // ── O/U pick decision: from over probability ───────────────────────
  let predicted_ou_side: "over" | "under" | null = null;
  let ou_confidence: number | null = null;
  let ou_play_grade: PlayGrade = "hold";
  let ou_prediction_type: PredictionType = null;
  let ou_ev_pct: number | null = null;
  let best_angle_eligible_ou = false;
  let ou_best_angle_reason: string | null = null;
  let ou_no_bet_reason: string | null = null;
  let ou_market_aligned = false;
  if (ouModelProb !== null && market_total !== null) {
    predicted_ou_side = ouModelProb >= 0.5 ? "over" : "under";
    const pickModelProb = predicted_ou_side === "over" ? ouModelProb : 1 - ouModelProb;
    // Approximate market O/U prob from listed total at -110/-110 fair (0.5).
    // Until we ingest O/U odds, the higher 3% edge threshold compensates.
    const pickMarketProb = 0.5;
    const confCeil = confCeilForTier(dq.tier);
    ou_confidence = round1(clamp(pickModelProb * 100, V21_CONF_FLOOR, confCeil));
    ou_ev_pct = round1(expectedValuePerDollar(pickModelProb, -110) * 100);
    const gradeRes = computePlayGrade({
      modelProb: pickModelProb,
      marketProb: pickMarketProb,
      americanOdds: -110,
      dataQualityTier: dq.tier,
      provisional: dq.provisional,
      isHeld: false,
      minBestAngleEdgePct: BEST_ANGLE_MIN_EDGE_PCT_OU,
      minBestAngleConfidencePct: BEST_ANGLE_MIN_CONFIDENCE_PCT,
      sharpAgreement: sharpAgreementForOu(marketRead, predicted_ou_side),
    });
    ou_play_grade = gradeRes.grade;
    ou_prediction_type = gradeRes.predictionType;
    best_angle_eligible_ou = gradeRes.grade === "best_angle";
    ou_best_angle_reason = gradeRes.bestAngleReason;
    ou_no_bet_reason = gradeRes.noBetReason;
    ou_market_aligned = gradeRes.marketAligned;
  } else if (market_total === null) {
    ou_play_grade = "hold";
    ou_no_bet_reason = "O/U market baseline missing (no listed_total).";
    integrityNotes.push("O/U held: listed_total missing.");
  }

  if (ml_prediction_type === "best_angle" || ou_prediction_type === "best_angle") {
    integrityNotes.push("OU Best Angle uses fair-line approximation (no OU odds ingested); threshold raised to 3.0% to compensate. Recalibrate when OU odds land.");
  }

  // ── Rounded outputs for game_predictions ───────────────────────────
  const predicted_home_score = posteriorHomeUnrounded !== null ? round1(posteriorHomeUnrounded) : null;
  const predicted_away_score = posteriorAwayUnrounded !== null ? round1(posteriorAwayUnrounded) : null;
  const predicted_total = (predicted_home_score !== null && predicted_away_score !== null)
    ? round1(predicted_home_score + predicted_away_score) : null;

  return {
    game_external_id: v1Output.game_external_id,
    prediction_source: "auto_v2_1_mlb_layered",
    predicted_home_score,
    predicted_away_score,
    predicted_total,
    predicted_ml_winner,
    ml_confidence,
    predicted_ou_side,
    ou_confidence,
    predicted_nrfi: v1Output.predicted_nrfi,
    nrfi_confidence: v1Output.nrfi_confidence,
    v21Audit: {
      marketBaseline: baseline,
      market_home_runs,
      market_away_runs,
      market_total,
      market_home_win_prob,
      market_away_win_prob,
      market_source_quality,
      market_baseline_valid,
      independent_home_runs,
      independent_away_runs,
      independent_total,
      independent_data_quality,
      feature_missingness: featureMissingness,
      independent_reason_codes: independentReasonCodes,
      trust_coef: trustCoef,
      residual_home_raw,
      residual_away_raw,
      residual_home_applied,
      residual_away_applied,
      cap_active_home,
      cap_active_away,
      posterior_home_runs: posteriorHomeUnrounded,
      posterior_away_runs: posteriorAwayUnrounded,
      market_read_summary: marketRead,
      ml_model_prob: mlModelProb,
      ml_market_prob: mlMarketProb,
      ml_edge_pct: mlEdgePct,
      ou_model_prob: ouModelProb,
      ou_edge_runs: ouEdgeRuns,
      home_minus_1_5_prob: homeMinus1_5Prob,
      away_plus_1_5_prob: awayPlus1_5Prob,
      data_quality_tier: dq.tier,
      provisional: dq.provisional,
      ml_play_grade,
      ou_play_grade,
      ml_prediction_type,
      ou_prediction_type,
      ml_ev_pct,
      ou_ev_pct,
      best_angle_eligible_ml,
      best_angle_eligible_ou,
      ml_best_angle_reason,
      ou_best_angle_reason,
      ml_no_bet_reason,
      ou_no_bet_reason,
      ml_market_aligned,
      ou_market_aligned,
      model_integrity_notes: integrityNotes,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function assessV21DataQuality(snapshot: GameSnapshot, baseline: MarketBaseline): {
  tier: "high" | "medium" | "low" | "fallback";
  provisional: boolean;
} {
  if (baseline.dataQuality === "missing") {
    return { tier: "fallback", provisional: true };
  }
  let score = 100;
  const homeMiss = snapshot.home_starter === null;
  const awayMiss = snapshot.away_starter === null;
  if (homeMiss) score -= 25;
  if (awayMiss) score -= 25;
  if (!snapshot.data_quality.lineup_confirmed) score -= 8;
  if (!snapshot.data_quality.season_stats_present) score -= 5;
  if (baseline.dataQuality === "degraded") score -= 15;
  let tier: "high" | "medium" | "low" | "fallback";
  if (score >= 85) tier = "high";
  else if (score >= 55) tier = "medium";
  else tier = "low";
  const provisional = tier !== "high" || baseline.dataQuality === "degraded";
  return { tier, provisional };
}

function trustCoefForTier(tier: "high" | "medium" | "low" | "fallback"): number {
  switch (tier) {
    case "high": return V21_TRUST_COEF_HIGH;
    case "medium": return V21_TRUST_COEF_MEDIUM;
    case "low": return V21_TRUST_COEF_LOW;
    case "fallback": return V21_TRUST_COEF_FALLBACK;
  }
}

function confCeilForTier(tier: "high" | "medium" | "low" | "fallback"): number {
  switch (tier) {
    case "high": return V21_CONF_CEIL_HIGH;
    case "medium": return V21_CONF_CEIL_MEDIUM;
    case "low": return V21_CONF_CEIL_LOW;
    case "fallback": return V21_CONF_CEIL_FALLBACK;
  }
}

function summarizeMarketRead(snapshot: GameSnapshot): MarketReadSummary {
  const sharp = snapshot.sharp;
  const mlEv = sharp?.pinnacle_ml_ev_pct ?? null;
  const totalEv = sharp?.pinnacle_total_ev_pct ?? null;
  const betPctHome = sharp?.public_betting_pct_home ?? null;
  const moneyPctOver = sharp?.public_money_pct_over ?? null;
  return {
    pinnacle_ml_ev_pct: mlEv,
    pinnacle_total_ev_pct: totalEv,
    public_betting_pct_home: betPctHome,
    public_money_pct_over: moneyPctOver,
    market_read_ml_side: "neutral",
    market_read_ou_side: "neutral",
    market_disagreement_ml: false,
    market_disagreement_ou: false,
  };
}

function sharpAgreementForMl(
  _marketRead: MarketReadSummary,
  _pick: "home" | "away",
): "agrees" | "opposes" | "neutral" {
  // V2.1 minimal: neutral by default. V2.3 wires this to real signals.
  return "neutral";
}

function sharpAgreementForOu(
  _marketRead: MarketReadSummary,
  _pick: "over" | "under",
): "agrees" | "opposes" | "neutral" {
  return "neutral";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
