import type { FootballMarket, FootballSeasonPhase } from "./footballModelContract";
import type { Verdict } from "@/lib/services/verdictDerivation";

/**
 * Launch contract for the NFL decision layer that sits after projections.
 *
 * The projection model estimates outcomes. The sharp brain decides whether
 * the selected side is worth betting at the locked price, after uncertainty,
 * key numbers, availability, market movement, and source quality are applied.
 * This contract does not manufacture a play. A regular-season card with no
 * qualified action fails the product gate and sends the decision model back
 * to research instead of publishing a zero-action week as acceptable.
 */
export const NFL_SHARP_BRAIN_CONTRACT_RELEASE =
  "nfl_sharp_brain_launch_contract_2026_08_20_r1" as const;

export type NflSharpBrainRow = {
  gameId: string;
  market: FootballMarket;
  verdict: Verdict;
  modelProbability: number | null;
  priceAmerican: number | null;
  positiveExpectedValueAtLockedPrice: boolean | null;
  priceLockedBeforeKickoff: boolean;
  projectionRelease: string | null;
  calibrationRelease: string | null;
  decisionRelease: string | null;
};

export type NflSharpBrainCardAudit = {
  contractRelease: typeof NFL_SHARP_BRAIN_CONTRACT_RELEASE;
  expectedPredictionCount: number;
  predictionCount: number;
  actionableCount: number;
  bestAngleCount: number;
  leanCount: number;
  weeklyActionRequired: boolean;
  completeThreeMarketCard: boolean;
  actionEvidenceComplete: boolean;
  ready: boolean;
  failures: Array<
    | "incomplete_three_market_card"
    | "duplicate_game_market"
    | "action_missing_locked_positive_ev_evidence"
    | "regular_week_has_no_action"
  >;
};

const MARKETS: FootballMarket[] = ["moneyline", "spread", "total"];

export function auditNflSharpBrainCard(input: {
  seasonPhase: FootballSeasonPhase;
  gameIds: string[];
  rows: NflSharpBrainRow[];
}): NflSharpBrainCardAudit {
  const expected = new Set(input.gameIds.flatMap((gameId) => MARKETS.map((market) => `${gameId}:${market}`)));
  const observed = input.rows.map((row) => `${row.gameId}:${row.market}`);
  const observedSet = new Set(observed);
  const duplicateGameMarket = observedSet.size !== observed.length;
  const completeThreeMarketCard =
    !duplicateGameMarket &&
    observedSet.size === expected.size &&
    Array.from(expected).every((key) => observedSet.has(key));
  const actions = input.rows.filter((row) => row.verdict === "lean" || row.verdict === "best_angle");
  const actionEvidenceComplete = actions.every((row) =>
    row.modelProbability !== null &&
    Number.isFinite(row.priceAmerican) &&
    row.positiveExpectedValueAtLockedPrice === true &&
    row.priceLockedBeforeKickoff &&
    Boolean(row.projectionRelease) &&
    Boolean(row.calibrationRelease) &&
    Boolean(row.decisionRelease)
  );
  const weeklyActionRequired = (input.seasonPhase === "regular" || input.seasonPhase === "postseason") && input.gameIds.length > 0;
  const failures: NflSharpBrainCardAudit["failures"] = [];
  if (!completeThreeMarketCard) failures.push("incomplete_three_market_card");
  if (duplicateGameMarket) failures.push("duplicate_game_market");
  if (!actionEvidenceComplete) failures.push("action_missing_locked_positive_ev_evidence");
  if (weeklyActionRequired && actions.length === 0) failures.push("regular_week_has_no_action");
  return {
    contractRelease: NFL_SHARP_BRAIN_CONTRACT_RELEASE,
    expectedPredictionCount: expected.size,
    predictionCount: input.rows.length,
    actionableCount: actions.length,
    bestAngleCount: actions.filter((row) => row.verdict === "best_angle").length,
    leanCount: actions.filter((row) => row.verdict === "lean").length,
    weeklyActionRequired,
    completeThreeMarketCard,
    actionEvidenceComplete,
    ready: failures.length === 0,
    failures,
  };
}
