/**
 * Phase 7C — NBA v1 active preview model.
 *
 * Pure function. No DB, no network. Composes:
 *
 *   Step 1 — possessions (blended pace, regular + playoff shrinkage)
 *   Step 2 — baseline efficiency (ORtg vs DRtg, vs league avg)
 *   Step 3 — Four Factors capped modifier (Oliver weights, ±3 pp100 budget)
 *   Step 4 — recency/playoff Bayesian blend (built into Steps 1-2)
 *   Step 5 — injury reviewer (confidence cap; NO numeric impact yet)
 *   Step 6 — home/rest/series context (bounded)
 *   Step 7 — final score projection
 *   Step 8 — distribution → ML / spread / total probabilities (independent)
 *   Step 9 — market as benchmark (no blending into score)
 *   Step 10 — per-market grading (handled by service layer + nbaMarketReview)
 *
 * v0 preservation: `runNbaAutoModelV1` (the existing v0 orchestrator)
 * is untouched. The API route calls both, surfaces v1 as the active
 * preview projection, and exposes v0 in the audit/comparison script.
 *
 * ⚠ ADMIN/AUDIT-ONLY TERMINOLOGY in all logs and outputs labeled
 * "v1", "research-prior", "calibration pending". Member-facing UI
 * must never surface these tokens (see types.ts NBA_MODEL_VERSION_V1).
 */

import { runNbaAutoModelV1 } from "./nbaAutoModelV1";
import {
  V1_AUDIT_FLAG_ML_DELTA_PP,
  V1_AUDIT_FLAG_SPREAD_DELTA_PT,
  V1_AUDIT_FLAG_TOTAL_DELTA_PT,
  V1_BEST_ANGLE_MIN_CONFIDENCE,
  V1_CAP_LIMITED_BOOK_COVERAGE,
  V1_CAP_MAJOR_OUT,
  V1_CAP_MAJOR_UNKNOWN,
  V1_CAP_NO_MARKET,
  V1_CONFIDENCE_CEILING,
  V1_CONFIDENCE_FLOOR,
  V1_FF_BUDGET_PP100,
  V1_FF_PER_FACTOR_CAP_PP100,
  V1_FF_PP100_SCALES,
  V1_FF_WEIGHTS,
  V1_HCA_PLAYOFFS,
  V1_HCA_REGULAR_SEASON,
  V1_LEAGUE_AVG_DEF_RATING,
  V1_LEAGUE_AVG_OFF_RATING,
  V1_LEAGUE_AVG_PACE,
  V1_LEAGUE_AVG_PP100,
  V1_MARGIN_SD,
  V1_PLAYOFF_WEIGHT_MAX,
  V1_RECENCY_SHRINKAGE_K,
  V1_REST_DELTA_MAX,
  V1_REST_DELTA_PP_GAME,
  V1_SD_INFLATION_INJURY_UNKNOWN,
  V1_SD_INFLATION_LIMITED_BOOKS,
  V1_TOTAL_SD,
} from "./nbaFeatureWeights";
import {
  computeNbaMarketProbabilities,
  type NbaMarketProbabilities,
} from "./nbaDistribution";
import {
  NBA_MODEL_VERSION_V1,
  type NbaAutoModelOutput,
  type NbaDataQualityTier,
  type NbaFourFactors,
  type NbaGameSnapshot,
  type NbaModelStage,
  type NbaPlayerInjury,
  type NbaTeamRatingPack,
  type NbaTeamSnapshot,
} from "./types";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
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
  if (!snap.data_quality.ratings_present) return "fallback";
  const homeKnown = snap.data_quality.home_injuries_known;
  const awayKnown = snap.data_quality.away_injuries_known;
  const market = snap.data_quality.market_present;
  if (homeKnown && awayKnown && market) return "high";
  if ((homeKnown && awayKnown) || market) return "medium";
  return "low";
}

// ─────────────────────────────────────────────────────────────
// Step 4 — recency/playoff blend with Bayesian shrinkage
// ─────────────────────────────────────────────────────────────

type BlendedPack = {
  off_rating: number | null;
  def_rating: number | null;
  pace: number | null;
  four_factors: NbaFourFactors | null;
  playoff_weight: number;
  season_weight: number;
  playoff_games: number | null;
  used_packs: {
    has_regular: boolean;
    has_playoff: boolean;
  };
};

