import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import {
  buildNflRegularEvaluatedBetDecision,
  type NflRegularEvaluatedBetDecision,
} from "./nflRegularDecisionEvidence";
import type { NflR6ShadowMoneylineDecision } from "./nflR6MoneylineShadow";
import {
  buildNflV1ProductionDecisionBundle,
  NFL_V1_GRADE_POLICY_RELEASE,
  NFL_V1_MEMBER_RELEASE,
  NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
  NFL_V1_PRODUCTION_DECISION_RELEASE,
  NFL_V1_PRODUCTION_MODEL_RELEASE,
} from "./nflV1ProductionDecision";
import {
  getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities,
  type NflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";

export const NFL_V1_ACTIONABLE_GRADE_MODEL_RELEASE =
  NFL_V1_PRODUCTION_MODEL_RELEASE;
export const NFL_V1_ACTIONABLE_GRADE_CALIBRATION_RELEASE =
  NFL_V1_PRODUCTION_CALIBRATION_RELEASE;
export const NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE =
  NFL_V1_PRODUCTION_DECISION_RELEASE;
export const NFL_V1_ACTIONABLE_GRADE_POLICY_RELEASE =
  NFL_V1_GRADE_POLICY_RELEASE;
export const NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE =
  NFL_V1_MEMBER_RELEASE;
export const NFL_V1_EVENT_CONTAINED_SPREAD_MODEL_RELEASE =
  "nfl_v1_spread_event_contained_2026_09_03_r5_target_excluded_forecast" as const;
export const NFL_V1_MARKET_EVIDENCE_TOTAL_MODEL_RELEASE =
  "nfl_v1_total_market_evidence_2026_09_03_r4_target_excluded_forecast" as const;

export const NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_EXPECTED_VALUE = 0.02 as const;
export const NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_EDGE_PERCENTAGE_POINTS = 4.0 as const;
export const NFL_V1_SPREAD_BEST_ANGLE_MINIMUM_PROBABILITY = 0.55 as const;
export const NFL_V1_SPREAD_BEST_ANGLE_MINIMUM_EXPECTED_VALUE = 0.04 as const;
export const NFL_V1_TOTAL_BEST_ANGLE_MINIMUM_PROBABILITY = 0.535 as const;
export const NFL_V1_TOTAL_BEST_ANGLE_MINIMUM_EXPECTED_VALUE = 0.035 as const;
export const NFL_V1_SPREAD_TOTAL_BEST_ANGLE_MINIMUM_EDGE_PERCENTAGE_POINTS = 4.0 as const;
export const NFL_V1_SPREAD_LEAN_MINIMUM_PROBABILITY = 0.51 as const;
export const NFL_V1_SPREAD_LEAN_MINIMUM_EXPECTED_VALUE = 0.0 as const;
export const NFL_V1_SPREAD_LEAN_MINIMUM_EDGE_PERCENTAGE_POINTS = 0.0 as const;
export const NFL_V1_SPREAD_LEAN_MINIMUM_CUSHION = 0.0 as const;
export const NFL_V1_TOTAL_LEAN_MINIMUM_PROBABILITY = 0.535 as const;
export const NFL_V1_TOTAL_LEAN_MINIMUM_EXPECTED_VALUE = 0.02 as const;
export const NFL_V1_TOTAL_LEAN_MINIMUM_EDGE_PERCENTAGE_POINTS = 1.0 as const;
export const NFL_V1_TOTAL_LEAN_MINIMUM_CUSHION = 0.0 as const;
export const NFL_V1_SPREAD_WATCHLIST_MINIMUM_PROBABILITY = 0.50 as const;
export const NFL_V1_SPREAD_WATCHLIST_MINIMUM_EXPECTED_VALUE = -0.02 as const;
export const NFL_V1_SPREAD_WATCHLIST_MINIMUM_EDGE_PERCENTAGE_POINTS = -1.0 as const;
export const NFL_V1_SPREAD_WATCHLIST_MINIMUM_CUSHION = -0.5 as const;
export const NFL_V1_TOTAL_WATCHLIST_MINIMUM_PROBABILITY = 0.525 as const;
export const NFL_V1_TOTAL_WATCHLIST_MINIMUM_EXPECTED_VALUE = 0.0 as const;
export const NFL_V1_TOTAL_WATCHLIST_MINIMUM_EDGE_PERCENTAGE_POINTS = 0.0 as const;
export const NFL_V1_TOTAL_WATCHLIST_MINIMUM_CUSHION = 0.5 as const;

export type NflV1ActionableGradeBundle = {
  evaluatedBets: NflRegularEvaluatedBetDecision[];
  outcomeConfidence: ReturnType<typeof buildNflV1ProductionDecisionBundle>["outcomeConfidence"];
  modelPromotionStatus: typeof NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE;
  publicationEnabled: true;
  trackingEnabled: false;
  modelRelease: typeof NFL_V1_ACTIONABLE_GRADE_MODEL_RELEASE;
  calibrationRelease: typeof NFL_V1_ACTIONABLE_GRADE_CALIBRATION_RELEASE;
  decisionRelease: typeof NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE;
  policyRelease: typeof NFL_V1_ACTIONABLE_GRADE_POLICY_RELEASE;
};

type CandidateGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play";

type MarketEvaluation = {
  market: "spread" | "total";
  side: string;
  probability: number;
  pushProbability: number;
  looFairProbability: number;
  expectedValue: number;
  edgePercentagePoints: number;
  cushion: number;
  quote: { sportsbook: string; line: number; price: number; observedAt: string };
  grade: CandidateGrade;
  modelRelease: string;
};

export function buildNflV1ActionableGradeBundle(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
  current: NflPreviewBookOdds;
  comparableCurrentBooks: NflPreviewBookOdds[];
  shadowMoneyline: NflR6ShadowMoneylineDecision;
  outcomeForecast?: NflV1WeekOneOutcomeForecast;
}): NflV1ActionableGradeBundle {
  const currentBundle = buildNflV1ProductionDecisionBundle(args);
  const currentMoneyline = currentBundle.evaluatedBets.find((decision) => decision.market === "moneyline");
  if (!currentMoneyline) return emptyBundle(currentBundle.outcomeConfidence);
  const currentTotal = args.current.total?.line;
  const outcome = args.outcomeForecast ?? getNflV1WeekOneOutcomeForecast({
    ...args,
    weeklyFallback: args.shadowMoneyline.footballProjection && currentTotal !== undefined
      ? {
          projectedHomeMargin: args.shadowMoneyline.footballProjection.projectedHomeMargin,
          marketTotal: currentTotal,
        }
      : undefined,
  });
  const stage = args.shadowMoneyline.decisionStage === "t60_locked" ? "t60_locked" as const : "unlocked" as const;
  const lockedAt = stage === "t60_locked" ? args.shadowMoneyline.lockedAt : null;
  const common = {
    providerGameId: args.providerGameId,
    stage,
    evaluatedAt: args.shadowMoneyline.evaluatedAt,
    gameStartsAt: args.gameStartsAt,
    decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
    lockedAt,
  };
  const moneylineGrade = bestAngleEligible(currentMoneyline)
    ? "Best Angle"
    : currentMoneyline.grade;
  const moneyline = buildNflRegularEvaluatedBetDecision({
    ...currentMoneyline,
    ...common,
    grade: moneylineGrade,
  });
  const spread = selectMarket({
    market: "spread",
    forecast: outcome,
    books: args.comparableCurrentBooks,
    awayTeam: args.awayTeam,
    homeTeam: args.homeTeam,
    gameStartsAt: args.gameStartsAt,
  });
  const total = selectMarket({
    market: "total",
    forecast: outcome,
    books: args.comparableCurrentBooks,
    awayTeam: args.awayTeam,
    homeTeam: args.homeTeam,
    gameStartsAt: args.gameStartsAt,
  });
  if (!spread || !total) return emptyBundle(currentBundle.outcomeConfidence);
  const evaluatedBets = [moneyline, spread, total].map((decision) => "decisionKind" in decision
    ? decision
    : buildNflRegularEvaluatedBetDecision({
        ...common,
        market: decision.market,
        side: decision.side,
        modelProbability: decision.probability,
        marketFairProbability: decision.looFairProbability,
        evaluatedQuote: decision.quote,
        grade: decision.grade,
        modelRelease: decision.modelRelease,
        calibrationRelease: NFL_V1_ACTIONABLE_GRADE_CALIBRATION_RELEASE,
      }));
  return {
    evaluatedBets,
    outcomeConfidence: currentBundle.outcomeConfidence,
    modelPromotionStatus: NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
    publicationEnabled: true,
    trackingEnabled: false,
    modelRelease: NFL_V1_ACTIONABLE_GRADE_MODEL_RELEASE,
    calibrationRelease: NFL_V1_ACTIONABLE_GRADE_CALIBRATION_RELEASE,
    decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
    policyRelease: NFL_V1_ACTIONABLE_GRADE_POLICY_RELEASE,
  };
}

