import assert from "node:assert/strict";
import { CBB_DEVELOPMENT_UNCERTAINTY } from "../lib/cbb/evaluation";
import { forecastCbbGame, cbbThresholdProbabilities } from "../lib/cbb/model";
import { cbbHistoricalEnvironments, fitCbbStructuralPrior, fitCbbStructuralState, CBB_STRUCTURAL_VARIANTS } from "../lib/cbb/structuralResearch";
import type { CbbTrainingGame } from "../lib/cbb/types";

const config = { id: "structural_test", ridge: 1, paceRidge: 0.25, priorCarry: 0.8, recencyDays: 90 };
const games: CbbTrainingGame[] = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1, date: new Date(Date.UTC(2023, 10, 1 + i)).toISOString(), season: 2023, homeId: i % 2 ? 1 : 2, awayId: i % 2 ? 2 : 1,
  homeScore: 90 + i % 3, awayScore: 80, homeRegulation: 90 + i % 3, awayRegulation: 80, overtime: false, possessions: 80, tempo: 80, neutral: false,
  homeFactors: { efg: 0.55, turnoverRate: 0.12, offensiveReboundRate: 0.3, freeThrowRate: 0.3 },
  awayFactors: { efg: 0.5, turnoverRate: 0.15, offensiveReboundRate: 0.28, freeThrowRate: 0.3 },
}));
const asOf = "2024-01-01T00:00:00.000Z";
for (const variant of CBB_STRUCTURAL_VARIANTS) {
  const { state, diagnostics } = fitCbbStructuralState(games, { season: 2023, asOf, config, variant });
  assert.equal(diagnostics.converged, true); assert.ok(diagnostics.maxChange < 1e-7);
  const future = { ...games[0], id: 999, date: "2024-01-02T00:00:00.000Z", homeScore: 150 };
  assert.deepEqual(fitCbbStructuralState([...games, future], { season: 2023, asOf, config, variant }).state, state);
  const fixture = { id: 101, date: "2024-01-03T00:00:00.000Z", homeId: 1, awayId: 2, neutral: false };
  const forecast = forecastCbbGame(state, fixture, CBB_DEVELOPMENT_UNCERTAINTY);
  assert.ok(Math.abs(forecast.homeScore - forecast.awayScore - forecast.margin) < 1e-10);
  assert.ok(Math.abs(cbbThresholdProbabilities(forecast, "spread", 0).first - forecast.homeWinProbability) < 1e-10);
  assert.deepEqual(games[0].homeScore, 90);
}
const environment = cbbHistoricalEnvironments(games, 2023, config);
assert.deepEqual(environment.get("2023-11-01"), { efficiency: 103, tempo: 69 });
const changed = games.map(g => ({ ...g, homeScore: g.homeScore + (g.id > 10 ? 50 : 0) }));
assert.deepEqual(cbbHistoricalEnvironments(changed, 2023, config).get("2023-11-10"), environment.get("2023-11-10"));
const end = fitCbbStructuralPrior(games, 2024, config, CBB_STRUCTURAL_VARIANTS[1]).prior!;
assert.equal(end.asOf, new Date(Date.parse(games.at(-1)!.date) + 21600000).toISOString());
assert.throws(() => fitCbbStructuralState(games, { season: 2023, asOf, config, prior: { ...end, season: 2023 }, variant: CBB_STRUCTURAL_VARIANTS[0] }), /future prior/);
console.log("CBB r6: convergence, date-aligned environment chronology, prior endpoint, no future outcomes, and coherent scores/probabilities passed.");