function blendField(
  regular: number | null,
  playoff: number | null,
  playoffWeight: number,
): number | null {
  if (regular === null && playoff === null) return null;
  if (regular === null) return playoff;
  if (playoff === null) return regular;
  return regular * (1 - playoffWeight) + playoff * playoffWeight;
}

function blendFourFactors(
  regular: NbaFourFactors | null,
  playoff: NbaFourFactors | null,
  playoffWeight: number,
): NbaFourFactors | null {
  if (regular === null && playoff === null) return null;
  return {
    off_efg_pct: blendField(regular?.off_efg_pct ?? null, playoff?.off_efg_pct ?? null, playoffWeight),
    off_tov_pct: blendField(regular?.off_tov_pct ?? null, playoff?.off_tov_pct ?? null, playoffWeight),
    off_orb_pct: blendField(regular?.off_orb_pct ?? null, playoff?.off_orb_pct ?? null, playoffWeight),
    off_ft_rate: blendField(regular?.off_ft_rate ?? null, playoff?.off_ft_rate ?? null, playoffWeight),
    def_efg_pct: blendField(regular?.def_efg_pct ?? null, playoff?.def_efg_pct ?? null, playoffWeight),
    def_tov_pct: blendField(regular?.def_tov_pct ?? null, playoff?.def_tov_pct ?? null, playoffWeight),
    def_drb_pct: blendField(regular?.def_drb_pct ?? null, playoff?.def_drb_pct ?? null, playoffWeight),
    def_ft_rate_allowed: blendField(
      regular?.def_ft_rate_allowed ?? null,
      playoff?.def_ft_rate_allowed ?? null,
      playoffWeight,
    ),
  };
}

function recencyPlayoffBlend(team: NbaTeamSnapshot): BlendedPack {
  const reg: NbaTeamRatingPack | null = team.regular_season_ratings;
  const post: NbaTeamRatingPack | null = team.playoff_ratings;

  if (reg === null && post === null) {
    // v0 fallback: legacy single-rating fields on the snapshot.
    return {
      off_rating: team.off_rating,
      def_rating: team.def_rating,
      pace: team.pace,
      four_factors: null,
      playoff_weight: 0,
      season_weight: 1,
      playoff_games: null,
      used_packs: { has_regular: false, has_playoff: false },
    };
  }

  const playoffGames = post?.sample_games ?? 0;
  let playoffWeight = playoffGames / (playoffGames + V1_RECENCY_SHRINKAGE_K);
  if (post === null) playoffWeight = 0;
  if (reg === null) playoffWeight = 1;
  playoffWeight = clamp(playoffWeight, 0, V1_PLAYOFF_WEIGHT_MAX);
  const seasonWeight = 1 - playoffWeight;

  return {
    off_rating: blendField(reg?.off_rating ?? null, post?.off_rating ?? null, playoffWeight),
    def_rating: blendField(reg?.def_rating ?? null, post?.def_rating ?? null, playoffWeight),
    pace: blendField(reg?.pace ?? null, post?.pace ?? null, playoffWeight),
    four_factors: blendFourFactors(reg?.four_factors ?? null, post?.four_factors ?? null, playoffWeight),
    playoff_weight: playoffWeight,
    season_weight: seasonWeight,
    playoff_games: post?.sample_games ?? null,
    used_packs: { has_regular: reg !== null, has_playoff: post !== null },
  };
}

// ─────────────────────────────────────────────────────────────
// Step 3 — Four Factors capped modifier (Oliver budget)
// ─────────────────────────────────────────────────────────────

type FfDeltas = {
  efg_delta_pp100: number;
  tov_delta_pp100: number;
  orb_delta_pp100: number;
  ft_delta_pp100: number;
  weighted_pre_cap_pp100: number;
  capped_modifier_pp100: number;
  available_factors_count: number;
  shrinkage_applied: boolean;
};

/**
 * Compute the team's Four Factors modifier in pp100 from team offense
 * vs opponent defense. Each individual delta is capped at ±2 pp100
 * before weighting. Missing factors shrink the weighted sum
 * proportionally toward 0 (rather than hard-capping at full budget).
 */
