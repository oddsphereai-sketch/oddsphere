import gradeArtifactJson from "./modelArtifacts/cfbV1GradePolicy.json";
import scoreArtifactJson from "./modelArtifacts/cfbV1JointScoreArtifact.json";
import weeklyArtifactJson from "./modelArtifacts/cfbV1WeeklyRuntimeArtifact.json";
import type { NcaafBookOdds } from "./balldontlieNcaafSlate";
import { CFB_V1_WEEKLY_BASE_ARTIFACT_RELEASE, getCfbV1WeeklyForecast } from "./cfbV1WeeklyForecast";
import type { NcaafGame } from "./balldontlieNcaafSlate";

export const CFB_V1_BASE_SCORE_ARTIFACT_RELEASE =
  "cfb_v1_joint_score_artifact_2026_08_28_r4_directional_pmf" as const;
export const CFB_V1_BASE_MODEL_RELEASE =
  "cfb_v1_independent_score_model_2026_08_28_r2_directional_pmf" as const;
export const CFB_V1_BASE_DISTRIBUTION_RELEASE =
  "cfb_v1_empirical_joint_score_distribution_2026_08_28_r2_directional_pmf" as const;
export const CFB_V1_BASE_PROBABILITY_RELEASE =
  "cfb_v1_joint_market_probability_2026_08_28_r2_directional_pmf" as const;
export const CFB_V1_BASE_REPRESENTATIVE_SCORE_RELEASE =
  "cfb_v1_central_reachable_score_2026_08_28_r2_directional_pmf" as const;
const CFB_V1_BASE_GRADE_POLICY_RELEASE =
  "cfb_v1_composite_grade_policy_2026_08_25_r1" as const;
export const CFB_V1_SCORE_ARTIFACT_RELEASE =
  "cfb_v1_joint_score_runtime_2026_08_29_r5_market_sharp_authoritative" as const;
export const CFB_V1_MODEL_RELEASE =
  "cfb_v1_market_sharp_score_model_2026_08_29_r3_provisional" as const;
export const CFB_V1_DISTRIBUTION_RELEASE =
  "cfb_v1_market_sharp_joint_distribution_2026_08_29_r3_provisional" as const;
export const CFB_V1_PROBABILITY_RELEASE =
  "cfb_v1_market_sharp_joint_probability_2026_08_29_r3_provisional" as const;
export const CFB_V1_REPRESENTATIVE_SCORE_RELEASE =
  "cfb_v1_market_sharp_reachable_score_2026_08_29_r3_provisional" as const;
export const CFB_V1_CALIBRATION_RELEASE =
  "cfb_v1_market_sharp_exact_price_calibration_2026_08_29_r2_provisional" as const;
export const CFB_V1_GRADE_POLICY_RELEASE =
  "cfb_v1_composite_grade_policy_2026_08_29_r2_market_sharp_balanced" as const;
export const CFB_V1_DECISION_RELEASE =
  "cfb_v1_daily_edge_decision_2026_08_29_r16_market_sharp_authoritative" as const;
const CFB_V1_POLICY_SOURCE_DECISION_RELEASE =
  "cfb_v1_daily_edge_decision_2026_08_26_r7_sharpapi_price_fallback" as const;
export const CFB_V1_DECISION_SCHEMA_RELEASE =
  "cfb_v1_exact_price_decision_tuple_2026_08_29_r10_market_sharp_authoritative" as const;
export const CFB_T60_TARGET_MINUTES = 60 as const;
export const CFB_T60_MAX_CAPTURE_LAG_MINUTES = 20 as const;

export type CfbV1Market = "moneyline" | "spread" | "total";
export type CfbV1Grade = "Best Angle" | "Lean" | "Watchlist" | "No Play";
export type CfbV1DecisionStage = "unlocked" | "t60_locked";
export type CfbV1UnavailableReasonCode =
  | "named_target_quote_unavailable"
  | "market_context_line_unavailable"
  | "target_excluded_same_line_consensus_insufficient"
  | "quote_timestamp_invalid"
  | "quote_observed_after_evaluation"
  | "evaluation_not_pregame"
  | "global_health_hold";

