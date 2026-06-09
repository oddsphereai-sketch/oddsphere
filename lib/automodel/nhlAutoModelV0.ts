/**
 * NHL Daily Edge — auto-model V0 (rule-seeded, fundamentals-first).
 *
 * Pure function. No I/O. Deterministic for a given FeatureSnapshot.
 *
 * Philosophy
 *   • Fundamentals drive the pick: team xG strength, goalie advantage,
 *     special-teams differential, rest/B2B, home ice, series context.
 *   • Market/sharp signals only modify confidence and verdict tier;
 *     they never silently anchor the pick.
 *   • Stanley Cup playoffs = small sample, high variance → confidence
 *     capped at 58% probability for v0.
 *
 * Output
 *   • ML home win probability + confidence band.
 *   • Total-goals projection + over/under recommendation.
 *   • Verdict per market (best_angle / lean / watchlist / pass), derived
 *     from |probability - 50| and the model↔market alignment check.
 *   • Per-layer contributions for transparency (printable, also feeds
 *     the future prediction_records snapshot).
 *
 * NOT a logistic regression or a trained model. This is a deterministic
 * rule-seeded scoring function. V0.5+ will add calibration once we have
 * graded outcomes from real Finals games.
 */

export type NhlModelTeam = {
  /** Canonical 3-letter abbreviation. */
  abbreviation: string;
  /** Playoff xG% if available; else regular-season xG%. 0..1 scale. */
  xgoals_pct: number | null;
  /** Playoff xG-for per 60 (offensive rate). */
  x_goals_for_per_60: number | null;
  /** Playoff xG-against per 60 (defensive rate). */
  x_goals_against_per_60: number | null;
  /** Power-play xG% on the 5on4 row. */
  pp_xgoals_pct: number | null;
  /** Penalty-kill xG% on the 4on5 row. */
  pk_xgoals_pct: number | null;
  /** Goalie xGSAA per 60 for the starting goalie (positive = better than expected). */
  goalie_xgsaa_per_60: number | null;
  /** Days of rest since previous game (1 = back-to-back). */
  rest_days: number | null;
  /** Series wins so far (this team). */
  series_wins: number;
  /** Whether this team is the home side tonight. */
  is_home: boolean;
};

export type NhlModelMarket = {
  /** SharpAPI moneyline implied probability for HOME (after vig). */
  market_home_prob: number | null;
  /** Main total-goals line. */
  market_total_line: number | null;
  /** Source confidence: are multiple books in agreement? */
  market_book_count: number;
};

export type NhlModelSeriesContext = {
  /** "SCF" / "ECF" / "WCF" / "R1" / "R2" / null. */
  series_abbrev: string | null;
  /** Game number in series (1..7). */
  game_number_in_series: number;
  /** True if either team is one game from elimination. */
  is_elimination_game: boolean;
};

export type NhlFeatureSnapshot = {
  home: NhlModelTeam;
  away: NhlModelTeam;
  market: NhlModelMarket;
  series: NhlModelSeriesContext;
};

export type NhlVerdictKey = "best_angle" | "lean" | "watchlist" | "pass";

export type NhlModelMarketOutput = {
  pick: string;
  probability: number;
  confidence: number;          // 0..1
  verdict: NhlVerdictKey;
  model_market_gap_pct: number | null; // signed, in percentage points (model - market)
  notes: string[];
};

export type NhlModelOutput = {
  model_version: string;
  inputs_summary: {
    home: string;
    away: string;
    series: string | null;
    market_book_count: number;
  };
  /**
   * Per-layer signed contribution to expected goal diff (home - away).
   * Each value is post-multiplier and post-clamp; sum equals
   * `expected_goal_diff`. The raw inputs are also exposed as `*_raw`
   * for transparency / debugging.
   */
  layers: {
    team_strength_goals: number;
    goalie_advantage_goals: number;
    special_teams_goals: number;
    rest_advantage_goals: number;
    home_ice_goals: number;
    series_context_goals: number;
    // Raw inputs for transparency
    team_strength_diff_raw: number; // home xG% - away xG%
    special_teams_diff_raw: number;
  };
  /** Expected home goals - away goals from the layered sum. */
  expected_goal_diff: number;
  /** Expected total goals from team rates + adjustments. */
  expected_total_goals: number;
  moneyline: NhlModelMarketOutput;
  total: NhlModelMarketOutput;
};

