import type { DailyEdgeGameDto, MarketEdgeDto } from "./labTypes";

export type SoccerReaderMarketKey = "moneyline" | "total" | "first_inning";

export type SoccerForecastSemantics = {
  label: "Separate forecast heads" | "Forecast heads differ";
  tone: "neutral" | "warning";
  summary: string | null;
  explanation: string;
};

const pct = (probability: number) => `${(probability * 100).toFixed(1)}%`;

function maxSide<T extends string>(probabilities: Record<T, number>, sides: readonly T[]): T {
  return sides.reduce((best, side) => probabilities[side] > probabilities[best] ? side : best, sides[0]!);
}

/**
 * Reader-only comparison between the marginals implied by the displayed goal
 * outlook and the released market-specific forecast. It never changes a side,
 * probability, grade, hold, or tracking row.
 */
export function soccerForecastSemantics(
  game: Pick<DailyEdgeGameDto, "awayTeam" | "homeTeam" | "soccerProjection">,
  market: Pick<MarketEdgeDto, "soccerMatchResultContext" | "soccerTotalContext" | "soccerBttsContext">,
  marketKey: SoccerReaderMarketKey,
): SoccerForecastSemantics {
  const outlook = game.soccerProjection?.goalOutlookProbabilities ?? null;
  const marketName = marketKey === "moneyline" ? "Match Result" : marketKey === "total" ? "Total" : "BTTS";
  const fallback: SoccerForecastSemantics = {
    label: "Separate forecast heads",
    tone: "neutral",
    summary: null,
    explanation: `The goal outlook is scoring context. The ${marketName} probabilities below set this pick and grade.`,
  };
  if (!outlook) return fallback;

  if (marketKey === "moneyline" && market.soccerMatchResultContext) {
    const released = market.soccerMatchResultContext.model;
    const sides = ["home", "draw", "away"] as const;
    const outlookSide = maxSide(outlook, sides);
    const releasedSide = maxSide(released, sides);
    const maxGap = Math.max(...sides.map((side) => Math.abs(outlook[side] - released[side])));
    const warning = outlookSide !== releasedSide || maxGap >= 0.15;
    const label = (side: typeof sides[number]) => side === "home" ? game.homeTeam : side === "away" ? game.awayTeam : "Draw";
    return {
      label: warning ? "Forecast heads differ" : "Separate forecast heads",
      tone: warning ? "warning" : "neutral",
      summary: `Goal outlook: ${label(outlookSide)} ${pct(outlook[outlookSide])} · Match Result: ${label(releasedSide)} ${pct(released[releasedSide])}`,
      explanation: warning
        ? "The two calibrated views differ materially. Match Result probabilities—not the goal outlook—set the result pick and grade."
        : "The goal outlook supports the same result direction, but Match Result probabilities independently set the pick and grade.",
    };
  }

  if (marketKey === "total" && market.soccerTotalContext) {
    const released = { over: market.soccerTotalContext.over_p, under: market.soccerTotalContext.under_p };
    const goal = { over: outlook.over25, under: outlook.under25 };
    const sides = ["over", "under"] as const;
    const outlookSide = maxSide(goal, sides);
    const releasedSide = maxSide(released, sides);
    const warning = outlookSide !== releasedSide || Math.abs(goal.over - released.over) >= 0.1;
    const label = (side: typeof sides[number]) => side === "over" ? "Over 2.5" : "Under 2.5";
    return {
      label: warning ? "Forecast heads differ" : "Separate forecast heads",
      tone: warning ? "warning" : "neutral",
      summary: `Goal outlook: ${label(outlookSide)} ${pct(goal[outlookSide])} · Total: ${label(releasedSide)} ${pct(released[releasedSide])}`,
      explanation: warning
        ? "The scoring outlook and dedicated Total forecast differ. Total probabilities—not the goal outlook—set the pick and grade."
        : "The goal outlook supports the same direction, but dedicated Total probabilities independently set the pick and grade.",
    };
  }

  if (marketKey === "first_inning" && market.soccerBttsContext) {
    const released = { yes: market.soccerBttsContext.yes_p, no: market.soccerBttsContext.no_p };
    const goal = { yes: outlook.bttsYes, no: outlook.bttsNo };
    const sides = ["yes", "no"] as const;
    const outlookSide = maxSide(goal, sides);
    const releasedSide = maxSide(released, sides);
    const warning = outlookSide !== releasedSide || Math.abs(goal.yes - released.yes) >= 0.1;
    const label = (side: typeof sides[number]) => `BTTS ${side === "yes" ? "Yes" : "No"}`;
    return {
      label: warning ? "Forecast heads differ" : "Separate forecast heads",
      tone: warning ? "warning" : "neutral",
      summary: `Goal outlook: ${label(outlookSide)} ${pct(goal[outlookSide])} · BTTS: ${label(releasedSide)} ${pct(released[releasedSide])}`,
      explanation: warning
        ? "The scoring outlook and dedicated BTTS forecast differ. BTTS probabilities—not the goal outlook—set the pick and grade."
        : "The goal outlook supports the same direction, but dedicated BTTS probabilities independently set the pick and grade.",
    };
  }

  return fallback;
}
