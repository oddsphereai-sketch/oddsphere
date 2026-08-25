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
  "nfl_v1_daily_edge_decision_2026_08_24_r4_spread_total_watchlist" as const;
export const NFL_V1_GRADE_POLICY_RELEASE =
  "nfl_v1_grade_policy_2026_08_24_r4_spread_total_watchlist" as const;
export const NFL_V1_MEMBER_RELEASE =
  "nfl_v1_member_release_2026_08_24_r5_expected_points_primary" as const;

export const NFL_V1_WATCHLIST_MINIMUM_EXPECTED_VALUE = -0.01 as const;
export const NFL_V1_WATCHLIST_MINIMUM_EDGE_PERCENTAGE_POINTS = -1.0 as const;
export const NFL_V1_GRADE_MINIMUM_AMERICAN_PRICE = -300 as const;
export const NFL_V1_GRADE_MAXIMUM_AMERICAN_PRICE = 300 as const;
export const NFL_V1_SPREAD_TOTAL_WATCHLIST_MINIMUM_PROBABILITY = 0.60 as const;
export const NFL_V1_SPREAD_TOTAL_WATCHLIST_MINIMUM_EXPECTED_VALUE = 0.0 as const;
export const NFL_V1_SPREAD_TOTAL_WATCHLIST_MINIMUM_EDGE_PERCENTAGE_POINTS = 3.0 as const;
export const NFL_V1_SPREAD_TOTAL_WATCHLIST_MINIMUM_CUSHION = 1.0 as const;

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
  comparableCurrentBooks: NflPreviewBookOdds[];
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
  const spreadEvaluation = selectSpreadTotalEvaluation({
    market: "spread", forecast: outcome, books: args.comparableCurrentBooks,
    awayTeam: args.awayTeam, homeTeam: args.homeTeam, gameStartsAt: args.gameStartsAt,
  });
  const totalEvaluation = selectSpreadTotalEvaluation({
    market: "total", forecast: outcome, books: args.comparableCurrentBooks,
    awayTeam: args.awayTeam, homeTeam: args.homeTeam, gameStartsAt: args.gameStartsAt,
  });
  const spreadDecision = spreadEvaluation ? buildNflRegularEvaluatedBetDecision({
    ...common, market: "spread", side: spreadEvaluation.side,
    modelProbability: spreadEvaluation.probability,
    marketFairProbability: spreadEvaluation.looFairProbability,
    evaluatedQuote: spreadEvaluation.quote,
    grade: spreadEvaluation.watchlist ? "Watchlist" : "No Play",
    modelRelease: NFL_V1_PRODUCTION_MODEL_RELEASE,
    calibrationRelease: NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
  }) : null;
  const totalDecision = totalEvaluation ? buildNflRegularEvaluatedBetDecision({
    ...common, market: "total", side: totalEvaluation.side,
    modelProbability: totalEvaluation.probability,
    marketFairProbability: totalEvaluation.looFairProbability,
    evaluatedQuote: totalEvaluation.quote,
    grade: totalEvaluation.watchlist ? "Watchlist" : "No Play",
    modelRelease: NFL_V1_PRODUCTION_MODEL_RELEASE,
    calibrationRelease: NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
  }) : null;
  const evaluatedBets = [moneyline, spreadDecision, totalDecision].filter(
    (decision): decision is NflRegularEvaluatedBetDecision => decision !== null,
  );
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

type SpreadTotalEvaluation = {
  side: string;
  probability: number;
  pushProbability: number;
  looFairProbability: number;
  expectedValue: number;
  edgePercentagePoints: number;
  cushion: number;
  quote: { sportsbook: string; line: number; price: number; observedAt: string };
  watchlist: boolean;
};

