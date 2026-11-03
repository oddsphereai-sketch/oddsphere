import type {SoccerFixtureEventIdentity} from "@/lib/providers/real_api/SharpApiEplMarketProvider";
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
import { deriveUclNativeGoalProjection, type UclNativeGoalRead, type UclNativeGoalSource } from "./uclGoalMarketProjection";
import { logPoolUclResult, reconcileUclMeanPreserving } from "./uclEloConsensus";

export const UCL_COHERENT_MARKET_OUTCOME_RELEASE =
  "ucl_coherent_market_outcome_2026_11_03_r10_native_goals_joint" as const;

type Side = "home" | "draw" | "away";
type ResultVector = Record<Side, number>;
type BinaryMarket = "total" | "btts";
type BinarySide = "over" | "under" | "yes" | "no";
type BinaryConsensus = {
  probabilities: Record<BinarySide, number>;
  leader: BinarySide;
  eligibleBooks: string[];
  probabilitiesByBook: Record<string, Record<BinarySide, number>>;
  originalQuoteAtByBook: Record<string, number>;
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

function fixtureOwnsVector(vector:EplForwardBookVector,input:{providerEventId:string|null;fixtureEventIdentities?:SoccerFixtureEventIdentity[]}) {
  if (!vector.providerEventId) return false;
  if (input.fixtureEventIdentities !== undefined) return input.fixtureEventIdentities.some(row =>
    row.provider===vector.provider && row.providerEventId===vector.providerEventId &&
    row.sportsbook===vector.canonicalBook && row.market===vector.market);
  return input.providerEventId!==null && vector.providerEventId===input.providerEventId;
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
    const conflictingCaptures = new Set<string>();
    const currentOriginalAt = input.consensus.originalQuoteAtByBook[book];
    for (const row of input.history) {
      const recordedAt = Date.parse(row.recordedAt);
      if (row.providerId !== input.matchId || row.market !== input.market || canonicalBook(row.sportsbook) !== book
        || row.line !== (input.market === "total" ? 2.5 : null)
        || row.side !== input.positiveSide && row.side !== input.negativeSide
        || !Number.isFinite(recordedAt) || recordedAt > input.decisionAt || recordedAt >= input.kickoff
        || !Number.isFinite(currentOriginalAt) || recordedAt >= currentOriginalAt
        || !Number.isFinite(row.american) || Math.abs(row.american) < 100) continue;
      const capture = byCapture.get(row.recordedAt) ?? {};
      const previousPrice = capture[row.side as BinarySide];
      if (previousPrice !== undefined && previousPrice !== row.american) conflictingCaptures.add(row.recordedAt);
      capture[row.side as BinarySide] = row.american;
      byCapture.set(row.recordedAt, capture);
    }
    const opening = [...byCapture.entries()].sort(([left], [right]) => Date.parse(left) - Date.parse(right)).flatMap(([at, prices]) => {
      if (conflictingCaptures.has(at)) return [];
      const positive = prices[input.positiveSide];
      const negative = prices[input.negativeSide];
      if (positive === undefined || negative === undefined) return [];
      const rawPositive = implied(positive);
      const rawNegative = implied(negative);
      if (rawPositive + rawNegative < 0.98 || rawPositive + rawNegative > 1.25) return [];
      return [rawPositive / (rawPositive + rawNegative)];
    })[0];
    if (opening !== undefined) deltas.push(current - opening);
  }
  const delta = deltas.length >= 1 ? median(deltas) : null;
  const side = delta === null ? null : delta >= 0.01 ? input.positiveSide : delta <= -0.01 ? input.negativeSide : "stable";
  return { books: deltas.length, delta, side };
}

