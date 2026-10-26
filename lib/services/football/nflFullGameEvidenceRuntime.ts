import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import {
  applyNflFullGameSemanticGradePolicy,
  arbitrateNflFullGameEvidence,
  type NflFullGameEvidenceArbitration,
} from "./nflFullGameEvidenceArbiter";
import {
  buildNflFullGameEvidenceLedger,
  type NflFullGameEvidenceLedger,
} from "./nflFullGameEvidenceLedger";
import type { NflForwardPlaybookSplitSet } from "./nflForwardEvidence";
import type { NflMarketState } from "./nflMarketState";
import type { NflR6ShadowMoneylineDecision } from "./nflR6MoneylineShadow";
import type { NflRegularSharpSplitSet } from "./sharpApiNflSplits";
import {
  buildNflV1ActionableGradeBundle,
  type NflV1ActionableGradeBundle,
} from "./nflV1ActionableGradeCandidate";
import {
  buildNflIndependentScoreBaseForecast,
  type NflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";

export const NFL_FULL_GAME_EVIDENCE_RUNTIME_RELEASE =
  "nfl_full_game_evidence_runtime_2026_10_26_r1_complete_signal_interpretation" as const;

type Market = "moneyline" | "spread" | "total";

export function applyNflFullGameEvidenceRuntime(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
  evaluatedAt: string;
  releasedForecast: NflV1WeekOneOutcomeForecast;
  baselineProduction: NflV1ActionableGradeBundle;
  current: NflPreviewBookOdds;
  comparableCurrentBooks: NflPreviewBookOdds[];
  shadowMoneyline: NflR6ShadowMoneylineDecision;
  targetExcludedMarket: Parameters<typeof buildNflFullGameEvidenceLedger>[0]["targetExcludedMarket"];
  states: Record<Market, NflMarketState>;
  excludedFamiliesByMarket: Record<Market, string[]>;
  playbookSplits: NflForwardPlaybookSplitSet | null;
  sharpSplits: NflRegularSharpSplitSet | null;
  forecastCandidates: Parameters<typeof buildNflFullGameEvidenceLedger>[0]["forecastCandidates"];
  availability: Parameters<typeof buildNflFullGameEvidenceLedger>[0]["availability"];
  /** Existing stored locks are render-only and may never enter candidate publication. */
  existingLockedRecord?: boolean;
}): {
  release: typeof NFL_FULL_GAME_EVIDENCE_RUNTIME_RELEASE;
  outcome: NflV1WeekOneOutcomeForecast;
  production: NflV1ActionableGradeBundle;
  ledger: NflFullGameEvidenceLedger;
  arbitration: NflFullGameEvidenceArbitration;
} {
  const ledger = buildNflFullGameEvidenceLedger({
    evaluatedAt: args.evaluatedAt,
    finalForecast: args.releasedForecast,
    currentSpreadBoundary: args.current.spread ? -args.current.spread.homeLine : null,
    currentTotalLine: args.current.total?.line ?? null,
    targetExcludedMarket: args.targetExcludedMarket,
    states: args.states,
    excludedFamiliesByMarket: args.excludedFamiliesByMarket,
    playbookSplits: args.playbookSplits,
    sharpSplits: args.sharpSplits,
    forecastCandidates: args.forecastCandidates,
    availability: args.availability,
  });
  const arbitration = arbitrateNflFullGameEvidence({
    releasedForecast: args.releasedForecast,
    ledger,
  });
  if (args.existingLockedRecord === true || arbitration.status !== "applied") {
    return {
      release: NFL_FULL_GAME_EVIDENCE_RUNTIME_RELEASE,
      outcome: args.releasedForecast,
      production: args.baselineProduction,
      ledger,
      arbitration,
    };
  }
  const coherent = buildNflIndependentScoreBaseForecast({
    baseForecast: args.releasedForecast,
    independentScore: {
      expectedHomeMargin: arbitration.finalHomeMargin,
      expectedTotal: arbitration.finalTotal,
      marketInputPolicy: "prohibited_from_independent_score",
    },
  });
  const outcome: NflV1WeekOneOutcomeForecast = {
    ...args.releasedForecast,
    ...coherent,
    marketEvidence: args.releasedForecast.marketEvidence,
    targetExclusion: args.releasedForecast.targetExclusion,
    noWeightMarketReader: args.releasedForecast.noWeightMarketReader,
  };
  const candidateProduction = buildNflV1ActionableGradeBundle({
    providerGameId: args.providerGameId,
    awayTeam: args.awayTeam,
    homeTeam: args.homeTeam,
    gameStartsAt: args.gameStartsAt,
    current: args.current,
    comparableCurrentBooks: args.comparableCurrentBooks,
    shadowMoneyline: args.shadowMoneyline,
    outcomeForecast: outcome,
  });
  return {
    release: NFL_FULL_GAME_EVIDENCE_RUNTIME_RELEASE,
    outcome,
    production: applyNflFullGameSemanticGradePolicy({
      baseline: args.baselineProduction,
      candidate: candidateProduction,
      arbitration,
    }),
    ledger,
    arbitration,
  };
}
