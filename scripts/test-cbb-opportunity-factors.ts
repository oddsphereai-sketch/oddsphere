import assert from "node:assert/strict";
import { enrichOpportunityFactors, opportunityFactorFit } from "../lib/cbb/opportunityFactorResearch";
import type { CbbBox, CbbTrainingGame } from "../lib/cbb/types";
import type { CbbScoreFeatureRow } from "../lib/cbb/scoreResearch";

const team = (id: number) => ({ id, conference_id: 1, name: `Team ${id}`, full_name: `Team ${id}`,
  college: `Team ${id}`, abbreviation: `T${id}` });
const box = (id: number, gameId: number, date: string, fga: number, fgm: number): CbbBox => ({
  team: team(id), game: { id: gameId, date, season: 2024 }, fgm, fga, fg3m: 0, fg3a: 10,
  ftm: 10, fta: 12, oreb: 10, dreb: 20, turnovers: 10,
});
const factors = { efg: 0.5, turnoverRate: 10 / 70, offensiveReboundRate: 1 / 3, freeThrowRate: 0.3 };
const training = (id: number, date: string, homeId: number, awayId: number): CbbTrainingGame => ({
  id, date, season: 2024, homeId, awayId, homeScore: 70, awayScore: 60,
  homeRegulation: 70, awayRegulation: 60, overtime: false, possessions: 70, tempo: 70,
  neutral: false, homeFactors: factors, awayFactors: factors,
});
const first = training(1, "2024-11-01T10:00:00.000Z", 1, 2);
const second = training(2, "2024-11-07T10:00:00.000Z", 3, 1);
const boxes = [box(1, 1, first.date, 40, 20), box(2, 1, first.date, 60, 30),
  box(3, 2, second.date, 60, 30), box(1, 2, second.date, 80, 60)];
const before = opportunityFactorFit([first, second], boxes, 2024, "2024-11-07T12:00:00.000Z", "pooled");
assert.equal(before.games, 1, "the second game is not known before start plus six hours");
assert.equal(before.offense.get(1)?.efg, 0.5);
const pooled = opportunityFactorFit([first, second], boxes, 2024, "2024-11-08T00:00:00.000Z", "pooled");
assert.equal(pooled.games, 2);
assert.ok(Math.abs(pooled.offense.get(1)!.efg - 80 / 120) < 1e-12,
  "the 80-attempt game must contribute twice the 40-attempt game's opportunity weight");
assert.equal(pooled.allowed.get(1)?.efg, 0.5, "allowed eFG comes from the actual opposing boxes");
const recent = opportunityFactorFit([first, second], boxes, 2024, "2024-11-08T00:00:00.000Z", "pooled_recency_90");
assert.ok(recent.offense.get(1)!.efg > pooled.offense.get(1)!.efg, "recent high-volume game gets more weight");
const game = training(3, "2024-11-09T10:00:00.000Z", 1, 2);
const row = { game, forecast: { asOf: "2024-11-08T00:00:00.000Z" }, features: Array(19).fill(0) } as CbbScoreFeatureRow;
const enriched = enrichOpportunityFactors([row], [first, second], boxes, "pooled")[0];
assert.equal(enriched.features.length, 19);
assert.ok(enriched.features[7] > 0, "the same pooled matchup favors team 1's eFG");
assert.deepEqual(enriched.features.slice(0, 7), row.features.slice(0, 7), "nonfactor features stay fixed");
assert.deepEqual(enriched.features.slice(15), row.features.slice(15), "form and venue features stay fixed");
console.log("CBB opportunity factors: exact opportunities, recency, cutoff, opponent allowed, and feature isolation passed");