function vectorIneligibleReason(input: {
  vector: EplForwardBookVector;
  excludedBook: string | null;
  fixtureEventIdentities?: SoccerFixtureEventIdentity[];
  providerEventId: string | null;
  decisionAt: number;
  kickoff: number;
}): string | null {
  const vector = input.vector;
  if (vector.market !== "match_result") return "not_match_result";
  if (!vector.canonicalBook || vector.canonicalBook === input.excludedBook) return "evaluated_canonical_book_excluded";
  if (EXCLUDED_MARKET_BOOKS.has(vector.canonicalBook)) return "prediction_market_excluded";
  if (vector.sourceClass !== "named_originator" && vector.sourceClass !== "named_retail" && vector.sourceClass !== "named_other") return "source_not_named_book";
  if (!fixtureOwnsVector(vector,input)) return "provider_event_identity_mismatch";
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

export type UclCoherentMarketOutcome = EplCoherentMarketOutcome & {
  audit: EplCoherentMarketOutcome["audit"] & {
    goalsReader: NonNullable<EplCoherentMarketOutcome["audit"]["goalsReader"]> & {
      nativeGoalMarketRead: UclNativeGoalRead & { matchResultBefore: ResultVector; matchResultAfter: ResultVector };
    };
  };
};

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
  fixtureEventIdentities?: SoccerFixtureEventIdentity[];
  providerEventId: string | null;
  decisionAt: string;
  kickoff: string;
}): UclCoherentMarketOutcome {
  const independentJoint = input.independentJoint
    ?? bivariatePoissonScoreDistribution(input.independentLambdaHome, input.independentLambdaAway, -0.1);
  const independentMarkets = deriveSoccerMarketProbabilities({ joint: independentJoint, totalLine: 2.5 });
  const decisionAt = Date.parse(input.decisionAt);
  const kickoff = Date.parse(input.kickoff);
  const inactiveVectors: Array<{ identity: string; reason: string }> = [];
  const eligibleByBook = new Map<string, EplForwardBookVector>();
  if (Number.isFinite(decisionAt) && Number.isFinite(kickoff) && decisionAt < kickoff) {
    for (const vector of input.matchResultVectors ?? []) {
      const reason = vectorIneligibleReason({ vector, excludedBook: input.evaluatedMatchResultCanonicalBook, providerEventId: input.providerEventId, fixtureEventIdentities: input.fixtureEventIdentities, decisionAt, kickoff });
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
  const native = deriveUclNativeGoalProjection(resultJoint, {
    totalVectors: input.totalVectors, bttsVectors: input.bttsVectors ?? [],
    evaluatedTotalCanonicalBook: input.evaluatedTotalCanonicalBook,
    evaluatedBttsCanonicalBook: input.evaluatedBttsCanonicalBook,
    providerEventId: input.providerEventId, fixtureEventIdentities: input.fixtureEventIdentities,
    decisionAt, kickoff,
  });
  inactiveVectors.push(...native.receipt.inactive);
  const totalCorrectionApplied = native.receipt.totalApplied;
  const bttsCorrectionApplied = native.receipt.bttsApplied;
  const joint = native.joint;
  const movementConsensus = (source: UclNativeGoalSource | null): BinaryConsensus | null => {
    if (!source || source.market === "total" && source.line !== 2.5) return null;
    const positive = source.market === "total" ? "over" : "yes";
    const negative = source.market === "total" ? "under" : "no";
    const probabilities = { over: 0, under: 0, yes: 0, no: 0,
      [positive]: source.fairPositive, [negative]: 1 - source.fairPositive };
    return { probabilities, leader: source.fairPositive >= .5 ? positive : negative,
      eligibleBooks: [source.book], probabilitiesByBook: { [source.book]: probabilities },
      originalQuoteAtByBook: { [source.book]: Date.parse(source.originalQuoteAtMin) } };
  };
  const totalMovement = binaryMovement({ matchId: input.matchId, market: "total", positiveSide: "over", negativeSide: "under",
    consensus: movementConsensus(native.receipt.total), vectors: input.totalVectors,
    history: input.storedPriceHistory ?? [], decisionAt, kickoff });
  const bttsMovement = binaryMovement({ matchId: input.matchId, market: "btts", positiveSide: "yes", negativeSide: "no",
    consensus: movementConsensus(native.receipt.btts), vectors: input.bttsVectors ?? [],
    history: input.storedPriceHistory ?? [], decisionAt, kickoff });
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
      targetOverProbability: totalCorrectionApplied && native.receipt.total?.line === 2.5 ? native.receipt.total.fairPositive : null,
      totalProbabilityResidual: native.receipt.residual,
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
        // A native3/3.25/3.5 settlement share is not an Over2.5 probability.
        totalConsensus: native.receipt.total?.line === 2.5 ? {
          over: native.receipt.total.fairPositive, under: 1 - native.receipt.total.fairPositive,
        } : null,
        bttsConsensus: native.receipt.btts ? {
          yes: native.receipt.btts.fairPositive, no: 1 - native.receipt.btts.fairPositive,
        } : null,
        crossMarketBttsYes: totalCorrectionApplied ? markets.btts.yes : null,
        totalEligibleBooks: native.receipt.availableTotalBooks,
        bttsEligibleBooks: native.receipt.availableBttsBooks,
        nativeGoalMarketRead: { ...native.receipt,
          matchResultBefore: deriveSoccerMarketProbabilities({ joint: resultJoint, totalLine: 2.5 }).match_result,
          matchResultAfter: markets.match_result },
        totalMovement: totalMovement as { books: number; delta: number | null; side: "over" | "under" | "stable" | null },
        bttsMovement: bttsMovement as { books: number; delta: number | null; side: "yes" | "no" | "stable" | null },
        totalCorrectionApplied,
        bttsCorrectionApplied,
        modelEvidenceQuality: input.modelEvidenceQuality ?? "standard",
      },
    },
  };
}