function emptyBundle(
  outcomeConfidence: ReturnType<typeof buildNflV1ProductionDecisionBundle>["outcomeConfidence"],
): NflV1ActionableGradeBundle {
  return {
    evaluatedBets: [],
    outcomeConfidence,
    modelPromotionStatus: NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
    publicationEnabled: true,
    trackingEnabled: false,
    modelRelease: NFL_V1_ACTIONABLE_GRADE_MODEL_RELEASE,
    calibrationRelease: NFL_V1_ACTIONABLE_GRADE_CALIBRATION_RELEASE,
    decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
    policyRelease: NFL_V1_ACTIONABLE_GRADE_POLICY_RELEASE,
  };
}

function bestAngleEligible(current: NflRegularEvaluatedBetDecision): boolean {
  return current.grade === "Lean" &&
    current.expectedValue >= NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_EXPECTED_VALUE &&
    100 * (current.modelProbability - current.marketFairProbability) >=
      NFL_V1_MONEYLINE_BEST_ANGLE_MINIMUM_EDGE_PERCENTAGE_POINTS;
}

function selectMarket(args: {
  market: "spread" | "total";
  forecast: ReturnType<typeof getNflV1WeekOneOutcomeForecast>;
  books: NflPreviewBookOdds[];
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
}): MarketEvaluation | null {
  const candidates = args.books.flatMap((target): MarketEvaluation[] => {
    const board = args.market === "spread" ? target.spread : target.total;
    if (!board || Date.parse(target.observedAt) >= Date.parse(args.gameStartsAt)) return [];
    const line = args.market === "spread" ? target.spread!.homeLine : target.total!.line;
    const raw = nflV1WeekOneLineProbabilities({
      forecast: args.forecast,
      homeSpread: args.market === "spread" ? target.spread!.homeLine : 0,
      totalLine: args.market === "total" ? target.total!.line : 0,
    });
    const primaryProbability = args.market === "spread"
      ? raw.spread.homeCoverProbability
      : raw.total.overProbability;
    const pushProbability = args.market === "spread" ? raw.spread.pushProbability : raw.total.pushProbability;
    const expectedMargin = args.forecast.expectedHomeScore - args.forecast.expectedAwayScore;
    const expectedTotal = args.forecast.expectedHomeScore + args.forecast.expectedAwayScore;
    const sensitive = args.market === "spread"
      ? [3, 7, 10, 14].some((key) => Math.abs(Math.abs(line) - key) <= 0.25)
      : line <= 41 || line >= 50;
    const penalty = sensitive ? 0.5 : 0;
    const evaluate = (primaryProbability: number): MarketEvaluation | null => {
      const first = primaryProbability >= 0.5;
      const probability = first ? primaryProbability : 1 - primaryProbability;
      const selectedPrice = args.market === "spread"
        ? first ? target.spread!.homePrice : target.spread!.awayPrice
        : first ? target.total!.overPrice : target.total!.underPrice;
      const opposingPrice = args.market === "spread"
        ? first ? target.spread!.awayPrice : target.spread!.homePrice
        : first ? target.total!.underPrice : target.total!.overPrice;
      if (!boundedPrice(selectedPrice) || !Number.isFinite(opposingPrice)) return null;
      const otherFairs = args.books.filter((other) => other.sportsbook !== target.sportsbook).flatMap((other) => {
        if (args.market === "spread") {
          if (!other.spread || other.spread.homeLine !== line || other.spread.awayLine !== -line) return [];
          return [twoSidedFair(
            first ? other.spread.homePrice : other.spread.awayPrice,
            first ? other.spread.awayPrice : other.spread.homePrice,
          )];
        }
        if (!other.total || other.total.line !== line) return [];
        return [twoSidedFair(
          first ? other.total.overPrice : other.total.underPrice,
          first ? other.total.underPrice : other.total.overPrice,
        )];
      });
      if (otherFairs.length < 1) return null;
      const looFairProbability = otherFairs.reduce((sum, value) => sum + value, 0) / otherFairs.length;
      const expectedValue = (1 - pushProbability) * (probability * profitOne(selectedPrice) - (1 - probability));
      const edgePercentagePoints = (probability - looFairProbability) * 100;
      const cushion = args.market === "spread"
        ? first ? expectedMargin + line : -(expectedMargin + line)
        : first ? expectedTotal - line : line - expectedTotal;
      const qualifiedGrade = marketGrade({
        market: args.market,
        probability,
        expectedValue,
        edgePercentagePoints,
        cushion,
        penalty,
      });
      // A fragmented board can still publish a coherent prediction with one
      // target-excluded same-line comparator. Action requires at least two.
      const grade = otherFairs.length >= 2 || gradeRank(qualifiedGrade) < gradeRank("Lean")
        ? qualifiedGrade
        : "Watchlist";
      return {
        market: args.market,
        side: args.market === "spread"
          ? first ? args.homeTeam : args.awayTeam
          : `${first ? "Over" : "Under"} ${line}`,
        probability,
        pushProbability,
        looFairProbability,
        expectedValue,
        edgePercentagePoints,
        cushion,
        quote: {
          sportsbook: target.sportsbook,
          line: args.market === "spread" ? first ? line : -line : line,
          price: selectedPrice,
          observedAt: target.observedAt,
        },
        grade,
        modelRelease: args.market === "spread"
          ? NFL_V1_EVENT_CONTAINED_SPREAD_MODEL_RELEASE
          : NFL_V1_MARKET_EVIDENCE_TOTAL_MODEL_RELEASE,
      };
    };
    const evaluation = evaluate(primaryProbability);
    return evaluation ? [evaluation] : [];
  });
  return candidates.sort((first, second) =>
    gradeRank(second.grade) - gradeRank(first.grade) ||
    second.expectedValue - first.expectedValue ||
    second.edgePercentagePoints - first.edgePercentagePoints ||
    second.quote.price - first.quote.price ||
    first.quote.sportsbook.localeCompare(second.quote.sportsbook))[0] ?? null;
}

