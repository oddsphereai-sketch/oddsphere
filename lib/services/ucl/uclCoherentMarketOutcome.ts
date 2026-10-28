import type { EplCoherentMarketOutcome } from "@/lib/services/epl/eplCoherentMarketOutcome";
import type { EplForwardBookVector } from "@/lib/services/epl/eplForwardEvidenceCapture";
import type { BdlUclOdds } from "@/lib/providers/real_api/BallDontLieUclProvider";
import {
  bivariatePoissonScoreDistribution,
  medianTotalFromDistribution,
  mostLikelyTotalFromDistribution,
  type ScoreDistribution,
} from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";
import { impliedEplGoalsMarketDistribution } from "@/lib/services/epl/eplDerivedMarketForecast";
import { logPoolUclResult, reconcileUclMeanPreserving } from "./uclEloConsensus";

export const UCL_COHERENT_MARKET_OUTCOME_RELEASE =
  "ucl_coherent_market_outcome_2026_10_28_r6_provider_attributed_price_vectors" as const;

type Side = "home" | "draw" | "away";
type ResultVector = Record<Side, number>;
type BinaryMarket = "total" | "btts";
type BinarySide = "over" | "under" | "yes" | "no";
type BinaryConsensus = {
  probabilities: Record<BinarySide, number>;
  leader: BinarySide;
  eligibleBooks: string[];
  probabilitiesByBook: Record<string, Record<BinarySide, number>>;
};
type StoredPriceObservation = {
  providerId: number;
  market: "match_result" | "double_chance" | "total" | "btts";
  side: string;
  line: number | null;
  american: number;
  sportsbook: string | null;
  recordedAt: string;
  isOpener: boolean;
};
const SIDES = ["home", "draw", "away"] as const;
const EXCLUDED_MARKET_BOOKS = new Set(["polymarket", "kalshi"]);

function resultSide(home: number, away: number): Side {
  return home > away ? "home" : home < away ? "away" : "draw";
}

