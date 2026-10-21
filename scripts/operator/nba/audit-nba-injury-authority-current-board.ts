/** Read-only same-input comparison for the superseded count-only injury cap. */

import { buildNbaDailyEdgePipeline } from "../../../lib/services/nba/buildNbaDailyEdgeAdapted";
import type { NbaPlayerInjury } from "../../../lib/automodel/nba/types";
import type { InjuryResolver } from "../../../lib/services/nba/featureSnapshot";

const date = process.argv[2] ?? "2026-10-20";

async function main(): Promise<void> {
  const exactReports = new Map<string, NbaPlayerInjury[] | null>();
  const resolver: InjuryResolver = async (request) => {
    const key = `${request.gameExternalId}:${request.teamAbbreviation}`;
    if (!exactReports.has(key)) {
      throw new Error(`Exact injury report ${key} was not primed.`);
    }
    return exactReports.get(key) ?? null;
  };
  const exact = await buildNbaDailyEdgePipeline(date);
  for (const game of exact.nbaDto.games) {
    exactReports.set(`${game.game_external_id}:${game.away_abbr}`, game.injuries.away_known ? game.injuries.away_players : null);
    exactReports.set(`${game.game_external_id}:${game.home_abbr}`, game.injuries.home_known ? game.injuries.home_players : null);
  }
  const legacy = await buildNbaDailyEdgePipeline(date, {
    injuryResolver: resolver,
    retainLegacyInjuryCap: true,
  });
  const legacyByGame = new Map(legacy.nbaDto.games.map((game) => [game.game_external_id, game]));
  const rows = exact.nbaDto.games.flatMap((game) => {
    const prior = legacyByGame.get(game.game_external_id);
    if (!prior) throw new Error(`Legacy comparison is missing NBA game ${game.game_external_id}.`);
    return (["ml", "spread", "total"] as const).map((market) => ({
      gameExternalId: game.game_external_id,
      matchup: game.matchup,
      market: game.intelligence[market].market,
      legacyPick: prior.intelligence[market].pick_side,
      candidatePick: game.intelligence[market].pick_side,
      legacyGrade: prior.intelligence[market].grade,
      candidateGrade: game.intelligence[market].grade,
      legacyConfidence: prior.intelligence[market].model_confidence,
      candidateConfidence: game.intelligence[market].model_confidence,
      legacyProjection: prior.projection,
      candidateProjection: game.projection,
      legacyPrice: prior.intelligence[market].current_price,
      candidatePrice: game.intelligence[market].current_price,
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
      pickChanges: rows.filter((row) => row.legacyPick !== row.candidatePick).length,
      gradeChanges: rows.filter((row) => row.legacyGrade !== row.candidateGrade).length,
      promotions: rows.filter((row) => !actionable(row.legacyGrade) && actionable(row.candidateGrade)).length,
      demotions: rows.filter((row) => actionable(row.legacyGrade) && !actionable(row.candidateGrade)).length,
      projectionChanges: rows.filter((row) =>
        JSON.stringify(row.legacyProjection) !== JSON.stringify(row.candidateProjection)
      ).length,
      priceChanges: rows.filter((row) =>
        JSON.stringify(row.legacyPrice) !== JSON.stringify(row.candidatePrice)
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
