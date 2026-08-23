import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardStoredEvidence,
} from "../lib/services/football/nflForwardEvidence";
import {
  buildNflWeekOneHeldMemberFixture,
  NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE,
} from "../lib/services/football/nflWeekOneHeldMemberFixture";
import {
  getNflV1WeekOneOutcomeForecast,
  NFL_V1_OUTCOME_MODEL_RELEASE,
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
} from "../lib/services/football/nflV1WeekOneOutcome";

const capturedAt = "2026-08-22T13:50:56.934Z";
const weekOneSlate = [
  ["NE", "SEA"], ["SF", "LAR"], ["TB", "CIN"], ["NO", "DET"],
  ["NYJ", "TEN"], ["BAL", "IND"], ["ATL", "PIT"], ["CHI", "CAR"],
  ["CLE", "JAX"], ["BUF", "HOU"], ["MIA", "LV"], ["GB", "MIN"],
  ["WSH", "PHI"], ["ARI", "LAC"], ["DAL", "NYG"], ["DEN", "KC"],
] as const;
const rows = Array.from({ length: 16 }, (_, index) => syntheticRow(index + 1));
const fixture = buildNflWeekOneHeldMemberFixture(rows);

assert.equal(fixture.heldMemberFixtureRelease, NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE);
assert.equal(fixture.week.label, "Regular Season Week 1");
assert.equal(fixture.snapshot.games.length, 16);
assert.equal(fixture.tracking.trackingEligible, false);
assert.equal(fixture.coverage.currentOddsGames, 16);
assert.equal(fixture.coverage.openingGames, 16);
assert.equal(fixture.coverage.playbookSplitGames, 16);
assert.equal(fixture.coverage.injuryGames, 16);
assert.equal(fixture.coverage.projectedQuarterbacks, 32);
assert.equal(fixture.coverage.confirmedQuarterbacks, 0);
assert.equal(Object.keys(fixture.availability).length, 16);

const markets = fixture.snapshot.games.flatMap((game) => [
  game.markets.moneyline,
  game.markets.total,
  game.markets.first_inning,
]);
assert.equal(markets.length, 48);
assert.equal(markets.every((market) => market.held), true);
assert.equal(markets.every((market) => market.pick === null), true);
assert.equal(markets.every((market) => market.modelProb === null), true);
assert.equal(markets.every((market) => market.verdict.label === "Held"), true);
assert.equal(markets.every((market) => market.oddsTrail?.length === 2), true);
assert.equal(markets.every((market) => market.opposingOddsTrail?.stops.length === 2), true);
assert.equal(markets.every((market) => market.publicSplits.length === 2), true);
assert.equal(fixture.snapshot.games.every((game) => game.projected.away > 0 && game.projected.home > 0), true);
assert.equal(fixture.snapshot.games.every((game) => game.footballProjection?.modelRelease === NFL_V1_OUTCOME_MODEL_RELEASE), true);
assert.equal(fixture.snapshot.games.every((game) => game.footballProjection?.artifactRelease === NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE), true);
const jax = fixture.snapshot.games.find((game) => game.id === "nfl-1392224");
assert.equal(jax?.awayTeam, "CLE");
assert.equal(jax?.homeTeam, "JAX");
assert.equal(jax?.projected.away.toFixed(1), "17.6");
assert.equal(jax?.projected.home.toFixed(1), "27.7");
assert.equal(jax?.footballProjection?.homeWinProbability.toFixed(3), "0.755");
assert.throws(
  () => getNflV1WeekOneOutcomeForecast({ providerGameId: "1392224", awayTeam: "JAX", homeTeam: "CLE" }),
  /identity mismatch/,
);

const onTimeT60Rows = structuredClone(rows);
onTimeT60Rows[0]!.stage = "t60";
onTimeT60Rows[0]!.payload.stage = "t60";
onTimeT60Rows[0]!.payload.t60LagMinutes = 12;
assert.equal(buildNflWeekOneHeldMemberFixture(onTimeT60Rows).snapshot.games.find((game) => game.id === "nfl-1392216")?.lockState, "locked");

const lateT60Rows = structuredClone(rows);
lateT60Rows[0]!.stage = "t60";
lateT60Rows[0]!.payload.stage = "t60";
lateT60Rows[0]!.payload.t60LagMinutes = 30;
assert.equal(buildNflWeekOneHeldMemberFixture(lateT60Rows).snapshot.games.find((game) => game.id === "nfl-1392216")?.lockState, "open");

