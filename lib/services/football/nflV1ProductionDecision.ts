import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import {
  buildNflRegularEvaluatedBetDecision,
  buildNflRegularOutcomeConfidence,
  type NflRegularEvaluatedBetDecision,
  type NflRegularOutcomeConfidence,
} from "./nflRegularDecisionEvidence";
import {
  NFL_R6_MONEYLINE_CALIBRATION_RELEASE,
  NFL_R6_MONEYLINE_MODEL_RELEASE,
  type NflR6ShadowMoneylineDecision,
} from "./nflR6MoneylineShadow";
import {
  getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities,
} from "./nflV1WeekOneOutcome";

export const NFL_V1_PRODUCTION_MODEL_RELEASE =
  "nfl_v1_daily_edge_model_2026_08_23_r2" as const;
export const NFL_V1_PRODUCTION_CALIBRATION_RELEASE =
  "nfl_v1_daily_edge_calibration_2026_08_23_r2" as const;
export const NFL_V1_PRODUCTION_DECISION_RELEASE =
  "nfl_v1_daily_edge_decision_2026_08_24_r3_grading_tiers" as const;
export const NFL_V1_GRADE_POLICY_RELEASE =
  "nfl_v1_grade_policy_2026_08_24_r3" as const;
export const NFL_V1_MEMBER_RELEASE =
  "nfl_v1_member_release_2026_08_24_r3_grading_tiers" as const;

export const NFL_V1_WATCHLIST_MINIMUM_EXPECTED_VALUE = -0.01 as const;
export const NFL_V1_WATCHLIST_MINIMUM_EDGE_PERCENTAGE_POINTS = -1.0 as const;
export const NFL_V1_GRADE_MINIMUM_AMERICAN_PRICE = -300 as const;
export const NFL_V1_GRADE_MAXIMUM_AMERICAN_PRICE = 300 as const;

export type NflV1ProductionDecisionBundle = {
  evaluatedBets: NflRegularEvaluatedBetDecision[];
  outcomeConfidence: NflRegularOutcomeConfidence[];
  modelPromotionStatus: typeof NFL_V1_MEMBER_RELEASE;
  publicationEnabled: true;
  trackingEnabled: false;
};

