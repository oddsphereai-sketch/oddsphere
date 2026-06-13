/**
 * Phase 6B V2.1 — Play Grade.
 *
 * Distinguishes "What does the model think?" from "Is this worth betting?".
 *
 *   prediction       — model's pick + confidence
 *   model_edge       — model_prob - no_vig_market_prob (basis points / %)
 *   expected_value   — bet EV against ML odds (%)
 *   data_quality     — high / medium / low / fallback
 *   play_grade       — combines edge + EV + data quality + market read
 *
 * Play Grade tiers (display semantics):
 *   "best_angle"     — +EV, meaningful edge, high data quality, no conflict
 *   "lean"           — model picks a side with non-trivial edge
 *   "market_aligned" — model and market agree; below Best Angle threshold
 *   "no_bet"         — slight edge or no edge; show prediction, don't bet it
 *   "provisional"    — data-limited; pick exists but confidence capped
 *   "hold"           — true hold; missing market or unsafe data
 *
 * Pure module. No env reads, no I/O.
 */

// ─── Default thresholds (per-market overrides supplied by caller) ────────

/** ML Best Angle min edge (no-vig basis). */
export const BEST_ANGLE_MIN_EDGE_PCT_ML = 2.0;
/**
 * O/U Best Angle min edge — TEMPORARILY 3.0% because we don't ingest O/U
 * odds yet. The default 0.5 fair-line market_prob inflates apparent edges;
 * raising the threshold compensates. Lower this to ~2.0% once O/U odds
 * are joined into the snapshot.
 */
export const BEST_ANGLE_MIN_EDGE_PCT_OU = 3.0;
export const BEST_ANGLE_MIN_EV_PCT = 0.0; // EV strictly > 0
/** Min model probability (as %) for Best Angle. Below this is just a lean. */
export const BEST_ANGLE_MIN_CONFIDENCE_PCT = 55;
export const LEAN_MIN_EDGE_PCT = 1.0;

export type PlayGrade =
  | "best_angle"
  | "lean"
  | "market_aligned"
  | "no_bet"
  | "provisional"
  | "hold";

/** High-level prediction label exposed in sport_specific. */
export type PredictionType = "best_angle" | "lean" | "market_aligned" | "no_bet" | null;

export interface PlayGradeInput {
  /** Model probability for the chosen side in [0, 1]. */
  modelProb: number | null;
  /** No-vig market probability for the chosen side in [0, 1]. */
  marketProb: number | null;
  /** American odds on the chosen side (raw, vig-included). */
  americanOdds: number | null;
  /** Data quality tier from V2.1 assessment. */
  dataQualityTier: "high" | "medium" | "low" | "fallback";
  /** True when the pick is provisional (missing starter, degraded market, etc.). */
  provisional: boolean;
  /** True when no pick was produced (truly held — missing market). */
  isHeld: boolean;
  /**
   * Min edge % required for Best Angle. Caller decides — ML uses 2.0%,
   * O/U uses 3.0% pending OU-odds ingestion.
   */
  minBestAngleEdgePct: number;
  /**
   * Min model probability (as %) required for Best Angle. Today's gate
   * is 55. Keeps low-confidence "barely above coin flip + 2% edge" picks
   * out of the highlight reel.
   */
  minBestAngleConfidencePct: number;
  /**
   * Optional sharp-signal agreement:
   *   "agrees"  — sharp signal supports model pick
   *   "opposes" — sharp signal opposes model pick
   *   "neutral" — no signal or signal ambiguous
   */
  sharpAgreement?: "agrees" | "opposes" | "neutral";
  /**
   * MLB-P0 market-sanity: true when the market probability used is a
   * fallback / default (no real de-vigged odds — e.g. the 0.51
   * fallback_default ML source, or a total with no real O/U price). A
   * fallback market prob can manufacture a fake edge, so it can never
   * produce a Best Angle (the pick still grades lean/market_aligned).
   */
  marketProbIsFallback?: boolean;
  /**
   * MLB-P0 market-sanity: caller-supplied hard block on Best Angle (e.g.
   * total requires real O/U odds, key-feature neutral fallback). When set,
   * the pick can still grade lean/market_aligned but never Best Angle.
   */
  bestAngleHardBlockReason?: string | null;
}

