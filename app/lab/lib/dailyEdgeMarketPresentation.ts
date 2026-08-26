import type { MarketEdgeDto } from "./labTypes";

export type DailyEdgePresentationVerdict = {
  key: MarketEdgeDto["verdict"]["key"];
  label: string;
};

type PresentationMarket = Pick<MarketEdgeDto, "held" | "verdict">;

type OperationalReasonMarket = Pick<
  MarketEdgeDto,
  | "held"
  | "reviewFlags"
  | "capReasons"
  | "displayReason"
  | "guidedGuide"
  | "guidedWatchOut"
  | "whyLine"
  | "riskLine"
>;

export const DAILY_EDGE_MEMBER_PRESENTATION_RELEASE_ID =
  "daily_edge_member_presentation_2026_08_26_r2_operational_no_play";

/**
 * Internal holds remain machine-visible health exceptions. The member
 * contract intentionally presents them as No Play because required evidence
 * is incomplete and no bet has been evaluated safely.
 */
export function dailyEdgePresentationVerdict(
  market: PresentationMarket,
): DailyEdgePresentationVerdict {
  return market.held
    ? { key: "no_play", label: "No Play" }
    : market.verdict;
}

export function dailyEdgeHeldGuide(market: PresentationMarket): string | null {
  return market.held
    ? "No Play: required evidence is incomplete, so no exact-price bet evaluation is being presented."
    : null;
}

export function dailyEdgeHeldRisk(market: PresentationMarket): string | null {
  return market.held
    ? "Starter, lineup, identity, or price evidence is still unconfirmed; internal recovery remains active."
    : null;
}

function operationalReasonText(
  market: OperationalReasonMarket,
  holdReason?: string | null,
): string[] {
  return [
    holdReason,
    ...(market.reviewFlags ?? []),
    ...(market.capReasons ?? []),
    market.displayReason,
    market.guidedGuide,
    market.guidedWatchOut,
    market.whyLine,
    market.riskLine,
  ]
    .filter((reason): reason is string => Boolean(reason))
    .map((reason) => reason.toLowerCase());
}

export function dailyEdgeOperationalNoPlayReason(
  market: OperationalReasonMarket,
  holdReason?: string | null,
): string | null {
  if (!market.held) return null;
  const reasons = operationalReasonText(market, holdReason);
  if (reasons.some((reason) => reason.includes("starter"))) {
    return "No Play — starter unconfirmed; required evidence is incomplete.";
  }
  if (reasons.some((reason) => reason.includes("price") || reason.includes("odds"))) {
    return "No Play — a complete exact-price market tuple is unavailable.";
  }
  return "No Play — required evidence is incomplete.";
}

/**
 * Price/consensus availability can prevent an exact-price bet evaluation
 * without invalidating an independently produced forecast. Starter, lineup,
 * identity, feature, or model-integrity exceptions invalidate the forecast
 * itself and must withhold it. Unknown exception classes fail closed.
 */
export function dailyEdgeOperationalExceptionWithholdsForecast(
  market: OperationalReasonMarket,
  holdReason?: string | null,
): boolean {
  if (!market.held) return false;
  const authoritativeReasons = [
    holdReason,
    ...(market.reviewFlags ?? []),
    ...(market.capReasons ?? []),
  ]
    .filter((reason): reason is string => Boolean(reason))
    .map((reason) => reason.toLowerCase());
  const reasons = authoritativeReasons.length > 0
    ? authoritativeReasons
    : operationalReasonText(market, holdReason);
  const forecastIntegrityFailure = reasons.some((reason) =>
    /starter|lineup|pitcher|quarterback|\bqb\b|roster|depth|matchup_identity|team_identity|model_(?:output|input|integrity|unavailable)|projection|probability|feature_(?:missing|invalid)|missing_(?:input|feature)/.test(reason)
  );
  if (forecastIntegrityFailure) return true;
  const betTupleOnlyFailure = reasons.some((reason) =>
    /price|odds|consensus|split|market_tuple|two_sided|sportsbook|book_quote/.test(reason)
  );
  return !betTupleOnlyFailure;
}

/**
 * Convert an internal operational exception into the canonical member-facing
 * No Play shape. `held` deliberately remains true so the health monitor and
 * targeted recovery job can still see the exception. Evaluated-side fields
 * are withheld; current two-sided market context and authentic split sections
 * may remain visible, but they can never masquerade as a recommendation.
 */
export function presentDailyEdgeOperationalNoPlay(
  market: MarketEdgeDto,
  holdReason?: string | null,
): MarketEdgeDto {
  if (!market.held) return market;
  const reason = dailyEdgeOperationalNoPlayReason(market, holdReason)
    ?? "No Play — required evidence is incomplete.";
  const withholdForecast = dailyEdgeOperationalExceptionWithholdsForecast(
    market,
    holdReason,
  );
  const recommendationDecision = market.recommendationDecision
    ? {
        ...market.recommendationDecision,
        pick: withholdForecast ? null : market.recommendationDecision.pick,
        modelProbability: withholdForecast
          ? null
          : market.recommendationDecision.modelProbability,
        marketImplied: null,
        edgePp: null,
        price: null,
        projectedScore: withholdForecast
          ? null
          : market.recommendationDecision.projectedScore,
        lineMovement: null,
        resolvedMarketRead: {
          status: "insufficient_data" as const,
          label: "No Clear Signal" as const,
          copy: "Required evidence is incomplete, so no evaluated market read is being presented.",
          tone: "gray" as const,
        },
        playGrade: "No Play" as const,
        quickRead: reason,
        renderedQuickReadCopy: reason,
        renderedSupportingEvidenceCopy: null,
        renderedRiskCopy: "Internal recovery remains active; current market quotes are context only.",
        riskNote: "Required evidence is incomplete.",
        reasonCodes: Array.from(new Set([
          ...market.recommendationDecision.reasonCodes,
          "operational_exception_no_play",
        ])),
      }
    : market.recommendationDecision;

  return {
    ...market,
    pick: withholdForecast ? null : market.pick,
    confidence: withholdForecast ? null : market.confidence,
    grade: null,
    signalType: null,
    marketSignal: null,
    verdict: { key: "no_play", label: "No Play" },
    rawGrade: null,
    rawRecScore: null,
    finalGrade: null,
    finalRecScore: null,
    actionabilityLabel: "No Play",
    displayReason: reason,
    guidedGuide: reason,
    guidedWatchOut: "Internal recovery remains active; current market quotes are context only.",
    whyLine: reason,
    riskLine: "Required evidence is incomplete.",
    modelProb: withholdForecast ? null : market.modelProb,
    marketFairProb: null,
    pinnacleEvPct: null,
    priceAmerican: null,
    bestAvailablePriceAmerican: null,
    bestAvailableSportsbook: null,
    bestAvailableObservedAt: null,
    gradePriceAmerican: null,
    lineOpenAmerican: null,
    lineOpenObservedAt: null,
    oddspherePostedAmerican: null,
    oddspherePostedAt: null,
    oddspherePostedMatchesPick: null,
    lockedLineAmerican: null,
    lockedLineAt: null,
    oddsTrail: [],
    opposingOddsTrail: null,
    marketInterpretation: null,
    marketReadV2: null,
    lastMovePrevAmerican: null,
    lastMoveNextAmerican: null,
    lastMoveAtIso: null,
    lastMoveLinePrev: null,
    lastMoveLineNext: null,
    modelTrustPct: withholdForecast ? null : market.modelTrustPct,
    marketImpliedPct: null,
    modelMarketGapPct: null,
    recommendationConfidence: null,
    recommendationDecision,
  };
}
