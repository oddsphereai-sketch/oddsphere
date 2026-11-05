import type { SoccerFixtureEventIdentity } from "../../lib/providers/real_api/SharpApiEplMarketProvider";
import type { BdlEplOdds } from "../../lib/providers/real_api/BallDontLieEplProvider";
import {
  bivariatePoissonScoreDistribution,
  medianTotalFromDistribution,
  mostLikelyTotalFromDistribution,
  type ScoreDistribution,
} from "../../lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "../../lib/services/soccer/soccerMarketProbabilities";
import type { EplCoherentMarketOutcome } from "../../lib/services/epl/eplCoherentMarketOutcome";
import type { EplForwardBookVector } from "../../lib/services/epl/eplForwardEvidenceCapture";
import type { EplStoredPriceObservation } from "../../lib/services/epl/buildEplDailyEdgePreview";

export const EPL_R23_INCUMBENT_OUTCOME_RELEASE =
  "epl_coherent_market_outcome_2026_10_28_r3_provider_attributed_price_vectors" as const;
const MAX_AGE_MS = 15 * 60_000;
const MAX_SKEW_MS = 60_000;
type Side = "home" | "draw" | "away";

const finiteIso = (value: string | null) => {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
};
const vectorProbability = (vector: EplForwardBookVector, side: "over" | "under") => {
  const probability = vector.outcomes.find(outcome => outcome.side === side)?.noVigProbability;
  return typeof probability === "number" && Number.isFinite(probability) && probability > 0 && probability < 1 ? probability : null;
};
const exactQuoteSignature = (vector: EplForwardBookVector) => (["over", "under"] as const).map(side => {
  const outcome = vector.outcomes.find(row => row.side === side)!;
  return `${side}:${outcome.american}:${outcome.noVigProbability}`;
}).join("|");
const evidenceFamily = (vector: EplForwardBookVector) => vector.sourceClass === "named_originator"
  ? { family: `originator:${vector.canonicalBook}`, basis: "named_originator_identity" as const }
  : { family: `${vector.provider}:non_originator`, basis: "provider_non_originator_conservative_family" as const };
const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const resultSide = (home: number, away: number): Side => home > away ? "home" : home < away ? "away" : "draw";

function summarize(joint: ScoreDistribution, markets: ReturnType<typeof deriveSoccerMarketProbabilities>) {
  let expectedHome = 0, expectedAway = 0, likelyScore = { home: 0, away: 0, probability: 0 };
  const result = (["home", "draw", "away"] as const).reduce((best, side) => markets.match_result[side] > markets.match_result[best] ? side : best, "home");
  const total = markets.total.over >= markets.total.under ? "over" : "under";
  const btts = markets.btts.yes >= markets.btts.no ? "yes" : "no";
  let representativeScore: EplCoherentMarketOutcome["representativeScore"] = null;
  for (let home = 0; home < joint.length; home++) for (let away = 0; away < joint[home]!.length; away++) {
    const probability = joint[home]![away]!;
    expectedHome += home * probability; expectedAway += away * probability;
    if (probability > likelyScore.probability) likelyScore = { home, away, probability };
    const totalMatches = total === "over" ? home + away > 2.5 : home + away < 2.5;
    const bttsMatches = btts === "yes" ? home > 0 && away > 0 : home === 0 || away === 0;
    if (resultSide(home, away) === result && totalMatches && bttsMatches
      && (!representativeScore || probability > representativeScore.probability)) representativeScore = { home, away, probability };
  }
  return { expectedGoals: { home: expectedHome, away: expectedAway }, likelyScore, representativeScore,
    medianTotal: medianTotalFromDistribution(joint), mostLikelyTotal: mostLikelyTotalFromDistribution(joint) };
}

