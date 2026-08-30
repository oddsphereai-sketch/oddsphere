import type { NcaafBookOdds } from "./balldontlieNcaafSlate";
import {
  buildCfbMarketInformedOutcomeForecast,
  type CfbCanonicalMarketAnchor,
} from "./cfbMarketInformedOutcome";
import type { CfbSharpApiSplitRecord } from "./cfbSharpApiSplits";
import type {
  CfbV1ExactPriceDecision,
  CfbV1DecisionBundle,
  CfbV1Forecast,
  CfbV1Grade,
  CfbV1Market,
} from "./cfbV1Decision";

export const CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE =
  "cfb_market_sharp_aware_candidate_2026_08_30_r4_market_dominant_fresh_sharp" as const;
export const CFB_MARKET_SHARP_AWARE_SHADOW_RELEASE =
  CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE;
export const CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE =
  "cfb_market_sharp_aware_production_2026_08_30_r6_market_dominant_fresh_sharp" as const;
export const CFB_MARKET_SHADOW_WEIGHT = 0.75 as const;
export const CFB_SHARP_SIGNED_GAP_THRESHOLD_PP = 10 as const;
export const CFB_SHARP_FULL_STRENGTH_GAP_PP = 20 as const;
export const CFB_SHARP_MAX_MARGIN_SHIFT_POINTS = 1.5 as const;
export const CFB_SHARP_MAX_TOTAL_SHIFT_POINTS = 1.5 as const;
export const CFB_SHARP_MAX_AGE_MINUTES = 120 as const;
export const CFB_SHARP_LINE_MATCH_TOLERANCE_POINTS = 0.5 as const;
export const CFB_WATCHLIST_NEAR_NEUTRAL_MIN_EDGE_PP = 0 as const;
export const CFB_WATCHLIST_NEAR_NEUTRAL_MIN_EV = -0.03 as const;
export const CFB_WATCHLIST_EVIDENCE_CONFLICT_MIN_EDGE_PP = -3 as const;
export const CFB_WATCHLIST_EVIDENCE_CONFLICT_MIN_EV = -0.1 as const;
export const CFB_RECALIBRATED_SPREAD_LEAN_MIN_EDGE_PP = 4.99 as const;
export const CFB_RECALIBRATED_SPREAD_LEAN_MAX_ABS_LINE = 10 as const;
export const CFB_RECALIBRATED_SPREAD_LEAN_MIN_PRICE = -500 as const;
export const CFB_RECALIBRATED_SPREAD_LEAN_MAX_PRICE = 500 as const;
export const CFB_PROVISIONAL_ACTIONABLE_MIN_PRICE = -500 as const;
export const CFB_PROVISIONAL_ACTIONABLE_MAX_PRICE = 500 as const;
export const CFB_PROVISIONAL_BEST_ANGLE_MIN_PROBABILITY = 0.55 as const;
export const CFB_PROVISIONAL_BEST_ANGLE_MIN_EDGE_PP = 5 as const;
export const CFB_PROVISIONAL_BEST_ANGLE_MIN_EV = 0.06 as const;
export const CFB_PROVISIONAL_SPREAD_LEAN_MIN_PROBABILITY = 0.53 as const;
export const CFB_PROVISIONAL_SPREAD_LEAN_MIN_EDGE_PP = 2.5 as const;
export const CFB_PROVISIONAL_SPREAD_LEAN_MIN_EV = 0.02 as const;
export const CFB_PROVISIONAL_SPREAD_LEAN_MAX_ABS_LINE = 10 as const;
export const CFB_PROVISIONAL_TOTAL_LEAN_MIN_PROBABILITY = 0.52 as const;
export const CFB_PROVISIONAL_TOTAL_LEAN_MIN_EDGE_PP = 2.5 as const;
export const CFB_PROVISIONAL_TOTAL_LEAN_MIN_EV = 0.015 as const;

type CanonicalSide = "home" | "away" | "over" | "under";
export type CfbMarketEvidenceDirection = "support" | "resistance" | "neutral" | "unknown";

