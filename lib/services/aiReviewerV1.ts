/**
 * Phase 4.2.C.1.R-16 — Autonomous AI Reviewer V1 (deterministic).
 *
 * Pure pre-grade correction layer. The model produces a raw prediction
 * package. The reviewer applies deterministic guardrails — extreme
 * run-differential vs coinflip-market, small-sample starter driving a
 * huge edge, raw confidence extreme, OU sharp conflict, missing
 * starter, public smoke alignment, etc. — and emits a reviewed
 * prediction plus a compact audit trail.
 *
 * V1 SCOPE (Daniel-approved, R-16 design pass):
 *   • V1 reviewer is fully deterministic. No LLM, no paid API.
 *   • Pure function. No DB I/O. No network. Single-pass.
 *   • V1 deterministic mode does not flip ML yet. ML flip support is
 *     reserved for R-16B or a later guarded reviewer stage. The
 *     architecture supports reviewed ML winner differing from raw ML
 *     winner — the logic audit verifies that if it does, the score
 *     projection, confidence, and downstream grade/verdict/copy all
 *     align. The `flip_side` action token is defined in this file so
 *     downstream code is forward-compatible.
 *   • V1 deterministic actions available today: cap confidence, hold a
 *     market, dampen further, adjust projected score TOWARD the
 *     market, downgrade verdict via review flags (consumed by
 *     downstream grade/verdict layer).
 *   • NRFI passes through unchanged in V1. R-15-vintage zone-based
 *     NRFI architecture is untouched. R-16B may revisit.
 *   • A separate logic audit verifies internal consistency (score
 *     winner matches ML pick, total vs line matches OU side, FI zone,
 *     etc.) — runs after any reviewed-output adjustment.
 *
 * FINAL PRODUCT REQUIREMENT (preserved in architecture):
 *   The autonomous reviewer must be allowed to adjust anything when
 *   guardrails justify it — ML winner including flips, projected
 *   scores, OU side, FI call, confidence, held state, grade/verdict,
 *   and member-facing copy. Every adjustment carries a full audit
 *   trail and passes the logic audit before publish. V1's current
 *   capability is the foundation; later phases extend it.
 *
 * The orchestrator is expected to call this between the model run and
 * grade/verdict derivation:
 *
 *   raw model → AI reviewer → logic audit → grade → verdict → publish
 *
 * Architecture: this file exports the pure types + `reviewGamePrediction`
 * and `auditLogicConsistency` helpers. A future orchestration service
 * will batch these over a slate and decide how to persist results.
 */

// ─── Public types ────────────────────────────────────────────────────

export type Side = "home" | "away";
export type OuSide = "over" | "under";
export type NrfiDecisionKind = "nrfi" | "yrfi" | "toss_up" | "held";
export type ModelStage = "morning_draft" | "t60_locked";

/** Raw model package + context the reviewer needs. */
export type ReviewerInput = {
  /** External id of the game (audit only). */
  game_external_id: number;
  /** Stage at the time of the run. Some thresholds shift in locked vs draft. */
  stage: ModelStage;
  /** Raw model outputs. Reviewer reads these and may produce reviewed values. */
  raw: {
    predicted_home_score: number | null;
    predicted_away_score: number | null;
    predicted_total: number | null;
    listed_total: number | null;
    predicted_ml_winner: Side | null;
    ml_confidence: number | null;
    ml_raw_confidence: number | null;
    predicted_ou_side: OuSide | null;
    ou_confidence: number | null;
    ou_raw_confidence: number | null;
    predicted_nrfi: boolean | null;
    nrfi_decision_kind: NrfiDecisionKind;
    nrfi_confidence: number | null;
    nrfi_expected_runs: number | null;
  };
  /** Starter sample-size context. NULL when data is missing. */
  starters: {
    home_starter_id: number | null;
    home_starter_era: number | null;
    home_starter_gs: number | null;
    home_starter_ip: number | null;
    away_starter_id: number | null;
    away_starter_era: number | null;
    away_starter_gs: number | null;
    away_starter_ip: number | null;
  };
  bullpen: {
    home_bullpen_era_proxy: number | null;
    away_bullpen_era_proxy: number | null;
  };
  /** Market and sharp context. All fields may be null. */
  market: {
    /** No-vig implied probability for the MODEL'S PICK side (0..1). */
    ml_novig_pick_prob: number | null;
    /** No-vig implied probability for the opposite side (0..1). */
    ml_novig_opposite_prob: number | null;
    /** Public bets % on model's ML pick side (0..100). */
    public_bets_pick_pct: number | null;
    /** Public money % on model's ML pick side (0..100). */
    public_money_pick_pct: number | null;
    /** Which side carries Pinnacle +EV (model agreement check). */
    ml_plus_ev_side: Side | null;
    total_plus_ev_side: OuSide | null;
    /** True when public is heavy + flat AND aligned with model pick. */
    public_smoke_aligned_with_pick: boolean;
  };
  /** Data-quality flags. */
  data_quality: {
    starter_confirmed: boolean;
    lineup_confirmed: boolean;
    market_line_available: boolean;
    bullpen_fallback: boolean;
  };
};

