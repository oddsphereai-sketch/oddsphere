import {
  EXPECTED_WNBA_DISTRIBUTION_VERSION,
  EXPECTED_WNBA_GRADE_POLICY_VERSION,
  EXPECTED_WNBA_MODEL_VERSION,
} from "../../automodel/wnbaChampionRuntime";

export const WNBA_DECISION_TUPLE_CONTRACT_VERSION =
  "wnba_decision_tuple_v3_complete_pair_exact_value_2026_09_02" as const;
export const WNBA_LEGACY_DECISION_TUPLE_CONTRACT_VERSION =
  "wnba_decision_tuple_v1_exact_evaluated_price_2026_08_21" as const;

export type WnbaDecisionMarket = "moneyline" | "total" | "spread";
export type WnbaDecisionSide = "home" | "away" | "over" | "under";

export type WnbaDecisionPriceRow = {
  market: WnbaDecisionMarket;
  side: WnbaDecisionSide;
  sportsbook: string;
  line: number | null;
  priceAmerican: number;
  observedAt: string | null;
};

export type WnbaDecisionTuple = {
  contract_version: typeof WNBA_DECISION_TUPLE_CONTRACT_VERSION;
  market: WnbaDecisionMarket;
  side: WnbaDecisionSide;
  line: number | null;
  model_probability: number;
  market_fair_probability: number | null;
  market_fair_probability_source: string | null;
  market_fair_probability_book_count: number;
  outcome_confidence: number;
  bet_grade: string;
  evaluated_price_american: number;
  evaluated_sportsbook: string;
  evaluated_at: string;
  decision_at: string;
  model_version: typeof EXPECTED_WNBA_MODEL_VERSION;
  distribution_version: typeof EXPECTED_WNBA_DISTRIBUTION_VERSION;
  grade_policy_version: typeof EXPECTED_WNBA_GRADE_POLICY_VERSION;
};