export type CfbV1ContextLines = {
  homeSpread: number | null;
  totalLine: number | null;
};

export type CfbV1Forecast = {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
  expectedAwayPoints: number;
  expectedHomePoints: number;
  expectedMarginHome: number;
  expectedTotal: number;
  homeWinProbability: number;
  representativeScore: { away: number; home: number };
  interval80: {
    away: [number, number];
    home: [number, number];
    marginHome: [number, number];
    total: [number, number];
  };
  pmf: Array<{ home: number; away: number; probability: number }>;
  directionalAlignment?: {
    release: string;
    target: "home" | "away";
    symmetricPoints: number;
    reason: "mean_probability_direction_cross" | "exact_direction_tie";
  };
};

export type CfbV1ExactPriceDecision = {
  schemaRelease: typeof CFB_V1_DECISION_SCHEMA_RELEASE;
  providerGameId: string;
  market: CfbV1Market;
  side: string;
  grade: CfbV1Grade;
  probabilityGrade: CfbV1Grade;
  independentProbability: number;
  forecastProbability: number;
  calibratedProbability: number;
  modelProbability: number;
  pushProbability: number;
  marketFairProbability: number;
  edgePercentagePoints: number;
  expectedValue: number;
  evaluatedQuote: {
    provider: "balldontlie" | "sharpapi";
    sportsbook: string;
    line: number | null;
    price: number;
    observedAt: string;
    marketSelection: "main_line" | "coherent_paired_alternate";
  };
  consensus: {
    source: "target_excluded_same_line_named_books";
    books: string[];
    fairProbability: number;
  };
  stage: CfbV1DecisionStage;
  evaluatedAt: string;
  gameStartsAt: string;
  lockedAt: string | null;
  modelRelease: typeof CFB_V1_MODEL_RELEASE;
  distributionRelease: typeof CFB_V1_DISTRIBUTION_RELEASE;
  probabilityRelease: typeof CFB_V1_PROBABILITY_RELEASE;
  calibrationRelease: typeof CFB_V1_CALIBRATION_RELEASE;
  calibrationFamily: string;
  policyRelease: typeof CFB_V1_GRADE_POLICY_RELEASE;
  decisionRelease: typeof CFB_V1_DECISION_RELEASE;
  gradeAdjustment: {
    release: string;
    candidateRelease: string;
    sharpDirection: "support" | "resistance" | "neutral" | "unknown";
    movementDirection: "support" | "resistance" | "neutral" | "unknown";
    reasonCodes: string[];
  } | null;
};

export type CfbV1DecisionBundle = {
  providerGameId: string;
  forecast: CfbV1Forecast;
  evaluatedBets: CfbV1ExactPriceDecision[];
  heldMarkets: Array<{
    market: CfbV1Market;
    reason: string;
    reasonCodes?: CfbV1UnavailableReasonCode[];
  }>;
  publicationEnabled: boolean;
  trackingEnabled: boolean;
  modelRelease: typeof CFB_V1_MODEL_RELEASE;
  decisionRelease: typeof CFB_V1_DECISION_RELEASE;
  policyRelease: typeof CFB_V1_GRADE_POLICY_RELEASE;
};

type Policy = {
  family: string;
  weight: number;
  abstention: string;
  minEdge: number;
  minEv: number;
  bestAngle: { minEdge: number; minEv: number; qualified: boolean };
  calibration: {
    family: string;
    coefficients?: number[];
    intercept?: number;
  };
};

type ScoreArtifact = {
  artifactRelease: string;
  modelRelease: string;
  distributionRelease: string;
  probabilityRelease: string;
  representativeScoreRelease: string;
  forecasts: CfbV1Forecast[];
};

type WeeklyArtifact = {
  artifactRelease: string;
  baseArtifactRelease: string;
  modelRelease: string;
};

type GradeArtifact = {
  policyRelease: string;
  decisionRelease: string;
  policies: Record<CfbV1Market, Policy>;
};

