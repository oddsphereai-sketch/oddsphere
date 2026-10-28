import assert from "node:assert/strict";
import {
  NBA_PLAYER_PROPS_MODEL_RELEASE,
  buildNbaPlayerPropsObservationSnapshot,
  summarizeNbaPlayerPropsCoverage,
} from "../lib/services/nba/nbaPlayerPropsContract";
import {
  normalizeBallDontLieNbaPlayerProps,
  normalizeOwlsNbaPlayerProps,
  normalizeTheOddsApiNbaPlayerProps,
} from "../lib/services/nba/nbaPlayerPropsProviders";
import {
  NBA_PLAYER_PROPS_SOURCE_POLICY,
  nbaPlayerPropsCadenceStage,
  planNbaPlayerPropsTheOddsApiCredits,
  recommendedNbaPlayerPropsRequestPlan,
} from "../lib/services/nba/nbaPlayerPropsSourcePolicy";
import { buildNbaPlayerPropsPointInTimeFeatures } from "../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";
import type { NbaHistoricalGame, NbaHistoricalPlayerBox } from "../lib/services/nba/nbaPointInTimeFeatures";
import { fetchNbaBdlOpeningPlayerPropsHistory } from "../lib/services/nba/nbaPlayerPropsHistorical";
import {
  fitNbaPlayerPropsIndependentResearchModel,
  nbaPlayerPropsProbabilityOver,
  projectNbaPlayerPropsIndependent,
} from "../lib/services/nba/nbaPlayerPropsIndependentModel";
import {
  buildNbaPlayerPropsMarketEvidence,
  selectNbaPlayerPropsCanonicalOfferSets,
} from "../lib/services/nba/nbaPlayerPropsMarketEvidence";
import { replayNbaPlayerPropsFoundation } from "../lib/services/nba/nbaPlayerPropsReplay";

const fetchedAt = "2026-10-20T20:00:00.000Z";
const events = {
  "18447073": {
    canonicalGameId: "nba:2026-10-20:bos-nyk",
    homeTeam: "NYK",
    awayTeam: "BOS",
    scheduledStart: "2026-10-21T00:00:00.000Z",
  },
};

const bdl = normalizeBallDontLieNbaPlayerProps({
  fetchedAt,
  events,
  canonicalPlayers: { "246": "nba-bdl-player:246" },
  values: [
    {
      id: 15777199,
      game_id: 18447073,
      player_id: 246,
      vendor: "draftkings",
      prop_type: "points",
      line_value: "30.5",
      market: { type: "over_under", over_odds: -111, under_odds: -115 },
      updated_at: "2026-10-20T19:59:00.000Z",
    },
    {
      id: 15777202,
      game_id: 18447073,
      player_id: 246,
      vendor: "fanduel",
      prop_type: "double_double",
      line_value: "1",
      market: { type: "milestone", odds: 139 },
      updated_at: "2026-10-20T19:58:00.000Z",
    },
    {
      id: 15777203,
      game_id: 18447073,
      player_id: 246,
      vendor: "fanduel",
      prop_type: "unsupported_example",
      line_value: "4.5",
      market: { type: "over_under", over_odds: -110, under_odds: -110 },
      updated_at: "2026-10-20T19:58:00.000Z",
    },
  ],
});
assert.equal(bdl.rows.length, 3);
assert.equal(bdl.rejectedRows, 1);
assert.equal(bdl.unknownMarkets.unsupported_example, 1);
assert.deepEqual(bdl.rows.filter((row) => row.market === "points").map((row) => row.side).sort(), ["over", "under"]);
assert.equal(bdl.rows.find((row) => row.market === "double_double")?.side, "yes");