function sameLine(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 0.01;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/**
 * Select the exact current row represented by WNBA's existing upper-median
 * evaluated price. The sportsbook tie-break is deterministic; it does not
 * change the price or any grading behavior.
 */
export function selectWnbaEvaluatedPriceRow(
  rows: readonly WnbaDecisionPriceRow[],
  market: WnbaDecisionMarket,
  side: WnbaDecisionSide,
  line: number | null,
): WnbaDecisionPriceRow | null {
  const candidates = rows.filter((row) =>
    row.market === market &&
    row.side === side &&
    sameLine(row.line, line) &&
    Number.isFinite(row.priceAmerican) &&
    row.sportsbook.trim().length > 0 &&
    typeof row.observedAt === "string" &&
    Number.isFinite(Date.parse(row.observedAt))
  );
  const evaluatedPrice = median(candidates.map((row) => row.priceAmerican));
  if (evaluatedPrice === null) return null;
  return candidates
    .filter((row) => row.priceAmerican === evaluatedPrice)
    .sort((left, right) =>
      right.observedAt!.localeCompare(left.observedAt!) ||
      left.sportsbook.localeCompare(right.sportsbook)
    )[0] ?? null;
}

export function buildWnbaDecisionTuple(input: {
  rows: readonly WnbaDecisionPriceRow[];
  market: WnbaDecisionMarket;
  side: WnbaDecisionSide;
  line: number | null;
  modelProbability: number;
  marketFairProbability?: number | null;
  marketFairProbabilitySource?: string | null;
  marketFairProbabilityBookCount?: number;
  evaluatedPriceRow?: WnbaDecisionPriceRow | null;
  outcomeConfidence: number;
  betGrade: string;
  decisionAt: string;
}): WnbaDecisionTuple | null {
  const evaluated = input.evaluatedPriceRow === undefined
    ? selectWnbaEvaluatedPriceRow(input.rows, input.market, input.side, input.line)
    : input.evaluatedPriceRow;
  const decisionMs = Date.parse(input.decisionAt);
  const evaluatedMs = evaluated?.observedAt ? Date.parse(evaluated.observedAt) : Number.NaN;
  if (
    !evaluated ||
    evaluated.market !== input.market ||
    evaluated.side !== input.side ||
    !sameLine(evaluated.line, input.line) ||
    !input.rows.some((row) =>
      row.market === evaluated.market &&
      row.side === evaluated.side &&
      row.sportsbook.trim().toLowerCase() === evaluated.sportsbook.trim().toLowerCase() &&
      sameLine(row.line, evaluated.line) &&
      row.priceAmerican === evaluated.priceAmerican &&
      row.observedAt === evaluated.observedAt
    ) ||
    !Number.isFinite(decisionMs) ||
    !Number.isFinite(evaluatedMs) ||
    evaluatedMs > decisionMs ||
    !Number.isFinite(input.modelProbability) ||
    input.modelProbability < 0 ||
    input.modelProbability > 1 ||
    !Number.isFinite(input.outcomeConfidence) ||
    input.outcomeConfidence < 0 ||
    input.outcomeConfidence > 1 ||
    input.betGrade.trim().length === 0
  ) return null;
  const fairProbability = input.marketFairProbability ?? null;
  const fairSource = input.marketFairProbabilitySource ?? null;
  const fairBookCount = input.marketFairProbabilityBookCount ?? 0;
  if (
    !Number.isInteger(fairBookCount) ||
    fairBookCount < 0 ||
    (fairProbability === null) !== (fairSource === null) ||
    (fairProbability === null) !== (fairBookCount === 0)
  ) return null;
  return {
    contract_version: WNBA_DECISION_TUPLE_CONTRACT_VERSION,
    market: input.market,
    side: input.side,
    line: input.line,
    model_probability: input.modelProbability,
    market_fair_probability: fairProbability,
    market_fair_probability_source: fairSource,
    market_fair_probability_book_count: fairBookCount,
    outcome_confidence: input.outcomeConfidence,
    bet_grade: input.betGrade,
    evaluated_price_american: evaluated.priceAmerican,
    evaluated_sportsbook: evaluated.sportsbook,
    evaluated_at: evaluated.observedAt!,
    decision_at: input.decisionAt,
    model_version: EXPECTED_WNBA_MODEL_VERSION,
    distribution_version: EXPECTED_WNBA_DISTRIBUTION_VERSION,
    grade_policy_version: EXPECTED_WNBA_GRADE_POLICY_VERSION,
  };
}

export function isWnbaDecisionTuple(value: unknown): value is WnbaDecisionTuple {
  if (!value || typeof value !== "object") return false;
  const tuple = value as Partial<WnbaDecisionTuple>;
  const evaluatedMs = typeof tuple.evaluated_at === "string" ? Date.parse(tuple.evaluated_at) : Number.NaN;
  const decisionMs = typeof tuple.decision_at === "string" ? Date.parse(tuple.decision_at) : Number.NaN;
  return (
    tuple.contract_version === WNBA_DECISION_TUPLE_CONTRACT_VERSION &&
    (tuple.market === "moneyline" || tuple.market === "total" || tuple.market === "spread") &&
    (tuple.side === "home" || tuple.side === "away" || tuple.side === "over" || tuple.side === "under") &&
    Number.isFinite(tuple.model_probability) &&
    tuple.model_probability! >= 0 &&
    tuple.model_probability! <= 1 &&
    (tuple.market_fair_probability === null ||
      Number.isFinite(tuple.market_fair_probability) &&
      tuple.market_fair_probability! >= 0 &&
      tuple.market_fair_probability! <= 1) &&
    (tuple.market_fair_probability_source === null ||
      typeof tuple.market_fair_probability_source === "string" &&
      tuple.market_fair_probability_source.length > 0) &&
    Number.isInteger(tuple.market_fair_probability_book_count) &&
    tuple.market_fair_probability_book_count! >= 0 &&
    (tuple.market_fair_probability === null) === (tuple.market_fair_probability_source === null) &&
    (tuple.market_fair_probability === null) === (tuple.market_fair_probability_book_count === 0) &&
    Number.isFinite(tuple.outcome_confidence) &&
    tuple.outcome_confidence! >= 0 &&
    tuple.outcome_confidence! <= 1 &&
    typeof tuple.bet_grade === "string" &&
    tuple.bet_grade.length > 0 &&
    Number.isFinite(tuple.evaluated_price_american) &&
    typeof tuple.evaluated_sportsbook === "string" &&
    tuple.evaluated_sportsbook.length > 0 &&
    Number.isFinite(evaluatedMs) &&
    Number.isFinite(decisionMs) &&
    evaluatedMs <= decisionMs &&
    tuple.model_version === EXPECTED_WNBA_MODEL_VERSION &&
    tuple.distribution_version === EXPECTED_WNBA_DISTRIBUTION_VERSION &&
    tuple.grade_policy_version === EXPECTED_WNBA_GRADE_POLICY_VERSION
  );
}

/** Locked v1 tuples remain the immutable public record after a release bump. */
export function isLegacyWnbaDecisionTuple(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const tuple = value as Record<string, unknown>;
  const evaluatedMs = typeof tuple.evaluated_at === "string" ? Date.parse(tuple.evaluated_at) : Number.NaN;
  const decisionMs = typeof tuple.decision_at === "string" ? Date.parse(tuple.decision_at) : Number.NaN;
  return (
    tuple.contract_version === WNBA_LEGACY_DECISION_TUPLE_CONTRACT_VERSION &&
    (tuple.market === "moneyline" || tuple.market === "total" || tuple.market === "spread") &&
    (tuple.side === "home" || tuple.side === "away" || tuple.side === "over" || tuple.side === "under") &&
    typeof tuple.model_probability === "number" && Number.isFinite(tuple.model_probability) &&
    tuple.model_probability >= 0 && tuple.model_probability <= 1 &&
    (tuple.market_fair_probability === null ||
      typeof tuple.market_fair_probability === "number" &&
      Number.isFinite(tuple.market_fair_probability) &&
      tuple.market_fair_probability >= 0 && tuple.market_fair_probability <= 1) &&
    typeof tuple.outcome_confidence === "number" && Number.isFinite(tuple.outcome_confidence) &&
    tuple.outcome_confidence >= 0 && tuple.outcome_confidence <= 1 &&
    typeof tuple.bet_grade === "string" && tuple.bet_grade.length > 0 &&
    typeof tuple.evaluated_price_american === "number" && Number.isFinite(tuple.evaluated_price_american) &&
    typeof tuple.evaluated_sportsbook === "string" && tuple.evaluated_sportsbook.length > 0 &&
    Number.isFinite(evaluatedMs) && Number.isFinite(decisionMs) && evaluatedMs <= decisionMs &&
    tuple.model_version === "wnba_v1_1_team_identity" &&
    tuple.distribution_version === "wnba_market_heads_value_calibrated_2026_08_02_v3" &&
    tuple.grade_policy_version === "wnba_grade_policy_v6_authoritative_reader_grade_2026_08_13"
  );
}

/**
 * Preserve the last authoritative tuple when a transient provider board cannot
 * produce a new exact price for an otherwise unchanged decision. The tuple is
 * reusable only when every decision-defining field still matches; current
 * quotes remain separate reader context and never mutate this evidence.
 */
export function retainCompatibleWnbaDecisionTuple(
  previous: unknown,
  input: {
    market: WnbaDecisionMarket;
    side: WnbaDecisionSide;
    line: number | null;
    modelProbability: number;
    outcomeConfidence: number;
    betGrade: string;
    decisionAt: string;
  },
): WnbaDecisionTuple | null {
  if (!isWnbaDecisionTuple(previous)) return null;
  const decisionMs = Date.parse(input.decisionAt);
  const previousDecisionMs = Date.parse(previous.decision_at);
  if (
    !Number.isFinite(decisionMs) ||
    !Number.isFinite(previousDecisionMs) ||
    previousDecisionMs > decisionMs ||
    previous.market !== input.market ||
    previous.side !== input.side ||
    !sameLine(previous.line, input.line) ||
    Math.abs(previous.model_probability - input.modelProbability) >= 1e-12 ||
    Math.abs(previous.outcome_confidence - input.outcomeConfidence) >= 1e-12 ||
    previous.bet_grade !== input.betGrade
  ) return null;
  return previous;
}