const scoreArtifact = scoreArtifactJson as unknown as ScoreArtifact;
const weeklyArtifact = weeklyArtifactJson as unknown as WeeklyArtifact;
const gradeArtifact = gradeArtifactJson as GradeArtifact;

assertArtifactReleases();

export function getCfbV1Forecast(providerGameId: string): CfbV1Forecast {
  const forecast = scoreArtifact.forecasts.find((row) => row.providerGameId === providerGameId);
  if (!forecast) throw new Error(`CFB v1 has no qualified forecast for provider game ${providerGameId}.`);
  return forecast;
}

export function getCfbV1ForecastForGame(args: { game: NcaafGame; completedGames?: NcaafGame[] }): ReturnType<typeof getCfbV1WeeklyForecast> {
  return getCfbV1WeeklyForecast(args);
}

export function getCfbV1Forecasts(): CfbV1Forecast[] {
  return scoreArtifact.forecasts.map((forecast) => ({ ...forecast, pmf: forecast.pmf.map((cell) => ({ ...cell })) }));
}

export function cfbV1LineProbabilities(args: {
  forecast: CfbV1Forecast;
  homeSpread: number;
  totalLine: number;
}): {
  moneyline: { home: number; away: number };
  spread: { home: number; away: number; push: number };
  total: { over: number; under: number; push: number };
} {
  let homeWin = 0;
  let awayWin = 0;
  let tie = 0;
  let homeCover = 0;
  let awayCover = 0;
  let spreadPush = 0;
  let over = 0;
  let under = 0;
  let totalPush = 0;
  for (const cell of args.forecast.pmf) {
    const margin = cell.home - cell.away;
    const total = cell.home + cell.away;
    if (margin > 0) homeWin += cell.probability;
    else if (margin < 0) awayWin += cell.probability;
    else tie += cell.probability;
    const spreadResult = margin + args.homeSpread;
    if (spreadResult > 0) homeCover += cell.probability;
    else if (spreadResult < 0) awayCover += cell.probability;
    else spreadPush += cell.probability;
    if (total > args.totalLine) over += cell.probability;
    else if (total < args.totalLine) under += cell.probability;
    else totalPush += cell.probability;
  }
  return {
    moneyline: { home: homeWin + 0.5 * tie, away: awayWin + 0.5 * tie },
    spread: { home: homeCover + 0.5 * spreadPush, away: awayCover + 0.5 * spreadPush, push: spreadPush },
    total: { over: over + 0.5 * totalPush, under: under + 0.5 * totalPush, push: totalPush },
  };
}

export function buildCfbV1DecisionBundle(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
  comparableCurrentBooks: NcaafBookOdds[];
  stage?: CfbV1DecisionStage;
  evaluatedAt?: string;
  lockedAt?: string | null;
  healthHolds?: string[];
  forecast?: CfbV1Forecast;
  contextLines?: CfbV1ContextLines;
}): CfbV1DecisionBundle {
  const forecast = args.forecast ?? getCfbV1Forecast(args.providerGameId);
  if (forecast.providerGameId !== args.providerGameId) throw new Error("CFB decision forecast/game identity mismatch.");
  const stage = args.stage ?? "unlocked";
  const healthHolds = args.healthHolds ?? [];
  if (healthHolds.length > 0) {
    return heldBundle(forecast, rMarkets().map((market) => ({
      market,
      reason: healthHolds.join(";"),
      reasonCodes: ["global_health_hold"],
    })));
  }
  const decisions: CfbV1ExactPriceDecision[] = [];
  const heldMarkets: CfbV1DecisionBundle["heldMarkets"] = [];
  for (const market of rMarkets()) {
    const decision = selectMarket({ ...args, forecast, market, stage });
    if (decision) decisions.push(decision);
    else {
      const reasonCodes = unavailableReasonCodes({ ...args, forecast, market, stage });
      heldMarkets.push({ market, reason: reasonCodes.join(";"), reasonCodes });
    }
  }
  // Official tracking is market-scoped: a missing exact-price sibling stays
  // Held, while every coherent T-60 tuple remains eligible for its own
  // immutable record. Global health holds still return no decisions.
  const trackingEnabled = stage === "t60_locked" && decisions.length > 0;
  return {
    providerGameId: args.providerGameId,
    forecast,
    evaluatedBets: decisions,
    heldMarkets,
    publicationEnabled: true,
    trackingEnabled,
    modelRelease: CFB_V1_MODEL_RELEASE,
    decisionRelease: CFB_V1_DECISION_RELEASE,
    policyRelease: CFB_V1_GRADE_POLICY_RELEASE,
  };
}

