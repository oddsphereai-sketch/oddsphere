import type {SoccerFixtureEventIdentity} from "@/lib/providers/real_api/SharpApiEplMarketProvider";
import {
  bivariatePoissonScoreDistribution,
  medianTotalFromDistribution,
  mostLikelyTotalFromDistribution,
  type ScoreDistribution,
} from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";
import type { BdlEplOdds } from "@/lib/providers/real_api/BallDontLieEplProvider";
import type { EplForwardBookVector } from "./eplForwardEvidenceCapture";
import type { EplStoredPriceObservation } from "./buildEplDailyEdgePreview";
import { deriveUclRelativeMarketRead, type UclRelativeMarketReadReceipt } from "../ucl/uclRelativeMarketRead";
import { projectUclGoalMarkets, type UclGoalConstraint } from "../ucl/uclGoalMarketProjection";

export const EPL_COHERENT_MARKET_OUTCOME_RELEASE =
  "epl_coherent_market_outcome_2026_11_04_r4_relative_path_joint_pmf" as const;

export const EPL_DRAW_CALIBRATION_RELEASE =
  "epl_draw_calibration_2026_11_04_r2_joint_pmf_order_constraint" as const;

type MatchResultSide = "home" | "draw" | "away";

type GateReason =
  | "decision_or_kickoff_timestamp_invalid"
  | "decision_not_before_kickoff"
  | "eligible_total_alternatives_below_2"
  | "eligible_total_alternatives_correlated"
  | "eligible_total_alternatives_not_unanimous"
  | "total_target_not_bracketed"
  | "tilted_pmf_invalid"
  | "eligible_opening_match_result_alternatives_below_2"
  | "opening_match_result_crossing_not_qualified"
  | "eligible_late_match_result_alternatives_below_2";

export type EplCoherentMarketOutcome = {
  release: string;
  source: "independent_club_pmf" | "independent_draw_calibrated_pmf" | "target_excluded_total_tilt" | "target_excluded_opening_match_result_log_pool" | "target_excluded_late_match_result_log_pool" | "target_excluded_goals_arbitration" | "relative_same_book_market_paths";
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
    movementRole: "captured_for_audit_not_forecast_input" | "late_consensus_forecast_input" | "relative_same_book_price_paths";
    evaluatedQuoteRole: "economics_and_grade_only" | "paired_path_evidence_and_execution_economics";
    inactiveVectors: Array<{ identity: string; reason: string }>;
    targetOverProbability: number | null;
    totalProbabilityResidual: number;
    maximumMatchResultResidual: number;
    gateReasons: GateReason[];
    matchResultReader?: {
      consensus: Record<MatchResultSide, number> | null;
      consensusLeader: MatchResultSide | null;
      eligibleBooks: string[];
      agreement: number;
      dispersion: number;
      authority: number;
    };
    goalsReader?: {
      totalConsensus: { over: number; under: number } | null;
      bttsConsensus: { yes: number; no: number } | null;
      crossMarketBttsYes: number | null;
      totalEligibleBooks: string[];
      bttsEligibleBooks: string[];
      totalMovement: { books: number; delta: number | null; side: "over" | "under" | "stable" | null };
      bttsMovement: { books: number; delta: number | null; side: "yes" | "no" | "stable" | null };
      totalCorrectionApplied: boolean;
      bttsCorrectionApplied: boolean;
      modelEvidenceQuality: "thin" | "standard";
      relativeMarketReader?: UclRelativeMarketReadReceipt;
    };
    drawCalibration?: {
      release: typeof EPL_DRAW_CALIBRATION_RELEASE;
      status: "applied" | "unchanged" | "conflict";
      reason: string;
      constraints: string[];
      residual: number;
      before: Record<MatchResultSide, number>;
      after: Record<MatchResultSide, number>;
    };
  };
};

