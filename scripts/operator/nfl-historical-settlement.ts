export type HistoricalMarket = "moneyline" | "spread" | "total";
export type HistoricalSide = 1 | -1;
export type HistoricalResult = "win" | "loss" | "push";

export function canonicalHomeSpreadLine(input: {
  selectedLine: number;
  selectedTeam: string;
  homeTeam: string;
  awayTeam: string;
}): number {
  if (input.selectedTeam === input.homeTeam) return input.selectedLine;
  if (input.selectedTeam === input.awayTeam) return -input.selectedLine;
  throw new Error(`NFL spread decision selected unknown team ${input.selectedTeam}.`);
}

export function settleHistoricalMarket(input: {
  market: HistoricalMarket;
  side: HistoricalSide;
  actualHome: number;
  actualAway: number;
  canonicalLine: number | null;
  cushion?: number;
}): HistoricalResult | null {
  const actualMargin = input.actualHome - input.actualAway;
  const marketValue = input.market === "moneyline"
    ? actualMargin
    : input.market === "spread" && input.canonicalLine !== null
      ? actualMargin + input.canonicalLine
      : input.market === "total" && input.canonicalLine !== null
        ? input.actualHome + input.actualAway - input.canonicalLine
        : null;
  if (marketValue === null) return null;
  const sideAdjustedValue = input.side * marketValue + (input.cushion ?? 0);
  if (Math.abs(sideAdjustedValue) < 1e-9) return "push";
  return sideAdjustedValue > 0 ? "win" : "loss";
}
