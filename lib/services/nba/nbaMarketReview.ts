/**
 * Phase 7B v0c — NBA market-review primitives.
 *
 * Pure functions. No DB, no network. Take model probabilities + market
 * odds + lines and produce: no-vig implied probabilities, edge, conflict
 * band, and a market-aware recommendation per market. NBA-tuned
 * thresholds — explicitly NOT copied from MLB.
 *
 * Design intent: the admin preview must show NOT just "ML home 51%"
 * but ALSO the market context (line, no-vig prob, edge vs market,
 * agree/conflict band) so the operator can judge pick quality. The
 * model's confidence is capped when the market disagrees strongly,
 * even if the model itself is confident — honest disagreement matters.
 */

// ─── American/decimal/implied probability helpers ──────────────────

export function americanToDecimal(american: number | null): number | null {
  if (american === null || american === 0) return null;
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

export function americanToImpliedProb(american: number | null): number | null {
  if (american === null || american === 0) return null;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/**
 * Two-side no-vig probabilities. Takes the two American prices on the
 * two sides of a market (home/away or over/under), computes implied
 * probabilities, then normalizes so the pair sums to 1.0 (removes the
 * bookmaker's vig).
 *
 * Returns null on either side when the input pair is incomplete or
 * malformed. The caller treats "null" as "market not available for
 * comparison" — model output stands but no edge can be computed.
 */
export function noVigPair(opts: {
  sideAAmerican: number | null;
  sideBAmerican: number | null;
}): { sideA: number; sideB: number } | null {
  const a = americanToImpliedProb(opts.sideAAmerican);
  const b = americanToImpliedProb(opts.sideBAmerican);
  if (a === null || b === null) return null;
  const total = a + b;
  if (total <= 0) return null;
  return { sideA: a / total, sideB: b / total };
}

// ─── NBA-specific edge + conflict bands ────────────────────────────
//
// Thresholds tuned for NBA market behavior (NOT copied from MLB):
//   • ML probability gaps in NBA are wider than MLB because basketball
//     has fewer high-leverage moments. A 5pp gap is "supports / mild
//     edge", 10pp+ is "strong conflict".
//   • Spread gaps measured in points. NBA spreads typically move
//     ~1–2 points; 4+ point disagreement is rare and a strong signal.
//   • Total gaps also in points. NBA totals move ~3 points naturally;
//     6+ point disagreement is a strong signal.
//
// These remain v0 placeholders — calibration will refine them as we
// collect tracking data.

export const NBA_ML_PROB_GAP_NEUTRAL_MAX = 0.02;
export const NBA_ML_PROB_GAP_MILD_MAX = 0.05;
export const NBA_ML_PROB_GAP_STRONG_MIN = 0.10;

export const NBA_SPREAD_GAP_NEUTRAL_MAX = 1.0;
export const NBA_SPREAD_GAP_MILD_MAX = 2.0;
export const NBA_SPREAD_GAP_STRONG_MIN = 4.0;

export const NBA_TOTAL_GAP_NEUTRAL_MAX = 2.0;
export const NBA_TOTAL_GAP_MILD_MAX = 4.0;
export const NBA_TOTAL_GAP_STRONG_MIN = 6.0;

/** How big the edge must be (model_prob - market_no_vig_prob) for Best Angle. */
export const NBA_BEST_ANGLE_MIN_EDGE_PROB = 0.04;

/** Minimum confidence for Best Angle (NBA). */
export const NBA_BEST_ANGLE_MIN_CONFIDENCE = 62;

/**
 * Best Angle is the board's strongest straight-bet tier. A favorite priced
 * at -400 or shorter requires risking at least four units to win one, so it
 * may remain an actionable Lean but cannot be promoted as a Best Angle.
 */
export const NBA_ML_BEST_ANGLE_MAX_FAVORITE_PRICE = -400;

export type MarketConflictBand =
  | "support"           // compatibility token: model has positive value versus the no-vig price
  | "neutral"           // model and no-vig market probability are close
  | "mild_conflict"     // compatibility token: market prices the same pick slightly shorter than the model
  | "strong_conflict"   // compatibility token: market prices the same pick materially shorter than the model
  | "market_unavailable"; // not enough market data to compute

/**
 * Conflict band for a moneyline. `modelProb` = model's probability on the
 * SAME side as `marketNoVigProb`. Positive `edge` means model favors the
 * pick more than market does (positive model value). Negative edge means the
 * market prices that same side more strongly than the model; it does not mean
 * the market moved toward the other team. Qualified movement is carried by
 * the professional reader instead.
 */
export function classifyMlConflict(opts: {
  modelProb: number;          // model probability for the pick side
  marketNoVigProb: number;    // no-vig market probability for the same side
}): { band: MarketConflictBand; edge: number; gap_abs: number } {
  const edge = opts.modelProb - opts.marketNoVigProb;
  const gap = Math.abs(edge);
  if (gap < NBA_ML_PROB_GAP_NEUTRAL_MAX) return { band: "neutral", edge, gap_abs: gap };
  if (edge > 0) {
    // Compatibility token: the model sees positive value versus the no-vig price.
    if (gap < NBA_ML_PROB_GAP_MILD_MAX) return { band: "support", edge, gap_abs: gap };
    if (gap >= NBA_ML_PROB_GAP_STRONG_MIN) return { band: "support", edge, gap_abs: gap };
    // 5-10pp: model remains more confident than the current market price.
    return { band: "support", edge, gap_abs: gap };
  }
  // Compatibility token: the market prices this same pick above the model.
  if (gap >= NBA_ML_PROB_GAP_STRONG_MIN) return { band: "strong_conflict", edge, gap_abs: gap };
  return { band: "mild_conflict", edge, gap_abs: gap };
}

/**
 * Conflict band for a spread market. Compares `modelSpreadHome` (the
 * model's projected home spread; negative = home favored) against the
 * `marketSpreadHome` (the actual line). Positive `edge` means the model
 * thinks home is MORE of a favorite than the market does.
 *
 * E.g. model -5, market -2 → edge = +3 (model thinks home is 3 pts
 * better than the market spread, leaning HOME). Strong conflict if
 * gap >= 4 points.
 */
export function classifySpreadConflict(opts: {
  modelSpreadHome: number;
  marketSpreadHome: number;
  pickSide: "home" | "away";
}): { band: MarketConflictBand; edge: number; gap_abs: number } {
  // edge: positive = model favors home more than market does
  const edge = opts.marketSpreadHome - opts.modelSpreadHome;
  const gap = Math.abs(edge);
  // From the perspective of the pick: if pickSide = "home" and edge > 0,
  // market supports (model says home covers by more); if edge < 0,
  // market disagrees with home pick.
  const sign = opts.pickSide === "home" ? edge : -edge;
  if (gap < NBA_SPREAD_GAP_NEUTRAL_MAX) return { band: "neutral", edge: sign, gap_abs: gap };
  if (sign > 0) {
    return { band: "support", edge: sign, gap_abs: gap };
  }
  if (gap >= NBA_SPREAD_GAP_STRONG_MIN) return { band: "strong_conflict", edge: sign, gap_abs: gap };
  return { band: "mild_conflict", edge: sign, gap_abs: gap };
}

/**
 * Conflict band for a total. Compares `modelTotal` to `marketTotal`,
 * adjusted by the pick side (over/under).
 *
 * E.g. model 224, market 218, pick OVER → edge = +6 (model thinks
 * total is 6 pts higher than market — supports OVER).
 */
export function classifyTotalConflict(opts: {
  modelTotal: number;
  marketTotal: number;
  pickSide: "over" | "under";
}): { band: MarketConflictBand; edge: number; gap_abs: number } {
  const rawEdge = opts.modelTotal - opts.marketTotal;
  const gap = Math.abs(rawEdge);
  const sign = opts.pickSide === "over" ? rawEdge : -rawEdge;
  if (gap < NBA_TOTAL_GAP_NEUTRAL_MAX) return { band: "neutral", edge: sign, gap_abs: gap };
  if (sign > 0) {
    return { band: "support", edge: sign, gap_abs: gap };
  }
  if (gap >= NBA_TOTAL_GAP_STRONG_MIN) return { band: "strong_conflict", edge: sign, gap_abs: gap };
  return { band: "mild_conflict", edge: sign, gap_abs: gap };
}

// ─── Recommendation grades (NBA-tuned) ─────────────────────────────

export type RecommendationGrade =
  | "best_angle"        // confident model + supportive/neutral market + strong edge
  | "lean"              // confident model + supportive/neutral market + moderate edge
  | "watch"             // thin edge or weak market data — informational only
  | "caution"           // model picks something but market strongly disagrees
  | "no_market"         // market unavailable — model emits pick, no edge
  | "held";             // model itself didn't emit a pick (e.g. tier=fallback);

/**
 * Compose grade + rationale per market.
 *
 * Rules (NBA-specific):
 *   • If pick is null (model held) → "held".
 *   • If market is unavailable → "no_market" (model output stands; no edge).
 *   • If band === "strong_conflict" → "caution", confidence capped to
 *     min(actualConfidence, 55). Best-Angle blocked.
 *   • If confidence < 55 → "watch" (thin model).
 *   • If band === "mild_conflict" → "watch" (market hedges).
 *   • Else (neutral/support): if confidence >= BEST_ANGLE_MIN_CONFIDENCE
 *     AND edge >= BEST_ANGLE_MIN_EDGE → "best_angle"; else "lean".
 *   • dataQualityTier === "fallback" or "low" → cap at "watch" max.
 */
export type GradeInput = {
  pick: string | null;
  confidence: number;
  band: MarketConflictBand;
  edge: number;
  dataQualityTier: "high" | "medium" | "low" | "fallback";
  injuriesKnown: boolean;
  market?: "moneyline" | "spread" | "total";
  independentEdgePoints?: number | null;
  readerQualified?: boolean;
  readerCorrectionApplied?: boolean;
  readerMagnitudePoints?: number | null;
  currentPriceAmerican?: number | null;
  /** Uncapped probability from the same coherent distribution that owns the pick. */
  modelProbabilityOnPick?: number | null;
  moneylineEvidence?: NbaMoneylineReaderEvidence;
  /** Same-input audit hook for the superseded Moneyline Best Angle path. */
  enforceMoneylineEvidenceGuard?: boolean;
  /** Same-input audit hook for the superseded price-incoherent grade path. */
  enforcePositiveModelEv?: boolean;
  /** Same-input audit hook for the superseded same-side price-gap Caution. */
  interpretMoneylinePriceGapAsConflict?: boolean;
  /** Same-input audit hook for the superseded steep-favorite Best Angle path. */
  enforceSteepMoneylineBestAngleTier?: boolean;
};

export type NbaMoneylineReaderEvidence = {
  directReadQualified: boolean;
  directReadSide: "home" | "away" | null;
  spreadReadQualified: boolean;
  spreadReadSide: "home" | "away" | null;
  spreadCorrectionApplied: boolean;
};

export type GradeOutput = {
  grade: RecommendationGrade;
  effectiveConfidence: number;
  bestAngleEligible: boolean;
  rationale: string[];
};

export const NBA_MARKET_SPECIFIC_GRADE_CALIBRATION = {
  spread: { bestAngle: 60, lean: 56 },
  total: { bestAngle: 60, lean: 54 },
} as const;

function expectedReturn(probability: number, american: number | null | undefined): number | null {
  if (american === null || american === undefined || american === 0) return null;
  const profit = american > 0 ? american / 100 : 100 / Math.abs(american);
  return probability * profit - (1 - probability);
}

function marketSpecificGrade(input: GradeInput): GradeOutput | null {
  if (input.market !== "spread" && input.market !== "total") return null;
  if (input.dataQualityTier !== "high" || !input.injuriesKnown) {
    return {
      grade: "watch",
      effectiveConfidence: Math.min(input.confidence, 52),
      bestAngleEligible: false,
      rationale: ["The model has a side, but the complete high-quality pregame picture is not ready."],
    };
  }
  const independentEdge = input.independentEdgePoints;
  if (independentEdge === null || independentEdge === undefined || !Number.isFinite(independentEdge)) {
    return {
      grade: "watch",
      effectiveConfidence: Math.min(input.confidence, 52),
      bestAngleEligible: false,
      rationale: ["The independent edge cannot be verified against this exact line yet."],
    };
  }
  const magnitude = input.readerMagnitudePoints ?? null;
  let grade: "best_angle" | "lean" | null = null;
  let calibrated = 0;
  let rationale = "";
  if (input.market === "spread") {
    const bestIndependent = input.readerQualified !== true &&
      Math.abs(independentEdge) >= 2.5 && Math.abs(independentEdge) < 3.5;
    const bestCorrection = input.readerCorrectionApplied === true &&
      magnitude !== null && magnitude >= 4;
    const leanCorrection = input.readerCorrectionApplied === true &&
      magnitude !== null && magnitude >= 3 && magnitude < 4;
    if (bestIndependent || bestCorrection) {
      grade = "best_angle";
      calibrated = NBA_MARKET_SPECIFIC_GRADE_CALIBRATION.spread.bestAngle;
      rationale = bestCorrection
        ? "A strong qualified market correction and the independent score resolve to this same final side."
        : "The independent model is in its historically strongest moderate Spread edge band.";
    } else if (leanCorrection) {
      grade = "lean";
      calibrated = NBA_MARKET_SPECIFIC_GRADE_CALIBRATION.spread.lean;
      rationale = "A qualified market correction clears the validated Spread lean band.";
    }
  } else {
    const edge = Math.abs(independentEdge);
    const bestCorrection = input.readerCorrectionApplied === true && edge >= 5 && edge < 9;
    const leanCorrection = input.readerCorrectionApplied === true && edge >= 9;
    const leanIndependentOver = input.readerQualified !== true && input.pick === "over" &&
      independentEdge >= 1 && independentEdge < 2;
    if (bestCorrection) {
      grade = "best_angle";
      calibrated = NBA_MARKET_SPECIFIC_GRADE_CALIBRATION.total.bestAngle;
      rationale = "A qualified Total correction clears the validated disagreement band.";
    } else if (leanCorrection || leanIndependentOver) {
      grade = "lean";
      calibrated = NBA_MARKET_SPECIFIC_GRADE_CALIBRATION.total.lean;
      rationale = leanCorrection
        ? "A qualified Total correction remains playable at a conservative calibrated grade."
        : "The independent Over sits in the validated low-residual Total lane.";
    }
  }
  if (grade === null) {
    return {
      grade: "watch",
      effectiveConfidence: Math.min(input.confidence, 52),
      bestAngleEligible: false,
      rationale: ["The forecast has a side, but this exact market state is outside the validated NBA play lanes."],
    };
  }
  const ev = expectedReturn(calibrated / 100, input.currentPriceAmerican);
  if (ev === null || ev <= 0) {
    return {
      grade: "watch",
      effectiveConfidence: Math.min(calibrated, 52),
      bestAngleEligible: false,
      rationale: [`${rationale} The selected price does not clear positive calibrated value.`],
    };
  }
  return {
    grade,
    effectiveConfidence: calibrated,
    bestAngleEligible: grade === "best_angle",
    rationale: [rationale],
  };
}

// Member-facing band phrasing. Keeps the underlying band token (used by
// admin/debug paths) free to evolve while shipping clean Daily Edge copy.
function memberBandPhrase(band: MarketConflictBand): string {
  switch (band) {
    case "support":             return "model value over the current price";
    case "neutral":             return "model and price alignment";
    case "mild_conflict":       return "a price slightly ahead of the model";
    case "strong_conflict":     return "a price well ahead of the model";
    case "market_unavailable":  return "no market read yet";
  }
}

export function gradeNbaMarket(input: GradeInput): GradeOutput {
  const rationale: string[] = [];
  if (input.pick === null) {
    return {
      grade: "held",
      effectiveConfidence: 0,
      bestAngleEligible: false,
      rationale: ["Model isn't picking a side here tonight."],
    };
  }
  if (input.band === "market_unavailable") {
    rationale.push(
      "Market data isn't available for this read yet — the model has a lean, but there's nothing to confirm against.",
    );
    return {
      grade: "no_market",
      effectiveConfidence: Math.min(input.confidence, 55),
      bestAngleEligible: false,
      rationale,
    };
  }
  if (
    input.band === "strong_conflict" &&
    (input.market !== "moneyline" || input.interpretMoneylinePriceGapAsConflict === true)
  ) {
    const capped = Math.min(input.confidence, 55);
    rationale.push(
      "The available price is materially shorter than the model's fair probability — this stays a cautious read, not a play.",
    );
    return { grade: "caution", effectiveConfidence: capped, bestAngleEligible: false, rationale };
  }
  const modelPriceEv = input.modelProbabilityOnPick === null || input.modelProbabilityOnPick === undefined
    ? null
    : expectedReturn(input.modelProbabilityOnPick, input.currentPriceAmerican);
  if (
    input.enforcePositiveModelEv !== false &&
    input.currentPriceAmerican !== undefined &&
    (modelPriceEv === null || modelPriceEv <= 0)
  ) {
    return {
      grade: "watch",
      effectiveConfidence: Math.min(input.confidence, 52),
      bestAngleEligible: false,
      rationale: ["The forecast has a side, but its probability does not clear positive value at the selected price."],
    };
  }
  const specialized = marketSpecificGrade(input);
  if (specialized !== null) return specialized;
  if (input.dataQualityTier === "fallback" || input.dataQualityTier === "low") {
    rationale.push(
      "Limited data on this market tonight — treat as informational, not a top play.",
    );
    return {
      grade: "watch",
      effectiveConfidence: Math.min(input.confidence, 52),
      bestAngleEligible: false,
      rationale,
    };
  }
  if (input.confidence < 55) {
    rationale.push("Thin model edge — worth monitoring, not a top play.");
    return { grade: "watch", effectiveConfidence: input.confidence, bestAngleEligible: false, rationale };
  }
  if (input.band === "mild_conflict") {
    rationale.push("The available price is ahead of the model's fair probability — keeping this on the watchlist.");
    return { grade: "watch", effectiveConfidence: input.confidence, bestAngleEligible: false, rationale };
  }
  // band is neutral or support, confidence >= 55, tier >= medium
  const edgeOk = Math.abs(input.edge) >= NBA_BEST_ANGLE_MIN_EDGE_PROB;
  if (
    input.confidence >= NBA_BEST_ANGLE_MIN_CONFIDENCE &&
    edgeOk &&
    input.injuriesKnown &&
    input.dataQualityTier === "high"
  ) {
    const evidence = input.moneylineEvidence;
    const pickedSide = input.pick === "home" || input.pick === "away" ? input.pick : null;
    const steepFavorite = input.market === "moneyline" &&
      input.currentPriceAmerican !== null && input.currentPriceAmerican !== undefined &&
      input.currentPriceAmerican <= NBA_ML_BEST_ANGLE_MAX_FAVORITE_PRICE;
    if (input.enforceSteepMoneylineBestAngleTier !== false && steepFavorite) {
      rationale.push(
        "The model still projects a likely winner with positive value, but the current favorite price is too steep for Best Angle status.",
      );
      return {
        grade: "lean",
        effectiveConfidence: input.confidence,
        bestAngleEligible: false,
        rationale,
      };
    }
    const directOpposes = pickedSide !== null && evidence?.directReadQualified === true &&
      evidence.directReadSide !== null && evidence.directReadSide !== pickedSide;
    const spreadOpposes = pickedSide !== null && evidence?.directReadQualified !== true &&
      evidence?.spreadReadQualified === true && evidence.spreadReadSide !== null &&
      evidence.spreadReadSide !== pickedSide;
    const opposingObservation = input.market === "moneyline" &&
      evidence?.spreadCorrectionApplied !== true && (directOpposes || spreadOpposes);
    if (input.enforceMoneylineEvidenceGuard !== false && opposingObservation) {
      rationale.push(
        "The independent value remains playable, but qualified opposite-side movement keeps it below Best Angle; the signal is not strong enough to flip the pick.",
      );
      return {
        grade: "lean",
        effectiveConfidence: input.confidence,
        bestAngleEligible: false,
        rationale,
      };
    }
    const directConfirms = pickedSide !== null && evidence?.directReadQualified === true &&
      evidence.directReadSide === pickedSide;
    const spreadConfirms = pickedSide !== null && evidence?.directReadQualified !== true &&
      evidence?.spreadReadQualified === true && evidence.spreadReadSide === pickedSide;
    if (input.market === "moneyline" && evidence?.spreadCorrectionApplied === true) {
      rationale.push("Strong model value at the selected price after a validated Spread correction authored the final side.");
    } else if (input.market === "moneyline" && directConfirms) {
      rationale.push("Strong model value at the selected price with qualified named-book Moneyline movement confirming the side.");
    } else if (input.market === "moneyline" && spreadConfirms) {
      rationale.push("Strong model value at the selected price with qualified Spread movement agreeing with the side.");
    } else {
      rationale.push("Strong independent value at the selected price with no qualified market evidence opposing the side.");
    }
    return { grade: "best_angle", effectiveConfidence: input.confidence, bestAngleEligible: true, rationale };
  }
  // Lean — model is confident enough but doesn't clear the Best Angle bar.
  // Build a member-safe reason in plain language: surface which dimension is
  // holding it back, never which exact threshold or number.
  const reasons: string[] = [];
  if (input.confidence < NBA_BEST_ANGLE_MIN_CONFIDENCE) reasons.push("conviction isn't strong enough");
  if (!edgeOk) reasons.push("edge over the market isn't wide enough");
  if (!input.injuriesKnown) reasons.push("the injury picture is still developing");
  if (input.dataQualityTier !== "high") reasons.push("limited book coverage keeps confidence conservative");

  const reasonClause =
    reasons.length === 0
      ? "the read doesn't quite clear Best Angle strength"
      : reasons.length === 1
        ? reasons[0]!
        : `${reasons.slice(0, -1).join(", ")}, and ${reasons[reasons.length - 1]}`;

  rationale.push(
    `Model lean with ${memberBandPhrase(input.band)}, but ${reasonClause} — held below Best Angle.`,
  );
  return { grade: "lean", effectiveConfidence: input.confidence, bestAngleEligible: false, rationale };
}