function overProbabilityAtLogTilt(logTilt: number, strata: Record<Side, { over: number; under: number; mass: number }>) {
  const tilt = Math.exp(logTilt);
  return (Object.keys(strata) as Side[]).reduce((sum, side) => {
    const row = strata[side], denominator = row.under + tilt * row.over;
    return sum + (denominator > 0 ? row.mass * tilt * row.over / denominator : 0);
  }, 0);
}
function tiltToTotalTarget(independent: ScoreDistribution, targetOver: number): ScoreDistribution | null {
  const strata: Record<Side, { over: number; under: number; mass: number }> = {
    home: { over: 0, under: 0, mass: 0 }, draw: { over: 0, under: 0, mass: 0 }, away: { over: 0, under: 0, mass: 0 },
  };
  for (let home = 0; home < independent.length; home++) for (let away = 0; away < independent[home]!.length; away++) {
    const probability = independent[home]![away]!, row = strata[resultSide(home, away)];
    if (home + away > 2.5) row.over += probability; else row.under += probability;
    row.mass += probability;
  }
  let low = -20, high = 20;
  if (targetOver < overProbabilityAtLogTilt(low, strata) || targetOver > overProbabilityAtLogTilt(high, strata)) return null;
  for (let iteration = 0; iteration < 100; iteration++) {
    const middle = (low + high) / 2;
    if (overProbabilityAtLogTilt(middle, strata) < targetOver) low = middle; else high = middle;
  }
  const tilt = Math.exp((low + high) / 2);
  const tilted = independent.map((row, home) => row.map((probability, away) => {
    const stratum = strata[resultSide(home, away)], denominator = stratum.under + tilt * stratum.over;
    return probability * (home + away > 2.5 ? tilt : 1) * stratum.mass / denominator;
  }));
  return tilted.flat().every(probability => Number.isFinite(probability) && probability >= 0) ? tilted : null;
}
function vectorEligibility(input: { vector: EplForwardBookVector; providerEventId: string | null; excludedBooks: Set<string>; decisionMs: number; kickoffMs: number }) {
  const { vector } = input;
  if (vector.market !== "total" || vector.line !== 2.5) return "not_exact_total_2_5";
  if (!vector.canonicalBook || input.excludedBooks.has(vector.canonicalBook)) return "evaluated_canonical_book_excluded";
  if (!["named_originator", "named_retail", "named_other"].includes(vector.sourceClass)) return "source_not_named_book";
  if (!input.providerEventId || vector.providerEventId !== input.providerEventId) return "provider_event_identity_mismatch";
  if (vectorProbability(vector, "over") === null || vectorProbability(vector, "under") === null) return "complete_two_sided_probability_missing";
  const times = vector.outcomes.map(outcome => finiteIso(outcome.fetchedAt));
  if (times.length !== 2 || times.some(value => value === null)) return "outcome_timestamp_missing";
  const minimum = Math.min(...times as number[]), maximum = Math.max(...times as number[]);
  if (maximum > input.decisionMs || maximum >= input.kickoffMs) return "outcome_timestamp_future_or_postdecision";
  if (input.decisionMs - minimum > MAX_AGE_MS) return "outcome_timestamp_stale";
  if (maximum - minimum > MAX_SKEW_MS) return "outcome_vector_skew_exceeded";
  if (vector.vectorSkewMs === null || vector.vectorSkewMs > MAX_SKEW_MS) return "captured_vector_skew_missing_or_exceeded";
  return null;
}