export interface PlayGradeResult {
  grade: PlayGrade;
  /** High-level label for sport_specific.prediction_type. */
  predictionType: PredictionType;
  edgePct: number | null;
  evPct: number | null;
  reason: string;
  /** Populated only when grade==="best_angle" — explicit gate-pass description. */
  bestAngleReason: string | null;
  /** Populated when grade==="no_bet" or "market_aligned" — why not to bet. */
  noBetReason: string | null;
  /** True when model and market agree at low conviction. */
  marketAligned: boolean;
  /** MLB-P0: the market probability used was a fallback/default. */
  marketProbWasFallback: boolean;
  /** MLB-P0: Best Angle was hard-blocked (fallback / caller contradiction). */
  bestAngleBlocked: boolean;
  /** MLB-P0: human-readable reason(s) Best Angle was blocked. */
  bestAngleBlockReason: string | null;
}

/**
 * Compute the Play Grade for a market pick.
 *
 * Decision flow:
 *   1. Held → "hold".
 *   2. fallback or provisional → "provisional".
 *   3. Edge ≥ BEST_ANGLE_MIN_EDGE_PCT AND EV ≥ 0 AND data high AND not opposed by sharps → "best_angle".
 *   4. Edge ≥ LEAN_MIN_EDGE_PCT → "lean".
 *   5. Edge in [-0.5, 1.0]% → "market_aligned" (model and market agree at low conviction).
 *   6. Edge < -0.5% (model worse than market) → "no_bet".
 */