function selectMarket(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
  comparableCurrentBooks: NcaafBookOdds[];
  forecast: CfbV1Forecast;
  market: CfbV1Market;
  stage: CfbV1DecisionStage;
  evaluatedAt?: string;
  lockedAt?: string | null;
  contextLines?: CfbV1ContextLines;
}): CfbV1ExactPriceDecision | null {
  const policy = gradeArtifact.policies[args.market];
  const candidates = args.comparableCurrentBooks.filter((target) => target.targetEligible !== false).flatMap((target) => evaluateTarget({ ...args, target, policy }));
  return candidates.sort((first, second) =>
    gradeRank(second.grade) - gradeRank(first.grade) ||
    second.expectedValue - first.expectedValue ||
    second.edgePercentagePoints - first.edgePercentagePoints ||
    second.evaluatedQuote.price - first.evaluatedQuote.price ||
    first.evaluatedQuote.sportsbook.localeCompare(second.evaluatedQuote.sportsbook)
  )[0] ?? null;
}

function evaluateTarget(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
  comparableCurrentBooks: NcaafBookOdds[];
  forecast: CfbV1Forecast;
  market: CfbV1Market;
  stage: CfbV1DecisionStage;
  evaluatedAt?: string;
  lockedAt?: string | null;
  contextLines?: CfbV1ContextLines;
  target: NcaafBookOdds;
  policy: Policy;
}): CfbV1ExactPriceDecision[] {
  const targetMarket = args.target[args.market];
  if (!targetMarket || Date.parse(args.target.observedAt) >= Date.parse(args.gameStartsAt)) return [];
  const homeSpread = args.market === "spread"
    ? args.target.spread?.homeLine
    : args.target.spread?.homeLine ?? args.contextLines?.homeSpread ?? consensusHomeSpread(args.comparableCurrentBooks) ?? (args.market === "total" ? 0 : null);
  const totalLine = args.market === "total"
    ? args.target.total?.line
    : args.target.total?.line ?? args.contextLines?.totalLine ?? args.forecast.expectedTotal;
  if (homeSpread === undefined || homeSpread === null || totalLine === undefined || totalLine === null) return [];
  const lineProbabilities = cfbV1LineProbabilities({ forecast: args.forecast, homeSpread, totalLine });
  // The supplied authoritative joint PMF owns the forecast side. Calibration and exact
  // price can change the grade, but can never silently select its opposite.
  const sides = [pmfSelectedSide(lineProbabilities, args.market)];
  return sides.flatMap((side) => {
    const quote = targetQuote(args.target, args.market, side);
    if (!quote) return [];
    const consensus = targetExcludedConsensus(args.comparableCurrentBooks, args.target, args.market, side, quote.line);
    if (!consensus) return [];
    const independentProbability = independentSideProbability(lineProbabilities, args.market, side);
    const pushProbability = args.market === "spread" ? lineProbabilities.spread.push : args.market === "total" ? lineProbabilities.total.push : 0;
    const calibratedProbability = calibratePrimaryThenSide({
      market: args.market,
      side,
      independentProbability,
      primaryIndependentProbability: independentSideProbability(lineProbabilities, args.market, primarySide(args.market)),
      marketFairProbability: consensus.fairProbability,
      primaryMarketFairProbability: side === primarySide(args.market) ? consensus.fairProbability : 1 - consensus.fairProbability,
      homeSpread,
      totalLine,
      policy: args.policy,
    });
    const modelProbability = args.policy.weight * calibratedProbability + (1 - args.policy.weight) * consensus.fairProbability;
    const expectedValue = expectedValueWithPush(modelProbability, pushProbability, quote.price);
    const edgePercentagePoints = 100 * (modelProbability - consensus.fairProbability);
    const eligible = abstentionAllows(args.policy.abstention, args.market, side, quote.price, homeSpread, totalLine);
    const positive = edgePercentagePoints > 0 && expectedValue > 0;
    const best = positive && eligible && args.policy.bestAngle.qualified && edgePercentagePoints >= args.policy.bestAngle.minEdge * 100 && expectedValue >= args.policy.bestAngle.minEv;
    const lean = positive && eligible && edgePercentagePoints >= args.policy.minEdge * 100 && expectedValue >= args.policy.minEv;
    const grade: CfbV1Grade = best ? "Best Angle" : lean ? "Lean" : positive ? "Watchlist" : "No Play";
    const evaluatedAt = args.evaluatedAt ?? quote.observedAt;
    const lockedAt = args.stage === "t60_locked" ? args.lockedAt ?? evaluatedAt : null;
    const timingIssue = decisionTimingIssue({
      evaluatedAt,
      quoteAt: quote.observedAt,
      gameStartsAt: args.gameStartsAt,
      stage: args.stage,
      lockedAt,
    });
    if (timingIssue !== null) return [];
    return [{
      schemaRelease: CFB_V1_DECISION_SCHEMA_RELEASE,
      providerGameId: args.providerGameId,
      market: args.market,
      side: sideLabel(args.market, side, quote.line, args.awayTeam, args.homeTeam),
      grade,
      probabilityGrade: grade,
      independentProbability,
      forecastProbability: independentProbability,
      calibratedProbability,
      modelProbability,
      pushProbability,
      marketFairProbability: consensus.fairProbability,
      edgePercentagePoints,
      expectedValue,
      evaluatedQuote: { provider: args.target.provider ?? "balldontlie", sportsbook: args.target.sportsbook, line: quote.line, price: quote.price, observedAt: quote.observedAt, marketSelection: quote.marketSelection },
      consensus,
      stage: args.stage,
      evaluatedAt,
      gameStartsAt: args.gameStartsAt,
      lockedAt,
      modelRelease: CFB_V1_MODEL_RELEASE,
      distributionRelease: CFB_V1_DISTRIBUTION_RELEASE,
      probabilityRelease: CFB_V1_PROBABILITY_RELEASE,
      calibrationRelease: CFB_V1_CALIBRATION_RELEASE,
      calibrationFamily: args.policy.family,
      policyRelease: CFB_V1_GRADE_POLICY_RELEASE,
      decisionRelease: CFB_V1_DECISION_RELEASE,
      gradeAdjustment: null,
    }];
  });
}

