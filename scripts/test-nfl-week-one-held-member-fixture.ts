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
import { buildNflV1ProductionDecisionBundle } from "../lib/services/football/nflV1ProductionDecision";
import {
  NFL_R6_MONEYLINE_CALIBRATION_RELEASE,
  NFL_R6_MONEYLINE_DECISION_RELEASE,
  NFL_R6_MONEYLINE_MODEL_RELEASE,
  NFL_R6_RUNTIME_ARTIFACT_RELEASE,
  NFL_R6_SHADOW_DECISION_SCHEMA_RELEASE,
  NFL_R6_SOURCE_POINT_MODEL_RELEASE,
  type NflR6ShadowMoneylineDecision,
} from "../lib/services/football/nflR6MoneylineShadow";

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
assert.equal(markets.every((market) => !market.held), true);
assert.equal(markets.every((market) => market.pick !== null), true);
assert.equal(markets.every((market) => market.modelProb !== null), true);
assert.equal(markets.filter((market) => market.verdict.label === "Lean").length, 8);
assert.equal(markets.filter((market) => market.verdict.label === "Watchlist").length, 8);
assert.equal(markets.filter((market) => market.verdict.label === "No Play").length, 32);
assert.equal(markets.every((market) => (market.oddsTrail?.length ?? 0) >= 1), true);
assert.equal(markets.every((market) => (market.opposingOddsTrail?.stops.length ?? 0) >= 1), true);
assert.equal(markets.every((market) => market.publicSplits.length === 2), true);
assert.equal(fixture.snapshot.games.every((game) => game.projected.away > 0 && game.projected.home > 0), true);
assert.equal(fixture.snapshot.games.every((game) => game.footballProjection?.modelRelease === NFL_V1_OUTCOME_MODEL_RELEASE), true);
assert.equal(fixture.snapshot.games.every((game) => game.footballProjection?.artifactRelease === NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE), true);
const jax = fixture.snapshot.games.find((game) => game.id === "nfl-1392224");
assert.equal(jax?.awayTeam, "CLE");
assert.equal(jax?.homeTeam, "JAX");
assert.equal(jax?.projected.away, 17);
assert.equal(jax?.projected.home, 27);
assert.equal(jax?.footballProjection?.homeWinProbability.toFixed(3), "0.770");
assert.throws(
  () => getNflV1WeekOneOutcomeForecast({ providerGameId: "1392224", awayTeam: "JAX", homeTeam: "CLE" }),
  /identity mismatch/,
);

const onTimeT60Rows = structuredClone(rows);
onTimeT60Rows[0]!.stage = "t60";
onTimeT60Rows[0]!.payload.stage = "t60";
onTimeT60Rows[0]!.payload.t60LagMinutes = 12;
assert.equal(buildNflWeekOneHeldMemberFixture(onTimeT60Rows).snapshot.games.find((game) => game.id === "nfl-1392216")?.lockState, "open");

const lateT60Rows = structuredClone(rows);
lateT60Rows[0]!.stage = "t60";
lateT60Rows[0]!.payload.stage = "t60";
lateT60Rows[0]!.payload.t60LagMinutes = 30;
assert.equal(buildNflWeekOneHeldMemberFixture(lateT60Rows).snapshot.games.find((game) => game.id === "nfl-1392216")?.lockState, "open");

