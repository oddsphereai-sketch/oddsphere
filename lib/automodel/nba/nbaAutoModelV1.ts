/**
 * Phase 7A — NBA Finals v0a — orchestrator.
 *
 * Pure function. No DB, no network. Composes:
 *   Layer 1: projectIndependent      (clean score projection from ratings)
 *   Layer 2: computeMarketBaseline   (no-vig ML / spread / total)
 *   Layer 3: blendPosterior          (adaptive blend)
 *   Layer 4: data quality + injury reviewer
 *   Layer 5: pick + confidence emission
 *
 * Hard rules baked in:
 *   • provisional = true ALWAYS for v0 (admin-only, NOT member-facing).
 *   • Confidence ceilings are NBA-specific placeholders (NOT MLB's).
 *   • Best-Angle eligibility gated by data_quality_tier === 'high' AND
 *     no major injury unknowns AND confidence >= NBA_BEST_ANGLE_MIN_CONFIDENCE.
 *   • When ratings are null → fallback tier → ceiling 52.
 *   • When injuries unknown → caps confidence + blocks Best Angle.
 *   • Series context is included in the audit (game #, score, pressure,
 *     venue shift) but does NOT modify the projection in v0. Future work:
 *     fold series state into a closeout-pressure factor.
 *
 * Returns NbaAutoModelOutput.
 */

import { projectIndependent } from "./projectIndependent";
import { computeMarketBaseline } from "./marketPrior";
import { blendPosterior } from "./blendPosterior";
import {
  NBA_BEST_ANGLE_MIN_CONFIDENCE,
  NBA_CONFIDENCE_CEILING,
  NBA_CONFIDENCE_FLOOR,
  NBA_MODEL_VERSION,
  type NbaAutoModelOutput,
  type NbaDataQualityTier,
  type NbaGameSnapshot,
  type NbaModelStage,
  type NbaPlayerInjury,
} from "./types";

void NBA_MODEL_VERSION;

// ─── trust selection — NBA-specific weights ──────────────────────
//
// Same shape as MLB V2.2's trust schedule but tuned for NBA. NBA has
// higher score variance + more diverse team-rating signals; the
// independent projection gets MORE weight at high data quality than
// MLB's V2.2 because the ratings signal IS the model in basketball.

export const NBA_TRUST_INDEPENDENT_HIGH = 0.65;
export const NBA_TRUST_INDEPENDENT_MEDIUM = 0.45;
export const NBA_TRUST_INDEPENDENT_LOW = 0.25;
export const NBA_TRUST_INDEPENDENT_FALLBACK = 0.10;

function selectTrustIndependent(tier: NbaDataQualityTier): number {
  switch (tier) {
    case "high":     return NBA_TRUST_INDEPENDENT_HIGH;
    case "medium":   return NBA_TRUST_INDEPENDENT_MEDIUM;
    case "low":      return NBA_TRUST_INDEPENDENT_LOW;
    case "fallback": return NBA_TRUST_INDEPENDENT_FALLBACK;
  }
}

function countInjuriesByStatus(
  injuries: NbaPlayerInjury[],
): { unknown: number; out: number; questionable: number } {
  let unknown = 0;
  let out = 0;
  let questionable = 0;
  for (const inj of injuries) {
    if (inj.status === "unknown") unknown += 1;
    else if (inj.status === "out") out += 1;
    else if (inj.status === "questionable") questionable += 1;
  }
  return { unknown, out, questionable };
}

