/** READ ONLY. Assemble the current member response without the stored response cache. */
async function main() {
  const date = process.argv[2] ?? "2026-08-12";
  const { GET } = await import("../../app/api/lab/daily-edge/route");
  const response = await GET(new Request(`https://oddsphere.internal/api/lab/daily-edge?sport=mlb&date=${date}&allowStale=false&snapshotBypass=true`));
  const body = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  console.log(JSON.stringify({
    date: body.date,
    asOf: body.as_of,
    games: (body.games ?? []).map((game: Record<string, any>) => ({
      gameId: game.game_id ?? game.id,
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      moneyline: {
        pick: game.markets?.moneyline?.pick,
        side: game.markets?.moneyline?.selectedSide,
        price: game.markets?.moneyline?.priceAmerican,
        modelProbability: game.markets?.moneyline?.modelProb,
        grade: game.markets?.moneyline?.grade,
        verdict: game.markets?.moneyline?.verdict,
        held: game.markets?.moneyline?.held,
        holdReason: game.markets?.moneyline?.holdReason,
      },
      total: {
        pick: game.markets?.total?.pick,
        price: game.markets?.total?.priceAmerican,
        grade: game.markets?.total?.grade,
        verdict: game.markets?.total?.verdict,
      },
      firstInning: {
        pick: game.markets?.first_inning?.pick,
        price: game.markets?.first_inning?.priceAmerican,
        grade: game.markets?.first_inning?.grade,
        verdict: game.markets?.first_inning?.verdict,
        held: game.markets?.first_inning?.held,
        holdReason: game.markets?.first_inning?.holdReason,
        modelNote: game.markets?.first_inning?.reason,
      },
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
export {};
