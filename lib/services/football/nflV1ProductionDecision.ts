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
  "nfl_v1_daily_edge_decision_2026_08_23_r2" as const;

export type NflV1ProductionDecisionBundle = {
  evaluatedBets: NflRegularEvaluatedBetDecision[];
  outcomeConfidence: NflRegularOutcomeConfidence[];
  modelPromotionStatus: "nfl_v1_member_release_2026_08_23_r2";
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
      modelPromotionStatus: "nfl_v1_member_release_2026_08_23_r2",
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
  const moneylineTeam = r6Lean ? r6Team : homeWinner ? args.homeTeam : args.awayTeam;
  const moneylineModelProbability = r6Lean
    ? r6Probability
    : homeWinner ? outcome.homeWinProbability : outcome.awayWinProbability;
  const moneylineQuote = r6Lean ? r6EvaluatedQuote : {
    sportsbook: args.current.sportsbook,
    line: null,
    price: homeWinner ? moneylineBoard.homePrice : moneylineBoard.awayPrice,
    observedAt: args.current.observedAt,
  };
  const moneylineFairProbability = r6Lean
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
    grade: r6Lean ? "Lean" : "No Play",
    modelRelease: r6Lean ? NFL_R6_MONEYLINE_MODEL_RELEASE : NFL_V1_PRODUCTION_MODEL_RELEASE,
    calibrationRelease: r6Lean ? NFL_R6_MONEYLINE_CALIBRATION_RELEASE : NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
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
    modelPromotionStatus: "nfl_v1_member_release_2026_08_23_r2",
    publicationEnabled: true,
    // The member release publishes coherent prediction/decision tuples into
    // the append-only forward-evidence store only. Official prediction-record
    // tracking is a separate, intentionally unimplemented release boundary.
    trackingEnabled: false,
  };
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