function deriveTier(snap: NbaGameSnapshot): NbaDataQualityTier {
  const ratings = snap.data_quality.ratings_present;
  if (!ratings) return "fallback";
  const market = snap.data_quality.market_present;
  const homeKnown = snap.data_quality.home_injuries_known;
  const awayKnown = snap.data_quality.away_injuries_known;
  if (homeKnown && awayKnown && market) return "high";
  if ((homeKnown && awayKnown) || market) return "medium";
  return "low";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Map a posterior spread + total into a per-market confidence.
 *
 * v0 formula (placeholder): bigger projected edge vs market =
 * higher confidence, but always inside the tier ceiling.
 *
 *   ml/spread: base = 50 + |posterior_spread - market_spread| × 1.5
 *              (so a 4-pt edge vs market lands around 56)
 *   total:     base = 50 + |posterior_total - market_total| × 0.8
 */
function computeMarketConfidence(opts: {
  posteriorSpread: number;
  marketSpread: number | null;
  posteriorTotal: number;
  marketTotal: number | null;
  tier: NbaDataQualityTier;
  market: "ml" | "spread" | "total";
}): number {
  let raw: number;
  if (opts.market === "total") {
    const edge =
      opts.marketTotal !== null
        ? Math.abs(opts.posteriorTotal - opts.marketTotal)
        : 0;
    raw = 50 + edge * 0.8;
  } else {
    // ml + spread both keyed off the spread edge
    const edge =
      opts.marketSpread !== null
        ? Math.abs(opts.posteriorSpread - opts.marketSpread)
        : Math.abs(opts.posteriorSpread); // no market: |home margin|
    raw = 50 + edge * 1.5;
  }
  const ceiling = NBA_CONFIDENCE_CEILING[opts.tier];
  return clamp(round1(raw), NBA_CONFIDENCE_FLOOR, ceiling);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function runNbaAutoModelV1(
  snap: NbaGameSnapshot,
  stage: NbaModelStage,
): NbaAutoModelOutput {
  const integrityNotes: string[] = [];

  // Layer 1 — independent projection
  const indep = projectIndependent(snap, { isPlayoffs: true });
  if (indep.used_fallback_rating) {
    integrityNotes.push(
      "Independent projection used league-average rating for at least one input (real team rating missing).",
    );
  }

  // Layer 2 — market baseline
  const marketBaseline = computeMarketBaseline(snap.market);
  if (!marketBaseline.has_full_market) {
    integrityNotes.push(
      "Market baseline incomplete (one or more of ML/spread/total missing).",
    );
  }

  // Layer 4a — data quality tier (used by Layer 3 trust + Layer 5 ceilings)
  const tier = deriveTier(snap);
  if (tier === "fallback") {
    integrityNotes.push(
      "data_quality_tier=fallback (ratings missing); output is provisional placeholder only.",
    );
  } else if (tier === "low") {
    integrityNotes.push(
      "data_quality_tier=low (market partial OR injuries unknown).",
    );
  }

  // Layer 3 — blend
  const trustWeight = selectTrustIndependent(tier);
  const posterior = blendPosterior({
    independent: {
      home_score_mean: indep.home_score_mean,
      away_score_mean: indep.away_score_mean,
      home_score_sd: indep.home_score_sd,
      away_score_sd: indep.away_score_sd,
    },
    market: marketBaseline,
    trustWeight,
  });

  // Layer 4b — injury reviewer
  const homeInjuries = countInjuriesByStatus(snap.home_injuries);
  const awayInjuries = countInjuriesByStatus(snap.away_injuries);
  if (homeInjuries.unknown > 0 || awayInjuries.unknown > 0) {
    integrityNotes.push(
      `Injury unknowns: home=${homeInjuries.unknown}, away=${awayInjuries.unknown} — confidence capped + Best Angle blocked.`,
    );
  }
  if (homeInjuries.out > 0 || awayInjuries.out > 0) {
    integrityNotes.push(
      `Out players noted: home=${homeInjuries.out}, away=${awayInjuries.out}. v0 does NOT adjust scores for specific players; impact captured via tier alone.`,
    );
  }

  // Layer 5 — picks + confidences
  const mlPick: "home" | "away" =
    posterior.posterior_spread >= 0 ? "home" : "away";
  const spreadPick: "home" | "away" =
    marketBaseline.spread_implied_home_pts !== null
      ? posterior.posterior_spread > marketBaseline.spread_implied_home_pts
        ? "home"
        : "away"
      : mlPick;
  const totalPick: "over" | "under" =
    marketBaseline.total_implied !== null
      ? posterior.posterior_total > marketBaseline.total_implied
        ? "over"
        : "under"
      : "over"; // arbitrary fallback when no market line; UI shows it as low-conf

  const mlConfidence = computeMarketConfidence({
    posteriorSpread: posterior.posterior_spread,
    marketSpread: marketBaseline.spread_implied_home_pts,
    posteriorTotal: posterior.posterior_total,
    marketTotal: marketBaseline.total_implied,
    tier,
    market: "ml",
  });
  const spreadConfidence = computeMarketConfidence({
    posteriorSpread: posterior.posterior_spread,
    marketSpread: marketBaseline.spread_implied_home_pts,
    posteriorTotal: posterior.posterior_total,
    marketTotal: marketBaseline.total_implied,
    tier,
    market: "spread",
  });
  const totalConfidence = computeMarketConfidence({
    posteriorSpread: posterior.posterior_spread,
    marketSpread: marketBaseline.spread_implied_home_pts,
    posteriorTotal: posterior.posterior_total,
    marketTotal: marketBaseline.total_implied,
    tier,
    market: "total",
  });

  // Best-Angle eligibility (v0 placeholders)
  const noMajorInjuryUnknowns =
    homeInjuries.unknown === 0 && awayInjuries.unknown === 0;
  const mlBestAngleEligible =
    tier === "high" &&
    noMajorInjuryUnknowns &&
    mlConfidence >= NBA_BEST_ANGLE_MIN_CONFIDENCE;

  // Series-context audit
  const series = snap.series;
  const closeoutPressure = series !== null
    ? series.is_elimination_for_home || series.is_elimination_for_away
    : false;
  if (series !== null && closeoutPressure) {
    integrityNotes.push(
      `Series closeout pressure detected (game ${series.game_number}, ${series.series_score_home}-${series.series_score_away}). v0 surfaces but does NOT adjust projection.`,
    );
  }

  void stage; // stage is recorded in output but doesn't change v0 logic

  return {
    game_external_id: snap.game_external_id,
    prediction_source: "auto_v0_nba_internal",
    predicted_home_score: posterior.posterior_home_score,
    predicted_away_score: posterior.posterior_away_score,
    predicted_total: posterior.posterior_total,
    predicted_spread_home: posterior.posterior_spread,
    predicted_ml_winner: mlPick,
    ml_confidence: mlConfidence,
    predicted_spread_side: spreadPick,
    spread_confidence: spreadConfidence,
    predicted_total_side: totalPick,
    total_confidence: totalConfidence,
    stage,
    provisional: true, // v0a is ALWAYS provisional
    audit: {
      independent_home_score: indep.home_score_mean,
      independent_away_score: indep.away_score_mean,
      independent_home_sd: indep.home_score_sd,
      independent_away_sd: indep.away_score_sd,
      market_total: marketBaseline.total_implied,
      market_spread_home: marketBaseline.spread_implied_home_pts,
      market_home_ml_no_vig: marketBaseline.ml_home_no_vig,
      market_away_ml_no_vig: marketBaseline.ml_away_no_vig,
      market_baseline_valid: marketBaseline.has_full_market,
      posterior_home_score: posterior.posterior_home_score,
      posterior_away_score: posterior.posterior_away_score,
      posterior_total: posterior.posterior_total,
      posterior_spread_home: posterior.posterior_spread,
      trust_independent: posterior.effective_trust_independent,
      data_quality_tier: tier,
      confidence_ceiling: NBA_CONFIDENCE_CEILING[tier],
      injury_unknown_count_home: homeInjuries.unknown,
      injury_unknown_count_away: awayInjuries.unknown,
      injury_out_count_home: homeInjuries.out,
      injury_out_count_away: awayInjuries.out,
      ml_pick: mlPick,
      ml_confidence: mlConfidence,
      ml_best_angle_eligible: mlBestAngleEligible,
      spread_pick: spreadPick,
      spread_confidence: spreadConfidence,
      total_pick: totalPick,
      total_confidence: totalConfidence,
      series_game_number: series?.game_number ?? null,
      series_score_home: series?.series_score_home ?? null,
      series_score_away: series?.series_score_away ?? null,
      series_closeout_pressure: closeoutPressure,
      series_venue_shift: series?.venue_shift ?? false,
      model_integrity_notes: integrityNotes,
      provisional: true,
    },
  };
}
