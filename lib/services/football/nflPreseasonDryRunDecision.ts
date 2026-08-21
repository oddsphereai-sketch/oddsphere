import { americanToImpliedProbability } from "./footballMarketMath";

/**
 * Local-only decision release for rehearsing the regular-season sharp brain
 * on a preseason slate. It can publish dry-run Leans in the local product,
 * but the football tracking policy permanently excludes every preseason row.
 */
export const NFL_PRESEASON_DRY_RUN_DECISION_RELEASE =
  "nfl_regular_pipeline_preseason_dry_run_decision_2026_08_20_r3" as const;

export const NFL_PRESEASON_DRY_RUN_MAX_WEEKLY_ACTIONS = 5;
export const NFL_PRESEASON_DRY_RUN_MIN_EV_PCT = 2;

const PHASE_AGREEMENT_WEIGHT = 0.35;
const MAX_MODEL_DISAGREEMENT_PP = 14;

export type NflPreseasonDryRunMarket = "moneyline" | "spread" | "total";

export type NflPreseasonDryRunDecision = {
  decisionProbability: number;
  exactEvPct: number;
  probabilityGapPp: number;
  eligibleForWeeklyAction: boolean;
  verdict: "watchlist" | "no_play";
  recommendationScore: number;
  reasons: string[];
};

export function deriveNflPreseasonDryRunDecision(input: {
  market: NflPreseasonDryRunMarket;
  coreModelProbability: number;
  phaseComparisonProbability: number;
  marketFairProbability: number;
  priceAmerican: number;
  verifiedPriceObservations: number;
  availabilitySnapshotPresent: boolean;
}): NflPreseasonDryRunDecision {
  const values = [
    input.coreModelProbability,
    input.phaseComparisonProbability,
    input.marketFairProbability,
  ];
  if (
    values.some((value) => !Number.isFinite(value) || value <= 0 || value >= 1) ||
    !Number.isFinite(input.priceAmerican) ||
    input.priceAmerican === 0
  ) {
    return noPlay(input.marketFairProbability, "A complete probability and exact two-sided price are required.");
  }

  const modelsAgreeWithPrice =
    input.coreModelProbability > input.marketFairProbability &&
    input.phaseComparisonProbability > input.marketFairProbability;
  const disagreementPp = Math.abs(
    input.coreModelProbability - input.phaseComparisonProbability,
  ) * 100;
  const conservativeModelProbability = Math.min(
    input.coreModelProbability,
    input.phaseComparisonProbability,
  );
  const decisionProbability = clampProbability(
    input.marketFairProbability +
      PHASE_AGREEMENT_WEIGHT *
        (conservativeModelProbability - input.marketFairProbability),
  );
  const exactEvPct = round1(expectedValuePerUnit(
    decisionProbability,
    input.priceAmerican,
  ) * 100);
  const probabilityGapPp = round1(
    (decisionProbability - input.marketFairProbability) * 100,
  );

  const reasons: string[] = [];
  if (!modelsAgreeWithPrice) reasons.push("The regular core and preseason comparison do not both support this priced side.");
  if (disagreementPp > MAX_MODEL_DISAGREEMENT_PP) reasons.push("The two model views are too far apart for a dry-run action.");
  if (input.verifiedPriceObservations < 2) reasons.push("Fewer than two verified same-book price observations are stored.");
  if (!input.availabilitySnapshotPresent) reasons.push("The provider availability snapshot is missing.");
  if (exactEvPct < NFL_PRESEASON_DRY_RUN_MIN_EV_PCT) reasons.push("Risk-adjusted expected value is below the dry-run Lean floor.");

  const eligibleForWeeklyAction =
    modelsAgreeWithPrice &&
    disagreementPp <= MAX_MODEL_DISAGREEMENT_PP &&
    input.verifiedPriceObservations >= 2 &&
    input.availabilitySnapshotPresent &&
    exactEvPct >= NFL_PRESEASON_DRY_RUN_MIN_EV_PCT;

  if (!modelsAgreeWithPrice || exactEvPct <= 0) {
    return {
      decisionProbability,
      exactEvPct,
      probabilityGapPp,
      eligibleForWeeklyAction: false,
      verdict: "no_play",
      recommendationScore: 0,
      reasons,
    };
  }

  return {
    decisionProbability,
    exactEvPct,
    probabilityGapPp,
    eligibleForWeeklyAction,
    verdict: "watchlist",
    recommendationScore: eligibleForWeeklyAction
      ? Math.round(Math.min(52, 42 + exactEvPct))
      : 34,
    reasons: reasons.length > 0
      ? reasons
      : ["Both model views support the priced side after conservative preseason risk adjustment."],
  };
}

export function selectNflPreseasonDryRunActions(rows: Array<{
  gameId: string;
  market: NflPreseasonDryRunMarket;
  exactEvPct: number;
  eligible: boolean;
}>): Set<string> {
  const selected = new Set<string>();
  const selectedGames = new Set<string>();
  const candidates = rows
    .filter((row) => row.eligible && row.exactEvPct >= NFL_PRESEASON_DRY_RUN_MIN_EV_PCT)
    .sort((first, second) =>
      second.exactEvPct - first.exactEvPct ||
      first.gameId.localeCompare(second.gameId) ||
      first.market.localeCompare(second.market),
    );

  for (const row of candidates) {
    if (selected.size >= NFL_PRESEASON_DRY_RUN_MAX_WEEKLY_ACTIONS) break;
    if (selectedGames.has(row.gameId)) continue;
    selected.add(`${row.gameId}:${row.market}`);
    selectedGames.add(row.gameId);
  }
  return selected;
}

function noPlay(marketFairProbability: number, reason: string): NflPreseasonDryRunDecision {
  const probability = Number.isFinite(marketFairProbability)
    ? clampProbability(marketFairProbability)
    : 0.5;
  return {
    decisionProbability: probability,
    exactEvPct: 0,
    probabilityGapPp: 0,
    eligibleForWeeklyAction: false,
    verdict: "no_play",
    recommendationScore: 0,
    reasons: [reason],
  };
}

function expectedValuePerUnit(probability: number, priceAmerican: number): number {
  const profit = priceAmerican > 0
    ? priceAmerican / 100
    : 100 / Math.abs(priceAmerican);
  return probability * profit - (1 - probability);
}

function clampProbability(value: number): number {
  return Math.min(0.99, Math.max(0.01, value));
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}

export const __NFL_PRESEASON_DRY_RUN_DECISION_TEST__ = {
  expectedValuePerUnit,
  rawBreakEvenProbability: americanToImpliedProbability,
};