const candidateSource = readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx", "utf8");
assert.match(candidateSource, /readCurrentNflWeekOneHeldMemberFixture/);
assert.doesNotMatch(candidateSource, /nflWeekOneEvidenceBoard=\{/);
const readerSource = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
const collapsedReaderSource = readerSource.slice(
  readerSource.indexOf("function CollapsedReader"),
  readerSource.indexOf("function ReaderSurface"),
);
const footballOutcomeForecastSource = readerSource.slice(
  readerSource.indexOf("function FootballOutcomeForecast"),
  readerSource.indexOf("function PredictionDriverCard"),
);
assert.match(readerSource, /projectionIsHeld\(game\)/);
assert.match(readerSource, /footballOutcomeContext\(game\)/);
assert.match(readerSource, /Outcome forecast/);
assert.match(readerSource, /Win probability/);
assert.match(readerSource, /The discrete football model favors/);
assert.match(readerSource, /Value-model probability/);
assert.match(readerSource, /nflSelectedBetGrade\(market\)/);
assert.match(readerSource, /Bet grade \{footballBetGrade\.label\}/);
assert.match(readerSource, /Bet grade \{betGrade\.label\}/);
assert.match(readerSource, /currently \{betGrade\.label\}/);
assert.doesNotMatch(collapsedReaderSource, /Bet grade held/);
assert.doesNotMatch(collapsedReaderSource, /Bet grade remains separate and Held/);
assert.doesNotMatch(footballOutcomeForecastSource, /Held does not erase the prediction/);

console.log("NFL Week 1 member fixture: 16 games, 48 predictions, live Leans/Watchlists/No Plays, and fail-closed health Holds passed");

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
  const outcome = getNflV1WeekOneOutcomeForecast({ providerGameId, awayTeam: away, homeTeam: home });
  const selectHome = outcome.homeWinProbability >= outcome.awayWinProbability;
  const selectedTeam = selectHome ? home : away;
  const selectedProbability = selectHome ? outcome.homeWinProbability : outcome.awayWinProbability;
  const shadowMoneyline: NflR6ShadowMoneylineDecision = {
    schemaRelease: NFL_R6_SHADOW_DECISION_SCHEMA_RELEASE,
    decisionKind: "shadow_exact_price_bet",
    shadowOnly: true,
    publicationEligible: false,
    trackingEligible: false,
    providerGameId,
    market: "moneyline",
    grade: index <= 8 ? "Lean" : "Held",
    side: selectHome ? "home" : "away",
    team: selectedTeam,
    modelProbability: selectedProbability,
    otherBooksConsensusFairProbability: 0.5,
    targetBookFairProbability: 0.5,
    otherBookCount: 4,
    evaluatedQuote: {
      sportsbook: current.sportsbook,
      line: null,
      price: selectHome ? current.moneyline!.homePrice : current.moneyline!.awayPrice,
      observedAt: current.observedAt,
    },
    expectedValuePerUnit: 0.02,
    edgePercentagePoints: (selectedProbability - 0.5) * 100,
    decisionStage: "opening_evaluation",
    evaluatedAt: current.observedAt,
    gameStartsAt: scheduledStart,
    lockedAt: null,
    reason: index <= 8 ? "uncapped_market_led_exact_price_candidate" : "exact_price_does_not_clear_candidate_thresholds",
    footballProjection: null,
    quarterbackContext: {
      away: { name: `Away QB ${index}`, historyMatched: true, status: "projected" },
      home: { name: `Home QB ${index}`, historyMatched: true, status: "projected" },
    },
    health: {
      blockingReasons: [],
      quarterbackReasons: ["away_quarterback_projected_not_confirmed", "home_quarterback_projected_not_confirmed"],
      contextReasons: ["sharpapi_splits_unavailable"],
    },
    runtimeArtifactRelease: NFL_R6_RUNTIME_ARTIFACT_RELEASE,
    modelRelease: NFL_R6_MONEYLINE_MODEL_RELEASE,
    calibrationRelease: NFL_R6_MONEYLINE_CALIBRATION_RELEASE,
    decisionRelease: NFL_R6_MONEYLINE_DECISION_RELEASE,
    sourcePointModelRelease: NFL_R6_SOURCE_POINT_MODEL_RELEASE,
  };
  const production = buildNflV1ProductionDecisionBundle({
    providerGameId,
    awayTeam: away,
    homeTeam: home,
    gameStartsAt: scheduledStart,
    current,
    shadowMoneyline,
  });
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
        evaluatedBets: production.evaluatedBets,
        outcomeConfidence: production.outcomeConfidence,
        modelPromotionStatus: production.modelPromotionStatus,
        publicationEnabled: production.publicationEnabled,
        trackingEnabled: production.trackingEnabled,
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
