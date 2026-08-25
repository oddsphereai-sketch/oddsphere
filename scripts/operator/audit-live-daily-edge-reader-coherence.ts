/** READ ONLY. Assemble the current member response without the stored response cache. */
import type { DailyEdgeResponse, MarketEdgeDto } from "../../app/lab/lib/labTypes";

async function main() {
  const date = process.argv[2] ?? "2026-08-12";
  const { GET } = await import("../../app/api/lab/daily-edge/route");
  const { auditDailyEdgeResponseCoherence } = await import("../../app/lab/lib/dailyEdgeResponseCoherence");
  const response = await GET(new Request(`https://oddsphere.internal/api/lab/daily-edge?sport=mlb&date=${date}&allowStale=false&snapshotBypass=true`));
  const body = await response.json() as DailyEdgeResponse & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  const coherenceIssues = auditDailyEdgeResponseCoherence(body);
  const markets: MarketEdgeDto[] = body.games.flatMap((game) => [
    game.markets.moneyline,
    game.markets.total,
  ]);
  const sharpStates = markets.reduce((counts: Record<string, number>, market) => {
    const status = market.sharpBookAvailability?.status ?? "missing";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const limitedMarkets = body.games.flatMap((game) =>
    (["moneyline", "total", "first_inning"] as const).flatMap((marketKey) => {
      const evidence = game.markets?.[marketKey]?.evidenceCoherence;
      return evidence?.status === "limited"
        ? [{ gameId: game.id, market: marketKey, reasonCodes: evidence.reasonCodes }]
        : [];
    }),
  );
  console.log(JSON.stringify({
    date: body.date,
    asOf: body.as_of,
    coherenceIssues,
    limitedMarkets,
    sharpStates,
    games: body.games.map((game) => ({
      gameId: game.id,
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      moneyline: {
        pick: game.markets?.moneyline?.pick,
        price: game.markets?.moneyline?.priceAmerican,
        modelProbability: game.markets?.moneyline?.modelProb,
        grade: game.markets?.moneyline?.grade,
        verdict: game.markets?.moneyline?.verdict,
        held: game.markets?.moneyline?.held,
      },
      total: {
        pick: game.markets?.total?.pick,
        line: game.markets?.total?.line,
        price: game.markets?.total?.priceAmerican,
        currentPrice: game.markets?.total?.currentPriceAmerican,
        currentBook: game.markets?.total?.currentPriceSportsbook,
        oddsTrail: game.markets?.total?.oddsTrail,
        lineTrail: game.markets?.total?.lineTrail,
        sharpAvailability: game.markets?.total?.sharpBookAvailability,
        evidenceCoherence: game.markets?.total?.evidenceCoherence,
        grade: game.markets?.total?.grade,
        verdict: game.markets?.total?.verdict,
      },
      firstInning: {
        pick: game.markets?.first_inning?.pick,
        price: game.markets?.first_inning?.priceAmerican,
        grade: game.markets?.first_inning?.grade,
        verdict: game.markets?.first_inning?.verdict,
        held: game.markets?.first_inning?.held,
      },
    })),
  }, null, 2));
  if (coherenceIssues.length > 0) {
    throw new Error(`member response retained ${coherenceIssues.length} incoherent market evidence fields`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
export {};
