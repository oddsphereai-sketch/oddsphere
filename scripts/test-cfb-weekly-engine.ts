import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
  buildCfbForwardMarketOutlooks,
  hashCfbForwardEvidencePayload,
  type CfbForwardEvidencePayload,
  type CfbForwardStoredEvidence,
  type CfbForwardTeamQuarterbacks,
} from "../lib/services/football/cfbForwardEvidence";
import { CFB_FORWARD_MAX_QB_TEAMS_PER_RUN, latestCfbPayloadTimestamp, selectCfbModelCoveredWeeklyGames, selectQuarterbackTeams } from "../lib/services/football/cfbForwardEvidenceWriter";
import { buildCfbMemberFixture } from "../lib/services/football/cfbMemberFixture";
import {
  CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE,
  CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
} from "../lib/services/football/cfbMarketSharpAwareShadow";
import {
  buildCfbV1DecisionBundle,
  cfbV1LineProbabilities,
  getCfbV1ForecastForGame,
  getCfbV1Forecasts,
} from "../lib/services/football/cfbV1Decision";
import { cfbV1WeeklyGameProfileCoverage } from "../lib/services/football/cfbV1WeeklyForecast";
import { activeCfbWeeklyWindow, eligibleCfbWeeklyGames, resolveCfbForwardWindow } from "../lib/services/football/cfbWeeklyWindow";
import type { NcaafGame, NcaafTeam } from "../lib/services/football/balldontlieNcaafSlate";

const openingWindow = activeCfbWeeklyWindow("2026-08-25T16:00:00.000Z");
assert.equal(latestCfbPayloadTimestamp({
  runStartedAt: "2026-08-28T20:09:48.647Z",
  books: [{ observedAt: "2026-08-28T20:10:09.511Z" }],
  sharpApiSplits: [{ capturedAt: "2026-08-28T20:09:55.000Z" }],
}), "2026-08-28T20:10:09.511Z", "the immutable capture/evaluation time must include provider observations received after run start");
assert.deepEqual(
  { start: openingWindow.boardStartDate, end: openingWindow.boardEndDate, queryEnd: openingWindow.providerQueryEndDate },
  { start: "2026-08-27", end: "2026-08-31", queryEnd: "2026-09-01" },
);
const weekOneWindow = activeCfbWeeklyWindow("2026-09-01T12:00:00.000Z");
assert.deepEqual(
  { start: weekOneWindow.boardStartDate, end: weekOneWindow.boardEndDate, queryEnd: weekOneWindow.providerQueryEndDate },
  { start: "2026-09-03", end: "2026-09-07", queryEnd: "2026-09-08" },
);
assert.equal(activeCfbWeeklyWindow("2026-10-20T12:00:00.000Z").boardStartDate, "2026-10-22", "future weeks cannot depend on launch IDs");

const frozen = getCfbV1Forecasts();
assert.equal(frozen.length, 8);
for (const forecast of frozen) {
  const parity = getCfbV1ForecastForGame({ game: game({ id: forecast.providerGameId, start: forecast.gameStartsAt, awayName: forecast.awayTeam, homeName: forecast.homeTeam }) });
  assert.deepEqual(parity.forecast, forecast, `${forecast.providerGameId} opening-week PMF and forecast must remain byte-equivalent`);
}

const weekOneGame = game({
  id: "week-one-new-id",
  start: "2026-09-05T19:30:00.000Z",
  awayName: "Alabama Crimson Tide",
  awayAbbreviation: "BAMA",
  homeName: "Ohio State Buckeyes",
  homeAbbreviation: "OSU",
  week: 2,
});
const generated = getCfbV1ForecastForGame({ game: weekOneGame });
assert.deepEqual(generated.featureHealth, { awayProfile: "matched", homeProfile: "matched", completedGamesApplied: 0 });
assertPmfCoherence(generated.forecast);
assert.ok(generated.forecast.expectedAwayPoints >= 3 && generated.forecast.expectedAwayPoints <= 60);
assert.ok(generated.forecast.expectedHomePoints >= 3 && generated.forecast.expectedHomePoints <= 60);
assert.notEqual(generated.forecast.representativeScore.away, generated.forecast.representativeScore.home);

const completed = game({
  id: "completed-prior-id",
  start: "2026-08-29T16:00:00.000Z",
  awayName: "Alabama Crimson Tide",
  awayAbbreviation: "BAMA",
  homeName: "Clemson Tigers",
  homeAbbreviation: "CLEM",
});
completed.awayScore = 42;
completed.homeScore = 10;
completed.status = "final";
const withCompleted = getCfbV1ForecastForGame({ game: weekOneGame, completedGames: [completed] });
assert.equal(withCompleted.featureHealth.completedGamesApplied, 1);
assert.notEqual(withCompleted.forecast.expectedAwayPoints, generated.forecast.expectedAwayPoints, "known prior results must update the same leakage-safe rolling feature contract");