function selectSpreadTotalEvaluation(args: {
  market: "spread" | "total";
  forecast: ReturnType<typeof getNflV1WeekOneOutcomeForecast>;
  books: NflPreviewBookOdds[];
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
}): SpreadTotalEvaluation | null {
  const candidates = args.books.flatMap((target): SpreadTotalEvaluation[] => {
    const board = args.market === "spread" ? target.spread : target.total;
    if (!board || Date.parse(target.observedAt) >= Date.parse(args.gameStartsAt)) return [];
    const line = args.market === "spread" ? target.spread!.homeLine : target.total!.line;
    const probabilities = nflV1WeekOneLineProbabilities({
      forecast: args.forecast,
      homeSpread: args.market === "spread" ? target.spread!.homeLine : 0,
      totalLine: args.market === "total" ? target.total!.line : 0,
    });
    const first = args.market === "spread"
      ? probabilities.spread.homeCoverProbability >= probabilities.spread.awayCoverProbability
      : probabilities.total.overProbability >= probabilities.total.underProbability;
    const probability = args.market === "spread"
      ? first ? probabilities.spread.homeCoverProbability : probabilities.spread.awayCoverProbability
      : first ? probabilities.total.overProbability : probabilities.total.underProbability;
    const pushProbability = args.market === "spread"
      ? probabilities.spread.pushProbability : probabilities.total.pushProbability;
    const selectedPrice = args.market === "spread"
      ? first ? target.spread!.homePrice : target.spread!.awayPrice
      : first ? target.total!.overPrice : target.total!.underPrice;
    const opposingPrice = args.market === "spread"
      ? first ? target.spread!.awayPrice : target.spread!.homePrice
      : first ? target.total!.underPrice : target.total!.overPrice;
    if (!boundedSpreadTotalPrice(selectedPrice) || !Number.isFinite(opposingPrice)) return [];
    const otherFairs = args.books.filter((other) => other.sportsbook !== target.sportsbook).flatMap((other) => {
      if (args.market === "spread") {
        const otherBoard = other.spread;
        if (!otherBoard || otherBoard.homeLine !== line || otherBoard.awayLine !== -line) return [];
        return [twoSidedFair(
          first ? otherBoard.homePrice : otherBoard.awayPrice,
          first ? otherBoard.awayPrice : otherBoard.homePrice,
        )];
      }
      const otherBoard = other.total;
      if (!otherBoard || otherBoard.line !== line) return [];
      return [twoSidedFair(
        first ? otherBoard.overPrice : otherBoard.underPrice,
        first ? otherBoard.underPrice : otherBoard.overPrice,
      )];
    });
    if (otherFairs.length < 2) return [];
    const looFairProbability = otherFairs.reduce((sum, value) => sum + value, 0) / otherFairs.length;
    const expectedValue = (1 - pushProbability) * (
      probability * profitOne(selectedPrice) - (1 - probability)
    );
    const edgePercentagePoints = (probability - looFairProbability) * 100;
    const expectedMargin = args.forecast.expectedHomeScore - args.forecast.expectedAwayScore;
    const expectedTotal = args.forecast.expectedHomeScore + args.forecast.expectedAwayScore;
    const cushion = args.market === "spread"
      ? first ? expectedMargin + line : -(expectedMargin + line)
      : first ? expectedTotal - line : line - expectedTotal;
    const keyOrZone = args.market === "spread"
      ? [3, 7, 10, 14].some((key) => Math.abs(Math.abs(line) - key) <= 0.25)
      : line <= 41 || line >= 50;
    const watchlist = probability >= NFL_V1_SPREAD_TOTAL_WATCHLIST_MINIMUM_PROBABILITY
      && expectedValue >= NFL_V1_SPREAD_TOTAL_WATCHLIST_MINIMUM_EXPECTED_VALUE
      && edgePercentagePoints >= NFL_V1_SPREAD_TOTAL_WATCHLIST_MINIMUM_EDGE_PERCENTAGE_POINTS
      && cushion >= NFL_V1_SPREAD_TOTAL_WATCHLIST_MINIMUM_CUSHION + (keyOrZone ? 0.5 : 0);
    return [{
      side: args.market === "spread"
        ? first ? args.homeTeam : args.awayTeam
        : `${first ? "Over" : "Under"} ${line}`,
      probability, pushProbability, looFairProbability, expectedValue,
      edgePercentagePoints, cushion,
      quote: { sportsbook: target.sportsbook, line: args.market === "spread" ? (first ? line : -line) : line,
        price: selectedPrice, observedAt: target.observedAt },
      watchlist,
    }];
  });
  return candidates.sort((first, second) =>
    Number(second.watchlist) - Number(first.watchlist)
    || second.expectedValue - first.expectedValue
    || second.edgePercentagePoints - first.edgePercentagePoints
    || second.quote.price - first.quote.price
    || first.quote.sportsbook.localeCompare(second.quote.sportsbook))[0] ?? null;
}

function boundedSpreadTotalPrice(price: number): boolean {
  return Number.isFinite(price) && price >= -200 && price <= 200 && price !== 0;
}

function profitOne(price: number): number {
  return price > 0 ? price / 100 : 100 / -price;
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
