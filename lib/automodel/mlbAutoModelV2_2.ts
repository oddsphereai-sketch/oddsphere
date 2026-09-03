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

import { computeMarketBaseline, type MarketBaseline } from "./marketPrior";
import {
  estimateMlbStarterWorkload,
  projectIndependent,
  type StarterWorkloadEstimate,
  type V22IndependentProjection,
} from "./mlbIndependentProjection";
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
import { regularizeProbability } from "./mlbProbabilityRegularization";
import type { AutoModelOutput, GameSnapshot, ModelStage, StarterSnapshot, TeamSnapshot, BatterSnapshot } from "./types";
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
  coherent_market_price_map?: {
    release_id: string;
    moneyline_applied: boolean;
    total_applied: boolean;
    moneyline_split_conflict: boolean;
    total_split_conflict: boolean;
    listed_total: number | null;
    inferred_market_expected_total: number | null;
    moneyline_home: GameSnapshot["market"]["coherent_price_map"] extends infer T
      ? T extends { moneyline_home: infer M } ? M : null
      : null;
    total_over: GameSnapshot["market"]["coherent_price_map"] extends infer T
      ? T extends { total_over: infer O } ? O : null
      : null;
  } | null;
  evaluation_only_price_exclusion?: {
    release_id: typeof MLB_FULL_GAME_STRUCTURAL_COHERENCE_RELEASE_ID;
    moneyline_complete_pair_count: number | null;
    total_complete_pair_count: number | null;
    moneyline_forecast_excluded: boolean;
    total_forecast_excluded: boolean;
    total_probability_regularization_excluded: boolean;
    exact_evaluation_price_retained_for_grade: true;
  };
  // Layer 2
  independent_away_runs: number;
  independent_home_runs: number;
  independent_total: number;
  independent_home_diff: number;
  data_quality_tier: "high" | "medium" | "low" | "fallback";
  feature_present_count: number;
  feature_missing_count: number;
  workload_pitching_enabled?: boolean;
  workload_pitching_applied?: boolean;
  home_starter_workload?: StarterWorkloadEstimate;
  away_starter_workload?: StarterWorkloadEstimate;
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
  // MLB-P0 probability-space regularization audit (the E-first fix).
  // ml_model_prob / ml_edge_pct (and ou_*) ABOVE are now the REGULARIZED
  // values that drive the card + grade + Best Angle; the fields below
  // preserve the raw model probability/edge plus the regularizer math so
  // calibration quality (raw vs regularized vs outcome) can be evaluated
  // over time. raw_* are audit-only and never gate a play.
  ml_raw_model_prob: number;
  ml_raw_edge_pct: number | null;
  ml_regularized_model_prob: number;
  ml_regularized_edge_pct: number | null;
  ml_shrink_factor: number;
  ml_distance_cap_pp: number;
  ml_distance_cap_applied: boolean;
  ou_raw_model_prob: number;
  ou_raw_edge_pct: number | null;
  ou_regularized_model_prob: number;
  ou_regularized_edge_pct: number | null;
  ou_shrink_factor: number;
  ou_distance_cap_pp: number;
  ou_distance_cap_applied: boolean;
  /** Always "probability_space_regularization" — the reason both edges were shrunk. */
  regularization_reason: string;
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
  // MLB-P0 Best Angle market-sanity audit.
  // miscalibration_flag = the regularizer's distance cap fired (raw edge
  // exceeded cap/k) — a strong model-market disagreement.
  ml_miscalibration_flag: boolean;
  ou_miscalibration_flag: boolean;
  ml_market_prob_was_fallback: boolean;
  ou_market_prob_was_fallback: boolean;
  ml_best_angle_blocked: boolean;
  ou_best_angle_blocked: boolean;
  ml_best_angle_block_reason: string | null;
  ou_best_angle_block_reason: string | null;
  // requires_market_confirmation = a would-be Best Angle whose edge was
  // capped; remains Best Angle only if line movement confirms (resolved in
  // the writer). Picks below Best Angle are always false.
  ml_requires_market_confirmation: boolean;
  ou_requires_market_confirmation: boolean;
  truthful_edge_correction?: {
    ml_probability_blend_weight: number;
    total_probability_blend_weight: number;
    total_min_actionable_edge_pct: number;
    ou_grade_before_correction: string;
    ou_grade_after_correction: string;
    ou_correction_applied: boolean;
    ou_correction_reason: string | null;
  };
  team_residual_correction?: {
    version: "launch_window_team_residual_v1";
    home_team: string;
    away_team: string;
    home_runs: number;
    away_runs: number;
    total_runs: number;
    applied: boolean;
    reason: string | null;
  };
  model_integrity_notes: string[];
  provisional: boolean;
  /**
   * Forward-only RAW FEATURE CAPTURE (additive, 2026-06-15). Persists the
   * model's actual feature INPUTS (starter/bullpen/offense/park/weather +
   * computed per-team factors) so future calibration/attribution can test
   * stat-feature weighting. Purely diagnostic — does NOT affect predictions,
   * grades, or display. Optional for back-compat with pre-capture snapshots.
   */
  feature_capture?: V22FeatureCapture | null;
};

