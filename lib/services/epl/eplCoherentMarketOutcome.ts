import {
  bivariatePoissonScoreDistribution,
  medianTotalFromDistribution,
  mostLikelyTotalFromDistribution,
  type ScoreDistribution,
} from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";
import type { EplForwardBookVector } from "./eplForwardEvidenceCapture";

export const EPL_COHERENT_MARKET_OUTCOME_RELEASE =
  "epl_coherent_market_outcome_2026_09_02_r2_structural_target_exclusion" as const;

export const EPL_TOTAL_EVIDENCE_MAX_AGE_MS = 15 * 60_000;
export const EPL_TOTAL_EVIDENCE_MAX_VECTOR_SKEW_MS = 60_000;

type MatchResultSide = "home" | "draw" | "away";

type GateReason =
  | "decision_or_kickoff_timestamp_invalid"
  | "decision_not_before_kickoff"
  | "eligible_total_alternatives_below_2"
  | "eligible_total_alternatives_correlated"
  | "eligible_total_alternatives_not_unanimous"
  | "total_target_not_bracketed"
  | "tilted_pmf_invalid";

export type EplCoherentMarketOutcome = {
  release: typeof EPL_COHERENT_MARKET_OUTCOME_RELEASE;
  source: "independent_club_pmf" | "target_excluded_total_tilt";
  joint: ScoreDistribution;
  markets: ReturnType<typeof deriveSoccerMarketProbabilities>;
  expectedGoals: { home: number; away: number };
  likelyScore: { home: number; away: number; probability: number };
  representativeScore: { home: number; away: number; probability: number } | null;
  medianTotal: number;
  mostLikelyTotal: number;
  audit: {
    evaluatedCanonicalBooksExcluded: string[];
    eligibleAlternativeBooks: string[];
    eligibleAlternativeSources: Array<{
      book: string;
      sourceClass: EplForwardBookVector["sourceClass"];
      provider: EplForwardBookVector["provider"];
      providerEventId: string;
      fetchedAtMin: string;
      fetchedAtMax: string;
      vectorSkewMs: number;
      exactQuoteSignature: string;
      evidenceFamily: string;
      familyBasis: "named_originator_identity" | "provider_non_originator_conservative_family";
    }>;
    correlationState: "independent_exact_quote_signatures" | "correlated_or_indeterminate";
    movementRole: "captured_for_audit_not_forecast_input";
    evaluatedQuoteRole: "economics_and_grade_only";
    inactiveVectors: Array<{ identity: string; reason: string }>;
    targetOverProbability: number | null;
    totalProbabilityResidual: number;
    maximumMatchResultResidual: number;
    gateReasons: GateReason[];
  };
};