const pointRows = bdl.rows.filter((row) => row.market === "points");
const currentOver = pointRows.find((row) => row.side === "over")!;
const currentUnder = pointRows.find((row) => row.side === "under")!;
const marketHistory = [
  { ...currentOver, providerObservationId: "dk-open-over", line: 29.5, americanPrice: -110, observedAt: "2026-10-20T12:00:00.000Z", isOpening: true },
  { ...currentUnder, providerObservationId: "dk-open-under", line: 29.5, americanPrice: -110, observedAt: "2026-10-20T12:00:00.000Z", isOpening: true },
  currentOver,
  currentUnder,
  { ...currentOver, providerObservationId: "fd-current-over", sportsbook: "fanduel", americanPrice: -120, observedAt: "2026-10-20T19:59:00.000Z" },
  { ...currentUnder, providerObservationId: "fd-current-under", sportsbook: "fanduel", americanPrice: 100, observedAt: "2026-10-20T19:59:00.000Z" },
];
const canonicalOffers = selectNbaPlayerPropsCanonicalOfferSets(marketHistory);
assert.equal(canonicalOffers.length, 1);
assert.equal(canonicalOffers[0]?.canonicalLine, 30.5);
assert.equal(canonicalOffers[0]?.completeBooks, 2);
const marketEvidence = buildNbaPlayerPropsMarketEvidence({
  target: currentOver,
  observations: marketHistory,
  evaluatedAt: fetchedAt,
});
assert.equal(marketEvidence.mode, "offline_research_only");
assert.equal(marketEvidence.actionable, false);
assert.equal(marketEvidence.targetExcludedBooks, 1);
assert.equal(marketEvidence.targetExcludedReferenceBooks, 1);
assert.equal(marketEvidence.openingLine, 29.5);
assert.equal(marketEvidence.currentLine, 30.5);
assert.equal(marketEvidence.lineMovement, "toward_over");
assert.ok(marketEvidence.targetExcludedOverProbability !== null && marketEvidence.targetExcludedOverProbability > 0.5);

const toa = normalizeTheOddsApiNbaPlayerProps({
  fetchedAt,
  canonicalGames: { "toa-game": "nba:2026-10-20:bos-nyk" },
  canonicalPlayers: { testplayer: "nba-bdl-player:246" },
  events: [{
    id: "toa-game",
    commence_time: "2026-10-21T00:00:00.000Z",
    home_team: "New York Knicks",
    away_team: "Boston Celtics",
    bookmakers: [{
      key: "fanduel",
      markets: [{
        key: "player_rebounds",
        last_update: "2026-10-20T19:57:00.000Z",
        outcomes: [
          { name: "Over", description: "Test Player", price: -105, point: 8.5 },
          { name: "Under", description: "Test Player", price: -115, point: 8.5 },
        ],
      }],
    }],
  }],
});
assert.equal(toa.inputRows, 2);
assert.equal(toa.rows.length, 2);
assert.equal(toa.rows[0]?.provider, "the_odds_api");
assert.equal(toa.rows[0]?.playerName, "Test Player");
assert.equal(toa.rows[0]?.canonicalPlayerId, "nba-bdl-player:246");

const owls = normalizeOwlsNbaPlayerProps({
  fetchedAt,
  canonicalGames: { "owls-game": "nba:2026-10-20:bos-nyk" },
  canonicalPlayers: { testplayer: "nba-bdl-player:246" },
  events: [{
    gameId: "owls-game",
    commenceTime: "2026-10-21T00:00:00.000Z",
    homeTeam: "New York Knicks",
    awayTeam: "Boston Celtics",
    isLive: false,
    books: [{
      key: "pinnacle",
      lastUpdate: "2026-10-20T19:56:00.000Z",
      props: [{
        propId: "owls-prop-1",
        category: "pts_rebs_asts",
        playerName: "Test Player",
        team: "BOS",
        line: 44.5,
        overPrice: -108,
        underPrice: -112,
        lastUpdate: "2026-10-20T19:57:00.000Z",
      }, {
        propId: "owls-invalid-exchange-pair",
        category: "assists",
        playerName: "Test Player",
        team: "BOS",
        line: 5.5,
        overPrice: -525,
        underPrice: -4900,
        lastUpdate: "2026-10-20T19:57:00.000Z",
      }],
    }],
  }],
});
assert.equal(owls.inputRows, 2);
assert.equal(owls.rows.length, 2);
assert.equal(owls.rejectedRows, 1, "non-complementary exchange ladder prices must not become a two-way market");
assert.equal(owls.rows[0]?.provider, "owls");
assert.equal(owls.rows[0]?.market, "points_rebounds_assists");
assert.equal(owls.rows[0]?.canonicalGameId, "nba:2026-10-20:bos-nyk");
assert.equal(owls.rows[0]?.canonicalPlayerId, "nba-bdl-player:246");
assert.deepEqual(owls.rows.map((row) => row.side).sort(), ["over", "under"]);