const unknown = getCfbV1ForecastForGame({ game: game({ id: "unknown-team", start: "2026-09-05T23:00:00.000Z", awayName: "Unmapped College Example", homeName: "Notre Dame Fighting Irish", homeAbbreviation: "ND", week: 2 }) });
assert.equal(unknown.featureHealth.awayProfile, "neutral_imputation");
assertPmfCoherence(unknown.forecast);
const heldUnknown = buildCfbV1DecisionBundle({
  providerGameId: unknown.forecast.providerGameId,
  awayTeam: "UNK",
  homeTeam: "ND",
  gameStartsAt: unknown.forecast.gameStartsAt,
  comparableCurrentBooks: [],
  healthHolds: ["away_model_team_profile_unavailable"],
  forecast: unknown.forecast,
});
assert.equal(heldUnknown.heldMarkets.length, 3);
assert.equal(heldUnknown.publicationEnabled, true, "a profile hold must not remove the independent forecast/card");

const fcs = game({ id: "fcs-at-fbs", start: "2026-09-05T17:00:00.000Z", awayName: "Alabama A&M Bulldogs", homeName: "Alabama Crimson Tide", homeAbbreviation: "BAMA", week: 2 });
fcs.away.fbs = false;
const bothFcs = game({ id: "both-fcs", start: "2026-09-05T18:00:00.000Z", awayName: "FCS One", homeName: "FCS Two", week: 2 });
bothFcs.away.fbs = false;
bothFcs.home.fbs = false;
const supportedFcs = game({ id: "supported-fcs", start: "2026-09-05T18:30:00.000Z", awayName: "Colgate Raiders", homeName: "Fordham Rams", week: 2 });
supportedFcs.away.fbs = false;
supportedFcs.home.fbs = false;
const outside = game({ id: "outside", start: "2026-09-09T18:00:00.000Z", awayName: "Alabama Crimson Tide", homeName: "Clemson Tigers", week: 2 });
assert.deepEqual(eligibleCfbWeeklyGames([weekOneGame, fcs, bothFcs, supportedFcs, outside], weekOneWindow).map((row) => row.providerGameId), ["fcs-at-fbs", "both-fcs", "supported-fcs", "week-one-new-id"]);
assert.equal(cfbV1WeeklyGameProfileCoverage(supportedFcs).supported, true, "a pure-FCS matchup with two qualified artifact profiles must be model-covered");
assert.equal(cfbV1WeeklyGameProfileCoverage(bothFcs).supported, false, "unknown teams cannot enter the betting board through neutral imputation");
assert.deepEqual(
  selectCfbModelCoveredWeeklyGames({ games: [weekOneGame, bothFcs, supportedFcs, outside], existing: [], now: "2026-09-01T12:00:00.000Z", window: weekOneWindow }).map((row) => row.providerGameId),
  ["supported-fcs", "week-one-new-id"],
);
assert.deepEqual(
  selectCfbModelCoveredWeeklyGames({ games: [supportedFcs], existing: [], now: "2026-09-05T19:00:00.000Z", window: weekOneWindow }),
  [],
  "a game first discovered after kickoff cannot be backfilled",
);
const supportedFcsForecast = getCfbV1ForecastForGame({ game: supportedFcs }).forecast;
assert.deepEqual(
  selectCfbModelCoveredWeeklyGames({ games: [supportedFcs], existing: [evidenceRow(supportedFcs, supportedFcsForecast, 1, "supported-fcs-opening")], now: "2026-09-05T19:00:00.000Z", window: weekOneWindow }).map((row) => row.providerGameId),
  ["supported-fcs"],
  "an already captured game remains inside immutable lifecycle handling",
);

