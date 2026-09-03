import type { EplCoherentMarketOutcome } from "@/lib/services/epl/eplCoherentMarketOutcome";
import type { EplForwardBookVector } from "@/lib/services/epl/eplForwardEvidenceCapture";
import {
  bivariatePoissonScoreDistribution,
  medianTotalFromDistribution,
  mostLikelyTotalFromDistribution,
} from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";

export const UCL_COHERENT_MARKET_OUTCOME_RELEASE =
  "ucl_coherent_market_outcome_2026_09_03_r2_independent_regulation_pmf" as const;

type Side = "home" | "draw" | "away";

function resultSide(home: number, away: number): Side {
  return home > away ? "home" : home < away ? "away" : "draw";
}

/**
 * UCL-owned outcome authority. The evaluated quote and all market vectors are
 * deliberately excluded from the forecast PMF; they remain downstream
 * economics/evidence only until UCL-specific exact-price validation exists.
 */
export function deriveUclCoherentMarketOutcome(input: {
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
  const joint = bivariatePoissonScoreDistribution(input.independentLambdaHome, input.independentLambdaAway, -0.1);
  const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  let expectedHome = 0;
  let expectedAway = 0;
  let likelyScore = { home: 0, away: 0, probability: joint[0]![0]! };
  const forecastResult = (["home", "draw", "away"] as const)
    .reduce((best, side) => markets.match_result[side] > markets.match_result[best] ? side : best, "home");
  const forecastTotal = markets.total.over >= markets.total.under ? "over" : "under";
  const forecastBtts = markets.btts.yes >= markets.btts.no ? "yes" : "no";
  let representativeScore: EplCoherentMarketOutcome["representativeScore"] = null;
  for (let home = 0; home < joint.length; home++) {
    for (let away = 0; away < joint[home]!.length; away++) {
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
  const excluded = [
    input.evaluatedMatchResultCanonicalBook,
    input.evaluatedTotalCanonicalBook,
    input.evaluatedBttsCanonicalBook,
  ].filter((value): value is string => Boolean(value));
  return {
    release: UCL_COHERENT_MARKET_OUTCOME_RELEASE,
    source: "independent_club_pmf",
    joint,
    markets,
    expectedGoals: { home: expectedHome, away: expectedAway },
    likelyScore,
    representativeScore,
    medianTotal: medianTotalFromDistribution(joint),
    mostLikelyTotal: mostLikelyTotalFromDistribution(joint),
    audit: {
      evaluatedCanonicalBooksExcluded: [...new Set(excluded)].sort(),
      eligibleAlternativeBooks: [],
      eligibleAlternativeSources: [],
      correlationState: "correlated_or_indeterminate",
      movementRole: "captured_for_audit_not_forecast_input",
      evaluatedQuoteRole: "economics_and_grade_only",
      inactiveVectors: input.totalVectors.map((vector) => ({ identity: vector.identity, reason: "ucl_market_evidence_not_enabled_for_forecast" })),
      targetOverProbability: null,
      totalProbabilityResidual: 0,
      maximumMatchResultResidual: 0,
      gateReasons: [],
    },
  };
}