/** Single-token flags emitted by the reviewer. */
export type ReviewFlag =
  | "extreme_run_diff_with_coinflip_market"
  | "small_sample_starter_driver"
  | "raw_conf_extreme_fragile"
  | "huge_model_market_gap"
  | "ou_sharp_conflict"
  | "missing_starter"
  | "starter_stats_fallback"
  | "missing_market_line"
  | "bullpen_fallback"
  | "public_smoke_aligned_with_pick"
  | "score_ml_inconsistency"
  | "total_ou_inconsistency"
  | "fi_zone_inconsistency"
  | "review_recommends_no_play"
  | "review_recommends_caution";

/** Actions taken on a single market. */
export type ReviewAction =
  | "keep"
  | "dampen_confidence"
  | "cap_confidence"
  | "hold"
  | "adjust_score_toward_market"
  /**
   * `flip_side`: reviewed ML winner differs from raw ML winner. The
   * action token is part of the V1 contract so downstream consumers
   * (orchestrator, verdict layer, copy generator) are forward-
   * compatible. V1 deterministic mode does not emit this action —
   * reserved for R-16B (LLM-assisted) or a later guarded reviewer
   * stage. When eventually emitted, the reviewer MUST also rebalance
   * predicted scores so the logic audit passes.
   */
  | "flip_side"
  | "downgrade_grade";

/** Reviewed prediction + audit trail. Compact by design. */
export type ReviewedOutput = {
  // Reviewed prediction values (may equal raw)
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  predicted_ml_winner: Side | null;
  ml_confidence: number | null;
  predicted_ou_side: OuSide | null;
  ou_confidence: number | null;
  predicted_nrfi: boolean | null;
  nrfi_decision_kind: NrfiDecisionKind;
  nrfi_confidence: number | null;

  // Action taken per market — "keep" when no change
  ml_action: ReviewAction;
  ou_action: ReviewAction;
  nrfi_action: ReviewAction;

  // Compact audit
  review_flags: ReviewFlag[];
  /** Short human-readable lines paired 1:1 with flags. */
  review_reasons: string[];
  reviewer_version: string;
  reviewed_at: string;

  // Logic audit
  logic_audit_passed: boolean;
  logic_audit_errors: string[];
};

// ─── Thresholds ──────────────────────────────────────────────────────

const REVIEWER_VERSION = "v1.0_deterministic";
const LOW_GS_THRESHOLD = 5;
const LOW_IP_THRESHOLD = 20;
const BIG_RUN_DIFF_THRESHOLD = 2.0;
const COINFLIP_LOW_PCT = 45;
const COINFLIP_HIGH_PCT = 55;
const RAW_CONF_EXTREME_THRESHOLD = 150;
const HUGE_GAP_PP_THRESHOLD = 12;
/** When the reviewer caps confidence after a strong intervention.
 *  52 sits intentionally above the floor (50 — "no read") and BELOW
 *  PLAYABLE_CONFIDENCE_FLOOR (0.53 = 53 on 0-100 scale, the threshold
 *  the verdict layer uses to route below-floor picks to no_play).
 *
 *  Why 52, not 55: at 55 the pick still clears the playable floor,
 *  so the verdict layer renders it as a normal lean/watchlist row.
 *  At 52, the verdict layer routes the row to no_play automatically
 *  without any reviewer-flag plumbing into verdictDerivation. The
 *  member sees an explicit "no_play" pill with the reviewer's flags
 *  surfaced in the audit record for operator inspection. R-16B (LLM
 *  layer) may revisit by adding an explicit `reviewer_recommends_caution`
 *  pathway into the verdict layer for cases that should land at
 *  Caution rather than No Play. */