function marketGrade(args: {
  market: "spread" | "total";
  probability: number;
  expectedValue: number;
  edgePercentagePoints: number;
  cushion: number;
  penalty: number;
}): CandidateGrade {
  const lean = args.market === "spread"
    ? args.probability >= NFL_V1_SPREAD_LEAN_MINIMUM_PROBABILITY &&
      args.expectedValue >= NFL_V1_SPREAD_LEAN_MINIMUM_EXPECTED_VALUE &&
      args.edgePercentagePoints >= NFL_V1_SPREAD_LEAN_MINIMUM_EDGE_PERCENTAGE_POINTS &&
      args.cushion >= NFL_V1_SPREAD_LEAN_MINIMUM_CUSHION + args.penalty
    : args.probability >= NFL_V1_TOTAL_LEAN_MINIMUM_PROBABILITY &&
      args.expectedValue >= NFL_V1_TOTAL_LEAN_MINIMUM_EXPECTED_VALUE &&
      args.edgePercentagePoints >= NFL_V1_TOTAL_LEAN_MINIMUM_EDGE_PERCENTAGE_POINTS &&
      args.cushion >= NFL_V1_TOTAL_LEAN_MINIMUM_CUSHION + args.penalty;
  const bestAngle = lean && args.edgePercentagePoints >=
      NFL_V1_SPREAD_TOTAL_BEST_ANGLE_MINIMUM_EDGE_PERCENTAGE_POINTS &&
    (args.market === "spread"
      ? args.probability >= NFL_V1_SPREAD_BEST_ANGLE_MINIMUM_PROBABILITY &&
        args.expectedValue >= NFL_V1_SPREAD_BEST_ANGLE_MINIMUM_EXPECTED_VALUE
      : args.probability >= NFL_V1_TOTAL_BEST_ANGLE_MINIMUM_PROBABILITY &&
        args.expectedValue >= NFL_V1_TOTAL_BEST_ANGLE_MINIMUM_EXPECTED_VALUE);
  if (bestAngle) {
    return "Best Angle";
  }
  if (lean) return "Lean";
  const watchlist = args.market === "spread"
    ? args.probability >= NFL_V1_SPREAD_WATCHLIST_MINIMUM_PROBABILITY &&
      args.expectedValue >= NFL_V1_SPREAD_WATCHLIST_MINIMUM_EXPECTED_VALUE &&
      args.edgePercentagePoints >= NFL_V1_SPREAD_WATCHLIST_MINIMUM_EDGE_PERCENTAGE_POINTS &&
      args.cushion >= NFL_V1_SPREAD_WATCHLIST_MINIMUM_CUSHION + args.penalty
    : args.probability >= NFL_V1_TOTAL_WATCHLIST_MINIMUM_PROBABILITY &&
      args.expectedValue >= NFL_V1_TOTAL_WATCHLIST_MINIMUM_EXPECTED_VALUE &&
      args.edgePercentagePoints >= NFL_V1_TOTAL_WATCHLIST_MINIMUM_EDGE_PERCENTAGE_POINTS &&
      args.cushion >= NFL_V1_TOTAL_WATCHLIST_MINIMUM_CUSHION + args.penalty;
  return watchlist ? "Watchlist" : "No Play";
}

function gradeRank(grade: CandidateGrade): number {
  return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0;
}

function boundedPrice(price: number): boolean {
  return Number.isFinite(price) && price >= -200 && price <= 200 && price !== 0;
}

function profitOne(price: number): number {
  return price > 0 ? price / 100 : 100 / -price;
}

function twoSidedFair(selectedPrice: number, opposingPrice: number): number {
  const selected = americanImplied(selectedPrice);
  const opposing = americanImplied(opposingPrice);
  return selected / (selected + opposing);
}

function americanImplied(price: number): number {
  if (!Number.isFinite(price) || price === 0) throw new Error("NFL candidate price must be non-zero American odds.");
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}