function computeFourFactorsModifier(
  teamOff: NbaFourFactors | null,
  oppDef: NbaFourFactors | null,
): FfDeltas {
  if (teamOff === null || oppDef === null) {
    return {
      efg_delta_pp100: 0,
      tov_delta_pp100: 0,
      orb_delta_pp100: 0,
      ft_delta_pp100: 0,
      weighted_pre_cap_pp100: 0,
      capped_modifier_pp100: 0,
      available_factors_count: 0,
      shrinkage_applied: true,
    };
  }

  // Each factor: positive = good for the offense.
  //   eFG:    team_off_efg - opp_def_efg            (higher own / lower opp)
  //   TOV:    opp_def_tov - team_off_tov            (lower own TOV; higher opp forced TOV)
  //   ORB:    team_off_orb - (1 - opp_def_drb)      (own ORB vs opp's ORB allowed = 1 - DRB)
  //   FT:     team_off_ft - opp_def_ft_allowed       (higher own; lower opp allowed)
  //
  // Values are decimals (0..1). Convert percentage-point delta * 100 →
  // raw pp delta, then multiply by per-factor scale, then cap.

  const efgPp =
    teamOff.off_efg_pct !== null && oppDef.def_efg_pct !== null
      ? (teamOff.off_efg_pct - oppDef.def_efg_pct) * 100
      : null;
  const tovPp =
    teamOff.off_tov_pct !== null && oppDef.def_tov_pct !== null
      ? (oppDef.def_tov_pct - teamOff.off_tov_pct) * 100
      : null;
  const orbPp =
    teamOff.off_orb_pct !== null && oppDef.def_drb_pct !== null
      ? (teamOff.off_orb_pct - (1 - oppDef.def_drb_pct)) * 100
      : null;
  const ftPp =
    teamOff.off_ft_rate !== null && oppDef.def_ft_rate_allowed !== null
      ? (teamOff.off_ft_rate - oppDef.def_ft_rate_allowed) * 100
      : null;

  const efg =
    efgPp === null
      ? 0
      : clamp(efgPp * V1_FF_PP100_SCALES.efg, -V1_FF_PER_FACTOR_CAP_PP100, V1_FF_PER_FACTOR_CAP_PP100);
  const tov =
    tovPp === null
      ? 0
      : clamp(tovPp * V1_FF_PP100_SCALES.tov, -V1_FF_PER_FACTOR_CAP_PP100, V1_FF_PER_FACTOR_CAP_PP100);
  const orb =
    orbPp === null
      ? 0
      : clamp(orbPp * V1_FF_PP100_SCALES.orb, -V1_FF_PER_FACTOR_CAP_PP100, V1_FF_PER_FACTOR_CAP_PP100);
  const ft =
    ftPp === null
      ? 0
      : clamp(ftPp * V1_FF_PP100_SCALES.ft, -V1_FF_PER_FACTOR_CAP_PP100, V1_FF_PER_FACTOR_CAP_PP100);

  const availableCount = [efgPp, tovPp, orbPp, ftPp].filter((x) => x !== null).length;

  // Sum of available weight shares — used to shrink the total when
  // some factors are missing (so a one-factor-only modifier can't
  // claim the full 0..1 weight budget).
  const availableWeightShare =
    (efgPp !== null ? V1_FF_WEIGHTS.efg : 0) +
    (tovPp !== null ? V1_FF_WEIGHTS.tov : 0) +
    (orbPp !== null ? V1_FF_WEIGHTS.orb : 0) +
    (ftPp !== null ? V1_FF_WEIGHTS.ft : 0);

  const weighted =
    efg * V1_FF_WEIGHTS.efg +
    tov * V1_FF_WEIGHTS.tov +
    orb * V1_FF_WEIGHTS.orb +
    ft * V1_FF_WEIGHTS.ft;

  // When some factors are missing, the budget cap shrinks proportionally.
  // E.g. if only eFG (40%) is available, cap = 0.40 × FF_BUDGET = 1.2 pp100.
  const effectiveBudget = V1_FF_BUDGET_PP100 * availableWeightShare;
  const capped = clamp(weighted, -effectiveBudget, effectiveBudget);

  return {
    efg_delta_pp100: efg,
    tov_delta_pp100: tov,
    orb_delta_pp100: orb,
    ft_delta_pp100: ft,
    weighted_pre_cap_pp100: weighted,
    capped_modifier_pp100: capped,
    available_factors_count: availableCount,
    shrinkage_applied: availableWeightShare < 1.0,
  };
}

