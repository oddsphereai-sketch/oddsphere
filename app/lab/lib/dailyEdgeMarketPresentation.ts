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
  "daily_edge_member_presentation_2026_08_26_r3_forecast_grade_separation";

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
 * Convert an internal operational exception into the canonical member-facing
 * No Play shape. `held` deliberately remains true so the health monitor and
 * targeted recovery job can still see the exception. The model-owned outcome
 * forecast is immutable presentation context and remains visible for every
 * exception class. Only the incomplete exact-price bet-evaluation tuple is
 * withheld; current two-sided market context and authentic split sections may
 * remain visible, but they can never masquerade as a recommendation.
 */
export function presentDailyEdgeOperationalNoPlay(
  market: MarketEdgeDto,
  holdReason?: string | null,
): MarketEdgeDto {
  if (!market.held) return market;
  const reason = dailyEdgeOperationalNoPlayReason(market, holdReason)
    ?? "No Play — required evidence is incomplete.";
  const recommendationDecision = market.recommendationDecision
    ? {
        ...market.recommendationDecision,
        pick: null,
        marketImplied: null,
        edgePp: null,
        price: null,
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
    marketImpliedPct: null,
    modelMarketGapPct: null,
    recommendationConfidence: null,
    recommendationDecision,
  };
}