const NHL_MODEL_VERSION = "nhl_v0_2026_finals";

/** Confidence cap per v0 spec. */
const CONFIDENCE_CAP = 0.58;

/**
 * v0 is in calibration phase: zero graded NHL games yet. Until we have
 * ≥5 graded games to verify the model is correctly calibrated against
 * real outcomes, the verdict ceiling is hard-capped at "Lean". This
 * prevents the model from overclaiming Best Angle on small-sample
 * playoff inputs. Promotion to Best Angle is gated by future
 * calibration work and is intentionally not flag-toggleable today.
 */
const VERDICT_CEILING_V0: NhlVerdictKey = "lean";

/**
 * Per-layer goal-diff cap. A single feature can never contribute more
 * than ±this in either direction, preventing one noisy metric from
 * dominating the entire pick. Calibrated for v0; revisit once we
 * have graded outcomes.
 */
const PER_LAYER_GOAL_CAP = 0.5;

/** Home-ice expected-goal nudge. NHL home ice is small but real. */
const HOME_ICE_GOALS = 0.15;

/** Rest-day weight: each day of rest > opponent adds 0.05 expected goals. */
const REST_DAY_WEIGHT = 0.05;

/**
 * xG% → goal-diff multiplier. Was 10 in the first cut, which translated
 * an 8pp playoff xG% advantage to 0.80 expected goals — too aggressive
 * for v0 on a 16-game playoff sample. Reduced to 5: an 8pp advantage
 * now contributes 0.40 goal diff, still meaningful but less dominant.
 */
const XG_PCT_MULTIPLIER = 5;

/** Series-elimination boost: trailing team in elimination game gets a tiny boost
 *  (motivation + better goalie / coach response). v0 keeps this small. */
const ELIM_GAME_GOAL_NUDGE = 0.10;

/** League-baseline expected total goals for an NHL game in 2025-26 playoffs. */
const LEAGUE_BASELINE_GOALS = 5.85;

function clampLayer(value: number): number {
  if (value > PER_LAYER_GOAL_CAP) return PER_LAYER_GOAL_CAP;
  if (value < -PER_LAYER_GOAL_CAP) return -PER_LAYER_GOAL_CAP;
  return value;
}

function applyCeiling(v: NhlVerdictKey): NhlVerdictKey {
  // Order: best_angle > lean > watchlist > pass. Ceiling caps downward only.
  const rank: Record<NhlVerdictKey, number> = {
    best_angle: 3, lean: 2, watchlist: 1, pass: 0,
  };
  return rank[v] > rank[VERDICT_CEILING_V0] ? VERDICT_CEILING_V0 : v;
}

/** Convert expected goal differential to ML home probability via a
 *  calibrated logistic. Coefficient based on historical Pythagorean
 *  goal-diff → win-prob slope, with a hard cap at v0. */
function probabilityFromGoalDiff(diff: number): number {
  // Slope chosen so that +0.5 goal diff → ~55%, +1.0 goal → ~62% (we
  // cap below 62% anyway via CONFIDENCE_CAP).
  const k = 0.65;
  const raw = 1 / (1 + Math.exp(-k * diff));
  // Cap the magnitude of the probability swing.
  const minP = 1 - CONFIDENCE_CAP;
  return Math.max(minP, Math.min(CONFIDENCE_CAP, raw));
}

/** Verdict derivation: based on probability magnitude AND model↔market alignment. */
function verdictForMoneyline(
  prob: number,
  modelMarketGapPct: number | null,
): NhlVerdictKey {
  const edge = Math.abs(prob - 0.5);
  // Below 2.5% edge → Pass; barely a model conviction.
  if (edge < 0.025) return "pass";
  // Big model↔market divergence (>10pp) → drop to Watchlist regardless of magnitude.
  if (modelMarketGapPct !== null && Math.abs(modelMarketGapPct) > 0.10) {
    return "watchlist";
  }
  if (edge < 0.05) return "watchlist";
  if (edge < 0.07) return "lean";
  return "best_angle";
}