export type CfbMarketSharpAwareShadowForecast = CfbV1Forecast & {
  shadowRelease: typeof CFB_MARKET_SHARP_AWARE_SHADOW_RELEASE;
  forecastBasis: "independent_market_sharp_joint_pmf_mixture";
  marketWeight: typeof CFB_MARKET_SHADOW_WEIGHT;
  sharpAdjustment: {
    source: "circa" | null;
    observedAt: string | null;
    homeMarginGapPp: number | null;
    overTotalGapPp: number | null;
    homeMarginShiftPoints: number;
    totalShiftPoints: number;
    adjustedAnchor: CfbCanonicalMarketAnchor;
  };
};

export type CfbMarketSharpAwareForecast = Omit<CfbMarketSharpAwareShadowForecast, "shadowRelease"> & {
  candidateRelease: typeof CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE;
  release: typeof CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE;
};

type CfbMarketEvidenceGradeBase = {
  market: CfbV1Market;
  selectedSide: CanonicalSide;
  probabilityGrade: CfbV1Grade;
  finalGrade: CfbV1Grade;
  sharpDirection: CfbMarketEvidenceDirection;
  sharpGapPp: number | null;
  sharpObservedAt: string | null;
  movementDirection: CfbMarketEvidenceDirection;
  movementImpliedProbabilityDeltaPp: number | null;
  movementLineDelta: number | null;
  reasonCodes: string[];
};

export type CfbMarketEvidenceGradeShadow = CfbMarketEvidenceGradeBase & {
  shadowRelease: typeof CFB_MARKET_SHARP_AWARE_SHADOW_RELEASE;
};

export type CfbMarketEvidenceGrade = CfbMarketEvidenceGradeBase & {
  candidateRelease: typeof CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE;
  release: typeof CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE;
};

export function buildCfbMarketSharpAwareShadowForecast(args: {
  independentForecast: CfbV1Forecast;
  anchor: CfbCanonicalMarketAnchor;
  sharpSplits: CfbSharpApiSplitRecord[];
  evaluatedAt: string;
}): CfbMarketSharpAwareShadowForecast {
  const sharp = latestEligibleCirca(args.sharpSplits, args.evaluatedAt);
  const marginGaps = sharp
    ? [
        sharp.moneyline ? signedGap(sharp.moneyline.home) : null,
        sharp.spread && Math.abs(sharp.spread.homeLine - args.anchor.homeSpread) <= CFB_SHARP_LINE_MATCH_TOLERANCE_POINTS
          ? signedGap(sharp.spread.home)
          : null,
      ].filter((value): value is number => value !== null)
    : [];
  const homeMarginGapPp = marginGaps.length > 0 ? mean(marginGaps) : null;
  const overTotalGapPp = sharp?.total && Math.abs(sharp.total.line - args.anchor.totalLine) <= CFB_SHARP_LINE_MATCH_TOLERANCE_POINTS
    ? signedGap(sharp.total.over)
    : null;
  const homeMarginShiftPoints = signedPointShift(homeMarginGapPp, CFB_SHARP_MAX_MARGIN_SHIFT_POINTS);
  const totalShiftPoints = signedPointShift(overTotalGapPp, CFB_SHARP_MAX_TOTAL_SHIFT_POINTS);
  const adjustedAnchor: CfbCanonicalMarketAnchor = {
    ...args.anchor,
    homeSpread: -( -args.anchor.homeSpread + homeMarginShiftPoints),
    totalLine: args.anchor.totalLine + totalShiftPoints,
  };
  const marketForecast = buildCfbMarketInformedOutcomeForecast({
    independentForecast: args.independentForecast,
    anchor: adjustedAnchor,
  });
  const pmf = mixPmfs(args.independentForecast.pmf, marketForecast.pmf, CFB_MARKET_SHADOW_WEIGHT);
  const summary = summarizePmf(pmf);
  return {
    providerGameId: args.independentForecast.providerGameId,
    awayTeam: args.independentForecast.awayTeam,
    homeTeam: args.independentForecast.homeTeam,
    gameStartsAt: args.independentForecast.gameStartsAt,
    ...summary,
    pmf,
    shadowRelease: CFB_MARKET_SHARP_AWARE_SHADOW_RELEASE,
    forecastBasis: "independent_market_sharp_joint_pmf_mixture",
    marketWeight: CFB_MARKET_SHADOW_WEIGHT,
    sharpAdjustment: {
      source: sharp ? "circa" : null,
      observedAt: sharp?.capturedAt ?? null,
      homeMarginGapPp,
      overTotalGapPp,
      homeMarginShiftPoints,
      totalShiftPoints,
      adjustedAnchor,
    },
  };
}