export function buildNflV1ProductionDecisionBundle(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
  current: NflPreviewBookOdds;
  shadowMoneyline: NflR6ShadowMoneylineDecision;
}): NflV1ProductionDecisionBundle {
  const outcome = getNflV1WeekOneOutcomeForecast({
    providerGameId: args.providerGameId,
    awayTeam: args.awayTeam,
    homeTeam: args.homeTeam,
  });
  const spread = args.current.spread;
  const total = args.current.total;
  if (!spread || !total) throw new Error(`NFL v1 current spread/total is incomplete for ${args.providerGameId}.`);
  const lineProbabilities = nflV1WeekOneLineProbabilities({
    forecast: outcome,
    homeSpread: spread.homeLine,
    totalLine: total.line,
  });
  const homeWinner = outcome.homeWinProbability >= outcome.awayWinProbability;
  const spreadHome = lineProbabilities.spread.homeCoverProbability >= lineProbabilities.spread.awayCoverProbability;
  const totalOver = lineProbabilities.total.overProbability >= lineProbabilities.total.underProbability;
  const outcomeConfidence = [
    buildNflRegularOutcomeConfidence({
      market: "moneyline",
      likelySide: homeWinner ? args.homeTeam : args.awayTeam,
      probability: homeWinner ? outcome.homeWinProbability : outcome.awayWinProbability,
      evaluatedAt: args.current.observedAt,
      modelRelease: NFL_V1_PRODUCTION_MODEL_RELEASE,
    }),
    buildNflRegularOutcomeConfidence({
      market: "spread",
      likelySide: spreadHome ? args.homeTeam : args.awayTeam,
      probability: spreadHome ? lineProbabilities.spread.homeCoverProbability : lineProbabilities.spread.awayCoverProbability,
      evaluatedAt: args.current.observedAt,
      modelRelease: NFL_V1_PRODUCTION_MODEL_RELEASE,
    }),
    buildNflRegularOutcomeConfidence({
      market: "total",
      likelySide: totalOver ? `Over ${total.line}` : `Under ${total.line}`,
      probability: totalOver ? lineProbabilities.total.overProbability : lineProbabilities.total.underProbability,
      evaluatedAt: args.current.observedAt,
      modelRelease: NFL_V1_PRODUCTION_MODEL_RELEASE,
    }),
  ];
  const healthBlocked = args.shadowMoneyline.health.blockingReasons.length > 0 ||
    args.shadowMoneyline.decisionStage === "t60_held" ||
    !args.shadowMoneyline.evaluatedQuote ||
    !args.shadowMoneyline.team ||
    args.shadowMoneyline.modelProbability === null ||
    args.shadowMoneyline.otherBooksConsensusFairProbability === null;
  if (healthBlocked) {
    return {
      evaluatedBets: [],
      outcomeConfidence,
      modelPromotionStatus: NFL_V1_MEMBER_RELEASE,
      publicationEnabled: true,
      trackingEnabled: false,
    };
  }
  const r6Team = args.shadowMoneyline.team;
  const r6Probability = args.shadowMoneyline.modelProbability;
  const r6ConsensusFairProbability = args.shadowMoneyline.otherBooksConsensusFairProbability;
  const r6EvaluatedQuote = args.shadowMoneyline.evaluatedQuote;
  if (!r6Team || r6Probability === null || r6ConsensusFairProbability === null || !r6EvaluatedQuote) {
    throw new Error(`NFL v1 moneyline tuple unexpectedly became incomplete for ${args.providerGameId}.`);
  }
  const moneylineBoard = args.current.moneyline;
  if (!moneylineBoard) throw new Error(`NFL v1 current moneyline is incomplete for ${args.providerGameId}.`);
  const stage = args.shadowMoneyline.decisionStage === "t60_locked" ? "t60_locked" as const : "unlocked" as const;
  const lockedAt = stage === "t60_locked" ? args.shadowMoneyline.lockedAt : null;
  const common = {
    providerGameId: args.providerGameId,
    stage,
    evaluatedAt: args.shadowMoneyline.evaluatedAt,
    gameStartsAt: args.gameStartsAt,
    decisionRelease: NFL_V1_PRODUCTION_DECISION_RELEASE,
    lockedAt,
  };
  const outcomeWinner = homeWinner ? args.homeTeam : args.awayTeam;
  const r6Lean = args.shadowMoneyline.grade === "Lean" && r6Team === outcomeWinner;
  const moneylinePublicPrice = homeWinner ? moneylineBoard.homePrice : moneylineBoard.awayPrice;
  const watchlistReason = !r6Lean && boundedGradePrice(moneylinePublicPrice)
    ? nflV1WatchlistReason({ shadowMoneyline: args.shadowMoneyline, outcomeWinner })
    : null;
  const r6NearBoundary = watchlistReason === "near_exact_price_boundary";
  const useR6Tuple = r6Lean || r6NearBoundary;
  const moneylineTeam = useR6Tuple ? r6Team : homeWinner ? args.homeTeam : args.awayTeam;
  const moneylineModelProbability = useR6Tuple
    ? r6Probability
    : homeWinner ? outcome.homeWinProbability : outcome.awayWinProbability;
  const moneylineQuote = useR6Tuple ? r6EvaluatedQuote : {
    sportsbook: args.current.sportsbook,
    line: null,
    price: moneylinePublicPrice,
    observedAt: args.current.observedAt,
  };
  const moneylineFairProbability = useR6Tuple
    ? r6ConsensusFairProbability
    : twoSidedFair(
        homeWinner ? moneylineBoard.homePrice : moneylineBoard.awayPrice,
        homeWinner ? moneylineBoard.awayPrice : moneylineBoard.homePrice,
      );
  const moneyline = buildNflRegularEvaluatedBetDecision({
    ...common,
    market: "moneyline",
    side: moneylineTeam,
    modelProbability: moneylineModelProbability,
    marketFairProbability: moneylineFairProbability,
    evaluatedQuote: moneylineQuote,
    grade: r6Lean ? "Lean" : watchlistReason ? "Watchlist" : "No Play",
    modelRelease: useR6Tuple ? NFL_R6_MONEYLINE_MODEL_RELEASE : NFL_V1_PRODUCTION_MODEL_RELEASE,
    calibrationRelease: useR6Tuple ? NFL_R6_MONEYLINE_CALIBRATION_RELEASE : NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
  });
  const spreadDecision = buildNflRegularEvaluatedBetDecision({
    ...common,
    market: "spread",
    side: spreadHome ? args.homeTeam : args.awayTeam,
    modelProbability: spreadHome ? lineProbabilities.spread.homeCoverProbability : lineProbabilities.spread.awayCoverProbability,
    marketFairProbability: twoSidedFair(
      spreadHome ? spread.homePrice : spread.awayPrice,
      spreadHome ? spread.awayPrice : spread.homePrice,
    ),
    evaluatedQuote: {
      sportsbook: args.current.sportsbook,
      line: spreadHome ? spread.homeLine : spread.awayLine,
      price: spreadHome ? spread.homePrice : spread.awayPrice,
      observedAt: args.current.observedAt,
    },
    grade: "No Play",
    modelRelease: NFL_V1_PRODUCTION_MODEL_RELEASE,
    calibrationRelease: NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
  });
  const totalDecision = buildNflRegularEvaluatedBetDecision({
    ...common,
    market: "total",
    side: totalOver ? `Over ${total.line}` : `Under ${total.line}`,
    modelProbability: totalOver ? lineProbabilities.total.overProbability : lineProbabilities.total.underProbability,
    marketFairProbability: twoSidedFair(
      totalOver ? total.overPrice : total.underPrice,
      totalOver ? total.underPrice : total.overPrice,
    ),
    evaluatedQuote: {
      sportsbook: args.current.sportsbook,
      line: total.line,
      price: totalOver ? total.overPrice : total.underPrice,
      observedAt: args.current.observedAt,
    },
    grade: "No Play",
    modelRelease: NFL_V1_PRODUCTION_MODEL_RELEASE,
    calibrationRelease: NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
  });
  const evaluatedBets = [moneyline, spreadDecision, totalDecision];
  return {
    evaluatedBets,
    outcomeConfidence,
    modelPromotionStatus: NFL_V1_MEMBER_RELEASE,
    publicationEnabled: true,
    // The member release publishes coherent prediction/decision tuples into
    // the append-only forward-evidence store only. Official prediction-record
    // tracking is a separate, intentionally unimplemented release boundary.
    trackingEnabled: false,
  };
}

