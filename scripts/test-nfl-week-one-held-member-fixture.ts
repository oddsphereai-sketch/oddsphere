import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { NflPreviewBookOdds } from "../lib/services/football/balldontlieNflPreviewSlate";
import {
  NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../lib/services/football/nflForwardEvidence";
import {
  buildNflWeekOneHeldMemberFixture,
  NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE,
} from "../lib/services/football/nflWeekOneHeldMemberFixture";
import {
  getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities,
  NFL_V1_OUTCOME_MODEL_RELEASE,
  NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE,
} from "../lib/services/football/nflV1WeekOneOutcome";
import { buildNflV1ActionableGradeBundle } from "../lib/services/football/nflV1ActionableGradeCandidate";
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
assert.equal(markets.filter((market) => market.verdict.label === "Best Angle").length, 7);
assert.equal(markets.filter((market) => market.verdict.label === "Lean").length, 17);
assert.equal(markets.filter((market) => market.verdict.label === "Watchlist").length, 10);
assert.equal(markets.filter((market) => market.verdict.label === "No Play").length, 14);
assert.equal(markets.every((market) => (market.oddsTrail?.length ?? 0) >= 1), true);
assert.equal(markets.every((market) => (market.opposingOddsTrail?.stops.length ?? 0) >= 1), true);
assert.equal(markets.every((market) => market.publicSplits.length === 2), true);

const laterCapture = "2026-08-22T14:50:56.934Z";
const laterFirstGame = structuredClone(rows[0]!);
laterFirstGame.id = "row-1392216-later";
laterFirstGame.stage = "unlocked";
laterFirstGame.capturedAt = laterCapture;
laterFirstGame.payloadSha256 = "f".repeat(64);
const laterPayload = laterFirstGame.payload as NflForwardEvidencePayload;
const firstPayload = rows[0]!.payload as NflForwardEvidencePayload;
const moveQuote = (quote: NflPreviewBookOdds): NflPreviewBookOdds => ({
  ...structuredClone(quote),
  observedAt: laterCapture,
  moneyline: quote.moneyline ? {
    awayPrice: quote.moneyline.awayPrice + 7,
    homePrice: quote.moneyline.homePrice - 7,
  } : null,
  spread: quote.spread ? {
    awayLine: quote.spread.awayLine + 0.5,
    awayPrice: quote.spread.awayPrice + 3,
    homeLine: quote.spread.homeLine - 0.5,
    homePrice: quote.spread.homePrice - 3,
  } : null,
  total: quote.total ? {
    line: quote.total.line + 1,
    overPrice: quote.total.overPrice - 4,
    underPrice: quote.total.underPrice + 4,
  } : null,
});
laterPayload.stage = "unlocked";
laterPayload.capturedAt = laterCapture;
laterPayload.runId = "test-run-later";
laterPayload.market.current = moveQuote(laterPayload.market.current);
laterPayload.market.currentBooks = laterPayload.market.currentBooks.map(moveQuote);
laterPayload.market.comparableCurrentBooks = laterPayload.market.comparableCurrentBooks.map(moveQuote);
laterPayload.decisions.evaluatedBets = laterPayload.decisions.evaluatedBets.map((decision) => {
  const quote = laterPayload.market.currentBooks.find((candidate) =>
    candidate.sportsbook === decision.evaluatedQuote.sportsbook)!;
  const selectedHome = decision.side.startsWith(laterPayload.game.home.abbreviation);
  const evaluatedQuote = decision.market === "moneyline"
    ? { line: null, price: selectedHome ? quote.moneyline!.homePrice : quote.moneyline!.awayPrice }
    : decision.market === "spread"
      ? {
          line: selectedHome ? quote.spread!.homeLine : quote.spread!.awayLine,
          price: selectedHome ? quote.spread!.homePrice : quote.spread!.awayPrice,
        }
      : {
          line: quote.total!.line,
          price: decision.side.startsWith("Over") ? quote.total!.overPrice : quote.total!.underPrice,
        };
  return {
    ...decision,
    evaluatedAt: laterCapture,
    evaluatedQuote: {
      ...decision.evaluatedQuote,
      ...evaluatedQuote,
      observedAt: laterCapture,
    },
  };
});
const multiWaveFixture = buildNflWeekOneHeldMemberFixture([...rows, laterFirstGame]);
const multiWaveGame = multiWaveFixture.snapshot.games.find((game) => game.id === "nfl-1392216")!;
const multiWaveMarkets = [
  ["moneyline", multiWaveGame.markets.moneyline],
  ["total", multiWaveGame.markets.total],
  ["spread", multiWaveGame.markets.first_inning],
] as const;
for (const [marketName, market] of multiWaveMarkets) {
  assert.equal((market.oddsTrail?.length ?? 0) >= 2, true);
  assert.equal(new Set(market.oddsTrail?.map((stop) => stop.sportsbook)).size, 1);
  assert.equal(market.oddsTrail?.every((stop, index, stops) =>
    index === 0 || Date.parse(stop.observedAt!) >= Date.parse(stops[index - 1]!.observedAt!)), true);
  const prior = market.oddsTrail!.at(-2)!;
  const current = market.oddsTrail!.at(-1)!;
  const firstDecision = firstPayload.decisions.evaluatedBets.find((decision) => decision.market === marketName)!;
  const laterDecision = laterPayload.decisions.evaluatedBets.find((decision) => decision.market === marketName)!;
  assert.equal(prior.sportsbook, firstDecision.evaluatedQuote.sportsbook);
  assert.equal(prior.american, firstDecision.evaluatedQuote.price);
  assert.equal(prior.line, firstDecision.evaluatedQuote.line);
  assert.equal(prior.observedAt, firstPayload.capturedAt);
  assert.equal(current.sportsbook, laterDecision.evaluatedQuote.sportsbook);
  assert.equal(current.american, laterDecision.evaluatedQuote.price);
  assert.equal(current.line, laterDecision.evaluatedQuote.line);
  assert.equal(current.observedAt, laterCapture);
  assert.notDeepEqual(
    { american: prior.american, line: prior.line },
    { american: current.american, line: current.line },
  );
  assert.equal((market.opposingOddsTrail?.stops.length ?? 0) >= 2, true);
  assert.equal(new Set(market.opposingOddsTrail?.stops.map((stop) => stop.sportsbook)).size, 1);
  assert.equal(market.opposingOddsTrail?.stops.every((stop) => stop.sportsbook === current.sportsbook), true);
}
assert.notEqual(multiWaveFixture.provenance.sourceChecksum, fixture.provenance.sourceChecksum);

const flatCapture = (source: NflForwardStoredEvidence, nextCapture: string, suffix: string) => {
  const row = structuredClone(source);
  row.id = `${source.id}-${suffix}`;
  row.capturedAt = nextCapture;
  row.payloadSha256 = suffix.repeat(64).slice(0, 64);
  const payload = row.payload as NflForwardEvidencePayload;
  payload.capturedAt = nextCapture;
  payload.runId = `test-run-${suffix}`;
  payload.market.current.observedAt = nextCapture;
  payload.market.currentBooks = payload.market.currentBooks.map((quote) => ({ ...quote, observedAt: nextCapture }));
  payload.market.comparableCurrentBooks = payload.market.comparableCurrentBooks.map((quote) => ({ ...quote, observedAt: nextCapture }));
  payload.decisions.evaluatedBets = payload.decisions.evaluatedBets.map((decision) => ({
    ...decision,
    evaluatedAt: nextCapture,
    evaluatedQuote: { ...decision.evaluatedQuote, observedAt: nextCapture },
  }));
  return row;
};
const flatIntermediateCapture = "2026-08-22T15:10:56.934Z";
const flatTerminalCapture = "2026-08-22T15:30:56.934Z";
const flatIntermediate = flatCapture(laterFirstGame, flatIntermediateCapture, "a");
const flatTerminal = flatCapture(laterFirstGame, flatTerminalCapture, "b");
const compactFixture = buildNflWeekOneHeldMemberFixture([
  ...rows,
  laterFirstGame,
  flatIntermediate,
  flatTerminal,
]);
const compactGame = compactFixture.snapshot.games.find((game) => game.id === "nfl-1392216")!;
for (const market of [compactGame.markets.moneyline, compactGame.markets.total, compactGame.markets.first_inning]) {
  const trail = market.oddsTrail!;
  assert.equal(trail.at(-1)?.label, "current");
  assert.equal(trail.at(-1)?.observedAt, flatTerminalCapture);
  assert.equal(trail.some((stop) => stop.observedAt === laterCapture), true);
  assert.equal(trail.some((stop) => stop.observedAt === flatIntermediateCapture), false);
  assert.equal(trail.length <= 4, true);
  assert.equal(trail.slice(1, -1).every((stop, index) =>
    stop.american !== trail[index]!.american || stop.line !== trail[index]!.line), true);
}

assert.equal(fixture.snapshot.games.every((game) => game.projected.away > 0 && game.projected.home > 0), true);
assert.equal(fixture.snapshot.games.every((game) => game.footballProjection?.modelRelease === NFL_V1_OUTCOME_MODEL_RELEASE), true);
assert.equal(fixture.snapshot.games.every((game) => game.footballProjection?.artifactRelease === NFL_V1_WEEK_ONE_OUTCOME_ARTIFACT_RELEASE), true);
assert.equal(fixture.snapshot.games.every((game) => {
  const forecast = game.footballProjection!;
  const representativeHomeWins = game.projected.home > game.projected.away;
  const expectedHomeWins = forecast.expectedHomePoints > forecast.expectedAwayPoints;
  const probabilityHomeWins = forecast.homeWinProbability > forecast.awayWinProbability;
  return representativeHomeWins === expectedHomeWins && expectedHomeWins === probabilityHomeWins;
}), true);
const jax = fixture.snapshot.games.find((game) => game.id === "nfl-1392224");
assert.equal(jax?.awayTeam, "CLE");
assert.equal(jax?.homeTeam, "JAX");
assert.equal(jax?.projected.away, 17);
assert.equal(jax?.projected.home, 27);
assert.equal(jax?.footballProjection?.expectedAwayPoints.toFixed(1), "17.6");
assert.equal(jax?.footballProjection?.expectedHomePoints.toFixed(1), "27.7");
assert.equal(jax?.footballProjection?.homeWinProbability.toFixed(3), "0.770");
const jaxForecast = getNflV1WeekOneOutcomeForecast({ providerGameId: "1392224", awayTeam: "CLE", homeTeam: "JAX" });
const distributionMean = (distribution: { values: number[]; probabilities: number[] }) =>
  distribution.values.reduce((sum, value, index) => sum + value * distribution.probabilities[index]!, 0);
const distributionSplit = (
  distribution: { values: number[]; probabilities: number[] },
  difference: (value: number) => number,
) => distribution.values.reduce((summary, value, index) => {
  const probability = distribution.probabilities[index]!;
  const result = difference(value);
  if (result > 0) summary.positive += probability;
  else if (result < 0) summary.negative += probability;
  else summary.push += probability;
  return summary;
}, { positive: 0, negative: 0, push: 0 });
const expectedMargin = distributionMean(jaxForecast.marginDistribution);
const expectedTotal = distributionMean(jaxForecast.totalDistribution);
assert.equal(((expectedTotal - expectedMargin) / 2).toFixed(6), jaxForecast.expectedAwayScore.toFixed(6));
assert.equal(((expectedTotal + expectedMargin) / 2).toFixed(6), jaxForecast.expectedHomeScore.toFixed(6));
const winnerSplit = distributionSplit(jaxForecast.marginDistribution, (margin) => margin);
assert.equal(
  (winnerSplit.positive / (winnerSplit.positive + winnerSplit.negative)).toFixed(6),
  jaxForecast.homeWinProbability.toFixed(6),
);
assert.equal(
  (winnerSplit.negative / (winnerSplit.positive + winnerSplit.negative)).toFixed(6),
  jaxForecast.awayWinProbability.toFixed(6),
);
assert.equal(winnerSplit.push.toFixed(6), jaxForecast.tieProbability.toFixed(6));
const jaxLineProbabilities = nflV1WeekOneLineProbabilities({
  forecast: jaxForecast,
  homeSpread: -7.5,
  totalLine: 40.5,
});
const directSpread = distributionSplit(jaxForecast.marginDistribution, (margin) => margin - 7.5);
const directTotal = distributionSplit(jaxForecast.totalDistribution, (points) => points - 40.5);
assert.equal(
  jaxLineProbabilities.spread.homeCoverProbability.toFixed(6),
  (directSpread.positive / (directSpread.positive + directSpread.negative)).toFixed(6),
);
assert.equal(
  jaxLineProbabilities.spread.awayCoverProbability.toFixed(6),
  (directSpread.negative / (directSpread.positive + directSpread.negative)).toFixed(6),
);
assert.equal(jaxLineProbabilities.spread.pushProbability.toFixed(6), directSpread.push.toFixed(6));
assert.equal(
  jaxLineProbabilities.total.overProbability.toFixed(6),
  (directTotal.positive / (directTotal.positive + directTotal.negative)).toFixed(6),
);
assert.equal(
  jaxLineProbabilities.total.underProbability.toFixed(6),
  (directTotal.negative / (directTotal.positive + directTotal.negative)).toFixed(6),
);
assert.equal(jaxLineProbabilities.total.pushProbability.toFixed(6), directTotal.push.toFixed(6));
assert.equal(jaxForecast.marginDistribution.values.includes(jaxForecast.representativeHomeScore - jaxForecast.representativeAwayScore), true);
assert.equal(jaxForecast.totalDistribution.values.includes(jaxForecast.representativeHomeScore + jaxForecast.representativeAwayScore), true);
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
assert.doesNotMatch(candidateSource, /readCurrentNflPublishedMemberSnapshot/);
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
assert.match(readerSource, /Expected score/);
assert.match(readerSource, /Primary prediction · joint PMF means/);
assert.match(readerSource, /Reachable representative final/);
assert.match(readerSource, /Representative final/);
assert.match(readerSource, /primaryProjectedAway\.toFixed\(1\)/);
assert.match(readerSource, /primaryProjectedHome\.toFixed\(1\)/);
assert.match(readerSource, /footballExpectedAway\.toFixed\(1\)/);
assert.match(readerSource, /footballExpectedHome\.toFixed\(1\)/);
assert.match(readerSource, /Counts show games containing at least one market with each grade/);
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
  const currentComparableBooks = comparableBooks(current);
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
  const production = buildNflV1ActionableGradeBundle({
    providerGameId,
    awayTeam: away,
    homeTeam: home,
    gameStartsAt: scheduledStart,
    current,
    comparableCurrentBooks: currentComparableBooks,
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
        currentBooks: currentComparableBooks,
        comparableCurrentBooks: currentComparableBooks,
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

function comparableBooks(current: NflPreviewBookOdds): NflPreviewBookOdds[] {
  return [
    current,
    { ...structuredClone(current), sportsbook: "draftkings" },
    { ...structuredClone(current), sportsbook: "caesars" },
  ];
}