const qbPlans = Array.from({ length: 20 }, (_, index) => {
  const value = game({ id: `qb-${index}`, start: `2026-09-05T${String(10 + Math.floor(index / 2)).padStart(2, "0")}:00:00.000Z`, awayName: `Away ${index}`, homeName: `Home ${index}`, week: 2, awayId: 1000 + index * 2, homeId: 1001 + index * 2 });
  return { game: value, stage: index === 19 ? "t60" as const : "opening" as const };
});
const qbTeams = qbPlans.flatMap((plan) => [plan.game.away, plan.game.home]);
const selectedQbTeams = selectQuarterbackTeams({ plans: qbPlans, teams: qbTeams, priorQuarterbacks: new Map(), maximum: CFB_FORWARD_MAX_QB_TEAMS_PER_RUN });
assert.equal(selectedQbTeams.length, 24);
assert.ok(selectedQbTeams.some((team) => team.id === qbPlans[19]!.game.away.id));
assert.ok(selectedQbTeams.some((team) => team.id === qbPlans[19]!.game.home.id), "T-60 teams must outrank opening context inside the hard budget");
const prior = new Map<number, CfbForwardTeamQuarterbacks>([[qbPlans[19]!.game.away.id, quarterbacks(qbPlans[19]!.game.away)]]);
assert.equal(selectQuarterbackTeams({ plans: qbPlans, teams: qbTeams, priorQuarterbacks: prior, maximum: CFB_FORWARD_MAX_QB_TEAMS_PER_RUN }).some((team) => team.id === qbPlans[19]!.game.away.id), false, "previous immutable QB context must be reused rather than re-requested");

const openingRows = frozen.slice(0, 2).map((forecast, index) => evidenceRow(game({ id: forecast.providerGameId, start: forecast.gameStartsAt, awayName: forecast.awayTeam, homeName: forecast.homeTeam }), forecast, 2, `opening-${index}`));
const weekOneRows = [weekOneGame, fcs].map((value, index) => evidenceRow(value, getCfbV1ForecastForGame({ game: value }).forecast, 2, `week-one-${index}`));
assert.equal(
  resolveCfbForwardWindow({ now: "2026-08-30T15:30:00.000Z", evidence: openingRows, advanceWithoutNextEvidence: true }).boardStartDate,
  "2026-09-03",
  "a complete captured slate with no future kickoff must reveal the week-ahead board before Tuesday",
);
assert.equal(
  resolveCfbForwardWindow({ now: "2026-08-30T15:30:00.000Z", evidence: [
    ...openingRows,
    (() => {
      const monday = game({ id: "monday-future", start: "2026-08-31T23:30:00.000Z", awayName: "Alabama Crimson Tide", homeName: "Clemson Tigers" });
      return evidenceRow(monday, getCfbV1ForecastForGame({ game: monday }).forecast, 3, "monday-future");
    })(),
  ] }).boardStartDate,
  "2026-08-27",
  "a captured future Monday game must keep the current board active",
);
assert.equal(
  resolveCfbForwardWindow({ now: "2026-08-30T15:30:00.000Z", evidence: [openingRows[0]!] }).boardStartDate,
  "2026-08-27",
  "an incomplete opening wave cannot trigger an early rollover",
);
const earlyWeekOneMember = buildCfbMemberFixture([...openingRows, ...weekOneRows], "2026-08-30T15:30:00.000Z");
assert.deepEqual(earlyWeekOneMember.snapshot.games.map((value) => value.id).sort(), ["cfb-fcs-at-fbs", "cfb-week-one-new-id"]);
assert.equal(earlyWeekOneMember.week.label, "Week of Sep 3");
const weekOneMember = buildCfbMemberFixture([...openingRows, ...weekOneRows], "2026-09-01T16:00:00.000Z");
assert.deepEqual(weekOneMember.snapshot.games.map((value) => value.id).sort(), ["cfb-fcs-at-fbs", "cfb-week-one-new-id"]);
assert.equal(weekOneMember.week.label, "Week of Sep 3");

const writerSource = readFileSync("lib/services/football/cfbForwardEvidenceWriter.ts", "utf8");
assert.doesNotMatch(writerSource, /requiredIds|getCfbV1Forecasts\(/, "the production writer cannot retain a static launch-artifact allowlist");
assert.match(writerSource, /eligibleCfbWeeklyGames/);
assert.match(writerSource, /CFB_FORWARD_MAX_QB_TEAMS_PER_RUN/);

console.log("CFB generalized weekly-engine tests passed.");

function assertPmfCoherence(forecast: ReturnType<typeof getCfbV1ForecastForGame>["forecast"]): void {
  const mass = forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0);
  const home = forecast.pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
  const away = forecast.pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
  const homeWin = forecast.pmf.reduce((sum, cell) => sum + (cell.home > cell.away ? cell.probability : cell.home === cell.away ? 0.5 * cell.probability : 0), 0);
  assert.ok(Math.abs(mass - 1) < 1e-9);
  assert.ok(Math.abs(home - forecast.expectedHomePoints) < 1e-9);
  assert.ok(Math.abs(away - forecast.expectedAwayPoints) < 1e-9);
  assert.ok(Math.abs((home - away) - forecast.expectedMarginHome) < 1e-9);
  assert.ok(Math.abs((home + away) - forecast.expectedTotal) < 1e-9);
  assert.ok(Math.abs(homeWin - forecast.homeWinProbability) < 1e-9);
  assert.ok(forecast.pmf.some((cell) => cell.home === forecast.representativeScore.home && cell.away === forecast.representativeScore.away && cell.probability > 0));
  const probabilities = cfbV1LineProbabilities({ forecast, homeSpread: -3.5, totalLine: 52.5 });
  assert.ok(Math.abs(probabilities.moneyline.home + probabilities.moneyline.away - 1) < 1e-9);
  assert.ok(Math.abs(probabilities.spread.home + probabilities.spread.away - 1) < 1e-9);
  assert.ok(Math.abs(probabilities.total.over + probabilities.total.under - 1) < 1e-9);
}

