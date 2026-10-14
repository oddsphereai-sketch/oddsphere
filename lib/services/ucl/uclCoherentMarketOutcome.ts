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
import { logPoolUclResult, reconcileUclMeanPreserving } from "./uclEloConsensus";

export const UCL_COHERENT_MARKET_OUTCOME_RELEASE =
  "ucl_coherent_market_outcome_2026_10_14_r4_target_excluded_late_consensus" as const;

type Side = "home" | "draw" | "away";
type ResultVector = Record<Side, number>;
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
  const joint = consensus
    ? reconcileUclMeanPreserving(independentJoint, targetResult, independentMarkets.total.over, independentMarkets.btts.yes)
    : independentJoint;
  const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  const summary = summarize(joint, markets);
  const excluded = [input.evaluatedMatchResultCanonicalBook, input.evaluatedTotalCanonicalBook, input.evaluatedBttsCanonicalBook]
    .filter((value): value is string => Boolean(value));
  inactiveVectors.push(
    ...input.totalVectors.map((vector) => ({ identity: vector.identity, reason: "ucl_total_market_evidence_not_enabled_for_forecast" })),
    ...(input.openingOdds ?? []).map((row) => ({ identity: `opening_1x2:${row.vendor}:${row.id}`, reason: "opening_market_superseded_by_late_consensus" })),
  );
  return {
    release: UCL_COHERENT_MARKET_OUTCOME_RELEASE,
    source: consensus ? "target_excluded_late_match_result_log_pool" : "independent_club_pmf",
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
      targetOverProbability: null,
      totalProbabilityResidual: Math.abs(markets.total.over - independentMarkets.total.over),
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
    },
  };
}
