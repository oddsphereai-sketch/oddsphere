import type {
  DailyEdgeGameDto,
  DailyEdgeResponse,
  MarketEdgeDto,
} from "@/app/lab/lib/labTypes";

const CFB_MARKET_KEYS = ["moneyline", "total", "first_inning"] as const;

/**
 * The weekly CFB snapshot retains the complete reader evidence for every game.
 * The slate board needs only the released outcome, grade, price and score
 * fields. Defer large evidence panels for unopened games; the exact stored
 * game DTO is fetched when its reader is opened.
 */
function projectCfbMarketForBoard(market: MarketEdgeDto): MarketEdgeDto {
  return {
    ...market,
    capReasons: [],
    displayReason: null,
    evidenceCoherence: undefined,
    guidedGuide: "",
    guidedWatchOut: "",
    keyStats: [],
    lineTrail: [],
    marketInterpretation: null,
    marketReadV2: null,
    marketPrediction: market.marketPrediction
      ? { ...market.marketPrediction, reason: null }
      : market.marketPrediction,
    oddsTrail: [],
    opposingOddsTrail: null,
    publicSplits: [],
    recommendationDecision: undefined,
    reviewFlags: [],
    riskLine: "",
    sharpBookAvailability: null,
    sportsbookSplits: null,
    whyLine: "",
  };
}

export function projectCfbGameForBoard(game: DailyEdgeGameDto): DailyEdgeGameDto {
  const projected = {
    ...game,
    breakdown: {
      verdict: game.breakdown.verdict,
      sharpRead: { ...game.breakdown.sharpRead, sentence: "" },
      modelBreakdown: null,
    },
    recommendationDecision: undefined,
    sharpSignals: [],
    markets: {
      moneyline: projectCfbMarketForBoard(game.markets.moneyline),
      total: projectCfbMarketForBoard(game.markets.total),
      first_inning: projectCfbMarketForBoard(game.markets.first_inning),
    },
  };
  return projected;
}

export function projectCfbSnapshotForInitialBoard(input: {
  snapshot: DailyEdgeResponse;
  fullReaderGameId: string | null;
}): { snapshot: DailyEdgeResponse; deferredGameIds: string[] } {
  const deferredGameIds: string[] = [];
  const games = input.snapshot.games.map((game) => {
    if (game.id === input.fullReaderGameId) return game;
    deferredGameIds.push(game.id);
    return projectCfbGameForBoard(game);
  });
  return {
    snapshot: { ...input.snapshot, games },
    deferredGameIds,
  };
}

export function cfbBoardProjectionRetainsReleasedMarket(
  original: DailyEdgeGameDto,
  projected: DailyEdgeGameDto,
): boolean {
  return CFB_MARKET_KEYS.every((key) => {
    const before = original.markets[key];
    const after = projected.markets[key];
    return before.pick === after.pick &&
      before.modelProb === after.modelProb &&
      before.marketPrediction?.status === after.marketPrediction?.status &&
      before.marketPrediction?.label === after.marketPrediction?.label &&
      before.marketPrediction?.line === after.marketPrediction?.line &&
      before.marketPrediction?.probability === after.marketPrediction?.probability &&
      before.verdict === after.verdict &&
      before.currentPriceAmerican === after.currentPriceAmerican &&
      before.currentPriceSportsbook === after.currentPriceSportsbook &&
      before.line === after.line;
  });
}
