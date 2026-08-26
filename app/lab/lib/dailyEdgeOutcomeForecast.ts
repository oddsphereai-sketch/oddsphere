import type { DailyEdgeGameDto, MarketEdgeDto } from "./labTypes";
import type { DailyEdgeMarketKey as MarketKey } from "./dailyEdgeReaderState";
import type { Sport } from "@/lib/types/domain/Sport";

export const DAILY_EDGE_FORECAST_UNAVAILABLE_LABEL = "Forecast unavailable";

export function isDailyEdgeOutcomeForecastHealthError(label: string): boolean {
  return label === DAILY_EDGE_FORECAST_UNAVAILABLE_LABEL;
}

function compactNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function projectedScore(game: DailyEdgeGameDto): string | null {
  const away = game.projected?.away;
  const home = game.projected?.home;
  if (!Number.isFinite(away) || !Number.isFinite(home)) return null;
  return `${game.awayTeam} ${compactNumber(away)}–${compactNumber(home)} ${game.homeTeam}`;
}

/**
 * Model-owned forecast label for prediction surfaces. This must never fall
 * back to a Bet Grade such as No Play or an internal health label such as
 * Held. When a directional market prediction is absent, show the strongest
 * truthful model-native output without inventing a bet side.
 */
export function dailyEdgeOutcomeForecastLabel(input: {
  game: DailyEdgeGameDto;
  market: MarketEdgeDto;
  marketKey: MarketKey;
  sport: Sport;
}): string {
  const { game, market, marketKey, sport } = input;
  if (market.pick) {
    if (marketKey === "total" && market.line !== null && !/\d/.test(market.pick)) {
      return `${market.pick} ${compactNumber(market.line)}`;
    }
    return market.pick;
  }

  if (marketKey === "total") {
    const modelTotal = market.modelTotal ?? (
      Number.isFinite(game.projected?.away) && Number.isFinite(game.projected?.home)
        ? game.projected.away + game.projected.home
        : null
    );
    if (modelTotal !== null && Number.isFinite(modelTotal)) {
      return `Projected total ${compactNumber(modelTotal)}`;
    }
  }

  if (sport === "soccer") {
    if (marketKey === "moneyline" && market.soccerMatchResultContext) {
      const side = market.soccerMatchResultContext.displayed_side;
      return side === "draw" ? "Draw forecast" : side === "away" ? game.awayTeam : game.homeTeam;
    }
    if (marketKey === "first_inning" && market.soccerBttsContext) {
      const yes = market.soccerBttsContext.yes_p;
      const no = market.soccerBttsContext.no_p;
      return `BTTS ${yes >= no ? "Yes" : "No"} ${compactNumber(Math.max(yes, no) * 100)}%`;
    }
  }

  if (marketKey === "moneyline") {
    const football = game.footballProjection;
    if (football) {
      return football.homeWinProbability >= football.awayWinProbability
        ? game.homeTeam
        : game.awayTeam;
    }
    if (game.projected.home !== game.projected.away) {
      const leader = game.projected.home > game.projected.away ? game.homeTeam : game.awayTeam;
      return `${leader} projected leader`;
    }
  }

  if (marketKey === "first_inning" && sport === "mlb") {
    const firstInning = market.keyStats.find((stat) =>
      /projected.*(?:first|1st).*inning/i.test(stat.label)
    );
    const value = firstInning?.homeValue ?? firstInning?.awayValue ?? null;
    if (value) return `1st-inning projection ${value}`;
  }

  if (marketKey === "first_inning" && sport !== "mlb") {
    const margin = Math.abs(game.projected.home - game.projected.away);
    if (Number.isFinite(margin) && margin > 0) {
      const leader = game.projected.home > game.projected.away ? game.homeTeam : game.awayTeam;
      return `Projected margin ${leader} ${compactNumber(margin)}`;
    }
  }

  const score = projectedScore(game);
  return score ? `Projected score ${score}` : DAILY_EDGE_FORECAST_UNAVAILABLE_LABEL;
}