export function buildCfbMarketSharpAwareForecast(args: {
  independentForecast: CfbV1Forecast;
  anchor: CfbCanonicalMarketAnchor;
  sharpSplits: CfbSharpApiSplitRecord[];
  evaluatedAt: string;
}): CfbMarketSharpAwareForecast {
  const { shadowRelease, ...forecast } = buildCfbMarketSharpAwareShadowForecast(args);
  return {
    ...forecast,
    candidateRelease: shadowRelease,
    release: CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
  };
}

export function buildCfbMarketEvidenceGradeShadow(args: {
  decision: CfbV1ExactPriceDecision;
  selectedSide: CanonicalSide;
  sharpSplits: CfbSharpApiSplitRecord[];
  operationalOpening: { quote: NcaafBookOdds } | null;
}): CfbMarketEvidenceGradeShadow {
  const sharpRead = strictSharpRead({
    decision: args.decision,
    selectedSide: args.selectedSide,
    sharpSplits: args.sharpSplits,
  });
  const movementRead = sameBookMovement({
    decision: args.decision,
    selectedSide: args.selectedSide,
    operationalOpening: args.operationalOpening,
  });
  const sharpResistance = sharpRead.direction === "resistance";
  const movementResistance = movementRead.direction === "resistance";
  const anyResistance = sharpResistance || movementResistance;
  const jointResistance = sharpResistance && movementResistance;
  const promotableSupport = sharpRead.direction === "support" && !movementResistance;
  let finalGrade = args.decision.grade;
  const reasonCodes: string[] = [];

  if (args.decision.grade === "Best Angle" && anyResistance) {
    finalGrade = jointResistance ? "Watchlist" : "Lean";
    reasonCodes.push(jointResistance ? "joint_sharp_movement_resistance" : "market_evidence_resistance");
  } else if (args.decision.grade === "Lean" && anyResistance) {
    finalGrade = "Watchlist";
    reasonCodes.push("market_evidence_resistance");
  } else if (
    args.decision.grade === "Lean" &&
    args.decision.modelProbability >= CFB_PROVISIONAL_BEST_ANGLE_MIN_PROBABILITY &&
    args.decision.edgePercentagePoints >= CFB_PROVISIONAL_BEST_ANGLE_MIN_EDGE_PP &&
    args.decision.expectedValue >= CFB_PROVISIONAL_BEST_ANGLE_MIN_EV &&
    args.decision.evaluatedQuote.price >= CFB_PROVISIONAL_ACTIONABLE_MIN_PRICE &&
    args.decision.evaluatedQuote.price <= CFB_PROVISIONAL_ACTIONABLE_MAX_PRICE
  ) {
    finalGrade = "Best Angle";
    reasonCodes.push("provisional_complete_tuple_best_angle");
  } else if (
    args.decision.grade === "Watchlist" &&
    args.decision.market === "spread" &&
    !anyResistance &&
    args.decision.modelProbability >= CFB_PROVISIONAL_SPREAD_LEAN_MIN_PROBABILITY &&
    args.decision.edgePercentagePoints >= CFB_PROVISIONAL_SPREAD_LEAN_MIN_EDGE_PP &&
    args.decision.expectedValue >= CFB_PROVISIONAL_SPREAD_LEAN_MIN_EV &&
    args.decision.evaluatedQuote.line !== null &&
    Math.abs(args.decision.evaluatedQuote.line) <= CFB_PROVISIONAL_SPREAD_LEAN_MAX_ABS_LINE &&
    args.decision.evaluatedQuote.price >= CFB_PROVISIONAL_ACTIONABLE_MIN_PRICE &&
    args.decision.evaluatedQuote.price <= CFB_PROVISIONAL_ACTIONABLE_MAX_PRICE
  ) {
    finalGrade = "Lean";
    reasonCodes.push("provisional_complete_tuple_spread_lean");
  } else if (
    args.decision.grade === "Watchlist" &&
    args.decision.market === "total" &&
    !anyResistance &&
    args.decision.modelProbability >= CFB_PROVISIONAL_TOTAL_LEAN_MIN_PROBABILITY &&
    args.decision.edgePercentagePoints >= CFB_PROVISIONAL_TOTAL_LEAN_MIN_EDGE_PP &&
    args.decision.expectedValue >= CFB_PROVISIONAL_TOTAL_LEAN_MIN_EV &&
    args.decision.evaluatedQuote.price >= CFB_PROVISIONAL_ACTIONABLE_MIN_PRICE &&
    args.decision.evaluatedQuote.price <= CFB_PROVISIONAL_ACTIONABLE_MAX_PRICE
  ) {
    finalGrade = "Lean";
    reasonCodes.push("provisional_complete_tuple_total_lean");
  } else if (
    args.decision.grade === "Watchlist" &&
    promotableSupport &&
    nearLeanThreshold(args.decision)
  ) {
    finalGrade = "Lean";
    reasonCodes.push("strict_sharp_near_threshold_promotion");
  } else if (
    args.decision.grade === "Watchlist" &&
    args.decision.market === "spread" &&
    !anyResistance &&
    args.decision.evaluatedQuote.line !== null &&
    Math.abs(args.decision.evaluatedQuote.line) <= CFB_RECALIBRATED_SPREAD_LEAN_MAX_ABS_LINE &&
    args.decision.evaluatedQuote.price >= CFB_RECALIBRATED_SPREAD_LEAN_MIN_PRICE &&
    args.decision.evaluatedQuote.price <= CFB_RECALIBRATED_SPREAD_LEAN_MAX_PRICE &&
    args.decision.edgePercentagePoints >= CFB_RECALIBRATED_SPREAD_LEAN_MIN_EDGE_PP &&
    args.decision.expectedValue > 0
  ) {
    finalGrade = "Lean";
    reasonCodes.push("recalibrated_borderline_spread_lean");
  } else if (
    args.decision.grade === "No Play" &&
    !anyResistance &&
    args.decision.edgePercentagePoints >= CFB_WATCHLIST_NEAR_NEUTRAL_MIN_EDGE_PP &&
    args.decision.expectedValue >= CFB_WATCHLIST_NEAR_NEUTRAL_MIN_EV
  ) {
    finalGrade = "Watchlist";
    reasonCodes.push("near_neutral_price_monitoring");
  } else if (
    args.decision.grade === "No Play" &&
    !anyResistance &&
    (sharpRead.direction === "support" || movementRead.direction === "support") &&
    args.decision.edgePercentagePoints >= CFB_WATCHLIST_EVIDENCE_CONFLICT_MIN_EDGE_PP &&
    args.decision.expectedValue >= CFB_WATCHLIST_EVIDENCE_CONFLICT_MIN_EV
  ) {
    finalGrade = "Watchlist";
    reasonCodes.push("supportive_market_evidence_disagreement_monitoring");
  }

  if (reasonCodes.length === 0) reasonCodes.push("market_evidence_no_grade_change");
  return {
    shadowRelease: CFB_MARKET_SHARP_AWARE_SHADOW_RELEASE,
    market: args.decision.market,
    selectedSide: args.selectedSide,
    probabilityGrade: args.decision.grade,
    finalGrade,
    sharpDirection: sharpRead.direction,
    sharpGapPp: sharpRead.gapPp,
    sharpObservedAt: sharpRead.observedAt,
    movementDirection: movementRead.direction,
    movementImpliedProbabilityDeltaPp: movementRead.impliedProbabilityDeltaPp,
    movementLineDelta: movementRead.lineDelta,
    reasonCodes,
  };
}