/** Shape of the forward-only feature-capture diagnostic block. */
export type V22FeatureCapture = {
  schema_version: string;
  data_quality_tier: string;
  starter: { home: ReturnType<typeof captureStarter>; away: ReturnType<typeof captureStarter> };
  team: { home: ReturnType<typeof captureTeam>; away: ReturnType<typeof captureTeam> };
  park: { park_factor_runs: number | null; is_dome: boolean } | null;
  weather: WeatherCapture | null;
  lineup: { home: ReturnType<typeof lineupCounts>; away: ReturnType<typeof lineupCounts> };
  /** indep.audit_per_team — the computed multipliers (offense/pitcher/bullpen/park/weather). */
  factors: unknown;
};
type WeatherCapture = { temperature_f: number | null; humidity_pct: number | null; wind_speed_mph: number | null; wind_direction_degrees: number | null; is_notable: boolean; notable_reason: string | null };

function captureStarter(s: StarterSnapshot | null) {
  if (!s) return null;
  return {
    player_id: s.player_external_id, name: s.player_name, throws: s.throws,
    confirmed: s.is_confirmed, scratched: s.is_scratched,
    season_era: s.season_era, season_whip: s.season_whip, season_k_per_9: s.season_k_per_9,
    season_stats_season: s.season_stats_season ?? null,
    season_stats_source: s.season_stats_source ?? "missing",
    last30_era: s.last30_era, pitch_quality_score: s.pitch_quality_score,
    first_inning_era: s.first_inning_era, first_inning_starts: s.first_inning_starts, first_inning_whip: s.first_inning_whip,
    season_games_started: s.season_games_started ?? null, season_innings_pitched: s.season_innings_pitched ?? null,
  };
}
function captureTeam(t: TeamSnapshot) {
  return {
    team_id: t.team_external_id, abbr: t.abbreviation,
    bullpen_era_proxy: t.bullpen_era_proxy, bullpen_era_proxy_raw: t.bullpen_era_proxy_raw ?? null, bullpen_ip: t.bullpen_ip ?? null,
    season_runs_per_game: t.season_runs_per_game, team_avg_batter_ops: t.team_avg_batter_ops ?? null,
  };
}
function lineupCounts(b: BatterSnapshot[]) {
  return { size: b.length, confirmed_count: b.filter((x) => x.lineup_source !== "projected").length };
}
/** Pure, additive. Reads only `snap` (model inputs) + `indep.audit_per_team`. */
function buildV22FeatureCapture(snap: GameSnapshot, factors: unknown, tier: string): V22FeatureCapture {
  return {
    schema_version: "fc_v1",
    data_quality_tier: tier,
    starter: { home: captureStarter(snap.home_starter), away: captureStarter(snap.away_starter) },
    team: { home: captureTeam(snap.home_team), away: captureTeam(snap.away_team) },
    park: snap.ballpark ? { park_factor_runs: snap.ballpark.park_factor_runs, is_dome: snap.ballpark.is_dome } : null,
    weather: snap.weather ? { temperature_f: snap.weather.temperature_f, humidity_pct: snap.weather.humidity_pct, wind_speed_mph: snap.weather.wind_speed_mph, wind_direction_degrees: snap.weather.wind_direction_degrees, is_notable: snap.weather.is_notable, notable_reason: snap.weather.notable_reason } : null,
    lineup: { home: lineupCounts(snap.home_lineup_top8), away: lineupCounts(snap.away_lineup_top8) },
    factors: factors ?? null,
  };
}

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

export type RunMlbAutoModelV2_2Options = {
  useWorkloadPitching?: boolean;
};

export const MLB_FULL_GAME_STRUCTURAL_COHERENCE_RELEASE_ID =
  "mlb_full_game_structural_coherence_2026_09_02_r1" as const;