function calibrateEligibleDraw(base: ScoreDistribution): {
  joint: ScoreDistribution;
  receipt: NonNullable<EplCoherentMarketOutcome["audit"]["drawCalibration"]>;
} {
  const before = deriveSoccerMarketProbabilities({ joint: base, totalLine: 2.5 });
  const summary = summarizeJoint(base, before);
  const rawSide = (["home", "draw", "away"] as const).reduce((best, side) =>
    before.match_result[side] > before.match_result[best] ? side : best, "home");
  const bestClubProbability = Math.max(before.match_result.home, before.match_result.away);
  const eligible = rawSide !== "draw"
    && summary.likelyScore.home === summary.likelyScore.away
    && bestClubProbability - before.match_result.draw <= 0.08
    && Math.abs(summary.expectedGoals.home - summary.expectedGoals.away) <= 0.2
    && before.match_result.draw >= 0.24
    && bestClubProbability <= 0.4;
  const unchanged = (reason: string) => ({
    joint: base,
    receipt: { release: EPL_DRAW_CALIBRATION_RELEASE, status: "unchanged" as const, reason,
      constraints: [], residual: 0, before: before.match_result, after: before.match_result },
  });
  if (!eligible) return unchanged("independent_draw_gate_not_eligible");
  const constraint = (club: "home" | "away"): UclGoalConstraint => ({
    identity: `draw_probability_gte_${club}`,
    target: 0,
    feature: (home, away) => Number(home === away) - Number(club === "home" ? home > away : away > home),
  });
  let constraints = [constraint(rawSide)];
  let projected = projectUclGoalMarkets(base, constraints);
  let after = deriveSoccerMarketProbabilities({ joint: projected.joint, totalLine: 2.5 });
  const other = rawSide === "home" ? "away" : "home";
  if (projected.converged && after.match_result[other] > after.match_result.draw + 1e-9) {
    constraints = [constraint(rawSide), constraint(other)];
    projected = projectUclGoalMarkets(base, constraints);
    after = deriveSoccerMarketProbabilities({ joint: projected.joint, totalLine: 2.5 });
  }
  if (!projected.converged) return {
    joint: base,
    receipt: { release: EPL_DRAW_CALIBRATION_RELEASE, status: "conflict", reason: "joint_draw_order_projection_failed",
      constraints: constraints.map(row => row.identity), residual: projected.residual,
      before: before.match_result, after: before.match_result },
  };
  return {
    joint: projected.joint,
    receipt: { release: EPL_DRAW_CALIBRATION_RELEASE, status: "applied", reason: "eligible_draw_encoded_in_joint_pmf",
      constraints: constraints.map(row => row.identity), residual: projected.residual,
      before: before.match_result, after: after.match_result },
  };
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

export function deriveEplCoherentMarketOutcome(input: {
  matchId?: number;
  independentLambdaHome: number;
  independentLambdaAway: number;
  independentJoint?: ScoreDistribution;
  openingOdds?: BdlEplOdds[];
  matchResultVectors?: EplForwardBookVector[];
  totalVectors: EplForwardBookVector[];
  bttsVectors?: EplForwardBookVector[];
  storedPriceHistory?: EplStoredPriceObservation[];
  modelEvidenceQuality?: "thin" | "standard";
  evaluatedMatchResultCanonicalBook: string | null;
  evaluatedTotalCanonicalBook: string | null;
  evaluatedBttsCanonicalBook: string | null;
  fixtureEventIdentities?: SoccerFixtureEventIdentity[];
  providerEventId: string | null;
  decisionAt: string;
  kickoff: string;
}): EplCoherentMarketOutcome {
  const independentJoint = input.independentJoint
    ?? bivariatePoissonScoreDistribution(input.independentLambdaHome, input.independentLambdaAway, -0.1);
  const draw = calibrateEligibleDraw(independentJoint);
  const targetExcludedInput = {
    ...input,
    matchResultVectors: (input.matchResultVectors ?? []).filter(vector =>
      vector.canonicalBook !== input.evaluatedMatchResultCanonicalBook),
    totalVectors: input.totalVectors.filter(vector => vector.canonicalBook !== input.evaluatedTotalCanonicalBook),
    bttsVectors: (input.bttsVectors ?? []).filter(vector =>
      vector.canonicalBook !== input.evaluatedBttsCanonicalBook),
  };
  const relative = deriveUclRelativeMarketRead(draw.joint, targetExcludedInput);
  const joint = relative.joint;
  const candidateMarkets = relative.receipt.finalProbabilities;
  const excludedBooks = new Set([
    input.evaluatedMatchResultCanonicalBook,
    input.evaluatedTotalCanonicalBook,
    input.evaluatedBttsCanonicalBook,
  ].filter((book): book is string => Boolean(book)));
  const summary = summarizeJoint(joint, candidateMarkets);
  const axes = relative.receipt.markets;
  const applied = relative.receipt.appliedMarkets.length > 0;
  function pathMovement(market: "total"): { books: number; delta: number | null; side: "over" | "under" | "stable" | null };
  function pathMovement(market: "btts"): { books: number; delta: number | null; side: "yes" | "no" | "stable" | null };
  function pathMovement(market: "total" | "btts") {
    const axis = axes[market];
    const selected = axis.selected;
    return {
      books: selected?.baseline ? 1 : 0,
      delta: selected?.baseline && (market !== "total" || selected.baseline.line === selected.current.line)
        ? selected.current.probabilities[market === "total" ? "over" : "yes"]!
          - selected.baseline.probabilities[market === "total" ? "over" : "yes"]!
        : null,
      side: axis.direction === "over" || axis.direction === "under" || axis.direction === "yes" || axis.direction === "no"
        ? axis.direction : axis.direction === "flat" ? "stable" as const : null,
    };
  }

  return {
    release: EPL_COHERENT_MARKET_OUTCOME_RELEASE,
    source: applied ? "relative_same_book_market_paths"
      : draw.receipt.status === "applied" ? "independent_draw_calibrated_pmf" : "independent_club_pmf",
    joint,
    markets: candidateMarkets,
    ...summary,
    audit: {
      evaluatedCanonicalBooksExcluded: [...excludedBooks].sort(),
      eligibleAlternativeBooks: axes.match_result.candidates.filter(path => path.independentOfExecutionBook).map(path => path.book),
      eligibleAlternativeSources: [],
      correlationState: "correlated_or_indeterminate",
      movementRole: "relative_same_book_price_paths",
      evaluatedQuoteRole: "paired_path_evidence_and_execution_economics",
      inactiveVectors: Object.values(axes).flatMap(axis => axis.inactive),
      targetOverProbability: null,
      totalProbabilityResidual: relative.receipt.residual,
      maximumMatchResultResidual: relative.receipt.residual,
      gateReasons: [],
      matchResultReader: {
        consensus: null,
        consensusLeader: axes.match_result.currentTargetProbabilities.home === undefined ? null
          : (["home", "draw", "away"] as const).reduce((best, side) =>
            axes.match_result.currentTargetProbabilities[side]! > axes.match_result.currentTargetProbabilities[best]! ? side : best, "home"),
        eligibleBooks: axes.match_result.candidates.map(path => path.book), agreement: 0, dispersion: 0, authority: 0,
      },
      goalsReader: {
        totalConsensus: null, bttsConsensus: null,
        crossMarketBttsYes: axes.total.status === "applied" ? candidateMarkets.btts.yes : null,
        totalEligibleBooks: axes.total.candidates.filter(path => path.baseline).map(path => path.book),
        bttsEligibleBooks: axes.btts.candidates.filter(path => path.baseline).map(path => path.book),
        totalMovement: pathMovement("total"), bttsMovement: pathMovement("btts"),
        totalCorrectionApplied: axes.total.status === "applied",
        bttsCorrectionApplied: axes.btts.status === "applied",
        modelEvidenceQuality: input.modelEvidenceQuality ?? "standard",
        relativeMarketReader: relative.receipt,
      },
      drawCalibration: draw.receipt,
    },
  };
}