function leader(vector: ResultVector): Side {
  return SIDES.reduce((best, side) => vector[side] > vector[best] ? side : best, "home");
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function normalize(vector: ResultVector): ResultVector {
  const total = vector.home + vector.draw + vector.away;
  return { home: vector.home / total, draw: vector.draw / total, away: vector.away / total };
}

function vectorResult(vector: EplForwardBookVector): ResultVector | null {
  const values = Object.fromEntries(SIDES.map((side) => [
    side,
    vector.outcomes.find((outcome) => outcome.side === side)?.noVigProbability,
  ])) as Record<Side, number | undefined>;
  if (SIDES.some((side) => typeof values[side] !== "number" || !Number.isFinite(values[side]) || values[side]! <= 0 || values[side]! >= 1)) return null;
  return normalize(values as ResultVector);
}

function binaryVector(
  vector: EplForwardBookVector,
  market: BinaryMarket,
): Record<BinarySide, number> | null {
  const sides: BinarySide[] = market === "total" ? ["over", "under"] : ["yes", "no"];
  const values = Object.fromEntries(sides.map((side) => [
    side,
    vector.outcomes.find((outcome) => outcome.side === side)?.noVigProbability,
  ])) as Record<BinarySide, number | undefined>;
  if (sides.some((side) => typeof values[side] !== "number" || !Number.isFinite(values[side])
    || values[side]! <= 0 || values[side]! >= 1)) return null;
  const total = sides.reduce((sum, side) => sum + values[side]!, 0);
  return Object.fromEntries(sides.map((side) => [side, values[side]! / total])) as Record<BinarySide, number>;
}

function binaryConsensus(input: {
  vectors: EplForwardBookVector[];
  market: BinaryMarket;
  excludedBook: string | null;
  providerEventId: string | null;
  decisionAt: number;
  kickoff: number;
  inactiveVectors: Array<{ identity: string; reason: string }>;
}): BinaryConsensus | null {
  if (!Number.isFinite(input.decisionAt) || !Number.isFinite(input.kickoff) || input.decisionAt >= input.kickoff) {
    input.inactiveVectors.push(...input.vectors.map((vector) => ({
      identity: vector.identity,
      reason: "decision_or_kickoff_timestamp_invalid",
    })));
    return null;
  }
  const sides: BinarySide[] = input.market === "total" ? ["over", "under"] : ["yes", "no"];
  const byBook = new Map<string, { vector: EplForwardBookVector; probabilities: Record<BinarySide, number> }>();
  for (const vector of input.vectors) {
    let reason: string | null = null;
    if (vector.market !== input.market) reason = `not_${input.market}`;
    else if (!vector.canonicalBook || vector.canonicalBook === input.excludedBook) reason = "evaluated_canonical_book_excluded";
    else if (EXCLUDED_MARKET_BOOKS.has(vector.canonicalBook)) reason = "prediction_market_excluded";
    else if (vector.sourceClass !== "named_originator" && vector.sourceClass !== "named_retail" && vector.sourceClass !== "named_other") reason = "source_not_named_book";
    else if (!input.providerEventId || vector.providerEventId !== input.providerEventId) reason = "provider_event_identity_mismatch";
    else if (vector.overround < 0.98 || vector.overround > 1.25) reason = "binary_hold_out_of_range";
    else if (input.market === "total" && vector.line !== 2.5) reason = "total_line_not_2_5";
    const probabilities = reason ? null : binaryVector(vector, input.market);
    if (!reason && !probabilities) reason = "complete_binary_probability_missing";
    const timestamps = vector.outcomes.map((outcome) => Date.parse(outcome.fetchedAt ?? ""));
    if (!reason && (timestamps.some((timestamp) => !Number.isFinite(timestamp))
      || Math.max(...timestamps) > input.decisionAt || Math.max(...timestamps) >= input.kickoff)) {
      reason = "outcome_timestamp_future_or_postdecision";
    }
    if (reason || !probabilities) {
      input.inactiveVectors.push({ identity: vector.identity, reason: reason ?? "binary_vector_invalid" });
      continue;
    }
    const prior = byBook.get(vector.canonicalBook);
    if (!prior || Date.parse(vector.fetchedAtMax ?? "") > Date.parse(prior.vector.fetchedAtMax ?? "")
      || vector.fetchedAtMax === prior.vector.fetchedAtMax && vector.identity.localeCompare(prior.vector.identity) < 0) {
      byBook.set(vector.canonicalBook, { vector, probabilities });
    }
  }
  const eligible = [...byBook.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (eligible.length < 3) return null;
  const probabilities = Object.fromEntries(sides.map((side) => [
    side,
    median(eligible.map(([, value]) => value.probabilities[side])),
  ])) as Record<BinarySide, number>;
  const probabilityTotal = sides.reduce((sum, side) => sum + probabilities[side], 0);
  for (const side of sides) probabilities[side] /= probabilityTotal;
  const leader = sides.reduce((best, side) => probabilities[side] > probabilities[best] ? side : best, sides[0]!);
  const leaveOneOutStable = eligible.every((_, excludedIndex) => {
    const remainder = eligible.filter((__, index) => index !== excludedIndex);
    return sides.reduce((best, side) => {
      const value = median(remainder.map(([, row]) => row.probabilities[side]));
      const bestValue = median(remainder.map(([, row]) => row.probabilities[best]));
      return value > bestValue ? side : best;
    }, sides[0]!) === leader;
  });
  const dispersion = eligible.reduce((sum, [, value]) => sum + sides.reduce(
    (inside, side) => inside + Math.abs(value.probabilities[side] - probabilities[side]), 0,
  ) / sides.length, 0) / eligible.length;
  if (!leaveOneOutStable || dispersion > 0.06) return null;
  return {
    probabilities,
    leader,
    eligibleBooks: eligible.map(([book]) => book),
    probabilitiesByBook: Object.fromEntries(eligible.map(([book, value]) => [book, value.probabilities])),
  };
}

function canonicalBook(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function implied(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function binaryMovement(input: {
  matchId: number | undefined;
  market: BinaryMarket;
  positiveSide: "over" | "yes";
  negativeSide: "under" | "no";
  consensus: BinaryConsensus | null;
  vectors: EplForwardBookVector[];
  history: StoredPriceObservation[];
  decisionAt: number;
  kickoff: number;
}): { books: number; delta: number | null; side: "over" | "under" | "yes" | "no" | "stable" | null } {
  if (input.matchId === undefined || !input.consensus) return { books: 0, delta: null, side: null };
  const currentByBook = new Map(Object.entries(input.consensus.probabilitiesByBook)
    .map(([book, probabilities]) => [book, probabilities[input.positiveSide]] as const));
  const deltas: number[] = [];
  for (const [book, current] of currentByBook) {
    const byCapture = new Map<string, Partial<Record<BinarySide, number>>>();
    for (const row of input.history) {
      const recordedAt = Date.parse(row.recordedAt);
      if (row.providerId !== input.matchId || row.market !== input.market || canonicalBook(row.sportsbook) !== book
        || row.side !== input.positiveSide && row.side !== input.negativeSide
        || !Number.isFinite(recordedAt) || recordedAt > input.decisionAt || recordedAt >= input.kickoff) continue;
      const capture = byCapture.get(row.recordedAt) ?? {};
      capture[row.side as BinarySide] = row.american;
      byCapture.set(row.recordedAt, capture);
    }
    const opening = [...byCapture.entries()].sort(([left], [right]) => Date.parse(left) - Date.parse(right)).flatMap(([, prices]) => {
      const positive = prices[input.positiveSide];
      const negative = prices[input.negativeSide];
      if (positive === undefined || negative === undefined) return [];
      const rawPositive = implied(positive);
      const rawNegative = implied(negative);
      return [rawPositive / (rawPositive + rawNegative)];
    })[0];
    if (opening !== undefined) deltas.push(current - opening);
  }
  const delta = deltas.length >= 2 ? median(deltas) : null;
  const side = delta === null ? null : delta >= 0.01 ? input.positiveSide : delta <= -0.01 ? input.negativeSide : "stable";
  return { books: deltas.length, delta, side };
}

function vectorIneligibleReason(input: {
  vector: EplForwardBookVector;
  excludedBook: string | null;
  providerEventId: string | null;
  decisionAt: number;
  kickoff: number;
}): string | null {
  const vector = input.vector;
  if (vector.market !== "match_result") return "not_match_result";
  if (!vector.canonicalBook || vector.canonicalBook === input.excludedBook) return "evaluated_canonical_book_excluded";
  if (EXCLUDED_MARKET_BOOKS.has(vector.canonicalBook)) return "prediction_market_excluded";
  if (vector.sourceClass !== "named_originator" && vector.sourceClass !== "named_retail" && vector.sourceClass !== "named_other") return "source_not_named_book";
  if (!input.providerEventId || vector.providerEventId !== input.providerEventId) return "provider_event_identity_mismatch";
  if (vector.overround < 0.98 || vector.overround > 1.25) return "three_way_hold_out_of_range";
  if (!vectorResult(vector)) return "complete_three_way_probability_missing";
  const timestamps = vector.outcomes.map((outcome) => Date.parse(outcome.fetchedAt ?? ""));
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) return "outcome_timestamp_missing";
  if (Math.max(...timestamps) > input.decisionAt || Math.max(...timestamps) >= input.kickoff) return "outcome_timestamp_future_or_postdecision";
  return null;
}

function summarize(joint: ScoreDistribution, markets: ReturnType<typeof deriveSoccerMarketProbabilities>) {
  let expectedHome = 0;
  let expectedAway = 0;
  let likelyScore = { home: 0, away: 0, probability: joint[0]![0]! };
  const forecastResult = leader(markets.match_result);
  const forecastTotal = markets.total.over >= markets.total.under ? "over" : "under";
  const forecastBtts = markets.btts.yes >= markets.btts.no ? "yes" : "no";
  let representativeScore: EplCoherentMarketOutcome["representativeScore"] = null;
  for (let home = 0; home < joint.length; home += 1) {
    for (let away = 0; away < joint[home]!.length; away += 1) {
      const probability = joint[home]![away]!;
      expectedHome += home * probability;
      expectedAway += away * probability;
      if (probability > likelyScore.probability) likelyScore = { home, away, probability };
      const totalMatches = forecastTotal === "over" ? home + away > 2.5 : home + away < 2.5;
      const bttsMatches = forecastBtts === "yes" ? home > 0 && away > 0 : home === 0 || away === 0;
      if (resultSide(home, away) === forecastResult && totalMatches && bttsMatches
        && (!representativeScore || probability > representativeScore.probability)) {
        representativeScore = { home, away, probability };
      }
    }
  }
  return { expectedGoals: { home: expectedHome, away: expectedAway }, likelyScore, representativeScore };
}

export function deriveUclCoherentMarketOutcome(input: {
  matchId?: number;
  independentLambdaHome: number;
  independentLambdaAway: number;
  independentJoint?: ScoreDistribution;
  openingOdds?: BdlUclOdds[];
  matchResultVectors?: EplForwardBookVector[];
  totalVectors: EplForwardBookVector[];
  bttsVectors?: EplForwardBookVector[];
  storedPriceHistory?: StoredPriceObservation[];
  modelEvidenceQuality?: "thin" | "standard";
  evaluatedMatchResultCanonicalBook: string | null;
  evaluatedTotalCanonicalBook: string | null;
  evaluatedBttsCanonicalBook: string | null;
  providerEventId: string | null;
  decisionAt: string;
  kickoff: string;
}): EplCoherentMarketOutcome {
  const independentJoint = input.independentJoint
    ?? bivariatePoissonScoreDistribution(input.independentLambdaHome, input.independentLambdaAway, -0.1);
  const independentMarkets = deriveSoccerMarketProbabilities({ joint: independentJoint, totalLine: 2.5 });
  const decisionAt = Date.parse(input.decisionAt);
  const kickoff = Date.parse(input.kickoff);
  const inactiveVectors: Array<{ identity: string; reason: string }> = [];
  const eligibleByBook = new Map<string, EplForwardBookVector>();
  if (Number.isFinite(decisionAt) && Number.isFinite(kickoff) && decisionAt < kickoff) {
    for (const vector of input.matchResultVectors ?? []) {
      const reason = vectorIneligibleReason({ vector, excludedBook: input.evaluatedMatchResultCanonicalBook, providerEventId: input.providerEventId, decisionAt, kickoff });
      if (reason) {
        inactiveVectors.push({ identity: vector.identity, reason });
        continue;
      }
      const prior = eligibleByBook.get(vector.canonicalBook);
      if (!prior || Date.parse(vector.fetchedAtMax ?? "") > Date.parse(prior.fetchedAtMax ?? "")
        || vector.fetchedAtMax === prior.fetchedAtMax && vector.identity.localeCompare(prior.identity) < 0) {
        eligibleByBook.set(vector.canonicalBook, vector);
      }
    }
  }
  const eligible = [...eligibleByBook.values()].sort((left, right) => left.canonicalBook.localeCompare(right.canonicalBook));
  const vectors = eligible.map((vector) => vectorResult(vector)!);
  const consensus = vectors.length >= 2 ? normalize({
    home: median(vectors.map((vector) => vector.home)),
    draw: median(vectors.map((vector) => vector.draw)),
    away: median(vectors.map((vector) => vector.away)),
  }) : null;
  const consensusLeader = consensus ? leader(consensus) : null;
  const agreement = consensusLeader ? vectors.filter((vector) => leader(vector) === consensusLeader).length / vectors.length : 0;
  const dispersion = consensus ? vectors.reduce((sum, vector) => sum + SIDES.reduce(
    (inside, side) => inside + Math.abs(vector[side] - consensus[side]), 0,
  ) / 3, 0) / vectors.length : 1;
  const stability = Math.max(0, Math.min(1, 1 - dispersion / 0.10));
  const authority = consensus ? 0.45 * agreement * stability : 0;
  const targetResult = consensus ? logPoolUclResult(independentMarkets.match_result, consensus, authority) : independentMarkets.match_result;
  const resultJoint = consensus
    ? reconcileUclMeanPreserving(independentJoint, targetResult, independentMarkets.total.over, independentMarkets.btts.yes)
    : independentJoint;
  const totalConsensus = binaryConsensus({
    vectors: input.totalVectors,
    market: "total",
    excludedBook: input.evaluatedTotalCanonicalBook,
    providerEventId: input.providerEventId,
    decisionAt,
    kickoff,
    inactiveVectors,
  });
  const bttsConsensus = binaryConsensus({
    vectors: input.bttsVectors ?? [],
    market: "btts",
    excludedBook: input.evaluatedBttsCanonicalBook,
    providerEventId: input.providerEventId,
    decisionAt,
    kickoff,
    inactiveVectors,
  });
  const totalMovement = binaryMovement({
    matchId: input.matchId,
    market: "total",
    positiveSide: "over",
    negativeSide: "under",
    consensus: totalConsensus,
    vectors: input.totalVectors,
    history: input.storedPriceHistory ?? [],
    decisionAt,
    kickoff,
  });
  const bttsMovement = binaryMovement({
    matchId: input.matchId,
    market: "btts",
    positiveSide: "yes",
    negativeSide: "no",
    consensus: bttsConsensus,
    vectors: input.bttsVectors ?? [],
    history: input.storedPriceHistory ?? [],
    decisionAt,
    kickoff,
  });
  const crossMarket = consensus && totalConsensus
    ? impliedEplGoalsMarketDistribution({
      home: consensus.home,
      draw: consensus.draw,
      away: consensus.away,
      over: totalConsensus.probabilities.over,
    })
    : null;
  const independentTotalSide = independentMarkets.total.over >= 0.5 ? "over" : "under";
  const totalConsensusSide = totalConsensus?.leader as "over" | "under" | undefined;
  const totalModelConfidence = Math.max(independentMarkets.total.over, independentMarkets.total.under);
  const totalMovementResists = totalConsensusSide !== undefined && totalMovement.side !== null
    && totalMovement.side !== "stable" && totalMovement.side !== totalConsensusSide;
  const totalCorrectionApplied = totalConsensusSide !== undefined && totalConsensusSide !== independentTotalSide
    && totalModelConfidence < 0.60 && !totalMovementResists;
  const independentBttsSide = independentMarkets.btts.yes >= 0.5 ? "yes" : "no";
  const bttsConsensusSide = bttsConsensus?.leader as "yes" | "no" | undefined;
  const crossMarketBttsSide = crossMarket ? crossMarket.bttsYes >= 0.5 ? "yes" : "no" : undefined;
  const bttsModelConfidence = Math.max(independentMarkets.btts.yes, independentMarkets.btts.no);
  const bttsMovementResists = bttsConsensusSide !== undefined && bttsMovement.side !== null
    && bttsMovement.side !== "stable" && bttsMovement.side !== bttsConsensusSide;
  const directDisagreement = bttsConsensus
    ? Math.abs(independentMarkets.btts.yes - bttsConsensus.probabilities.yes)
    : 0;
  const weakOrStructurallyThin = bttsModelConfidence < 0.60
    || input.modelEvidenceQuality === "thin" && directDisagreement >= 0.20;
  const bttsCorrectionApplied = bttsConsensusSide !== undefined && bttsConsensusSide !== independentBttsSide
    && crossMarketBttsSide === bttsConsensusSide && weakOrStructurallyThin && !bttsMovementResists;
  const targetOver = totalCorrectionApplied ? totalConsensus!.probabilities.over : independentMarkets.total.over;
  const targetBtts = bttsCorrectionApplied ? bttsConsensus!.probabilities.yes : independentMarkets.btts.yes;
  const joint = totalCorrectionApplied || bttsCorrectionApplied
    ? reconcileUclMeanPreserving(resultJoint, targetResult, targetOver, targetBtts)
    : resultJoint;
  const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  const summary = summarize(joint, markets);
  const excluded = [input.evaluatedMatchResultCanonicalBook, input.evaluatedTotalCanonicalBook, input.evaluatedBttsCanonicalBook]
    .filter((value): value is string => Boolean(value));
  inactiveVectors.push(
    ...(input.openingOdds ?? []).map((row) => ({ identity: `opening_1x2:${row.vendor}:${row.id}`, reason: "opening_market_superseded_by_late_consensus" })),
  );
  return {
    release: UCL_COHERENT_MARKET_OUTCOME_RELEASE,
    source: totalCorrectionApplied || bttsCorrectionApplied
      ? "target_excluded_goals_arbitration"
      : consensus ? "target_excluded_late_match_result_log_pool" : "independent_club_pmf",
    joint,
    markets,
    ...summary,
    medianTotal: medianTotalFromDistribution(joint),
    mostLikelyTotal: mostLikelyTotalFromDistribution(joint),
    audit: {
      evaluatedCanonicalBooksExcluded: [...new Set(excluded)].sort(),
      eligibleAlternativeBooks: eligible.map((vector) => vector.canonicalBook),
      eligibleAlternativeSources: [],
      correlationState: "correlated_or_indeterminate",
      movementRole: "late_consensus_forecast_input",
      evaluatedQuoteRole: "economics_and_grade_only",
      inactiveVectors: inactiveVectors.sort((left, right) => left.identity.localeCompare(right.identity)),
      targetOverProbability: totalCorrectionApplied ? targetOver : null,
      totalProbabilityResidual: Math.abs(markets.total.over - targetOver),
      maximumMatchResultResidual: Math.max(...SIDES.map((side) => Math.abs(markets.match_result[side] - targetResult[side]))),
      gateReasons: consensus ? [] : ["eligible_late_match_result_alternatives_below_2"],
      matchResultReader: {
        consensus,
        consensusLeader,
        eligibleBooks: eligible.map((vector) => vector.canonicalBook),
        agreement,
        dispersion,
        authority,
      },
      goalsReader: {
        totalConsensus: totalConsensus ? {
          over: totalConsensus.probabilities.over,
          under: totalConsensus.probabilities.under,
        } : null,
        bttsConsensus: bttsConsensus ? {
          yes: bttsConsensus.probabilities.yes,
          no: bttsConsensus.probabilities.no,
        } : null,
        crossMarketBttsYes: crossMarket?.bttsYes ?? null,
        totalEligibleBooks: totalConsensus?.eligibleBooks ?? [],
        bttsEligibleBooks: bttsConsensus?.eligibleBooks ?? [],
        totalMovement: totalMovement as { books: number; delta: number | null; side: "over" | "under" | "stable" | null },
        bttsMovement: bttsMovement as { books: number; delta: number | null; side: "yes" | "no" | "stable" | null },
        totalCorrectionApplied,
        bttsCorrectionApplied,
        modelEvidenceQuality: input.modelEvidenceQuality ?? "standard",
      },
    },
  };
}
