import {
  DEFAULT_PROP_RECOMMENDATION_CONFIG,
  type PropReasonCode,
} from "./config";
import {
  decimal_to_american,
  expected_value,
  remove_vig_two_way,
  recommended_fractional_kelly_stake,
} from "./oddsMath";
import type { PropOddsSnapshot } from "./providers";
import type { PropModelPrediction } from "./models";
import { mapLegacyPropStatusToGrade, type PropGrade } from "./propGrades";
import {
  PROJECTION_SIDE_CONTRADICTION,
  predictionProjectionSideIntegrity,
} from "./projectionSideIntegrity";
import { assessPropPrice } from "./pricePolicy";
import { calibratedPropModelWeight } from "./probabilityCalibration";

export type PropRecommendation = {
  status: "recommended" | "no_play";
  playGrade: PropGrade;
  confidenceTier: "premium" | "strong" | "lean" | "no_play";
  side: "over" | "under";
  line: number;
  sportsbook: string | null;
  americanOdds: number | null;
  modelProbability: number;
  finalProbability: number;
  shrinkageWeight: number;
  fairDecimalOdds: number;
  fairAmericanOdds: number;
  noVigMarketProbability: number | null;
  marketProbability: number | null;
  edge: number | null;
  modelEdge: number | null;
  expectedValue: number | null;
  recommendedUnits: number;
  recommendedBankrollFraction: number;
  reasonCodes: PropReasonCode[];
};

export function recommendPropBet(args: {
  prediction: PropModelPrediction;
  overOdds: PropOddsSnapshot | null;
  underOdds: PropOddsSnapshot | null;
  asOfTimestamp: string;
  mappingConfidence?: number;
  lineupRisk?: boolean;
  injuryRisk?: boolean;
  dataQualityBlocked?: boolean;
  dataConfidence?: number;
  modelVersionActive?: boolean;
  forceNoPlayReasonCodes?: PropReasonCode[];
  /** Undefined preserves legacy callers; null explicitly means no target-excluded alternative. */
  forecastMarketOverProbability?: number | null;
  config?: Partial<typeof DEFAULT_PROP_RECOMMENDATION_CONFIG>;
}): PropRecommendation {
  const config = { ...DEFAULT_PROP_RECOMMENDATION_CONFIG, ...args.config };
  const reasonCodes: PropReasonCode[] = [];
  const evaluatedMarketOverProbability = args.overOdds && args.underOdds
    ? remove_vig_two_way(args.overOdds.americanOdds, args.underOdds.americanOdds).over
    : null;
  const forecastMarketOverProbability = Object.prototype.hasOwnProperty.call(args, "forecastMarketOverProbability")
    ? args.forecastMarketOverProbability ?? null
    : evaluatedMarketOverProbability;
  const independentOverProbability = args.prediction.side === "over"
    ? args.prediction.modelProbability
    : 1 - args.prediction.modelProbability;
  const probabilityAlreadyMarketAnchored =
    args.prediction.explanation.probabilityAlreadyMarketAnchored === true;
  const shrinkageWeight = probabilityAlreadyMarketAnchored
    ? 1
    : calibratedPropModelWeight({
        marketKey: args.prediction.marketKey,
        side: args.prediction.side,
        baseWeight: modelWeightForConfidence(args.dataConfidence ?? 0.8),
      });
  const finalOverProbability = forecastMarketOverProbability === null
    ? independentOverProbability
    : clampProbability(
      independentOverProbability * shrinkageWeight
      + forecastMarketOverProbability * (1 - shrinkageWeight),
    );
  const side = finalOverProbability >= 0.5 ? "over" : "under";
  const modelProbability = side === "over" ? independentOverProbability : 1 - independentOverProbability;
  const finalProbability = side === "over" ? finalOverProbability : 1 - finalOverProbability;
  const selectedOdds = side === "over" ? args.overOdds : args.underOdds;
  const prediction: PropModelPrediction = {
    ...args.prediction,
    side,
    modelProbability,
    fairDecimalOdds: 1 / modelProbability,
    fairAmericanOdds: decimal_to_american(1 / modelProbability),
  };
  const crossedSideHasExactCycle = side === args.prediction.side
    || Boolean(
      args.overOdds
      && args.underOdds
      && args.overOdds.line === args.underOdds.line
      && args.overOdds.line === args.prediction.line
      && args.overOdds.sportsbook === args.underOdds.sportsbook
      && args.overOdds.asOfTimestamp === args.underOdds.asOfTimestamp,
    );
  if (args.modelVersionActive === false) reasonCodes.push("NO_PLAY");
  if ((args.mappingConfidence ?? 1) < config.minMappingConfidence) reasonCodes.push("MAPPING_RISK");
  if (args.lineupRisk) reasonCodes.push("LINEUP_RISK");
  if (args.injuryRisk) reasonCodes.push("INJURY_RISK");
  if (args.dataQualityBlocked) reasonCodes.push("LOW_DATA_CONFIDENCE");
  if (predictionProjectionSideIntegrity(args.prediction).status === "contradiction") {
    reasonCodes.push(PROJECTION_SIDE_CONTRADICTION);
  }
  if (args.forceNoPlayReasonCodes?.length) reasonCodes.push(...args.forceNoPlayReasonCodes);
  if (!crossedSideHasExactCycle) reasonCodes.push("NO_PLAY");
  if (args.overOdds === null || args.underOdds === null) reasonCodes.push("NO_PLAY");
  if (selectedOdds === null) reasonCodes.push("NO_PLAY");
  if (selectedOdds && isStale(selectedOdds.asOfTimestamp, args.asOfTimestamp, config.maxOddsAgeSeconds)) {
    reasonCodes.push("STALE_ODDS");
  }
  if (selectedOdds) {
    const price = assessPropPrice(selectedOdds.americanOdds, {
      signalMinAmericanOdds: config.minSignalAmericanOdds,
      signalMaxAmericanOdds: config.maxSignalAmericanOdds,
    });
    if (price.reasonCode) reasonCodes.push(price.reasonCode);
  }

  const marketProbability = evaluatedMarketOverProbability === null
    ? null
    : side === "over" ? evaluatedMarketOverProbability : 1 - evaluatedMarketOverProbability;

  if (reasonCodes.some((code) => ["NO_PLAY", "MAPPING_RISK", "LINEUP_RISK", "INJURY_RISK", "LOW_DATA_CONFIDENCE", "STALE_ODDS", "NO_VIG_SUM_ANOMALY", "SIDE_ODDS_MISMATCH", "LINE_MISMATCH", "DUPLICATE_VENDOR_LINE", "CONFLICTING_SIDE_RECOMMENDATION", "PROJECTION_SIDE_CONTRADICTION", "UNUSUALLY_HIGH_EV", "STALE_BDL_ODDS", "MISSING_UPDATED_AT", "EXTREME_PRICE_RESEARCH_ONLY", "INVALID_PRICE_FORMAT"].includes(code))) {
    return noPlay(prediction, reasonCodes, { marketProbability, finalProbability, shrinkageWeight });
  }

  const edge = finalProbability - marketProbability!;
  const ev = expected_value(finalProbability, selectedOdds!.americanOdds);
  if (edge < config.minEdge || ev < config.minEv) {
    return noPlay(prediction, ["NO_PLAY"], { marketProbability, finalProbability, shrinkageWeight });
  }

  reasonCodes.push("HIGH_EV", "LINE_VALUE");
  if (edge >= 0.08) reasonCodes.push("MATCHUP_EDGE");
  const stake = recommended_fractional_kelly_stake({
    modelProbability,
    americanOdds: selectedOdds!.americanOdds,
    bankroll: config.bankrollDefault,
    fractionalKelly: config.fractionalKelly,
    maxBankrollFraction: config.maxStakePerPickBankrollFraction,
  });
  const bankrollFraction = config.bankrollDefault > 0 ? stake / config.bankrollDefault : 0;
  const confidenceTier = edge >= 0.08 ? "premium" : edge >= 0.05 ? "strong" : "lean";
  return {
    status: "recommended",
    playGrade: mapLegacyPropStatusToGrade("recommended", { confidenceTier, reasonCodes }),
    confidenceTier,
    side,
    line: prediction.line,
    sportsbook: selectedOdds!.sportsbook,
    americanOdds: selectedOdds!.americanOdds,
    modelProbability,
    finalProbability,
    shrinkageWeight,
    fairDecimalOdds: 1 / finalProbability,
    fairAmericanOdds: decimal_to_american(1 / finalProbability),
    noVigMarketProbability: marketProbability,
    marketProbability,
    edge,
    modelEdge: edge,
    expectedValue: ev,
    recommendedUnits: stake / 10,
    recommendedBankrollFraction: bankrollFraction,
    reasonCodes,
  };
}