/** Exact retained r23/r3 outcome law for a read-only same-input release audit. */
export function deriveEplR23IncumbentOutcome(input: {
  matchId?: number; independentLambdaHome: number; independentLambdaAway: number; independentJoint?: ScoreDistribution;
  openingOdds?: BdlEplOdds[]; matchResultVectors?: EplForwardBookVector[]; totalVectors: EplForwardBookVector[];
  bttsVectors?: EplForwardBookVector[]; storedPriceHistory?: EplStoredPriceObservation[]; modelEvidenceQuality?: "thin" | "standard";
  evaluatedMatchResultCanonicalBook: string | null; evaluatedTotalCanonicalBook: string | null; evaluatedBttsCanonicalBook: string | null;
  fixtureEventIdentities?: SoccerFixtureEventIdentity[]; providerEventId: string | null; decisionAt: string; kickoff: string;
}): EplCoherentMarketOutcome {
  const independentJoint = bivariatePoissonScoreDistribution(input.independentLambdaHome, input.independentLambdaAway, -0.1);
  const independentMarkets = deriveSoccerMarketProbabilities({ joint: independentJoint, totalLine: 2.5 });
  const excludedBooks = new Set([input.evaluatedMatchResultCanonicalBook, input.evaluatedTotalCanonicalBook,
    input.evaluatedBttsCanonicalBook].filter((book): book is string => Boolean(book)));
  const decisionMs = Date.parse(input.decisionAt), kickoffMs = Date.parse(input.kickoff);
  const inactiveVectors: Array<{ identity: string; reason: string }> = [], gateReasons: string[] = [];
  if (!Number.isFinite(decisionMs) || !Number.isFinite(kickoffMs)) gateReasons.push("decision_or_kickoff_timestamp_invalid");
  else if (decisionMs >= kickoffMs) gateReasons.push("decision_not_before_kickoff");
  const eligibleByBook = new Map<string, EplForwardBookVector>();
  if (!gateReasons.length) for (const vector of input.totalVectors) {
    const reason = vectorEligibility({ vector, providerEventId: input.providerEventId, excludedBooks, decisionMs, kickoffMs });
    if (reason) { inactiveVectors.push({ identity: vector.identity, reason }); continue; }
    const prior = eligibleByBook.get(vector.canonicalBook);
    if (!prior || Date.parse(vector.fetchedAtMax!) > Date.parse(prior.fetchedAtMax!)
      || vector.fetchedAtMax === prior.fetchedAtMax && vector.identity.localeCompare(prior.identity) < 0) eligibleByBook.set(vector.canonicalBook, vector);
  }
  const eligible = [...eligibleByBook.values()].sort((left, right) => left.canonicalBook.localeCompare(right.canonicalBook));
  inactiveVectors.sort((left, right) => left.identity.localeCompare(right.identity) || left.reason.localeCompare(right.reason));
  if (eligible.length < 2) gateReasons.push("eligible_total_alternatives_below_2");
  const signatures = eligible.map(exactQuoteSignature), families = eligible.map(evidenceFamily);
  const independent = new Set(signatures).size === eligible.length && new Set(families.map(row => row.family)).size === eligible.length;
  if (eligible.length >= 2 && !independent) gateReasons.push("eligible_total_alternatives_correlated");
  const sides = new Set(eligible.map(vector => vectorProbability(vector, "over")! > 0.5 ? "over" : vectorProbability(vector, "over")! < 0.5 ? "under" : "even"));
  if (eligible.length >= 2 && (sides.size !== 1 || sides.has("even"))) gateReasons.push("eligible_total_alternatives_not_unanimous");
  const target = !gateReasons.length ? median(eligible.map(vector => vectorProbability(vector, "over")!)) : null;
  const tilted = target === null ? null : tiltToTotalTarget(independentJoint, target);
  if (target !== null && !tilted) gateReasons.push("total_target_not_bracketed");
  const candidate = !gateReasons.length && tilted ? tilted : independentJoint;
  const derived = deriveSoccerMarketProbabilities({ joint: candidate, totalLine: 2.5 });
  const residuals = (["home", "draw", "away"] as const).map(side => Math.abs(derived.match_result[side] - independentMarkets.match_result[side]));
  if (Math.abs(candidate.flat().reduce((sum, probability) => sum + probability, 0) - 1) > 1e-12 || Math.max(...residuals) > 1e-12) gateReasons.push("tilted_pmf_invalid");
  const joint = gateReasons.includes("tilted_pmf_invalid") ? independentJoint : candidate;
  const recalculated = joint === independentJoint ? independentMarkets : deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  const markets = joint === independentJoint ? independentMarkets : { ...recalculated,
    match_result: independentMarkets.match_result, double_chance: independentMarkets.double_chance };
  return { release: EPL_R23_INCUMBENT_OUTCOME_RELEASE, source: joint === independentJoint ? "independent_club_pmf" : "target_excluded_total_tilt",
    joint, markets, ...summarize(joint, markets), audit: {
      evaluatedCanonicalBooksExcluded: [...excludedBooks].sort(), eligibleAlternativeBooks: eligible.map(vector => vector.canonicalBook),
      eligibleAlternativeSources: eligible.map((vector, index) => ({ book: vector.canonicalBook, sourceClass: vector.sourceClass,
        provider: vector.provider, providerEventId: vector.providerEventId!, fetchedAtMin: vector.fetchedAtMin!, fetchedAtMax: vector.fetchedAtMax!,
        vectorSkewMs: vector.vectorSkewMs!, exactQuoteSignature: signatures[index]!, evidenceFamily: families[index]!.family, familyBasis: families[index]!.basis })),
      correlationState: eligible.length >= 2 && independent ? "independent_exact_quote_signatures" : "correlated_or_indeterminate",
      movementRole: "captured_for_audit_not_forecast_input", evaluatedQuoteRole: "economics_and_grade_only", inactiveVectors,
      targetOverProbability: target, totalProbabilityResidual: target === null ? 0 : Math.abs(markets.total.over - target),
      maximumMatchResultResidual: Math.max(...(["home", "draw", "away"] as const).map(side => Math.abs(markets.match_result[side] - independentMarkets.match_result[side]))),
      gateReasons: gateReasons as EplCoherentMarketOutcome["audit"]["gateReasons"],
    } };
}
