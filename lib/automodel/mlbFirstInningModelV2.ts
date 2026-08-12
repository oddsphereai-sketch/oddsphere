/**
 * Push 3B — MLB First-Inning V2 model (assembly).
 *
 * Layered architecture (mirrors full-game V2.2 conventions):
 *   Layer 1 — Independent FI probability (projectFiIndependent)
 *   Layer 2 — Market baseline                (computeFiMarketBaseline)
 *   Layer 3 — Adaptive posterior blend
 *   Layer 4 — Classification (NRFI / YRFI / Toss-Up / Held)
 *   Layer 5 — Play grade
 *
 * Output shape mirrors V2.2's audit object so the operator + shadow can
 * inspect every input. The classification is intentionally distinct from
 * the legacy `predicted_nrfi: boolean | null` column: we return both a
 * coarse boolean (for back-compat with the existing writer / Daily Edge)
 * AND a high-fidelity `fi_pick` enum that distinguishes Toss-Up from
 * Held cleanly.
 *
 * Pure / no DB / no network.
 */

import type { GameSnapshot } from "./types";
import {
  projectFiIndependent,
  type FiIndependentProjection,
  type FiFeatureAudit,
  type FiFeatureSource,
} from "./mlbFirstInningFeatureBuilder";
import {
  computeFiMarketBaseline,
  type FiMarketBaseline,
  type FiLineRow,
} from "./mlbFirstInningMarketBaseline";

// ─── trust coefficients (mirror V2.2 full-game) ──────────────────
const FI_TRUST_INDEPENDENT_HIGH = 0.65;
const FI_TRUST_INDEPENDENT_MEDIUM = 0.45;
const FI_TRUST_INDEPENDENT_LOW = 0.25;
const FI_TRUST_INDEPENDENT_NO_MARKET = 1.0;
const FI_TRUST_INDEPENDENT_SEVERE_MISSING = 0.05;

// Posterior NRFI probability never moves more than this many points from
// the market NRFI probability.
const FI_POSTERIOR_NRFI_CAP = 0.10;

// Confidence ceilings (0-100) by tier.
const FI_CONFIDENCE_CEILING = {
  high: 76,
  medium: 64,
  low: 58,
  fallback: 54,
} as const;
const FI_CONFIDENCE_FLOOR = 50;

// Classification cutoffs on posterior P(NRFI). Push 3B-3 calibration:
//
// Original band [0.45, 0.55] collapsed 67% of games to Toss-Up across a
// 3-slate calibration sweep (39 games), because most game posteriors
// cluster near 50% by design — the model's adaptive blend pulls
// independent toward market, and league-average matchups land close
// to baseline 55% NRFI ≈ 50% on either side.
//
// Narrowed to [0.48, 0.52] = ±2 points around 50%:
//   • Toss-Up rate drops from ~67% → ~36% (target 2-5 per 15-game slate)
//   • YRFI emerges (was 0 on 2026-06-06; now 3-4 per slate)
//   • Best Angle gates unchanged (edge ≥ 4% + tier high + market data)
//   • Held still earned only by fallback tier / severe missing
//
// True coin-flip games (49-51%) still receive Toss-Up. Directional
// signals at 52% NRFI / 48% NRFI become Lean picks, not Toss-Up.
const FI_NRFI_THRESHOLD = 0.52;
const FI_YRFI_THRESHOLD = 0.48;
const FI_TOSS_UP_MIN = FI_YRFI_THRESHOLD;
const FI_TOSS_UP_MAX = FI_NRFI_THRESHOLD;

// Best Angle gates (post-classification).
//
// 2026-07-11 grade-policy replay: the old absolute-edge FI gate let
// model-confidence rows through even when the picked side was negative value.
// Reserve Best Angle for signed positive edge with a playable picked-side
// price; 30-day replay favored the >=6pp signed-edge cohort.
const FI_BEST_ANGLE_MIN_EDGE_PCT = 6.0;
const FI_BEST_ANGLE_MIN_CONFIDENCE = 56;
const FI_BEST_ANGLE_MIN_PRICE_EXCLUSIVE = -130;
// MLB-P0 post-shrink large-edge backstop (abs edge %). FI is not
// probability-regularized in P0 (its market prob is null on ~100% of
// rows), but where a market line DOES exist an implausibly large
// posterior-vs-market gap is far more likely model-market disagreement
// than value → cap to lean + flag, never Best Angle.
const FI_BEST_ANGLE_MISCAL_CEILING_PCT = 10.0;