const candidateSource = readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx", "utf8");
assert.match(candidateSource, /readCurrentNflWeekOneHeldMemberFixture/);
assert.doesNotMatch(candidateSource, /nflWeekOneEvidenceBoard=\{/);
const readerSource = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
assert.match(readerSource, /projectionIsHeld\(game\)/);
assert.match(readerSource, /No score forecast is being published yet/);

console.log("NFL Week 1 held member fixture: normal 16-game/48-market reader contract, real two-sided context, and per-market fail-closed holds passed");

function syntheticRow(index: number): NflForwardStoredEvidence {
  const providerGameId = String(1_392_215 + index);
  const [away, home] = weekOneSlate[index - 1]!;
  const scheduledStart = new Date(Date.parse("2026-09-10T17:00:00.000Z") + index * 3_600_000).toISOString();
  const quote = (observedAt: string, offset: number) => ({
    providerGameId,
    sportsbook: "fanduel",
    observedAt,
    moneyline: { awayPrice: 110 + offset, homePrice: -130 - offset },
    spread: { awayLine: 2.5, awayPrice: -105 + offset, homeLine: -2.5, homePrice: -115 - offset },
    total: { line: 44.5, overPrice: -108 - offset, underPrice: -112 + offset },
  });
  const split = {
    provider: "playbook" as const,
    capturedAt,
    booksUsed: 5,
    homeMoneyPct: 54,
    awayMoneyPct: 46,
    homeBetsPct: 51,
    awayBetsPct: 49,
    overMoneyPct: 55,
    underMoneyPct: 45,
    overBetsPct: 48,
    underBetsPct: 52,
  };
  const teamDepth = (team: string, quarterback: string) => ({
    provider: "balldontlie" as const,
    team,
    capturedAt,
    sourceSnapshotId: `depth-${team}`,
    starterStatus: "projected" as const,
    expectedStartingQuarterback: {
      playerId: `qb-${team}`,
      name: quarterback,
      position: "QB",
      depth: "QB1",
      depthRank: 1,
      injuryStatus: null,
      explicitStarter: false,
    },
    quarterbackDepth: [],
    roster: [],
  });
  const current = quote(capturedAt, 0);
  const openingQuote = quote("2026-08-22T03:40:02.901Z", 2);
  return {
    id: `row-${providerGameId}`,
    providerGameId,
    stage: "opening",
    capturedAt,
    gameStartAt: scheduledStart,
    payloadSha256: String(index).padStart(64, "0"),
    payload: {
      schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
      collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
      runId: "test-run",
      season: 2026,
      week: 1,
      slateGameCount: 16,
      stage: "opening",
      captureTiming: "on_time",
      capturedAt,
      cutoffAt: null,
      t60LagMinutes: null,
      game: {
        providerGameId,
        providerWeek: 1,
        season: 2026,
        scheduledStart,
        status: "Scheduled",
        away: { id: index * 2, abbreviation: away, name: `Away ${index}` },
        home: { id: index * 2 + 1, abbreviation: home, name: `Home ${index}` },
      },
      market: {
        current,
        currentBooks: [current],
        comparableCurrentBooks: [current],
        providerOpening: openingQuote,
        providerOpeningBooks: [openingQuote],
        comparableProviderOpeningBooks: [openingQuote],
        operationalOpening: {
          provenance: "provider_opening",
          capturedAt: openingQuote.observedAt,
          quote: openingQuote,
        },
        playbookLine: null,
        playbookSplits: { moneyline: split, spread: split, total: split },
        sharpApiSplits: null,
      },
      startersAndDepth: {
        away: teamDepth(away, `Away QB ${index}`),
        home: teamDepth(home, `Home QB ${index}`),
      },
      injuries: {
        eventId: providerGameId,
        awayTeam: away,
        homeTeam: home,
        source: "BALLDONTLIE",
        sourceLabel: "BALLDONTLIE NFL injuries",
        sourceUrl: null,
        reportUpdatedAt: capturedAt,
        teams: [
          { abbreviation: away, teamName: `Away ${index}`, players: [] },
          { abbreviation: home, teamName: `Home ${index}`, players: [] },
        ],
      },
      weather: {
        venueTeam: home,
        venueName: "Test Stadium",
        roofType: "outdoor",
        status: "outside_forecast_window",
        capturedAt,
        forecast: null,
      },
      decisions: {
        evaluatedBets: [],
        outcomeConfidence: [],
        modelPromotionStatus: "blocked_pending_independent_validation",
        publicationEnabled: false,
        trackingEnabled: false,
      },
      coverage: {
        currentOdds: true,
        currentBookCount: 1,
        comparableCurrentBookCount: 1,
        multibookConsensusReady: false,
        operationalOpening: true,
        rosterAndDepth: true,
        expectedQuarterbacks: true,
        injuries: true,
        playbookSplits: true,
        sharpApiSplits: false,
        weather: false,
        healthHolds: ["sharpapi_splits_unavailable"],
      },
      requestBudget: {
        balldontlieSlate: 1,
        balldontlieRoster: 1,
        balldontlieInjuriesMaximum: 1,
        playbook: 1,
        sharpApi: 1,
        weather: 1,
        totalMaximum: 6,
      },
    },
  };
}
