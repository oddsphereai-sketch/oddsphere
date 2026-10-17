/** Read-only current-board comparison for the exact-game NBA injury authority. */

import { buildNbaDailyEdgePipeline } from "../../../lib/services/nba/buildNbaDailyEdgeAdapted";

const date = process.argv[2] ?? "2026-10-20";

async function main(): Promise<void> {
  const [legacy, exact] = await Promise.all([
    buildNbaDailyEdgePipeline(date, { injuryResolver: async () => [] }),
    buildNbaDailyEdgePipeline(date),
  ]);
  const legacyByGame = new Map(legacy.nbaDto.games.map((game) => [game.game_external_id, game]));
  const rows = exact.nbaDto.games.flatMap((game) => {
    const prior = legacyByGame.get(game.game_external_id);
    if (!prior) throw new Error(`Legacy comparison is missing NBA game ${game.game_external_id}.`);
    return (["ml", "spread", "total"] as const).map((market) => ({
      gameExternalId: game.game_external_id,
      matchup: game.matchup,
      market: game.intelligence[market].market,
      priorPick: prior.intelligence[market].pick_side,
      exactPick: game.intelligence[market].pick_side,
      priorGrade: prior.intelligence[market].grade,
      exactGrade: game.intelligence[market].grade,
      priorConfidence: prior.intelligence[market].model_confidence,
      exactConfidence: game.intelligence[market].model_confidence,
      priorProjection: prior.projection,
      exactProjection: game.projection,
      exactInjuries: game.injuries,
    }));
  });
  const actionable = (grade: string) => grade === "best_angle" || grade === "lean";
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    productionChanged: false,
    date,
    summary: {
      games: exact.nbaDto.games.length,
      markets: rows.length,
      gamesWithBothTeamsVerified: exact.nbaDto.games.filter((game) =>
        game.injuries.home_known && game.injuries.away_known
      ).length,
      playersReported: exact.nbaDto.games.reduce((sum, game) =>
        sum + game.injuries.home_out + game.injuries.home_questionable + game.injuries.home_unknown
          + game.injuries.away_out + game.injuries.away_questionable + game.injuries.away_unknown,
      0),
      pickChanges: rows.filter((row) => row.priorPick !== row.exactPick).length,
      gradeChanges: rows.filter((row) => row.priorGrade !== row.exactGrade).length,
      promotions: rows.filter((row) => !actionable(row.priorGrade) && actionable(row.exactGrade)).length,
      demotions: rows.filter((row) => actionable(row.priorGrade) && !actionable(row.exactGrade)).length,
      projectionChanges: rows.filter((row) =>
        JSON.stringify(row.priorProjection) !== JSON.stringify(row.exactProjection)
      ).length,
    },
    games: exact.nbaDto.games.map((game) => ({
      gameExternalId: game.game_external_id,
      matchup: game.matchup,
      injuries: game.injuries,
      markets: rows.filter((row) => row.gameExternalId === game.game_external_id),
    })),
  }, null, 2));
}

void main();