export type FiPick = "NRFI" | "YRFI" | "Toss-Up" | "Held";
export type FiPlayGrade = "best_angle" | "lean" | "toss_up" | "no_bet" | "held";

export type FiV2Audit = {
  // Layer 1
  independent_p_nrfi: number;
  independent_p_yrfi: number;
  away_lambda: number;
  home_lambda: number;
  away_p_score: number;
  home_p_score: number;
  data_quality_tier: "high" | "medium" | "low" | "fallback";
  feature_audit: FiFeatureAudit;
  // Layer 2
  market_listed_fi_total: number | null;
  market_yrfi_odds_american: number | null;
  market_nrfi_odds_american: number | null;
  market_yrfi_no_vig: number | null;
  market_nrfi_no_vig: number | null;
  market_data_quality: "ok" | "stale" | "missing";
  market_freshness: string | null;
  market_reason: string;
  // Layer 3
  trust_independent: number;
  posterior_p_nrfi: number;
  posterior_p_yrfi: number;
  posterior_capped: boolean;
  posterior_moved_from_market: number; // |posterior_nrfi - market_nrfi|, or 0 if no market
  // Layer 4
  fi_pick: FiPick;
  fi_confidence: number;
  fi_edge_pct: number | null;
  fi_pick_reason: string;
  // Layer 5
  fi_play_grade: FiPlayGrade;
  fi_play_grade_reason: string;
  fi_best_angle_eligible: boolean;
  /** MLB-P0: FI edge exceeded the post-shrink ceiling (capped to lean). */
  fi_miscalibration_flag: boolean;
  fi_no_bet_reason: string | null;
  fresh_data_ready: boolean;
  fresh_data_blockers: string[];
  // Misc
  provisional: boolean;
  integrity_notes: string[];
  /**
   * Forward-only RAW FI FEATURE CAPTURE (additive, 2026-06-15). Persists the
   * FI model's actual inputs (starter FI stats, top-order OPS, park, weather,
   * lambdas + per-team factors) for future attribution. Diagnostic only — does
   * NOT affect FI predictions/grades. Optional for back-compat.
   */
  feature_capture?: FiFeatureCapture | null;
};

export type FiFeatureCapture = {
  schema_version: string;
  data_quality_tier: string;
  starter: { home: FiStarterCapture | null; away: FiStarterCapture | null };
  top3_ops: { home: number | null; away: number | null };
  park: { park_factor_runs: number | null; is_dome: boolean } | null;
  weather: { temperature_f: number | null; wind_speed_mph: number | null; wind_direction_degrees: number | null; is_notable: boolean } | null;
  lambdas: { home: number; away: number };
  /** indep.per_team_factors — FI lambda component multipliers. */
  factors: unknown;
};
type FiStarterCapture = { player_id: number; throws: "L" | "R" | null; confirmed: boolean; first_inning_era: number | null; first_inning_starts: number | null; first_inning_whip: number | null; season_era: number | null };

function captureFiStarter(s: GameSnapshot["home_starter"]): FiStarterCapture | null {
  if (!s) return null;
  return { player_id: s.player_external_id, throws: s.throws, confirmed: s.is_confirmed, first_inning_era: s.first_inning_era, first_inning_starts: s.first_inning_starts, first_inning_whip: s.first_inning_whip, season_era: s.season_era };
}
function top3Ops(lineup: GameSnapshot["home_lineup_top8"]): number | null {
  const ops = lineup.slice(0, 3).map((b) => b.season_ops).filter((v): v is number => typeof v === "number");
  return ops.length ? ops.reduce((a, b) => a + b, 0) / ops.length : null;
}
function buildFiFeatureCapture(snap: GameSnapshot, factors: unknown, tier: string, homeLambda: number, awayLambda: number): FiFeatureCapture {
  return {
    schema_version: "fi_fc_v1",
    data_quality_tier: tier,
    starter: { home: captureFiStarter(snap.home_starter), away: captureFiStarter(snap.away_starter) },
    top3_ops: { home: top3Ops(snap.home_lineup_top8), away: top3Ops(snap.away_lineup_top8) },
    park: snap.ballpark ? { park_factor_runs: snap.ballpark.park_factor_runs, is_dome: snap.ballpark.is_dome } : null,
    weather: snap.weather ? { temperature_f: snap.weather.temperature_f, wind_speed_mph: snap.weather.wind_speed_mph, wind_direction_degrees: snap.weather.wind_direction_degrees, is_notable: snap.weather.is_notable } : null,
    lambdas: { home: homeLambda, away: awayLambda },
    factors: factors ?? null,
  };
}

