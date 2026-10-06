import type { EplCoherentMarketOutcome } from "@/lib/services/epl/eplCoherentMarketOutcome";
import type { EplForwardBookVector } from "@/lib/services/epl/eplForwardEvidenceCapture";
import type { BdlUclOdds } from "@/lib/providers/real_api/BallDontLieUclProvider";
import {
  medianTotalFromDistribution,
  mostLikelyTotalFromDistribution,
} from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";
import {
  deriveUclOpeningMarketScoreArbitration,
  uclOpeningMarketProbabilityResidual,
} from "./uclOpeningMarketScoreArbitration";

export const UCL_COHERENT_MARKET_OUTCOME_RELEASE =
  "ucl_coherent_market_outcome_2026_10_06_r3_target_excluded_opening_match_result" as const;

type Side = "home" | "draw" | "away";

function resultSide(home: number, away: number): Side {
  return home > away ? "home" : home < away ? "away" : "draw";
}

/**
 * UCL-owned outcome authority. A target-excluded median of at least two
 * provider opening 1X2 books may supply 30% of a log-probability pool. The
 * independent model remains the 70% primary input, its expected total is
 * preserved, and the evaluated sportsbook can never validate itself.
 */
export function deriveUclCoherentMarketOutcome(input: {
  matchId?: number;
  independentLambdaHome: number;
  independentLambdaAway: number;
  openingOdds?: BdlUclOdds[];
  totalVectors: EplForwardBookVector[];
  evaluatedMatchResultCanonicalBook: string | null;
  evaluatedTotalCanonicalBook: string | null;
  evaluatedBttsCanonicalBook: string | null;
  providerEventId: string | null;
  decisionAt: string;
  kickoff: string;
}): EplCoherentMarketOutcome {
  const arbitration = deriveUclOpeningMarketScoreArbitration({
    matchId: input.matchId ?? -1,
    independentLambdaHome: input.independentLambdaHome,
    independentLambdaAway: input.independentLambdaAway,
    openingOdds: input.openingOdds ?? [],
    evaluatedMatchResultCanonicalBook: input.evaluatedMatchResultCanonicalBook,
  });
  const joint = arbitration.joint;
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
    arbitration.evaluatedCanonicalBookExcluded,
    input.evaluatedTotalCanonicalBook,
    input.evaluatedBttsCanonicalBook,
  ].filter((value): value is string => Boolean(value));
  return {
    release: UCL_COHERENT_MARKET_OUTCOME_RELEASE,
    source: arbitration.source,
    joint,
    markets,
    expectedGoals: { home: expectedHome, away: expectedAway },
    likelyScore,
    representativeScore,
    medianTotal: medianTotalFromDistribution(joint),
    mostLikelyTotal: mostLikelyTotalFromDistribution(joint),
    audit: {
      evaluatedCanonicalBooksExcluded: [...new Set(excluded)].sort(),
      eligibleAlternativeBooks: arbitration.eligibleAlternativeBooks,
      eligibleAlternativeSources: [],
      correlationState: "correlated_or_indeterminate",
      movementRole: "captured_for_audit_not_forecast_input",
      evaluatedQuoteRole: "economics_and_grade_only",
      inactiveVectors: [
        ...arbitration.inactiveOpeningBooks.map((row) => ({ identity: `opening_1x2:${row.book}`, reason: row.reason })),
        ...input.totalVectors.map((vector) => ({ identity: vector.identity, reason: "ucl_total_market_evidence_not_enabled_for_forecast" })),
      ],
      targetOverProbability: null,
      totalProbabilityResidual: 0,
      maximumMatchResultResidual: uclOpeningMarketProbabilityResidual(arbitration),
      gateReasons: arbitration.applied
        ? []
        : [arbitration.eligibleAlternativeBooks.length < 2
            ? "eligible_opening_match_result_alternatives_below_2"
            : "opening_match_result_crossing_not_qualified"],
    },
  };
}
