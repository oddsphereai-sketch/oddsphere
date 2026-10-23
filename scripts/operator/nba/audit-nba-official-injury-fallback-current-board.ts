/** Read-only same-input board impact for the official NBA report fallback. */

import { fetchNbaLiveRosterSnapshot } from "../../../lib/automodel/nba/nbaRosterRegime";
import {
  createEspnNbaGameInjuryResolver,
  createEspnOnlyNbaGameInjuryResolver,
} from "../../../lib/services/nba/espnNbaInjuries";
import { buildNbaDailyEdgePipeline } from "../../../lib/services/nba/buildNbaDailyEdgeAdapted";

const date = process.argv[2] ?? "2026-10-23";

const actionable = (grade: string) => grade === "best_angle" || grade === "lean";

async function main(): Promise<void> {
  const roster = await fetchNbaLiveRosterSnapshot();
  const baseline = await buildNbaDailyEdgePipeline(date, {
    injuryResolver: createEspnOnlyNbaGameInjuryResolver(),
    rosterRegimeRosterOverride: roster,
  });
  const candidate = await buildNbaDailyEdgePipeline(date, {
    injuryResolver: createEspnNbaGameInjuryResolver(),
    rosterRegimeRosterOverride: roster,
  });
  const baselineByGame = new Map(baseline.nbaDto.games.map((game) => [game.game_external_id, game]));
  const rows = candidate.nbaDto.games.flatMap((game) => {
    const prior = baselineByGame.get(game.game_external_id);
    if (!prior) throw new Error(`Baseline is missing NBA game ${game.game_external_id}.`);
    return (["ml", "spread", "total"] as const).map((market) => ({
      gameExternalId: game.game_external_id,
      matchup: game.matchup,
      market: game.intelligence[market].market,
      baselinePick: prior.intelligence[market].pick_side,
      candidatePick: game.intelligence[market].pick_side,
      baselineGrade: prior.intelligence[market].grade,
      candidateGrade: game.intelligence[market].grade,
      baselineConfidence: prior.intelligence[market].model_confidence,
      candidateConfidence: game.intelligence[market].model_confidence,
      baselineProjection: prior.projection,
      candidateProjection: game.projection,
      baselinePrice: prior.intelligence[market].current_price,
      candidatePrice: game.intelligence[market].current_price,
    }));
  });
  const verified = (games: typeof candidate.nbaDto.games) => games.filter((game) =>
    game.injuries.home_known && game.injuries.away_known
  ).length;
  const players = (games: typeof candidate.nbaDto.games) => games.reduce((sum, game) =>
    sum + game.injuries.home_players.length + game.injuries.away_players.length, 0);
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    productionChanged: false,
    date,
    summary: {
      games: candidate.nbaDto.games.length,
      markets: rows.length,
      baselineBothTeamsVerified: verified(baseline.nbaDto.games),
      candidateBothTeamsVerified: verified(candidate.nbaDto.games),
      baselinePlayersReported: players(baseline.nbaDto.games),
      candidatePlayersReported: players(candidate.nbaDto.games),
      pickChanges: rows.filter((row) => row.baselinePick !== row.candidatePick).length,
      gradeChanges: rows.filter((row) => row.baselineGrade !== row.candidateGrade).length,
      promotions: rows.filter((row) => !actionable(row.baselineGrade) && actionable(row.candidateGrade)).length,
      demotions: rows.filter((row) => actionable(row.baselineGrade) && !actionable(row.candidateGrade)).length,
      confidenceChanges: rows.filter((row) => row.baselineConfidence !== row.candidateConfidence).length,
      projectionChanges: rows.filter((row) =>
        JSON.stringify(row.baselineProjection) !== JSON.stringify(row.candidateProjection)
      ).length,
      priceChanges: rows.filter((row) =>
        JSON.stringify(row.baselinePrice) !== JSON.stringify(row.candidatePrice)
      ).length,
    },
    changedRows: rows.filter((row) =>
      row.baselinePick !== row.candidatePick || row.baselineGrade !== row.candidateGrade ||
      row.baselineConfidence !== row.candidateConfidence ||
      JSON.stringify(row.baselineProjection) !== JSON.stringify(row.candidateProjection) ||
      JSON.stringify(row.baselinePrice) !== JSON.stringify(row.candidatePrice)
    ),
    newlyVerifiedGames: candidate.nbaDto.games.filter((game) => {
      const prior = baselineByGame.get(game.game_external_id);
      return game.injuries.home_known && game.injuries.away_known &&
        !(prior?.injuries.home_known && prior.injuries.away_known);
    }).map((game) => ({ matchup: game.matchup, injuries: game.injuries })),
  }, null, 2));
}

void main();