const coverage = summarizeNbaPlayerPropsCoverage([...bdl.rows, ...toa.rows, ...owls.rows]);
assert.equal(coverage.completeTwoWayBuckets, 3);
assert.equal(coverage.foundationRows, 6);
assert.deepEqual(coverage.sportsbooks, ["draftkings", "fanduel", "pinnacle"]);

const snapshot = buildNbaPlayerPropsObservationSnapshot({
  generatedAt: fetchedAt,
  games: [
    { provider: "balldontlie", providerGameId: "18447073", ...events["18447073"] },
    { provider: "the_odds_api", providerGameId: "toa-game", ...events["18447073"] },
  ],
  observations: [...bdl.rows, ...toa.rows],
  providerRequests: { balldontlie: 2, the_odds_api: 1 },
  providerComplete: { balldontlie: true, the_odds_api: true },
});
assert.equal(snapshot.mode, "local_observe_only");
assert.equal(snapshot.actionable, false);
assert.equal(snapshot.modelRelease, NBA_PLAYER_PROPS_MODEL_RELEASE);
assert.equal(snapshot.modelingReady, false);
assert.equal(snapshot.collectionComplete, true);

assert.equal(NBA_PLAYER_PROPS_SOURCE_POLICY.productionWriterEnabled, true);
assert.equal(NBA_PLAYER_PROPS_SOURCE_POLICY.memberFetches, false);
assert.equal(NBA_PLAYER_PROPS_SOURCE_POLICY.routeEnabled, true);
assert.equal(NBA_PLAYER_PROPS_SOURCE_POLICY.navigationEnabled, true);
assert.equal(nbaPlayerPropsCadenceStage({ now: "2026-10-20T21:30:00.000Z", scheduledStart: "2026-10-21T00:00:00.000Z", slateDate: "10/20/2026" }), "t_minus_180");
assert.equal(nbaPlayerPropsCadenceStage({ now: "2026-10-20T23:05:00.000Z", scheduledStart: "2026-10-21T00:00:00.000Z", slateDate: "10/20/2026" }), "t_minus_60");
assert.equal(nbaPlayerPropsCadenceStage({ now: "2026-10-20T23:50:00.000Z", scheduledStart: "2026-10-21T00:00:00.000Z", slateDate: "10/20/2026" }), "t_minus_15");

assert.deepEqual(planNbaPlayerPropsTheOddsApiCredits({ events: 10, currentSweepsPerEvent: 2 }), {
  currentCredits: 160,
  historicalCredits: 0,
  totalCredits: 160,
});
assert.deepEqual(planNbaPlayerPropsTheOddsApiCredits({ events: 10, historicalSnapshotsPerEvent: 1 }), {
  currentCredits: 0,
  historicalCredits: 800,
  totalCredits: 800,
});
assert.deepEqual(recommendedNbaPlayerPropsRequestPlan({
  gameCount: 10,
  missingOrReferenceGameCount: 2,
  includeBdlOpenings: true,
  theOddsApiCheckpointsPerGapGame: 2,
}), {
  ballDontLieRequests: 21,
  theOddsApiMaxCredits: 32,
  explanation: [
    "One BALLDONTLIE schedule request plus one complete prop response per game.",
    "One BALLDONTLIE opening-prop request per game.",
    "The Odds API is limited to gap/reference games and never fetched from a member request.",
  ],
});

assert.throws(() => planNbaPlayerPropsTheOddsApiCredits({ events: 21 }), /events/);