const STRONG_INTERVENTION_CAP = 52;
/** Number of strong fragility flags that together trigger cap. */
const STRONG_INTERVENTION_FLAG_COUNT = 2;
/** Strong-fragility flag set. */
const STRONG_FRAGILITY_FLAGS = new Set<ReviewFlag>([
  "extreme_run_diff_with_coinflip_market",
  "small_sample_starter_driver",
  "raw_conf_extreme_fragile",
  "huge_model_market_gap",
]);

// ─── Public API ──────────────────────────────────────────────────────

/**
 * R-16 V1 — apply deterministic reviewer pass to one game's raw model
 * output. Pure. Returns `ReviewedOutput` with compact audit trail.
 *
 * Order of operations:
 *   1. Collect flags from inputs (no state mutation).
 *   2. Decide ML action: hold (missing starter) → cap (strong frags) → keep.
 *      (flip_side reserved for a later reviewer stage — not emitted by V1.)
 *   3. Decide OU action: hold (missing line) → mark sharp conflict → keep.
 *   4. NRFI passes through unchanged in V1 deterministic mode.
 *   5. Run logic audit (consistency between score/ML/OU/FI). If any
 *      future action — including ML flip — produces an inconsistency,
 *      the audit catches it before publish.
 *   6. Emit compact ReviewedOutput.
 */
