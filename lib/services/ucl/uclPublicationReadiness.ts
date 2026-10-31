import type { DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { UclSlate } from "./buildUclSlate";

export type UclPublicationCoverage = {
  activeFixtures: number;
  responseFixtures: number;
  selectedCurrent: number;
  selectedExpected: number;
  outcomeCurrent: number;
  outcomeExpected: number;
  heldMarkets: number;
  nonpositiveEvActionables: number;
  priceCollapse: boolean;
  unlockedPriceRegressions: number;
  hardErrors: string[];
  errors: string[];
  warnings: string[];
};

/** UCL can publish a complete model board before every bookmaker market opens.
 * Missing exact quotes remain Held/No Play; they never suppress the underlying
 * prediction or become synthetic actionables. */
export function evaluateUclPublicationCoverage(
  slate: Pick<UclSlate, "matches"> & Partial<Pick<UclSlate, "providerHealth">>,
  response: Pick<DailyEdgeResponse, "games">,
  previousResponse: Pick<DailyEdgeResponse, "games"> | null = null,
): UclPublicationCoverage {
  const activeIds = new Set(slate.matches.filter((match) => match.status !== "final").map((match) => String(match.id)));
  const games = response.games.filter((game) => activeIds.has(String(game.external_id)));
  const previousById = new Map(previousResponse?.games.map((game) => [String(game.external_id), game]) ?? []);
  const markets = games.flatMap((game): MarketEdgeDto[] => [
    game.markets.moneyline,
    game.soccerDoubleChanceMarket,
    game.markets.total,
    game.markets.first_inning,
  ].filter((market): market is MarketEdgeDto => Boolean(market)));
  const selectedCurrent = markets.filter((market) => market.currentPriceAmerican !== null).length;
  const previousSelectedCurrent = previousResponse?.games
    .filter((game) => activeIds.has(String(game.external_id)))
    .flatMap((game): MarketEdgeDto[] => [
      game.markets.moneyline,
      game.soccerDoubleChanceMarket,
      game.markets.total,
      game.markets.first_inning,
    ].filter((market): market is MarketEdgeDto => Boolean(market)))
    .filter((market) => market.currentPriceAmerican !== null).length ?? 0;
  const outcomeCurrent = markets.reduce((sum, market) => sum + (market.soccerPriceBoard?.rows.length ?? 0), 0);
  const selectedExpected = games.length * 4;
  const outcomeExpected = games.length * 10;
  const heldMarkets = markets.filter((market) => market.held || market.currentPriceAmerican === null).length;
  const unpricedWithoutHold = markets.filter((market) => market.currentPriceAmerican == null
    && (!market.held || market.verdict?.key !== "no_play")).length;
  const nonpositiveEvActionables = markets.filter((market) =>
    (market.verdict?.key === "best_angle" || market.verdict?.key === "lean")
      && !(typeof market.pinnacleEvPct === "number" && market.pinnacleEvPct > 0)
  ).length;
  const incoherent = games.filter((game) => {
    const probabilities = game.soccerProjection?.goalOutlookProbabilities;
    return !probabilities
      || Math.abs(probabilities.home + probabilities.draw + probabilities.away - 1) > 1e-9
      || Math.abs(probabilities.over25 + probabilities.under25 - 1) > 1e-9
      || Math.abs(probabilities.bttsYes + probabilities.bttsNo - 1) > 1e-9;
  }).length;
  const priceCollapse = previousSelectedCurrent > 0 && selectedCurrent === 0;
  const unlockedPriceRegressions = games.reduce((count, game) => {
    if (game.lockState === "locked" || game.lockedAt) return count;
    const previous = previousById.get(String(game.external_id));
    if (!previous) return count;
    const currentMarkets = [game.markets.moneyline, game.soccerDoubleChanceMarket, game.markets.total, game.markets.first_inning];
    const previousMarkets = [previous.markets.moneyline, previous.soccerDoubleChanceMarket, previous.markets.total, previous.markets.first_inning];
    return count + currentMarkets.reduce((inside, market, index) => inside + (
      previousMarkets[index]?.currentPriceAmerican !== null
        && previousMarkets[index]?.currentPriceAmerican !== undefined
        && (market?.currentPriceAmerican === null || market?.currentPriceAmerican === undefined)
        ? 1
        : 0
    ), 0);
  }, 0);
  const hardErrors = [
    ...(unpricedWithoutHold === 0 ? [] : [`${unpricedWithoutHold} unpriced market(s) lack an explicit evidence hold`]),
    ...(slate.providerHealth?.uclHistory.status === "degraded" ? [`UCL provider history degraded: ${slate.providerHealth.uclHistory.strategy}${slate.providerHealth.uclHistory.error ? ` (${slate.providerHealth.uclHistory.error})` : ""}; preserving last-known-good member snapshot`] : []),
    ...(games.length === activeIds.size ? [] : [`fixture/model coverage ${games.length}/${activeIds.size}`]),
    ...(markets.length === selectedExpected ? [] : [`market prediction coverage ${markets.length}/${selectedExpected}`]),
    ...(incoherent === 0 ? [] : [`coherent PMF coverage ${games.length - incoherent}/${games.length}`]),
    ...(nonpositiveEvActionables === 0 ? [] : [`positive-EV actionable coverage ${markets.length - nonpositiveEvActionables}/${markets.length}`]),
  ];
  const errors = [
    ...hardErrors,
    ...(priceCollapse
      ? [`current-price coverage collapsed ${previousSelectedCurrent}->0; preserving last-known-good member snapshot`]
      : []),
  ];
  const warnings = [
    ...(unlockedPriceRegressions > 0 && !priceCollapse
      ? [`${unlockedPriceRegressions} unlocked market(s) lost current prices; unavailable markets remain held while fresh markets publish`]
      : []),
    ...(slate.providerHealth?.uclHistory.contractDeviation ? [`UCL provider contract deviation: ${slate.providerHealth.uclHistory.contractDeviation}`] : []),
    ...(selectedCurrent === selectedExpected ? [] : [`selected current-price coverage ${selectedCurrent}/${selectedExpected}; missing markets held`]),
    ...(outcomeCurrent === outcomeExpected ? [] : [`outcome price-board coverage ${outcomeCurrent}/${outcomeExpected}; missing outcomes held`]),
  ];
  return { activeFixtures: activeIds.size, responseFixtures: games.length, selectedCurrent, selectedExpected, outcomeCurrent, outcomeExpected, heldMarkets, nonpositiveEvActionables, priceCollapse, unlockedPriceRegressions, hardErrors, errors, warnings };
}

/** On a same-cohort all-price outage, retain every non-due LKG card while
 * allowing only fully verified T-60 cards to advance to their immutable DB
 * tuple. The caller publishes this response only when every due cohort passed
 * four-market verification. */
export function mergeVerifiedUclLocksIntoLastKnownGood(input: {
  fresh: DailyEdgeResponse;
  previous: DailyEdgeResponse;
  verified: DailyEdgeResponse;
  dueProviderIds: number[];
}): DailyEdgeResponse {
  const due = new Set(input.dueProviderIds.map(String));
  const previousById = new Map(input.previous.games.map((game) => [String(game.external_id), game]));
  const verifiedById = new Map(input.verified.games.map((game) => [String(game.external_id), game]));
  return {
    ...input.fresh,
    games: input.fresh.games.map((game) => {
      const id = String(game.external_id);
      return due.has(id) ? verifiedById.get(id) ?? game : previousById.get(id) ?? game;
    }),
  };
}

export function uclPriceCollapseIsRecovered(input: {
  coverage: Pick<UclPublicationCoverage, "priceCollapse">;
  dueProviderIds: number[];
  incompleteProviderIds: number[];
}): boolean {
  return input.coverage.priceCollapse
    && input.dueProviderIds.length > 0
    && input.incompleteProviderIds.length === 0;
}