// ─────────────────────────────────────────────────────────────
// Step 6 — context (rest / venue / series) — bounded
// ─────────────────────────────────────────────────────────────

type ContextModifier = {
  hca_pts: number;
  rest_diff_pts: number;
  series_note: string;
};

function buildContext(
  snap: NbaGameSnapshot,
  isPlayoffs: boolean,
): ContextModifier {
  const hca = isPlayoffs ? V1_HCA_PLAYOFFS : V1_HCA_REGULAR_SEASON;
  const series = snap.series;
  let restDiff = 0;
  let note = "";
  if (series !== null && series.days_rest_home !== null && series.days_rest_away !== null) {
    const d = series.days_rest_home - series.days_rest_away;
    restDiff = clamp(d * V1_REST_DELTA_PP_GAME, -V1_REST_DELTA_MAX, V1_REST_DELTA_MAX);
    if (series.venue_shift) note = `Venue shift (Game ${series.game_number}); context-only, no point shift.`;
    if (series.is_elimination_for_home || series.is_elimination_for_away) {
      note = `${note} Closeout pressure flagged (context-only, no point shift).`.trim();
    }
  }
  return { hca_pts: hca, rest_diff_pts: restDiff, series_note: note };
}

// ─────────────────────────────────────────────────────────────
// Step 5 — injury reviewer (confidence cap only, NO numeric impact)
// ─────────────────────────────────────────────────────────────

type InjuryReview = {
  confidence_cap: number | null;
  reasons: string[];
  major_out_count: number;
  major_unknown_count: number;
};

function reviewInjuries(snap: NbaGameSnapshot): InjuryReview {
  const home = countInjuriesByStatus(snap.home_injuries);
  const away = countInjuriesByStatus(snap.away_injuries);
  const reasons: string[] = [];
  let cap: number | null = null;
  const majorOut = home.out + away.out;
  const majorUnknown = home.unknown + away.unknown;
  if (majorOut > 0) {
    reasons.push(
      `${majorOut} OUT player(s) reported via ESPN — confidence capped at ${V1_CAP_MAJOR_OUT} (no numeric impact applied; BPM ingest deferred).`,
    );
    cap = cap === null ? V1_CAP_MAJOR_OUT : Math.min(cap, V1_CAP_MAJOR_OUT);
  }
  if (majorUnknown > 0) {
    reasons.push(
      `${majorUnknown} UNKNOWN availability — confidence capped at ${V1_CAP_MAJOR_UNKNOWN}.`,
    );
    cap = cap === null ? V1_CAP_MAJOR_UNKNOWN : Math.min(cap, V1_CAP_MAJOR_UNKNOWN);
  }
  if (!snap.data_quality.home_injuries_known || !snap.data_quality.away_injuries_known) {
    reasons.push("Injury source not enabled for one or both teams — treat as data risk.");
    cap = cap === null ? V1_CAP_MAJOR_UNKNOWN : Math.min(cap, V1_CAP_MAJOR_UNKNOWN);
  }
  return {
    confidence_cap: cap,
    reasons,
    major_out_count: majorOut,
    major_unknown_count: majorUnknown,
  };
}

// ─────────────────────────────────────────────────────────────
// Per-market confidence (v1)
// ─────────────────────────────────────────────────────────────

/**
 * Map a probability to a 50–100 confidence in research-prior fashion:
 * 50% = no-edge baseline; 60% = ~60 confidence; 75% = ~75. Linear-ish.
 * Capped by tier ceiling and applied caps.
 */