export type FiV2Output = {
  /** Legacy back-compat boolean for the existing predicted_nrfi column.
   *  true  → NRFI pick
   *  false → YRFI pick
   *  null  → Held (caller decides; Toss-Up collapses to a NRFI-leaning
   *           boolean for downstream writers that don't speak Toss-Up,
   *           BUT the audit.fi_pick is the source of truth).
   */
  predicted_nrfi: boolean | null;
  /** 0-100 confidence in the pick (whichever side). */
  nrfi_confidence: number | null;
  /** Full audit object for storage in sport_specific. */
  fiV2Audit: FiV2Audit;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function selectTrustIndependent(args: {
  tier: "high" | "medium" | "low" | "fallback";
  missingCount: number;
  hasMarket: boolean;
}): number {
  if (!args.hasMarket) return FI_TRUST_INDEPENDENT_NO_MARKET;
  if (args.missingCount >= 6) return FI_TRUST_INDEPENDENT_SEVERE_MISSING;
  switch (args.tier) {
    case "high": return FI_TRUST_INDEPENDENT_HIGH;
    case "medium": return FI_TRUST_INDEPENDENT_MEDIUM;
    case "low": return FI_TRUST_INDEPENDENT_LOW;
    case "fallback": return FI_TRUST_INDEPENDENT_SEVERE_MISSING;
  }
}

function computeConfidence(args: {
  posterior_nrfi: number;
  tier: "high" | "medium" | "low" | "fallback";
}): number {
  // Distance from a coin flip on the chosen side, scaled to 50-100.
  const probSide = Math.max(args.posterior_nrfi, 1 - args.posterior_nrfi);
  let base = probSide * 100;
  base = Math.max(FI_CONFIDENCE_FLOOR, base);
  return clamp(base, FI_CONFIDENCE_FLOOR, FI_CONFIDENCE_CEILING[args.tier]);
}

/**
 * Run FI V2 for a single game.
 *
 * Pure function — no DB, no network. Pass in the GameSnapshot already
 * built by featureSnapshot + the pre-filtered FI line rows from `lines`.
 */
export function runMlbFirstInningModelV2(
  snap: GameSnapshot,
  fiLineRows: FiLineRow[],
): FiV2Output {
  const integrityNotes: string[] = [];

  // Layer 1
  const indep: FiIndependentProjection = projectFiIndependent(snap);

  // Layer 2
  const market: FiMarketBaseline = computeFiMarketBaseline(fiLineRows);
  const hasMarket =
    market.data_quality === "ok" &&
    market.nrfi_no_vig_prob !== null &&
    market.yrfi_no_vig_prob !== null;

  // Layer 3 — adaptive blend
  const trustIndep = selectTrustIndependent({
    tier: indep.data_quality_tier,
    missingCount: indep.feature_audit.missing_count,
    hasMarket,
  });
  const trustMarket = 1 - trustIndep;
  let posteriorNrfi = indep.p_nrfi;
  let posteriorCapped = false;
  let posteriorMovedFromMarket = 0;
  if (hasMarket && market.nrfi_no_vig_prob !== null) {
    posteriorNrfi = trustIndep * indep.p_nrfi + trustMarket * market.nrfi_no_vig_prob;
    posteriorMovedFromMarket = Math.abs(posteriorNrfi - market.nrfi_no_vig_prob);
    if (posteriorMovedFromMarket > FI_POSTERIOR_NRFI_CAP) {
      const sign = posteriorNrfi > market.nrfi_no_vig_prob ? 1 : -1;
      posteriorNrfi = market.nrfi_no_vig_prob + sign * FI_POSTERIOR_NRFI_CAP;
      posteriorCapped = true;
      integrityNotes.push("Posterior NRFI prob capped at ±10pts from market.");
    }
  }
  posteriorNrfi = clamp(posteriorNrfi, 0.02, 0.98);
  const posteriorYrfi = 1 - posteriorNrfi;

  const awayStarterFiPreferred = indep.feature_audit.away_starter_fi.source === "preferred";
  const homeStarterFiPreferred = indep.feature_audit.home_starter_fi.source === "preferred";
  const starterFiFullyPreferred = awayStarterFiPreferred && homeStarterFiPreferred;
  const starterFiSourcePublishable = (source: FiFeatureSource) =>
    source === "preferred" || source === "proxy";
  const provisional =
    !hasMarket ||
    indep.feature_audit.missing_count >= 5 ||
    indep.data_quality_tier === "fallback" ||
    !starterFiFullyPreferred;
  if (provisional && !hasMarket) integrityNotes.push("No FI market line; prediction marked provisional.");
  if (indep.feature_audit.missing_count >= 5) integrityNotes.push(`Sparse FI features (${indep.feature_audit.missing_count} missing).`);
  if (indep.data_quality_tier === "fallback") integrityNotes.push("FI tier=fallback (key starter missing).");
  if (!starterFiFullyPreferred && indep.data_quality_tier !== "fallback") {
    integrityNotes.push("Starter FI history uses a real season-ERA proxy; prediction is provisional and capped below Best Angle.");
  }

  const freshDataBlockers: string[] = [];
  if (!hasMarket) freshDataBlockers.push("fi_market_not_fresh_or_two_sided");
  if (!starterFiSourcePublishable(indep.feature_audit.away_starter_fi.source)) {
    freshDataBlockers.push(`away_batting_opposing_starter_fi_${indep.feature_audit.away_starter_fi.source}`);
  }
  if (!starterFiSourcePublishable(indep.feature_audit.home_starter_fi.source)) {
    freshDataBlockers.push(`home_batting_opposing_starter_fi_${indep.feature_audit.home_starter_fi.source}`);
  }
  const awayLineupPublishable =
    indep.feature_audit.away_lineup.source === "preferred" ||
    indep.feature_audit.away_lineup.source === "fallback_real";
  const homeLineupPublishable =
    indep.feature_audit.home_lineup.source === "preferred" ||
    indep.feature_audit.home_lineup.source === "fallback_real";
  if (!awayLineupPublishable) {
    freshDataBlockers.push(`away_lineup_${indep.feature_audit.away_lineup.source}`);
  }
  if (!homeLineupPublishable) {
    freshDataBlockers.push(`home_lineup_${indep.feature_audit.home_lineup.source}`);
  }
  const freshDataReady = freshDataBlockers.length === 0;
  const starterIdentityPresent =
    snap.away_starter !== null &&
    snap.home_starter !== null &&
    snap.away_starter.is_scratched !== true &&
    snap.home_starter.is_scratched !== true;
  const starterIdentityUnpublished =
    (snap.away_starter === null || snap.home_starter === null) &&
    snap.away_starter?.is_scratched !== true &&
    snap.home_starter?.is_scratched !== true;
  const starterHistoryOnlyBlockers =
    freshDataBlockers.length > 0 &&
    freshDataBlockers.every((reason) => reason.includes("opposing_starter_fi_"));
  const sparseNamedStarterTossUp =
    hasMarket &&
    starterIdentityPresent &&
    awayLineupPublishable &&
    homeLineupPublishable &&
    starterHistoryOnlyBlockers;
  const marketBackedUnpublishedStarterTossUp =
    hasMarket &&
    starterIdentityUnpublished &&
    awayLineupPublishable &&
    homeLineupPublishable &&
    starterHistoryOnlyBlockers;
  if (sparseNamedStarterTossUp) {
    integrityNotes.push("Named probable starters are present but FI/season history is sparse; prediction degraded to Toss-Up.");
  } else if (!marketBackedUnpublishedStarterTossUp && !freshDataReady) {
    integrityNotes.push(`FI held for fresh data: ${freshDataBlockers.join(", ")}.`);
  }

  // Layer 4 — classification
  let fi_pick: FiPick;
  let fi_pick_reason: string;
  if (sparseNamedStarterTossUp) {
    fi_pick = "Toss-Up";
    fi_pick_reason = "fi_toss_up_sparse_named_starter_history";
  } else if (marketBackedUnpublishedStarterTossUp) {
    fi_pick = "Toss-Up";
    fi_pick_reason = "fi_toss_up_market_backed_probable_unpublished";
  } else if (!freshDataReady) {
    fi_pick = "Held";
    fi_pick_reason = "fi_waiting_for_fresh_data";
  } else if (indep.data_quality_tier === "fallback" || indep.feature_audit.missing_count >= 6) {
    fi_pick = "Held";
    fi_pick_reason = "fi_no_bet_data_quality";
  } else if (posteriorNrfi >= FI_NRFI_THRESHOLD) {
    fi_pick = "NRFI";
    fi_pick_reason = "fi_p_nrfi_above_threshold";
  } else if (posteriorNrfi <= FI_YRFI_THRESHOLD) {
    fi_pick = "YRFI";
    fi_pick_reason = "fi_p_nrfi_below_threshold";
  } else if (posteriorNrfi >= FI_TOSS_UP_MIN && posteriorNrfi <= FI_TOSS_UP_MAX) {
    fi_pick = "Toss-Up";
    fi_pick_reason = "fi_toss_up_probability";
  } else {
    fi_pick = "Held";
    fi_pick_reason = "fi_no_bet_data_quality";
  }

  // Edge (only meaningful when both sides know which side they're picking)
  let fi_edge_pct: number | null = null;
  if (hasMarket && (fi_pick === "NRFI" || fi_pick === "YRFI")) {
    const pickSidePosterior = fi_pick === "NRFI" ? posteriorNrfi : posteriorYrfi;
    const pickSideMarket = fi_pick === "NRFI"
      ? (market.nrfi_no_vig_prob ?? 0.5)
      : (market.yrfi_no_vig_prob ?? 0.5);
    fi_edge_pct = (pickSidePosterior - pickSideMarket) * 100;
  }

  // Confidence
  const fi_confidence = fi_pick === "NRFI" || fi_pick === "YRFI"
    ? Math.round(computeConfidence({ posterior_nrfi: posteriorNrfi, tier: indep.data_quality_tier }) * 10) / 10
    : fi_pick === "Toss-Up"
      ? 50
      : 0;

  // Layer 5 — play grade
  let fi_play_grade: FiPlayGrade;
  let fi_play_grade_reason: string;
  let fi_no_bet_reason: string | null = null;
  let fi_best_angle_eligible = false;
  let fi_miscalibration_flag = false;
  const fiPickedOdds =
    fi_pick === "NRFI"
      ? market.nrfi_odds_american
      : fi_pick === "YRFI"
        ? market.yrfi_odds_american
        : null;
  const keyFeatureMissing =
    indep.feature_audit.away_starter_fi.source === "missing" ||
    indep.feature_audit.home_starter_fi.source === "missing";
  if (fi_pick === "Held") {
    fi_play_grade = "held";
    fi_play_grade_reason = fi_pick_reason;
    fi_no_bet_reason = "Held — data quality insufficient.";
  } else if (fi_pick === "Toss-Up") {
    fi_play_grade = "toss_up";
    fi_play_grade_reason = fi_pick_reason;
    fi_no_bet_reason = sparseNamedStarterTossUp
      ? "Toss-Up — named probable starters are available, but verified starter history is too sparse for a directional play."
      : "Toss-Up — model probability in the neutral band.";
  } else if (!hasMarket) {
    fi_play_grade = "lean";
    fi_play_grade_reason = "fi_best_angle_blocked_missing_market";
    fi_no_bet_reason = "No market line; lean only.";
  } else if (provisional || keyFeatureMissing) {
    fi_play_grade = "lean";
    fi_play_grade_reason = "fi_best_angle_blocked_fallback";
    fi_no_bet_reason = "Provisional / key feature missing; lean only.";
  } else if (fi_edge_pct !== null && fi_edge_pct < 0) {
    fi_play_grade = "no_bet";
    fi_play_grade_reason = "fi_no_bet_negative_edge";
    fi_no_bet_reason = `Negative FI edge (${fi_edge_pct.toFixed(1)}%); market price is richer than the model.`;
  } else if (
    fi_edge_pct !== null &&
    fi_edge_pct > FI_BEST_ANGLE_MISCAL_CEILING_PCT
  ) {
    // MLB-P0: implausibly large FI edge → possible model-market
    // disagreement, not a top play. Cap to lean + flag.
    fi_play_grade = "lean";
    fi_play_grade_reason = "fi_best_angle_blocked_miscalibration";
    fi_no_bet_reason = `Large FI model-market gap (edge ${fi_edge_pct.toFixed(1)}%); possible calibration disagreement — lean only.`;
    fi_miscalibration_flag = true;
  } else if (
    fi_edge_pct !== null &&
    fi_edge_pct >= FI_BEST_ANGLE_MIN_EDGE_PCT &&
    fi_confidence >= FI_BEST_ANGLE_MIN_CONFIDENCE &&
    fiPickedOdds !== null &&
    fiPickedOdds > FI_BEST_ANGLE_MIN_PRICE_EXCLUSIVE
  ) {
    fi_play_grade = "best_angle";
    fi_play_grade_reason = "fi_best_angle_edge";
    fi_best_angle_eligible = true;
  } else if (fi_edge_pct !== null && fi_edge_pct >= 1.5) {
    fi_play_grade = "lean";
    fi_play_grade_reason = "fi_lean_edge";
  } else {
    fi_play_grade = "no_bet";
    fi_play_grade_reason = "fi_no_bet_low_edge";
    fi_no_bet_reason = "Edge too thin; no bet.";
  }

  // Legacy boolean for predicted_nrfi
  let legacyPredictedNrfi: boolean | null;
  if (fi_pick === "NRFI") legacyPredictedNrfi = true;
  else if (fi_pick === "YRFI") legacyPredictedNrfi = false;
  else if (fi_pick === "Toss-Up") legacyPredictedNrfi = true; // collapse to lean-NRFI for legacy writers; audit.fi_pick is truth
  else legacyPredictedNrfi = null; // Held

  const audit: FiV2Audit = {
    independent_p_nrfi: indep.p_nrfi,
    independent_p_yrfi: indep.p_yrfi,
    away_lambda: indep.away_lambda,
    home_lambda: indep.home_lambda,
    away_p_score: indep.away_p_score,
    home_p_score: indep.home_p_score,
    data_quality_tier: indep.data_quality_tier,
    feature_audit: indep.feature_audit,
    market_listed_fi_total: market.listed_fi_total,
    market_yrfi_odds_american: market.yrfi_odds_american,
    market_nrfi_odds_american: market.nrfi_odds_american,
    market_yrfi_no_vig: market.yrfi_no_vig_prob,
    market_nrfi_no_vig: market.nrfi_no_vig_prob,
    market_data_quality: market.data_quality,
    market_freshness: market.freshness,
    market_reason: market.reason,
    trust_independent: trustIndep,
    posterior_p_nrfi: posteriorNrfi,
    posterior_p_yrfi: posteriorYrfi,
    posterior_capped: posteriorCapped,
    posterior_moved_from_market: posteriorMovedFromMarket,
    fi_pick,
    fi_confidence,
    fi_edge_pct,
    fi_pick_reason,
    fi_play_grade,
    fi_play_grade_reason,
    fi_best_angle_eligible,
    fi_miscalibration_flag,
    fi_no_bet_reason,
    fresh_data_ready: freshDataReady,
    fresh_data_blockers: freshDataBlockers,
    provisional,
    integrity_notes: integrityNotes,
    feature_capture: buildFiFeatureCapture(
      snap,
      (indep as { per_team_factors?: unknown }).per_team_factors ?? null,
      indep.data_quality_tier,
      indep.home_lambda,
      indep.away_lambda,
    ),
  };

  return {
    predicted_nrfi: legacyPredictedNrfi,
    nrfi_confidence: fi_pick === "Held" ? null : fi_confidence,
    fiV2Audit: audit,
  };
}

export const __TEST__ = {
  FI_NRFI_THRESHOLD,
  FI_YRFI_THRESHOLD,
  FI_BEST_ANGLE_MIN_EDGE_PCT,
  FI_BEST_ANGLE_MIN_CONFIDENCE,
  FI_POSTERIOR_NRFI_CAP,
  selectTrustIndependent,
  computeConfidence,
};
