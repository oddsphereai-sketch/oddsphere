import { DEFAULT_PROP_RECOMMENDATION_CONFIG } from "./config";
import { expected_value } from "./oddsMath";
import { isActionablePropGrade, type PropGrade } from "./propGrades";

export const MLB_PITCHER_OUTS_UNDER_CALIBRATION_SHADOW_RELEASE_ID =
  "mlb_pitcher_outs_under_calibration_2026_07_24_shadow_r1";

export const MLB_PITCHER_OUTS_UNDER_SHADOW_MODEL_WEIGHT = 0.25;

export function buildPitcherOutsUnderCalibrationShadow(args: {
  market: string;
  side: string;
  modelProbability: number | null;
  marketProbability: number | null;
  finalProbability: number | null;
  americanOdds: number;
  playGrade: PropGrade;
}) {
  if (
    args.market !== "pitcher_outs"
    || args.side !== "under"
    || args.modelProbability === null
    || args.marketProbability === null
    || args.finalProbability === null
  ) {
    return null;
  }
  const candidateFinalProbability = round(
    args.modelProbability * MLB_PITCHER_OUTS_UNDER_SHADOW_MODEL_WEIGHT
      + args.marketProbability * (1 - MLB_PITCHER_OUTS_UNDER_SHADOW_MODEL_WEIGHT),
  );
  const candidateEdge = round(candidateFinalProbability - args.marketProbability);
  const candidateExpectedValue = round(expected_value(candidateFinalProbability, args.americanOdds));
  const currentActionable = isActionablePropGrade(args.playGrade);
  const candidateMathQualified =
    candidateEdge >= DEFAULT_PROP_RECOMMENDATION_CONFIG.minEdge
    && candidateExpectedValue >= DEFAULT_PROP_RECOMMENDATION_CONFIG.minEv;
  return {
    releaseId: MLB_PITCHER_OUTS_UNDER_CALIBRATION_SHADOW_RELEASE_ID,
    status: "shadow_only" as const,
    evidenceSource: "historical_opening_replay_plus_immutable_t60_tracking",
    modelWeight: MLB_PITCHER_OUTS_UNDER_SHADOW_MODEL_WEIGHT,
    currentFinalProbability: round(args.finalProbability),
    candidateFinalProbability,
    currentActionable,
    candidateMathQualified,
    candidateActionable: currentActionable && candidateMathQualified,
    candidateEdge,
    candidateExpectedValue,
    publicBehaviorChanged: false,
  };
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