function noPlay(
  prediction: PropModelPrediction,
  reasonCodes: PropReasonCode[],
  math: { marketProbability: number | null; finalProbability: number; shrinkageWeight: number } = {
    marketProbability: null,
    finalProbability: prediction.modelProbability,
    shrinkageWeight: 1,
  },
): PropRecommendation {
  return {
    status: "no_play",
    playGrade: mapLegacyPropStatusToGrade("no_play", { reasonCodes }),
    confidenceTier: "no_play",
    side: prediction.side,
    line: prediction.line,
    sportsbook: null,
    americanOdds: null,
    modelProbability: prediction.modelProbability,
    finalProbability: math.finalProbability,
    shrinkageWeight: math.shrinkageWeight,
    fairDecimalOdds: 1 / math.finalProbability,
    fairAmericanOdds: decimal_to_american(1 / math.finalProbability),
    noVigMarketProbability: math.marketProbability,
    marketProbability: math.marketProbability,
    edge: math.marketProbability === null ? null : math.finalProbability - math.marketProbability,
    modelEdge: math.marketProbability === null ? null : math.finalProbability - math.marketProbability,
    expectedValue: null,
    recommendedUnits: 0,
    recommendedBankrollFraction: 0,
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["NO_PLAY"],
  };
}

function modelWeightForConfidence(confidence: number): number {
  if (confidence >= 0.9) return 0.72;
  if (confidence >= 0.75) return 0.5;
  return 0.25;
}

function clampProbability(value: number): number {
  return Math.min(0.95, Math.max(0.05, value));
}

function isStale(oddsTimestamp: string, asOfTimestamp: string, maxAgeSeconds: number): boolean {
  return (new Date(asOfTimestamp).getTime() - new Date(oddsTimestamp).getTime()) / 1000 > maxAgeSeconds;
}
