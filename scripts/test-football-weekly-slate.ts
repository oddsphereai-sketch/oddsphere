import assert from "node:assert/strict";
import {
  NFL_SHADOW_MODEL_RELEASE,
  type FootballShadowForecast,
} from "../lib/services/football/footballModelContract";
import {
  FOOTBALL_WEEKLY_SLATE_CONTRACT_RELEASE,
  buildFootballWeeklySlate,
  selectActiveFootballWeeklySlate,
  type FootballWeekIdentity,
  type FootballWeeklyGame,
} from "../lib/services/football/footballWeeklySlate";
import {
  FOOTBALL_WEEKLY_READER_CONTRACT_RELEASE,
  buildFootballWeeklyReader,
} from "../lib/services/football/footballWeeklyReader";

const nflWeek1: FootballWeekIdentity = { league: "nfl", season: 2026, seasonPhase: "regular", week: 1 };
const nflWeek2: FootballWeekIdentity = { league: "nfl", season: 2026, seasonPhase: "regular", week: 2 };

function game(overrides: Partial<FootballWeeklyGame> & { id: string; kickoff: string }): FootballWeeklyGame {
  const identity = overrides.identity ?? {
    ...nflWeek1,
    providerGameId: overrides.id,
    scheduledStart: overrides.kickoff,
    homeTeamId: `home-${overrides.id}`,
    awayTeamId: `away-${overrides.id}`,
    neutralSite: false,
    venue: null,
  };
  return {
    status: "scheduled",
    countsTowardWeekCompletion: true,
    homeTeam: { id: identity.homeTeamId, name: `Home ${overrides.id}`, abbreviation: "HME", ranking: null, record: null },
    awayTeam: { id: identity.awayTeamId, name: `Away ${overrides.id}`, abbreviation: "AWY", ranking: null, record: null },
    homeScore: null,
    awayScore: null,
    broadcast: null,
    forecast: null,
    markets: {},
    reasons: [],
    dataHealth: {
      identity: "ready",
      schedule: "ready",
      independentProjection: "ready",
      currentPrices: "ready",
      marketHistory: "partial",
      publicConsensusSplits: "partial",
      sourceBookSplits: "partial",
      personnel: "ready",
      findings: [],
    },
    actionable: false,
    ...overrides,
    identity,
  };
}

function slate(week: FootballWeekIdentity, games: FootballWeeklyGame[]) {
  return buildFootballWeeklySlate({
    week,
    availableWeeks: [nflWeek1, nflWeek2],
    generatedAt: "2026-09-09T12:00:00Z",
    games,
    providerRequestCount: 3,
  });
}

const thursdayFinal = game({ id: "thu", kickoff: "2026-09-11T00:20:00Z", status: "final", homeScore: 24, awayScore: 20 });
const sundayUpcoming = game({ id: "sun", kickoff: "2026-09-13T17:00:00Z" });
const mondayUpcoming = game({ id: "mon", kickoff: "2026-09-15T00:15:00Z" });
const current = slate(nflWeek1, [mondayUpcoming, thursdayFinal, sundayUpcoming]);

assert.equal(current.contractRelease, FOOTBALL_WEEKLY_SLATE_CONTRACT_RELEASE);
assert.equal(current.state, "open");
assert.deepEqual(current.games.map((row) => row.identity.providerGameId), ["thu", "sun", "mon"], "weekly games must be ordered by kickoff");
assert.equal(current.localOnly, true);
assert.equal(current.actionable, false);

const next = slate(nflWeek2, [
  game({
    id: "w2",
    kickoff: "2026-09-18T00:15:00Z",
    identity: {
      ...nflWeek2,
      providerGameId: "w2",
      scheduledStart: "2026-09-18T00:15:00Z",
      homeTeamId: "w2-home",
      awayTeamId: "w2-away",
      neutralSite: false,
      venue: null,
    },
  }),
]);
assert.equal(selectActiveFootballWeeklySlate([next, current])?.week.week, 1, "a partially completed NFL week must stay active through Monday");