export function computePlayGrade(opts: PlayGradeInput): PlayGradeResult {
  const marketProbWasFallback = opts.marketProbIsFallback === true;
  const auditDefaults = {
    marketProbWasFallback,
    bestAngleBlocked: false,
    bestAngleBlockReason: null as string | null,
  };
  if (opts.isHeld) {
    return {
      grade: "hold",
      predictionType: null,
      edgePct: null,
      evPct: null,
      reason: "Market baseline missing or unsafe.",
      bestAngleReason: null,
      noBetReason: "Market data unavailable.",
      marketAligned: false,
      ...auditDefaults,
    };
  }

  if (opts.modelProb === null || opts.marketProb === null) {
    return {
      grade: "provisional",
      predictionType: "lean",
      edgePct: null,
      evPct: null,
      reason: "Insufficient inputs for edge/EV calculation.",
      bestAngleReason: null,
      noBetReason: "Insufficient data for full edge calculation.",
      marketAligned: false,
      ...auditDefaults,
    };
  }

  const edgePct = round1((opts.modelProb - opts.marketProb) * 100);
  const evPct = opts.americanOdds !== null
    ? round1(expectedValueFromAmerican(opts.modelProb, opts.americanOdds) * 100)
    : null;
  const confidencePct = round1(opts.modelProb * 100);
  const marketAligned = Math.abs(edgePct) < LEAN_MIN_EDGE_PCT;

  // Provisional / fallback bucket — any data limitation drops to provisional.
  if (opts.provisional || opts.dataQualityTier === "fallback" || opts.dataQualityTier === "low") {
    return {
      grade: "provisional",
      predictionType: "lean",
      edgePct,
      evPct,
      reason: `Data-limited (tier=${opts.dataQualityTier}${opts.provisional ? ", provisional" : ""}); pick provided at reduced confidence.`,
      bestAngleReason: null,
      noBetReason: `Data quality tier=${opts.dataQualityTier}${opts.provisional ? " and provisional" : ""}; not a betting recommendation.`,
      marketAligned,
      ...auditDefaults,
    };
  }

  // MLB-P0 market-sanity blocks — a fallback/default market probability or
  // a caller-supplied contradiction can never become a Best Angle. They
  // cap below it (fall through to lean/market_aligned) and carry a reason
  // for audit. Regularization already bounds edge size upstream, so there
  // is no separate edge ceiling here.
  const blockReasons: string[] = [];
  if (marketProbWasFallback) {
    blockReasons.push("market probability is a fallback/default (no real de-vigged odds)");
  }
  if (opts.bestAngleHardBlockReason !== undefined && opts.bestAngleHardBlockReason !== null) {
    blockReasons.push(opts.bestAngleHardBlockReason);
  }
  const bestAngleBlocked = blockReasons.length > 0;
  const blockAudit = {
    marketProbWasFallback,
    bestAngleBlocked,
    bestAngleBlockReason: bestAngleBlocked ? blockReasons.join("; ") : null,
  };

  // Best Angle gates — strict: edge AND EV AND confidence AND data quality
  // AND no sharp opposition AND none of the P0 market-sanity blocks.
  const failedGates: string[] = [...blockReasons];
  if (edgePct < opts.minBestAngleEdgePct) failedGates.push(`edge ${edgePct.toFixed(1)}% < ${opts.minBestAngleEdgePct}%`);
  if (evPct !== null && evPct < BEST_ANGLE_MIN_EV_PCT) failedGates.push(`EV ${evPct.toFixed(1)}% < 0%`);
  if (confidencePct < opts.minBestAngleConfidencePct) failedGates.push(`confidence ${confidencePct.toFixed(1)}% < ${opts.minBestAngleConfidencePct}%`);
  if (opts.dataQualityTier !== "high") failedGates.push(`data quality tier=${opts.dataQualityTier}`);
  if (opts.sharpAgreement === "opposes") failedGates.push("sharp signal opposes pick");

  if (failedGates.length === 0) {
    return {
      grade: "best_angle",
      predictionType: "best_angle",
      edgePct,
      evPct,
      reason: `Edge ${edgePct.toFixed(1)}% ≥ ${opts.minBestAngleEdgePct}%, EV ${evPct === null ? "n/a" : evPct.toFixed(1) + "%"} ≥ 0%, conf ${confidencePct.toFixed(1)}% ≥ ${opts.minBestAngleConfidencePct}%, high data quality.`,
      bestAngleReason: `Edge ${edgePct.toFixed(1)}% over no-vig market; EV ${evPct === null ? "n/a" : evPct.toFixed(1) + "%"}; conf ${confidencePct.toFixed(1)}%; high data quality; sharp ${opts.sharpAgreement ?? "neutral"}.`,
      noBetReason: null,
      marketAligned: false,
      ...blockAudit,
    };
  }

  // Below Best Angle but above lean threshold → "lean"
  if (edgePct >= LEAN_MIN_EDGE_PCT) {
    return {
      grade: "lean",
      predictionType: "lean",
      edgePct,
      evPct,
      reason: `Lean (edge ${edgePct.toFixed(1)}%); fails Best Angle: ${failedGates.join(", ")}.`,
      bestAngleReason: null,
      noBetReason: `Lean only — fails Best Angle gates: ${failedGates.join(", ")}.`,
      marketAligned: false,
      ...blockAudit,
    };
  }

  // Edge in [-1.0, 1.0)% → market_aligned
  if (edgePct >= -LEAN_MIN_EDGE_PCT) {
    return {
      grade: "market_aligned",
      predictionType: "market_aligned",
      edgePct,
      evPct,
      reason: `Model and market within ${Math.abs(edgePct).toFixed(1)}%; pick informational only.`,
      bestAngleReason: null,
      noBetReason: `Edge ${edgePct.toFixed(1)}% inside ±${LEAN_MIN_EDGE_PCT}% — no meaningful value over the market.`,
      marketAligned: true,
      ...blockAudit,
    };
  }

  // Edge < -1% → market favored over model → no_bet
  return {
    grade: "no_bet",
    predictionType: "no_bet",
    edgePct,
    evPct,
    reason: `Negative edge ${edgePct.toFixed(1)}%; market favored over model.`,
    bestAngleReason: null,
    noBetReason: `Negative model edge (${edgePct.toFixed(1)}%); market sees this side as worse than model thinks. Pick shown but do not bet.`,
    marketAligned: false,
    ...blockAudit,
  };
}

function expectedValueFromAmerican(prob: number, americanOdds: number): number {
  const decimalOdds = americanOdds > 0
    ? 1 + americanOdds / 100
    : 1 + 100 / Math.abs(americanOdds);
  const payoff = decimalOdds - 1;
  return prob * payoff - (1 - prob);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