const historicalGames: NbaHistoricalGame[] = [
  { gameId: 1, season: 2025, startTime: "2025-10-20T00:00:00.000Z", homeTeamId: 1, awayTeamId: 2, homeTeam: "BOS", awayTeam: "NYK", homeScore: 110, awayScore: 100 },
  { gameId: 2, season: 2025, startTime: "2025-10-22T00:00:00.000Z", homeTeamId: 1, awayTeamId: 3, homeTeam: "BOS", awayTeam: "PHI", homeScore: 112, awayScore: 105 },
];
const box = (gameId: number, rowId: number, teamId: number, playerId: number, minutes: number, points: number): NbaHistoricalPlayerBox => ({
  gameId, rowId, teamId, playerId, minutes, points,
  fgm: 8, fga: 16, fg3m: 2, fg3a: 6, ftm: 2, fta: 3,
  oreb: 1, dreb: 5, ast: 7, stl: 1, blk: 1, turnover: 2, pf: 2, plusMinus: 5,
});
const boxes = [
  box(1, 1, 1, 10, 34, 20), box(1, 2, 1, 11, 30, 15), box(1, 3, 2, 20, 35, 25),
  box(2, 4, 1, 10, 36, 24), box(2, 5, 1, 11, 29, 14), box(2, 6, 3, 30, 35, 22),
];
const candidates = [
  { gameId: 1, playerId: 10, playerName: "Player Ten", teamId: 1 },
  { gameId: 2, playerId: 10, playerName: "Player Ten", teamId: 1 },
];
const playerFeatures = buildNbaPlayerPropsPointInTimeFeatures({ games: historicalGames, boxes, candidates });
assert.equal(playerFeatures[0]?.player_games_prior, 0);
assert.equal(playerFeatures[0]?.minutes_mean_5, null);
assert.equal(playerFeatures[1]?.player_games_prior, 1);
assert.equal(playerFeatures[1]?.minutes_mean_5, 34);
assert.equal(playerFeatures[1]?.points_per_minute_10, 20 / 34);
assert.equal(playerFeatures[1]?.rebounds_per_minute_20, 6 / 34);
assert.equal(playerFeatures[1]?.rebounds_per_minute_season, 6 / 34);
assert.equal(playerFeatures[1]?.assists_per_minute_20, 7 / 34);
assert.equal(playerFeatures[1]?.assists_per_minute_season, 7 / 34);
assert.equal(playerFeatures[1]?.threes_per_minute_20, 2 / 34);
assert.equal(playerFeatures[1]?.threes_per_minute_season, 2 / 34);
assert.equal(playerFeatures[1]?.fg3a_per_minute_20, 6 / 34);
assert.equal(playerFeatures[1]?.fg3a_per_minute_season, 6 / 34);
assert.equal(playerFeatures[1]?.target_points, 24);
const mutated = buildNbaPlayerPropsPointInTimeFeatures({
  games: historicalGames,
  boxes: boxes.map((row) => row.gameId === 2 && row.playerId === 10 ? { ...row, points: 99 } : row),
  candidates,
});
assert.equal(mutated[1]?.points_per_minute_10, playerFeatures[1]?.points_per_minute_10, "a target mutation cannot alter its own pregame features");
assert.equal(mutated[1]?.threes_per_minute_season, playerFeatures[1]?.threes_per_minute_season, "long-horizon rates remain point-in-time");
assert.equal(mutated[1]?.target_points, 99, "the target remains available for offline scoring only");

const roleGames: NbaHistoricalGame[] = Array.from({ length: 10 }, (_, index) => ({
  gameId: 100 + index,
  season: 2025,
  startTime: new Date(Date.UTC(2026, 3, 1 + index)).toISOString(),
  homeTeamId: index === 9 ? 4 : 1,
  awayTeamId: index === 9 ? 5 : 2,
  homeTeam: index === 9 ? "PHI" : "ORL",
  awayTeam: index === 9 ? "CLE" : "MIA",
  homeScore: 100,
  awayScore: 95,
}));
const roleBoxes = roleGames.slice(0, 9).flatMap((game, index) => [
  box(game.gameId, 1_000 + index, 1, 81, index === 0 ? 26 : 0, index === 0 ? 10 : 0),
  box(game.gameId, 1_500 + index, 1, 83, 34, 20),
  box(game.gameId, 2_000 + index, 2, 82, 32, 18),
]);
const roleFeature = buildNbaPlayerPropsPointInTimeFeatures({
  games: roleGames.slice(0, 9),
  upcomingGames: [{
    gameId: 109,
    season: 2025,
    startTime: roleGames[9]!.startTime,
    homeTeamId: 4,
    awayTeamId: 5,
    homeTeam: "PHI",
    awayTeam: "CLE",
  }],
  boxes: roleBoxes,
  candidates: [{ gameId: 109, playerId: 81, playerName: "Role Test", teamId: 4 }],
  emitGameIds: new Set([109]),
})[0]!;
assert.equal(roleFeature.player_games_prior, 9, "DNP rows remain available to the participation model");
assert.equal(roleFeature.minutes_mean_10, 26, "DNP rows cannot depress conditional minutes");
assert.equal(roleFeature.points_per_minute_10, 10 / 26, "DNP rows cannot truncate active production windows");
assert.equal(roleFeature.participation_rate_10, null, "prior-team DNPs cannot become current-team participation evidence");
assert.equal(roleFeature.participation_sample_10, 0);
assert.equal(roleFeature.changed_team_since_last_game, 1, "the active prior-team appearance still identifies a team change");

