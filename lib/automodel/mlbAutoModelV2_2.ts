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
  /**
   * 2026-06-09 phantom-alt-line fix — audit trail for how the locked
   * total LINE was chosen by featureSnapshot.pickListedTotal. Surfaced
   * downstream into prediction_records.snapshot_json so operators can
   * verify a real-book main line drove the lock, not alt-line noise or
   * a stale consensus row. Optional for back-compat with legacy
   * snapshots; new model runs always populate.
   */
  total_line_source?: "real_book" | "consensus_fallback" | "unavailable";
  total_line_book?: string | null;
  total_line_agreement_count?: number;
  total_line_consensus_at_same_line?: boolean;
  // Layer 2
  independent_away_runs: number;
  independent_home_runs: number;
  independent_total: number;
  independent_home_diff: number;
  data_quality_tier: "high" | "medium" | "low" | "fallback";
  feature_present_count: number;
  feature_missing_count: number;
  // Push 3A-2 — source/reason hierarchy roll-up
  feature_preferred_count: number;
  feature_fallback_real_count: number;
  feature_proxy_count: number;
  feature_neutral_fallback_count: number;
  feature_reason_codes: string[];
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
  /**
   * Phase 6B.8 — real no-vig OU market probability for the picked
   * side. Null when no real-book O/U prices were ingested for the
   * game. Pre-6B.8 this was the constant 0.5 placeholder; new
   * downstream code MUST treat null as "no real edge" and never
   * substitute 0.5.
   */
  ou_market_prob: number | null;
  /** Null when ou_market_prob is null. */
  ou_edge_pct: number | null;
  /**
   * Phase 6B.8 — per-side OU prices the model resolved. Null when
   * featureSnapshot couldn't find a real-book row for that side.
   * Recorded for debugging + post-hoc review.
   */
  over_odds_american: number | null;
  under_odds_american: number | null;
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

  // Layer 4 — probabilities from Poisson on unrounded posterior.
  // homeWinProbabilityPoisson signature is (lambdaHome, lambdaAway).
  // Pre-Push 3A-6 hotfix: V2.2 had these arguments swapped, which
  // returned P(away wins) and inverted every ML pick. Test added in
  // scripts/test-mlb-automodel-v2-2.ts ("skewed lambdas — ML direction").
  const mlHomeProb = homeWinProbabilityPoisson(
    posterior.home_expected_runs,
    posterior.away_expected_runs,
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

  // Phase 6B.8 — real no-vig O/U market probability for the picked
  // side. Pre-6B.8 this was hard-coded to 0.5, which made every OU
  // "edge" the model's distance from a 50/50 prior — not a real edge
  // vs the book. Now we read market.overNoVigProb / underNoVigProb
  // (computed in marketPrior from real over_odds_american /
  // under_odds_american). When prices are missing for the game,
  // ouMarketProb is null and ouEdgePct is null — surfaced honestly
  // downstream so the UI displays model projection only and Top
  // Available Angles cannot rank totals on placeholder edge.
  const ouMarketProb: number | null = ouPickIsOver
    ? market.overNoVigProb
    : market.underNoVigProb;
  const ouEdgePct: number | null =
    ouMarketProb !== null ? (ouModelProb - ouMarketProb) * 100 : null;

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

  // Push 3A-2 — block Best Angle when any key feature group is on
  // neutral fallback or missing for BOTH sides. The model can still
  // emit a lean/market_aligned grade but Best Angle requires real data.
  const fa = indep.feature_audit;
  const bothStarterMissing =
    (fa.starter_era.home.source === "missing" || fa.starter_era.home.source === "neutral_fallback") &&
    (fa.starter_era.away.source === "missing" || fa.starter_era.away.source === "neutral_fallback");
  const bothOffenseMissing =
    (fa.team_ops.home.source === "missing" || fa.team_ops.home.source === "neutral_fallback") &&
    (fa.team_ops.away.source === "missing" || fa.team_ops.away.source === "neutral_fallback");
  const neutralFallbackBlocksBA = bothStarterMissing || bothOffenseMissing;
  if (neutralFallbackBlocksBA) {
    integrityNotes.push(
      "Key feature group on neutral fallback / missing for both sides; Best Angle blocked.",
    );
  }

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
  // Phase 6B.8 — pass the picked side's real American OU odds to the
  // grader so EV computation reflects book pricing instead of being
  // skipped entirely. When the picked-side price is missing the
  // grader handles null gracefully (returns "provisional"). marketProb
  // may also be null (already handled by computePlayGrade).
  const ouMarketAmerican = ouPickIsOver
    ? snap.market.over_odds_american
    : snap.market.under_odds_american;
  const ouPlayGrade = computePlayGrade({
    modelProb: ouModelProb,
    marketProb: ouMarketProb,
    americanOdds: ouMarketAmerican,
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
    // 2026-06-09 phantom-alt-line fix — propagate the resolver's audit
    // trail through V2.2 → snapshot_json. Reads off snap.market because
    // computeMarketBaseline doesn't carry these fields through (they
    // are about HOW the line was chosen, not the no-vig math).
    total_line_source: snap.market.total_line_source,
    total_line_book: snap.market.total_line_book,
    total_line_agreement_count: snap.market.total_line_agreement_count,
    total_line_consensus_at_same_line: snap.market.total_line_consensus_at_same_line,
    independent_away_runs: indep.away_expected_runs,
    independent_home_runs: indep.home_expected_runs,
    independent_total: indep.total_expected_runs,
    independent_home_diff: indep.home_run_diff,
    data_quality_tier: indep.data_quality_tier,
    feature_present_count: indep.feature_audit.present_count,
    feature_missing_count: indep.feature_audit.missing_count,
    feature_preferred_count: indep.feature_audit.preferred_count,
    feature_fallback_real_count: indep.feature_audit.fallback_real_count,
    feature_proxy_count: indep.feature_audit.proxy_count,
    feature_neutral_fallback_count: indep.feature_audit.neutral_fallback_count,
    feature_reason_codes: indep.feature_audit.reason_codes,
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
    over_odds_american: snap.market.over_odds_american,
    under_odds_american: snap.market.under_odds_american,
    ml_play_grade: mlPlayGrade.grade,
    ou_play_grade: ouPlayGrade.grade,
    ml_prediction_type: mlPlayGrade.predictionType,
    ou_prediction_type: ouPlayGrade.predictionType,
    ml_best_angle_eligible: mlPlayGrade.grade === "best_angle" && !neutralFallbackBlocksBA,
    ou_best_angle_eligible: ouPlayGrade.grade === "best_angle" && !neutralFallbackBlocksBA,
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