function probabilityToConfidence(
  prob: number,
  tier: NbaDataQualityTier,
  caps: number[],
): number {
  // Confidence is bigger of the pick-side probability and 50 (no flip).
  const raw = Math.max(prob, 1 - prob) * 100;
  const ceiling = V1_CONFIDENCE_CEILING[tier];
  const allCaps = [ceiling, ...caps];
  const effectiveCeiling = Math.min(...allCaps);
  return clamp(round1(raw), V1_CONFIDENCE_FLOOR, effectiveCeiling);
}

// ─────────────────────────────────────────────────────────────
// Public v1 output (extends v0 shape + adds v1-specific audit)
// ─────────────────────────────────────────────────────────────

export type NbaModelV1Output = NbaAutoModelOutput & {
  /** ADMIN/AUDIT-ONLY: marks this output as the v1 research-prior model. */
  model_version_v1: typeof NBA_MODEL_VERSION_V1;
  /** ADMIN/AUDIT-ONLY: research priors not yet backtested. */
  calibration_status: "pending";
  v1_breakdown: NbaModelV1Breakdown;
  v1_probabilities: NbaMarketProbabilities;
  /**
   * The v0 prediction this v1 result was compared against. Always
   * present; lets the audit script + admin UI render v0/v1 deltas
   * without re-running v0 separately.
   */
  v0_comparison: NbaAutoModelOutput;
  v0_v1_delta: {
    spread_pts: number;
    total_pts: number;
    ml_home_prob_pp: number;
    flagged: string[];
  };
};

export type NbaModelV1Breakdown = {
  // Step 1 — possessions
  pace_home_blended: number | null;
  pace_away_blended: number | null;
  pace_used: number;
  projected_possessions: number;
  // Step 2 — baseline efficiency
  home_off_rating_blended: number | null;
  home_def_rating_blended: number | null;
  away_off_rating_blended: number | null;
  away_def_rating_blended: number | null;
  home_baseline_pp100: number;
  away_baseline_pp100: number;
  // Step 3 — Four Factors per team
  home_ff: FfDeltas;
  away_ff: FfDeltas;
  // Step 4 — recency blend
  home_recency: {
    playoff_weight: number;
    season_weight: number;
    playoff_games: number | null;
    has_regular: boolean;
    has_playoff: boolean;
  };
  away_recency: {
    playoff_weight: number;
    season_weight: number;
    playoff_games: number | null;
    has_regular: boolean;
    has_playoff: boolean;
  };
  // Step 5 — injury review
  injury_review: InjuryReview;
  // Step 6 — context
  context: ContextModifier;
  // Step 7 — final
  home_final_pp100: number;
  away_final_pp100: number;
  // Step 9 — applied caps + tier
  data_quality_tier: NbaDataQualityTier;
  applied_caps: { source: string; cap: number }[];
  notes: string[];
};

// ─────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────