const teamTenureGames: NbaHistoricalGame[] = [
  { gameId: 200, season: 2026, startTime: "2026-10-18T00:00:00.000Z", homeTeamId: 1, awayTeamId: 2, homeTeam: "ORL", awayTeam: "MIA", homeScore: 100, awayScore: 95 },
  { gameId: 201, season: 2026, startTime: "2026-10-20T00:00:00.000Z", homeTeamId: 4, awayTeamId: 5, homeTeam: "PHI", awayTeam: "CLE", homeScore: 108, awayScore: 101 },
];
const teamTenureFeature = buildNbaPlayerPropsPointInTimeFeatures({
  games: teamTenureGames,
  upcomingGames: [{
    gameId: 202,
    season: 2026,
    startTime: "2026-10-22T00:00:00.000Z",
    homeTeamId: 4,
    awayTeamId: 6,
    homeTeam: "PHI",
    awayTeam: "DEN",
  }],
  boxes: [
    box(200, 3_000, 1, 81, 0, 0),
    box(200, 3_004, 1, 84, 30, 12),
    box(200, 3_001, 2, 82, 30, 12),
    box(201, 3_002, 4, 81, 26, 10),
    box(201, 3_003, 5, 83, 30, 12),
  ],
  candidates: [{ gameId: 202, playerId: 81, playerName: "Team Tenure Test", teamId: 4 }],
  emitGameIds: new Set([202]),
})[0]!;
assert.equal(teamTenureFeature.participation_rate_10, 1, "participation begins with the player's current-team tenure");
assert.equal(teamTenureFeature.participation_sample_10, 1, "participation confidence uses the observed team-tenure sample");
assert.equal(teamTenureFeature.minutes_mean_10, 26, "prior-team DNPs cannot contaminate an early-season current role");
assert.equal(teamTenureFeature.same_team_games_10, 1);
assert.equal(teamTenureFeature.changed_team_since_last_game, 0);

const syntheticRows = Array.from({ length: 160 }, (_, index) => {
  const minutes = 24 + (index % 13);
  const pointsRate = 0.45 + (index % 9) * 0.035;
  const reboundRate = 0.14 + (index % 5) * 0.018;
  const assistRate = 0.10 + (index % 7) * 0.016;
  const threeRate = 0.035 + (index % 6) * 0.013;
  return {
    ...playerFeatures[1]!,
    game_id: 10_000 + index,
    player_id: 500 + (index % 18),
    feature_cutoff: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
    player_games_prior: 10 + index,
    team_games_prior: 10 + index,
    participation_rate_10: index % 17 === 0 ? 0.8 : 1,
    minutes_mean_3: minutes - 0.5,
    minutes_mean_5: minutes,
    minutes_mean_10: minutes + 0.3,
    minutes_mean_season: minutes - 0.2,
    points_per_minute_10: pointsRate,
    rebounds_per_minute_10: reboundRate,
    assists_per_minute_10: assistRate,
    threes_per_minute_10: threeRate,
    fga_per_minute_10: pointsRate * 0.72,
    fg3a_per_minute_10: threeRate * 2.8,
    fta_per_minute_10: pointsRate * 0.18,
    target_minutes: minutes + ((index % 3) - 1),
    target_points: Math.max(0, Math.round(pointsRate * minutes + ((index % 5) - 2))),
    target_rebounds: Math.max(0, Math.round(reboundRate * minutes + ((index % 3) - 1))),
    target_assists: Math.max(0, Math.round(assistRate * minutes + ((index % 3) - 1))),
    target_threes: Math.max(0, Math.round(threeRate * minutes + ((index % 3) - 1))),
  };
});
const independentModel = fitNbaPlayerPropsIndependentResearchModel(syntheticRows);
const independentProjection = projectNbaPlayerPropsIndependent(syntheticRows.at(-1)!, independentModel);
assert.equal(independentModel.mode, "offline_research_only");
assert.equal(independentModel.actionable, false);
assert.ok(independentModel.validationResiduals.length >= 25);
assert.ok(independentProjection.conditionalMinutes > 0 && independentProjection.conditionalMinutes <= 48);
assert.equal(
  independentProjection.combinations.points_rebounds_assists,
  Math.round((independentProjection.components.points + independentProjection.components.rebounds + independentProjection.components.assists) * 1_000) / 1_000,
);
const syntheticOver = nbaPlayerPropsProbabilityOver({
  projection: independentProjection,
  model: independentModel,
  market: "points_rebounds_assists",
  line: independentProjection.combinations.points_rebounds_assists - 0.5,
});
assert.ok(syntheticOver !== null && syntheticOver > 0 && syntheticOver < 1);