export function buildCfbMarketEvidenceGrade(args: {
  decision: CfbV1ExactPriceDecision;
  selectedSide: CanonicalSide;
  sharpSplits: CfbSharpApiSplitRecord[];
  operationalOpening: { quote: NcaafBookOdds } | null;
}): CfbMarketEvidenceGrade {
  const { shadowRelease, ...grade } = buildCfbMarketEvidenceGradeShadow(args);
  return {
    ...grade,
    candidateRelease: shadowRelease,
    release: CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
  };
}

export function applyCfbMarketSharpAwareGrades(args: {
  bundle: CfbV1DecisionBundle;
  homeTeam: string;
  sharpSplits: CfbSharpApiSplitRecord[];
  operationalOpening: { quote: NcaafBookOdds } | null;
}): CfbV1DecisionBundle {
  const adjustments = new Map(annotateCfbCrossMarketGradeCoherence(
    args.bundle.evaluatedBets.map((decision) => buildCfbMarketEvidenceGrade({
      decision,
      selectedSide: selectedSide(args.homeTeam, decision),
      sharpSplits: args.sharpSplits,
      operationalOpening: args.operationalOpening,
    })),
  ).map((adjustment) => [adjustment.market, adjustment] as const));
  return {
    ...args.bundle,
    evaluatedBets: args.bundle.evaluatedBets.map((decision) => {
      const adjustment = adjustments.get(decision.market);
      if (!adjustment) throw new Error(`CFB ${decision.market} market/sharp grade adjustment is missing.`);
      return {
        ...decision,
        grade: adjustment.finalGrade,
        probabilityGrade: adjustment.probabilityGrade,
        gradeAdjustment: {
          release: adjustment.release,
          candidateRelease: adjustment.candidateRelease,
          sharpDirection: adjustment.sharpDirection,
          movementDirection: adjustment.movementDirection,
          reasonCodes: adjustment.reasonCodes,
        },
      };
    }),
  };
}

