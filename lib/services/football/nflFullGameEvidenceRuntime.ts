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
import { NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE } from "./nflTargetExcludedMarketOutcome";
import {
  buildNflV1ActionableGradeBundle,
  type NflV1ActionableGradeBundle,
} from "./nflV1ActionableGradeCandidate";
import {
  buildNflUnifiedMarketAdjustedForecast,
  type NflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";

export const NFL_FULL_GAME_EVIDENCE_RUNTIME_RELEASE =
  "nfl_full_game_evidence_runtime_2026_11_01_r13_relative_market_innovations" as const;

type Market = "moneyline" | "spread" | "total";

/** The selected quote owns each market's contract, even when the representative book differs. */
export function deriveNflEvaluatedMarketContract(args: {
  baselineProduction: {
    evaluatedBets: ReadonlyArray<Pick<NflV1ActionableGradeBundle["evaluatedBets"][number],
      "market" | "side" | "evaluatedQuote">>;
  };
  homeTeam: string;
}): { spread: { homeLine: number } | null; total: { line: number } | null } {
  const spread = args.baselineProduction.evaluatedBets?.find((bet) => bet.market === "spread");
  const total = args.baselineProduction.evaluatedBets?.find((bet) => bet.market === "total");
  const spreadLine = spread?.evaluatedQuote.line;
  const totalLine = total?.evaluatedQuote.line;
  return {
    spread: typeof spreadLine === "number" && Number.isFinite(spreadLine)
      ? { homeLine: spread!.side === args.homeTeam ? spreadLine : -spreadLine }
      : null,
    total: typeof totalLine === "number" && Number.isFinite(totalLine) && totalLine > 0
      ? { line: totalLine }
      : null,
  };
}

export function applyNflFullGameEvidenceRuntime(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
  evaluatedAt: string;
  releasedForecast: NflV1WeekOneOutcomeForecast;
  baselineProduction: NflV1ActionableGradeBundle;
  /** Contract currently being tested for target-free score authority. */
  evaluatedProduction?: NflV1ActionableGradeBundle;
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
  const evaluatedContract = deriveNflEvaluatedMarketContract({
    baselineProduction: args.evaluatedProduction ?? args.baselineProduction, homeTeam: args.homeTeam,
  });
  const ledger = buildNflFullGameEvidenceLedger({
    evaluatedAt: args.evaluatedAt,
    finalForecast: args.releasedForecast,
    currentSpreadBoundary: evaluatedContract.spread ? -evaluatedContract.spread.homeLine : null,
    currentTotalLine: evaluatedContract.total?.line ?? null,
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
  const coherent = buildNflUnifiedMarketAdjustedForecast({
    baseForecast: args.releasedForecast,
    expectedHomeMargin: arbitration.finalHomeMargin,
    expectedTotal: arbitration.finalTotal,
    marketInputPolicy: "target_excluded_continuous_residual",
    preserveUnchangedAxes: true,
  });
  const outcome: NflV1WeekOneOutcomeForecast = {
    ...args.releasedForecast,
    ...coherent,
    marketEvidence: args.releasedForecast.marketEvidence,
    targetExclusion: args.targetExcludedMarket ? {
      release: NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE,
      status: "target_excluded_market", reason: "stable_complete_tuple",
      marginFamilyCount: args.targetExcludedMarket.marginFamilyCount,
      moneylineFamilyCount: args.targetExcludedMarket.moneylineFamilyCount,
      availableMarkets: args.targetExcludedMarket.availableMarkets,
      totalFamilyCount: args.targetExcludedMarket.totalFamilyCount,
      marginExcludedSportsbooks: [...args.excludedFamiliesByMarket.moneyline],
      totalExcludedSportsbooks: [...args.excludedFamiliesByMarket.total],
    } : args.releasedForecast.targetExclusion,
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

/** Rebuild evidence from the original forecast until the final evaluated targets own that evidence. */
export type NflFullGameTargetResolution = {
  status: "stable" | "cycle" | "unavailable" | "iteration_limit";
  iterations: number;
};

export function stabilizeNflFullGameEvidenceTargets<T extends ReturnType<typeof applyNflFullGameEvidenceRuntime>>(args: {
  baselineProduction: NflV1ActionableGradeBundle;
  releasedForecast: NflV1WeekOneOutcomeForecast;
  homeTeam: string;
  build: (evaluatedProduction: NflV1ActionableGradeBundle) => T;
}): T & { targetResolution: NflFullGameTargetResolution } {
  const signature = (production: NflV1ActionableGradeBundle) => {
    const contract = deriveNflEvaluatedMarketContract({ baselineProduction: production, homeTeam: args.homeTeam });
    return JSON.stringify((["moneyline", "spread", "total"] as const).map((market) => {
      const bet = production.evaluatedBets.find((row) => row.market === market);
      return [market, bet?.evaluatedQuote.sportsbook.toLowerCase().replace(/[^a-z0-9]/g, "") ?? null,
        market === "spread" ? contract.spread?.homeLine ?? null
          : market === "total" ? contract.total?.line ?? null : null];
    }));
  };
  let targets = args.baselineProduction;
  let first: T | undefined;
  const seen = new Set<string>();
  const hold = (status: "cycle" | "unavailable" | "iteration_limit", iterations: number) => {
    const base = first!;
    const margin = args.releasedForecast.expectedHomeScore - args.releasedForecast.expectedAwayScore;
    const total = args.releasedForecast.expectedHomeScore + args.releasedForecast.expectedAwayScore;
    return { ...base, outcome: args.releasedForecast, production: args.baselineProduction,
      arbitration: { ...base.arbitration, status: "neutral" as const,
        reason: "coherent_evidence_without_score_authority" as const,
        sideStory: "conflicted_market_story" as const, totalStory: "conflicted_market_story" as const,
        sideDirection: 0 as const, totalDirection: 0 as const,
        finalHomeMargin: margin, finalTotal: total,
        expectedAwayScore: args.releasedForecast.expectedAwayScore,
        expectedHomeScore: args.releasedForecast.expectedHomeScore,
        marketResolutions: undefined,
      }, targetResolution: { status, iterations } };
  };
  for (let iteration = 0; iteration < 12; iteration++) {
    const key = signature(targets);
    if (seen.has(key)) return hold("cycle", iteration);
    seen.add(key);
    const candidate = args.build(targets);
    first ??= candidate;
    if (candidate.arbitration.status === "unavailable" || candidate.production.evaluatedBets.length !== 3) {
      return hold("unavailable", iteration + 1);
    }
    if (signature(candidate.production) === key) {
      return { ...candidate, targetResolution: { status: "stable", iterations: iteration + 1 } };
    }
    targets = candidate.production;
  }
  return hold("iteration_limit", 12);
}
