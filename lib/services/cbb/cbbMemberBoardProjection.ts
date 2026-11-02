import type { DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";

function boardMarket(market: MarketEdgeDto): MarketEdgeDto {
  return { ...market, keyStats: [], oddsTrail: [], lineTrail: [], opposingOddsTrail: null,
    publicSplits: [], sportsbookSplits: null, marketReadV2: null, marketInterpretation: null };
}

/** Unopened cards need their exact published decisions, not every chart point.
 * The existing detail endpoint supplies the complete immutable reader payload. */
export function projectCbbSnapshotForInitialBoard(input: {
  snapshot: DailyEdgeResponse; fullReaderGameId: string | null;
}): { snapshot: DailyEdgeResponse; deferredGameIds: string[] } {
  const deferredGameIds: string[] = [];
  const games = input.snapshot.games.map(game => {
    if (game.id === input.fullReaderGameId) return game;
    deferredGameIds.push(game.id);
    return { ...game, markets: { moneyline: boardMarket(game.markets.moneyline),
      total: boardMarket(game.markets.total), first_inning: boardMarket(game.markets.first_inning) } };
  });
  return {snapshot: {...input.snapshot, games}, deferredGameIds};
}