export function resolveMlbEvaluationOnlyPriceAuthority(args: {
  snapshot: GameSnapshot["market"];
  market: MarketBaseline;
  independent: V22IndependentProjection;
}): {
  posteriorMarket: MarketBaseline;
  moneylineCompletePairCount: number | null;
  totalCompletePairCount: number | null;
  moneylineForecastExcluded: boolean;
  totalForecastExcluded: boolean;
  totalProbabilityRegularizationExcluded: boolean;
} {
  const map = args.snapshot.coherent_price_map ?? null;
  const moneylineCompletePairCount = map === null
    ? null
    : map.moneyline_home.sharp_book_count + map.moneyline_home.retail_book_count;
  const totalCompletePairCount = map === null
    ? null
    : map.total_over.sharp_book_count + map.total_over.retail_book_count;

  // A lone complete named-book pair is the evaluated quote, not independent
  // forecast corroboration. Preserve a real sharp_signal Pinnacle fair prior;
  // this exclusion is deliberately limited to the raw American pair fallback.
  const moneylineForecastExcluded =
    args.market.source === "american_devig" && moneylineCompletePairCount === 1;
  const totalForecastExcluded =
    args.market.ouSource === "american_devig" && totalCompletePairCount === 1;
  const totalProbabilityRegularizationExcluded = totalForecastExcluded;

  if (!moneylineForecastExcluded && !totalForecastExcluded) {
    return {
      posteriorMarket: args.market,
      moneylineCompletePairCount,
      totalCompletePairCount,
      moneylineForecastExcluded,
      totalForecastExcluded,
      totalProbabilityRegularizationExcluded,
    };
  }

  // Remove only the forecast dimension owned by an evaluation-only quote.
  // A singleton Moneyline cannot own the team split, and a singleton Total
  // cannot own the scoring environment. Other independently corroborated
  // market dimensions remain available. The exact listed line and prices stay
  // on the original baseline for downstream side selection and EV grading.
  const independentTotal =
    args.independent.home_expected_runs + args.independent.away_expected_runs;
  const independentHomeShare = independentTotal > 0
    ? args.independent.home_expected_runs / independentTotal
    : 0.5;
  const forecastTotal = totalForecastExcluded
    ? independentTotal
    : args.market.marketExpectedTotal ?? args.market.listedTotal;
  const forecastHomeShare = moneylineForecastExcluded
    ? independentHomeShare
    : args.market.homeRunShare ?? independentHomeShare;
  const exclusionReasons = [
    moneylineForecastExcluded
      ? "Evaluation-only Moneyline pair excluded from forecast team split."
      : null,
    totalForecastExcluded
      ? "Evaluation-only Total pair excluded from forecast scoring environment."
      : null,
  ].filter((reason): reason is string => reason !== null);
  const posteriorMarket = forecastTotal === null
    ? args.market
    : {
        ...args.market,
        homeRunShare: forecastHomeShare,
        homeImpliedTotal: forecastTotal * forecastHomeShare,
        awayImpliedTotal: forecastTotal * (1 - forecastHomeShare),
        marketExpectedTotal: forecastTotal,
        reason: `${args.market.reason} ${exclusionReasons.join(" ")}`,
      };

  return {
    posteriorMarket,
    moneylineCompletePairCount,
    totalCompletePairCount,
    moneylineForecastExcluded,
    totalForecastExcluded,
    totalProbabilityRegularizationExcluded,
  };
}

// Best Angle thresholds — V2.2 uses tighter gates than V2.1 since the
// independent projection has more freedom to move and we want only
// genuinely model-driven angles to flow through.
const V22_BEST_ANGLE_MIN_EDGE_PCT_ML = 3.0;
const V22_BEST_ANGLE_MIN_EDGE_PCT_OU = 5.0;
const V22_BEST_ANGLE_MIN_CONFIDENCE_PCT = 56;

// MLB-P0 probability-space regularization (the E-first fix). Applied to
// the Poisson probability AFTER the run-space posterior blend and BEFORE
// edge/grade. Shrinks the model probability toward the no-vig market and
// hard-caps the distance, so an overconfident Poisson output can no longer
// manufacture a 15-30pp phantom edge. These govern the magnitude used for
// edge + grade ONLY — the pick/side is decided upstream from the raw prob.
//   k        — fraction of the raw model's distance-from-market it keeps.
//   maxDist  — hard ceiling on |regularized − market| in percentage points.
// O/U is shrunk harder (lower k, tighter cap) because totals are the
// worst-calibrated market in the audit (observed 49.4% vs predicted 58.6%).
const V22_SHRINK_K_ML = 0.1;
export const V22_SHRINK_K_OU = 0.4;
const V22_MAX_DISTANCE_PP_ML = 6.0;
export const V22_MAX_DISTANCE_PP_OU = 8.0;
const V22_OU_MIN_ACTIONABLE_EDGE_PCT = 5.0;

