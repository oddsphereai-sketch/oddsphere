/**
 * External World Cup priors — calibration_version "external_priors_v1".
 *
 * Constants used by the WC-3 model when no in-tournament 2026 calibration
 * evidence exists yet. Cited values from publicly documented World Cup
 * aggregate statistics (1998-2022 era). NOT vendor-validated — see
 * §5 of project-wc-model-standard for the calibration honesty contract.
 *
 * Snapshot date: 2026-06-11
 * Sources cited:
 *   • Goals/match aggregate — BBC Sport / Opta historical WC recap
 *     published pre-tournament; ~2.5 goals/match average 1998-2022.
 *   • Draw rate group/knockout — FIFA Technical Reports + Opta WC
 *     aggregates, 2014/2018/2022 average.
 *   • BTTS-Yes / Over-2.5 — same Opta aggregates.
 *   • Host advantage — mean of 2014 BRA / 2018 RUS / 2022 QAT host vs
 *     neutral goal differential.
 *   • Dixon-Coles tau — Dixon-Coles (1997) standard literature value;
 *     calibrated on European league data, conservative for tournament play.
 *
 * Lifecycle:
 *   Promoted to `external_priors_v2` only after Daniel reviews the
 *   in-tournament calibration evidence after group stage. Until then,
 *   every soccer prediction carries calibration_source pointing here.
 *
 * NEVER use these values as a substitute for the Elo CSV snapshot.
 * Team-strength comes from Elo (see eloPrior.ts). These priors govern
 * the global goal model (alpha), draw/total/BTTS shape (tau), and
 * host advantage only.
 */

export const EXTERNAL_PRIORS_V1 = {
  /** ISO date when these constants were snapshotted. */
  snapshot_date: "2026-06-11" as const,

  /** Calibration version identifier — written to every snapshot. */
  calibration_version: "external_priors_v1" as const,

  /** Calibration source label — written to every snapshot. */
  calibration_source: "wc_aggregate_1998_2022_external_priors_v1_2026-06-11" as const,

  /** Evidence level at launch — locks Best Angle off until upgraded. */
  calibration_evidence_level: "external_priors_only" as const,

  // ─── Goal model constants ─────────────────────────────────────────

  /**
   * Global goals constant in λ = exp(α + att − def + host_adj + venue_adj).
   * α = ln(2.6/2) ≈ 0.2624 gives mean λ ≈ 1.3 per team — calibrated
   * so two average teams in average context produce ~2.6 goals/match.
   *
   * NOTE: prior design draft suggested α = 0.46 but that yields mean
   * λ ≈ 1.58 per team (3.16 goals/match) — too high. Corrected here.
   */
  alpha: Math.log(2.6 / 2),

  /** Scale factors mapping z-scored Elo strength to attack/defense. */
  att_scale: 0.18,
  def_scale: 0.18,

  /** Dixon-Coles low-score adjustment (negative inflates draws). */
  tau: -0.12,

  // ─── Host advantage ───────────────────────────────────────────────

  /** Goals/match added to host's λ when host team plays in host country. */
  host_goal_adjustment: 0.15,

  /** ISO-3 country codes treated as 2026 hosts for host_goal_adjustment. */
  host_countries: ["USA", "MEX", "CAN"] as const,

  /** Altitude bonus for Estadio Azteca (Mexico City) — only Mexican home matches at altitude. */
  altitude_goal_adjustment: 0.05,
  altitude_threshold_meters: 2000,

  // ─── Sanity-check rates (used by hold logic for prior-vs-model checks) ──

  /** WC aggregate priors — informational; auditor compares post-launch performance vs these. */
  wc_aggregate_rates: {
    mean_goals_per_match: 2.6,
    group_stage_draw_rate: 0.26,
    knockout_regulation_draw_rate: 0.24,
    btts_yes_rate: 0.52,
    over_2_5_rate: 0.55,
  },

  // ─── Confidence reductions (in percentage points) ─────────────────

  reductions_pp: {
    stale_market: 5,
    single_source: 5,
    far_from_market: 15,
    splits_provider_error: 8,
    short_price_dc_buffer: 10,
    draw_pick_high_lambda: 3,
    btts_low_lambda_pick_yes: 3,
  },

  // ─── Edge thresholds (percentage points) ──────────────────────────

  edge_thresholds: {
    /** Edge ≥ this puts grade at Caution-or-better. */
    caution_floor: 0.5,
    /** Edge ≥ this enables Watchlist consideration. */
    watchlist_floor: 1.5,
    /** Edge ≥ this enables Lean. Requires model_market_agreement also. */
    lean_floor: 3.0,
    /** Edge ≥ this enables Best Angle (also requires calibration upgrade). */
    best_angle_floor: 6.0,
    /** |Edge| < this collapses to Watchlist (signal too close to noise). */
    edge_noise_band: 2.0,
    /** Edge < this triggers hard hold (model on wrong side of market). */
    hold_negative_floor: -5.0,
    /** |Edge| > this AND external_priors_only → hold (model too far without calibration). */
    far_from_market_hard_hold: 15.0,
  },

  // ─── Per-market grade ladder (WC-MODEL-5, research-calibrated) ─────
  //
  // Soccer betting markets are efficient at the close; realistic edges are
  // small (low single-digit pp). Thresholds are therefore conservative and
  // MARKET- + SIDE-specific (research basis: market efficiency, favorite-
  // longshot bias, derivative-market margins):
  //   • Match Result FAVORITE edges fight no known bias → lowest bar.
  //   • Match Result DRAW/LONGSHOT edges are the noisiest → higher bar.
  //   • Total / BTTS carry wider book margins than 1X2 → a buffer above MR.
  //   • Double Chance is margin-heavy + short-priced → highest bar, and is
  //     EXCLUDED from Best Angle (best_angle = null).
  //   • miscalibration_ceiling: an edge larger than this vs the de-vigged
  //     market is far more likely model miscalibration than real value, so
  //     it is NOT upgraded — it drops to Caution with a flag.
  // best_angle floors are listed for the post-calibration future but stay
  // structurally locked under external_priors_only.
  grade_ladder: {
    match_result_favorite: { watchlist: 2.0, lean: 3.0, best_angle: 5.0, miscalibration_ceiling: 10.0 },
    match_result_other: { watchlist: 3.0, lean: 5.0, best_angle: 7.0, miscalibration_ceiling: 10.0 },
    total: { watchlist: 2.5, lean: 4.0, best_angle: 6.0, miscalibration_ceiling: 9.0 },
    btts: { watchlist: 3.0, lean: 5.0, best_angle: 7.0, miscalibration_ceiling: 10.0 },
    double_chance: { watchlist: 4.0, lean: 6.0, best_angle: null as number | null, miscalibration_ceiling: 9.0 },
  },

  // ─── Hold-logic thresholds ────────────────────────────────────────

  hold_thresholds: {
    /** Provider freshness limit; above this stale taint kicks in. */
    stale_seconds: 30 * 60,
    /** Both providers above this → hold the market entirely. */
    both_providers_stale_seconds: 60 * 60,
    /** Total pick held if |predicted_total − line| < this. */
    total_push_risk_band: 0.4,
    /** BTTS Yes pick held if min(λ_H, λ_A) < this. */
    btts_yes_low_lambda_min: 0.7,
    /** Draw pick confidence reduction if λ_H + λ_A > this. */
    high_scoring_threshold: 3.0,
  },
} as const;

export type ExternalPriorsV1 = typeof EXTERNAL_PRIORS_V1;
