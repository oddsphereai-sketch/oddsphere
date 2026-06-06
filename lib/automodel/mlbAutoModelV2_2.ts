/**
 * Push 3A — MLB V2.2 Full-Game Projection Model (assembly).
 *
 * Four layers:
 *   Layer 1  computeMarketBaseline   (existing, market prior)
 *   Layer 2  projectIndependent      (NEW — Push 3A clean baseball model)
 *   Layer 3  blendPosterior          (NEW — adaptive trust)
 *   Layer 4  runDistribution         (existing — Poisson/Skellam engine)
 *   Layer 5  Play Grade              (existing — reused from V2.1)
 *
 * Compatibility with V2.1:
 *   - Output shape mirrors AutoModelOutput so the writer + admin/tracking
 *     layers don't need changes.
 *   - prediction_source stays "auto_v1_mlb_rules" for downstream filters.
 *   - sport_specific stores the truth: model_used="v2_2",
 *     model_version="auto_v2.2_mlb_full_game_projection".
 *   - V1 fallback path on any uncaught error.
 *
 * Selection:
 *   - V2.2 only runs when automodelService chooses it (via `--model
 *     v2_2` operator flag OR AUTOMODEL_VERSION=v2_2 env). Default
 *     production cron stays V1 until V2.2 is proven via shadow + the
 *     operator flips the env explicitly.
 *
 * Honest no-bet behavior:
 *   - The model produces a pick + confidence even when play_grade
 *     ends up "no_bet". Members may still see the projection as a
 *     "lean" or "market_aligned" in tracking; the no_bet_reason
 *     surfaces in the admin row + the no-bet records get separated
 *     in the tracking aggregate for calibration only.
 */

import { computeMarketBaseline } from "./marketPrior";
import { projectIndependent } from "./mlbIndependentProjection";
import {
  blendPosterior,
  computeConfidence,
} from "./mlbV22PosteriorBlend";
import {
  homeWinProbabilityPoisson,
  overProbabilityPoisson,
  expectedValuePerDollar,
  probabilityToAmericanOdds,
} from "./runDistribution";
import { computePlayGrade } from "./playGrade";
import type { AutoModelOutput, GameSnapshot, ModelStage } from "./types";
import { MODEL_VERSION_V2_2 } from "./types";

/**
 * V2.2 audit object stored under sport_specific.v2_2_audit.
 */
export type V22Audit = {
  // Layer 1
  market_total: number | null;
  market_home_win_prob: number | null;
  market_away_win_prob: number | null;
  market_baseline_valid: boolean;
  market_source_quality: string;
  // Layer 2
  independent_away_runs: number;
  independent_home_runs: number;
  independent_total: number;
  independent_home_diff: number;
  data_quality_tier: "high" | "medium" | "low" | "fallback";
  feature_present_count: number;
  feature_missing_count: number;
  // Layer 3
  posterior_away_runs: number;
  posterior_home_runs: number;
  posterior_total: number;
  posterior_home_diff: number;
  trust_independent: number;
  posterior_moved_runs_from_market: number;
  capped_by_total: boolean;
  capped_by_diff: boolean;
  // Layer 4
  ml_model_prob: number;
  ml_market_prob: number | null;
  ml_edge_pct: number;
  ou_model_prob: number;
  ou_market_prob: number;
  ou_edge_pct: number;
  // Layer 5
  ml_play_grade: string;
  ou_play_grade: string;
  ml_prediction_type: string | null;
  ou_prediction_type: string | null;
  ml_best_angle_eligible: boolean;
  ou_best_angle_eligible: boolean;
  ml_no_bet_reason: string | null;
  ou_no_bet_reason: string | null;
  ml_market_aligned: boolean;
  ou_market_aligned: boolean;
  ml_best_angle_reason: string | null;
  ou_best_angle_reason: string | null;
  model_integrity_notes: string[];
  provisional: boolean;
};

export type V22Output = {
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_total: number;
  predicted_ml_winner: "home" | "away";
  ml_confidence: number;
  predicted_ou_side: "over" | "under";
  ou_confidence: number;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  v22Audit: V22Audit;
};