function calibratePrimaryThenSide(args: {
  market: CfbV1Market;
  side: "home" | "away" | "over" | "under";
  independentProbability: number;
  primaryIndependentProbability: number;
  marketFairProbability: number;
  primaryMarketFairProbability: number;
  homeSpread: number;
  totalLine: number;
  policy: Policy;
}): number {
  if (args.policy.calibration.family === "raw_independent_probability") return args.independentProbability;
  const coefficients = args.policy.calibration.coefficients;
  const intercept = args.policy.calibration.intercept;
  if (!coefficients || intercept === undefined) throw new Error(`CFB ${args.market} calibration artifact is incomplete.`);
  const independentLogit = logit(args.primaryIndependentProbability);
  const marketFairLogit = logit(args.primaryMarketFairProbability);
  const zone = args.market === "total" ? (args.totalLine - 52) / 14 : Math.abs(args.homeSpread) / 14;
  const features = args.policy.calibration.family === "independent_calibrated"
    ? [independentLogit]
    : [independentLogit, marketFairLogit, independentLogit - marketFairLogit, zone];
  const primary = sigmoid(intercept + features.reduce((sum, value, index) => sum + value * coefficients[index]!, 0));
  return args.side === primarySide(args.market) ? primary : 1 - primary;
}

function targetExcludedConsensus(
  books: NcaafBookOdds[],
  target: NcaafBookOdds,
  market: CfbV1Market,
  side: "home" | "away" | "over" | "under",
  line: number | null,
): CfbV1ExactPriceDecision["consensus"] | null {
  const values = books.filter((book) => normalizeBook(book.sportsbook) !== normalizeBook(target.sportsbook)).flatMap((book) => {
    const selected = targetQuote(book, market, side);
    const opposing = targetQuote(book, market, opposingSide(side));
    if (!selected || !opposing || selected.line !== line) return [];
    const opposingLineMatches = market === "spread" ? opposing.line === (line === null ? null : -line) : opposing.line === line;
    if (!opposingLineMatches) return [];
    return [{ sportsbook: book.sportsbook, fair: twoSidedFair(selected.price, opposing.price) }];
  });
  if (values.length < 2) return null;
  return {
    source: "target_excluded_same_line_named_books",
    books: values.map((value) => value.sportsbook).sort(),
    fairProbability: values.reduce((sum, value) => sum + value.fair, 0) / values.length,
  };
}

