export const NFL_REGULAR_DECISION_EVIDENCE_SCHEMA =
  "nfl_regular_evaluated_decision_tuple_2026_08_21_r2" as const;

export const NFL_T60_TARGET_MINUTES = 60 as const;
export const NFL_T60_MAX_CAPTURE_LAG_MINUTES = 20 as const;

export type NflRegularDecisionStage = "unlocked" | "t60_locked";
export type NflRegularDecisionMarket = "moneyline" | "spread" | "total";

export type NflRegularEvaluatedQuote = {
  sportsbook: string;
  line: number | null;
  price: number;
  observedAt: string;
};

export type NflRegularOutcomeConfidence = {
  decisionKind: "outcome_confidence";
  nonActionable: true;
  market: NflRegularDecisionMarket;
  likelySide: string;
  probability: number;
  evaluatedAt: string;
  modelRelease: string;
};

export type NflRegularEvaluatedBetDecision = {
  schemaRelease: typeof NFL_REGULAR_DECISION_EVIDENCE_SCHEMA;
  decisionKind: "exact_price_bet";
  providerGameId: string;
  market: NflRegularDecisionMarket;
  side: string;
  modelProbability: number;
  marketFairProbability: number;
  evaluatedQuote: NflRegularEvaluatedQuote;
  expectedValue: number;
  grade: string;
  stage: NflRegularDecisionStage;
  evaluatedAt: string;
  gameStartsAt: string;
  modelRelease: string;
  calibrationRelease: string;
  decisionRelease: string;
  lockedAt: string | null;
};

export type NflRegularQuoteDisposition =
  | "same_as_evaluated"
  | "writer_refresh_required"
  | "context_only_after_t60";

const MATERIAL_LINE_MOVE = 0.5;
const MATERIAL_FAIR_PROBABILITY_MOVE = 0.01;

export function buildNflRegularEvaluatedBetDecision(args: Omit<
  NflRegularEvaluatedBetDecision,
  "schemaRelease" | "decisionKind" | "expectedValue" | "lockedAt"
> & { lockedAt?: string | null }): NflRegularEvaluatedBetDecision {
  assertProbability(args.modelProbability, "modelProbability");
  assertProbability(args.marketFairProbability, "marketFairProbability");
  assertAmericanPrice(args.evaluatedQuote.price);
  const evaluatedAt = timestamp(args.evaluatedAt, "evaluatedAt");
  const quoteAt = timestamp(args.evaluatedQuote.observedAt, "evaluatedQuote.observedAt");
  const startsAt = timestamp(args.gameStartsAt, "gameStartsAt");
  if (quoteAt > evaluatedAt) throw new Error("NFL evaluated quote cannot postdate the decision.");
  if (evaluatedAt >= startsAt) throw new Error("NFL evaluated decision must be pregame.");
  const lockedAt = args.stage === "t60_locked"
    ? args.lockedAt ?? args.evaluatedAt
    : null;
  if (args.stage === "t60_locked") {
    const lockTime = timestamp(lockedAt!, "lockedAt");
    if (lockTime !== evaluatedAt) throw new Error("T-60 decision must freeze the evaluated tuple at the lock timestamp.");
    assertNflT60CaptureTiming({ lockedAt: lockedAt!, gameStartsAt: args.gameStartsAt });
  } else if (args.lockedAt != null) {
    throw new Error("Unlocked NFL decision cannot carry lockedAt.");
  }
  return {
    ...args,
    schemaRelease: NFL_REGULAR_DECISION_EVIDENCE_SCHEMA,
    decisionKind: "exact_price_bet",
    expectedValue: expectedValue(args.modelProbability, args.evaluatedQuote.price),
    lockedAt,
  };
}

export function nflT60CaptureLagMinutes(args: {
  lockedAt: string;
  gameStartsAt: string;
}): number {
  const lockTime = timestamp(args.lockedAt, "lockedAt");
  const startsAt = timestamp(args.gameStartsAt, "gameStartsAt");
  const cutoff = startsAt - NFL_T60_TARGET_MINUTES * 60_000;
  return (lockTime - cutoff) / 60_000;
}

export function assertNflT60CaptureTiming(args: {
  lockedAt: string;
  gameStartsAt: string;
}): void {
  const lagMinutes = nflT60CaptureLagMinutes(args);
  if (lagMinutes < 0) throw new Error("NFL locked decision is before the T-60 window.");
  if (lagMinutes > NFL_T60_MAX_CAPTURE_LAG_MINUTES) {
    throw new Error(`NFL locked decision exceeds the ${NFL_T60_MAX_CAPTURE_LAG_MINUTES}-minute maximum T-60 capture lag.`);
  }
}

export function nflRegularQuoteDisposition(args: {
  decision: NflRegularEvaluatedBetDecision;
  currentQuote: NflRegularEvaluatedQuote;
}): NflRegularQuoteDisposition {
  const { decision, currentQuote } = args;
  assertAmericanPrice(currentQuote.price);
  timestamp(currentQuote.observedAt, "currentQuote.observedAt");
  const changed = materialQuoteChange(decision.evaluatedQuote, currentQuote);
  if (!changed) return "same_as_evaluated";
  return decision.stage === "t60_locked" ? "context_only_after_t60" : "writer_refresh_required";
}

export function materialQuoteChange(
  evaluated: NflRegularEvaluatedQuote,
  current: NflRegularEvaluatedQuote,
): boolean {
  if (normalizeBook(evaluated.sportsbook) !== normalizeBook(current.sportsbook)) return true;
  if (evaluated.line === null !== (current.line === null)) return true;
  if (evaluated.line !== null && current.line !== null && Math.abs(evaluated.line - current.line) >= MATERIAL_LINE_MOVE) {
    return true;
  }
  return Math.abs(americanImplied(evaluated.price) - americanImplied(current.price)) >= MATERIAL_FAIR_PROBABILITY_MOVE;
}

export function buildNflRegularOutcomeConfidence(args: Omit<
  NflRegularOutcomeConfidence,
  "decisionKind" | "nonActionable"
>): NflRegularOutcomeConfidence {
  assertProbability(args.probability, "probability");
  timestamp(args.evaluatedAt, "evaluatedAt");
  return { ...args, decisionKind: "outcome_confidence", nonActionable: true };
}

function expectedValue(probability: number, price: number): number {
  const profit = price > 0 ? price / 100 : 100 / Math.abs(price);
  return probability * profit - (1 - probability);
}

function americanImplied(price: number): number {
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

function assertProbability(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new Error(`${label} must be between zero and one.`);
}

function assertAmericanPrice(value: number): void {
  if (!Number.isFinite(value) || value === 0) throw new Error("NFL evaluated price must be non-zero American odds.");
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp.`);
  return parsed;
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