export function reviewGamePrediction(input: ReviewerInput): ReviewedOutput {
  const flags: ReviewFlag[] = [];
  const reasons: string[] = [];

  // ── ML side ───────────────────────────────────────────────────
  let mlWinner = input.raw.predicted_ml_winner;
  let mlConfidence = input.raw.ml_confidence;
  let mlAction: ReviewAction = "keep";

  // Score-derived run differential (raw model basis).
  const home = input.raw.predicted_home_score;
  const away = input.raw.predicted_away_score;
  const runDiff =
    home !== null && away !== null ? Math.abs(home - away) : null;

  const noVigPick = input.market.ml_novig_pick_prob;
  const isCoinflipMarket =
    noVigPick !== null &&
    noVigPick * 100 >= COINFLIP_LOW_PCT &&
    noVigPick * 100 <= COINFLIP_HIGH_PCT;

  if (runDiff !== null && runDiff > BIG_RUN_DIFF_THRESHOLD && isCoinflipMarket) {
    flags.push("extreme_run_diff_with_coinflip_market");
    reasons.push(
      `Model projects ${runDiff.toFixed(1)}-run differential but market is near a coinflip (${(noVigPick! * 100).toFixed(1)}% no-vig on pick).`
    );
  }

  const homeGs = input.starters.home_starter_gs;
  const awayGs = input.starters.away_starter_gs;
  const homeIp = input.starters.home_starter_ip;
  const awayIp = input.starters.away_starter_ip;
  const homeSmallSample =
    (homeGs !== null && homeGs < LOW_GS_THRESHOLD) ||
    (homeIp !== null && homeIp < LOW_IP_THRESHOLD);
  const awaySmallSample =
    (awayGs !== null && awayGs < LOW_GS_THRESHOLD) ||
    (awayIp !== null && awayIp < LOW_IP_THRESHOLD);
  if (
    (homeSmallSample || awaySmallSample) &&
    runDiff !== null &&
    runDiff > BIG_RUN_DIFF_THRESHOLD
  ) {
    flags.push("small_sample_starter_driver");
    reasons.push(
      `Small-sample starter (gs<${LOW_GS_THRESHOLD} or ip<${LOW_IP_THRESHOLD}) is driving a ${runDiff.toFixed(1)}-run projected differential.`
    );
  }

  if (
    input.raw.ml_raw_confidence !== null &&
    input.raw.ml_raw_confidence >= RAW_CONF_EXTREME_THRESHOLD
  ) {
    flags.push("raw_conf_extreme_fragile");
    reasons.push(
      `Raw ml_confidence ${input.raw.ml_raw_confidence.toFixed(1)} is extreme — driven by one fragile input. Compression cap may mask the underlying overreaction.`
    );
  }

  const modelMarketGap =
    mlConfidence !== null && noVigPick !== null
      ? mlConfidence - noVigPick * 100
      : null;
  if (modelMarketGap !== null && modelMarketGap > HUGE_GAP_PP_THRESHOLD) {
    flags.push("huge_model_market_gap");
    reasons.push(
      `Model trust ${mlConfidence!.toFixed(1)}% vs market no-vig ${(noVigPick! * 100).toFixed(1)}% — ${modelMarketGap.toFixed(1)}pp gap.`
    );
  }

  if (input.market.public_smoke_aligned_with_pick) {
    flags.push("public_smoke_aligned_with_pick");
    reasons.push(
      "Model pick aligns with heavy + flat public split — typical losing-public pattern."
    );
  }

  if (input.data_quality.bullpen_fallback) {
    flags.push("bullpen_fallback");
    reasons.push("One or both team bullpen ERAs are league-average fallbacks.");
  }

  // ── ML decision: hold then cap ─────────────────────────────────
  //
  // 2026-06-12 P1A: starter status is a TWO-DIMENSIONAL check. Both
  // sides need to be USABLE by the model, not necessarily LINKED to a
  // players-row identifier. The two dimensions:
  //
  //   (a) id-link:  starter_id !== null → the snapshot resolved the
  //                 starter to an internal players row (or sentinel
  //                 `1` for an external_id-only row per the wiring).
  //   (b) usable:   starter_era !== null → either the real starter's
  //                 season ERA is available, OR a fallback/proxy (team-
  //                 season aggregate, league average) populated it. In
  //                 either case the model has a usable starter signal.
  //
  // Three outcomes:
  //
  //   • TRULY MISSING (id null AND era null) — the model literally
  //     has no starter signal, even via proxy. Hold ML hard. This is
  //     the original missing_starter behavior and remains a real
  //     caution.
  //
  //   • STATS-FALLBACK (id null BUT era populated) — at write time the
  //     snapshot didn't have a player-row, but a fallback proxy gave
  //     the model usable ERA + handedness. The prediction is still
  //     trustworthy at the starter-feature level. Emit
  //     `starter_stats_fallback` as an internal data-quality marker
  //     and let ML proceed. This is the most common case for newly-
  //     announced or unlinked starters.
  //
  //   • FULLY LINKED (id present) — no flag, ML proceeds.
  //
  // The card-side friendly-flag map (DailyEdgeShell.tsx) returns null
  // for `starter_stats_fallback`, so users do not see a scary "missing
  // starter" badge when the model successfully predicted via proxy.
  // True missing_starter still surfaces and still holds ML.
  const homeHasId = input.starters.home_starter_id !== null;
  const awayHasId = input.starters.away_starter_id !== null;
  const homeHasStats = input.starters.home_starter_era !== null;
  const awayHasStats = input.starters.away_starter_era !== null;
  const homeUsable = homeHasId || homeHasStats;
  const awayUsable = awayHasId || awayHasStats;
  if (!homeUsable || !awayUsable) {
    // Truly missing — no id-link AND no fallback stats available.
    flags.push("missing_starter");
    const missingSide =
      !homeUsable && !awayUsable
        ? "home and away"
        : !homeUsable
          ? "home"
          : "away";
    reasons.push(
      `Missing starter (${missingSide}) — no usable starter signal, hold the ML market.`
    );
    mlWinner = null;
    mlConfidence = null;
    mlAction = "hold";
  } else if (!homeHasId || !awayHasId) {
    // Usable via proxy/fallback stats but the player-row link is absent.
    // Non-blocking data-quality marker; do NOT null ML.
    flags.push("starter_stats_fallback");
    const fallbackSide =
      !homeHasId && !awayHasId
        ? "home and away"
        : !homeHasId
          ? "home"
          : "away";
    reasons.push(
      `Starter player-link unavailable (${fallbackSide}) — model used fallback/proxy stats. Prediction proceeds; flag is informational.`
    );
  }
  if (homeUsable && awayUsable) {
    // Count strong fragility flags
    const strongFlagsHit = flags.filter((f) => STRONG_FRAGILITY_FLAGS.has(f)).length;
    if (
      mlConfidence !== null &&
      strongFlagsHit >= STRONG_INTERVENTION_FLAG_COUNT &&
      mlConfidence > STRONG_INTERVENTION_CAP
    ) {
      mlConfidence = STRONG_INTERVENTION_CAP;
      mlAction = "cap_confidence";
      reasons.push(
        `${strongFlagsHit} strong fragility flags fired — ML confidence capped at ${STRONG_INTERVENTION_CAP}% (informational lean, not actionable edge).`
      );
      flags.push("review_recommends_caution");
    }
  }

  // ── OU side ────────────────────────────────────────────────────
  let ouSide = input.raw.predicted_ou_side;
  let ouConfidence = input.raw.ou_confidence;
  let ouAction: ReviewAction = "keep";

  if (!input.data_quality.market_line_available) {
    flags.push("missing_market_line");
    reasons.push("No listed total available — hold OU.");
    ouSide = null;
    ouConfidence = null;
    ouAction = "hold";
  } else if (
    ouSide !== null &&
    input.market.total_plus_ev_side !== null &&
    input.market.total_plus_ev_side !== ouSide
  ) {
    flags.push("ou_sharp_conflict");
    reasons.push(
      `Model picks OU ${ouSide} but Pinnacle +EV is on ${input.market.total_plus_ev_side} — sharp disagrees.`
    );
    // R-14B already dampened. Reviewer flags for verdict layer to read.
  }

  // ── NRFI (V1 invariant: passthrough) ────────────────────────────
  const nrfiAction: ReviewAction = "keep";

  // ── Score-adjust toward market (very narrow trigger) ───────────
  let homeScoreOut = home;
  let awayScoreOut = away;
  let predictedTotalOut = input.raw.predicted_total;
  if (
    flags.includes("extreme_run_diff_with_coinflip_market") &&
    flags.includes("small_sample_starter_driver") &&
    home !== null &&
    away !== null &&
    runDiff !== null
  ) {
    // Move halfway toward a market-implied 0-run differential while
    // preserving the predicted_total. The reviewer is signaling that
    // the small-sample driver overstates the edge.
    const total = home + away;
    const newDiff = runDiff * 0.5; // halve the gap
    const sign = home > away ? 1 : -1;
    homeScoreOut = +(total / 2 + (sign * newDiff) / 2).toFixed(1);
    awayScoreOut = +(total / 2 - (sign * newDiff) / 2).toFixed(1);
    predictedTotalOut = +(homeScoreOut + awayScoreOut).toFixed(1);
    if (mlAction === "cap_confidence") {
      // Both adjustments fired — record the score adjustment too.
      reasons.push(
        `Projected scores adjusted toward market: ${away.toFixed(1)}-${home.toFixed(1)} → ${awayScoreOut.toFixed(1)}-${homeScoreOut.toFixed(1)} (halved differential).`
      );
      // Promote mlAction to the more expressive label — we'll keep
      // cap_confidence as the primary, but emit both labels via flag.
    }
  }

  // ── Logic audit ───────────────────────────────────────────────
  const auditErrors: string[] = [];
  if (mlWinner !== null && homeScoreOut !== null && awayScoreOut !== null) {
    const scoreSays =
      homeScoreOut > awayScoreOut
        ? "home"
        : awayScoreOut > homeScoreOut
          ? "away"
          : null;
    if (scoreSays !== null && scoreSays !== mlWinner) {
      auditErrors.push(
        `Score (${awayScoreOut}-${homeScoreOut}) implies ${scoreSays} but ML pick is ${mlWinner}.`
      );
      flags.push("score_ml_inconsistency");
    }
  }
  if (
    ouSide !== null &&
    predictedTotalOut !== null &&
    input.raw.listed_total !== null
  ) {
    const totalSays =
      predictedTotalOut > input.raw.listed_total
        ? "over"
        : predictedTotalOut < input.raw.listed_total
          ? "under"
          : null;
    if (totalSays !== null && totalSays !== ouSide) {
      auditErrors.push(
        `Projected total ${predictedTotalOut} vs line ${input.raw.listed_total} implies ${totalSays} but OU pick is ${ouSide}.`
      );
      flags.push("total_ou_inconsistency");
    }
  }
  // FI zone consistency — only flag clearly contradictory NRFI/YRFI calls.
  // Toss-Up is the data-quality downgrade safety net (see NRFI 5-zone docs
  // in lib/automodel/types.ts) and is valid for ANY expected_runs value
  // once the underlying confidence drops below floor — do not flag it.
  const fiKind = input.raw.nrfi_decision_kind;
  const fiRuns = input.raw.nrfi_expected_runs;
  if (fiKind === "nrfi" && fiRuns !== null && fiRuns >= 0.62) {
    auditErrors.push(
      `NRFI decision_kind=nrfi but expected_first_inning_runs=${fiRuns.toFixed(2)} is in YRFI territory (≥0.62).`
    );
    flags.push("fi_zone_inconsistency");
  } else if (fiKind === "yrfi" && fiRuns !== null && fiRuns < 0.50) {
    auditErrors.push(
      `NRFI decision_kind=yrfi but expected_first_inning_runs=${fiRuns.toFixed(2)} is in NRFI territory (<0.50).`
    );
    flags.push("fi_zone_inconsistency");
  }

  return {
    predicted_home_score: homeScoreOut,
    predicted_away_score: awayScoreOut,
    predicted_total: predictedTotalOut,
    predicted_ml_winner: mlWinner,
    ml_confidence: mlConfidence,
    predicted_ou_side: ouSide,
    ou_confidence: ouConfidence,
    predicted_nrfi: input.raw.predicted_nrfi,
    nrfi_decision_kind: input.raw.nrfi_decision_kind,
    nrfi_confidence: input.raw.nrfi_confidence,
    ml_action: mlAction,
    ou_action: ouAction,
    nrfi_action: nrfiAction,
    review_flags: flags,
    review_reasons: reasons,
    reviewer_version: REVIEWER_VERSION,
    reviewed_at: new Date().toISOString(),
    logic_audit_passed: auditErrors.length === 0,
    logic_audit_errors: auditErrors,
  };
}

