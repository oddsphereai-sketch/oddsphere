import type { BdlUclOdds } from "@/lib/providers/real_api/BallDontLieUclProvider";
import { canonicalEplBook } from "@/lib/services/epl/eplForwardEvidenceCapture";
import {
  bivariatePoissonScoreDistribution,
  type ScoreDistribution,
} from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";
import { canonicalUclOpeningOdds } from "./uclOpeningOdds";

export const UCL_OPENING_MARKET_SCORE_ARBITRATION_RELEASE =
  "ucl_opening_market_score_arbitration_2026_10_06_r1_corroborated_crossing_log_pool_30" as const;

export const UCL_OPENING_MARKET_WEIGHT = 0.30;
const UCL_DIXON_COLES_TAU = -0.1;
const SIDES = ["home", "draw", "away"] as const;

export type UclMatchResultSide = (typeof SIDES)[number];
export type UclMatchResultProbabilities = Record<UclMatchResultSide, number>;

export type UclOpeningMarketScoreArbitration = {
  release: typeof UCL_OPENING_MARKET_SCORE_ARBITRATION_RELEASE;
  applied: boolean;
  source: "independent_club_pmf" | "target_excluded_opening_match_result_log_pool";
  lambdaHome: number;
  lambdaAway: number;
  joint: ScoreDistribution;
  probabilities: UclMatchResultProbabilities;
  independentProbabilities: UclMatchResultProbabilities;
  targetProbabilities: UclMatchResultProbabilities | null;
  independentSide: UclMatchResultSide;
  finalSide: UclMatchResultSide;
  evaluatedCanonicalBookExcluded: string | null;
  eligibleAlternativeBooks: string[];
  inactiveOpeningBooks: Array<{ book: string; reason: string }>;
};

function clampProbability(value: number): number {
  return Math.max(1e-9, Math.min(1 - 1e-9, value));
}

function normalize(probabilities: UclMatchResultProbabilities): UclMatchResultProbabilities {
  const total = probabilities.home + probabilities.draw + probabilities.away;
  return {
    home: probabilities.home / total,
    draw: probabilities.draw / total,
    away: probabilities.away / total,
  };
}

function strongest(probabilities: UclMatchResultProbabilities): UclMatchResultSide {
  return SIDES.reduce((best, side) => probabilities[side] > probabilities[best] ? side : best, "home");
}

function marketLead(probabilities: UclMatchResultProbabilities): number {
  const sorted = SIDES.map((side) => probabilities[side]).sort((left, right) => right - left);
  return sorted[0]! - sorted[1]!;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function probabilitiesFromJoint(joint: ScoreDistribution): UclMatchResultProbabilities {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let homeGoals = 0; homeGoals < joint.length; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals < joint[homeGoals]!.length; awayGoals += 1) {
      const probability = joint[homeGoals]![awayGoals]!;
      if (homeGoals > awayGoals) home += probability;
      else if (homeGoals < awayGoals) away += probability;
      else draw += probability;
    }
  }
  return normalize({ home, draw, away });
}

function logPool(
  independent: UclMatchResultProbabilities,
  market: UclMatchResultProbabilities,
): UclMatchResultProbabilities {
  return normalize(Object.fromEntries(SIDES.map((side) => [
    side,
    Math.exp(
      (1 - UCL_OPENING_MARKET_WEIGHT) * Math.log(clampProbability(independent[side]))
      + UCL_OPENING_MARKET_WEIGHT * Math.log(clampProbability(market[side])),
    ),
  ])) as UclMatchResultProbabilities);
}

/**
 * Preserve the independent expected total while solving a coherent pair of
 * scoring rates closest to the target-excluded 1X2 probability vector. The
 * 0.01 search grid is the exact configuration selected by the chronological
 * tournament; it is intentionally frozen rather than tuned at runtime.
 */
function solveScore(
  expectedTotal: number,
  target: UclMatchResultProbabilities,
): { lambdaHome: number; lambdaAway: number; joint: ScoreDistribution; probabilities: UclMatchResultProbabilities } {
  const lower = Math.max(-expectedTotal + 0.4, -4);
  const upper = Math.min(expectedTotal - 0.4, 4);
  let best: {
    lambdaHome: number;
    lambdaAway: number;
    joint: ScoreDistribution;
    probabilities: UclMatchResultProbabilities;
    error: number;
  } | null = null;
  for (let margin = lower; margin <= upper + 1e-9; margin += 0.01) {
    const lambdaHome = (expectedTotal + margin) / 2;
    const lambdaAway = (expectedTotal - margin) / 2;
    const joint = bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, UCL_DIXON_COLES_TAU);
    const probabilities = probabilitiesFromJoint(joint);
    const error = SIDES.reduce((sum, side) => sum + (probabilities[side] - target[side]) ** 2, 0);
    if (best === null || error < best.error) best = { lambdaHome, lambdaAway, joint, probabilities, error };
  }
  if (best === null) throw new Error("UCL opening-market score solver produced no candidate");
  return best;
}

