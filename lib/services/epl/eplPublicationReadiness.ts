import type { DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { EplShadowSlate } from "./buildEplShadowSlate";

export type EplPublicationCoverage = {
  activeFixtures: number;
  selectedCurrent: number;
  selectedExpected: number;
  outcomeCurrent: number;
  outcomeExpected: number;
  errors: string[];
};

/**
 * Current-price publication gates apply only to fixtures that can still be
 * wagered. Sportsbooks routinely remove prices after full time; requiring
 * those rows blocks a coherent upcoming match and eventually expires the
 * entire weekly member snapshot.
 */
export function evaluateEplPublicationCoverage(
  slate: Pick<EplShadowSlate, "matches">,
  response: Pick<DailyEdgeResponse, "games">,
): EplPublicationCoverage {
  const activeProviderIds = new Set(
    slate.matches.filter((match) => match.status !== "final").map((match) => String(match.id)),
  );
  const activeGames = response.games.filter((game) => activeProviderIds.has(String(game.external_id)));
  const marketRows = activeGames.flatMap((game): MarketEdgeDto[] => [
    game.markets.moneyline,
    game.soccerDoubleChanceMarket,
    game.markets.total,
    game.markets.first_inning,
  ].filter((market): market is MarketEdgeDto => market !== null && market !== undefined));
  const selectedCurrent = marketRows.filter((market) => market.currentPriceAmerican !== null).length;
  const outcomeCurrent = marketRows.reduce(
    (sum, market) => sum + (market.soccerPriceBoard?.rows.length ?? 0),
    0,
  );
  const selectedExpected = activeGames.length * 4;
  const outcomeExpected = activeGames.length * 10;
  const errors = [
    ...(selectedCurrent === selectedExpected ? [] : [`selected current-price coverage ${selectedCurrent}/${selectedExpected}`]),
    ...(outcomeCurrent === outcomeExpected ? [] : [`outcome price-board coverage ${outcomeCurrent}/${outcomeExpected}`]),
  ];
  return {
    activeFixtures: activeGames.length,
    selectedCurrent,
    selectedExpected,
    outcomeCurrent,
    outcomeExpected,
    errors,
  };
}
