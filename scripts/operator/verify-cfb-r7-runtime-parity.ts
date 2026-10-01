import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { NcaafGame } from "../../lib/services/football/balldontlieNcaafSlate";
import { fetchCfbCurrentAdvancedState } from "../../lib/services/football/cfbCurrentAdvancedState";
import { getCfbV1WeeklyForecasts } from "../../lib/services/football/cfbV1WeeklyForecast";

type Prediction = {
  gameId: string;
  gameDate: string;
  week: number;
  neutralSite: boolean;
  awayTeam: string;
  homeTeam: string;
  expectedAway: number;
  expectedHome: number;
};

async function main() {
const reportPath = process.argv[2] ?? "/private/tmp/cfb-r7-compact-runtime-parity-r14.json";
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  current2026: { selectedTrees: number; predictions: Prediction[] };
};
assert.equal(report.current2026.selectedTrees, 48);
const predictions = report.current2026.predictions.filter((row) => row.week === 1);
assert.ok(predictions.length >= 90, "runtime parity requires the complete Week 1 cohort");
const games: NcaafGame[] = predictions.map((row, index) => ({
  providerGameId: row.gameId,
  providerWeek: row.week,
  season: 2026,
  scheduledStart: new Date(row.gameDate).toISOString(),
  status: "scheduled",
  neutralSite: row.neutralSite,
  awayScore: null,
  homeScore: null,
  away: { id: index * 2 + 1, conferenceId: null, abbreviation: `A${index}`, name: row.awayTeam, fbs: true },
  home: { id: index * 2 + 2, conferenceId: null, abbreviation: `H${index}`, name: row.homeTeam, fbs: true },
}));
const advancedState = await fetchCfbCurrentAdvancedState({ season: 2026, now: new Date().toISOString() });
const forecasts = getCfbV1WeeklyForecasts({ games, advancedGames: advancedState.games });
const details = predictions.map((row) => {
  const result = forecasts.get(row.gameId);
  assert.ok(result, `missing runtime forecast ${row.gameId}`);
  const forecast = result.forecast;
  return {
    gameId: row.gameId,
    awayTeam: row.awayTeam,
    homeTeam: row.homeTeam,
    boundaryConstrained: row.expectedAway < 0 || row.expectedHome < 0,
    awayDelta: forecast.expectedAwayPoints - row.expectedAway,
    homeDelta: forecast.expectedHomePoints - row.expectedHome,
    runtimeAway: forecast.expectedAwayPoints,
    runtimeHome: forecast.expectedHomePoints,
    featureHealth: result.featureHealth,
  };
});
const errors = details.flatMap((row) => [Math.abs(row.awayDelta), Math.abs(row.homeDelta)]);
const feasibleErrors = details.filter((row) => !row.boundaryConstrained)
  .flatMap((row) => [Math.abs(row.awayDelta), Math.abs(row.homeDelta)]);
const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
const maximum = Math.max(...errors);
const feasibleMaximum = Math.max(...feasibleErrors);
const signedAway = details.reduce((sum, row) => sum + row.awayDelta, 0) / details.length;
const signedHome = details.reduce((sum, row) => sum + row.homeDelta, 0) / details.length;
const worst = [...details].sort((first, second) => Math.max(Math.abs(second.homeDelta), Math.abs(second.awayDelta)) - Math.max(Math.abs(first.homeDelta), Math.abs(first.awayDelta))).slice(0, 8);
const boundaryConstrained = details.filter((row) => row.boundaryConstrained);
console.log(JSON.stringify({ games: predictions.length, meanTeamScoreDelta: mean, maximumTeamScoreDelta: maximum, feasibleMaximumTeamScoreDelta: feasibleMaximum, boundaryConstrainedGames: boundaryConstrained.length, signedAway, signedHome, worst }, null, 2));
assert.ok(details.every((row) => row.runtimeAway >= 0 && row.runtimeHome >= 0), "runtime emitted an impossible negative football score");
assert.ok(mean <= 0.10, `runtime/Python mean team-score delta ${mean.toFixed(4)} exceeds quantization tolerance`);
assert.ok(feasibleMaximum <= 0.55, `runtime/Python feasible maximum team-score delta ${feasibleMaximum.toFixed(4)} exceeds quantization tolerance`);
assert.ok(boundaryConstrained.length / details.length <= 0.05, "too many raw model scores require the nonnegative football-score boundary");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