export function annotateCfbCrossMarketGradeCoherence<T extends CfbMarketEvidenceGradeBase>(
  rows: T[],
): T[] {
  const moneyline = rows.find((row) => row.market === "moneyline");
  const spread = rows.find((row) => row.market === "spread");
  const spreadActionable = spread?.finalGrade === "Lean" || spread?.finalGrade === "Best Angle";
  const moneylineNotActionable = moneyline?.finalGrade === "Watchlist" || moneyline?.finalGrade === "No Play";
  if (!moneyline || !spread || !spreadActionable || !moneylineNotActionable) return rows;

  const sharedTeamThesis = moneyline.selectedSide === spread.selectedSide;
  const code = sharedTeamThesis
    ? "spread_value_can_exceed_moneyline_price_value"
    : "favorite_win_and_underdog_cover_can_coexist";
  return rows.map((row) => row.market === "moneyline" || row.market === "spread"
    ? { ...row, reasonCodes: [...row.reasonCodes, code] }
    : row) as T[];
}

function nearLeanThreshold(decision: CfbV1ExactPriceDecision): boolean {
  if (!(decision.expectedValue > 0)) return false;
  if (decision.market === "moneyline") {
    return decision.evaluatedQuote.price >= -200 &&
      decision.evaluatedQuote.price <= 200 &&
      decision.edgePercentagePoints >= 2;
  }
  if (decision.market === "spread") {
    return decision.evaluatedQuote.line !== null &&
      Math.abs(decision.evaluatedQuote.line) <= 7 &&
      decision.edgePercentagePoints >= 4;
  }
  return decision.edgePercentagePoints >= 4;
}

function selectedSide(homeTeam: string, decision: CfbV1ExactPriceDecision): CanonicalSide {
  if (decision.market === "total") return /^over\b/i.test(decision.side) ? "over" : "under";
  return decision.side.startsWith(homeTeam) ? "home" : "away";
}

function strictSharpRead(args: {
  decision: CfbV1ExactPriceDecision;
  selectedSide: CanonicalSide;
  sharpSplits: CfbSharpApiSplitRecord[];
}): { direction: CfbMarketEvidenceDirection; gapPp: number | null; observedAt: string | null } {
  const record = latestEligibleCirca(args.sharpSplits, args.decision.evaluatedAt);
  if (!record) return { direction: "unknown", gapPp: null, observedAt: null };
  let gapPp: number | null = null;
  if (args.decision.market === "moneyline" && record.moneyline && (args.selectedSide === "home" || args.selectedSide === "away")) {
    gapPp = signedGap(record.moneyline[args.selectedSide]);
  } else if (args.decision.market === "spread" && record.spread && (args.selectedSide === "home" || args.selectedSide === "away")) {
    const line = args.selectedSide === "home" ? record.spread.homeLine : record.spread.awayLine;
    if (args.decision.evaluatedQuote.line !== null && Math.abs(line - args.decision.evaluatedQuote.line) < 0.001) {
      gapPp = signedGap(record.spread[args.selectedSide]);
    }
  } else if (args.decision.market === "total" && record.total && (args.selectedSide === "over" || args.selectedSide === "under")) {
    if (args.decision.evaluatedQuote.line !== null && Math.abs(record.total.line - args.decision.evaluatedQuote.line) < 0.001) {
      gapPp = signedGap(record.total[args.selectedSide]);
    }
  }
  if (gapPp === null) return { direction: "unknown", gapPp: null, observedAt: record.capturedAt };
  return {
    direction: gapPp >= CFB_SHARP_SIGNED_GAP_THRESHOLD_PP
      ? "support"
      : gapPp <= -CFB_SHARP_SIGNED_GAP_THRESHOLD_PP
        ? "resistance"
        : "neutral",
    gapPp,
    observedAt: record.capturedAt,
  };
}