export function runNbaAutoModelV2(
  snap: NbaGameSnapshot,
  stage: NbaModelStage,
  opts: { isPlayoffs?: boolean; bookCount?: number } = {},
): NbaModelV1Output {
  const isPlayoffs = opts.isPlayoffs ?? true;
  const notes: string[] = [];

  // Step 4 first (blend feeds Steps 1-3)
  const homeBlend = recencyPlayoffBlend(snap.home_team);
  const awayBlend = recencyPlayoffBlend(snap.away_team);

  // Step 1 — possessions
  const paceH = homeBlend.pace ?? V1_LEAGUE_AVG_PACE;
  const paceA = awayBlend.pace ?? V1_LEAGUE_AVG_PACE;
  const paceUsed = (paceH + paceA) / 2;
  const projectedPossessions = paceUsed;

  // Step 2 — baseline efficiency (per 100 possessions). Classic
  // Pythagorean-style team-vs-team blend:
  //
  //   expected_pp100 = league_avg
  //                  + (team_off - league_avg_off)     // team's own offense above/below avg
  //                  + (opp_def  - league_avg_def)     // opponent's defense (DRtg is pp100
  //                                                    //   ALLOWED — higher = worse defense)
  //
  // When opp_def < league_avg (better defense), the second term is
  // NEGATIVE and pulls the projection down. That sign is critical;
  // an earlier version subtracted instead of added, which inverted
  // the defensive effect and inflated projections.
  const homeOff = homeBlend.off_rating ?? V1_LEAGUE_AVG_OFF_RATING;
  const homeDef = homeBlend.def_rating ?? V1_LEAGUE_AVG_DEF_RATING;
  const awayOff = awayBlend.off_rating ?? V1_LEAGUE_AVG_OFF_RATING;
  const awayDef = awayBlend.def_rating ?? V1_LEAGUE_AVG_DEF_RATING;
  const homeBaselinePp100 =
    V1_LEAGUE_AVG_PP100 + (homeOff - V1_LEAGUE_AVG_OFF_RATING) + (awayDef - V1_LEAGUE_AVG_DEF_RATING);
  const awayBaselinePp100 =
    V1_LEAGUE_AVG_PP100 + (awayOff - V1_LEAGUE_AVG_OFF_RATING) + (homeDef - V1_LEAGUE_AVG_DEF_RATING);

  // Step 3 — Four Factors modifier per team
  const homeFf = computeFourFactorsModifier(homeBlend.four_factors, awayBlend.four_factors);
  const awayFf = computeFourFactorsModifier(awayBlend.four_factors, homeBlend.four_factors);

  // Step 5 — injury review (no numeric impact; cap collected for Step 9)
  const injuryReview = reviewInjuries(snap);
  if (injuryReview.confidence_cap !== null) {
    notes.push(...injuryReview.reasons);
  }

  // Step 6 — context modifier
  const context = buildContext(snap, isPlayoffs);
  if (context.series_note !== "") notes.push(context.series_note);

  // Step 7 — final score projection
  // Per-team final pp100 = baseline + four-factors modifier (capped)
  // HCA + rest applied as point shifts to home (split symmetrically would
  // double-shift; we apply HCA fully to home and the rest delta to home).
  const homeFinalPp100 = homeBaselinePp100 + homeFf.capped_modifier_pp100;
  const awayFinalPp100 = awayBaselinePp100 + awayFf.capped_modifier_pp100;
  const possFactor = projectedPossessions / 100;
  const homePointsRaw = homeFinalPp100 * possFactor;
  const awayPointsRaw = awayFinalPp100 * possFactor;
  const homePoints = homePointsRaw + context.hca_pts / 2 + context.rest_diff_pts;
  const awayPoints = awayPointsRaw - context.hca_pts / 2 - context.rest_diff_pts;
  const projectedTotal = homePoints + awayPoints;
  const projectedHomeMargin = homePoints - awayPoints;
  // Spread is HOME-perspective negative-when-favored, like market convention.
  const projectedSpreadHome = -projectedHomeMargin;

  // Step 8 — distribution → independent probabilities (per market)
  const tier = deriveTier(snap);
  const limitedBooks = (opts.bookCount ?? 99) <= 2;
  const inflations = {
    injury_unknown:
      injuryReview.major_unknown_count > 0 || !snap.data_quality.home_injuries_known || !snap.data_quality.away_injuries_known
        ? V1_SD_INFLATION_INJURY_UNKNOWN
        : 0,
    limited_books: limitedBooks ? V1_SD_INFLATION_LIMITED_BOOKS : 0,
  };
  const probabilities = computeNbaMarketProbabilities({
    projected_home_margin: projectedHomeMargin,
    projected_total: projectedTotal,
    market_spread_home: snap.market.spread.home_line,
    market_total: snap.market.total.line,
    margin_sd_base: V1_MARGIN_SD,
    total_sd_base: V1_TOTAL_SD,
    sd_inflations: inflations,
  });

  // Step 10 — picks + confidence (independent per market)
  const mlPick: "home" | "away" = projectedHomeMargin >= 0 ? "home" : "away";
  const spreadPick: "home" | "away" =
    probabilities.spread_home_cover_prob !== null
      ? probabilities.spread_home_cover_prob >= 0.5
        ? "home"
        : "away"
      : mlPick;
  const totalPick: "over" | "under" =
    probabilities.total_over_prob !== null
      ? probabilities.total_over_prob >= 0.5
        ? "over"
        : "under"
      : projectedTotal >= (snap.market.total.line ?? projectedTotal)
        ? "over"
        : "under";

  // Step 9 — apply caps to confidence
  const appliedCaps: { source: string; cap: number }[] = [];
  if (injuryReview.confidence_cap !== null) {
    appliedCaps.push({ source: "injury", cap: injuryReview.confidence_cap });
  }
  if (limitedBooks) {
    appliedCaps.push({ source: "limited_books", cap: V1_CAP_LIMITED_BOOK_COVERAGE });
  }
  if (!snap.data_quality.market_present) {
    appliedCaps.push({ source: "no_market", cap: V1_CAP_NO_MARKET });
  }

  const mlProb = mlPick === "home" ? probabilities.ml_home_win_prob : probabilities.ml_away_win_prob;
  const spreadProb =
    probabilities.spread_home_cover_prob !== null
      ? spreadPick === "home"
        ? probabilities.spread_home_cover_prob
        : probabilities.spread_away_cover_prob!
      : 0.5;
  const totalProb =
    probabilities.total_over_prob !== null
      ? totalPick === "over"
        ? probabilities.total_over_prob
        : probabilities.total_under_prob!
      : 0.5;
  const capValues = appliedCaps.map((c) => c.cap);
  const mlConfidence = probabilityToConfidence(mlProb, tier, capValues);
  const spreadConfidence = probabilityToConfidence(spreadProb, tier, capValues);
  const totalConfidence = probabilityToConfidence(totalProb, tier, capValues);

  // Best-Angle eligibility (ML only — same gate as v0; spread/total
  // use the per-market grading service downstream)
  const mlBestAngleEligible =
    tier === "high" &&
    injuryReview.major_out_count === 0 &&
    injuryReview.major_unknown_count === 0 &&
    !limitedBooks &&
    mlConfidence >= V1_BEST_ANGLE_MIN_CONFIDENCE;

  // Compose v0 result for comparison
  const v0 = runNbaAutoModelV1(snap, stage);
  const flagged: string[] = [];
  const spreadDelta = projectedSpreadHome - v0.predicted_spread_home;
  const totalDelta = projectedTotal - v0.predicted_total;
  const v0HomeProb = v0.predicted_ml_winner === "home" ? v0.ml_confidence / 100 : 1 - v0.ml_confidence / 100;
  const mlHomeProbDeltaPp = (probabilities.ml_home_win_prob - v0HomeProb) * 100;
  if (Math.abs(spreadDelta) > V1_AUDIT_FLAG_SPREAD_DELTA_PT) {
    flagged.push(`spread Δ ${spreadDelta.toFixed(1)}pt > ${V1_AUDIT_FLAG_SPREAD_DELTA_PT}pt threshold`);
  }
  if (Math.abs(totalDelta) > V1_AUDIT_FLAG_TOTAL_DELTA_PT) {
    flagged.push(`total Δ ${totalDelta.toFixed(1)}pt > ${V1_AUDIT_FLAG_TOTAL_DELTA_PT}pt threshold`);
  }
  if (Math.abs(mlHomeProbDeltaPp) > V1_AUDIT_FLAG_ML_DELTA_PP) {
    flagged.push(`ML(home) prob Δ ${mlHomeProbDeltaPp.toFixed(1)}pp > ${V1_AUDIT_FLAG_ML_DELTA_PP}pp threshold`);
  }
  if (v0.predicted_ml_winner !== mlPick) {
    flagged.push(`ML pick flipped vs v0 (v0=${v0.predicted_ml_winner}, v1=${mlPick})`);
  }
  if (v0.predicted_spread_side !== spreadPick) {
    flagged.push(`spread pick flipped vs v0 (v0=${v0.predicted_spread_side}, v1=${spreadPick})`);
  }
  if (v0.predicted_total_side !== totalPick) {
    flagged.push(`total pick flipped vs v0 (v0=${v0.predicted_total_side}, v1=${totalPick})`);
  }

  return {
    game_external_id: snap.game_external_id,
    prediction_source: NBA_MODEL_VERSION_V1 as unknown as NbaAutoModelOutput["prediction_source"],
    predicted_home_score: round1(homePoints),
    predicted_away_score: round1(awayPoints),
    predicted_total: round1(projectedTotal),
    predicted_spread_home: round1(projectedSpreadHome),
    predicted_ml_winner: mlPick,
    ml_confidence: mlConfidence,
    predicted_spread_side: spreadPick,
    spread_confidence: spreadConfidence,
    predicted_total_side: totalPick,
    total_confidence: totalConfidence,
    stage,
    provisional: true,
    audit: {
      independent_home_score: round1(homePointsRaw),
      independent_away_score: round1(awayPointsRaw),
      independent_home_sd: V1_MARGIN_SD,
      independent_away_sd: V1_MARGIN_SD,
      market_total: snap.market.total.line,
      market_spread_home: snap.market.spread.home_line,
      market_home_ml_no_vig: null,
      market_away_ml_no_vig: null,
      market_baseline_valid: snap.data_quality.market_present,
      posterior_home_score: round1(homePoints),
      posterior_away_score: round1(awayPoints),
      posterior_total: round1(projectedTotal),
      posterior_spread_home: round1(projectedSpreadHome),
      trust_independent: 1.0, // v1 is independent of market for projection
      data_quality_tier: tier,
      confidence_ceiling: V1_CONFIDENCE_CEILING[tier],
      injury_unknown_count_home: countInjuriesByStatus(snap.home_injuries).unknown,
      injury_unknown_count_away: countInjuriesByStatus(snap.away_injuries).unknown,
      injury_out_count_home: countInjuriesByStatus(snap.home_injuries).out,
      injury_out_count_away: countInjuriesByStatus(snap.away_injuries).out,
      ml_pick: mlPick,
      ml_confidence: mlConfidence,
      ml_best_angle_eligible: mlBestAngleEligible,
      spread_pick: spreadPick,
      spread_confidence: spreadConfidence,
      total_pick: totalPick,
      total_confidence: totalConfidence,
      series_game_number: snap.series?.game_number ?? null,
      series_score_home: snap.series?.series_score_home ?? null,
      series_score_away: snap.series?.series_score_away ?? null,
      series_closeout_pressure:
        snap.series !== null &&
        (snap.series.is_elimination_for_home || snap.series.is_elimination_for_away),
      series_venue_shift: snap.series?.venue_shift ?? false,
      model_integrity_notes: notes,
      provisional: true,
    },
    model_version_v1: NBA_MODEL_VERSION_V1,
    calibration_status: "pending",
    v1_breakdown: {
      pace_home_blended: homeBlend.pace,
      pace_away_blended: awayBlend.pace,
      pace_used: round1(paceUsed),
      projected_possessions: round1(projectedPossessions),
      home_off_rating_blended: homeBlend.off_rating,
      home_def_rating_blended: homeBlend.def_rating,
      away_off_rating_blended: awayBlend.off_rating,
      away_def_rating_blended: awayBlend.def_rating,
      home_baseline_pp100: round1(homeBaselinePp100),
      away_baseline_pp100: round1(awayBaselinePp100),
      home_ff: homeFf,
      away_ff: awayFf,
      home_recency: {
        playoff_weight: homeBlend.playoff_weight,
        season_weight: homeBlend.season_weight,
        playoff_games: homeBlend.playoff_games,
        has_regular: homeBlend.used_packs.has_regular,
        has_playoff: homeBlend.used_packs.has_playoff,
      },
      away_recency: {
        playoff_weight: awayBlend.playoff_weight,
        season_weight: awayBlend.season_weight,
        playoff_games: awayBlend.playoff_games,
        has_regular: awayBlend.used_packs.has_regular,
        has_playoff: awayBlend.used_packs.has_playoff,
      },
      injury_review: injuryReview,
      context,
      home_final_pp100: round1(homeFinalPp100),
      away_final_pp100: round1(awayFinalPp100),
      data_quality_tier: tier,
      applied_caps: appliedCaps,
      notes,
    },
    v1_probabilities: probabilities,
    v0_comparison: v0,
    v0_v1_delta: {
      spread_pts: round1(spreadDelta),
      total_pts: round1(totalDelta),
      ml_home_prob_pp: round1(mlHomeProbDeltaPp),
      flagged,
    },
  };
}

// Re-exported for fixture tests.
export const __NBA_AUTOMODEL_V2_TEST__ = {
  recencyPlayoffBlend,
  computeFourFactorsModifier,
  reviewInjuries,
  buildContext,
  probabilityToConfidence,
};
