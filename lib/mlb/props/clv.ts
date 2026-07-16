import { american_to_implied_probability, remove_vig_two_way } from "./oddsMath";
import type { PropOddsSnapshot } from "./providers";

export type ClvComparison =
  | { status: "comparable"; clvAmerican: number; betImpliedProbability: number; closingNoVigProbability: number }
  | { status: "line_moved_not_comparable"; betLine: number; closingLine: number; movementAmerican: number | null }
  | { status: "pending"; reason: "missing_closing_snapshot" }
  | { status: "rejected"; reason: "stale_or_unverified_close" | "side_missing_from_close" };

export function comparePropClv(args: {
  betOdds: PropOddsSnapshot;
  closingSnapshots: PropOddsSnapshot[];
  gameStartTimestamp: string;
  providerVerifiedClose?: boolean;
}): ClvComparison {
  const closeRows = args.closingSnapshots.filter((row) =>
    row.gameId === args.betOdds.gameId &&
    row.playerId === args.betOdds.playerId &&
    row.marketKey === args.betOdds.marketKey &&
    row.snapshotRole === "closing",
  );
  if (closeRows.length === 0) return { status: "pending", reason: "missing_closing_snapshot" };

  const sameSide = closeRows.find((row) => row.side === args.betOdds.side);
  if (!sameSide) return { status: "rejected", reason: "side_missing_from_close" };
  if (new Date(sameSide.asOfTimestamp).getTime() > new Date(args.gameStartTimestamp).getTime() && !args.providerVerifiedClose) {
    return { status: "rejected", reason: "stale_or_unverified_close" };
  }
  if (sameSide.line !== args.betOdds.line) {
    return {
      status: "line_moved_not_comparable",
      betLine: args.betOdds.line,
      closingLine: sameSide.line,
      movementAmerican: args.betOdds.americanOdds - sameSide.americanOdds,
    };
  }

  const closeOpposite = closeRows.find((row) => row.side !== args.betOdds.side && row.line === args.betOdds.line);
  if (!closeOpposite) return { status: "rejected", reason: "side_missing_from_close" };
  const devig = args.betOdds.side === "over"
    ? remove_vig_two_way(sameSide.americanOdds, closeOpposite.americanOdds)
    : remove_vig_two_way(closeOpposite.americanOdds, sameSide.americanOdds);
  return {
    status: "comparable",
    clvAmerican: args.betOdds.americanOdds - sameSide.americanOdds,
    betImpliedProbability: american_to_implied_probability(args.betOdds.americanOdds),
    closingNoVigProbability: args.betOdds.side === "over" ? devig.over : devig.under,
  };
}
