import type { RecommendationDecision } from "@/lib/types/domain/RecommendationDecision";

export type DailyEdgeDecisionMarketKey = keyof RecommendationDecision["markets"];

export type DailyEdgeMarketCapabilities = {
  expectsConsensusSplits: boolean;
  expectsSharpBookContext: boolean;
  isFirstInning: boolean;
  isSpreadLike: boolean;
  isSoccerLike: boolean;
  marketContextName: "moneyline" | "total" | "first inning" | "spread" | "match result" | "BTTS" | "market";
};

export function dailyEdgeMarketCapabilities(
  sport: string,
  key: DailyEdgeDecisionMarketKey,
): DailyEdgeMarketCapabilities {
  const normalizedSport = sport.toLowerCase();

  if (normalizedSport === "mlb") {
    return {
      expectsConsensusSplits: key === "moneyline" || key === "total",
      expectsSharpBookContext: key === "moneyline" || key === "total",
      isFirstInning: key === "firstInning",
      isSpreadLike: false,
      isSoccerLike: false,
      marketContextName: key === "total" ? "total" : key === "firstInning" ? "first inning" : "moneyline",
    };
  }

  if (normalizedSport === "wnba") {
    return {
      expectsConsensusSplits: key === "moneyline" || key === "total" || key === "firstInning" || key === "spread",
      expectsSharpBookContext: false,
      isFirstInning: false,
      isSpreadLike: key === "firstInning" || key === "spread",
      isSoccerLike: false,
      marketContextName: key === "total" ? "total" : key === "firstInning" || key === "spread" ? "spread" : "moneyline",
    };
  }

  if (normalizedSport === "soccer" || normalizedSport === "ucl") {
    return {
      expectsConsensusSplits: false,
      expectsSharpBookContext: false,
      isFirstInning: false,
      isSpreadLike: false,
      isSoccerLike: true,
      marketContextName: key === "total" ? "total" : key === "firstInning" || key === "btts" ? "BTTS" : "match result",
    };
  }

  return {
    // Football stores its spread market in the legacy firstInning slot.
    // Treat both keys as spread so the normalized recommendation layer does
    // not silently discard the splits that the football writer published.
    expectsConsensusSplits: key === "moneyline" || key === "total" || key === "spread" || key === "firstInning",
    expectsSharpBookContext: false,
    isFirstInning: false,
    isSpreadLike: key === "spread" || key === "firstInning",
    isSoccerLike: false,
    marketContextName: key === "total" ? "total" : key === "spread" || key === "firstInning" ? "spread" : "market",
  };
}

export function sportExpectsSharpBookContext(sport: string): boolean {
  const keys: DailyEdgeDecisionMarketKey[] = ["moneyline", "total", "spread", "firstInning", "doubleChance", "btts"];
  return keys.some((key) => dailyEdgeMarketCapabilities(sport, key).expectsSharpBookContext);
}