const completed = slate(nflWeek1, current.games.map((row) => ({ ...row, status: "final" as const, homeScore: 27, awayScore: 17 })));
assert.equal(completed.state, "complete");
assert.equal(selectActiveFootballWeeklySlate([next, completed])?.week.week, 2, "the weekly reader advances only after the current week completes");
assert.equal(selectActiveFootballWeeklySlate([next, completed], nflWeek1)?.week.week, 1, "the founder reader may explicitly revisit a completed week");

const canceled = slate(nflWeek1, current.games.map((row) => row.identity.providerGameId === "mon"
  ? { ...row, status: "canceled" as const, countsTowardWeekCompletion: false }
  : { ...row, status: "final" as const }));
assert.equal(canceled.state, "complete", "a canceled or formally moved game must not pin a week forever");

const collecting = slate(nflWeek1, [game({
  id: "collecting",
  kickoff: "2026-09-13T17:00:00Z",
  dataHealth: { ...sundayUpcoming.dataHealth, currentPrices: "missing", findings: ["current market unavailable"] },
})]);
assert.equal(collecting.state, "collecting");

const reader = buildFootballWeeklyReader(current);
assert.equal(reader.readerRelease, FOOTBALL_WEEKLY_READER_CONTRACT_RELEASE);
assert.equal(reader.weekLabel, "NFL Week 1");
assert.equal(reader.selectedGameId, "sun", "the default reader selection should be the next unfinished game");
assert.equal(reader.days.length, 3, "Thursday, Sunday, and Monday remain one week but separate display groups");
assert.deepEqual(reader.summary, {
  scheduled: 2,
  live: 0,
  final: 1,
  held: 0,
  projectionReady: 3,
  priceReady: 3,
  publicConsensusReady: 0,
});
assert.equal(reader.actionable, false);

const ncaafWeek0: FootballWeekIdentity = { league: "ncaaf", season: 2026, seasonPhase: "regular", week: 0 };
assert.equal(buildFootballWeeklySlate({
  week: ncaafWeek0,
  availableWeeks: [ncaafWeek0],
  generatedAt: "2026-08-22T12:00:00Z",
  games: [],
  providerRequestCount: 0,
}).state, "hold", "NCAAF Week 0 is a valid explicit week even before games are populated");

assert.throws(() => buildFootballWeeklySlate({
  week: nflWeek1,
  availableWeeks: [nflWeek1],
  generatedAt: "2026-09-09T12:00:00Z",
  games: [game({
    id: "mixed",
    kickoff: "2026-09-18T00:15:00Z",
    identity: { ...mondayUpcoming.identity, week: 2, providerGameId: "mixed" },
  })],
  providerRequestCount: 1,
}), /cannot mix leagues, seasons, phases, or weeks/);

assert.throws(() => buildFootballWeeklySlate({
  week: { league: "nfl", season: 2026, seasonPhase: "bowl", week: 1 },
  availableWeeks: [],
  generatedAt: "2026-09-09T12:00:00Z",
  games: [],
  providerRequestCount: 0,
}), /NFL weeks cannot use the bowl season phase/);

const mismatchedForecast = {
  status: "shadow",
  identity: { ...sundayUpcoming.identity, week: 2 },
  releases: {
    researchSchemaRelease: "football_pregame_research_schema_2026_08_19_r2",
    modelRelease: NFL_SHADOW_MODEL_RELEASE,
    featureRelease: "test",
    calibrationRelease: "unfit",
    decisionRelease: "unfit",
  },
  independent: null,
  calibratedProbabilities: { homeWin: null, homeCover: null, over: null },
  selectedSide: {},
  dataHealthFindings: [],
  actionable: false,
} satisfies FootballShadowForecast;
assert.throws(() => slate(nflWeek1, [game({ id: "bad-forecast", kickoff: "2026-09-13T17:00:00Z", forecast: mismatchedForecast })]), /forecast identity does not match/);

console.log("Football weekly slate: lifecycle, grouping, health, and local-only boundaries passed");