export type NflV1WatchlistReason =
  | "r6_r10_direction_disagreement"
  | "near_exact_price_boundary";

export function nflV1WatchlistReason(args: {
  shadowMoneyline: NflR6ShadowMoneylineDecision;
  outcomeWinner: string;
}): NflV1WatchlistReason | null {
  const shadow = args.shadowMoneyline;
  if (
    shadow.health.blockingReasons.length > 0
    || shadow.decisionStage === "t60_held"
    || !shadow.team
    || !shadow.evaluatedQuote
    || shadow.expectedValuePerUnit === null
    || shadow.edgePercentagePoints === null
    || !boundedGradePrice(shadow.evaluatedQuote.price)
  ) return null;
  if (shadow.grade === "Lean" && shadow.team !== args.outcomeWinner) {
    return "r6_r10_direction_disagreement";
  }
  if (
    shadow.grade !== "Lean"
    && shadow.team === args.outcomeWinner
    && shadow.expectedValuePerUnit >= NFL_V1_WATCHLIST_MINIMUM_EXPECTED_VALUE
    && shadow.edgePercentagePoints >= NFL_V1_WATCHLIST_MINIMUM_EDGE_PERCENTAGE_POINTS
  ) return "near_exact_price_boundary";
  return null;
}

function boundedGradePrice(price: number): boolean {
  return price >= NFL_V1_GRADE_MINIMUM_AMERICAN_PRICE
    && price <= NFL_V1_GRADE_MAXIMUM_AMERICAN_PRICE;
}

function twoSidedFair(selectedPrice: number, opposingPrice: number): number {
  const selected = americanImplied(selectedPrice);
  const opposing = americanImplied(opposingPrice);
  return selected / (selected + opposing);
}

function americanImplied(price: number): number {
  if (!Number.isFinite(price) || price === 0) throw new Error("NFL v1 price must be non-zero American odds.");
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}