function targetQuote(book: NcaafBookOdds, market: CfbV1Market, side: "home" | "away" | "over" | "under"): { line: number | null; price: number; observedAt: string; marketSelection: "main_line" | "coherent_paired_alternate" } | null {
  const marketSelection = book.marketSelection?.[market] ?? "main_line";
  const observedAt = book.marketObservedAt?.[market] ?? book.observedAt;
  if (market === "moneyline" && book.moneyline && (side === "home" || side === "away")) {
    return { line: null, price: side === "home" ? book.moneyline.homePrice : book.moneyline.awayPrice, observedAt, marketSelection };
  }
  if (market === "spread" && book.spread && (side === "home" || side === "away")) {
    return { line: side === "home" ? book.spread.homeLine : book.spread.awayLine, price: side === "home" ? book.spread.homePrice : book.spread.awayPrice, observedAt, marketSelection };
  }
  if (market === "total" && book.total && (side === "over" || side === "under")) {
    return { line: book.total.line, price: side === "over" ? book.total.overPrice : book.total.underPrice, observedAt, marketSelection };
  }
  return null;
}

function independentSideProbability(
  value: ReturnType<typeof cfbV1LineProbabilities>,
  market: CfbV1Market,
  side: "home" | "away" | "over" | "under",
): number {
  if (market === "moneyline") return side === "home" ? value.moneyline.home : value.moneyline.away;
  if (market === "spread") return side === "home" ? value.spread.home : value.spread.away;
  return side === "over" ? value.total.over : value.total.under;
}

function abstentionAllows(abstention: string, market: CfbV1Market, side: string, price: number, homeSpread: number, totalLine: number): boolean {
  if (abstention === "all") return true;
  if (market === "moneyline") {
    if (abstention === "price_200_200") return price >= -200 && price <= 200;
    if (abstention === "price_300_250") return price >= -300 && price <= 250;
    if (abstention === "favorite") return price < 0;
    return price > 0;
  }
  if (market === "spread") {
    if (abstention === "line_7") return Math.abs(homeSpread) <= 7;
    if (abstention === "line_14") return Math.abs(homeSpread) <= 14;
    if (abstention === "home_favorite") return (homeSpread < 0 && side === "home") || (homeSpread > 0 && side === "away");
    return (homeSpread > 0 && side === "home") || (homeSpread < 0 && side === "away");
  }
  if (abstention === "total_40_70") return totalLine >= 40 && totalLine <= 70;
  if (abstention === "total_45_65") return totalLine >= 45 && totalLine <= 65;
  return side === abstention;
}