function sameBookMovement(args: {
  decision: CfbV1ExactPriceDecision;
  selectedSide: CanonicalSide;
  operationalOpening: { quote: NcaafBookOdds } | null;
}): { direction: CfbMarketEvidenceDirection; impliedProbabilityDeltaPp: number | null; lineDelta: number | null } {
  const opening = args.operationalOpening?.quote ?? null;
  if (!opening || normalizeBook(opening.sportsbook) !== normalizeBook(args.decision.evaluatedQuote.sportsbook)) {
    return { direction: "unknown", impliedProbabilityDeltaPp: null, lineDelta: null };
  }
  const quote = quoteFor(opening, args.decision.market, args.selectedSide);
  if (!quote) return { direction: "unknown", impliedProbabilityDeltaPp: null, lineDelta: null };
  const impliedProbabilityDeltaPp = 100 * (implied(args.decision.evaluatedQuote.price) - implied(quote.price));
  const lineDelta = args.decision.evaluatedQuote.line === null || quote.line === null
    ? null
    : args.decision.evaluatedQuote.line - quote.line;
  let signedSupport = impliedProbabilityDeltaPp;
  if (lineDelta !== null && Math.abs(lineDelta) >= 0.5) {
    if (args.decision.market === "spread") signedSupport = -lineDelta;
    else if (args.selectedSide === "over") signedSupport = lineDelta;
    else signedSupport = -lineDelta;
  }
  return {
    direction: signedSupport >= 1 ? "support" : signedSupport <= -1 ? "resistance" : "neutral",
    impliedProbabilityDeltaPp,
    lineDelta,
  };
}

function quoteFor(book: NcaafBookOdds, market: CfbV1Market, side: CanonicalSide): { line: number | null; price: number } | null {
  if (market === "moneyline" && book.moneyline && (side === "home" || side === "away")) {
    return { line: null, price: side === "home" ? book.moneyline.homePrice : book.moneyline.awayPrice };
  }
  if (market === "spread" && book.spread && (side === "home" || side === "away")) {
    return {
      line: side === "home" ? book.spread.homeLine : book.spread.awayLine,
      price: side === "home" ? book.spread.homePrice : book.spread.awayPrice,
    };
  }
  if (market === "total" && book.total && (side === "over" || side === "under")) {
    return { line: book.total.line, price: side === "over" ? book.total.overPrice : book.total.underPrice };
  }
  return null;
}

function latestEligibleCirca(records: CfbSharpApiSplitRecord[], evaluatedAt: string): CfbSharpApiSplitRecord | null {
  const evaluationMs = Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluationMs)) throw new Error(`Invalid CFB market/sharp evaluation timestamp: ${evaluatedAt}.`);
  return records
    .filter((record) => {
      if (record.sportsbook !== "circa" || record.sourceSemantics !== "sharp_adjacent") return false;
      const capturedMs = Date.parse(record.capturedAt);
      const ageMinutes = (evaluationMs - capturedMs) / 60_000;
      return Number.isFinite(capturedMs) && ageMinutes >= 0 && ageMinutes <= CFB_SHARP_MAX_AGE_MINUTES;
    })
    .sort((first, second) => Date.parse(second.capturedAt) - Date.parse(first.capturedAt))[0] ?? null;
}

function signedGap(side: { ticketsPct: number; moneyPct: number }): number {
  return side.moneyPct - side.ticketsPct;
}

function signedPointShift(gapPp: number | null, maximum: number): number {
  if (gapPp === null || Math.abs(gapPp) <= CFB_SHARP_SIGNED_GAP_THRESHOLD_PP) return 0;
  const strength = Math.min(1, (Math.abs(gapPp) - CFB_SHARP_SIGNED_GAP_THRESHOLD_PP) /
    (CFB_SHARP_FULL_STRENGTH_GAP_PP - CFB_SHARP_SIGNED_GAP_THRESHOLD_PP));
  return Math.sign(gapPp) * maximum * strength;
}