// Best Angle thresholds — V2.2 uses tighter gates than V2.1 since the
// independent projection has more freedom to move and we want only
// genuinely model-driven angles to flow through.
const V22_BEST_ANGLE_MIN_EDGE_PCT_ML = 3.0;
const V22_BEST_ANGLE_MIN_EDGE_PCT_OU = 3.5;
const V22_BEST_ANGLE_MIN_CONFIDENCE_PCT = 56;

/**
 * Run V2.2 for a single game. Pure function — no DB, no network.
 */
export function runMlbAutoModelV2_2(
  snap: GameSnapshot,
  v1Output: AutoModelOutput, // for NRFI passthrough and fallback
  stage: ModelStage,
): V22Output {
  void stage;
  const integrityNotes: string[] = [];

  // Layer 1 — market baseline
  const market = computeMarketBaseline(snap.market, snap.sharp ?? null);
  const marketValid = market.dataQuality === "ok";
  if (!marketValid) {
    integrityNotes.push(
      `Market baseline weak (${market.dataQuality}); falling back to independent + low trust.`,
    );
  }

  // Layer 2 — independent projection
  const indep = projectIndependent(snap);
  if (indep.feature_audit.missing_count >= 7) {
    integrityNotes.push(
      `Sparse features (${indep.feature_audit.missing_count} missing); model treated as provisional.`,
    );
  }
  if (indep.data_quality_tier === "fallback") {
    integrityNotes.push(
      "Insufficient starter data; projection treated as fallback tier.",
    );
  }

  // Layer 3 — adaptive blend
  const posterior = blendPosterior({
    market: marketValid ? market : null,
    independent: indep,
  });
  if (posterior.capped_by_total) {
    integrityNotes.push(
      `Posterior total capped (>${posterior.posterior_moved_runs_from_market.toFixed(1)}r from market).`,
    );
  }
  if (posterior.capped_by_diff) {
    integrityNotes.push("Posterior run differential capped vs market.");
  }

  // Layer 4 — probabilities from Poisson on unrounded posterior
  const mlHomeProb = homeWinProbabilityPoisson(
    posterior.away_expected_runs,
    posterior.home_expected_runs,
  );
  const mlAwayProb = 1 - mlHomeProb;
  const mlPickIsHome = mlHomeProb >= 0.5;
  const mlMarketProb = marketValid && market.homeNoVigProb !== null
    ? mlPickIsHome ? market.homeNoVigProb : (1 - market.homeNoVigProb)
    : null;
  const mlModelProb = mlPickIsHome ? mlHomeProb : mlAwayProb;
  const mlEdgePct =
    mlMarketProb !== null ? (mlModelProb - mlMarketProb) * 100 : 0;

  // OU using market_total (or independent total when market missing)
  const ouLine = market.listedTotal ?? posterior.total_expected_runs;
  const ouOverProb = overProbabilityPoisson(
    posterior.away_expected_runs,
    posterior.home_expected_runs,
    ouLine,
  );
  const ouPickIsOver = ouOverProb >= 0.5;
  const ouModelProb = ouPickIsOver ? ouOverProb : (1 - ouOverProb);
  // Market O/U is 50/50 when no odds — for now use 0.5 as fair line
  const ouMarketProb = 0.5;
  const ouEdgePct = (ouModelProb - ouMarketProb) * 100;

  // Confidence
  const mlConfidence = computeConfidence({
    win_prob: mlModelProb,
    ou_prob: ouModelProb,
    run_diff_abs: Math.abs(posterior.home_run_diff),
    tier: indep.data_quality_tier,
  });
  const ouConfidence = computeConfidence({
    win_prob: ouModelProb,
    ou_prob: ouModelProb,
    run_diff_abs: Math.abs(posterior.total_expected_runs - ouLine),
    tier: indep.data_quality_tier,
  });

  // Provisional — when market is missing or features sparse
  const provisional =
    !marketValid ||
    indep.feature_audit.missing_count >= 7 ||
    indep.data_quality_tier === "fallback";

  // Layer 5 — Play Grade
  // PlayGradeInput shape: modelProb + marketProb + americanOdds.
  // EV/edge computed inside the grader from those inputs.
  const mlMarketAmerican = mlPickIsHome
    ? snap.market.home_ml_odds_american
    : snap.market.away_ml_odds_american;
  const mlPlayGrade = computePlayGrade({
    modelProb: mlModelProb,
    marketProb: mlMarketProb,
    americanOdds: mlMarketAmerican,
    dataQualityTier: indep.data_quality_tier,
    provisional,
    isHeld: false,
    minBestAngleEdgePct: V22_BEST_ANGLE_MIN_EDGE_PCT_ML,
    minBestAngleConfidencePct: V22_BEST_ANGLE_MIN_CONFIDENCE_PCT,
  });
  const ouPlayGrade = computePlayGrade({
    modelProb: ouModelProb,
    marketProb: ouMarketProb,
    americanOdds: null, // OU odds not always ingested; grader handles null
    dataQualityTier: indep.data_quality_tier,
    provisional,
    isHeld: false,
    minBestAngleEdgePct: V22_BEST_ANGLE_MIN_EDGE_PCT_OU,
    minBestAngleConfidencePct: V22_BEST_ANGLE_MIN_CONFIDENCE_PCT,
  });
  // probabilityToAmericanOdds / expectedValuePerDollar are no longer
  // called directly here — the grader handles EV computation.
  void probabilityToAmericanOdds;
  void expectedValuePerDollar;

  const audit: V22Audit = {
    market_total: market.listedTotal,
    market_home_win_prob: market.homeNoVigProb,
    market_away_win_prob: market.awayNoVigProb,
    market_baseline_valid: marketValid,
    market_source_quality: market.dataQuality,
    independent_away_runs: indep.away_expected_runs,
    independent_home_runs: indep.home_expected_runs,
    independent_total: indep.total_expected_runs,
    independent_home_diff: indep.home_run_diff,
    data_quality_tier: indep.data_quality_tier,
    feature_present_count: indep.feature_audit.present_count,
    feature_missing_count: indep.feature_audit.missing_count,
    posterior_away_runs: posterior.away_expected_runs,
    posterior_home_runs: posterior.home_expected_runs,
    posterior_total: posterior.total_expected_runs,
    posterior_home_diff: posterior.home_run_diff,
    trust_independent: posterior.trust_independent,
    posterior_moved_runs_from_market: posterior.posterior_moved_runs_from_market,
    capped_by_total: posterior.capped_by_total,
    capped_by_diff: posterior.capped_by_diff,
    ml_model_prob: mlModelProb,
    ml_market_prob: mlMarketProb,
    ml_edge_pct: mlEdgePct,
    ou_model_prob: ouModelProb,
    ou_market_prob: ouMarketProb,
    ou_edge_pct: ouEdgePct,
    ml_play_grade: mlPlayGrade.grade,
    ou_play_grade: ouPlayGrade.grade,
    ml_prediction_type: mlPlayGrade.predictionType,
    ou_prediction_type: ouPlayGrade.predictionType,
    ml_best_angle_eligible: mlPlayGrade.grade === "best_angle",
    ou_best_angle_eligible: ouPlayGrade.grade === "best_angle",
    ml_no_bet_reason: mlPlayGrade.noBetReason,
    ou_no_bet_reason: ouPlayGrade.noBetReason,
    ml_market_aligned: mlPlayGrade.marketAligned,
    ou_market_aligned: ouPlayGrade.marketAligned,
    ml_best_angle_reason: mlPlayGrade.bestAngleReason,
    ou_best_angle_reason: ouPlayGrade.bestAngleReason,
    model_integrity_notes: integrityNotes,
    provisional,
  };

  return {
    predicted_home_score: posterior.home_expected_runs,
    predicted_away_score: posterior.away_expected_runs,
    predicted_total: posterior.total_expected_runs,
    predicted_ml_winner: mlPickIsHome ? "home" : "away",
    ml_confidence: Math.round(mlConfidence * 10) / 10,
    predicted_ou_side: ouPickIsOver ? "over" : "under",
    ou_confidence: Math.round(ouConfidence * 10) / 10,
    // NRFI passthrough from V1 — V2.2 does not rebuild the FI model
    // (deferred to a separate FI V2 push)
    predicted_nrfi: v1Output.predicted_nrfi,
    nrfi_confidence: v1Output.nrfi_confidence,
    v22Audit: audit,
  };
}

void MODEL_VERSION_V2_2; // imported for type union; unused locally