function decisionTimingIssue(args: {
  evaluatedAt: string;
  quoteAt: string;
  gameStartsAt: string;
  stage: CfbV1DecisionStage;
  lockedAt: string | null;
}): Extract<CfbV1UnavailableReasonCode, "quote_timestamp_invalid" | "quote_observed_after_evaluation" | "evaluation_not_pregame"> | null {
  const evaluated = Date.parse(args.evaluatedAt);
  const quote = Date.parse(args.quoteAt);
  const starts = Date.parse(args.gameStartsAt);
  if (![evaluated, quote, starts].every(Number.isFinite)) return "quote_timestamp_invalid";
  if (quote > evaluated) return "quote_observed_after_evaluation";
  if (evaluated >= starts) return "evaluation_not_pregame";
  if (args.stage === "unlocked") {
    if (args.lockedAt !== null) throw new Error("Unlocked CFB decision cannot carry lockedAt.");
    return null;
  }
  if (!args.lockedAt || Date.parse(args.lockedAt) !== evaluated) throw new Error("CFB T-60 decision must freeze at evaluatedAt.");
  const lag = (evaluated - (starts - CFB_T60_TARGET_MINUTES * 60_000)) / 60_000;
  if (lag < 0 || lag > CFB_T60_MAX_CAPTURE_LAG_MINUTES) throw new Error("CFB T-60 capture is outside the 0-20 minute lag boundary.");
  return null;
}

function unavailableReasonCodes(args: {
  comparableCurrentBooks: NcaafBookOdds[];
  forecast: CfbV1Forecast;
  market: CfbV1Market;
  gameStartsAt: string;
  stage: CfbV1DecisionStage;
  evaluatedAt?: string;
  lockedAt?: string | null;
  contextLines?: CfbV1ContextLines;
}): CfbV1UnavailableReasonCode[] {
  const reasons = new Set<CfbV1UnavailableReasonCode>();
  const targets = args.comparableCurrentBooks.filter((book) => book.targetEligible !== false);
  const targetMarkets = targets.filter((book) => book[args.market] !== null);
  if (targetMarkets.length === 0) reasons.add("named_target_quote_unavailable");

  for (const target of targetMarkets) {
    const homeSpread = args.market === "spread"
      ? target.spread?.homeLine
      : target.spread?.homeLine ?? args.contextLines?.homeSpread ?? consensusHomeSpread(args.comparableCurrentBooks) ?? (args.market === "total" ? 0 : null);
    const totalLine = args.market === "total"
      ? target.total?.line
      : target.total?.line ?? args.contextLines?.totalLine ?? args.forecast.expectedTotal;
    if (homeSpread === undefined || homeSpread === null || totalLine === undefined || totalLine === null) {
      reasons.add("market_context_line_unavailable");
      continue;
    }
    const probabilities = cfbV1LineProbabilities({ forecast: args.forecast, homeSpread, totalLine });
    const side = pmfSelectedSide(probabilities, args.market);
    const quote = targetQuote(target, args.market, side);
    if (!quote) {
      reasons.add("named_target_quote_unavailable");
      continue;
    }
    const evaluatedAt = args.evaluatedAt ?? quote.observedAt;
    const lockedAt = args.stage === "t60_locked" ? args.lockedAt ?? evaluatedAt : null;
    const timing = decisionTimingIssue({
      evaluatedAt,
      quoteAt: quote.observedAt,
      gameStartsAt: args.gameStartsAt,
      stage: args.stage,
      lockedAt,
    });
    if (timing !== null) {
      reasons.add(timing);
      continue;
    }
    if (!targetExcludedConsensus(args.comparableCurrentBooks, target, args.market, side, quote.line)) {
      reasons.add("target_excluded_same_line_consensus_insufficient");
    }
  }

  if (reasons.size === 0) reasons.add("named_target_quote_unavailable");
  return [...reasons].sort();
}

function heldBundle(forecast: CfbV1Forecast, heldMarkets: CfbV1DecisionBundle["heldMarkets"]): CfbV1DecisionBundle {
  return { providerGameId: forecast.providerGameId, forecast, evaluatedBets: [], heldMarkets, publicationEnabled: true, trackingEnabled: false, modelRelease: CFB_V1_MODEL_RELEASE, decisionRelease: CFB_V1_DECISION_RELEASE, policyRelease: CFB_V1_GRADE_POLICY_RELEASE };
}