// ─── Audit-trail persistence shape (proposed; not yet written) ──────

/**
 * Compact JSONB shape the orchestrator would store in
 * `sport_specific.review_v1`. Sized for ~300 bytes per game.
 */
export type ReviewV1AuditRecord = {
  reviewer_version: string;
  reviewed_at: string;
  raw: {
    home_score: number | null;
    away_score: number | null;
    total: number | null;
    ml_winner: Side | null;
    ml_confidence: number | null;
    ou_side: OuSide | null;
    ou_confidence: number | null;
  };
  reviewed: {
    home_score: number | null;
    away_score: number | null;
    total: number | null;
    ml_winner: Side | null;
    ml_confidence: number | null;
    ou_side: OuSide | null;
    ou_confidence: number | null;
  };
  actions: {
    ml: ReviewAction;
    ou: ReviewAction;
    nrfi: ReviewAction;
  };
  flags: ReviewFlag[];
  reasons_count: number; // raw reasons[] is fetched separately if needed
  logic_audit_passed: boolean;
};

/**
 * Build the compact audit-record from a `ReviewerInput` + `ReviewedOutput`.
 * Caller stores this on `game_predictions.sport_specific.review_v1`.
 */
export function buildAuditRecord(
  input: ReviewerInput,
  reviewed: ReviewedOutput
): ReviewV1AuditRecord {
  return {
    reviewer_version: reviewed.reviewer_version,
    reviewed_at: reviewed.reviewed_at,
    raw: {
      home_score: input.raw.predicted_home_score,
      away_score: input.raw.predicted_away_score,
      total: input.raw.predicted_total,
      ml_winner: input.raw.predicted_ml_winner,
      ml_confidence: input.raw.ml_confidence,
      ou_side: input.raw.predicted_ou_side,
      ou_confidence: input.raw.ou_confidence,
    },
    reviewed: {
      home_score: reviewed.predicted_home_score,
      away_score: reviewed.predicted_away_score,
      total: reviewed.predicted_total,
      ml_winner: reviewed.predicted_ml_winner,
      ml_confidence: reviewed.ml_confidence,
      ou_side: reviewed.predicted_ou_side,
      ou_confidence: reviewed.ou_confidence,
    },
    actions: {
      ml: reviewed.ml_action,
      ou: reviewed.ou_action,
      nrfi: reviewed.nrfi_action,
    },
    flags: reviewed.review_flags,
    reasons_count: reviewed.review_reasons.length,
    logic_audit_passed: reviewed.logic_audit_passed,
  };
}
