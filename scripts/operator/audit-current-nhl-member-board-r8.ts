import { buildNhlDailyEdgeAdapted } from "../../lib/services/nhl/buildNhlDailyEdgeAdapted";

const slateDate = process.argv[2] ?? "2026-09-29";

async function main(): Promise<void> {
  const board = await buildNhlDailyEdgeAdapted(slateDate);
  const counts = new Map<string, number>();
  const byMarket = new Map<string, Map<string, number>>();
  const rows = board.games.flatMap((game) => {
    const markets = [
      ["moneyline", game.markets.moneyline],
      ["total", game.markets.total],
      ["puck_line", game.markets.first_inning],
    ] as const;
    return markets.map(([market, edge]) => {
      const verdict = edge.verdict.label;
      counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
      if (!byMarket.has(market)) byMarket.set(market, new Map());
      const marketCounts = byMarket.get(market)!;
      marketCounts.set(verdict, (marketCounts.get(verdict) ?? 0) + 1);
      return {
        id: game.id,
        matchup: `${game.awayTeam}@${game.homeTeam}`,
        start: game.gameStartAt,
        locked: game.lockState === "locked",
        projected: game.projected,
        market,
        pick: edge.pick,
        verdict,
        price: edge.currentPriceAmerican,
        sportsbook: edge.currentPriceSportsbook,
      };
    });
  });
  console.log(JSON.stringify({
    slateDate,
    games: board.games.length,
    markets: rows.length,
    actionable: rows.filter((row) => row.verdict === "Best Angle" || row.verdict === "Lean").length,
    verdicts: Object.fromEntries([...counts.entries()].sort()),
    byMarket: Object.fromEntries([...byMarket.entries()].map(([market, values]) => [market, Object.fromEntries([...values.entries()].sort())])),
    rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