export function deriveUclOpeningMarketScoreArbitration(input: {
  matchId: number;
  independentLambdaHome: number;
  independentLambdaAway: number;
  openingOdds: BdlUclOdds[];
  evaluatedMatchResultCanonicalBook: string | null;
}): UclOpeningMarketScoreArbitration {
  const independentJoint = bivariatePoissonScoreDistribution(
    input.independentLambdaHome,
    input.independentLambdaAway,
    UCL_DIXON_COLES_TAU,
  );
  const independentProbabilities = probabilitiesFromJoint(independentJoint);
  const independentSide = strongest(independentProbabilities);
  const excluded = canonicalEplBook(input.evaluatedMatchResultCanonicalBook);
  const canonical = canonicalUclOpeningOdds(input.openingOdds).get(input.matchId) ?? [];
  const inactiveOpeningBooks: Array<{ book: string; reason: string }> = [];
  const eligibleByBook = new Map<string, (typeof canonical)[number]>();
  for (const row of canonical) {
    const book = canonicalEplBook(row.vendor);
    if (!book) {
      inactiveOpeningBooks.push({ book: row.vendor, reason: "canonical_book_missing" });
      continue;
    }
    if (excluded && book === excluded) {
      inactiveOpeningBooks.push({ book, reason: "evaluated_canonical_book_excluded" });
      continue;
    }
    if (!eligibleByBook.has(book)) eligibleByBook.set(book, row);
  }
  const eligible = [...eligibleByBook.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (eligible.length < 2) {
    return {
      release: UCL_OPENING_MARKET_SCORE_ARBITRATION_RELEASE,
      applied: false,
      source: "independent_club_pmf",
      lambdaHome: input.independentLambdaHome,
      lambdaAway: input.independentLambdaAway,
      joint: independentJoint,
      probabilities: independentProbabilities,
      independentProbabilities,
      targetProbabilities: null,
      independentSide,
      finalSide: independentSide,
      evaluatedCanonicalBookExcluded: excluded || null,
      eligibleAlternativeBooks: eligible.map(([book]) => book),
      inactiveOpeningBooks,
    };
  }
  const market = normalize({
    home: median(eligible.map(([, row]) => row.noVig.home)),
    draw: median(eligible.map(([, row]) => row.noVig.draw)),
    away: median(eligible.map(([, row]) => row.noVig.away)),
  });
  const crossingQualified = strongest(market) !== independentSide && marketLead(market) >= 0.05;
  if (!crossingQualified) {
    return {
      release: UCL_OPENING_MARKET_SCORE_ARBITRATION_RELEASE,
      applied: false,
      source: "independent_club_pmf",
      lambdaHome: input.independentLambdaHome,
      lambdaAway: input.independentLambdaAway,
      joint: independentJoint,
      probabilities: independentProbabilities,
      independentProbabilities,
      targetProbabilities: market,
      independentSide,
      finalSide: independentSide,
      evaluatedCanonicalBookExcluded: excluded || null,
      eligibleAlternativeBooks: eligible.map(([book]) => book),
      inactiveOpeningBooks,
    };
  }
  const targetProbabilities = logPool(independentProbabilities, market);
  const solved = solveScore(input.independentLambdaHome + input.independentLambdaAway, targetProbabilities);
  return {
    release: UCL_OPENING_MARKET_SCORE_ARBITRATION_RELEASE,
    applied: true,
    source: "target_excluded_opening_match_result_log_pool",
    lambdaHome: solved.lambdaHome,
    lambdaAway: solved.lambdaAway,
    joint: solved.joint,
    probabilities: solved.probabilities,
    independentProbabilities,
    targetProbabilities,
    independentSide,
    finalSide: strongest(solved.probabilities),
    evaluatedCanonicalBookExcluded: excluded || null,
    eligibleAlternativeBooks: eligible.map(([book]) => book),
    inactiveOpeningBooks,
  };
}

export function uclOpeningMarketProbabilityResidual(input: UclOpeningMarketScoreArbitration): number {
  if (!input.targetProbabilities) return 0;
  const derived = deriveSoccerMarketProbabilities({ joint: input.joint, totalLine: 2.5 }).match_result;
  return Math.max(...SIDES.map((side) => Math.abs(derived[side] - input.probabilities[side])));
}
