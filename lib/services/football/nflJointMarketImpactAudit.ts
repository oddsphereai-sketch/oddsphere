import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import {
  mergeNflJointEpisodeIntoUntouchedAxes,
  readNflJointMarketEpisodesByBook,
  reconcileNflNamedBookEpisodeReads,
} from "./nflJointMarketEpisodeRead";
import type { NflR6ShadowMoneylineDecision } from "./nflR6MoneylineShadow";
import {
  buildNflV1ActionableGradeBundle,
  type NflV1ActionableGradeBundle,
} from "./nflV1ActionableGradeCandidate";
import type { NflV1WeekOneOutcomeForecast } from "./nflV1WeekOneOutcome";

type Market = "moneyline" | "spread" | "total";

export type NflJointMarketImpactAuditRow = {
  providerGameId: string;
  matchup: string;
  incumbent: Array<{ market: string; side: string | null; grade: string }>;
  proposed: Array<{ market: string; side: string | null; grade: string }>;
  margin: string;
  total: string;
  sourceConflict: boolean;
  targetStable: boolean;
  marketContexts: Record<Market, {
    namedDirection: -1 | 1 | null;
    resistance: string | null;
    followerSources: string[];
  }>;
  pairedPriceScore: { margin: number | null; total: number | null };
  pipeline: {
    independentMargin: number;
    upstreamMargin: number;
    finalMargin: number;
    independentTotal: number;
    upstreamTotal: number;
    finalTotal: number;
    targetExclusionStatus: string;
    arbiterStatus: string;
    arbiterSideStory: string;
    arbiterTotalStory: string;
  };
};

/** No-write, no-publication comparison. Never call this from an apply run. */
export function auditNflJointMarketImpact(args: {
  providerGameId: string;
  awayTeam: string;
  homeTeam: string;
  gameStartsAt: string;
  capturedAt: string;
  statisticalKnowledgeAt: string;
  baseOutcome: NflV1WeekOneOutcomeForecast;
  incumbentOutcome: NflV1WeekOneOutcomeForecast;
  production: NflV1ActionableGradeBundle;
  history: NflPreviewBookOdds[];
  baselineExclusions: Record<Market, string[]>;
  current: NflPreviewBookOdds;
  comparableCurrentBooks: NflPreviewBookOdds[];
  shadowMoneyline: NflR6ShadowMoneylineDecision;
  upstreamOutcome: NflV1WeekOneOutcomeForecast;
  targetExclusionStatus: string;
  arbiterStatus: string;
  arbiterSideStory: string;
  arbiterTotalStory: string;
  marketContexts: NflJointMarketImpactAuditRow["marketContexts"];
  pairedPriceScore: NflJointMarketImpactAuditRow["pairedPriceScore"];
}): NflJointMarketImpactAuditRow {
  const byBook = readNflJointMarketEpisodesByBook({
    statisticalForecast: args.baseOutcome,
    statisticalKnowledgeAt: args.statisticalKnowledgeAt,
    evaluatedAt: args.capturedAt,
    history: args.history,
    excludedFamiliesByMarket: args.baselineExclusions,
  });
  const reconciliation = reconcileNflNamedBookEpisodeReads({
    statisticalForecast: args.baseOutcome, reads: byBook,
  });
  const gapFill = mergeNflJointEpisodeIntoUntouchedAxes({
    independentForecast: args.baseOutcome,
    incumbentForecast: args.incumbentOutcome,
    reconciliation,
  });
  const recalculated = buildNflV1ActionableGradeBundle({
    providerGameId: args.providerGameId,
    awayTeam: args.awayTeam,
    homeTeam: args.homeTeam,
    gameStartsAt: args.gameStartsAt,
    current: args.current,
    comparableCurrentBooks: args.comparableCurrentBooks,
    shadowMoneyline: args.shadowMoneyline,
    outcomeForecast: gapFill.outcome,
  });
  const incumbentByMarket = new Map(args.production.evaluatedBets.map((bet) => [bet.market, bet]));
  const proposed = recalculated.evaluatedBets.map((bet) => {
    const changedAxis = bet.market === "total"
      ? gapFill.total === "episode_applied"
      : gapFill.margin === "episode_applied";
    return changedAxis ? bet : incumbentByMarket.get(bet.market) ?? bet;
  });
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const selected = (market: Market) => normalize(
    proposed.find((bet) => bet.market === market)?.evaluatedQuote.sportsbook ?? "",
  );
  const marginExclusions = [...new Set([selected("moneyline"), selected("spread")].filter(Boolean))];
  const proposedExclusions = {
    moneyline: marginExclusions,
    spread: marginExclusions,
    total: [selected("total")].filter(Boolean),
  };
  return {
    providerGameId: args.providerGameId,
    matchup: `${args.awayTeam}@${args.homeTeam}`,
    incumbent: args.production.evaluatedBets.map((bet) => ({
      market: bet.market, side: bet.side, grade: bet.grade,
    })),
    proposed: proposed.map((bet) => ({ market: bet.market, side: bet.side, grade: bet.grade })),
    margin: gapFill.margin,
    total: gapFill.total,
    sourceConflict: reconciliation.marginReason === "opposed_book_moves" ||
      reconciliation.totalReason === "opposed_book_moves",
    targetStable: JSON.stringify(proposedExclusions) === JSON.stringify(args.baselineExclusions),
    marketContexts: args.marketContexts,
    pairedPriceScore: args.pairedPriceScore,
    pipeline: {
      independentMargin: args.baseOutcome.expectedHomeScore - args.baseOutcome.expectedAwayScore,
      upstreamMargin: args.upstreamOutcome.expectedHomeScore - args.upstreamOutcome.expectedAwayScore,
      finalMargin: args.incumbentOutcome.expectedHomeScore - args.incumbentOutcome.expectedAwayScore,
      independentTotal: args.baseOutcome.expectedHomeScore + args.baseOutcome.expectedAwayScore,
      upstreamTotal: args.upstreamOutcome.expectedHomeScore + args.upstreamOutcome.expectedAwayScore,
      finalTotal: args.incumbentOutcome.expectedHomeScore + args.incumbentOutcome.expectedAwayScore,
      targetExclusionStatus: args.targetExclusionStatus,
      arbiterStatus: args.arbiterStatus,
      arbiterSideStory: args.arbiterSideStory,
      arbiterTotalStory: args.arbiterTotalStory,
    },
  };
}
