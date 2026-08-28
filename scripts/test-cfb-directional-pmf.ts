import assert from "node:assert/strict";
import type { NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";
import {
  CFB_V1_DECISION_RELEASE,
  CFB_V1_DISTRIBUTION_RELEASE,
  CFB_V1_MODEL_RELEASE,
  CFB_V1_PROBABILITY_RELEASE,
  CFB_V1_SCORE_ARTIFACT_RELEASE,
  cfbV1LineProbabilities,
  getCfbV1ForecastForGame,
} from "../lib/services/football/cfbV1Decision";
import {
  CFB_V1_DIRECTIONAL_ALIGNMENT_RELEASE,
  CFB_V1_WEEKLY_RUNTIME_RELEASE,
} from "../lib/services/football/cfbV1WeeklyForecast";
import { auditFootballCrossMarketCoherence } from "../lib/services/football/footballCrossMarketCoherence";

const game: NcaafGame = {
  providerGameId: "458220",
  season: 2026,
  providerWeek: 1,
  scheduledStart: "2026-08-29T19:00:00.000Z",
  status: "scheduled",
  neutralSite: false,
  homeScore: 0,
  awayScore: 0,
  away: { id: 147, fbs: false, name: "UC Davis Aggies", abbreviation: "UCD", conferenceId: 12 },
  home: { id: 145, fbs: false, name: "Portland State Vikings", abbreviation: "PRST", conferenceId: 12 },
};

const { forecast, featureHealth } = getCfbV1ForecastForGame({ game });
const mass = forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0);
const expectedAway = forecast.pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
const expectedHome = forecast.pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
const homeWinProbability = forecast.pmf.reduce(
  (sum, cell) => sum + (cell.home > cell.away ? cell.probability : cell.home === cell.away ? 0.5 * cell.probability : 0),
  0,
);

assert.equal(CFB_V1_SCORE_ARTIFACT_RELEASE, CFB_V1_WEEKLY_RUNTIME_RELEASE);
assert.match(CFB_V1_MODEL_RELEASE, /directional_pmf$/);
assert.match(CFB_V1_DISTRIBUTION_RELEASE, /directional_pmf$/);
assert.match(CFB_V1_PROBABILITY_RELEASE, /directional_pmf$/);
assert.match(CFB_V1_DECISION_RELEASE, /directional_pmf$/);
assert.deepEqual(featureHealth, {
  awayProfile: "matched",
  homeProfile: "matched",
  completedGamesApplied: 0,
});
assert.equal(forecast.directionalAlignment?.release, CFB_V1_DIRECTIONAL_ALIGNMENT_RELEASE);
assert.equal(forecast.directionalAlignment?.target, "away");
assert.equal(forecast.directionalAlignment?.reason, "mean_probability_direction_cross");
assert.ok((forecast.directionalAlignment?.symmetricPoints ?? 0) > 0);
assert.ok((forecast.directionalAlignment?.symmetricPoints ?? Infinity) <= 1);
assert.ok(Math.abs(mass - 1) < 1e-12);
assert.ok(Math.abs(expectedAway - forecast.expectedAwayPoints) < 1e-12);
assert.ok(Math.abs(expectedHome - forecast.expectedHomePoints) < 1e-12);
assert.ok(Math.abs(homeWinProbability - forecast.homeWinProbability) < 1e-12);
assert.ok(forecast.expectedAwayPoints > forecast.expectedHomePoints);
assert.ok(forecast.homeWinProbability < 0.5);
assert.ok(forecast.representativeScore.away > forecast.representativeScore.home);
assert.ok(Math.abs((forecast.expectedHomePoints - forecast.expectedAwayPoints) - forecast.expectedMarginHome) < 1e-12);
assert.ok(Math.abs((forecast.expectedHomePoints + forecast.expectedAwayPoints) - forecast.expectedTotal) < 1e-12);

const lineProbabilities = cfbV1LineProbabilities({ forecast, homeSpread: 0, totalLine: 53 });
assert.ok(Math.abs(lineProbabilities.moneyline.home - forecast.homeWinProbability) < 1e-12);
assert.ok(Math.abs(lineProbabilities.moneyline.home + lineProbabilities.moneyline.away - 1) < 1e-12);
assert.ok(Math.abs(lineProbabilities.spread.home + lineProbabilities.spread.away - 1) < 1e-12);
assert.ok(Math.abs(lineProbabilities.total.over + lineProbabilities.total.under - 1) < 1e-12);

const coherence = auditFootballCrossMarketCoherence({
  sport: "cfb",
  providerGameId: game.providerGameId,
  awayTeam: game.away.abbreviation,
  homeTeam: game.home.abbreviation,
  forecast: {
    expectedAwayPoints: forecast.expectedAwayPoints,
    expectedHomePoints: forecast.expectedHomePoints,
    representativeScore: forecast.representativeScore,
    awayWinProbability: 1 - forecast.homeWinProbability,
    homeWinProbability: forecast.homeWinProbability,
    pmf: forecast.pmf,
  },
  decisions: [],
  unavailableMarkets: ["moneyline", "spread", "total"],
});
assert.equal(coherence.passed, true, JSON.stringify(coherence.fatalIssues));

console.log(JSON.stringify({
  test: "cfb-directional-pmf",
  providerGameId: forecast.providerGameId,
  expectedScore: { away: forecast.expectedAwayPoints, home: forecast.expectedHomePoints },
  homeWinProbability: forecast.homeWinProbability,
  representativeScore: forecast.representativeScore,
  directionalAlignment: forecast.directionalAlignment,
  passed: true,
}, null, 2));
