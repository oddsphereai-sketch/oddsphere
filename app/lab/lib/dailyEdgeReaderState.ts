import type { DailyEdgeGameDto } from "./labTypes";
import type { Sport } from "@/lib/types/domain/Sport";

export type DailyEdgeMarketKey = "moneyline" | "total" | "first_inning";

const MARKET_KEYS: DailyEdgeMarketKey[] = ["moneyline", "total", "first_inning"];
const VERDICT_RANK: Record<string, number> = {
  best_angle: 5,
  lean: 4,
  watchlist: 3,
  caution: 2,
  no_play: 1,
};

export function isDailyEdgeMarketKey(
  value: string | null,
): value is DailyEdgeMarketKey {
  return value === "moneyline" || value === "total" || value === "first_inning";
}

/** Strongest market, with Moneyline > Total > third market on ties. */
export function primaryDailyEdgeMarket(
  game: DailyEdgeGameDto,
): DailyEdgeMarketKey {
  return MARKET_KEYS.reduce((best, candidate) => {
    const bestRank = VERDICT_RANK[game.markets[best].verdict.key] ?? 0;
    const candidateRank = VERDICT_RANK[game.markets[candidate].verdict.key] ?? 0;
    return candidateRank > bestRank ? candidate : best;
  }, MARKET_KEYS[0]);
}

export function resolveInitialDailyEdgeReaderSelection(
  games: DailyEdgeGameDto[],
  requestedGameId: string | null,
  requestedMarket: string | null,
): { gameId: string; market: DailyEdgeMarketKey } {
  const selectedGame =
    games.find((candidate) => candidate.id === requestedGameId) ?? games[0];
  return {
    gameId: selectedGame?.id ?? "",
    market: isDailyEdgeMarketKey(requestedMarket)
      ? requestedMarket
      : "moneyline",
  };
}

export function buildDailyEdgeReaderUrl(
  pathname: string,
  currentSearch: string,
  sport: Sport,
  gameId: string,
  market: DailyEdgeMarketKey,
): string {
  const params = new URLSearchParams(currentSearch);
  params.set("sport", sport);
  params.set("game", gameId);
  params.set("market", market);
  return `${pathname}?${params.toString()}`;
}