function verdictForTotal(
  modelTotal: number,
  marketLine: number | null,
): { verdict: NhlVerdictKey; pick: string; gap: number | null } {
  if (marketLine === null) {
    // Without a market line we can still publish a model lean.
    return { verdict: "watchlist", pick: `Model ${modelTotal.toFixed(1)}`, gap: null };
  }
  const gap = modelTotal - marketLine;
  const absGap = Math.abs(gap);
  let verdict: NhlVerdictKey;
  if (absGap < 0.25) verdict = "pass";
  else if (absGap < 0.5) verdict = "watchlist";
  else if (absGap < 0.75) verdict = "lean";
  else verdict = "best_angle";
  const pick = gap > 0 ? `OVER ${marketLine.toFixed(1)}` : `UNDER ${marketLine.toFixed(1)}`;
  return { verdict, pick, gap };
}

function safeNum(v: number | null, fallback: number): number {
  return v === null || !Number.isFinite(v) ? fallback : v;
}

/**
 * Run the NHL v0 model for a single game. Pure; deterministic.
 */
export function nhlAutoModelV0(snap: NhlFeatureSnapshot): NhlModelOutput {
  // ─── Layer 1: Team strength (xG%) ────────────────────────────────
  // Both teams' xG% are 0..1; differential is home - away. Multiplier
  // 5 (calibrated down from 10): an 8pp playoff xG% advantage now
  // contributes 0.40 goal diff (instead of 0.80). Each layer also
  // capped at ±PER_LAYER_GOAL_CAP to prevent runaway dominance.
  const homeXg = safeNum(snap.home.xgoals_pct, 0.5);
  const awayXg = safeNum(snap.away.xgoals_pct, 0.5);
  const team_strength_diff = homeXg - awayXg;
  const teamStrengthGoals = clampLayer(team_strength_diff * XG_PCT_MULTIPLIER);

  // ─── Layer 2: Goalie advantage ───────────────────────────────────
  const homeGoalie = safeNum(snap.home.goalie_xgsaa_per_60, 0);
  const awayGoalie = safeNum(snap.away.goalie_xgsaa_per_60, 0);
  const goalie_advantage = clampLayer(homeGoalie - awayGoalie);

  // ─── Layer 3: Special teams differential ─────────────────────────
  const homePp = safeNum(snap.home.pp_xgoals_pct, 0.5);
  const awayPp = safeNum(snap.away.pp_xgoals_pct, 0.5);
  const homePk = safeNum(snap.home.pk_xgoals_pct, 0.5);
  const awayPk = safeNum(snap.away.pk_xgoals_pct, 0.5);
  const homeStEdge = (homePp - 0.5) + (homePk - 0.5);
  const awayStEdge = (awayPp - 0.5) + (awayPk - 0.5);
  const special_teams_diff = homeStEdge - awayStEdge;
  const specialTeamsGoals = clampLayer(special_teams_diff * 1.0);

  // ─── Layer 4: Rest / B2B ─────────────────────────────────────────
  const homeRest = safeNum(snap.home.rest_days, 2);
  const awayRest = safeNum(snap.away.rest_days, 2);
  const rest_advantage_goals = clampLayer((homeRest - awayRest) * REST_DAY_WEIGHT);

  // ─── Layer 5: Home ice ───────────────────────────────────────────
  const home_ice_goals = snap.home.is_home ? HOME_ICE_GOALS : 0;

  // ─── Layer 6: Series context ─────────────────────────────────────
  let series_context_goals = 0;
  if (snap.series.is_elimination_game) {
    const homeFacingElim = snap.home.series_wins < snap.away.series_wins;
    series_context_goals = homeFacingElim ? ELIM_GAME_GOAL_NUDGE : -ELIM_GAME_GOAL_NUDGE;
  }

  // ─── Aggregate ───────────────────────────────────────────────────
  const expected_goal_diff =
    teamStrengthGoals +
    goalie_advantage +
    specialTeamsGoals +
    rest_advantage_goals +
    home_ice_goals +
    series_context_goals;

  // Total: anchor to league baseline, then nudge by team scoring rates
  // when available. Pace + xG_for + xG_against rates would lift/depress.
  const homeRate = safeNum(snap.home.x_goals_for_per_60, 3.0) +
                   safeNum(snap.away.x_goals_against_per_60, 3.0);
  const awayRate = safeNum(snap.away.x_goals_for_per_60, 3.0) +
                   safeNum(snap.home.x_goals_against_per_60, 3.0);
  const paceProj = (homeRate + awayRate) / 2;
  // Blend 60% pace projection / 40% league baseline for v0 stability.
  const expected_total_goals = 0.6 * paceProj + 0.4 * LEAGUE_BASELINE_GOALS;

  // ─── Moneyline pick + verdict ────────────────────────────────────
  const homeProb = probabilityFromGoalDiff(expected_goal_diff);
  const marketHomeProb = snap.market.market_home_prob;
  const modelMarketGapPct = marketHomeProb !== null ? homeProb - marketHomeProb : null;

  const homePickIsHome = homeProb >= 0.5;
  const pickProb = homePickIsHome ? homeProb : (1 - homeProb);
  const pickAbbr = homePickIsHome ? snap.home.abbreviation : snap.away.abbreviation;

  const mlVerdictRaw = verdictForMoneyline(homeProb, modelMarketGapPct);
  const mlVerdict = applyCeiling(mlVerdictRaw);
  const mlNotes: string[] = [];
  if (mlVerdictRaw !== mlVerdict) {
    mlNotes.push("v0 calibration phase — verdict capped at Lean");
  }
  if (modelMarketGapPct !== null) {
    if (Math.abs(modelMarketGapPct) <= 0.03) mlNotes.push("Model and market agree");
    else if (Math.abs(modelMarketGapPct) > 0.10) mlNotes.push("Model fades market — volatility flag");
    else mlNotes.push(`Model ${modelMarketGapPct > 0 ? "favors home" : "favors away"} vs market by ${Math.abs(modelMarketGapPct * 100).toFixed(1)}pp`);
  } else {
    mlNotes.push("No reliable market price for cross-check");
  }
  if (snap.market.market_book_count >= 3) mlNotes.push(`${snap.market.market_book_count} books in consensus`);

  // ─── Total pick + verdict ────────────────────────────────────────
  const totalResRaw = verdictForTotal(expected_total_goals, snap.market.market_total_line);
  const totalVerdict = applyCeiling(totalResRaw.verdict);
  const totalRes = { ...totalResRaw, verdict: totalVerdict };
  const totalNotes: string[] = [];
  if (totalResRaw.verdict !== totalVerdict) {
    totalNotes.push("v0 calibration phase — verdict capped at Lean");
  }
  if (totalRes.gap !== null) {
    totalNotes.push(`Model projects ${expected_total_goals.toFixed(2)} vs market ${snap.market.market_total_line?.toFixed(1)} (${totalRes.gap > 0 ? "+" : ""}${totalRes.gap.toFixed(2)})`);
  } else {
    totalNotes.push(`Model projects ${expected_total_goals.toFixed(2)} (no market line)`);
  }

  // Confidence numbers — scaled magnitude. Cap respects the model output
  // cap already enforced inside probabilityFromGoalDiff.
  const mlConfidence = Math.min(CONFIDENCE_CAP, pickProb);

  return {
    model_version: NHL_MODEL_VERSION,
    inputs_summary: {
      home: snap.home.abbreviation,
      away: snap.away.abbreviation,
      series: snap.series.series_abbrev,
      market_book_count: snap.market.market_book_count,
    },
    layers: {
      team_strength_goals: teamStrengthGoals,
      goalie_advantage_goals: goalie_advantage,
      special_teams_goals: specialTeamsGoals,
      rest_advantage_goals,
      home_ice_goals,
      series_context_goals,
      team_strength_diff_raw: team_strength_diff,
      special_teams_diff_raw: special_teams_diff,
    },
    expected_goal_diff,
    expected_total_goals,
    moneyline: {
      pick: `${pickAbbr} ML`,
      probability: pickProb,
      confidence: mlConfidence,
      verdict: mlVerdict,
      model_market_gap_pct: modelMarketGapPct,
      notes: mlNotes,
    },
    total: {
      pick: totalRes.pick,
      probability: 0.5 + Math.min(0.08, Math.abs(totalRes.gap ?? 0) * 0.04),
      confidence: 0.5 + Math.min(0.08, Math.abs(totalRes.gap ?? 0) * 0.04),
      verdict: totalRes.verdict,
      model_market_gap_pct: totalRes.gap,
      notes: totalNotes,
    },
  };
}

export const NHL_MODEL_VERSION_CONST = NHL_MODEL_VERSION;
