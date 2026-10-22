/** Read-only same-input NBA roster-regime current-board comparison. */

import { fetchNbaLiveRosterSnapshot } from "../../../lib/automodel/nba/nbaRosterRegime";
import type { NbaPlayerInjury } from "../../../lib/automodel/nba/types";
import { buildNbaDailyEdgePipeline } from "../../../lib/services/nba/buildNbaDailyEdgeAdapted";
import type { InjuryResolver } from "../../../lib/services/nba/featureSnapshot";

const date = process.argv[2] ?? new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const actionable = (grade: string) => grade === "best_angle" || grade === "lean";

async function main(): Promise<void> {
  const liveRoster = await fetchNbaLiveRosterSnapshot();
  if (liveRoster.status !== "complete") {
    throw new Error(`NBA live roster unavailable: ${liveRoster.reason ?? "unknown"}`);
  }

  const exactReports = new Map<string, NbaPlayerInjury[] | null>();
  const first = await buildNbaDailyEdgePipeline(date, { rosterRegimeRosterOverride: liveRoster });
  for (const game of first.nbaDto.games) {
    exactReports.set(
      `${game.game_external_id}:${game.away_abbr}`,
      game.injuries.away_known ? game.injuries.away_players : null,
    );
    exactReports.set(
      `${game.game_external_id}:${game.home_abbr}`,
      game.injuries.home_known ? game.injuries.home_players : null,
    );
  }
  const resolver: InjuryResolver = async (request) => {
    const key = `${request.gameExternalId}:${request.teamAbbreviation}`;
    if (!exactReports.has(key)) throw new Error(`Exact injury report ${key} was not primed.`);
    return exactReports.get(key) ?? null;
  };

  const [candidate, legacy] = await Promise.all([
    buildNbaDailyEdgePipeline(date, {
      injuryResolver: resolver,
      rosterRegimeRosterOverride: liveRoster,
    }),
    buildNbaDailyEdgePipeline(date, {
      injuryResolver: resolver,
      rosterRegimeRosterOverride: liveRoster,
      retainLegacyRosterRegime: true,
    }),
  ]);
  const legacyById = new Map(legacy.nbaDto.games.map((game) => [game.game_external_id, game]));
  const rows = candidate.nbaDto.games.flatMap((game) => {
    const before = legacyById.get(game.game_external_id);
    if (!before) throw new Error(`Legacy comparison is missing NBA game ${game.game_external_id}.`);
    return (["ml", "spread", "total"] as const).map((market) => ({
      gameExternalId: game.game_external_id,
      matchup: game.matchup,
      market,
      legacyPick: before.intelligence[market].pick_side,
      candidatePick: game.intelligence[market].pick_side,
      legacyGrade: before.intelligence[market].grade,
      candidateGrade: game.intelligence[market].grade,
      legacyProbability: before.intelligence[market].model_prob_on_pick,
      candidateProbability: game.intelligence[market].model_prob_on_pick,
      legacyPrice: before.intelligence[market].current_price,
      candidatePrice: game.intelligence[market].current_price,
      promotion: !actionable(before.intelligence[market].grade) && actionable(game.intelligence[market].grade),
      demotion: actionable(before.intelligence[market].grade) && !actionable(game.intelligence[market].grade),
    }));
  });
  const games = candidate.nbaDto.games.map((game) => {
    const before = legacyById.get(game.game_external_id)!;
    const rosterRegime = (game.grounding_audit as { roster_regime?: unknown } | null)?.roster_regime ?? null;
    return {
      gameExternalId: game.game_external_id,
      matchup: game.matchup,
      legacyProjection: before.projection,
      candidateProjection: game.projection,
      rosterRegime,
      markets: rows.filter((row) => row.gameExternalId === game.game_external_id),
    };
  });
  const incoherentScores = games.filter((game) => {
    const projection = game.candidateProjection;
    return Math.abs((projection.home_score - projection.away_score) - projection.spread_home) > 0.011 ||
      Math.abs((projection.home_score + projection.away_score) - projection.total) > 0.011;
  }).length;

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    productionChanged: false,
    date,
    liveRoster: {
      release: liveRoster.release,
      status: liveRoster.status,
      observedAt: liveRoster.observedAt,
      teams: liveRoster.playerIdsByTeam.size,
    },
    summary: {
      games: games.length,
      markets: rows.length,
      projectionChanges: games.filter((game) =>
        JSON.stringify(game.legacyProjection) !== JSON.stringify(game.candidateProjection)
      ).length,
      pickChanges: rows.filter((row) => row.legacyPick !== row.candidatePick).length,
      gradeChanges: rows.filter((row) => row.legacyGrade !== row.candidateGrade).length,
      promotions: rows.filter((row) => row.promotion).length,
      demotions: rows.filter((row) => row.demotion).length,
      legacyActionable: rows.filter((row) => actionable(row.legacyGrade)).length,
      candidateActionable: rows.filter((row) => actionable(row.candidateGrade)).length,
      priceChanges: rows.filter((row) =>
        JSON.stringify(row.legacyPrice) !== JSON.stringify(row.candidatePrice)
      ).length,
      incoherentScores,
    },
    games,
  }, null, 2));
}

void main();
