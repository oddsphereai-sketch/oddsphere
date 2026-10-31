import type { DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { EplShadowSlate } from "./buildEplShadowSlate";

export type EplPublicationCoverage = {
  activeFixtures: number;
  selectedCurrent: number;
  selectedExpected: number;
  outcomeCurrent: number;
  outcomeExpected: number;
  heldMarkets: number;
  errors: string[];
  warnings: string[];
};

/**
 * Current-price publication gates apply only to scheduled pregame fixtures.
 * An explicitly held missing quote must not freeze other fresh markets.
 * Sportsbooks remove prices once a match starts; requiring live rows blocks
 * coherent upcoming matches and eventually expires the weekly snapshot.
 * Locked/live cards are preserved by the member snapshot writer and never
 * reconstructed from a newly relaxed price requirement.
 */
export function evaluateEplPublicationCoverage(
  slate: Pick<EplShadowSlate, "matches">,
  response: Pick<DailyEdgeResponse, "games">,
): EplPublicationCoverage {
  const activeProviderIds = new Set(
    slate.matches.filter((match) => match.status === "scheduled").map((match) => String(match.id)),
  );
  const activeGames = response.games.filter((game) => activeProviderIds.has(String(game.external_id)));
  const marketRows = activeGames.flatMap((game): MarketEdgeDto[] => [
    game.markets.moneyline,
    game.soccerDoubleChanceMarket,
    game.markets.total,
    game.markets.first_inning,
  ].filter((market): market is MarketEdgeDto => market !== null && market !== undefined));
  const selectedCurrent = marketRows.filter((market) => market.currentPriceAmerican != null).length;
  const outcomeCurrent = marketRows.reduce(
    (sum, market) => sum + (market.soccerPriceBoard?.rows.length ?? 0),
    0,
  );
  const selectedExpected = activeGames.length * 4;
  const outcomeExpected = activeGames.length * 10;
  const heldMarkets = marketRows.filter((market) => market.currentPriceAmerican == null).length;
  const unpricedWithoutHold = marketRows.filter((market) => market.currentPriceAmerican == null
    && (!market.held || market.verdict?.key !== "no_play")).length;
  const incompletePricedVectors = activeGames.reduce((count, game) => count + [
    [game.markets.moneyline, 3], [game.soccerDoubleChanceMarket, 3],
    [game.markets.total, 2], [game.markets.first_inning, 2],
  ].filter(([market, expected]) => {
    const row = market as MarketEdgeDto | null | undefined;
    return row?.currentPriceAmerican != null && row.soccerPriceBoard?.rows.length !== expected;
  }).length, 0);
  const errors = [
    ...(activeGames.length === activeProviderIds.size ? [] : [`fixture/model coverage ${activeGames.length}/${activeProviderIds.size}`]),
    ...(marketRows.length === selectedExpected ? [] : [`market prediction coverage ${marketRows.length}/${selectedExpected}`]),
    ...(unpricedWithoutHold === 0 ? [] : [`${unpricedWithoutHold} unpriced market(s) lack an explicit evidence hold`]),
    ...(incompletePricedVectors === 0 ? [] : [`${incompletePricedVectors} priced market(s) have incomplete outcome vectors`]),
    ...(activeGames.length === 0 || selectedCurrent > 0 ? [] : ["current-price coverage collapsed to zero; preserving last-known-good member snapshot"]),
  ];
  const warnings = [
    ...(selectedCurrent === selectedExpected ? [] : [`selected current-price coverage ${selectedCurrent}/${selectedExpected}; missing markets held`]),
    ...(outcomeCurrent === outcomeExpected ? [] : [`outcome price-board coverage ${outcomeCurrent}/${outcomeExpected}; missing outcomes held`]),
  ];
  return {
    activeFixtures: activeGames.length,
    selectedCurrent,
    selectedExpected,
    outcomeCurrent,
    outcomeExpected,
    heldMarkets,
    errors,
    warnings,
  };
}
