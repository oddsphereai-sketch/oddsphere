import artifactJson from "./modelArtifacts/nflUnifiedTotalMarketInterpreter.json";
import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import type { NflForwardPlaybookLine, NflForwardPlaybookSplitSet } from "./nflForwardEvidence";
import type { NflForwardContextMarket } from "./nflForwardEvidenceCapture";
import { buildNflMarketState } from "./nflMarketState";
import type { NflRegularSharpSplitSet } from "./sharpApiNflSplits";
import {
  buildNflUnifiedMarketAdjustedForecast,
  type NflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";

export const NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_RELEASE =
  "nfl_unified_total_market_interpreter_2026_10_25_r1" as const;
export const NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_ARTIFACT_RELEASE =
  "nfl_unified_total_market_interpreter_artifact_2026_10_25_r1" as const;

type Snapshot = {
  capturedAt: string;
  markets: Record<"moneyline" | "spread" | "total", Pick<NflForwardContextMarket, "families">>;
};

type Artifact = {
  artifactRelease: typeof NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_ARTIFACT_RELEASE;
  modelRelease: typeof NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_RELEASE;
  tournamentRelease: string;
  trainingRows: number;
  confirmationRows: number;
  ridgeAlpha: number;
  featureNames: string[];
  means: number[];
  scales: number[];
  coefficients: number[];
};

const artifact = artifactJson as Artifact;
validateArtifact(artifact);

export type NflUnifiedTotalMarketInterpretation = {
  release: typeof NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_RELEASE;
  artifactRelease: typeof NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_ARTIFACT_RELEASE;
  status: "applied" | "unavailable";
  reason: "qualified_t60_support" | "outside_frozen_t60_support";
  evidencePolicy: "target_excluded_continuous_residual";
  independentTotal: number;
  marketTotal: number;
  finalTotal: number;
  correctionPoints: number;
  featureValues: Record<string, number>;
  excludedFamilies: string[];
};

export function applyNflUnifiedTotalMarketInterpreter(args: {
  forecast: NflV1WeekOneOutcomeForecast;
  independentForecast: NflV1WeekOneOutcomeForecast;
  evaluatedAt: string;
  gameStartsAt: string;
  snapshots: Snapshot[];
  current: NflPreviewBookOdds;
  playbookLine: NflForwardPlaybookLine | null;
  playbookSplits: NflForwardPlaybookSplitSet | null;
  sharpSplits: NflRegularSharpSplitSet | null;
  excludedFamilies: Iterable<string>;
  targetExcludedAnchor: {
    total: number;
    totalOverFairProbability: number;
    totalFamilyCount: number;
  };
}): NflV1WeekOneOutcomeForecast {
  const independentTotal = args.independentForecast.expectedHomeScore + args.independentForecast.expectedAwayScore;
  const excludedFamilies = [...new Set([...args.excludedFamilies].map(normalizeBook).filter(Boolean))].sort();
  const hoursToStart = (Date.parse(args.gameStartsAt) - Date.parse(args.evaluatedAt)) / 3_600_000;
  if (!Number.isFinite(hoursToStart) || hoursToStart < 0.8 || hoursToStart > 1) {
    return {
      ...args.forecast,
      unifiedTotalMarketInterpreter: {
        release: NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_RELEASE,
        artifactRelease: NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_ARTIFACT_RELEASE,
        status: "unavailable",
        reason: "outside_frozen_t60_support",
        evidencePolicy: "target_excluded_continuous_residual",
        independentTotal,
        marketTotal: args.targetExcludedAnchor.total,
        finalTotal: args.forecast.expectedHomeScore + args.forecast.expectedAwayScore,
        correctionPoints: 0,
        featureValues: { hours_to_start: hoursToStart },
        excludedFamilies,
      },
    };
  }
  const totalState = buildNflMarketState({
    market: "total",
    evaluatedAt: args.evaluatedAt,
    snapshots: args.snapshots,
    excludedFamilies,
    current: args.current,
    playbookLine: args.playbookLine,
    playbookSplits: args.playbookSplits,
    sharpSplits: args.sharpSplits,
  });
  const named = totalState.trails.filter((trail) => trail.sourceClass === "named");
  const retail = totalState.trails.filter((trail) => trail.sourceClass === "retail");
  const statePersistence = mean(totalState.trails.map((trail) => trail.persistenceTimeShare));
  const stateReversal = mean(totalState.trails.map((trail) => trail.reversalMagnitude));
  const stateBuybackShare = totalState.trails.length === 0
    ? 0
    : totalState.trails.filter((trail) => trail.buybackToOpening).length / totalState.trails.length;
  const playbookGap = splitGap(args.playbookSplits?.total ?? null);
  const sharpGap = splitGap(args.sharpSplits?.total ?? null);
  const marketTotalGap = args.targetExcludedAnchor.total - independentTotal;
  const featureValues: Record<string, number> = {
    market_total_gap: marketTotalGap,
    total_fair_over_centered: args.targetExcludedAnchor.totalOverFairProbability - 0.5,
    total_family_count: args.targetExcludedAnchor.totalFamilyCount,
    total_named_number_move: mean(named.map((trail) => trail.numberDelta ?? 0)),
    total_retail_number_move: mean(retail.map((trail) => trail.numberDelta ?? 0)),
    total_persistence: statePersistence,
    total_reversal: stateReversal,
    total_buyback_share: stateBuybackShare,
    playbook_total_gap: playbookGap,
    sharp_total_gap: sharpGap,
    total_signal_agreement: signalAgreement([
      marketTotalGap,
      mean(named.map((trail) => trail.numberDelta ?? 0)),
      playbookGap,
      sharpGap,
    ]),
    hours_to_start: hoursToStart,
  };
  const correctionPoints = artifact.coefficients[0]! + artifact.featureNames.reduce((sum, name, index) =>
    sum + artifact.coefficients[index + 1]! *
      ((featureValues[name] ?? 0) - artifact.means[index]!) / artifact.scales[index]!, 0);
  const finalTotal = independentTotal + correctionPoints;
  const homeMargin = args.forecast.expectedHomeScore - args.forecast.expectedAwayScore;
  const adjusted = buildNflUnifiedMarketAdjustedForecast({
    baseForecast: args.forecast,
    expectedHomeMargin: homeMargin,
    expectedTotal: finalTotal,
    marketInputPolicy: "target_excluded_continuous_residual",
  });
  const unifiedTotalMarketInterpreter: NflUnifiedTotalMarketInterpretation = {
    release: NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_RELEASE,
    artifactRelease: NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_ARTIFACT_RELEASE,
    status: "applied",
    reason: "qualified_t60_support",
    evidencePolicy: "target_excluded_continuous_residual",
    independentTotal,
    marketTotal: args.targetExcludedAnchor.total,
    finalTotal,
    correctionPoints,
    featureValues,
    excludedFamilies,
  };
  return {
    ...args.forecast,
    ...adjusted,
    marketEvidence: args.forecast.marketEvidence,
    targetExclusion: args.forecast.targetExclusion,
    noWeightMarketReader: args.forecast.noWeightMarketReader,
    threeStateMarketReader: args.forecast.threeStateMarketReader,
    unifiedTotalMarketInterpreter,
  };
}

function splitGap(split: {
  overMoneyPct: number | null;
  overBetsPct: number | null;
} | null): number {
  return typeof split?.overMoneyPct === "number" && typeof split.overBetsPct === "number"
    ? (split.overMoneyPct - split.overBetsPct) / 100
    : 0;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function signalAgreement(values: readonly number[]): number {
  const directions = values.map((value) => Math.sign(value)).filter((value) => value !== 0);
  return directions.length === 0 ? 0 : Math.abs(directions.reduce((sum, value) => sum + value, 0)) / directions.length;
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function validateArtifact(value: Artifact): void {
  if (value.artifactRelease !== NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_ARTIFACT_RELEASE ||
      value.modelRelease !== NFL_UNIFIED_TOTAL_MARKET_INTERPRETER_RELEASE ||
      value.featureNames.length === 0 || value.featureNames.length !== value.means.length ||
      value.featureNames.length !== value.scales.length ||
      value.coefficients.length !== value.featureNames.length + 1 ||
      value.scales.some((scale) => !Number.isFinite(scale) || scale <= 0) ||
      value.coefficients.some((coefficient) => !Number.isFinite(coefficient))) {
    throw new Error("NFL unified Total market-interpreter artifact is invalid.");
  }
}