function mixPmfs(
  independent: CfbV1Forecast["pmf"],
  market: CfbV1Forecast["pmf"],
  marketWeight: number,
): CfbV1Forecast["pmf"] {
  const counts = new Map<string, { home: number; away: number; probability: number }>();
  for (const [pmf, weight] of [[independent, 1 - marketWeight], [market, marketWeight]] as const) {
    for (const cell of pmf) {
      const key = `${cell.home}:${cell.away}`;
      const current = counts.get(key);
      counts.set(key, {
        home: cell.home,
        away: cell.away,
        probability: (current?.probability ?? 0) + weight * cell.probability,
      });
    }
  }
  const total = [...counts.values()].reduce((sum, cell) => sum + cell.probability, 0);
  return [...counts.values()]
    .map((cell) => ({ ...cell, probability: cell.probability / total }))
    .sort((first, second) => first.home - second.home || first.away - second.away);
}

function summarizePmf(pmf: CfbV1Forecast["pmf"]): Pick<CfbV1Forecast,
  "expectedAwayPoints" | "expectedHomePoints" | "expectedMarginHome" | "expectedTotal" |
  "homeWinProbability" | "representativeScore" | "interval80"> {
  const expectedHomePoints = pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
  const expectedAwayPoints = pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
  const expectedMarginHome = expectedHomePoints - expectedAwayPoints;
  const expectedTotal = expectedHomePoints + expectedAwayPoints;
  const homeWinProbability = pmf.reduce((sum, cell) =>
    sum + (cell.home > cell.away ? cell.probability : cell.home === cell.away ? 0.5 * cell.probability : 0), 0);
  const representativePool = pmf.filter((cell) =>
    homeWinProbability > 0.5 ? cell.home > cell.away : homeWinProbability < 0.5 ? cell.home < cell.away : true);
  const representative = [...(representativePool.length > 0 ? representativePool : pmf)].sort((first, second) =>
    representativeDistance(first, expectedHomePoints, expectedAwayPoints, expectedMarginHome, expectedTotal) -
      representativeDistance(second, expectedHomePoints, expectedAwayPoints, expectedMarginHome, expectedTotal) ||
    second.probability - first.probability
  )[0]!;
  return {
    expectedAwayPoints,
    expectedHomePoints,
    expectedMarginHome,
    expectedTotal,
    homeWinProbability,
    representativeScore: { away: representative.away, home: representative.home },
    interval80: {
      away: [weightedQuantile(pmf, (cell) => cell.away, 0.1), weightedQuantile(pmf, (cell) => cell.away, 0.9)],
      home: [weightedQuantile(pmf, (cell) => cell.home, 0.1), weightedQuantile(pmf, (cell) => cell.home, 0.9)],
      marginHome: [weightedQuantile(pmf, (cell) => cell.home - cell.away, 0.1), weightedQuantile(pmf, (cell) => cell.home - cell.away, 0.9)],
      total: [weightedQuantile(pmf, (cell) => cell.home + cell.away, 0.1), weightedQuantile(pmf, (cell) => cell.home + cell.away, 0.9)],
    },
  };
}

function weightedQuantile(
  pmf: CfbV1Forecast["pmf"],
  value: (cell: CfbV1Forecast["pmf"][number]) => number,
  probability: number,
): number {
  const rows = [...pmf].sort((first, second) => value(first) - value(second));
  let cumulative = 0;
  for (const row of rows) {
    cumulative += row.probability;
    if (cumulative + 1e-12 >= probability) return value(row);
  }
  return value(rows[rows.length - 1]!);
}

function representativeDistance(
  cell: { home: number; away: number },
  expectedHome: number,
  expectedAway: number,
  expectedMargin: number,
  expectedTotal: number,
): number {
  return (cell.home - expectedHome) ** 2 + (cell.away - expectedAway) ** 2 +
    ((cell.home - cell.away) - expectedMargin) ** 2 +
    ((cell.home + cell.away) - expectedTotal) ** 2;
}

function implied(price: number): number {
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