const MLB_TEAM_RESIDUAL_CORRECTION_VERSION = "launch_window_team_residual_v1" as const;

// Small, audited corrections from the launch-window calibration audit.
// Positive means the model had been under-projecting that team's runs;
// negative means it had been over-projecting them. Kept intentionally
// conservative so this nudges the run model without letting team labels
// dominate pitcher, lineup, park, weather, and market inputs.
export const MLB_TEAM_RESIDUAL_RUN_CORRECTIONS: Readonly<Record<string, number>> = {
  PIT: 0.2,
  MIN: 0.2,
  CHC: 0.2,
  KC: 0.15,
  DET: 0.15,
  MIA: 0.1,
  STL: 0.1,
  COL: 0.1,
  PHI: 0.1,
  WSH: 0.1,
  CLE: -0.15,
  TOR: -0.1,
  NYY: -0.1,
  SEA: -0.1,
  SD: -0.1,
  BAL: -0.1,
};

export function applyMlbTeamResidualRunCorrection(args: {
  homeTeam: string | null | undefined;
  awayTeam: string | null | undefined;
  homeRuns: number;
  awayRuns: number;
}): {
  homeRuns: number;
  awayRuns: number;
  audit: NonNullable<V22Audit["team_residual_correction"]>;
} {
  const homeTeam = String(args.homeTeam ?? "").toUpperCase();
  const awayTeam = String(args.awayTeam ?? "").toUpperCase();
  const homeDelta = MLB_TEAM_RESIDUAL_RUN_CORRECTIONS[homeTeam] ?? 0;
  const awayDelta = MLB_TEAM_RESIDUAL_RUN_CORRECTIONS[awayTeam] ?? 0;
  const homeRuns = Math.max(0.05, args.homeRuns + homeDelta);
  const awayRuns = Math.max(0.05, args.awayRuns + awayDelta);
  const totalDelta = homeDelta + awayDelta;
  return {
    homeRuns,
    awayRuns,
    audit: {
      version: MLB_TEAM_RESIDUAL_CORRECTION_VERSION,
      home_team: homeTeam,
      away_team: awayTeam,
      home_runs: Math.round(homeDelta * 100) / 100,
      away_runs: Math.round(awayDelta * 100) / 100,
      total_runs: Math.round(totalDelta * 100) / 100,
      applied: homeDelta !== 0 || awayDelta !== 0,
      reason: homeDelta !== 0 || awayDelta !== 0
        ? "launch_window_team_residual_correction"
        : null,
    },
  };
}

function applyMlbTruthfulEdgeGradeCorrection(args: {
  market: "moneyline" | "total";
  grade: string;
  edgePct: number | null;
}): {
  grade: string;
  applied: boolean;
  reason: string | null;
} {
  if (
    args.market === "total" &&
    (args.grade === "lean" || args.grade === "best_angle") &&
    (args.edgePct === null || Math.abs(args.edgePct) < V22_OU_MIN_ACTIONABLE_EDGE_PCT)
  ) {
    return {
      grade: "market_aligned",
      applied: true,
      reason: `total_edge_below_${V22_OU_MIN_ACTIONABLE_EDGE_PCT.toFixed(1)}pp_truthful_edge_floor`,
    };
  }
  return { grade: args.grade, applied: false, reason: null };
}

/**
 * Run V2.2 for a single game. Pure function — no DB, no network.
 */