const replayMarkets = [
  "points",
  "rebounds",
  "assists",
  "threes",
  "points_rebounds_assists",
  "points_rebounds",
  "points_assists",
  "rebounds_assists",
] as const;
const replayOpenings = syntheticRows.slice(120).flatMap((row) => replayMarkets.flatMap((market) => {
  const actual = market === "points" ? row.target_points
    : market === "rebounds" ? row.target_rebounds
      : market === "assists" ? row.target_assists
        : market === "threes" ? row.target_threes
          : market === "points_rebounds_assists" ? row.target_points! + row.target_rebounds! + row.target_assists!
            : market === "points_rebounds" ? row.target_points! + row.target_rebounds!
              : market === "points_assists" ? row.target_points! + row.target_assists!
                : row.target_rebounds! + row.target_assists!;
  const observedAt = new Date(Date.parse(row.feature_cutoff) - 6 * 3_600_000).toISOString();
  return ["over", "under"].map((side) => ({
    ...currentOver,
    providerObservationId: `${row.game_id}:${row.player_id}:${market}:${side}`,
    providerEventId: String(row.game_id),
    canonicalGameId: `nba-bdl:${row.game_id}`,
    canonicalPlayerId: `nba-bdl-player:${row.player_id}`,
    providerPlayerId: String(row.player_id),
    market,
    providerMarket: market,
    side: side as "over" | "under",
    line: Math.max(0.5, actual! + (row.game_id % 2 === 0 ? 0.5 : -0.5)),
    americanPrice: -110,
    observedAt,
    fetchedAt: observedAt,
    isOpening: true,
    scheduledStart: row.feature_cutoff,
  }));
}));
const replay = replayNbaPlayerPropsFoundation({
  trainingRows: syntheticRows.slice(0, 120),
  confirmationRows: syntheticRows.slice(120),
  openingObservations: replayOpenings,
});
assert.equal(replay.mode, "offline_research_only");
assert.equal(replay.actionable, false);
assert.equal(replay.finalMarketReaderStatus, "not_fit");
assert.equal(replay.marketMetrics.points?.rowsWithOutcome, 40);
assert.equal(replay.marketMetrics.points?.rowsWithOpeningLine, 40);
assert.ok((replay.marketMetrics.points?.gradableSides ?? 0) > 0);

async function testOpeningHistory(): Promise<void> {
  const openingHistory = await fetchNbaBdlOpeningPlayerPropsHistory({
    gameIds: [1, 2],
    apiKey: "test",
    requestIntervalMs: 0,
    sleepImpl: async () => undefined,
    fetchImpl: async (input) => {
      const gameId = new URL(String(input)).searchParams.get("game_id");
      return new Response(JSON.stringify({ data: [{
        id: Number(gameId) * 100,
        game_id: Number(gameId),
        player_id: 10,
        vendor: "draftkings",
        prop_type: "points",
        line_value: "20.5",
        market: { type: "over_under", over_odds: -110, under_odds: -110 },
        opened_at: "2025-10-20T12:00:00.000Z",
      }], meta: { per_page: 1 } }), { status: 200 });
    },
  });
  assert.equal(openingHistory.gamesRequested, 2);
  assert.equal(openingHistory.gamesWithProps, 2);
  assert.equal(openingHistory.requests, 2);
  assert.equal(openingHistory.rows.length, 4);
  assert.equal(openingHistory.rows.every((row) => row.isOpening), true);
}

testOpeningHistory()
  .then(() => console.log("NBA player-props non-live provider, coverage, cadence, and budget foundation passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