function sideLabel(market: CfbV1Market, side: string, line: number | null, away: string, home: string): string {
  if (market === "moneyline") return side === "home" ? home : away;
  if (market === "spread") return `${side === "home" ? home : away} ${signed(line ?? 0)}`;
  return `${side === "over" ? "Over" : "Under"} ${marketNumber(line ?? 0)}`;
}

function primarySide(market: CfbV1Market): "home" | "over" { return market === "total" ? "over" : "home"; }
function opposingSide(side: "home" | "away" | "over" | "under"): "home" | "away" | "over" | "under" { return side === "home" ? "away" : side === "away" ? "home" : side === "over" ? "under" : "over"; }
function rMarkets(): CfbV1Market[] { return ["moneyline", "spread", "total"]; }
function gradeRank(grade: CfbV1Grade): number { return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0; }
function profitOne(price: number): number { if (!Number.isFinite(price) || price === 0) throw new Error("CFB American price must be finite and non-zero."); return price > 0 ? price / 100 : 100 / -price; }
function expectedValueWithPush(probabilityIncludingHalfPush: number, pushProbability: number, price: number): number {
  const winProbability = Math.max(0, probabilityIncludingHalfPush - 0.5 * pushProbability);
  const lossProbability = Math.max(0, 1 - probabilityIncludingHalfPush - 0.5 * pushProbability);
  return winProbability * profitOne(price) - lossProbability;
}
function implied(price: number): number { return price > 0 ? 100 / (price + 100) : -price / (-price + 100); }
function twoSidedFair(selected: number, opposing: number): number { const first = implied(selected); const second = implied(opposing); return first / (first + second); }
function logit(value: number): number { const bounded = Math.min(0.995, Math.max(0.005, value)); return Math.log(bounded / (1 - bounded)); }
function sigmoid(value: number): number { return 1 / (1 + Math.exp(-value)); }
function normalizeBook(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function consensusHomeSpread(books: NcaafBookOdds[]): number | null {
  const values = books.flatMap((book) => book.spread ? [book.spread.homeLine] : []).sort((first, second) => first - second);
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
}
function marketNumber(value: number): string { return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1); }
function signed(value: number): string { return value > 0 ? `+${marketNumber(value)}` : marketNumber(value); }

function pmfSelectedSide(
  probabilities: ReturnType<typeof cfbV1LineProbabilities>,
  market: CfbV1Market,
): "home" | "away" | "over" | "under" {
  if (market === "moneyline") return probabilities.moneyline.home >= probabilities.moneyline.away ? "home" : "away";
  if (market === "spread") return probabilities.spread.home >= probabilities.spread.away ? "home" : "away";
  return probabilities.total.over >= probabilities.total.under ? "over" : "under";
}

function assertArtifactReleases(): void {
  if (weeklyArtifact.artifactRelease !== CFB_V1_BASE_SCORE_ARTIFACT_RELEASE || weeklyArtifact.baseArtifactRelease !== CFB_V1_WEEKLY_BASE_ARTIFACT_RELEASE || weeklyArtifact.modelRelease !== CFB_V1_BASE_MODEL_RELEASE) {
    throw new Error("CFB v1 weekly runtime artifact release mismatch.");
  }
  if (
    scoreArtifact.artifactRelease !== CFB_V1_WEEKLY_BASE_ARTIFACT_RELEASE ||
    scoreArtifact.modelRelease !== CFB_V1_BASE_MODEL_RELEASE ||
    scoreArtifact.distributionRelease !== CFB_V1_BASE_DISTRIBUTION_RELEASE ||
    scoreArtifact.probabilityRelease !== CFB_V1_BASE_PROBABILITY_RELEASE ||
    scoreArtifact.representativeScoreRelease !== CFB_V1_BASE_REPRESENTATIVE_SCORE_RELEASE
  ) {
    throw new Error("CFB v1 score artifact release mismatch.");
  }
  if (gradeArtifact.policyRelease !== CFB_V1_BASE_GRADE_POLICY_RELEASE || gradeArtifact.decisionRelease !== CFB_V1_POLICY_SOURCE_DECISION_RELEASE) {
    throw new Error("CFB v1 grade artifact release mismatch.");
  }
}