export function runMlbAutoModelV2_2(
  snap: GameSnapshot,
  v1Output: AutoModelOutput, // for NRFI passthrough and fallback
  stage: ModelStage,
  opts: RunMlbAutoModelV2_2Options = {},
): V22Output {
  void stage;
  const integrityNotes: string[] = [];
  const workloadPitchingEnabled = opts.useWorkloadPitching === true;
  const homeStarterWorkload = estimateMlbStarterWorkload(snap.home_starter);
  const awayStarterWorkload = estimateMlbStarterWorkload(snap.away_starter);
  const workloadPitchingApplied =
    workloadPitchingEnabled &&
    (homeStarterWorkload.role !== "normal_starter" ||
      awayStarterWorkload.role !== "normal_starter");

  // Layer 1 — market baseline
  const market = computeMarketBaseline(snap.market, snap.sharp ?? null);
  const marketValid = market.dataQuality === "ok";
  if (!marketValid) {
    integrityNotes.push(
      `Market baseline weak (${market.dataQuality}); falling back to independent + low trust.`,
    );
  }

  // Layer 2 — independent projection
  const indep = projectIndependent(snap, {
    useWorkloadPitching: workloadPitchingEnabled,
  });
  if (workloadPitchingApplied) {
    integrityNotes.push(
      `Workload pitching applied: home=${homeStarterWorkload.role} ` +
        `(${homeStarterWorkload.starter_innings}/${homeStarterWorkload.bullpen_innings}), ` +
        `away=${awayStarterWorkload.role} ` +
        `(${awayStarterWorkload.starter_innings}/${awayStarterWorkload.bullpen_innings}).`
    );
  }
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

  const evaluationOnlyPriceAuthority = resolveMlbEvaluationOnlyPriceAuthority({
    snapshot: snap.market,
    market,
    independent: indep,
  });
  if (evaluationOnlyPriceAuthority.moneylineForecastExcluded) {
    integrityNotes.push(
      "Evaluation-only Moneyline pair retained for exact-price grading but excluded from the forecast team split.",
    );
  }
  if (evaluationOnlyPriceAuthority.totalProbabilityRegularizationExcluded) {
    integrityNotes.push(
      "Evaluation-only Total pair retained for exact-price grading but excluded from the forecast scoring environment and probability regularization.",
    );
  }

  // Layer 3 — adaptive blend
  const posterior = blendPosterior({
    market: marketValid ? evaluationOnlyPriceAuthority.posteriorMarket : null,
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
  const correctedPosterior = applyMlbTeamResidualRunCorrection({
    homeTeam: snap.home_team.abbreviation,
    awayTeam: snap.away_team.abbreviation,
    homeRuns: posterior.home_expected_runs,
    awayRuns: posterior.away_expected_runs,
  });
  const posteriorHomeRuns = correctedPosterior.homeRuns;
  const posteriorAwayRuns = correctedPosterior.awayRuns;
  const posteriorTotalRuns = posteriorHomeRuns + posteriorAwayRuns;
  const posteriorHomeDiff = posteriorHomeRuns - posteriorAwayRuns;
  if (correctedPosterior.audit.applied) {
    integrityNotes.push(
      `Team residual correction applied (${correctedPosterior.audit.away_team} ${correctedPosterior.audit.away_runs >= 0 ? "+" : ""}${correctedPosterior.audit.away_runs}, ${correctedPosterior.audit.home_team} ${correctedPosterior.audit.home_runs >= 0 ? "+" : ""}${correctedPosterior.audit.home_runs}).`,
    );
  }

  // Layer 4 — probabilities from Poisson on unrounded posterior.
  // homeWinProbabilityPoisson signature is (lambdaHome, lambdaAway).
  // Pre-Push 3A-6 hotfix: V2.2 had these arguments swapped, which
  // returned P(away wins) and inverted every ML pick. Test added in
  // scripts/test-mlb-automodel-v2-2.ts ("skewed lambdas — ML direction").
  const mlHomeProb = homeWinProbabilityPoisson(
    posteriorHomeRuns,
    posteriorAwayRuns,
  );
  const mlAwayProb = 1 - mlHomeProb;
  // Pick direction is decided from the RAW Poisson probability — never
  // changed by regularization below.
  const mlPickIsHome = mlHomeProb >= 0.5;
  const mlMarketProb = marketValid && market.homeNoVigProb !== null
    ? mlPickIsHome ? market.homeNoVigProb : (1 - market.homeNoVigProb)
    : null;
  // RAW model probability for the picked side (preserved in audit).
  const mlRawModelProb = mlPickIsHome ? mlHomeProb : mlAwayProb;
  // MLB-P0 — regularize toward the no-vig market in probability space.
  // The regularized prob/edge drive confidence, grade, Best Angle, and the
  // card; the raw prob/edge are preserved for calibration evaluation.
  const mlReg = regularizeProbability({
    rawProb: mlRawModelProb,
    marketProb: evaluationOnlyPriceAuthority.moneylineForecastExcluded
      ? null
      : mlMarketProb,
    k: V22_SHRINK_K_ML,
    maxDistancePp: V22_MAX_DISTANCE_PP_ML,
  });
  const mlModelProb = mlReg.regularizedProb ?? mlRawModelProb;
  const mlRawEdgePct = mlMarketProb === null
    ? null
    : Math.round((mlRawModelProb - mlMarketProb) * 1_000) / 10;
  const mlEdgePct = evaluationOnlyPriceAuthority.moneylineForecastExcluded
    ? mlRawEdgePct ?? 0
    : mlReg.regularizedEdgePct ?? 0;

  // OU using market_total (or independent total when market missing)
  const ouLine = market.listedTotal ?? posteriorTotalRuns;
  const ouOverProb = overProbabilityPoisson(
    posteriorAwayRuns,
    posteriorHomeRuns,
    ouLine,
  );
  const ouPickIsOver = ouOverProb >= 0.5;
  // RAW O/U model probability for the picked side (preserved in audit).
  const ouRawModelProb = ouPickIsOver ? ouOverProb : (1 - ouOverProb);

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
  // MLB-P0 — regularize O/U toward the no-vig market (harder shrink than
  // ML). Regularized prob/edge drive confidence, grade, Best Angle, card.
  const ouReg = regularizeProbability({
    rawProb: ouRawModelProb,
    marketProb: evaluationOnlyPriceAuthority.totalProbabilityRegularizationExcluded
      ? null
      : ouMarketProb,
    k: V22_SHRINK_K_OU,
    maxDistancePp: V22_MAX_DISTANCE_PP_OU,
  });
  const ouModelProb = ouReg.regularizedProb ?? ouRawModelProb;
  const ouRawEdgePct = ouMarketProb === null
    ? null
    : Math.round((ouRawModelProb - ouMarketProb) * 1_000) / 10;
  const ouEdgePct: number | null = evaluationOnlyPriceAuthority.totalProbabilityRegularizationExcluded
    ? ouRawEdgePct
    : ouReg.regularizedEdgePct;

  // Confidence
  const mlConfidence = computeConfidence({
    win_prob: mlModelProb,
    ou_prob: ouModelProb,
    run_diff_abs: Math.abs(posteriorHomeDiff),
    tier: indep.data_quality_tier,
  });
  const ouConfidence = computeConfidence({
    win_prob: ouModelProb,
    ou_prob: ouModelProb,
    run_diff_abs: Math.abs(posteriorTotalRuns - ouLine),
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
  // MLB-P0: ML market prob is a fallback when the de-vig source is the
  // 0.51 fallback_default (or the no-vig prob is missing) — never Best Angle.
  const mlMarketProbIsFallback =
    market.source === "fallback_default" || market.homeNoVigProb === null;
  const mlPlayGrade = computePlayGrade({
    modelProb: mlModelProb,
    marketProb: mlMarketProb,
    americanOdds: mlMarketAmerican,
    dataQualityTier: indep.data_quality_tier,
    provisional,
    isHeld: false,
    minBestAngleEdgePct: V22_BEST_ANGLE_MIN_EDGE_PCT_ML,
    minBestAngleConfidencePct: V22_BEST_ANGLE_MIN_CONFIDENCE_PCT,
    marketProbIsFallback: mlMarketProbIsFallback,
    bestAngleHardBlockReason: evaluationOnlyPriceAuthority.moneylineForecastExcluded
      ? "evaluation-only Moneyline price has no target-excluded forecast corroboration"
      : neutralFallbackBlocksBA
        ? "key feature group on neutral fallback / missing for both sides"
        : null,
  });
  // Phase 6B.8 — pass the picked side's real American OU odds to the
  // grader so EV computation reflects book pricing instead of being
  // skipped entirely. When the picked-side price is missing the
  // grader handles null gracefully (returns "provisional"). marketProb
  // may also be null (already handled by computePlayGrade).
  const ouMarketAmerican = ouPickIsOver
    ? snap.market.over_odds_american
    : snap.market.under_odds_american;
  // MLB-P0 totals tightening: a total can be Best Angle ONLY with real
  // O/U odds on the picked side (no 0.5/null fallback). When the picked
  // side's price is missing, hard-block Best Angle (it can still grade
  // lean). Totals are the worst-calibrated market in the audit, so they
  // get the strictest market-presence gate.
  const ouOddsMissing = ouMarketAmerican === null || ouMarketProb === null;
  const ouPlayGrade = computePlayGrade({
    modelProb: ouModelProb,
    marketProb: ouMarketProb,
    americanOdds: ouMarketAmerican,
    dataQualityTier: indep.data_quality_tier,
    provisional,
    isHeld: false,
    minBestAngleEdgePct: V22_BEST_ANGLE_MIN_EDGE_PCT_OU,
    minBestAngleConfidencePct: V22_BEST_ANGLE_MIN_CONFIDENCE_PCT,
    marketProbIsFallback: ouOddsMissing,
    bestAngleHardBlockReason: ouOddsMissing
      ? "total requires real O/U odds (no fallback) for Best Angle"
      : evaluationOnlyPriceAuthority.totalProbabilityRegularizationExcluded
        ? "evaluation-only Total price has no target-excluded forecast corroboration"
      : neutralFallbackBlocksBA
        ? "key feature group on neutral fallback / missing for both sides"
        : null,
  });
  const ouGradeCorrection = applyMlbTruthfulEdgeGradeCorrection({
    market: "total",
    grade: ouPlayGrade.grade,
    edgePct: ouEdgePct,
  });
  const finalOuPlayGrade = ouGradeCorrection.grade;
  // MLB-P0 post-shrink large-edge backstop: a pick whose RAW edge was so
  // large that regularization pinned it to the distance cap (capApplied)
  // is a strong model-market disagreement. It can REMAIN a Best Angle only
  // if the market later confirms it (line movement toward the pick) — that
  // resolution happens in the writer (predictionRecordService), which has
  // the line-movement snapshot. Here we just flag that confirmation is
  // required. Picks that don't reach Best Angle never require confirmation.
  const mlBaseBestAngle =
    mlPlayGrade.grade === "best_angle" && !neutralFallbackBlocksBA;
  const ouBaseBestAngle =
    finalOuPlayGrade === "best_angle" && !neutralFallbackBlocksBA;
  const mlRequiresMarketConfirmation = mlBaseBestAngle && mlReg.capApplied;
  const ouRequiresMarketConfirmation = ouBaseBestAngle && ouReg.capApplied;
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
    coherent_market_price_map: snap.market.coherent_price_map
      ? {
          release_id: snap.market.coherent_price_map.release_id,
          moneyline_applied: market.coherentMoneylinePriceMapApplied === true,
          total_applied: market.coherentTotalPriceMapApplied === true,
          moneyline_split_conflict: market.coherentMoneylineSplitConflict === true,
          total_split_conflict: market.coherentTotalSplitConflict === true,
          listed_total: market.listedTotal,
          inferred_market_expected_total: market.marketExpectedTotal ?? market.listedTotal,
          moneyline_home: snap.market.coherent_price_map.moneyline_home,
          total_over: snap.market.coherent_price_map.total_over,
        }
      : null,
    evaluation_only_price_exclusion: {
      release_id: MLB_FULL_GAME_STRUCTURAL_COHERENCE_RELEASE_ID,
      moneyline_complete_pair_count:
        evaluationOnlyPriceAuthority.moneylineCompletePairCount,
      total_complete_pair_count:
        evaluationOnlyPriceAuthority.totalCompletePairCount,
      moneyline_forecast_excluded:
        evaluationOnlyPriceAuthority.moneylineForecastExcluded,
      total_forecast_excluded:
        evaluationOnlyPriceAuthority.totalForecastExcluded,
      total_probability_regularization_excluded:
        evaluationOnlyPriceAuthority.totalProbabilityRegularizationExcluded,
      exact_evaluation_price_retained_for_grade: true,
    },
    independent_away_runs: indep.away_expected_runs,
    independent_home_runs: indep.home_expected_runs,
    independent_total: indep.total_expected_runs,
    independent_home_diff: indep.home_run_diff,
    data_quality_tier: indep.data_quality_tier,
    feature_present_count: indep.feature_audit.present_count,
    feature_missing_count: indep.feature_audit.missing_count,
    workload_pitching_enabled: workloadPitchingEnabled,
    workload_pitching_applied: workloadPitchingApplied,
    home_starter_workload: homeStarterWorkload,
    away_starter_workload: awayStarterWorkload,
    feature_preferred_count: indep.feature_audit.preferred_count,
    feature_fallback_real_count: indep.feature_audit.fallback_real_count,
    feature_proxy_count: indep.feature_audit.proxy_count,
    feature_neutral_fallback_count: indep.feature_audit.neutral_fallback_count,
    feature_reason_codes: indep.feature_audit.reason_codes,
    posterior_away_runs: posteriorAwayRuns,
    posterior_home_runs: posteriorHomeRuns,
    posterior_total: posteriorTotalRuns,
    posterior_home_diff: posteriorHomeDiff,
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
    // MLB-P0 regularization audit — raw preserved, regularizer math exposed.
    ml_raw_model_prob: mlRawModelProb,
    ml_raw_edge_pct: mlRawEdgePct,
    ml_regularized_model_prob: mlModelProb,
    ml_regularized_edge_pct: mlEdgePct,
    ml_shrink_factor: evaluationOnlyPriceAuthority.moneylineForecastExcluded
      ? 1
      : mlReg.shrinkFactor,
    ml_distance_cap_pp: mlReg.distanceCapPp,
    ml_distance_cap_applied: mlReg.capApplied,
    ou_raw_model_prob: ouRawModelProb,
    ou_raw_edge_pct: ouRawEdgePct,
    ou_regularized_model_prob: ouModelProb,
    ou_regularized_edge_pct: ouEdgePct,
    ou_shrink_factor: evaluationOnlyPriceAuthority.totalProbabilityRegularizationExcluded
      ? 1
      : ouReg.shrinkFactor,
    ou_distance_cap_pp: ouReg.distanceCapPp,
    ou_distance_cap_applied: ouReg.capApplied,
    regularization_reason:
      evaluationOnlyPriceAuthority.moneylineForecastExcluded ||
      evaluationOnlyPriceAuthority.totalProbabilityRegularizationExcluded
        ? "evaluation_only_price_exclusion"
        : mlReg.reason,
    ml_play_grade: mlPlayGrade.grade,
    ou_play_grade: finalOuPlayGrade,
    ml_prediction_type: mlPlayGrade.predictionType,
    ou_prediction_type: finalOuPlayGrade === "market_aligned" ? "market_aligned" : ouPlayGrade.predictionType,
    ml_best_angle_eligible: mlPlayGrade.grade === "best_angle" && !neutralFallbackBlocksBA,
    ou_best_angle_eligible: finalOuPlayGrade === "best_angle" && !neutralFallbackBlocksBA,
    ml_no_bet_reason: mlPlayGrade.noBetReason,
    ou_no_bet_reason: ouPlayGrade.noBetReason,
    ml_market_aligned: mlPlayGrade.marketAligned,
    ou_market_aligned: ouPlayGrade.marketAligned,
    ml_best_angle_reason: mlPlayGrade.bestAngleReason,
    ou_best_angle_reason: ouPlayGrade.bestAngleReason,
    ml_miscalibration_flag: mlReg.capApplied,
    ou_miscalibration_flag: ouReg.capApplied,
    ml_market_prob_was_fallback: mlPlayGrade.marketProbWasFallback,
    ou_market_prob_was_fallback: ouPlayGrade.marketProbWasFallback,
    ml_best_angle_blocked: mlPlayGrade.bestAngleBlocked,
    ou_best_angle_blocked: ouPlayGrade.bestAngleBlocked,
    ml_best_angle_block_reason: mlPlayGrade.bestAngleBlockReason,
    ou_best_angle_block_reason: ouPlayGrade.bestAngleBlockReason,
    ml_requires_market_confirmation: mlRequiresMarketConfirmation,
    ou_requires_market_confirmation: ouRequiresMarketConfirmation,
    truthful_edge_correction: {
      ml_probability_blend_weight: V22_SHRINK_K_ML,
      total_probability_blend_weight: V22_SHRINK_K_OU,
      total_min_actionable_edge_pct: V22_OU_MIN_ACTIONABLE_EDGE_PCT,
      ou_grade_before_correction: ouPlayGrade.grade,
      ou_grade_after_correction: finalOuPlayGrade,
      ou_correction_applied: ouGradeCorrection.applied,
      ou_correction_reason: ouGradeCorrection.reason,
    },
    team_residual_correction: correctedPosterior.audit,
    model_integrity_notes: integrityNotes,
    provisional,
    feature_capture: buildV22FeatureCapture(
      snap,
      (indep as { audit_per_team?: unknown }).audit_per_team ?? null,
      indep.data_quality_tier,
    ),
  };

  return {
    predicted_home_score: posteriorHomeRuns,
    predicted_away_score: posteriorAwayRuns,
    predicted_total: posteriorTotalRuns,
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