function finiteIso(value: string | null): number | null {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function vectorProbability(vector: EplForwardBookVector, side: "over" | "under"): number | null {
  const probability = vector.outcomes.find((outcome) => outcome.side === side)?.noVigProbability;
  return typeof probability === "number" && Number.isFinite(probability) && probability > 0 && probability < 1
    ? probability
    : null;
}

function exactQuoteSignature(vector: EplForwardBookVector): string {
  return (["over", "under"] as const).map((side) => {
    const outcome = vector.outcomes.find((row) => row.side === side)!;
    return `${side}:${outcome.american}:${outcome.noVigProbability}`;
  }).join("|");
}

function evidenceFamily(vector: EplForwardBookVector): {
  family: string;
  basis: "named_originator_identity" | "provider_non_originator_conservative_family";
} {
  if (vector.sourceClass === "named_originator") {
    return { family: `originator:${vector.canonicalBook}`, basis: "named_originator_identity" };
  }
  // The provider payload identifies the displayed book, but supplies no
  // corporate ownership or independent-feed lineage. Treat every
  // non-originator from that provider as one conservative family; a set of
  // retail labels cannot manufacture independent corroboration.
  return { family: `${vector.provider}:non_originator`, basis: "provider_non_originator_conservative_family" };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function matchResultSide(home: number, away: number): MatchResultSide {
  return home > away ? "home" : home < away ? "away" : "draw";
}

function summarizeJoint(joint: ScoreDistribution, markets: ReturnType<typeof deriveSoccerMarketProbabilities>) {
  let expectedHome = 0;
  let expectedAway = 0;
  let likelyScore = { home: 0, away: 0, probability: 0 };
  const result = (["home", "draw", "away"] as const).reduce((best, side) =>
    markets.match_result[side] > markets.match_result[best] ? side : best, "home");
  const total = markets.total.over >= markets.total.under ? "over" : "under";
  const btts = markets.btts.yes >= markets.btts.no ? "yes" : "no";
  let representativeScore: EplCoherentMarketOutcome["representativeScore"] = null;

  for (let home = 0; home < joint.length; home++) {
    for (let away = 0; away < joint[home]!.length; away++) {
      const probability = joint[home]![away]!;
      expectedHome += home * probability;
      expectedAway += away * probability;
      if (probability > likelyScore.probability) likelyScore = { home, away, probability };
      const resultMatches = matchResultSide(home, away) === result;
      const totalMatches = total === "over" ? home + away > 2.5 : home + away < 2.5;
      const bttsMatches = btts === "yes" ? home > 0 && away > 0 : home === 0 || away === 0;
      if (resultMatches && totalMatches && bttsMatches && (!representativeScore || probability > representativeScore.probability)) {
        representativeScore = { home, away, probability };
      }
    }
  }

  return {
    expectedGoals: { home: expectedHome, away: expectedAway },
    likelyScore,
    representativeScore,
    medianTotal: medianTotalFromDistribution(joint),
    mostLikelyTotal: mostLikelyTotalFromDistribution(joint),
  };
}

function overProbabilityAtLogTilt(
  logTilt: number,
  strata: Record<MatchResultSide, { over: number; under: number; mass: number }>,
): number {
  const tilt = Math.exp(logTilt);
  return (Object.keys(strata) as MatchResultSide[]).reduce((sum, side) => {
    const row = strata[side];
    const denominator = row.under + tilt * row.over;
    return sum + (denominator > 0 ? row.mass * tilt * row.over / denominator : 0);
  }, 0);
}

function tiltToTotalTarget(independent: ScoreDistribution, targetOver: number): ScoreDistribution | null {
  const strata: Record<MatchResultSide, { over: number; under: number; mass: number }> = {
    home: { over: 0, under: 0, mass: 0 },
    draw: { over: 0, under: 0, mass: 0 },
    away: { over: 0, under: 0, mass: 0 },
  };
  for (let home = 0; home < independent.length; home++) {
    for (let away = 0; away < independent[home]!.length; away++) {
      const probability = independent[home]![away]!;
      const row = strata[matchResultSide(home, away)];
      if (home + away > 2.5) row.over += probability;
      else row.under += probability;
      row.mass += probability;
    }
  }

  let low = -20;
  let high = 20;
  if (targetOver < overProbabilityAtLogTilt(low, strata) || targetOver > overProbabilityAtLogTilt(high, strata)) return null;
  for (let iteration = 0; iteration < 100; iteration++) {
    const middle = (low + high) / 2;
    if (overProbabilityAtLogTilt(middle, strata) < targetOver) low = middle;
    else high = middle;
  }
  const tilt = Math.exp((low + high) / 2);
  const tilted = independent.map((row, home) => row.map((probability, away) => {
    const stratum = strata[matchResultSide(home, away)];
    const denominator = stratum.under + tilt * stratum.over;
    return probability * (home + away > 2.5 ? tilt : 1) * stratum.mass / denominator;
  }));
  return tilted.flat().every((probability) => Number.isFinite(probability) && probability >= 0) ? tilted : null;
}

function vectorEligibility(input: {
  vector: EplForwardBookVector;
  providerEventId: string | null;
  excludedBooks: Set<string>;
  decisionMs: number;
  kickoffMs: number;
}): string | null {
  const { vector } = input;
  if (vector.market !== "total" || vector.line !== 2.5) return "not_exact_total_2_5";
  if (!vector.canonicalBook || input.excludedBooks.has(vector.canonicalBook)) return "evaluated_canonical_book_excluded";
  if (vector.sourceClass !== "named_originator"
    && vector.sourceClass !== "named_retail"
    && vector.sourceClass !== "named_other") return "source_not_named_book";
  if (!input.providerEventId || vector.providerEventId !== input.providerEventId) return "provider_event_identity_mismatch";
  if (vectorProbability(vector, "over") === null || vectorProbability(vector, "under") === null) return "complete_two_sided_probability_missing";
  const outcomeTimes = vector.outcomes.map((outcome) => finiteIso(outcome.fetchedAt));
  if (outcomeTimes.length !== 2 || outcomeTimes.some((value) => value === null)) return "outcome_timestamp_missing";
  const minimum = Math.min(...outcomeTimes as number[]);
  const maximum = Math.max(...outcomeTimes as number[]);
  if (maximum > input.decisionMs || maximum >= input.kickoffMs) return "outcome_timestamp_future_or_postdecision";
  if (input.decisionMs - minimum > EPL_TOTAL_EVIDENCE_MAX_AGE_MS) return "outcome_timestamp_stale";
  if (maximum - minimum > EPL_TOTAL_EVIDENCE_MAX_VECTOR_SKEW_MS) return "outcome_vector_skew_exceeded";
  if (vector.vectorSkewMs === null || vector.vectorSkewMs > EPL_TOTAL_EVIDENCE_MAX_VECTOR_SKEW_MS) return "captured_vector_skew_missing_or_exceeded";
  return null;
}

export function deriveEplCoherentMarketOutcome(input: {
  independentLambdaHome: number;
  independentLambdaAway: number;
  totalVectors: EplForwardBookVector[];
  evaluatedMatchResultCanonicalBook: string | null;
  evaluatedTotalCanonicalBook: string | null;
  evaluatedBttsCanonicalBook: string | null;
  providerEventId: string | null;
  decisionAt: string;
  kickoff: string;
}): EplCoherentMarketOutcome {
  const independentJoint = bivariatePoissonScoreDistribution(input.independentLambdaHome, input.independentLambdaAway, -0.1);
  const independentMarkets = deriveSoccerMarketProbabilities({ joint: independentJoint, totalLine: 2.5 });
  const excludedBooks = new Set([
    input.evaluatedMatchResultCanonicalBook,
    input.evaluatedTotalCanonicalBook,
    input.evaluatedBttsCanonicalBook,
  ].filter((book): book is string => Boolean(book)));
  const decisionMs = Date.parse(input.decisionAt);
  const kickoffMs = Date.parse(input.kickoff);
  const inactiveVectors: Array<{ identity: string; reason: string }> = [];
  const gateReasons: GateReason[] = [];

  if (!Number.isFinite(decisionMs) || !Number.isFinite(kickoffMs)) gateReasons.push("decision_or_kickoff_timestamp_invalid");
  else if (decisionMs >= kickoffMs) gateReasons.push("decision_not_before_kickoff");

  const eligibleByBook = new Map<string, EplForwardBookVector>();
  if (gateReasons.length === 0) {
    for (const vector of input.totalVectors) {
      const reason = vectorEligibility({ vector, providerEventId: input.providerEventId, excludedBooks, decisionMs, kickoffMs });
      if (reason) {
        inactiveVectors.push({ identity: vector.identity, reason });
        continue;
      }
      const prior = eligibleByBook.get(vector.canonicalBook);
      if (!prior || Date.parse(vector.fetchedAtMax!) > Date.parse(prior.fetchedAtMax!)
        || vector.fetchedAtMax === prior.fetchedAtMax && vector.identity.localeCompare(prior.identity) < 0) {
        eligibleByBook.set(vector.canonicalBook, vector);
      }
    }
  }
  const eligible = [...eligibleByBook.values()].sort((left, right) => left.canonicalBook.localeCompare(right.canonicalBook));
  inactiveVectors.sort((left, right) => left.identity.localeCompare(right.identity) || left.reason.localeCompare(right.reason));
  if (eligible.length < 2) gateReasons.push("eligible_total_alternatives_below_2");
  const exactQuoteSignatures = eligible.map(exactQuoteSignature);
  const evidenceFamilies = eligible.map((vector) => evidenceFamily(vector));
  const independentlyObserved = new Set(exactQuoteSignatures).size === eligible.length
    && new Set(evidenceFamilies.map(({ family }) => family)).size === eligible.length;
  if (eligible.length >= 2 && !independentlyObserved) gateReasons.push("eligible_total_alternatives_correlated");
  const sides = new Set(eligible.map((vector) => vectorProbability(vector, "over")! > 0.5 ? "over" : vectorProbability(vector, "over")! < 0.5 ? "under" : "even"));
  if (eligible.length >= 2 && (sides.size !== 1 || sides.has("even"))) gateReasons.push("eligible_total_alternatives_not_unanimous");

  const targetOverProbability = gateReasons.length === 0
    ? median(eligible.map((vector) => vectorProbability(vector, "over")!))
    : null;
  const tilted = targetOverProbability === null ? null : tiltToTotalTarget(independentJoint, targetOverProbability);
  if (targetOverProbability !== null && !tilted) gateReasons.push("total_target_not_bracketed");
  const candidateJoint = gateReasons.length === 0 && tilted ? tilted : independentJoint;
  const derived = deriveSoccerMarketProbabilities({ joint: candidateJoint, totalLine: 2.5 });
  const matchResultResiduals = (["home", "draw", "away"] as const).map((side) =>
    Math.abs(derived.match_result[side] - independentMarkets.match_result[side]));
  const mass = candidateJoint.flat().reduce((sum, probability) => sum + probability, 0);
  const maximumMatchResultResidual = Math.max(...matchResultResiduals);
  if (Math.abs(mass - 1) > 1e-12 || maximumMatchResultResidual > 1e-12) {
    gateReasons.push("tilted_pmf_invalid");
  }
  const joint = gateReasons.includes("tilted_pmf_invalid") ? independentJoint : candidateJoint;
  const derivedCandidateMarkets = joint === independentJoint
    ? independentMarkets
    : deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  const candidateMarkets = joint === independentJoint ? independentMarkets : {
    ...derivedCandidateMarkets,
    // The constrained tilt preserves each regulation-result stratum. Reuse
    // the baseline numbers verbatim so public MR/DC identity is bit-exact,
    // rather than exposing floating-point summation dust from the same PMF.
    match_result: independentMarkets.match_result,
    double_chance: independentMarkets.double_chance,
  };
  const summary = summarizeJoint(joint, candidateMarkets);

  return {
    release: EPL_COHERENT_MARKET_OUTCOME_RELEASE,
    source: joint === independentJoint ? "independent_club_pmf" : "target_excluded_total_tilt",
    joint,
    markets: candidateMarkets,
    ...summary,
    audit: {
      evaluatedCanonicalBooksExcluded: [...excludedBooks].sort(),
      eligibleAlternativeBooks: eligible.map((vector) => vector.canonicalBook),
      eligibleAlternativeSources: eligible.map((vector, index) => ({
        book: vector.canonicalBook,
        sourceClass: vector.sourceClass,
        provider: vector.provider,
        providerEventId: vector.providerEventId!,
        fetchedAtMin: vector.fetchedAtMin!,
        fetchedAtMax: vector.fetchedAtMax!,
        vectorSkewMs: vector.vectorSkewMs!,
        exactQuoteSignature: exactQuoteSignatures[index]!,
        evidenceFamily: evidenceFamilies[index]!.family,
        familyBasis: evidenceFamilies[index]!.basis,
      })),
      correlationState: eligible.length >= 2 && independentlyObserved
        ? "independent_exact_quote_signatures"
        : "correlated_or_indeterminate",
      movementRole: "captured_for_audit_not_forecast_input",
      evaluatedQuoteRole: "economics_and_grade_only",
      inactiveVectors,
      targetOverProbability,
      totalProbabilityResidual: targetOverProbability === null ? 0 : Math.abs(candidateMarkets.total.over - targetOverProbability),
      maximumMatchResultResidual: Math.max(...(["home", "draw", "away"] as const).map((side) =>
        Math.abs(candidateMarkets.match_result[side] - independentMarkets.match_result[side]))),
      gateReasons,
    },
  };
}
