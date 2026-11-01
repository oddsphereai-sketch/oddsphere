import assert from "node:assert/strict";
import {
  buildNflUnifiedMarketAdjustedForecast,
  getNflV1WeekOneOutcomeForecast,
  inferNflTargetExcludedMoneylineMean,
  inferNflTargetExcludedSpreadMean,
} from "../lib/services/football/nflV1WeekOneOutcome";

const forecast = getNflV1WeekOneOutcomeForecast({
  providerGameId: "moneyline-own-axis-test", awayTeam: "AWY", homeTeam: "HME",
  weeklyFallback: { projectedHomeMargin: 3, marketTotal: 46 },
});
const independentTotal = forecast.expectedAwayScore + forecast.expectedHomeScore;
for (const fair of [0.25, 0.4, 0.49, 0.5, 0.51, 0.6, 0.75]) {
  const margin = inferNflTargetExcludedMoneylineMean({ independentForecast: forecast, homeWinFairProbability: fair });
  assert.notEqual(margin, null);
  assert.equal(margin, inferNflTargetExcludedSpreadMean({ independentForecast: forecast,
    homeMarginBoundary: 0, homeCoverFairProbability: fair }), "Moneyline uses the existing marginal inversion at zero");
  const adjusted = buildNflUnifiedMarketAdjustedForecast({ baseForecast: forecast,
    expectedHomeMargin: margin!, expectedTotal: independentTotal,
    marketInputPolicy: "target_excluded_continuous_residual" });
  assert.ok(Math.abs(adjusted.homeWinProbability - fair) < 1e-6,
    "inferred margin must reproduce current Moneyline probability under the published tie-conditional convention");
  const positive = adjusted.marginDistribution.values.reduce((sum, value, index) => sum +
    (value > 0 ? adjusted.marginDistribution.probabilities[index]! : 0), 0);
  const negative = adjusted.marginDistribution.values.reduce((sum, value, index) => sum +
    (value < 0 ? adjusted.marginDistribution.probabilities[index]! : 0), 0);
  assert.ok(Math.abs(positive / (positive + negative) - fair) < 1e-6);
  assert.ok(adjusted.tieProbability > 0, "test must exercise real nonzero tie mass rather than a continuous shortcut");
  assert.ok(Math.abs(adjusted.expectedAwayScore + adjusted.expectedHomeScore - independentTotal) < 1e-9,
    "Moneyline authority alone preserves the independent total coordinate");
}
for (const invalid of [-0.1, 0, 1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(inferNflTargetExcludedMoneylineMean({ independentForecast: forecast, homeWinFairProbability: invalid }), null);
}
console.log("NFL direct Moneyline price inversion: same PMF, decided-game probability, unchanged Total and invalid-source controls passed");