function game(args: { id: string; start: string; awayName: string; homeName: string; awayAbbreviation?: string; homeAbbreviation?: string; week?: number; awayId?: number; homeId?: number }): NcaafGame {
  return {
    providerGameId: args.id,
    providerWeek: args.week ?? 1,
    season: 2026,
    scheduledStart: args.start,
    status: "scheduled",
    awayScore: null,
    homeScore: null,
    away: team(args.awayId ?? 1, args.awayAbbreviation ?? "AWY", args.awayName),
    home: team(args.homeId ?? 2, args.homeAbbreviation ?? "HME", args.homeName),
  };
}

function team(id: number, abbreviation: string, name: string): NcaafTeam {
  return { id, conferenceId: 1, abbreviation, name, fbs: true };
}

function evidenceRow(value: NcaafGame, forecast: ReturnType<typeof getCfbV1ForecastForGame>["forecast"], slateGameCount: number, id: string): CfbForwardStoredEvidence {
  const capturedAt = new Date(Date.parse(value.scheduledStart) - 4 * 86_400_000).toISOString();
  const bundle = buildCfbV1DecisionBundle({ providerGameId: value.providerGameId, awayTeam: value.away.abbreviation, homeTeam: value.home.abbreviation, gameStartsAt: value.scheduledStart, comparableCurrentBooks: [], forecast });
  const { pmf: _pmf, ...publishedForecast } = forecast;
  const payload: CfbForwardEvidencePayload = {
    schemaRelease: CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
    collectorRelease: CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
    memberRelease: CFB_FORWARD_MEMBER_RELEASE,
    runId: id,
    season: 2026,
    week: value.providerWeek,
    slateGameCount,
    stage: "opening",
    captureTiming: "on_time",
    capturedAt,
    cutoffAt: null,
    t60LagMinutes: null,
    game: value,
    market: { current: null, currentBooks: [], providerOpening: null, operationalOpening: null, playbookLine: null, playbookSplits: null, sharpApiOddsRelease: null, sharpApiSplits: null },
    quarterbacks: { away: quarterbacks(value.away), home: quarterbacks(value.home) },
    availability: { injuryStatus: "provider_unavailable", weatherStatus: "venue_weather_unavailable", note: "test" },
    decisions: {
      ...bundle,
      forecast: publishedForecast,
      marketOutlooks: buildCfbForwardMarketOutlooks({ forecast, playbookLine: null }),
    },
    independentForecast: publishedForecast,
    authoritativeForecast: {
      status: "market_anchor_unavailable_hold",
      release: CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
      candidateRelease: CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE,
      marketWeight: 0,
    },
    coverage: { currentOdds: false, comparableCurrentBookCount: 0, currentOddsProviders: [], sharpApiOddsFallback: false, targetExcludedConsensusReady: false, operationalOpening: false, playbookLine: false, playbookSplits: false, sharpApiSplits: false, activeQuarterbacks: true, injuries: false, weather: false, healthHolds: [], availabilityWarnings: [] },
    requestBudget: { balldontlieSlate: 0, balldontlieQuarterbacks: 0, playbook: 0, sharpApiOdds: 0, totalMaximum: 0 },
  };
  const payloadSha256 = hashCfbForwardEvidencePayload(payload);
  return { id, providerGameId: value.providerGameId, stage: "opening", capturedAt, gameStartAt: value.scheduledStart, payloadSha256, payload };
}

function quarterbacks(value: NcaafTeam): CfbForwardTeamQuarterbacks {
  const player = { playerId: `${value.id}-qb`, name: `${value.abbreviation} QB`, position: "QB" as const, jerseyNumber: "1", previousSeasonPassingAttempts: 200, previousSeasonPassingYards: 2000 };
  return { provider: "balldontlie", teamId: value.id, team: value.abbreviation, capturedAt: "2026-08-25T12:00:00.000Z", starterStatus: "projected", projectionMethod: "active_roster_previous_season_attempts", expectedStartingQuarterback: player, activeQuarterbacks: [player] };
}
